import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service.js';
import { BookingNotificationsService } from '../notifications/booking-notifications.service.js';
import type { RequestMeta } from '../common/decorators/req-meta.decorator.js';
import type { Env } from '../config/env.validation.js';
import type { SessionCustomer } from '../customer-auth/customer-session.service.js';
import {
  ActorType,
  BookingStatus,
  LegDirection,
  PaymentStatus,
  Prisma,
  RequesterRelationship,
  TripKind,
  type PricingRule,
} from '../generated/prisma/client.js';
import { normalizeAddress, type Address } from '../mileage/address.js';
import {
  MileageService,
  type MeasuredLeg,
} from '../mileage/mileage.service.js';
import { BookingPaymentsService } from '../payments/booking-payments.service.js';
import { PaymentGateway } from '../payments/payment-gateway.js';
import { formatCents, type PriceLine } from '../pricing/pricing.js';
import { PricingService } from '../pricing/pricing.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  isInServiceState,
  QuotesService,
  type QuoteReason,
} from '../quotes/quotes.service.js';
import { newBookingReference } from './booking-reference.js';
import { cancelBooking, lateCancelFee } from './booking-status.js';
import { bookingsVersion } from './bookings-version.js';
import {
  sortLegs,
  toBookingView,
  toCustomerRideView,
  type CustomerRideRecord,
  type CustomerRideView,
  type PriceSnapshot,
} from './booking-view.js';
import type { CancelRideDto } from './dto/cancel-ride.dto.js';
import type { CreateBookingDto } from './dto/create-booking.dto.js';

const HOUR_MS = 60 * 60 * 1000;
const MAX_APPOINTMENT_AFTER_PICKUP_MS = 12 * HOUR_MS;
const REFERENCE_ATTEMPTS = 3;

// Statuses a customer can still cancel from.
const CANCELLABLE: BookingStatus[] = [
  BookingStatus.REQUESTED,
  BookingStatus.CONFIRMED,
];

const rideInclude = {
  legs: true,
  pricingRule: true,
  payments: { orderBy: { createdAt: 'desc' }, take: 1 },
  charges: {
    orderBy: { createdAt: 'asc' },
    include: { leg: { select: { direction: true } } },
  },
} satisfies Prisma.BookingInclude;

type TripTimes = {
  pickupAt: Date;
  appointmentAt: Date | null;
  returnPickupAt: Date | null;
  returnWillCall: boolean;
};

type Rider = { firstName: string; lastName: string; phone: string | null };

// Creating and reading a customer's own bookings. A new booking starts as
// PENDING_PAYMENT; it becomes REQUESTED once the card is saved (payment
// webhook, next step), and staff confirm it from there.
@Injectable()
export class BookingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mileage: MileageService,
    private readonly pricing: PricingService,
    private readonly quotes: QuotesService,
    private readonly payments: PaymentGateway,
    private readonly bookingPayments: BookingPaymentsService,
    private readonly audit: AuditService,
    private readonly notifications: BookingNotificationsService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async create(
    customer: SessionCustomer,
    dto: CreateBookingDto,
    meta: RequestMeta,
    now = new Date(),
  ) {
    if (customer.emailVerifiedAt === null) {
      throw new ForbiddenException(
        'Please confirm your email address before booking.',
      );
    }

    // A resubmitted checkout gets the booking it already made.
    const existing = await this.findByIdempotencyKey(dto.idempotencyKey);
    if (existing) return this.replay(existing, customer);

    if (normalizeAddress(dto.pickup) === normalizeAddress(dto.dropoff)) {
      throw new BadRequestException(
        'The pickup and drop-off addresses are the same.',
      );
    }
    const times = this.checkTimes(dto, now);
    const rider = this.riderFor(dto, customer);

    if (!isInServiceState(dto.pickup) || !isInServiceState(dto.dropoff)) {
      this.refuse('OUT_OF_STATE', dto);
    }

    // The price is always recalculated here, never taken from the website.
    const legs = await this.mileage.measureTrip(
      dto.tripKind,
      dto.pickup,
      dto.dropoff,
    );
    const { quote, rule } = await this.pricing.quote(
      dto.careLevel,
      { tripKind: dto.tripKind, legs },
      now,
    );
    if (quote.kind === 'call_for_quote' || !rule) {
      this.refuse(
        quote.kind === 'call_for_quote' ? quote.reason : 'NO_RATE',
        dto,
      );
    }

    // Payment provider calls happen before the database transaction, so a
    // failure there leaves nothing half-saved. A card setup that's never
    // used simply expires at the provider.
    const bookingId = randomUUID();
    const paymentCustomerId = await this.ensurePaymentCustomer(customer);
    const cardSetup = await this.payments.createCardSetup({
      paymentCustomerId,
      bookingId,
    });

    const input = {
      bookingId,
      customer,
      dto,
      times,
      rider,
      legs,
      rule,
      lines: quote.lines,
      totalCents: quote.totalCents,
      billableMiles: quote.billableMiles,
      paymentCustomerId,
      cardSetupId: cardSetup.id,
      meta,
      now,
    };

    for (let attempt = 1; ; attempt++) {
      try {
        const booking = await this.insert(input);
        return {
          booking: toBookingView(booking),
          payment: {
            provider: this.payments.provider,
            clientSecret: cardSetup.clientSecret,
          },
        };
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        // Either the same checkout was submitted twice at once (replay it),
        // or the random reference clashed (try another).
        const raced = await this.findByIdempotencyKey(dto.idempotencyKey);
        if (raced) return this.replay(raced, customer);
        if (attempt >= REFERENCE_ATTEMPTS) throw error;
      }
    }
  }

  // The card for a booking was saved: it's now a real request for staff to
  // confirm. Called by confirmCard and by the Stripe webhook. Safe to call
  // twice.
  async markCardSaved(
    bookingId: string,
    paymentMethodId: string,
    actor: { actorType: ActorType; customerId?: string },
    meta?: RequestMeta,
  ) {
    const { booking, changed } = await this.prisma.$transaction(async (tx) => {
      const booking = await tx.booking.findUniqueOrThrow({
        where: { id: bookingId },
        include: { legs: true },
      });
      if (booking.status !== BookingStatus.PENDING_PAYMENT) {
        return { booking, changed: false };
      }

      await tx.payment.updateMany({
        where: { bookingId, status: PaymentStatus.CARD_PENDING },
        data: {
          status: PaymentStatus.CARD_SAVED,
          stripePaymentMethodId: paymentMethodId,
        },
      });
      const updated = await tx.booking.update({
        where: { id: bookingId },
        data: {
          status: BookingStatus.REQUESTED,
          events: {
            create: {
              fromStatus: BookingStatus.PENDING_PAYMENT,
              toStatus: BookingStatus.REQUESTED,
              actorType: actor.actorType,
            },
          },
        },
        include: { legs: true },
      });
      await this.audit.record(
        {
          ...actor,
          action: 'booking.card_saved',
          entityType: 'Booking',
          entityId: bookingId,
          meta,
        },
        tx,
      );
      return { booking: updated, changed: true };
    });

    // Once only, even when the website and the Stripe webhook both report it.
    if (changed) await this.notifications.requestReceived(bookingId);
    return booking;
  }

  // The website calls this after the customer finishes the card form. We
  // ask the payment provider ourselves rather than trusting the browser.
  // Safe to call more than once; the webhook does the same job if the
  // customer closes the page first.
  async confirmCard(customer: SessionCustomer, id: string, meta: RequestMeta) {
    const booking = await this.prisma.booking.findFirst({
      where: { id, customerId: customer.id, deletedAt: null },
      include: {
        legs: true,
        payments: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
    if (!booking) throw new NotFoundException('Booking not found.');

    // Already saved (e.g. by the webhook): nothing to do.
    if (booking.status !== BookingStatus.PENDING_PAYMENT) {
      return toBookingView(booking);
    }

    const setupId = booking.payments[0]?.stripeSetupIntentId;
    if (!setupId) throw new NotFoundException('Booking not found.');

    const result = await this.payments.checkCardSetup(setupId);
    if (result.status === 'failed') {
      throw new UnprocessableEntityException(
        "Your card wasn't saved. Please check the details or try a different card.",
      );
    }
    if (result.status === 'pending') {
      // The bank is still confirming; the webhook will finish the booking.
      return toBookingView(booking);
    }

    return toBookingView(
      await this.markCardSaved(
        booking.id,
        result.paymentMethodId,
        { actorType: ActorType.CUSTOMER, customerId: customer.id },
        meta,
      ),
    );
  }

  // For pages that update themselves: changes whenever one of this
  // customer's bookings does.
  version(customer: SessionCustomer) {
    return bookingsVersion(this.prisma, {
      customerId: customer.id,
      deletedAt: null,
    });
  }

  async list(customer: SessionCustomer) {
    const bookings = await this.prisma.booking.findMany({
      where: {
        customerId: customer.id,
        deletedAt: null,
        // Checkouts where the card was never saved aren't real bookings yet.
        status: { not: BookingStatus.PENDING_PAYMENT },
      },
      include: rideInclude,
      orderBy: { createdAt: 'desc' },
    });
    const now = new Date();
    return bookings.map((booking) =>
      toCustomerRideView(booking, this.cancelOption(booking, now)),
    );
  }

  async get(customer: SessionCustomer, id: string) {
    const booking = await this.prisma.booking.findFirst({
      // Someone else's booking is "not found", never "forbidden": don't
      // confirm it exists.
      where: { id, customerId: customer.id, deletedAt: null },
      include: rideInclude,
    });
    if (!booking) throw new NotFoundException('Booking not found.');
    return toCustomerRideView(booking, this.cancelOption(booking, new Date()));
  }

  // The customer cancelling their own ride: free until 2 hours before a
  // confirmed pickup (or any time before Lade confirms), then the
  // late-cancellation fee. Not after the pickup time: then they call.
  async cancel(
    customer: SessionCustomer,
    id: string,
    dto: CancelRideDto,
    meta: RequestMeta,
  ) {
    const actor = { actorType: ActorType.CUSTOMER, customerId: customer.id };

    await this.prisma.$transaction(async (tx) => {
      const booking = await tx.booking.findFirst({
        where: { id, customerId: customer.id, deletedAt: null },
        include: rideInclude,
      });
      if (!booking) throw new NotFoundException('Booking not found.');

      const option = this.cancelOption(booking, new Date());
      if (!option.allowed) {
        throw new ConflictException(
          CANCELLABLE.includes(booking.status)
            ? 'Your pickup time has passed. Please call us to make changes.'
            : "This ride can't be cancelled anymore.",
        );
      }
      if (
        option.feeCents !== null &&
        (dto.acceptedFeeCents ?? 0) < option.feeCents
      ) {
        throw new ConflictException(
          `It's now less than 2 hours before pickup, so cancelling costs a late-cancellation fee of ${formatCents(option.feeCents)}. Please confirm again.`,
        );
      }

      await cancelBooking(tx, this.audit, {
        booking,
        actor,
        action: 'booking.cancelled_by_customer',
        meta,
        reason: dto.reason || undefined,
        feeCents: option.feeCents,
      });
    });

    // The fee, if any; otherwise this lets go of the saved card.
    await this.bookingPayments.chargeBooking(id, actor, meta);
    await this.notifications.cancelledByCustomer(id);
    return this.get(customer, id);
  }

  private cancelOption(
    booking: CustomerRideRecord & { pricingRule: PricingRule },
    now: Date,
  ): CustomerRideView['cancel'] {
    const pickupAt = sortLegs(booking.legs)[0].pickupAt!;
    return {
      allowed: CANCELLABLE.includes(booking.status) && now < pickupAt,
      feeCents: lateCancelFee({
        status: booking.status,
        outboundPickupAt: pickupAt,
        lateCancelFeeCents: booking.pricingRule.lateCancelFeeCents,
        windowMinutes: this.config.get('LATE_CANCEL_WINDOW_MINUTES', {
          infer: true,
        }),
        now,
      }),
    };
  }

  // ---------- Checks ----------

  private checkTimes(dto: CreateBookingDto, now: Date): TripTimes {
    const pickupAt = new Date(dto.pickupAt);
    const minNoticeHours = this.config.get('MIN_NOTICE_HOURS', { infer: true });
    if (pickupAt.getTime() < now.getTime() + minNoticeHours * HOUR_MS) {
      this.refuse('SHORT_NOTICE', dto);
    }

    const appointmentAt = dto.appointmentAt
      ? new Date(dto.appointmentAt)
      : null;
    if (
      appointmentAt &&
      (appointmentAt < pickupAt ||
        appointmentAt.getTime() - pickupAt.getTime() >
          MAX_APPOINTMENT_AFTER_PICKUP_MS)
    ) {
      throw new BadRequestException(
        'The appointment time should be after the pickup time, on the same trip.',
      );
    }

    const returnPickupAt = dto.returnPickupAt
      ? new Date(dto.returnPickupAt)
      : null;
    const returnWillCall = dto.returnWillCall === true;

    switch (dto.tripKind) {
      case TripKind.ONE_WAY:
        if (
          returnPickupAt ||
          returnWillCall ||
          dto.expectedWaitMinutes !== undefined
        ) {
          throw new BadRequestException('A one-way trip has no ride back.');
        }
        break;

      case TripKind.ROUND_TRIP:
        if (Boolean(returnPickupAt) === returnWillCall) {
          throw new BadRequestException(
            'For a round trip, choose a time for the ride back, or "I\'ll call when ready".',
          );
        }
        if (returnPickupAt && returnPickupAt <= (appointmentAt ?? pickupAt)) {
          throw new BadRequestException(
            'The ride back should be after the first pickup and the appointment.',
          );
        }
        if (dto.expectedWaitMinutes !== undefined) {
          throw new BadRequestException(
            'Expected waiting time only applies to wait-and-return trips.',
          );
        }
        break;

      case TripKind.WAIT_AND_RETURN:
        // The driver waits and brings them back when they're done.
        if (returnPickupAt || returnWillCall) {
          throw new BadRequestException(
            'On a wait-and-return trip the driver waits, so there is no separate return time.',
          );
        }
        break;
    }

    return { pickupAt, appointmentAt, returnPickupAt, returnWillCall };
  }

  private riderFor(dto: CreateBookingDto, customer: SessionCustomer): Rider {
    if (dto.requesterRelationship === RequesterRelationship.SELF) {
      return {
        firstName: customer.firstName,
        lastName: customer.lastName,
        phone: dto.riderPhone ?? customer.phone,
      };
    }
    if (!dto.riderFirstName || !dto.riderLastName) {
      throw new BadRequestException("Enter the rider's first and last name.");
    }
    return {
      firstName: dto.riderFirstName,
      lastName: dto.riderLastName,
      phone: dto.riderPhone ?? null,
    };
  }

  // Same reasons and wording as the quote endpoint.
  private refuse(reason: QuoteReason, dto: CreateBookingDto): never {
    throw new UnprocessableEntityException({
      message: this.quotes.callForQuoteMessage(reason, dto.careLevel),
      reason,
    });
  }

  // ---------- Saving ----------

  private async insert(input: {
    bookingId: string;
    customer: SessionCustomer;
    dto: CreateBookingDto;
    times: TripTimes;
    rider: Rider;
    legs: MeasuredLeg[];
    rule: PricingRule;
    lines: PriceLine[];
    totalCents: number;
    billableMiles: number;
    paymentCustomerId: string;
    cardSetupId: string;
    meta: RequestMeta;
    now: Date;
  }) {
    const { dto, customer, times, rider, legs } = input;
    const snapshot: PriceSnapshot = {
      lines: input.lines,
      billableMiles: input.billableMiles,
      distanceIsEstimate: this.mileage.distancesAreEstimates,
    };

    return this.prisma.$transaction(async (tx) => {
      const booking = await tx.booking.create({
        data: {
          id: input.bookingId,
          reference: newBookingReference(),
          idempotencyKey: dto.idempotencyKey,
          status: BookingStatus.PENDING_PAYMENT,
          customerId: customer.id,

          careLevel: dto.careLevel,
          tripType: dto.tripType,
          tripKind: dto.tripKind,
          companionCount: dto.companionCount ?? 0,

          // The account holder is the requester; a snapshot, so later
          // account changes don't rewrite past bookings.
          requesterRelationship: dto.requesterRelationship,
          requesterName: `${customer.firstName} ${customer.lastName}`,
          requesterEmail: customer.email,
          requesterPhone: customer.phone,

          riderFirstName: rider.firstName,
          riderLastName: rider.lastName,
          riderPhone: rider.phone,
          mobilityNotes: dto.mobilityNotes || null,
          instructions: dto.instructions || null,

          pricingRuleId: input.rule.id,
          billableMeters: Math.round(
            legs.reduce((sum, leg) => sum + leg.distanceMeters, 0),
          ),
          quotedPriceCents: input.totalCents,
          priceBreakdown: snapshot as unknown as Prisma.InputJsonValue,

          termsVersion: this.config.get('TERMS_VERSION', { infer: true }),
          termsAcceptedAt: input.now,

          legs: {
            create: legs.map((leg, index) => {
              const outbound = index === 0;
              return {
                direction: outbound
                  ? LegDirection.OUTBOUND
                  : LegDirection.RETURN,
                pickupAt: outbound ? times.pickupAt : times.returnPickupAt,
                willCall: !outbound && times.returnWillCall,
                appointmentAt: outbound ? times.appointmentAt : null,
                waitMinutes: outbound
                  ? null
                  : (dto.expectedWaitMinutes ?? null),
                pickupAddress: JSON.stringify(plainAddress(leg.pickup)),
                dropoffAddress: JSON.stringify(plainAddress(leg.dropoff)),
                distanceMeters: Math.round(leg.distanceMeters),
              };
            }),
          },
          payments: {
            create: {
              status: PaymentStatus.CARD_PENDING,
              stripeCustomerId: input.paymentCustomerId,
              stripeSetupIntentId: input.cardSetupId,
              amountCents: input.totalCents,
            },
          },
          events: {
            create: {
              toStatus: BookingStatus.PENDING_PAYMENT,
              actorType: ActorType.CUSTOMER,
            },
          },
        },
        include: { legs: true },
      });

      await this.audit.record(
        {
          actorType: ActorType.CUSTOMER,
          customerId: customer.id,
          action: 'booking.created',
          entityType: 'Booking',
          entityId: booking.id,
          meta: input.meta,
        },
        tx,
      );
      return booking;
    });
  }

  private async ensurePaymentCustomer(customer: SessionCustomer) {
    const { stripeCustomerId } = await this.prisma.customer.findUniqueOrThrow({
      where: { id: customer.id },
      select: { stripeCustomerId: true },
    });
    if (stripeCustomerId && this.payments.ownsCustomerId(stripeCustomerId)) {
      return stripeCustomerId;
    }

    const created = await this.payments.createCustomer({
      customerId: customer.id,
      email: customer.email,
    });
    await this.prisma.customer.update({
      where: { id: customer.id },
      data: { stripeCustomerId: created.id },
    });
    return created.id;
  }

  private findByIdempotencyKey(idempotencyKey: string) {
    return this.prisma.booking.findUnique({
      where: { idempotencyKey },
      include: {
        legs: true,
        payments: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
  }

  private async replay(
    booking: NonNullable<
      Awaited<ReturnType<BookingsService['findByIdempotencyKey']>>
    >,
    customer: SessionCustomer,
  ) {
    if (booking.customerId !== customer.id) {
      throw new ConflictException(
        'This booking request has already been used.',
      );
    }
    const payment = booking.payments[0];
    const pending =
      booking.status === BookingStatus.PENDING_PAYMENT &&
      payment?.status === PaymentStatus.CARD_PENDING &&
      payment.stripeSetupIntentId;

    return {
      booking: toBookingView(booking),
      payment: pending
        ? {
            provider: this.payments.provider,
            clientSecret: (
              await this.payments.retrieveCardSetup(
                payment.stripeSetupIntentId!,
              )
            ).clientSecret,
          }
        : null, // card already saved, or the booking moved on
    };
  }
}

const plainAddress = (address: Address): Address => ({
  line1: address.line1,
  ...(address.line2 ? { line2: address.line2 } : {}),
  city: address.city,
  state: address.state.toUpperCase(),
  zip: address.zip,
});

const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === 'P2002';
