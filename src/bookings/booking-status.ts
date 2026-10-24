import { ConflictException } from '@nestjs/common';
import type { AuditService } from '../audit/audit.service.js';
import type { RequestMeta } from '../common/decorators/req-meta.decorator.js';
import {
  BookingStatus,
  ChargeType,
  LegStatus,
  type ActorType,
  type Prisma,
} from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';

// Status changes shared by staff and customers (docs/plan.md → Status rules).

const MINUTE_MS = 60 * 1000;

// The encrypted client or a transaction on it.
type Db = Pick<
  PrismaService,
  'booking' | 'bookingEvent' | 'auditLog' | 'tripLeg' | 'bookingCharge'
>;

export type BookingActor = {
  actorType: ActorType;
  staffUserId?: string;
  customerId?: string;
};

// Cancelling a confirmed ride inside the window before pickup costs the
// late-cancellation fee. Unconfirmed requests can always be cancelled free:
// Lade hadn't committed to them yet.
export const lateCancelFee = (input: {
  status: BookingStatus;
  outboundPickupAt: Date;
  lateCancelFeeCents: number;
  windowMinutes: number;
  now: Date;
}): number | null => {
  if (input.status !== BookingStatus.CONFIRMED) return null;
  const windowStart =
    input.outboundPickupAt.getTime() - input.windowMinutes * MINUTE_MS;
  return input.now.getTime() >= windowStart ? input.lateCancelFeeCents : null;
};

// Changes the status only if nobody else changed it first (two people
// pressing buttons at once), then records history and the audit entry.
export const transitionBooking = async (
  db: Db,
  audit: AuditService,
  input: {
    booking: { id: string; status: BookingStatus };
    to: BookingStatus;
    actor: BookingActor;
    action: string; // audit action, e.g. "staff.booking_confirmed"
    meta?: RequestMeta;
    data?: Prisma.BookingUpdateManyMutationInput;
    note?: string; // encrypted, shown in the booking's history
    metadata?: Record<string, Prisma.InputJsonValue | null>;
  },
) => {
  const { booking, to, actor } = input;
  const { count } = await db.booking.updateMany({
    where: { id: booking.id, status: booking.status },
    data: { ...input.data, status: to },
  });
  if (count === 0) {
    throw new ConflictException(
      'Someone else just changed this booking. Reload to see the latest.',
    );
  }
  await db.bookingEvent.create({
    data: {
      bookingId: booking.id,
      fromStatus: booking.status,
      toStatus: to,
      actorType: actor.actorType,
      staffUserId: actor.staffUserId,
      note: input.note,
    },
  });
  // Status names and amounts only: reasons (PHI) stay in the encrypted
  // history note.
  await audit.record(
    {
      ...actor,
      action: input.action,
      entityType: 'Booking',
      entityId: booking.id,
      metadata: { from: booking.status, ...input.metadata },
      meta: input.meta,
    },
    db,
  );
};

// Cancels a booking inside a transaction: status, legs, and the
// late-cancellation fee (optionally waived by an admin). The caller then
// charges the booking, which also lets go of the card when nothing is owed.
export const cancelBooking = async (
  db: Db,
  audit: AuditService,
  input: {
    booking: { id: string; status: BookingStatus };
    actor: BookingActor;
    action: string;
    meta?: RequestMeta;
    reason?: string;
    feeCents: number | null;
    waiver?: { reason: string; staffUserId: string };
  },
) => {
  const { booking, feeCents } = input;
  const waived = feeCents !== null && input.waiver !== undefined;

  await transitionBooking(db, audit, {
    booking,
    to: BookingStatus.CANCELLED,
    actor: input.actor,
    action: input.action,
    meta: input.meta,
    data: { cancelledAt: new Date(), cancellationReason: input.reason ?? null },
    note: input.reason,
    metadata: { lateCancelFee: feeCents !== null, feeWaived: waived },
  });
  await db.tripLeg.updateMany({
    where: { bookingId: booking.id, status: LegStatus.SCHEDULED },
    data: { status: LegStatus.CANCELLED },
  });
  if (feeCents !== null) {
    await db.bookingCharge.create({
      data: {
        bookingId: booking.id,
        type: ChargeType.LATE_CANCELLATION,
        amountCents: feeCents,
        createdById: input.actor.staffUserId ?? null,
      },
    });
  }
  if (waived) {
    await db.bookingCharge.create({
      data: {
        bookingId: booking.id,
        type: ChargeType.ADJUSTMENT,
        amountCents: -feeCents,
        note: input.waiver!.reason,
        createdById: input.waiver!.staffUserId,
      },
    });
  }
};
