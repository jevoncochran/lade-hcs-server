import { Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import type { RequestMeta } from '../common/decorators/req-meta.decorator.js';
import {
  PaymentStatus,
  type ActorType,
  type Payment,
} from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PaymentGateway } from './payment-gateway.js';

export type PaymentActor = { actorType: ActorType; staffUserId?: string };

// Payments that can (still) be charged. CHARGE_PENDING: an earlier attempt
// got no answer; retrying it reuses the same idempotency key.
export const CHARGEABLE: PaymentStatus[] = [
  PaymentStatus.CARD_SAVED,
  PaymentStatus.FAILED,
  PaymentStatus.CHARGE_PENDING,
];

type Prepared =
  | {
      kind: 'charge';
      payment: Payment;
      amountCents: number;
      currency: string;
      attempt: number;
    }
  | { kind: 'release'; paymentMethodId: string | null }
  | null;

// Charges a booking's saved card for what it owes: the sum of its
// BookingCharge lines (fare, mileage, waiting time, fees, adjustments).
// Called after a ride is completed, a no-show, or a cancellation.
@Injectable()
export class BookingPaymentsService {
  private readonly logger = new Logger(BookingPaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: PaymentGateway,
    private readonly audit: AuditService,
  ) {}

  // Never throws for a declined card or a provider outage: the outcome is
  // recorded on the payment (CHARGED, FAILED, or CHARGE_PENDING to retry),
  // because the status change that led here has already happened.
  async chargeBooking(
    bookingId: string,
    actor: PaymentActor,
    meta?: RequestMeta,
  ) {
    const prepared = await this.prepare(bookingId);
    if (!prepared) return;

    if (prepared.kind === 'release') {
      // Nothing owed: let go of the card. Best effort; nothing is charged
      // either way.
      if (prepared.paymentMethodId) {
        await this.gateway
          .releaseCard(prepared.paymentMethodId)
          .catch((error: unknown) =>
            this.logger.warn(
              `Couldn't release the card for booking ${bookingId}: ${errorName(error)}`,
            ),
          );
      }
      return;
    }

    const { payment, amountCents, currency, attempt } = prepared;
    let result;
    try {
      result = await this.gateway.chargeSavedCard({
        paymentCustomerId: payment.stripeCustomerId,
        paymentMethodId: payment.stripePaymentMethodId!,
        amountCents,
        currency,
        bookingId,
        idempotencyKey: `charge-${payment.id}-${attempt}`,
      });
    } catch (error) {
      // No answer: stays CHARGE_PENDING, and a retry asks again with the
      // same key. Ids only in the log, never PHI.
      this.logger.error(
        `Charge for booking ${bookingId} got no answer: ${errorName(error)}`,
      );
      return;
    }

    const charged = result.status === 'charged';
    const failureCode = result.status === 'failed' ? result.code : null;
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.payment.updateMany({
        where: {
          id: payment.id,
          status: PaymentStatus.CHARGE_PENDING,
          chargeAttempts: attempt,
        },
        data: charged
          ? {
              status: PaymentStatus.CHARGED,
              stripePaymentIntentId: result.paymentIntentId,
              failureCode: null,
            }
          : {
              status: PaymentStatus.FAILED,
              stripePaymentIntentId: result.paymentIntentId,
              failureCode,
            },
      });
      if (count === 0) return; // another request already recorded it
      await this.audit.record(
        {
          ...actor,
          action: charged ? 'payment.charged' : 'payment.charge_failed',
          entityType: 'Booking',
          entityId: bookingId,
          metadata: charged
            ? { amountCents, attempt }
            : { amountCents, attempt, code: failureCode },
          meta,
        },
        tx,
      );
    });
  }

  // Works out what to do, and claims the payment (CHARGE_PENDING) so two
  // requests can't both start a new attempt.
  private prepare(bookingId: string): Promise<Prepared> {
    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findFirst({
        where: { bookingId },
        orderBy: { createdAt: 'desc' },
        include: { booking: { select: { currency: true } } },
      });
      if (!payment || !CHARGEABLE.includes(payment.status)) return null;

      const { _sum } = await tx.bookingCharge.aggregate({
        where: { bookingId },
        _sum: { amountCents: true },
      });
      const amountCents = _sum.amountCents ?? 0;

      if (amountCents <= 0) {
        await tx.payment.update({
          where: { id: payment.id },
          data: { status: PaymentStatus.CANCELED, amountCents: 0 },
        });
        return {
          kind: 'release',
          paymentMethodId: payment.stripePaymentMethodId,
        };
      }

      if (!payment.stripePaymentMethodId) {
        await tx.payment.update({
          where: { id: payment.id },
          data: { status: PaymentStatus.FAILED, failureCode: 'no_saved_card' },
        });
        return null;
      }

      const attempt =
        payment.status === PaymentStatus.CHARGE_PENDING
          ? payment.chargeAttempts
          : payment.chargeAttempts + 1;
      const { count } = await tx.payment.updateMany({
        where: {
          id: payment.id,
          status: payment.status,
          chargeAttempts: payment.chargeAttempts,
        },
        data: {
          status: PaymentStatus.CHARGE_PENDING,
          chargeAttempts: attempt,
          amountCents,
        },
      });
      if (count === 0) return null; // someone else is charging it right now

      return {
        kind: 'charge',
        payment,
        amountCents,
        currency: payment.booking.currency,
        attempt,
      };
    });
  }
}

const errorName = (error: unknown) =>
  error instanceof Error ? error.name : 'unknown error';
