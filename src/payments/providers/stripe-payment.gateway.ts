import type Stripe from 'stripe';
import {
  PaymentGateway,
  type CardSetup,
  type CardSetupResult,
  type ChargeResult,
} from '../payment-gateway.js';

// Card payments through Stripe. Only our own ids go in metadata, and the
// customer's email on the Stripe Customer: never names, addresses or trip
// details (Stripe isn't covered by a BAA).
export class StripePaymentGateway extends PaymentGateway {
  readonly provider = 'stripe' as const;

  constructor(
    private readonly stripe: Stripe,
    // Optional in development; see STRIPE_WEBHOOK_SECRET.
    private readonly webhookSecret?: string,
  ) {
    super();
  }

  async createCustomer(input: { customerId: string; email: string }) {
    const customer = await this.stripe.customers.create({
      email: input.email,
      metadata: { customerId: input.customerId },
    });
    return { id: customer.id };
  }

  ownsCustomerId(id: string) {
    return id.startsWith('cus_');
  }

  async createCardSetup(input: {
    paymentCustomerId: string;
    bookingId: string;
  }): Promise<CardSetup> {
    const setupIntent = await this.stripe.setupIntents.create({
      customer: input.paymentCustomerId,
      // Charged later, after the ride, without the customer present.
      usage: 'off_session',
      allowed_payment_method_types: ['card'],
      metadata: { bookingId: input.bookingId },
    });
    return toCardSetup(setupIntent);
  }

  async retrieveCardSetup(setupId: string): Promise<CardSetup> {
    return toCardSetup(await this.stripe.setupIntents.retrieve(setupId));
  }

  async checkCardSetup(setupId: string): Promise<CardSetupResult> {
    return toResult(await this.stripe.setupIntents.retrieve(setupId));
  }

  async chargeSavedCard(input: {
    paymentCustomerId: string;
    paymentMethodId: string;
    amountCents: number;
    currency: string;
    bookingId: string;
    idempotencyKey: string;
  }): Promise<ChargeResult> {
    try {
      const paymentIntent = await this.stripe.paymentIntents.create(
        {
          amount: input.amountCents,
          currency: input.currency,
          customer: input.paymentCustomerId,
          payment_method: input.paymentMethodId,
          // The customer isn't there: charge now or fail, no 3-D Secure pop-up.
          off_session: true,
          confirm: true,
          metadata: { bookingId: input.bookingId },
        },
        { idempotencyKey: input.idempotencyKey },
      );
      return paymentIntent.status === 'succeeded'
        ? { status: 'charged', paymentIntentId: paymentIntent.id }
        : {
            status: 'failed',
            // e.g. requires_action: the bank wants the customer to approve it
            code: paymentIntent.status,
            paymentIntentId: paymentIntent.id,
          };
    } catch (error) {
      // Declines come back as card errors; anything else (network, outage)
      // means we don't know, so let the caller keep it retryable.
      if (isCardError(error)) {
        return {
          status: 'failed',
          code: error.decline_code ?? error.code ?? 'card_error',
          paymentIntentId: error.payment_intent?.id ?? null,
        };
      }
      throw error;
    }
  }

  async releaseCard(paymentMethodId: string) {
    await this.stripe.paymentMethods.detach(paymentMethodId);
  }

  // Webhooks can only be checked when a signing secret is configured.
  get acceptsWebhooks() {
    return Boolean(this.webhookSecret);
  }

  // Verifies Stripe's signature on a webhook and returns the event. Throws
  // if the signature is missing, wrong, or too old.
  verifyWebhook(rawBody: Buffer, signature: string): Stripe.Event {
    if (!this.webhookSecret) {
      throw new Error('No STRIPE_WEBHOOK_SECRET configured');
    }
    return this.stripe.webhooks.constructEvent(
      rawBody,
      signature,
      this.webhookSecret,
    );
  }
}

const isCardError = (
  error: unknown,
): error is {
  code?: string;
  decline_code?: string;
  payment_intent?: { id: string };
} => (error as { type?: unknown } | null)?.type === 'StripeCardError';

const toCardSetup = (setupIntent: Stripe.SetupIntent): CardSetup => {
  if (!setupIntent.client_secret) {
    throw new Error(`SetupIntent ${setupIntent.id} has no client secret`);
  }
  return { id: setupIntent.id, clientSecret: setupIntent.client_secret };
};

export const toResult = (setupIntent: Stripe.SetupIntent): CardSetupResult => {
  switch (setupIntent.status) {
    case 'succeeded': {
      const paymentMethod = setupIntent.payment_method;
      const paymentMethodId =
        typeof paymentMethod === 'string' ? paymentMethod : paymentMethod?.id;
      return paymentMethodId
        ? { status: 'saved', paymentMethodId }
        : { status: 'failed' };
    }
    case 'processing':
    case 'requires_action':
      return { status: 'pending' };
    default:
      // requires_payment_method (declined or not entered), canceled, …
      return { status: 'failed' };
  }
};
