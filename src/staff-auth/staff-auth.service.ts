import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import {
  afterFailedLogin,
  afterSuccessfulLogin,
  isLocked,
} from '../auth/lockout.js';
import { burnPasswordCheck, verifyPassword } from '../auth/password.js';
import type { RequestMeta } from '../common/decorators/req-meta.decorator.js';
import { ActorType } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  StaffSessionService,
  type SessionStaff,
} from './staff-session.service.js';
import { verifyTotp } from './totp.js';

// One message for every failure (unknown email, wrong password, wrong code,
// locked), so the response never reveals which part was right.
export const STAFF_LOGIN_FAILED_MESSAGE =
  'Incorrect email, password or code. After 5 failed attempts, sign-in is paused for 15 minutes.';

@Injectable()
export class StaffAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: StaffSessionService,
    private readonly audit: AuditService,
  ) {}

  async login(
    rawEmail: string,
    password: string,
    mfaCode: string,
    meta: RequestMeta,
  ) {
    const staff = await this.prisma.staffUser.findUnique({
      where: { email: rawEmail.trim().toLowerCase() },
      select: {
        id: true,
        isActive: true,
        passwordHash: true,
        mfaSecret: true,
        mfaLastTimeStep: true,
        failedLoginCount: true,
        lockedUntil: true,
      },
    });

    if (!staff || !staff.isActive) {
      await burnPasswordCheck(password);
      await this.recordFailedLogin(staff?.id, 'unknown_or_inactive', meta);
      throw new UnauthorizedException(STAFF_LOGIN_FAILED_MESSAGE);
    }

    const passwordOk = await verifyPassword(staff.passwordHash, password);
    const timeStep =
      passwordOk && staff.mfaSecret
        ? await verifyTotp(staff.mfaSecret, mfaCode, staff.mfaLastTimeStep)
        : null;

    if (isLocked(staff)) {
      await this.recordFailedLogin(staff.id, 'locked', meta);
      throw new UnauthorizedException(STAFF_LOGIN_FAILED_MESSAGE);
    }

    if (!passwordOk || timeStep === null) {
      await this.prisma.staffUser.update({
        where: { id: staff.id },
        data: afterFailedLogin(staff),
      });
      await this.recordFailedLogin(
        staff.id,
        passwordOk ? 'bad_mfa_code' : 'bad_password',
        meta,
      );
      throw new UnauthorizedException(STAFF_LOGIN_FAILED_MESSAGE);
    }

    const token = await this.prisma.$transaction(async (tx) => {
      await tx.staffUser.update({
        where: { id: staff.id },
        data: { ...afterSuccessfulLogin(), mfaLastTimeStep: timeStep },
      });
      await this.audit.record(
        {
          actorType: ActorType.STAFF,
          staffUserId: staff.id,
          action: 'staff.login',
          meta,
        },
        tx,
      );
      return this.sessions.create(staff.id, tx);
    });

    return { token };
  }

  private recordFailedLogin(
    staffUserId: string | undefined,
    reason: string,
    meta: RequestMeta,
  ) {
    return this.audit.record({
      actorType: ActorType.PUBLIC,
      action: 'staff.login_failed',
      entityType: staffUserId ? 'StaffUser' : undefined,
      entityId: staffUserId,
      metadata: { reason },
      meta,
    });
  }

  async logout(token: string | undefined, meta: RequestMeta) {
    if (!token) return;
    const staff = await this.sessions.findStaff(token);
    const revoked = await this.sessions.revoke(token);
    if (revoked && staff) {
      await this.audit.record({
        actorType: ActorType.STAFF,
        staffUserId: staff.id,
        action: 'staff.logout',
        meta,
      });
    }
  }

  me(staff: SessionStaff) {
    return {
      id: staff.id,
      email: staff.email,
      name: staff.name,
      role: staff.role,
    };
  }
}
