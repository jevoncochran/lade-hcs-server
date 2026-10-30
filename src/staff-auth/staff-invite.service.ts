import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
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

export const INVITE_TTL_MS = 48 * 60 * 60 * 1000;

const INVALID_INVITE = 'This invite link is invalid or has expired.';

// Staff accounts are only ever created by accepting an invite, so each person
// sets their own password and nobody else ever knows it.
//
// Accepting, in the order the setup page shows it:
//   1. `startAcceptance` checks the link and returns who it's for
//   2. `completeAcceptance` sets name + password and creates the account
//
// A sign-in reset (forgotten password) is an invite tied to an existing
// account (`resetForId`): the same steps replace that account's password and
// sign it out everywhere.
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

    return { link: this.inviteLink(token), expiresAt };
  }

  // `reset=1` only changes the setup page's wording ("Reset your sign-in");
  // the token alone decides what the link can do.
  private inviteLink(token: string, kind: 'invite' | 'reset' = 'invite') {
    const siteUrl = this.config.get('SITE_URL', { infer: true });
    const link = `${siteUrl}/admin/accept-invite?token=${encodeURIComponent(token)}`;
    return kind === 'reset' ? `${link}&reset=1` : link;
  }

  // An admin resetting someone's sign-in. Only the newest reset link for an
  // account works.
  async createReset(staffUserId: string, adminId: string, meta?: RequestMeta) {
    const staff = await this.prisma.staffUser.findUnique({
      where: { id: staffUserId },
      select: { id: true, email: true, role: true },
    });
    if (!staff) throw new NotFoundException('Staff member not found.');

    const token = newToken();
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
    await this.prisma.$transaction(async (tx) => {
      await tx.staffInvite.updateMany({
        where: { resetForId: staff.id, acceptedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      const reset = await tx.staffInvite.create({
        data: {
          email: staff.email,
          role: staff.role,
          tokenHash: hashToken(token),
          expiresAt,
          invitedById: adminId,
          resetForId: staff.id,
        },
        select: { id: true },
      });
      await this.audit.record(
        {
          actorType: ActorType.STAFF,
          staffUserId: adminId,
          action: 'staff.sign_in_reset_created',
          entityType: 'StaffUser',
          entityId: staff.id,
          metadata: { resetId: reset.id },
          meta,
        },
        tx,
      );
    });

    return {
      link: this.inviteLink(token, 'reset'),
      expiresAt,
      email: staff.email,
    };
  }

  // Step 1: who the link is for, so the page can greet them.
  async startAcceptance(token: string) {
    const invite = await this.findUsableInvite(token);

    // A reset keeps the account's name (it can still be changed).
    const existing = invite.resetForId
      ? await this.prisma.staffUser.findUnique({
          where: { id: invite.resetForId },
          select: { name: true },
        })
      : null;

    return {
      kind: invite.resetForId ? ('reset' as const) : ('invite' as const),
      name: existing?.name ?? null,
      email: invite.email,
      role: invite.role,
    };
  }

  // Step 2: returns a session token; the new staff member is signed in.
  async completeAcceptance(
    token: string,
    name: string | undefined,
    password: string,
    meta: RequestMeta,
  ) {
    const invite = await this.findUsableInvite(token);
    if (!invite.resetForId && !name) {
      throw new BadRequestException('Enter your name.');
    }

    const passwordHash = await hashPassword(password);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const claimed = await tx.staffInvite.updateMany({
          where: { id: invite.id, acceptedAt: null, revokedAt: null },
          data: { acceptedAt: new Date() },
        });
        if (claimed.count !== 1) throw new BadRequestException(INVALID_INVITE);

        if (invite.resetForId) {
          // Reset: new password, any lockout cleared, and every existing
          // session ended.
          const reset = await tx.staffUser.updateMany({
            where: { id: invite.resetForId, isActive: true },
            data: {
              ...(name ? { name } : {}), // a reset keeps the name otherwise
              passwordHash,
              failedLoginCount: 0,
              lockedUntil: null,
              lastLoginAt: new Date(), // finishing signs them in
            },
          });
          if (reset.count !== 1) throw new BadRequestException(INVALID_INVITE);
          await tx.staffSession.updateMany({
            where: { staffUserId: invite.resetForId, revokedAt: null },
            data: { revokedAt: new Date() },
          });
          await this.audit.record(
            {
              actorType: ActorType.STAFF,
              staffUserId: invite.resetForId,
              action: 'staff.sign_in_reset_completed',
              entityType: 'StaffUser',
              entityId: invite.resetForId,
              meta,
            },
            tx,
          );
          return {
            token: await this.sessions.create(invite.resetForId, tx),
          };
        }

        const staff = await tx.staffUser.create({
          data: {
            email: invite.email,
            name: name!, // checked above: required for a new account
            role: invite.role,
            passwordHash,
            lastLoginAt: new Date(), // finishing signs them in
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
