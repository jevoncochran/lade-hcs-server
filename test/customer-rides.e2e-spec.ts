import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import {
  CareLevel,
  LegDirection,
  StaffRole,
} from '../src/generated/prisma/client.js';
import type { LogMailer } from '../src/mail/mailer.js';
import type { Address } from '../src/mileage/address.js';
import { DistanceProvider } from '../src/mileage/distance-provider.js';
import { METERS_PER_MILE } from '../src/pricing/pricing.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import {
  browser,
  createTestApp,
  resetAccountTables,
  resetBookingTables,
  signedInCustomer,
  signedInStaff,
} from './helpers.js';

const MINUTE_MS = 60 * 1000;
const HOME: Address = {
  line1: '123 Palm Ave',
  city: 'Tampa',
  state: 'FL',
  zip: '33603',
};
const CLINIC: Address = { ...HOME, line1: '500 Clinic Way' };
const LATE_CANCEL_FEE = 3750;

describe('Customer rides (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let mailer: LogMailer;
  let customer: Awaited<ReturnType<typeof signedInCustomer>>;
  let staff: Awaited<ReturnType<typeof signedInStaff>>;

  // A REQUESTED booking (card saved) picked up in 2 days.
  const book = async () => {
    const created = await customer
      .post('/bookings', {
        idempotencyKey: randomUUID(),
        careLevel: CareLevel.WHEELCHAIR,
        tripKind: 'ROUND_TRIP',
        returnWillCall: true,
        tripType: 'MEDICAL_APPOINTMENT',
        pickup: HOME,
        dropoff: CLINIC,
        pickupAt: new Date(Date.now() + 48 * 60 * MINUTE_MS).toISOString(),
        requesterRelationship: 'SELF',
        acceptTerms: true,
      })
      .expect(201);
    const id: string = created.body.booking.id;
    await customer.post(`/bookings/${id}/confirm-card`).expect(200);
    return id;
  };

  const confirmed = async () => {
    const id = await book();
    await staff.post(`/staff/bookings/${id}/confirm`).expect(200);
    return id;
  };

  const pickupIn = (id: string, minutes: number) =>
    prisma.tripLeg.updateMany({
      where: { bookingId: id, direction: LegDirection.OUTBOUND },
      data: { pickupAt: new Date(Date.now() + minutes * MINUTE_MS) },
    });

  const subjectsFor = async (id: string) => {
    const { reference } = await prisma.booking.findUniqueOrThrow({
      where: { id },
    });
    return mailer.sent
      .filter((m) => m.subject.includes(reference))
      .map((m) => m.subject);
  };

  beforeAll(async () => {
    ({ app, prisma, mailer } = await createTestApp(AppModule, (builder) =>
      builder.overrideProvider(DistanceProvider).useValue({
        isEstimate: false,
        drivingDistance: async () => 10 * METERS_PER_MILE,
      }),
    ));
    await resetBookingTables(prisma);
    await resetAccountTables(prisma);
    await prisma.pricingRule.deleteMany();
    await prisma.pricingRule.create({
      data: {
        careLevel: CareLevel.WHEELCHAIR,
        oneWayBaseCents: 7500,
        roundTripBaseCents: 15000,
        perMileCents: 400,
        noShowFeeCents: 7500,
        lateCancelFeeCents: LATE_CANCEL_FEE,
      },
    });
    customer = await signedInCustomer(app, mailer);
    staff = await signedInStaff(app);
  });

  afterAll(async () => {
    await resetBookingTables(prisma);
    await prisma.pricingRule.deleteMany();
    await app.close();
  });

  describe('viewing', () => {
    it('shows each ride with its progress, charges and cancel option', async () => {
      const id = await book();
      const { body } = await customer.get(`/bookings/${id}`).expect(200);

      expect(body).toMatchObject({
        status: 'REQUESTED',
        cancelledAt: null,
        charges: [],
        chargesTotalCents: 0,
        paymentStatus: 'CARD_SAVED',
        cancel: { allowed: true, feeCents: null },
      });
      expect(body.legs.map((leg: { status: string }) => leg.status)).toEqual([
        'SCHEDULED',
        'SCHEDULED',
      ]);

      const list = await customer.get('/bookings').expect(200);
      expect(list.body.find((b: { id: string }) => b.id === id)).toMatchObject({
        cancel: { allowed: true },
      });
    });

    it('shows the final charges once the ride is done', async () => {
      const id = await confirmed();
      await pickupIn(id, -60);
      await staff
        .post(`/staff/bookings/${id}/complete`, {
          returnLeg: 'COMPLETED',
          outboundWaitMinutes: 40,
        })
        .expect(200);

      const { body } = await customer.get(`/bookings/${id}`).expect(200);
      expect(body).toMatchObject({
        status: 'COMPLETED',
        paymentStatus: 'CHARGED',
        chargesTotalCents: 15000 + 20 * 400 + 3000,
        cancel: { allowed: false },
      });
      expect(body.charges.map((c: { type: string }) => c.type)).toEqual([
        'BASE_FARE',
        'MILEAGE',
        'WAIT_TIME',
      ]);
    });

    it("keeps staff notes out of the customer's view", async () => {
      const id = await confirmed();
      await pickupIn(id, 30);
      const admin = await signedInStaff(app, StaffRole.ADMIN);
      await admin
        .post(`/staff/bookings/${id}/cancel`, {
          reason: 'Hospital delay',
          waiveFee: true,
          waiveReason: 'Regular rider, first time',
        })
        .expect(200);

      const { body } = await customer.get(`/bookings/${id}`).expect(200);
      expect(body.chargesTotalCents).toBe(0);
      expect(JSON.stringify(body.charges)).not.toContain('Regular rider');
    });
  });

  describe('cancelling', () => {
    it('cancels a request free, and tells the customer and staff', async () => {
      const id = await book();
      const { body } = await customer
        .post(`/bookings/${id}/cancel`, { reason: 'Found another ride' })
        .expect(200);

      expect(body).toMatchObject({
        status: 'CANCELLED',
        cancelledAt: expect.any(String),
        charges: [],
        paymentStatus: 'CANCELED',
        cancel: { allowed: false },
      });
      expect(await subjectsFor(id)).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/^Your ride LD-\w+ was cancelled$/),
          expect.stringMatching(/was cancelled by the customer$/),
        ]),
      );

      // Staff see who cancelled and why.
      const staffView = await staff.get(`/staff/bookings/${id}`).expect(200);
      expect(staffView.body.history.at(-1)).toMatchObject({
        toStatus: 'CANCELLED',
        actorType: 'CUSTOMER',
        note: 'Found another ride',
      });
    });

    it("doesn't need a reason", async () => {
      const id = await book();
      await customer.post(`/bookings/${id}/cancel`).expect(200);
    });

    it('is free for a confirmed ride more than 2 hours away', async () => {
      const id = await confirmed();
      await pickupIn(id, 125);
      const { body } = await customer
        .post(`/bookings/${id}/cancel`)
        .expect(200);
      expect(body).toMatchObject({ charges: [], paymentStatus: 'CANCELED' });
    });

    it('charges the late-cancel fee only once the customer agreed to it', async () => {
      const id = await confirmed();
      await pickupIn(id, 90);

      const before = await customer.get(`/bookings/${id}`).expect(200);
      expect(before.body.cancel).toEqual({
        allowed: true,
        feeCents: LATE_CANCEL_FEE,
      });

      // Didn't see (or agree to) the fee: refused, nothing charged.
      const refused = await customer.post(`/bookings/${id}/cancel`).expect(409);
      expect(refused.body.message).toContain('$37.50');
      await customer
        .post(`/bookings/${id}/cancel`, { acceptedFeeCents: 1000 })
        .expect(409);

      const { body } = await customer
        .post(`/bookings/${id}/cancel`, { acceptedFeeCents: LATE_CANCEL_FEE })
        .expect(200);
      expect(body).toMatchObject({
        status: 'CANCELLED',
        charges: [{ type: 'LATE_CANCELLATION', amountCents: LATE_CANCEL_FEE }],
        paymentStatus: 'CHARGED',
      });
    });

    it('sends customers to call once the pickup time has passed', async () => {
      const id = await confirmed();
      await pickupIn(id, -5);
      const { body } = await customer.get(`/bookings/${id}`).expect(200);
      expect(body.cancel.allowed).toBe(false);

      const refused = await customer
        .post(`/bookings/${id}/cancel`, { acceptedFeeCents: 99999 })
        .expect(409);
      expect(refused.body.message).toMatch(/pickup time has passed/);
    });

    it("can't cancel twice, someone else's ride, or without signing in", async () => {
      const id = await book();
      await customer.post(`/bookings/${id}/cancel`).expect(200);
      const again = await customer.post(`/bookings/${id}/cancel`).expect(409);
      expect(again.body.message).toMatch(/can't be cancelled anymore/);

      const other = await signedInCustomer(app, mailer);
      const theirs = await book();
      await other.post(`/bookings/${theirs}/cancel`).expect(404);
      await browser(app).post(`/bookings/${theirs}/cancel`).expect(401);
      await staff.post(`/bookings/${theirs}/cancel`).expect(401);
    });

    it('audits the cancellation without the reason', async () => {
      const id = await book();
      await customer
        .post(`/bookings/${id}/cancel`, {
          reason: 'Rider admitted to hospital',
        })
        .expect(200);
      const entries = await prisma.auditLog.findMany({
        where: { entityId: id },
      });
      expect(entries.map((e) => e.action)).toContain(
        'booking.cancelled_by_customer',
      );
      expect(JSON.stringify(entries)).not.toMatch(/hospital/i);
    });
  });
});
