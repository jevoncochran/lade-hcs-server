import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import Stripe from 'stripe';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { CareLevel } from '../src/generated/prisma/client.js';
import type { LogMailer } from '../src/mail/mailer.js';
import type { Address } from '../src/mileage/address.js';
import { DistanceProvider } from '../src/mileage/distance-provider.js';
import { PaymentGateway } from '../src/payments/payment-gateway.js';
import { StripePaymentGateway } from '../src/payments/providers/stripe-payment.gateway.js';
import { METERS_PER_MILE } from '../src/pricing/pricing.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import {
  createTestApp,
  resetAccountTables,
  resetBookingTables,
  signedInCustomer,
} from './helpers.js';

const WEBHOOK_SECRET = 'whsec_test_secret_for_e2e';

// A real StripePaymentGateway (so webhook signatures are checked for real)
// whose Stripe API calls are replaced with stubs: no network in tests.
class TestStripeGateway extends StripePaymentGateway {
  checkResult: Awaited<ReturnType<PaymentGateway['checkCardSetup']>> = {
    status: 'saved',
    paymentMethodId: 'pm_test_visa',
  };

  constructor() {
    super(new Stripe('sk_test_not_used'), WEBHOOK_SECRET);
  }
  override async createCustomer() {
    this.customersCreated++;
    return { id: `cus_${randomUUID().slice(0, 8)}` };
  }
  customersCreated = 0;
  override async createCardSetup() {
    const id = `seti_${randomUUID().slice(0, 12)}`;
    return { id, clientSecret: `${id}_secret_test` };
  }
  override async retrieveCardSetup(id: string) {
    return { id, clientSecret: `${id}_secret_test` };
  }
  override async checkCardSetup() {
    return this.checkResult;
  }
}

const address = (line1: string): Address => ({
  line1,
  city: 'Tampa',
  state: 'FL',
  zip: '33603',
});

describe('Card payments (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let mailer: LogMailer;
  let client: Awaited<ReturnType<typeof signedInCustomer>>;
  const gateway = new TestStripeGateway();

  const book = async () => {
    const response = await client
      .post('/bookings', {
        idempotencyKey: randomUUID(),
        careLevel: CareLevel.WHEELCHAIR,
        tripKind: 'ONE_WAY',
        tripType: 'MEDICAL_APPOINTMENT',
        pickup: address('123 Palm Ave'),
        dropoff: address('500 Clinic Way'),
        pickupAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
        requesterRelationship: 'SELF',
        acceptTerms: true,
      })
      .expect(201);
    return response.body as {
      booking: { id: string; status: string };
      payment: { provider: string; clientSecret: string };
    };
  };

  const setupIntentIdOf = async (bookingId: string) =>
    (await prisma.payment.findFirstOrThrow({ where: { bookingId } }))
      .stripeSetupIntentId!;

  // A webhook exactly as Stripe would send it, signed with our secret.
  const sendWebhook = (event: object, secret = WEBHOOK_SECRET) => {
    const payload = JSON.stringify(event);
    const signature = Stripe.webhooks.generateTestHeaderString({
      payload,
      secret,
    });
    return request(app.getHttpServer())
      .post('/payments/stripe/webhook')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', signature)
      .send(payload);
  };

  const setupSucceeded = (setupIntentId: string, bookingId: string) => ({
    id: `evt_${randomUUID().slice(0, 12)}`,
    object: 'event',
    type: 'setup_intent.succeeded',
    data: {
      object: {
        id: setupIntentId,
        object: 'setup_intent',
        status: 'succeeded',
        payment_method: 'pm_from_webhook',
        metadata: { bookingId },
      },
    },
  });

  beforeAll(async () => {
    ({ app, prisma, mailer } = await createTestApp(AppModule, (builder) =>
      builder
        .overrideProvider(PaymentGateway)
        .useValue(gateway)
        .overrideProvider(DistanceProvider)
        .useValue({
          isEstimate: false,
          drivingDistance: async () => 10 * METERS_PER_MILE,
        }),
    ));
    await resetBookingTables(prisma);
    await resetAccountTables(prisma);
    await prisma.stripeEvent.deleteMany();
    await prisma.pricingRule.deleteMany();
    await prisma.pricingRule.create({
      data: {
        careLevel: CareLevel.WHEELCHAIR,
        oneWayBaseCents: 7500,
        roundTripBaseCents: 15000,
        perMileCents: 400,
        noShowFeeCents: 7500,
        lateCancelFeeCents: 3750,
      },
    });
    client = await signedInCustomer(app, mailer);
  });

  beforeEach(() => {
    gateway.checkResult = { status: 'saved', paymentMethodId: 'pm_test_visa' };
  });

  afterAll(async () => {
    await resetBookingTables(prisma);
    await prisma.pricingRule.deleteMany();
    await app.close();
  });

  it('hands the website a Stripe client secret', async () => {
    const { payment } = await book();

    expect(payment).toEqual({
      provider: 'stripe',
      clientSecret: expect.stringMatching(/^seti_.+_secret_test$/),
    });
  });

  it('replaces a payment customer id left over from the fake gateway', async () => {
    // e.g. bookings made in development before Stripe was switched on.
    await prisma.customer.updateMany({
      data: { stripeCustomerId: 'fake_cus_from_before' },
    });
    const before = gateway.customersCreated;

    await book();

    expect(gateway.customersCreated).toBe(before + 1);
    const customers = await prisma.customer.findMany({
      select: { stripeCustomerId: true },
    });
    expect(customers.every((c) => c.stripeCustomerId?.startsWith('cus_'))).toBe(
      true,
    );
  });

  describe('confirm-card (after the card form)', () => {
    it('moves the booking to REQUESTED once Stripe says the card is saved', async () => {
      const { booking } = await book();

      const response = await client
        .post(`/bookings/${booking.id}/confirm-card`)
        .expect(200);

      expect(response.body.status).toBe('REQUESTED');
      expect(
        await prisma.payment.findFirstOrThrow({
          where: { bookingId: booking.id },
        }),
      ).toMatchObject({
        status: 'CARD_SAVED',
        stripePaymentMethodId: 'pm_test_visa',
      });
    });

    it('leaves the booking waiting while the bank is still confirming', async () => {
      const { booking } = await book();
      gateway.checkResult = { status: 'pending' };

      const response = await client
        .post(`/bookings/${booking.id}/confirm-card`)
        .expect(200);

      expect(response.body.status).toBe('PENDING_PAYMENT');
    });

    it('says so when the card was not saved', async () => {
      const { booking } = await book();
      gateway.checkResult = { status: 'failed' };

      const response = await client
        .post(`/bookings/${booking.id}/confirm-card`)
        .expect(422);

      expect(response.body.message).toMatch(/card wasn't saved/);
      expect(
        (await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } }))
          .status,
      ).toBe('PENDING_PAYMENT');
    });
  });

  describe('webhook (production backup)', () => {
    it('saves the card when the customer never came back to the site', async () => {
      const { booking } = await book();
      const event = setupSucceeded(
        await setupIntentIdOf(booking.id),
        booking.id,
      );

      await sendWebhook(event).expect(200);

      expect(
        (await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } }))
          .status,
      ).toBe('REQUESTED');
      expect(
        await prisma.payment.findFirstOrThrow({
          where: { bookingId: booking.id },
        }),
      ).toMatchObject({ stripePaymentMethodId: 'pm_from_webhook' });
      expect(
        await prisma.stripeEvent.findUnique({ where: { id: event.id } }),
      ).not.toBeNull();
      const history = await prisma.bookingEvent.findMany({
        where: { bookingId: booking.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(history.at(-1)).toMatchObject({
        toStatus: 'REQUESTED',
        actorType: 'SYSTEM',
      });
    });

    it('processes each event once, even if Stripe sends it again', async () => {
      const { booking } = await book();
      const event = setupSucceeded(
        await setupIntentIdOf(booking.id),
        booking.id,
      );

      await sendWebhook(event).expect(200);
      await sendWebhook(event).expect(200);

      expect(
        await prisma.bookingEvent.count({
          where: { bookingId: booking.id, toStatus: 'REQUESTED' },
        }),
      ).toBe(1);
    });

    it('is harmless after the website already confirmed the card', async () => {
      const { booking } = await book();
      await client.post(`/bookings/${booking.id}/confirm-card`).expect(200);

      await sendWebhook(
        setupSucceeded(await setupIntentIdOf(booking.id), booking.id),
      ).expect(200);

      expect(
        await prisma.bookingEvent.count({
          where: { bookingId: booking.id, toStatus: 'REQUESTED' },
        }),
      ).toBe(1);
    });

    it('rejects a webhook that Stripe did not sign', async () => {
      const { booking } = await book();
      const event = setupSucceeded(
        await setupIntentIdOf(booking.id),
        booking.id,
      );

      await sendWebhook(event, 'whsec_someone_else').expect(400);
      await request(app.getHttpServer())
        .post('/payments/stripe/webhook')
        .send(event)
        .expect(400);

      expect(
        (await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } }))
          .status,
      ).toBe('PENDING_PAYMENT');
    });

    it('ignores setup intents that are not ours', async () => {
      await sendWebhook(setupSucceeded('seti_unknown', randomUUID())).expect(
        200,
      );
    });

    it('acknowledges events it has nothing to do for', async () => {
      await sendWebhook({
        id: `evt_${randomUUID().slice(0, 12)}`,
        object: 'event',
        type: 'customer.created',
        data: { object: { id: 'cus_x', object: 'customer' } },
      }).expect(200);
    });
  });
});
