import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditService } from '../audit/audit.service.js';
import type { RequestMeta } from '../common/decorators/req-meta.decorator.js';
import type { Env } from '../config/env.validation.js';
import { ActorType, Prisma, StaffRole } from '../generated/prisma/client.js';
import { Mailer, type MailMessage } from '../mail/mailer.js';
import * as templates from '../mail/templates.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StaffInviteService } from '../staff-auth/staff-invite.service.js';
import type { SessionStaff } from '../staff-auth/staff-session.service.js';

// The client inside a transaction.
type Tx = Parameters<Parameters<PrismaService['$transaction']>[0]>[0];

const ROLE_NAME: Record<StaffRole, string> = {
  ADMIN: 'an administrator',
  DISPATCHER: 'a dispatcher',
};

// Admins managing staff accounts: invites, roles, deactivation and sign-in
// resets. Nobody can lock Lade out: an admin can't change, deactivate or
// reset their own account, and there is always at least one active admin.
// Staff details aren't patient information, but every change is audited.
@Injectable()
export class StaffMembersService {
  private readonly logger = new Logger(StaffMembersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly invites: StaffInviteService,
    private readonly audit: AuditService,
    private readonly mailer: Mailer,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async overview() {
    const [members, pending] = await Promise.all([
      this.prisma.staffUser.findMany({
        orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          isActive: true,
          lastLoginAt: true,
          lockedUntil: true,
          createdAt: true,
        },
      }),
      this.prisma.staffInvite.findMany({
        where: {
          acceptedAt: null,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          email: true,
          role: true,
          resetForId: true,
          expiresAt: true,
          createdAt: true,
          invitedBy: { select: { name: true } },
        },
      }),
    ]);
    const now = new Date();

    return {
      members: members.map(({ lockedUntil, ...member }) => ({
        ...member,
        locked: lockedUntil !== null && lockedUntil > now,
        pendingReset: pending.some((p) => p.resetForId === member.id),
      })),
      invites: pending.map(({ resetForId, invitedBy, ...invite }) => ({
        ...invite,
        kind: resetForId ? ('reset' as const) : ('invite' as const),
        invitedBy: invitedBy?.name ?? null,
      })),
    };
  }

  async invite(
    admin: SessionStaff,
    email: string,
    role: StaffRole,
    meta: RequestMeta,
  ) {
    const { link, expiresAt } = await this.invites.createInvite(
      email,
      role,
      admin.id,
      meta,
    );
    const emailed = await this.trySend(
      templates.staffInvite(
        email.trim().toLowerCase(),
        ROLE_NAME[role],
        link,
        this.when(expiresAt),
      ),
    );
    return { link, expiresAt, emailed, ...(await this.overview()) };
  }

  async revokeInvite(admin: SessionStaff, id: string, meta: RequestMeta) {
    const { count } = await this.prisma.staffInvite.updateMany({
      where: { id, acceptedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (count === 0) {
      throw new NotFoundException('That invite was already used or cancelled.');
    }
    await this.record(admin, 'staff.invite_revoked', 'StaffInvite', id, meta);
    return this.overview();
  }

  async changeRole(
    admin: SessionStaff,
    id: string,
    role: StaffRole,
    meta: RequestMeta,
  ) {
    await this.serializable(async (tx) => {
      const member = await this.findOther(
        tx,
        admin,
        id,
        'change your own role',
      );
      if (member.role === role) return;
      if (member.role === StaffRole.ADMIN) await this.keepAnAdmin(tx, id);
      await tx.staffUser.update({ where: { id }, data: { role } });
      await this.record(
        admin,
        'staff.role_changed',
        'StaffUser',
        id,
        meta,
        {
          from: member.role,
          to: role,
        },
        tx,
      );
    });
    return this.overview();
  }

  async setActive(
    admin: SessionStaff,
    id: string,
    isActive: boolean,
    meta: RequestMeta,
  ) {
    await this.serializable(async (tx) => {
      const member = await this.findOther(
        tx,
        admin,
        id,
        isActive ? 'reactivate yourself' : 'deactivate yourself',
      );
      if (member.isActive === isActive) return;
      if (!isActive && member.role === StaffRole.ADMIN) {
        await this.keepAnAdmin(tx, id);
      }
      await tx.staffUser.update({ where: { id }, data: { isActive } });
      if (!isActive) {
        // Signed out everywhere, right away.
        await tx.staffSession.updateMany({
          where: { staffUserId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        // Their pending sign-in reset can't be used either.
        await tx.staffInvite.updateMany({
          where: { resetForId: id, acceptedAt: null, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      await this.record(
        admin,
        isActive ? 'staff.reactivated' : 'staff.deactivated',
        'StaffUser',
        id,
        meta,
        undefined,
        tx,
      );
    });
    return this.overview();
  }

  async resetSignIn(admin: SessionStaff, id: string, meta: RequestMeta) {
    const member = await this.findOther(
      this.prisma,
      admin,
      id,
      'reset your own sign-in',
    );
    if (!member.isActive) {
      throw new ConflictException('Reactivate this account first.');
    }
    const { link, expiresAt, email } = await this.invites.createReset(
      id,
      admin.id,
      meta,
    );
    const emailed = await this.trySend(
      templates.staffSignInReset(email, link, this.when(expiresAt)),
    );
    return { link, expiresAt, emailed, ...(await this.overview()) };
  }

  // ---------- Helpers ----------

  private async findOther(
    db: Pick<PrismaService, 'staffUser'>,
    admin: SessionStaff,
    id: string,
    whatSelf: string,
  ) {
    if (id === admin.id) {
      throw new BadRequestException(
        `You can't ${whatSelf}. Ask another administrator.`,
      );
    }
    const member = await db.staffUser.findUnique({
      where: { id },
      select: { id: true, role: true, isActive: true },
    });
    if (!member) throw new NotFoundException('Staff member not found.');
    return member;
  }

  // Role and activation changes run serializable: two admins demoting each
  // other at the same moment would otherwise each still see the other as an
  // admin, and both succeed. Postgres refuses the second instead.
  private async serializable<T>(work: (tx: Tx) => Promise<T>) {
    try {
      return await this.prisma.$transaction(work, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2034'
      ) {
        throw new ConflictException(
          'Someone else changed staff accounts at the same time. Reload and try again.',
        );
      }
      throw error;
    }
  }

  // Refuses a change that would leave no active administrator.
  private async keepAnAdmin(db: Pick<PrismaService, 'staffUser'>, id: string) {
    const others = await db.staffUser.count({
      where: { role: StaffRole.ADMIN, isActive: true, id: { not: id } },
    });
    if (others === 0) {
      throw new ConflictException(
        'Lade needs at least one active administrator.',
      );
    }
  }

  private record(
    admin: SessionStaff,
    action: string,
    entityType: string,
    entityId: string,
    meta: RequestMeta,
    metadata?: Record<string, string>,
    db?: Pick<PrismaService, 'auditLog'>,
  ) {
    return this.audit.record(
      {
        actorType: ActorType.STAFF,
        staffUserId: admin.id,
        action,
        entityType,
        entityId,
        metadata,
        meta,
      },
      db,
    );
  }

  // The link is also shown to the admin, so a failed email isn't fatal.
  private async trySend(message: MailMessage) {
    try {
      await this.mailer.send(message);
      return true;
    } catch {
      this.logger.warn(`Staff email "${message.subject}" wasn't sent`);
      return false;
    }
  }

  private when(date: Date) {
    return date.toLocaleString('en-US', {
      timeZone: this.config.get('BUSINESS_TIMEZONE', { infer: true }),
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  }
}
