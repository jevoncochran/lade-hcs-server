import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  NotFoundException,
  Post,
  Req,
  type RawBodyRequest,
} from '@nestjs/common';
import type { Request } from 'express';
import type Stripe from 'stripe';
import { BookingsService } from '../bookings/bookings.service.js';
import { SkipOriginCheck } from '../common/decorators/skip-origin-check.decorator.js';
import { ActorType, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PaymentGateway } from './payment-gateway.js';
import { StripePaymentGateway } from './providers/stripe-payment.gateway.js';

// Stripe calls this when things happen on its side. It's the backup for
// saved cards: if a customer closes the page right after entering their
// card, the website never calls confirm-card, but this still moves the
// booking along. Every event is processed at most once.
//
// Set up in production: Stripe Dashboard → Developers → Webhooks → endpoint
// https://<api>/payments/stripe/webhook, event setup_intent.succeeded, and
// put its signing secret in STRIPE_WEBHOOK_SECRET.
@Controller('payments/stripe')
export class StripeWebhookController {
  private readonly logger = new Logger(StripeWebhookController.name);

  constructor(
    private readonly payments: PaymentGateway,
    private readonly bookings: BookingsService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  // Called by Stripe's servers, not the website; the signature check below
  // is what proves it's really Stripe.
  @SkipOriginCheck()
  async handle(
    @Req() request: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string | undefined,
  ) {
    const gateway = this.payments;
    if (
      !(gateway instanceof StripePaymentGateway) ||
      !gateway.acceptsWebhooks
    ) {
      throw new NotFoundException();
    }
    if (!signature || !request.rawBody) {
      throw new BadRequestException('Missing Stripe signature');
    }

    let event: Stripe.Event;
    try {
      event = gateway.verifyWebhook(request.rawBody, signature);
    } catch {
      throw new BadRequestException('Invalid Stripe signature');
    }

    const seen = await this.prisma.stripeEvent.findUnique({
      where: { id: event.id },
    });
    if (seen) return { received: true };

    if (event.type === 'setup_intent.succeeded') {
      await this.cardSaved(event.data.object);
    }

    // Recorded after handling, so a crash mid-way lets Stripe's retry try
    // again. Handling is safe to repeat, so a race here is harmless.
    await this.prisma.stripeEvent
      .create({ data: { id: event.id, type: event.type } })
      .catch((error: unknown) => {
        const duplicate =
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002';
        if (!duplicate) throw error;
      });
    return { received: true };
  }

  private async cardSaved(setupIntent: Stripe.SetupIntent) {
    const bookingId = setupIntent.metadata?.bookingId;
    const payment = bookingId
      ? await this.prisma.payment.findFirst({
          where: { bookingId, stripeSetupIntentId: setupIntent.id },
          select: { id: true },
        })
      : null;
    const paymentMethod = setupIntent.payment_method;
    const paymentMethodId =
      typeof paymentMethod === 'string' ? paymentMethod : paymentMethod?.id;

    if (!bookingId || !payment || !paymentMethodId) {
      // Not one of ours (e.g. created in the Stripe Dashboard): acknowledge
      // so Stripe stops retrying. Ids only in the log, never customer data.
      this.logger.warn(
        `Ignoring SetupIntent ${setupIntent.id}: no matching booking`,
      );
      return;
    }

    await this.bookings.markCardSaved(bookingId, paymentMethodId, {
      actorType: ActorType.SYSTEM,
    });
  }
}
