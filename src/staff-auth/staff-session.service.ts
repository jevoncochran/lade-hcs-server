import { Injectable } from '@nestjs/common';
import {
  isSessionActive,
  SESSION_TOUCH_INTERVAL_MS,
} from '../auth/session-cookie.js';
import { hashToken, newToken } from '../auth/tokens.js';
import type { StaffRole } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

// HIPAA automatic logoff: staff are signed out after 15 minutes without
// activity, and after 12 hours (one shift) regardless.
export const STAFF_IDLE_MS = 15 * 60 * 1000;
export const STAFF_ABSOLUTE_MS = 12 * 60 * 60 * 1000;

export type SessionStaff = {
  id: string;
  email: string;
  name: string;
  role: StaffRole;
};

type Db = Pick<PrismaService, 'staffSession'>;

@Injectable()
export class StaffSessionService {
  constructor(private readonly prisma: PrismaService) {}

  async create(staffUserId: string, db: Db = this.prisma) {
    const token = newToken();
    await db.staffSession.create({
      data: {
        staffUserId,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + STAFF_ABSOLUTE_MS),
      },
    });
    return token;
  }

  async findStaff(token: string): Promise<SessionStaff | null> {
    const session = await this.prisma.staffSession.findUnique({
      where: { tokenHash: hashToken(token) },
      include: {
        staffUser: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            isActive: true,
          },
        },
      },
    });
    if (
      !session ||
      !session.staffUser.isActive ||
      !isSessionActive(session, STAFF_IDLE_MS)
    ) {
      return null;
    }

    if (Date.now() - session.lastSeenAt.getTime() > SESSION_TOUCH_INTERVAL_MS) {
      await this.prisma.staffSession.update({
        where: { id: session.id },
        data: { lastSeenAt: new Date() },
      });
    }

    const { isActive: _isActive, ...staff } = session.staffUser;
    return staff;
  }

  async revoke(token: string) {
    const result = await this.prisma.staffSession.updateMany({
      where: { tokenHash: hashToken(token), revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return result.count > 0;
  }
}
