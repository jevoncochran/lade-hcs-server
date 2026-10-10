import { Injectable } from '@nestjs/common';
import type { RequestMeta } from '../auth/request-meta.js';
import type { ActorType, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

export type AuditEntry = {
  actorType: ActorType;
  staffUserId?: string;
  customerId?: string;
  action: string; // e.g. "customer.login", "staff.invite_created"
  entityType?: string;
  entityId?: string;
  // Never PHI: no emails, names, phones, addresses or notes. Use ids and
  // short machine-readable reasons ("bad_password", "locked").
  metadata?: Prisma.InputJsonValue;
  meta?: RequestMeta;
};

// HIPAA audit trail. Writes are awaited and errors propagate (fail closed):
// an action that can't be audited shouldn't silently succeed.
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  // Pass `db` to write inside an interactive transaction.
  async record(
    entry: AuditEntry,
    db: Pick<PrismaService, 'auditLog'> = this.prisma,
  ) {
    const { meta, ...rest } = entry;
    await db.auditLog.create({
      data: { ...rest, ipAddress: meta?.ipAddress, userAgent: meta?.userAgent },
    });
  }
}
