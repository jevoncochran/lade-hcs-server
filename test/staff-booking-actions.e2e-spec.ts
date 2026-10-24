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
import { FAKE_DECLINED_CARD } from '../src/payments/providers/fake-payment.gateway.js';
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

// Wheelchair rates used below.
const ONE_WAY = 7500;
const ROUND_TRIP = 15000;
const PER_MILE = 400; // every leg is 10 mi
const NO_SHOW_FEE = 7500;
const LATE_CANCEL_FEE = 3750;

describe('Staff booking actions (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let mailer: LogMailer;
  let customer: Awaited<ReturnType<typeof signedInCustomer>>;
  let staff: Awaited<ReturnType<typeof signedInStaff>>;
  let admin: Awaited<ReturnType<typeof signedInStaff>>;

  // A REQUESTED booking (card saved) picked up in 2 days.
  const book = async (overrides: object = {}) => {
    const created = await customer
      .post('/bookings', {
        idempotencyKey: randomUUID(),
        careLevel: CareLevel.WHEELCHAIR,
        tripKind: 'ONE_WAY',
        tripType: 'MEDICAL_APPOINTMENT',
        pickup: HOME,
        dropoff: CLINIC,
        pickupAt: new Date(Date.now() + 48 * 60 * MINUTE_MS).toISOString(),
        requesterRelationship: 'SELF',
        acceptTerms: true,
        ...overrides,
      })
      .expect(201);
    const id: string = created.body.booking.id;
    await customer.post(`/bookings/${id}/confirm-card`).expect(200);
    return id;
  };

  const confirmed = async (overrides: object = {}) => {
    const id = await book(overrides);
    await staff.post(`/staff/bookings/${id}/confirm`).expect(200);
    return id;
  };

  // Moves the pickup to `minutes` from now (negative: already passed).
  const pickupIn = (id: string, minutes: number) =>
    prisma.tripLeg.updateMany({
      where: { bookingId: id, direction: LegDirection.OUTBOUND },
      data: { pickupAt: new Date(Date.now() + minutes * MINUTE_MS) },
    });

  const payment = (id: string) =>
    prisma.payment.findFirstOrThrow({ where: { bookingId: id } });

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
        oneWayBaseCents: ONE_WAY,
        roundTripBaseCents: ROUND_TRIP,
        perMileCents: PER_MILE,
        noShowFeeCents: NO_SHOW_FEE,
        lateCancelFeeCents: LATE_CANCEL_FEE,
      },
    });
    customer = await signedInCustomer(app, mailer);
    staff = await signedInStaff(app);
    admin = await signedInStaff(app, StaffRole.ADMIN);
  });

  afterAll(async () => {
    await resetBookingTables(prisma);
    await prisma.pricingRule.deleteMany();
    await app.close();
  });

  describe('access', () => {
    it('requires a staff sign-in and the site Origin', async () => {
      const id = await book();
      await browser(app).post(`/staff/bookings/${id}/confirm`).expect(401);
      await customer.post(`/staff/bookings/${id}/confirm`).expect(401);
      // No Origin header: refused as a possible cross-site request.
      await staff.agent.post(`/staff/bookings/${id}/confirm`).expect(403);
    });
  });

  describe('confirming', () => {
    it('confirms a request once, and records who did it', async () => {
      const id = await book();
      const { body } = await staff
        .post(`/staff/bookings/${id}/confirm`)
        .expect(200);

      expect(body.status).toBe('CONFIRMED');
      expect(body.actions).toMatchObject({
        confirm: false,
        cancel: { allowed: true, feeCents: null },
        complete: { allowed: false },
      });
      expect(body.history.at(-1)).toMatchObject({
        fromStatus: 'REQUESTED',
        toStatus: 'CONFIRMED',
        actorType: 'STAFF',
        staffName: 'Dispatch Desk',
      });

      const again = await staff
        .post(`/staff/bookings/${id}/confirm`)
        .expect(409);
      expect(again.body.message).toMatch(/confirmed, so it can't be confirmed/);
    });
  });

  describe('cancelling', () => {
    it('declines a request free and lets go of the card', async () => {
      const id = await book();
      const { body } = await staff
        .post(`/staff/bookings/${id}/cancel`, { reason: 'No driver available' })
        .expect(200);

      expect(body).toMatchObject({
        status: 'CANCELLED',
        cancellationReason: 'No driver available',
        charges: [],
        chargesTotalCents: 0,
        payment: { status: 'CANCELED', amountCents: 0 },
      });
      expect(body.legs.map((leg: { status: string }) => leg.status)).toEqual([
        'CANCELLED',
      ]);
      expect(body.history.at(-1)).toMatchObject({
        toStatus: 'CANCELLED',
        note: 'No driver available',
      });
    });

    it('needs a reason', async () => {
      const id = await book();
      await staff.post(`/staff/bookings/${id}/cancel`, {}).expect(400);
      await staff
        .post(`/staff/bookings/${id}/cancel`, { reason: '   ' })
        .expect(400);
    });

    it('is free for a confirmed ride more than 2 hours away', async () => {
      const id = await confirmed();
      await pickupIn(id, 121);
      const { body } = await staff
        .post(`/staff/bookings/${id}/cancel`, { reason: 'Appointment moved' })
        .expect(200);
      expect(body).toMatchObject({
        charges: [],
        payment: { status: 'CANCELED' },
      });
    });

    it('charges the late-cancel fee inside 2 hours', async () => {
      const id = await confirmed();
      await pickupIn(id, 90);

      const before = await staff.get(`/staff/bookings/${id}`).expect(200);
      expect(before.body.actions.cancel).toEqual({
        allowed: true,
        feeCents: LATE_CANCEL_FEE,
      });

      const { body } = await staff
        .post(`/staff/bookings/${id}/cancel`, { reason: 'Rider is sick' })
        .expect(200);
      expect(body).toMatchObject({
        charges: [{ type: 'LATE_CANCELLATION', amountCents: LATE_CANCEL_FEE }],
        chargesTotalCents: LATE_CANCEL_FEE,
        payment: { status: 'CHARGED', amountCents: LATE_CANCEL_FEE },
      });
    });

    it('lets only admins waive the fee, with a reason', async () => {
      const id = await confirmed();
      await pickupIn(id, 30);

      await staff
        .post(`/staff/bookings/${id}/cancel`, {
          reason: 'Hospital delay',
          waiveFee: true,
          waiveReason: 'Not their fault',
        })
        .expect(403);
      await admin
        .post(`/staff/bookings/${id}/cancel`, {
          reason: 'Hospital delay',
          waiveFee: true,
        })
        .expect(400);

      const { body } = await admin
        .post(`/staff/bookings/${id}/cancel`, {
          reason: 'Hospital delay',
          waiveFee: true,
          waiveReason: 'Not their fault',
        })
        .expect(200);
      expect(body).toMatchObject({
        charges: [
          { type: 'LATE_CANCELLATION', amountCents: LATE_CANCEL_FEE },
          {
            type: 'ADJUSTMENT',
            amountCents: -LATE_CANCEL_FEE,
            note: 'Not their fault',
            staffName: 'Dispatch Desk',
          },
        ],
        chargesTotalCents: 0,
        payment: { status: 'CANCELED' },
      });
    });
  });

  describe('no-shows', () => {
    it('waits out the grace period, then charges the fee', async () => {
      const id = await confirmed({
        tripKind: 'ROUND_TRIP',
        returnWillCall: true,
      });
      await pickupIn(id, -10);
      const early = await staff
        .post(`/staff/bookings/${id}/no-show`)
        .expect(409);
      expect(early.body.message).toMatch(/15 minutes after the pickup time/);

      await pickupIn(id, -16);
      const { body } = await staff
        .post(`/staff/bookings/${id}/no-show`)
        .expect(200);
      expect(body).toMatchObject({
        status: 'NO_SHOW',
        charges: [
          { type: 'NO_SHOW', leg: 'OUTBOUND', amountCents: NO_SHOW_FEE },
        ],
        payment: { status: 'CHARGED', amountCents: NO_SHOW_FEE },
      });
      // The ride back is cancelled free.
      expect(body.legs.map((leg: { status: string }) => leg.status)).toEqual([
        'NO_SHOW',
        'CANCELLED',
      ]);
    });
  });

  describe('completing', () => {
    it("can't complete a ride before its pickup time", async () => {
      const id = await confirmed();
      await staff.post(`/staff/bookings/${id}/complete`, {}).expect(409);
    });

    it('charges fare, mileage and waiting time', async () => {
      const id = await confirmed();
      await pickupIn(id, -60);

      const { body } = await staff
        .post(`/staff/bookings/${id}/complete`, { outboundWaitMinutes: 40 })
        .expect(200);
      const total = ONE_WAY + 10 * PER_MILE + 2 * 1500;
      expect(body).toMatchObject({
        status: 'COMPLETED',
        charges: [
          { type: 'BASE_FARE', amountCents: ONE_WAY },
          { type: 'MILEAGE', quantity: 10, amountCents: 10 * PER_MILE },
          {
            type: 'WAIT_TIME',
            leg: 'OUTBOUND',
            quantity: 2,
            amountCents: 3000,
          },
        ],
        chargesTotalCents: total,
        payment: { status: 'CHARGED', amountCents: total },
        actions: { retryCharge: false, cancel: { allowed: false } },
      });
      expect(body.legs[0]).toMatchObject({
        status: 'COMPLETED',
        waitedMinutes: 40,
      });

      await staff.post(`/staff/bookings/${id}/complete`, {}).expect(409);
    });

    it('bills a round trip without the ride back as one-way', async () => {
      const id = await confirmed({
        tripKind: 'ROUND_TRIP',
        returnWillCall: true,
      });
      await pickupIn(id, -60);
      await staff.post(`/staff/bookings/${id}/complete`, {}).expect(400);

      const { body } = await staff
        .post(`/staff/bookings/${id}/complete`, { returnLeg: 'CANCELLED' })
        .expect(200);
      expect(body.chargesTotalCents).toBe(ONE_WAY + 10 * PER_MILE);
      expect(body.legs.map((leg: { status: string }) => leg.status)).toEqual([
        'COMPLETED',
        'CANCELLED',
      ]);
    });

    it('bills a full round trip with waiting at each stop', async () => {
      const id = await confirmed({
        tripKind: 'ROUND_TRIP',
        returnWillCall: true,
      });
      await pickupIn(id, -180);
      const { body } = await staff
        .post(`/staff/bookings/${id}/complete`, {
          outboundWaitMinutes: 20,
          returnLeg: 'COMPLETED',
          returnWaitMinutes: 31,
        })
        .expect(200);
      expect(body.charges.map((c: { type: string }) => c.type)).toEqual([
        'BASE_FARE',
        'MILEAGE',
        'WAIT_TIME',
        'WAIT_TIME',
      ]);
      expect(body.chargesTotalCents).toBe(
        ROUND_TRIP + 20 * PER_MILE + 1500 + 3000,
      );
    });

    it('rejects a ride back on a one-way trip, and silly waits', async () => {
      const id = await confirmed();
      await pickupIn(id, -60);
      await staff
        .post(`/staff/bookings/${id}/complete`, { returnLeg: 'COMPLETED' })
        .expect(400);
      await staff
        .post(`/staff/bookings/${id}/complete`, { outboundWaitMinutes: -5 })
        .expect(400);
      await staff
        .post(`/staff/bookings/${id}/complete`, { outboundWaitMinutes: 2.5 })
        .expect(400);
    });
  });

  describe('declined cards', () => {
    it('records the decline, then charges once on retry', async () => {
      const id = await confirmed();
      await pickupIn(id, -60);
      await prisma.payment.updateMany({
        where: { bookingId: id },
        data: { stripePaymentMethodId: FAKE_DECLINED_CARD },
      });

      const failed = await staff
        .post(`/staff/bookings/${id}/complete`, {})
        .expect(200);
      expect(failed.body).toMatchObject({
        status: 'COMPLETED',
        payment: { status: 'FAILED', failureCode: 'card_declined' },
        actions: { retryCharge: true },
      });

      // The customer sorts it out with their bank.
      await prisma.payment.updateMany({
        where: { bookingId: id },
        data: { stripePaymentMethodId: 'fake_pm_test_card' },
      });
      const retried = await staff
        .post(`/staff/bookings/${id}/retry-charge`)
        .expect(200);
      expect(retried.body).toMatchObject({
        payment: { status: 'CHARGED', failureCode: null },
        actions: { retryCharge: false },
      });
      expect(await payment(id)).toMatchObject({ chargeAttempts: 2 });

      await staff.post(`/staff/bookings/${id}/retry-charge`).expect(409);
    });
  });

  describe('emails', () => {
    // Emails about a booking, by its reference (in every subject).
    const emailsFor = async (id: string) => {
      const { reference } = await prisma.booking.findUniqueOrThrow({
        where: { id },
      });
      return mailer.sent.filter((m) => m.subject.includes(reference));
    };

    it('tells the customer and every active staff member about a new request', async () => {
      const id = await book();
      const sent = await emailsFor(id);

      expect(sent.map((m) => m.subject)).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/^We received your ride request LD-/),
          expect.stringMatching(/^New ride request LD-/),
        ]),
      );
      const staffAlert = sent.find((m) => m.subject.startsWith('New ride'))!;
      expect(staffAlert.text).toContain(`/admin/bookings/${id}`);

      // Saving the card again (website and webhook both) sends nothing new.
      await customer.post(`/bookings/${id}/confirm-card`).expect(200);
      expect(await emailsFor(id)).toHaveLength(sent.length);
    });

    it('confirms, and says a free cancellation is free', async () => {
      const id = await confirmed();
      await staff
        .post(`/staff/bookings/${id}/cancel`, { reason: 'Rider is better' })
        .expect(200);
      const subjects = (await emailsFor(id)).map((m) => m.subject);
      expect(subjects).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/is confirmed$/),
          expect.stringMatching(/was cancelled$/),
        ]),
      );
      const cancelled = (await emailsFor(id)).find((m) =>
        m.subject.endsWith('was cancelled'),
      )!;
      expect(cancelled.text).toContain("You haven't been charged.");
    });

    it('mentions a late-cancel fee that was charged', async () => {
      const id = await confirmed();
      await pickupIn(id, 30);
      await staff
        .post(`/staff/bookings/${id}/cancel`, { reason: 'Changed plans' })
        .expect(200);
      const cancelled = (await emailsFor(id)).find((m) =>
        m.subject.endsWith('was cancelled'),
      )!;
      expect(cancelled.text).toContain(
        'late-cancellation fee of $37.50 was charged',
      );
    });

    it('sends a receipt, or a decline notice and then a receipt on retry', async () => {
      const id = await confirmed();
      await pickupIn(id, -60);
      await prisma.payment.updateMany({
        where: { bookingId: id },
        data: { stripePaymentMethodId: FAKE_DECLINED_CARD },
      });
      await staff.post(`/staff/bookings/${id}/complete`, {}).expect(200);
      const total = ONE_WAY + 10 * PER_MILE;

      let subjects = (await emailsFor(id)).map((m) => m.subject);
      expect(subjects).toContainEqual(
        expect.stringMatching(/^We couldn't charge your card/),
      );
      expect(subjects).not.toContainEqual(expect.stringMatching(/^Receipt/));

      await prisma.payment.updateMany({
        where: { bookingId: id },
        data: { stripePaymentMethodId: 'fake_pm_test_card' },
      });
      await staff.post(`/staff/bookings/${id}/retry-charge`).expect(200);
      const receipt = (await emailsFor(id)).find((m) =>
        m.subject.startsWith('Receipt'),
      )!;
      expect(receipt.text).toContain(`$${(total / 100).toFixed(2)}`);
      subjects = (await emailsFor(id)).map((m) => m.subject);
      expect(subjects.filter((x) => x.startsWith('Receipt'))).toHaveLength(1);
    });

    it('never includes rider names, addresses or the cancellation reason', async () => {
      const id = await confirmed({
        requesterRelationship: 'FAMILY_CAREGIVER',
        riderFirstName: 'Robin',
        riderLastName: 'Okafor',
      });
      await staff
        .post(`/staff/bookings/${id}/cancel`, { reason: 'Dialysis moved' })
        .expect(200);
      const all = JSON.stringify(await emailsFor(id));
      expect(all).not.toMatch(/robin|okafor|dana|smith|palm|clinic|dialysis/i);
    });
  });

  describe('audit log', () => {
    it('records each action without the reasons (PHI)', async () => {
      const id = await book();
      await staff
        .post(`/staff/bookings/${id}/cancel`, { reason: 'Rider in hospital' })
        .expect(200);

      const entries = await prisma.auditLog.findMany({
        where: { entityId: id, action: { startsWith: 'staff.booking_' } },
      });
      expect(entries.map((entry) => entry.action)).toContain(
        'staff.booking_cancelled',
      );
      expect(JSON.stringify(entries)).not.toMatch(/hospital/i);
    });
  });
});
