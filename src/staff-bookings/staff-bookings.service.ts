import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditService } from '../audit/audit.service.js';
import type { RequestMeta } from '../common/decorators/req-meta.decorator.js';
import { addDays, dateIn, startOfDay } from '../common/zoned-date.js';
import type { Env } from '../config/env.validation.js';
import { BlindIndex } from '../crypto/blind-index.js';
import {
  ActorType,
  BookingStatus,
  LegDirection,
  type Prisma,
} from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { SessionStaff } from '../staff-auth/staff-session.service.js';
import { staffActions } from './booking-actions.js';
import type { ListStaffBookingsDto } from './dto/list-staff-bookings.dto.js';
import {
  toStaffBookingSummary,
  toStaffBookingView,
} from './staff-booking-view.js';

// Checkouts where the card was never saved aren't real bookings yet; staff
// only see them when they ask for that status.
const DEFAULT_STATUSES = Object.values(BookingStatus).filter(
  (status) => status !== BookingStatus.PENDING_PAYMENT,
);

const latestPayment = {
  orderBy: { createdAt: 'desc' },
  take: 1,
} satisfies Prisma.Booking$paymentsArgs;

// Every staff member (dispatchers and admins) can see every booking. Each
// look is written to the audit log: HIPAA requires a record of who viewed
// patient information.
@Injectable()
export class StaffBookingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly blindIndex: BlindIndex,
    private readonly audit: AuditService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async list(
    staff: SessionStaff,
    query: ListStaffBookingsDto,
    meta: RequestMeta,
  ) {
    const timeZone = this.config.get('BUSINESS_TIMEZONE', { infer: true });
    const searching = Boolean(query.reference || query.riderLastName);
    // With no dates and no search: today onward (the dispatch view).
    const from =
      query.from ??
      (searching || query.to ? undefined : dateIn(new Date(), timeZone));

    // Bookings are listed by their outbound leg: every booking has exactly
    // one, and it carries the pickup time used for dates and sorting.
    const where: Prisma.TripLegWhereInput = {
      direction: LegDirection.OUTBOUND,
      pickupAt: {
        gte: from ? startOfDay(from, timeZone) : undefined,
        lt: query.to ? startOfDay(addDays(query.to, 1), timeZone) : undefined,
      },
      booking: {
        deletedAt: null,
        status: { in: query.status ?? DEFAULT_STATUSES },
        reference: query.reference,
        riderLastNameHash: query.riderLastName
          ? this.blindIndex.hash('name', query.riderLastName)
          : undefined,
      },
    };

    const [total, legs] = await Promise.all([
      this.prisma.tripLeg.count({ where }),
      this.prisma.tripLeg.findMany({
        where,
        orderBy:
          query.sort === 'newest'
            ? [{ booking: { createdAt: 'desc' } }]
            : [{ pickupAt: 'asc' }, { booking: { createdAt: 'asc' } }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          booking: { include: { legs: true, payments: latestPayment } },
        },
      }),
    ]);

    // No PHI in the audit log: the last name searched for is left out.
    await this.audit.record({
      actorType: ActorType.STAFF,
      staffUserId: staff.id,
      action: 'staff.bookings_listed',
      entityType: 'Booking',
      metadata: {
        bookingIds: legs.map((leg) => leg.bookingId),
        statuses: query.status ?? null,
        from: from ?? null,
        to: query.to ?? null,
        byReference: Boolean(query.reference),
        byRiderLastName: Boolean(query.riderLastName),
      },
      meta,
    });

    return {
      bookings: legs.map((leg) => toStaffBookingSummary(leg.booking)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  // One booking for staff, with the actions allowed right now. No audit
  // entry: callers record why they loaded it.
  async detail(id: string, now = new Date()) {
    const booking = await this.prisma.booking.findFirst({
      where: { id, deletedAt: null },
      include: {
        legs: true,
        payments: latestPayment,
        pricingRule: true,
        events: {
          orderBy: { createdAt: 'asc' },
          include: { staffUser: { select: { name: true } } },
        },
        charges: {
          orderBy: { createdAt: 'asc' },
          include: {
            leg: { select: { direction: true } },
            createdBy: { select: { name: true } },
          },
        },
      },
    });
    if (!booking) throw new NotFoundException('Booking not found.');

    const outbound = booking.legs.find(
      (leg) => leg.direction === LegDirection.OUTBOUND,
    )!;
    const actions = staffActions({
      status: booking.status,
      outboundPickupAt: outbound.pickupAt!,
      paymentStatus: booking.payments[0]?.status ?? null,
      rule: booking.pricingRule,
      lateCancelWindowMinutes: this.config.get('LATE_CANCEL_WINDOW_MINUTES', {
        infer: true,
      }),
      now,
    });
    return toStaffBookingView(booking, actions);
  }

  async get(staff: SessionStaff, id: string, meta: RequestMeta) {
    const view = await this.detail(id);
    await this.audit.record({
      actorType: ActorType.STAFF,
      staffUserId: staff.id,
      action: 'staff.booking_viewed',
      entityType: 'Booking',
      entityId: view.id,
      meta,
    });
    return view;
  }
}
