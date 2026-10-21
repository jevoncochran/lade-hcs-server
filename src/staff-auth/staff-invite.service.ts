import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditService } from '../audit/audit.service.js';
import { hashPassword } from '../auth/password.js';
import type { RequestMeta } from '../common/decorators/req-meta.decorator.js';
import { hashToken, newToken } from '../auth/tokens.js';
import type { Env } from '../config/env.validation.js';
import { ActorType, Prisma, StaffRole } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StaffSessionService } from './staff-session.service.js';
import { newTotpSecret, totpEnrollment, verifyTotp } from './totp.js';

export const INVITE_TTL_MS = 48 * 60 * 60 * 1000;

const INVALID_INVITE = 'This invite link is invalid or has expired.';

// Staff accounts are only ever created by accepting an invite, so each person
// sets their own password and MFA and nobody else ever knows them.
//
// Accepting, in the order the setup page shows it:
//   1. `startAcceptance` generates the MFA secret and QR code
//   2. `verifyCode` checks a code from the phone right away (codes only last
//      about 30 seconds) and records that the phone is set up
//   3. `completeAcceptance` sets name + password and creates the account,
//      once the phone is verified
@Injectable()
export class StaffInviteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: StaffSessionService,
    private readonly audit: AuditService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  // `invitedById` is null for the bootstrap script (src/cli/staff-invite.ts).
  async createInvite(
    rawEmail: string,
    role: StaffRole,
    invitedById: string | null,
    meta?: RequestMeta,
  ) {
    const email = rawEmail.trim().toLowerCase();

    const existing = await this.prisma.staffUser.findUnique({
      where: { email },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException(
        'A staff account with this email already exists.',
      );
    }

    const token = newToken();
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

    await this.prisma.$transaction(async (tx) => {
      // Only the newest invite for an email works.
      await tx.staffInvite.updateMany({
        where: { email, acceptedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      const invite = await tx.staffInvite.create({
        data: {
          email,
          role,
          tokenHash: hashToken(token),
          expiresAt,
          invitedById,
        },
        select: { id: true },
      });
      await this.audit.record(
        {
          actorType: invitedById ? ActorType.STAFF : ActorType.SYSTEM,
          staffUserId: invitedById ?? undefined,
          action: 'staff.invite_created',
          entityType: 'StaffInvite',
          entityId: invite.id,
          metadata: { role },
          meta,
        },
        tx,
      );
    });

    const siteUrl = this.config.get('SITE_URL', { infer: true });
    return {
      link: `${siteUrl}/admin/accept-invite?token=${encodeURIComponent(token)}`,
      expiresAt,
    };
  }

  // Step 1: a fresh MFA secret every time, in case a QR code was lost.
  async startAcceptance(token: string) {
    const invite = await this.findUsableInvite(token);
    const secret = newTotpSecret();

    // A new secret means any earlier verification no longer applies.
    await this.prisma.staffInvite.update({
      where: { id: invite.id },
      data: { mfaSecret: secret, mfaVerifiedAt: null, mfaLastTimeStep: null },
    });

    return {
      email: invite.email,
      role: invite.role,
      ...(await totpEnrollment(secret, invite.email)),
      secret, // for typing into the app when scanning isn't possible
    };
  }

  // Step 2: proves the phone has the secret.
  async verifyCode(token: string, mfaCode: string) {
    const invite = await this.findUsableInvite(token);
    if (!invite.mfaSecret) {
      throw new BadRequestException('Set up your authenticator app first.');
    }

    const timeStep = await verifyTotp(invite.mfaSecret, mfaCode);
    if (timeStep === null) {
      throw new BadRequestException(
        "That code didn't match. Check your authenticator app and try again.",
      );
    }

    await this.prisma.staffInvite.update({
      where: { id: invite.id },
      data: { mfaVerifiedAt: new Date(), mfaLastTimeStep: timeStep },
    });
    return { verified: true };
  }

  // Step 3: returns a session token; the new staff member is signed in.
  async completeAcceptance(
    token: string,
    name: string,
    password: string,
    meta: RequestMeta,
  ) {
    const invite = await this.findUsableInvite(token);
    if (!invite.mfaSecret || !invite.mfaVerifiedAt) {
      throw new BadRequestException('Confirm the code from your phone first.');
    }

    const passwordHash = await hashPassword(password);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const claimed = await tx.staffInvite.updateMany({
          where: { id: invite.id, acceptedAt: null, revokedAt: null },
          data: {
            acceptedAt: new Date(),
            mfaSecret: null,
            mfaVerifiedAt: null,
          },
        });
        if (claimed.count !== 1) throw new BadRequestException(INVALID_INVITE);

        const staff = await tx.staffUser.create({
          data: {
            email: invite.email,
            name,
            role: invite.role,
            passwordHash,
            mfaSecret: invite.mfaSecret,
            mfaLastTimeStep: invite.mfaLastTimeStep,
          },
          select: { id: true },
        });
        await this.audit.record(
          {
            actorType: ActorType.STAFF,
            staffUserId: staff.id,
            action: 'staff.invite_accepted',
            entityType: 'StaffInvite',
            entityId: invite.id,
            meta,
          },
          tx,
        );
        return { token: await this.sessions.create(staff.id, tx) };
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'A staff account with this email already exists.',
        );
      }
      throw error;
    }
  }

  private async findUsableInvite(token: string) {
    const invite = await this.prisma.staffInvite.findUnique({
      where: { tokenHash: hashToken(token) },
    });
    if (
      !invite ||
      invite.acceptedAt !== null ||
      invite.revokedAt !== null ||
      invite.expiresAt <= new Date()
    ) {
      throw new BadRequestException(INVALID_INVITE);
    }
    return invite;
  }
}
