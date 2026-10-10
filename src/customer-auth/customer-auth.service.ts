import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditService } from '../audit/audit.service.js';
import {
  afterFailedLogin,
  afterSuccessfulLogin,
  isLocked,
  LOGIN_FAILED_MESSAGE,
} from '../auth/lockout.js';
import {
  burnPasswordCheck,
  hashPassword,
  verifyPassword,
} from '../auth/password.js';
import type { RequestMeta } from '../auth/request-meta.js';
import { hashToken, newToken } from '../auth/tokens.js';
import type { Env } from '../config/env.validation.js';
import { BlindIndex } from '../crypto/blind-index.js';
import {
  ActorType,
  CustomerTokenType,
  Prisma,
} from '../generated/prisma/client.js';
import { Mailer } from '../mail/mailer.js';
import * as templates from '../mail/templates.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  CustomerSessionService,
  type SessionCustomer,
} from './customer-session.service.js';
import type { SignupDto } from './dto.js';

const HOUR_MS = 60 * 60 * 1000;
const TOKEN_TTL_MS: Record<CustomerTokenType, number> = {
  EMAIL_VERIFICATION: 24 * HOUR_MS,
  PASSWORD_RESET: HOUR_MS,
};

const INVALID_LINK = 'This link is invalid or has expired.';

// Responses never reveal whether an email address has an account.
export const CHECK_EMAIL_MESSAGE =
  'Check your email to finish creating your account.';
export const RESET_REQUESTED_MESSAGE =
  "If there's an account with that email, we've sent a link to reset the password.";
export const VERIFICATION_RESENT_MESSAGE =
  "If that email has an account waiting to be confirmed, we've sent a new link.";

const normalizeEmail = (email: string) => email.trim().toLowerCase();

type Db = Pick<PrismaService, 'customerToken'>;

@Injectable()
export class CustomerAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly blindIndex: BlindIndex,
    private readonly sessions: CustomerSessionService,
    private readonly audit: AuditService,
    private readonly mailer: Mailer,
    private readonly config: ConfigService<Env, true>,
  ) {}

  // ---------- Sign-up & verification ----------

  async signup(dto: SignupDto, meta: RequestMeta) {
    const email = normalizeEmail(dto.email);
    // Hash up front on every path so response time doesn't reveal whether
    // the email already has an account.
    const passwordHash = await hashPassword(dto.password);

    const existing = await this.findByEmail(email);
    if (existing) {
      await this.handleExistingSignup(existing, email, meta);
      return { message: CHECK_EMAIL_MESSAGE };
    }

    let created: { customerId: string; token: string };
    try {
      created = await this.prisma.$transaction(async (tx) => {
        const customer = await tx.customer.create({
          data: {
            email,
            firstName: dto.firstName,
            lastName: dto.lastName,
            phone: dto.phone,
            passwordHash,
            termsVersion: this.config.get('TERMS_VERSION', { infer: true }),
            termsAcceptedAt: new Date(),
          },
          select: { id: true },
        });
        const token = await this.issueToken(
          customer.id,
          CustomerTokenType.EMAIL_VERIFICATION,
          tx,
        );
        await this.audit.record(
          {
            actorType: ActorType.CUSTOMER,
            customerId: customer.id,
            action: 'customer.signup',
            entityType: 'Customer',
            entityId: customer.id,
            meta,
          },
          tx,
        );
        return { customerId: customer.id, token };
      });
    } catch (error) {
      // Two sign-ups for the same email at once: treat the loser as existing.
      if (isUniqueViolation(error)) {
        const raced = await this.findByEmail(email);
        if (raced) await this.handleExistingSignup(raced, email, meta);
        return { message: CHECK_EMAIL_MESSAGE };
      }
      throw error;
    }

    await this.mailer.send(
      templates.verifyEmail(email, this.link('/verify-email', created.token)),
    );
    return { message: CHECK_EMAIL_MESSAGE };
  }

  private async handleExistingSignup(
    existing: { id: string; emailVerifiedAt: Date | null },
    email: string,
    meta: RequestMeta,
  ) {
    await this.audit.record({
      actorType: ActorType.PUBLIC,
      action: 'customer.signup_existing_email',
      entityType: 'Customer',
      entityId: existing.id,
      meta,
    });

    if (existing.emailVerifiedAt === null) {
      const token = await this.issueToken(
        existing.id,
        CustomerTokenType.EMAIL_VERIFICATION,
      );
      await this.mailer.send(
        templates.verifyEmail(email, this.link('/verify-email', token)),
      );
    } else {
      await this.mailer.send(
        templates.alreadyRegistered(
          email,
          `${this.siteUrl()}/login`,
          `${this.siteUrl()}/forgot-password`,
        ),
      );
    }
  }

  async verifyEmail(token: string, meta: RequestMeta) {
    const record = await this.findUsableToken(
      token,
      CustomerTokenType.EMAIL_VERIFICATION,
    );

    await this.prisma.$transaction(async (tx) => {
      await claimToken(tx, record.id);
      await tx.customer.update({
        where: { id: record.customerId },
        data: {
          emailVerifiedAt: record.customer.emailVerifiedAt ?? new Date(),
        },
      });
      await this.audit.record(
        {
          actorType: ActorType.CUSTOMER,
          customerId: record.customerId,
          action: 'customer.email_verified',
          entityType: 'Customer',
          entityId: record.customerId,
          meta,
        },
        tx,
      );
    });

    return { verified: true };
  }

  async resendVerification(rawEmail: string) {
    const email = normalizeEmail(rawEmail);
    const customer = await this.findByEmail(email);
    if (customer && customer.emailVerifiedAt === null) {
      const token = await this.issueToken(
        customer.id,
        CustomerTokenType.EMAIL_VERIFICATION,
      );
      await this.mailer.send(
        templates.verifyEmail(email, this.link('/verify-email', token)),
      );
    }
    return { message: VERIFICATION_RESENT_MESSAGE };
  }

  // ---------- Login ----------

  async login(rawEmail: string, password: string, meta: RequestMeta) {
    const customer = await this.prisma.customer.findUnique({
      where: { emailHash: this.blindIndex.hash('email', rawEmail) },
      select: {
        id: true,
        passwordHash: true,
        failedLoginCount: true,
        lockedUntil: true,
        deletedAt: true,
      },
    });

    if (!customer || customer.deletedAt !== null) {
      await burnPasswordCheck(password);
      await this.recordFailedLogin(undefined, 'unknown_account', meta);
      throw new UnauthorizedException(LOGIN_FAILED_MESSAGE);
    }

    // Check the password even while locked so timing looks the same.
    const passwordOk = await verifyPassword(customer.passwordHash, password);

    if (isLocked(customer)) {
      await this.recordFailedLogin(customer.id, 'locked', meta);
      throw new UnauthorizedException(LOGIN_FAILED_MESSAGE);
    }

    if (!passwordOk) {
      await this.prisma.customer.update({
        where: { id: customer.id },
        data: afterFailedLogin(customer),
      });
      await this.recordFailedLogin(customer.id, 'bad_password', meta);
      throw new UnauthorizedException(LOGIN_FAILED_MESSAGE);
    }

    const token = await this.prisma.$transaction(async (tx) => {
      await tx.customer.update({
        where: { id: customer.id },
        data: afterSuccessfulLogin(),
      });
      await this.audit.record(
        {
          actorType: ActorType.CUSTOMER,
          customerId: customer.id,
          action: 'customer.login',
          meta,
        },
        tx,
      );
      return this.sessions.create(customer.id, tx);
    });

    return { token };
  }

  private recordFailedLogin(
    customerId: string | undefined,
    reason: string,
    meta: RequestMeta,
  ) {
    return this.audit.record({
      actorType: ActorType.PUBLIC,
      action: 'customer.login_failed',
      entityType: customerId ? 'Customer' : undefined,
      entityId: customerId,
      metadata: { reason },
      meta,
    });
  }

  async logout(token: string | undefined, meta: RequestMeta) {
    if (!token) return;
    const customer = await this.sessions.findCustomer(token);
    const revoked = await this.sessions.revoke(token);
    if (revoked && customer) {
      await this.audit.record({
        actorType: ActorType.CUSTOMER,
        customerId: customer.id,
        action: 'customer.logout',
        meta,
      });
    }
  }

  me(customer: SessionCustomer) {
    return {
      id: customer.id,
      firstName: customer.firstName,
      lastName: customer.lastName,
      email: customer.email,
      phone: customer.phone,
      emailVerified: customer.emailVerifiedAt !== null,
    };
  }

  // ---------- Password reset ----------

  async forgotPassword(rawEmail: string, meta: RequestMeta) {
    const email = normalizeEmail(rawEmail);
    const customer = await this.findByEmail(email);

    if (customer) {
      const token = await this.issueToken(
        customer.id,
        CustomerTokenType.PASSWORD_RESET,
      );
      await this.audit.record({
        actorType: ActorType.PUBLIC,
        action: 'customer.password_reset_requested',
        entityType: 'Customer',
        entityId: customer.id,
        meta,
      });
      await this.mailer.send(
        templates.resetPassword(email, this.link('/reset-password', token)),
      );
    }
    return { message: RESET_REQUESTED_MESSAGE };
  }

  async resetPassword(token: string, password: string, meta: RequestMeta) {
    const record = await this.findUsableToken(
      token,
      CustomerTokenType.PASSWORD_RESET,
    );
    const passwordHash = await hashPassword(password);

    await this.prisma.$transaction(async (tx) => {
      await claimToken(tx, record.id);
      // Any other outstanding reset links stop working too.
      await tx.customerToken.updateMany({
        where: {
          customerId: record.customerId,
          type: CustomerTokenType.PASSWORD_RESET,
          usedAt: null,
        },
        data: { usedAt: new Date() },
      });
      await tx.customer.update({
        where: { id: record.customerId },
        data: {
          passwordHash,
          failedLoginCount: 0,
          lockedUntil: null,
          // Following the emailed link proves they control the address.
          emailVerifiedAt: record.customer.emailVerifiedAt ?? new Date(),
        },
      });
      await this.sessions.revokeAll(record.customerId, tx);
      await this.audit.record(
        {
          actorType: ActorType.CUSTOMER,
          customerId: record.customerId,
          action: 'customer.password_reset',
          entityType: 'Customer',
          entityId: record.customerId,
          meta,
        },
        tx,
      );
    });

    await this.mailer.send(templates.passwordChanged(record.customer.email));
    return { message: 'Your password has been changed. Please sign in.' };
  }

  // ---------- Helpers ----------

  private findByEmail(email: string) {
    return this.prisma.customer.findFirst({
      where: {
        emailHash: this.blindIndex.hash('email', email),
        deletedAt: null,
      },
      select: { id: true, emailVerifiedAt: true },
    });
  }

  // Creates a one-time link token, cancelling any earlier unused ones of the
  // same type so only the newest link works.
  private async issueToken(
    customerId: string,
    type: CustomerTokenType,
    db: Db = this.prisma,
  ) {
    await db.customerToken.updateMany({
      where: { customerId, type, usedAt: null },
      data: { usedAt: new Date() },
    });
    const token = newToken();
    await db.customerToken.create({
      data: {
        customerId,
        type,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + TOKEN_TTL_MS[type]),
      },
    });
    return token;
  }

  private async findUsableToken(token: string, type: CustomerTokenType) {
    const record = await this.prisma.customerToken.findUnique({
      where: { tokenHash: hashToken(token) },
      include: {
        customer: {
          select: { email: true, emailVerifiedAt: true, deletedAt: true },
        },
      },
    });
    if (
      !record ||
      record.type !== type ||
      record.usedAt !== null ||
      record.expiresAt <= new Date() ||
      record.customer.deletedAt !== null
    ) {
      throw new BadRequestException(INVALID_LINK);
    }
    return record;
  }

  private siteUrl() {
    return this.config.get('SITE_URL', { infer: true });
  }

  private link(path: string, token: string) {
    return `${this.siteUrl()}${path}?token=${encodeURIComponent(token)}`;
  }
}

// Marks a token used only if it still isn't, so two simultaneous requests
// with the same link can't both succeed.
const claimToken = async (db: Db, id: string) => {
  const claimed = await db.customerToken.updateMany({
    where: { id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (claimed.count !== 1) throw new BadRequestException(INVALID_LINK);
};

const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === 'P2002';
