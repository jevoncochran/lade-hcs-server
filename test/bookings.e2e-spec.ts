import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { BookingStatus, CareLevel } from '../src/generated/prisma/client.js';
import type { LogMailer } from '../src/mail/mailer.js';
import type { Address } from '../src/mileage/address.js';
import {
  DistanceProvider,
  UnknownAddressError,
} from '../src/mileage/distance-provider.js';
import { PaymentGateway } from '../src/payments/payment-gateway.js';
import { METERS_PER_MILE } from '../src/pricing/pricing.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import {
  browser,
  createTestApp,
  resetBookingTables,
  resetAccountTables,
  signedInCustomer,
  tokenFromLastEmail,
  uniqueEmail,
} from './helpers.js';

const HOUR_MS = 60 * 60 * 1000;

const address = (line1: string, state = 'FL'): Address => ({
  line1,
  city: 'Tampa',
  state,
  zip: '33603',
});
const HOME = address('123 Palm Ave');
const CLINIC = address('500 Clinic Way'); // 10 mi there, 11 mi back
const FAR = address('900 Far Rd'); // 60 mi
const NOWHERE = address('0 Nowhere Ln');

const MILES: Record<string, number> = {
  '123 Palm Ave>500 Clinic Way': 10,
  '500 Clinic Way>123 Palm Ave': 11,
  '123 Palm Ave>900 Far Rd': 60,
};
const fakeDistances = {
  isEstimate: false,
  drivingDistance: async (from: Address, to: Address) => {
    if (from.line1 === NOWHERE.line1) throw new UnknownAddressError('from');
    if (to.line1 === NOWHERE.line1) throw new UnknownAddressError('to');
    return (MILES[`${from.line1}>${to.line1}`] ?? 5) * METERS_PER_MILE;
  },
};

const inHours = (hours: number) =>
  new Date(Date.now() + hours * HOUR_MS).toISOString();

const body = (overrides: object = {}) => ({
  idempotencyKey: randomUUID(),
  careLevel: CareLevel.WHEELCHAIR,
  tripKind: 'ONE_WAY',
  tripType: 'MEDICAL_APPOINTMENT',
  pickup: HOME,
  dropoff: CLINIC,
  pickupAt: inHours(48),
  requesterRelationship: 'SELF',
  acceptTerms: true,
  ...overrides,
});

describe('Bookings (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let mailer: LogMailer;
  let client: Awaited<ReturnType<typeof signedInCustomer>>;

  beforeAll(async () => {
    ({ app, prisma, mailer } = await createTestApp(AppModule, (builder) =>
      builder.overrideProvider(DistanceProvider).useValue(fakeDistances),
    ));
    await resetBookingTables(prisma);
    await resetAccountTables(prisma);
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
      ],
    });
    client = await signedInCustomer(app, mailer);
  });

  afterAll(async () => {
    await resetBookingTables(prisma);
    await prisma.pricingRule.deleteMany();
    await app.close();
  });

  describe('creating a booking', () => {
    it('saves a one-way booking for the account holder and starts card setup', async () => {
      const response = await client.post('/bookings', body()).expect(201);
      const { booking, payment } = response.body;

      expect(booking).toMatchObject({
        reference: expect.stringMatching(/^LD-[A-HJ-KM-NP-Z2-9]{6}$/),
        status: 'PENDING_PAYMENT',
        careLevel: 'WHEELCHAIR',
        tripKind: 'ONE_WAY',
        rider: { firstName: 'Dana', lastName: 'Smith', phone: '813-555-0100' },
        legs: [
          {
            direction: 'OUTBOUND',
            willCall: false,
            pickup: HOME,
            dropoff: CLINIC,
          },
        ],
        price: {
          totalCents: 11500,
          billableMiles: 10,
          currency: 'usd',
          distanceIsEstimate: false,
        },
      });
      expect(payment).toEqual({
        provider: 'fake',
        publishableKey: null, // no card form with the fake gateway
        clientSecret: expect.stringMatching(/^fake_seti_.+_secret_fake$/),
      });

      // Stored encrypted; payment, history and audit rows exist.
      const [raw] = await prisma.$queryRaw<
        { riderLastName: string; requesterEmail: string }[]
      >`SELECT "riderLastName", "requesterEmail" FROM "Booking" WHERE id = ${booking.id}::uuid`;
      expect(raw.riderLastName).toMatch(/^v1:/);
      expect(raw.requesterEmail).toMatch(/^v1:/);
      const [leg] = await prisma.$queryRaw<
        { pickupAddress: string }[]
      >`SELECT "pickupAddress" FROM "TripLeg" WHERE "bookingId" = ${booking.id}::uuid`;
      expect(leg.pickupAddress).toMatch(/^v1:/);

      expect(
        await prisma.payment.findFirstOrThrow({
          where: { bookingId: booking.id },
        }),
      ).toMatchObject({
        status: 'CARD_PENDING',
        amountCents: 11500,
        stripeSetupIntentId: expect.stringMatching(/^fake_seti_/),
      });
      expect(
        await prisma.bookingEvent.count({ where: { bookingId: booking.id } }),
      ).toBe(1);
      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'booking.created', entityId: booking.id },
      });
      expect(JSON.stringify(audit)).not.toMatch(/Palm|Clinic|Smith/);
    });

    it('never trusts a price from the website', async () => {
      await client.post('/bookings', body({ totalCents: 100 })).expect(400);
    });

    it('returns the same booking when the checkout is submitted twice', async () => {
      const request = body();
      const first = await client.post('/bookings', request).expect(201);
      const second = await client.post('/bookings', request).expect(201);

      expect(second.body.booking.id).toBe(first.body.booking.id);
      expect(second.body.payment.clientSecret).toBe(
        first.body.payment.clientSecret,
      );
      expect(
        await prisma.booking.count({
          where: { idempotencyKey: request.idempotencyKey },
        }),
      ).toBe(1);
    });

    it('does not start a second card setup for a resubmitted checkout', async () => {
      const gateway = app.get(PaymentGateway);
      const setup = vi.spyOn(gateway, 'createCardSetup');
      const request = body();

      await client.post('/bookings', request).expect(201);
      await client.post('/bookings', request).expect(201);

      expect(setup).toHaveBeenCalledTimes(1);
      setup.mockRestore();
    });

    it("refuses another customer's checkout key", async () => {
      const request = body();
      await client.post('/bookings', request).expect(201);
      const other = await signedInCustomer(app, mailer);

      await other.post('/bookings', request).expect(409);
    });

    it('reuses one payment-provider customer per account', async () => {
      await client.post('/bookings', body()).expect(201);
      await client.post('/bookings', body()).expect(201);

      const ids = await prisma.payment.findMany({
        where: { booking: { customer: { isNot: null } } },
        select: {
          stripeCustomerId: true,
          booking: { select: { customerId: true } },
        },
      });
      const byCustomer = new Map<string, Set<string>>();
      for (const row of ids) {
        const key = row.booking.customerId!;
        byCustomer.set(
          key,
          (byCustomer.get(key) ?? new Set()).add(row.stripeCustomerId),
        );
      }
      for (const set of byCustomer.values()) expect(set.size).toBe(1);
    });
  });

  describe('trip kinds', () => {
    it('round trip with a set return time', async () => {
      const returnPickupAt = inHours(52);
      const response = await client
        .post(
          '/bookings',
          body({
            careLevel: 'AMBULATORY',
            tripKind: 'ROUND_TRIP',
            returnPickupAt,
          }),
        )
        .expect(201);
      const { legs, price } = response.body.booking;

      expect(legs.map((l: { direction: string }) => l.direction)).toEqual([
        'OUTBOUND',
        'RETURN',
      ]);
      expect(legs[1]).toMatchObject({
        pickupAt: returnPickupAt,
        willCall: false,
        pickup: CLINIC,
        dropoff: HOME,
      });
      // $100 + 21 mi × $3.50
      expect(price.totalCents).toBe(17350);
    });

    it('round trip where the rider calls when ready', async () => {
      const response = await client
        .post(
          '/bookings',
          body({ tripKind: 'ROUND_TRIP', returnWillCall: true }),
        )
        .expect(201);

      expect(response.body.booking.legs[1]).toMatchObject({
        pickupAt: null,
        willCall: true,
      });
    });

    it('wait and return, with an expected wait', async () => {
      const response = await client
        .post(
          '/bookings',
          body({ tripKind: 'WAIT_AND_RETURN', expectedWaitMinutes: 45 }),
        )
        .expect(201);

      expect(response.body.booking.legs[1]).toMatchObject({
        direction: 'RETURN',
        pickupAt: null,
        willCall: false,
        expectedWaitMinutes: 45,
      });
    });

    it('booking for someone else stores their name', async () => {
      const response = await client
        .post(
          '/bookings',
          body({
            requesterRelationship: 'FAMILY_CAREGIVER',
            riderFirstName: 'Mary',
            riderLastName: 'Smith',
            riderPhone: '813-555-0199',
            mobilityNotes: 'Power chair',
          }),
        )
        .expect(201);

      expect(response.body.booking).toMatchObject({
        rider: { firstName: 'Mary', lastName: 'Smith', phone: '813-555-0199' },
        mobilityNotes: 'Power chair',
      });
    });
  });

  describe('refusals', () => {
    it.each([
      ['round trip with no return plan', { tripKind: 'ROUND_TRIP' }],
      [
        'round trip with both a return time and will-call',
        {
          tripKind: 'ROUND_TRIP',
          returnPickupAt: inHours(52),
          returnWillCall: true,
        },
      ],
      [
        'a return before the first pickup',
        { tripKind: 'ROUND_TRIP', returnPickupAt: inHours(47) },
      ],
      ['a one-way trip with a return time', { returnPickupAt: inHours(52) }],
      [
        'a wait-and-return trip with a return time',
        { tripKind: 'WAIT_AND_RETURN', returnPickupAt: inHours(52) },
      ],
      ['an appointment before pickup', { appointmentAt: inHours(47) }],
      [
        'someone else with no rider name',
        { requesterRelationship: 'FAMILY_CAREGIVER' },
      ],
      ['unaccepted terms', { acceptTerms: false }],
      ['a bad checkout key', { idempotencyKey: 'abc' }],
      ['too many companions', { companionCount: 5 }],
      ['the same pickup and drop-off', { dropoff: HOME }],
    ])('400 for %s', async (_label, overrides) => {
      await client.post('/bookings', body(overrides)).expect(400);
    });

    it.each([
      ['SHORT_NOTICE', { pickupAt: inHours(3) }],
      ['LONG_DISTANCE', { dropoff: FAR }],
      ['NO_RATE', { careLevel: 'STRETCHER' }],
    ])(
      '422 %s with the same message as the quote',
      async (reason, overrides) => {
        const response = await client
          .post('/bookings', body(overrides))
          .expect(422);

        expect(response.body).toMatchObject({
          reason,
          message: expect.stringMatching(/please call us/i),
        });
      },
    );

    it('422 naming the address the map could not find', async () => {
      const response = await client
        .post('/bookings', body({ dropoff: NOWHERE }))
        .expect(422);

      expect(response.body).toMatchObject({ field: 'dropoff' });
    });

    it('saves nothing when a booking is refused', async () => {
      const before = await prisma.booking.count();
      await client
        .post('/bookings', body({ careLevel: 'STRETCHER' }))
        .expect(422);
      expect(await prisma.booking.count()).toBe(before);
    });

    it('requires a confirmed email', async () => {
      const unverified = browser(app);
      const email = uniqueEmail('unverified');
      await unverified
        .post('/auth/signup', {
          firstName: 'Una',
          lastName: 'Verified',
          email,
          phone: '813-555-0111',
          password: 'unverified pass',
          acceptTerms: true,
        })
        .expect(202);
      await unverified
        .post('/auth/login', { email, password: 'unverified pass' })
        .expect(204);

      await unverified.post('/bookings', body()).expect(403);

      // Confirming the email unlocks booking.
      await unverified
        .post('/auth/verify-email', {
          token: tokenFromLastEmail(mailer, email),
        })
        .expect(200);
      await unverified.post('/bookings', body()).expect(201);
    });

    it('requires a signed-in customer', async () => {
      await browser(app).post('/bookings', body()).expect(401);
    });
  });

  describe('confirming the card (fake gateway)', () => {
    it('moves the booking to REQUESTED, once', async () => {
      const created = await client.post('/bookings', body()).expect(201);
      const id = created.body.booking.id;

      const saved = await client
        .post(`/bookings/${id}/confirm-card`)
        .expect(200);
      expect(saved.body.status).toBe('REQUESTED');
      // Safe to repeat.
      await client.post(`/bookings/${id}/confirm-card`).expect(200);

      expect(
        await prisma.payment.findFirstOrThrow({ where: { bookingId: id } }),
      ).toMatchObject({
        status: 'CARD_SAVED',
        stripePaymentMethodId: 'fake_pm_test_card',
      });
      expect(
        await prisma.bookingEvent.findMany({
          where: { bookingId: id },
          select: { fromStatus: true, toStatus: true },
          orderBy: { createdAt: 'asc' },
        }),
      ).toEqual([
        { fromStatus: null, toStatus: 'PENDING_PAYMENT' },
        { fromStatus: 'PENDING_PAYMENT', toStatus: 'REQUESTED' },
      ]);

      // Resubmitting the checkout now returns no card form.
      const list = await client.get('/bookings').expect(200);
      expect(list.body.map((b: { id: string }) => b.id)).toContain(id);
    });

    it("can't be used on someone else's booking", async () => {
      const created = await client.post('/bookings', body()).expect(201);
      const other = await signedInCustomer(app, mailer);

      await other
        .post(`/bookings/${created.body.booking.id}/confirm-card`)
        .expect(404);
    });
  });

  describe('viewing bookings', () => {
    it('lists only real bookings, newest first', async () => {
      const created = await client.post('/bookings', body()).expect(201);
      const id = created.body.booking.id;

      // Card not saved yet: not listed.
      let list = await client.get('/bookings').expect(200);
      expect(list.body.map((b: { id: string }) => b.id)).not.toContain(id);

      // Once the card is saved the booking is REQUESTED and shows up.
      await prisma.booking.update({
        where: { id },
        data: { status: BookingStatus.REQUESTED },
      });
      list = await client.get('/bookings').expect(200);
      expect(list.body[0].id).toBe(id);
    });

    it('shows one booking to its owner only', async () => {
      const created = await client.post('/bookings', body()).expect(201);
      const id = created.body.booking.id;

      const mine = await client.get(`/bookings/${id}`).expect(200);
      expect(mine.body.reference).toBe(created.body.booking.reference);

      const other = await signedInCustomer(app, mailer);
      await other.get(`/bookings/${id}`).expect(404);
      await client.get(`/bookings/${randomUUID()}`).expect(404);
      await client.get('/bookings/not-a-uuid').expect(400);
    });
  });
});
