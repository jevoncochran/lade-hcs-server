import { Injectable } from '@nestjs/common';
import {
  isSessionActive,
  SESSION_TOUCH_INTERVAL_MS,
} from '../auth/session-cookie.js';
import { hashToken, newToken } from '../auth/tokens.js';
import { PrismaService } from '../prisma/prisma.service.js';

// Customers stay signed in while they keep using the site: a session ends
// after 7 days without activity, and after 30 days regardless.
export const CUSTOMER_IDLE_MS = 7 * 24 * 60 * 60 * 1000;
export const CUSTOMER_ABSOLUTE_MS = 30 * 24 * 60 * 60 * 1000;

export type SessionCustomer = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  emailVerifiedAt: Date | null;
};

type Db = Pick<PrismaService, 'customerSession'>;

@Injectable()
export class CustomerSessionService {
  constructor(private readonly prisma: PrismaService) {}

  // Returns the raw token for the cookie; only its hash is stored.
  async create(customerId: string, db: Db = this.prisma) {
    const token = newToken();
    await db.customerSession.create({
      data: {
        customerId,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + CUSTOMER_ABSOLUTE_MS),
      },
    });
    return token;
  }

  // touch: false for automatic background checks, which mustn't count as
  // activity (see BackgroundCheck).
  async findCustomer(
    token: string,
    { touch = true }: { touch?: boolean } = {},
  ): Promise<SessionCustomer | null> {
    const session = await this.prisma.customerSession.findUnique({
      where: { tokenHash: hashToken(token) },
      include: {
        customer: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            phone: true,
            emailVerifiedAt: true,
            deletedAt: true,
          },
        },
      },
    });
    if (
      !session ||
      session.customer.deletedAt !== null ||
      !isSessionActive(session, CUSTOMER_IDLE_MS)
    ) {
      return null;
    }

    if (
      touch &&
      Date.now() - session.lastSeenAt.getTime() > SESSION_TOUCH_INTERVAL_MS
    ) {
      await this.prisma.customerSession.update({
        where: { id: session.id },
        data: { lastSeenAt: new Date() },
      });
    }

    const { deletedAt: _deletedAt, ...customer } = session.customer;
    return customer;
  }

  async revoke(token: string) {
    const result = await this.prisma.customerSession.updateMany({
      where: { tokenHash: hashToken(token), revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return result.count > 0;
  }

  async revokeAll(customerId: string, db: Db = this.prisma) {
    await db.customerSession.updateMany({
      where: { customerId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
