import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { CareLevel } from '../src/generated/prisma/client.js';
import type { LogMailer } from '../src/mail/mailer.js';
import type { Address } from '../src/mileage/address.js';
import {
  DistanceProvider,
  UnknownAddressError,
} from '../src/mileage/distance-provider.js';
import { METERS_PER_MILE } from '../src/pricing/pricing.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import {
  browser,
  createTestApp,
  resetBookingTables,
  resetAccountTables,
  signedInCustomer,
} from './helpers.js';

const HOUR_MS = 60 * 60 * 1000;

const address = (line1: string, state = 'FL'): Address => ({
  line1,
  city: 'Tampa',
  state,
  zip: '33603',
});

const HOME = address('123 Palm Ave');
const CLINIC = address('500 Clinic Way'); // 10 mi from home, 11 mi back
const FAR = address('900 Far Rd'); // 60 mi away
const ATLANTA = address('1 Peachtree St', 'GA');
const NOWHERE = address('0 Nowhere Ln'); // the map can't find it

// Fixed distances so prices are exact.
const MILES: Record<string, number> = {
  '123 Palm Ave>500 Clinic Way': 10,
  '500 Clinic Way>123 Palm Ave': 11,
  '123 Palm Ave>900 Far Rd': 60,
  '900 Far Rd>123 Palm Ave': 60,
  '123 Palm Ave>1 Peachtree St': 20,
};
const fakeDistances = {
  isEstimate: false,
  drivingDistance: async (from: Address, to: Address) => {
    if (from.line1 === NOWHERE.line1) throw new UnknownAddressError('from');
    if (to.line1 === NOWHERE.line1) throw new UnknownAddressError('to');
    return (MILES[`${from.line1}>${to.line1}`] ?? 5) * METERS_PER_MILE;
  },
};

describe('POST /quotes (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let mailer: LogMailer;
  let client: Awaited<ReturnType<typeof signedInCustomer>>;

  const inHours = (hours: number) =>
    new Date(Date.now() + hours * HOUR_MS).toISOString();

  const body = (overrides: object = {}) => ({
    careLevel: CareLevel.WHEELCHAIR,
    tripKind: 'ONE_WAY',
    pickup: HOME,
    dropoff: CLINIC,
    pickupAt: inHours(48),
    ...overrides,
  });

  beforeAll(async () => {
    ({ app, prisma, mailer } = await createTestApp(AppModule, (builder) =>
      builder.overrideProvider(DistanceProvider).useValue(fakeDistances),
    ));
    await resetAccountTables(prisma);
    await resetBookingTables(prisma);
    await prisma.pricingRule.deleteMany();
    await prisma.pricingRule.createMany({
      data: [
        {
          careLevel: CareLevel.AMBULATORY,
          oneWayBaseCents: 5000,
          roundTripBaseCents: 10000,
          perMileCents: 350,
          noShowFeeCents: 5000,
          lateCancelFeeCents: 2500,
        },
        {
          careLevel: CareLevel.WHEELCHAIR,
          oneWayBaseCents: 7500,
          roundTripBaseCents: 15000,
          perMileCents: 400,
          noShowFeeCents: 7500,
          lateCancelFeeCents: 3750,
        },
        // No stretcher rate yet.
      ],
    });
    client = await signedInCustomer(app, mailer);
  });

  afterAll(async () => {
    await prisma.pricingRule.deleteMany();
    await app.close();
  });

  describe('prices', () => {
    it('prices a one-way wheelchair trip from the rate card', async () => {
      const response = await client.post('/quotes', body()).expect(200);

      expect(response.body).toEqual({
        status: 'priced',
        currency: 'usd',
        lines: [
          {
            type: 'BASE_FARE',
            description: 'Base fare (one-way)',
            amountCents: 7500,
          },
          {
            type: 'MILEAGE',
            description: 'Mileage: 10.0 mi × $4.00',
            quantity: 10,
            amountCents: 4000,
          },
        ],
        totalCents: 11500,
        billableMiles: 10,
        distanceIsEstimate: false,
        notes: [
          'Waiting time over 15 minutes is $15.00 for each 15 minutes, charged after the ride.',
        ],
      });
    });

    it('measures the way back separately on a round trip', async () => {
      const response = await client
        .post(
          '/quotes',
          body({ careLevel: 'AMBULATORY', tripKind: 'ROUND_TRIP' }),
        )
        .expect(200);

      // 10 mi there + 11 mi back = 21 mi; $100 + 21 × $3.50 = $173.50
      expect(response.body).toMatchObject({
        status: 'priced',
        billableMiles: 21,
        totalCents: 17350,
      });
    });
  });

  describe('call for a quote', () => {
    it.each([
      [
        'less than 24 hours away',
        body({ pickupAt: inHours(3) }),
        'SHORT_NOTICE',
        /at least 24 hours' notice/,
      ],
      [
        'in the past',
        body({ pickupAt: inHours(-5) }),
        'SHORT_NOTICE',
        /at least 24 hours' notice/,
      ],
      [
        'over 50 miles',
        body({ dropoff: FAR }),
        'LONG_DISTANCE',
        /over 50 miles each way/,
      ],
      [
        'outside Florida',
        body({ dropoff: ATLANTA }),
        'OUT_OF_STATE',
        /outside Florida/,
      ],
      [
        'a care level with no rate yet',
        body({ careLevel: 'STRETCHER' }),
        'NO_RATE',
        /stretcher transportation aren't available yet/,
      ],
    ])('when the trip is %s', async (_label, request, reason, message) => {
      const response = await client.post('/quotes', request).expect(200);

      expect(response.body).toEqual({
        status: 'call_for_quote',
        reason,
        message: expect.stringMatching(message),
      });
    });
  });

  describe('errors', () => {
    it('says which address the map could not find', async () => {
      const pickup = await client
        .post('/quotes', body({ pickup: NOWHERE }))
        .expect(422);
      const dropoff = await client
        .post('/quotes', body({ dropoff: NOWHERE }))
        .expect(422);

      expect(pickup.body).toMatchObject({ field: 'pickup' });
      expect(dropoff.body).toMatchObject({
        field: 'dropoff',
        message: expect.stringMatching(/drop-off address/),
      });
      // The address itself is never echoed back.
      expect(JSON.stringify(dropoff.body)).not.toContain('Nowhere');
    });

    it('rejects the same pickup and drop-off', async () => {
      await client
        .post('/quotes', body({ dropoff: { ...HOME, line1: '123 PALM AVE.' } }))
        .expect(400);
    });

    it.each([
      ['a two-letter state', { pickup: { ...HOME, state: 'Florida' } }],
      ['a 5-digit ZIP', { pickup: { ...HOME, zip: '336' } }],
      ['a street address', { pickup: { ...HOME, line1: '' } }],
      ['a known care level', { careLevel: 'HELICOPTER' }],
      ['a known trip kind', { tripKind: 'ONE_WAY_ISH' }],
      ['a time zone on the pickup time', { pickupAt: '2026-11-01T09:00:00' }],
      ['a real date', { pickupAt: '2026-13-45T09:00:00Z' }],
      ['no extra fields', { promoCode: 'FREE' }],
    ])('requires %s', async (_label, overrides) => {
      await client.post('/quotes', body(overrides)).expect(400);
    });

    it('requires a signed-in customer', async () => {
      await browser(app).post('/quotes', body()).expect(401);
    });

    it('requires the website origin', async () => {
      await request(app.getHttpServer())
        .post('/quotes')
        .send(body())
        .expect(403);
    });
  });
});
