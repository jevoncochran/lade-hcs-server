import { createHash } from 'node:crypto';
import type { Prisma } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';

// A short fingerprint of the bookings matching `where`, for pages that
// update themselves: they ask for it every few seconds and reload only when
// it changes. Built from counts and last-change times of everything a
// booking page shows (status, legs, payment, charges, history), so it
// carries no patient information and needs no audit entry.
export const bookingsVersion = async (
  prisma: Pick<
    PrismaService,
    'booking' | 'tripLeg' | 'payment' | 'bookingCharge' | 'bookingEvent'
  >,
  where: Prisma.BookingWhereInput,
) => {
  const [bookings, legs, payments, charges, events] = await Promise.all([
    prisma.booking.aggregate({
      where,
      _count: true,
      _max: { updatedAt: true },
    }),
    prisma.tripLeg.aggregate({
      where: { booking: where },
      _max: { updatedAt: true },
    }),
    prisma.payment.aggregate({
      where: { booking: where },
      _max: { updatedAt: true },
    }),
    prisma.bookingCharge.count({ where: { booking: where } }),
    prisma.bookingEvent.count({ where: { booking: where } }),
  ]);

  const parts = [
    bookings._count,
    bookings._max.updatedAt?.getTime(),
    legs._max.updatedAt?.getTime(),
    payments._max.updatedAt?.getTime(),
    charges,
    events,
  ].join('|');
  return {
    version: createHash('sha256')
      .update(parts)
      .digest('base64url')
      .slice(0, 16),
  };
};
