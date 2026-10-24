import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditService } from '../audit/audit.service.js';
import type { RequestMeta } from '../common/decorators/req-meta.decorator.js';
import type { Env } from '../config/env.validation.js';
import {
  ActorType,
  BookingStatus,
  ChargeType,
  LegDirection,
  LegStatus,
  type Prisma,
} from '../generated/prisma/client.js';
import {
  BookingNotificationsService,
  type StaffAction,
} from '../notifications/booking-notifications.service.js';
import {
  cancelBooking,
  transitionBooking,
} from '../bookings/booking-status.js';
import { BookingPaymentsService } from '../payments/booking-payments.service.js';
import { completedRideCharges, type RiddenLeg } from '../pricing/pricing.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { SessionStaff } from '../staff-auth/staff-session.service.js';
import { staffActions } from './booking-actions.js';
import type { CancelBookingDto } from './dto/cancel-booking.dto.js';
import type { CompleteBookingDto } from './dto/complete-booking.dto.js';
import { StaffBookingsService } from './staff-bookings.service.js';

// The encrypted client or a transaction on it.
type Db = Pick<
  PrismaService,
  'booking' | 'bookingEvent' | 'auditLog' | 'tripLeg' | 'bookingCharge'
>;

const loadInclude = {
  legs: true,
  pricingRule: true,
  payments: { orderBy: { createdAt: 'desc' }, take: 1 },
} satisfies Prisma.BookingInclude;

type Loaded = Prisma.BookingGetPayload<{ include: typeof loadInclude }>;

// Staff changing a booking's status (docs/plan.md → Status rules). Each
// action checks the rules, changes the booking in one transaction (status,
// legs, charge lines, history, audit), then charges the saved card for what
// the booking now owes. Every action returns the updated booking.
@Injectable()
export class StaffBookingActionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly payments: BookingPaymentsService,
    private readonly notifications: BookingNotificationsService,
    private readonly bookings: StaffBookingsService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async confirm(staff: SessionStaff, id: string, meta: RequestMeta) {
    await this.prisma.$transaction(async (tx) => {
      const { booking, actions } = await this.load(tx, id);
      if (!actions.confirm) throw notNow(booking.status, 'confirmed');
      await this.transition(tx, booking, BookingStatus.CONFIRMED, staff, meta);
    });
    return this.finish(id, 'confirmed');
  }

  async cancel(
    staff: SessionStaff,
    id: string,
    dto: CancelBookingDto,
    meta: RequestMeta,
  ) {
    if (dto.waiveFee && staff.role !== 'ADMIN') {
      throw new ForbiddenException('Only an administrator can waive a fee.');
    }

    await this.prisma.$transaction(async (tx) => {
      const { booking, actions } = await this.load(tx, id);
      if (!actions.cancel.allowed) throw notNow(booking.status, 'cancelled');
      await cancelBooking(tx, this.audit, {
        booking,
        actor: actorOf(staff),
        action: 'staff.booking_cancelled',
        meta,
        reason: dto.reason,
        feeCents: actions.cancel.feeCents,
        waiver: dto.waiveFee
          ? { reason: dto.waiveReason!, staffUserId: staff.id }
          : undefined,
      });
    });

    // The fee, if any; otherwise this lets go of the saved card.
    await this.payments.chargeBooking(id, actorOf(staff), meta);
    return this.finish(id, 'cancelled');
  }

  async noShow(staff: SessionStaff, id: string, meta: RequestMeta) {
    await this.prisma.$transaction(async (tx) => {
      const { booking, actions } = await this.load(tx, id);
      if (booking.status !== BookingStatus.CONFIRMED) {
        throw notNow(booking.status, 'marked as a no-show');
      }
      if (!actions.noShow.allowed) {
        throw new ConflictException(
          `A no-show can only be marked ${booking.pricingRule.waitGraceMinutes} minutes after the pickup time.`,
        );
      }
      const outbound = legOf(booking, LegDirection.OUTBOUND)!;

      await this.transition(tx, booking, BookingStatus.NO_SHOW, staff, meta);
      await tx.tripLeg.update({
        where: { id: outbound.id },
        data: { status: LegStatus.NO_SHOW },
      });
      // The ride back is cancelled free.
      await tx.tripLeg.updateMany({
        where: { bookingId: id, status: LegStatus.SCHEDULED },
        data: { status: LegStatus.CANCELLED },
      });
      await tx.bookingCharge.create({
        data: {
          bookingId: id,
          legId: outbound.id,
          type: ChargeType.NO_SHOW,
          amountCents: actions.noShow.feeCents,
          createdById: staff.id,
        },
      });
    });

    await this.payments.chargeBooking(id, actorOf(staff), meta);
    return this.finish(id, 'no_show');
  }

  async complete(
    staff: SessionStaff,
    id: string,
    dto: CompleteBookingDto,
    meta: RequestMeta,
  ) {
    await this.prisma.$transaction(async (tx) => {
      const { booking, actions } = await this.load(tx, id);
      if (booking.status !== BookingStatus.CONFIRMED) {
        throw notNow(booking.status, 'completed');
      }
      if (!actions.complete.allowed) {
        throw new ConflictException(
          'A ride can only be completed once its pickup time has come.',
        );
      }

      const outbound = legOf(booking, LegDirection.OUTBOUND)!;
      const ret = legOf(booking, LegDirection.RETURN);
      if (ret && !dto.returnLeg) {
        throw new BadRequestException('Say whether the ride back happened.');
      }
      if (!ret && (dto.returnLeg || dto.returnWaitMinutes !== undefined)) {
        throw new BadRequestException('This booking has no ride back.');
      }
      const returnRidden = dto.returnLeg === 'COMPLETED';

      await tx.tripLeg.update({
        where: { id: outbound.id },
        data: {
          status: LegStatus.COMPLETED,
          waitedMinutes: dto.outboundWaitMinutes ?? null,
        },
      });
      if (ret) {
        await tx.tripLeg.update({
          where: { id: ret.id },
          data: returnRidden
            ? {
                status: LegStatus.COMPLETED,
                waitedMinutes: dto.returnWaitMinutes ?? null,
              }
            : { status: LegStatus.CANCELLED, waitedMinutes: null },
        });
      }

      const ridden: RiddenLeg[] = [
        {
          legId: outbound.id,
          label: 'ride there',
          distanceMeters: outbound.distanceMeters,
          waitedMinutes: dto.outboundWaitMinutes ?? null,
        },
      ];
      if (ret && returnRidden) {
        ridden.push({
          legId: ret.id,
          label: 'ride back',
          distanceMeters: ret.distanceMeters,
          waitedMinutes: dto.returnWaitMinutes ?? null,
        });
      }
      const lines = completedRideCharges(
        booking.tripKind,
        ridden,
        booking.pricingRule,
      );
      await tx.bookingCharge.createMany({
        data: lines.map((line) => ({
          bookingId: id,
          legId: line.legId ?? null,
          type: line.type,
          amountCents: line.amountCents,
          quantity: line.quantity ?? null,
          createdById: staff.id,
        })),
      });

      await this.transition(tx, booking, BookingStatus.COMPLETED, staff, meta, {
        metadata: {
          totalCents: lines.reduce((sum, line) => sum + line.amountCents, 0),
          returnLeg: dto.returnLeg ?? null,
        },
      });
    });

    await this.payments.chargeBooking(id, actorOf(staff), meta);
    return this.finish(id, 'completed');
  }

  // After a declined charge (e.g. the customer added funds) or one that got
  // no answer. Never charges twice: see BookingPaymentsService.
  async retryCharge(staff: SessionStaff, id: string, meta: RequestMeta) {
    const { actions } = await this.load(this.prisma, id);
    if (!actions.retryCharge) {
      throw new ConflictException('There is no failed charge to retry.');
    }
    await this.audit.record({
      actorType: ActorType.STAFF,
      staffUserId: staff.id,
      action: 'staff.charge_retried',
      entityType: 'Booking',
      entityId: id,
      meta,
    });
    await this.payments.chargeBooking(id, actorOf(staff), meta);
    return this.finish(id, 'charge_retried');
  }

  // Emails the customer about what happened, then returns the booking.
  private async finish(id: string, action: StaffAction) {
    await this.notifications.afterStaffAction(id, action);
    return this.bookings.detail(id);
  }

  private async load(db: Db, id: string) {
    const booking = await db.booking.findFirst({
      where: { id, deletedAt: null },
      include: loadInclude,
    });
    if (!booking) throw new NotFoundException('Booking not found.');

    const actions = staffActions({
      status: booking.status,
      outboundPickupAt: legOf(booking, LegDirection.OUTBOUND)!.pickupAt!,
      paymentStatus: booking.payments[0]?.status ?? null,
      rule: booking.pricingRule,
      lateCancelWindowMinutes: this.config.get('LATE_CANCEL_WINDOW_MINUTES', {
        infer: true,
      }),
      now: new Date(),
    });
    return { booking, actions };
  }

  private transition(
    tx: Db,
    booking: Loaded,
    to: BookingStatus,
    staff: SessionStaff,
    meta: RequestMeta,
    extra: { metadata?: Record<string, Prisma.InputJsonValue | null> } = {},
  ) {
    return transitionBooking(tx, this.audit, {
      booking,
      to,
      actor: actorOf(staff),
      action: `staff.booking_${to.toLowerCase()}`,
      meta,
      metadata: extra.metadata,
    });
  }
}

const legOf = (booking: Loaded, direction: LegDirection) =>
  booking.legs.find((leg) => leg.direction === direction);

const actorOf = (staff: SessionStaff) => ({
  actorType: ActorType.STAFF,
  staffUserId: staff.id,
});

const STATUS_WORDS: Record<BookingStatus, string> = {
  PENDING_PAYMENT: 'unfinished',
  REQUESTED: 'waiting for confirmation',
  CONFIRMED: 'confirmed',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  NO_SHOW: 'a no-show',
};

const notNow = (status: BookingStatus, done: string) =>
  new ConflictException(
    `This booking is ${STATUS_WORDS[status]}, so it can't be ${done}. Reload to see the latest.`,
  );
