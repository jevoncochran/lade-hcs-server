import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { dateIn } from '../src/common/zoned-date.js';
import {
  BookingStatus,
  CareLevel,
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

const HOUR_MS = 60 * 60 * 1000;
const ZONE = 'America/New_York'; // BUSINESS_TIMEZONE default

const HOME: Address = {
  line1: '123 Palm Ave',
  city: 'Tampa',
  state: 'FL',
  zip: '33603',
};
const CLINIC: Address = { ...HOME, line1: '500 Clinic Way' };

const inHours = (hours: number) => new Date(Date.now() + hours * HOUR_MS);

const body = (pickupAt: Date, overrides: object = {}) => ({
  idempotencyKey: randomUUID(),
  careLevel: CareLevel.WHEELCHAIR,
  tripKind: 'ONE_WAY',
  tripType: 'MEDICAL_APPOINTMENT',
  pickup: HOME,
  dropoff: CLINIC,
  pickupAt: pickupAt.toISOString(),
  requesterRelationship: 'SELF',
  acceptTerms: true,
  ...overrides,
});

const forFamily = (firstName: string, lastName: string) => ({
  requesterRelationship: 'FAMILY_CAREGIVER',
  riderFirstName: firstName,
  riderLastName: lastName,
});

describe('Staff bookings (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let mailer: LogMailer;
  let customer: Awaited<ReturnType<typeof signedInCustomer>>;
  let staff: Awaited<ReturnType<typeof signedInStaff>>;

  // Created in this order, picked up in this order (except `pending`).
  const pickups = {
    soon: inHours(48),
    roundTrip: inHours(96),
    later: inHours(144),
  };
  const ids = { soon: '', roundTrip: '', pending: '', later: '' };
  const refs = { soon: '', roundTrip: '', pending: '', later: '' };

  const book = async (
    pickupAt: Date,
    overrides: object = {},
    saveCard = true,
  ) => {
    const created = await customer
      .post('/bookings', body(pickupAt, overrides))
      .expect(201);
    const { id, reference } = created.body.booking;
    if (saveCard)
      await customer.post(`/bookings/${id}/confirm-card`).expect(200);
    return { id: id as string, reference: reference as string };
  };

  const list = async (query = '') =>
    (await staff.get(`/staff/bookings${query}`).expect(200)).body;
  const listedIds = async (query = '') =>
    (await list(query)).bookings.map((b: { id: string }) => b.id);

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
        lateCancelFeeCents: 3750,
      },
    });

    customer = await signedInCustomer(app, mailer); // Dana Smith
    staff = await signedInStaff(app);

    ({ id: ids.soon, reference: refs.soon } = await book(pickups.soon));
    ({ id: ids.roundTrip, reference: refs.roundTrip } = await book(
      pickups.roundTrip,
      {
        tripKind: 'ROUND_TRIP',
        returnWillCall: true,
        ...forFamily('Robin', 'Okafor'),
      },
    ));
    ({ id: ids.pending, reference: refs.pending } = await book(
      inHours(72),
      {},
      false,
    ));
    ({ id: ids.later, reference: refs.later } = await book(
      pickups.later,
      forFamily('Lee', 'Park'),
    ));
    await prisma.booking.update({
      where: { id: ids.later },
      data: { status: BookingStatus.CANCELLED },
    });
  });

  afterAll(async () => {
    await resetBookingTables(prisma);
    await prisma.pricingRule.deleteMany();
    await app.close();
  });

  describe('access', () => {
    it('requires a staff sign-in; a customer session is not enough', async () => {
      await browser(app).get('/staff/bookings').expect(401);
      await customer.get('/staff/bookings').expect(401);
      await customer.get(`/staff/bookings/${ids.soon}`).expect(401);
    });

    it('lets dispatchers and admins both see bookings', async () => {
      const admin = await signedInStaff(app, StaffRole.ADMIN);
      await admin.get('/staff/bookings').expect(200);
      await admin.get(`/staff/bookings/${ids.soon}`).expect(200);
    });

    it('is never cached', async () => {
      const response = await staff.get('/staff/bookings').expect(200);
      expect(response.headers['cache-control']).toBe('no-store');
    });
  });

  describe('listing', () => {
    it('shows upcoming bookings soonest first, without unpaid checkouts', async () => {
      const result = await list();

      expect(result).toMatchObject({ total: 3, page: 1, pageSize: 50 });
      expect(result.bookings.map((b: { id: string }) => b.id)).toEqual([
        ids.soon,
        ids.roundTrip,
        ids.later,
      ]);
      // Decrypted for staff.
      expect(result.bookings[0]).toEqual({
        id: ids.soon,
        reference: refs.soon,
        status: 'REQUESTED',
        careLevel: 'WHEELCHAIR',
        tripKind: 'ONE_WAY',
        tripType: 'MEDICAL_APPOINTMENT',
        rider: { firstName: 'Dana', lastName: 'Smith' },
        pickupAt: pickups.soon.toISOString(),
        pickup: HOME,
        dropoff: CLINIC,
        returnLeg: null,
        totalCents: 7500 + 10 * 400,
        paymentStatus: 'CARD_SAVED',
        createdAt: expect.any(String),
      });
      expect(result.bookings[1]).toMatchObject({
        rider: { firstName: 'Robin', lastName: 'Okafor' },
        returnLeg: { pickupAt: null, willCall: true },
      });
      // A list row leaves out notes and requester details.
      expect(result.bookings[0]).not.toHaveProperty('mobilityNotes');
      expect(result.bookings[0]).not.toHaveProperty('requester');
    });

    it('filters by status', async () => {
      expect(await listedIds('?status=CANCELLED')).toEqual([ids.later]);
      expect(await listedIds('?status=PENDING_PAYMENT')).toEqual([ids.pending]);
      expect(await listedIds('?status=REQUESTED,CONFIRMED')).toEqual([
        ids.soon,
        ids.roundTrip,
      ]);
      expect(await listedIds('?status=REQUESTED&status=CANCELLED')).toEqual([
        ids.soon,
        ids.roundTrip,
        ids.later,
      ]);
    });

    it('filters by pickup day in the business time zone', async () => {
      const day = dateIn(pickups.roundTrip, ZONE);
      expect(await listedIds(`?from=${day}&to=${day}`)).toEqual([
        ids.roundTrip,
      ]);
      expect(await listedIds(`?to=${dateIn(pickups.soon, ZONE)}`)).toEqual([
        ids.soon,
      ]);
      expect(await listedIds(`?from=${dateIn(pickups.later, ZONE)}`)).toEqual([
        ids.later,
      ]);
    });

    it('starts today by default, but searches cover every date', async () => {
      const past = await prisma.tripLeg.updateManyAndReturn({
        where: { bookingId: ids.soon },
        data: { pickupAt: inHours(-72) },
      });
      try {
        expect(await listedIds()).toEqual([ids.roundTrip, ids.later]);
        expect(await listedIds(`?reference=${refs.soon}`)).toEqual([ids.soon]);
        expect(await listedIds('?riderLastName=smith')).toEqual([ids.soon]);
      } finally {
        await prisma.tripLeg.update({
          where: { id: past[0].id },
          data: { pickupAt: pickups.soon },
        });
      }
    });

    it('finds a booking by reference or exact rider last name', async () => {
      expect(
        await listedIds(`?reference=${refs.roundTrip.toLowerCase()}`),
      ).toEqual([ids.roundTrip]);
      expect(await listedIds('?riderLastName=%20OKAFOR%20')).toEqual([
        ids.roundTrip,
      ]);
      // Exact match only: names are encrypted.
      expect(await listedIds('?riderLastName=Oka')).toEqual([]);
    });

    it('sorts newest first on request and pages', async () => {
      expect(await listedIds('?sort=newest')).toEqual([
        ids.later,
        ids.roundTrip,
        ids.soon,
      ]);
      const second = await list('?pageSize=2&page=2');
      expect(second).toMatchObject({ total: 3, page: 2, pageSize: 2 });
      expect(second.bookings.map((b: { id: string }) => b.id)).toEqual([
        ids.later,
      ]);
    });

    it.each([
      ['an unknown status', '?status=BOGUS'],
      ['an impossible date', '?from=2026-13-01'],
      ['a date with a time', '?from=2026-10-21T00:00:00Z'],
      ['a huge page', '?pageSize=500'],
      ['page zero', '?page=0'],
      ['an unknown sort', '?sort=name'],
      ['an unknown filter', '?riderPhone=8135550100'],
    ])('rejects %s', async (_label, query) => {
      await staff.get(`/staff/bookings${query}`).expect(400);
    });
  });

  describe('one booking', () => {
    it('shows everything, including who booked it, payment and history', async () => {
      const { body: booking } = await staff
        .get(`/staff/bookings/${ids.roundTrip}`)
        .expect(200);

      expect(booking).toMatchObject({
        id: ids.roundTrip,
        reference: refs.roundTrip,
        status: 'REQUESTED',
        rider: { firstName: 'Robin', lastName: 'Okafor' },
        requester: {
          relationship: 'FAMILY_CAREGIVER',
          name: 'Dana Smith',
          email: expect.stringMatching(/@example\.com$/),
          phone: '813-555-0100',
        },
        payment: {
          status: 'CARD_SAVED',
          amountCents: booking.price.totalCents,
          refundedCents: 0,
          failureCode: null,
        },
        cancelledAt: null,
        history: [
          {
            fromStatus: null,
            toStatus: 'PENDING_PAYMENT',
            actorType: 'CUSTOMER',
          },
          { fromStatus: 'PENDING_PAYMENT', toStatus: 'REQUESTED' },
        ],
      });
      expect(booking.legs).toEqual([
        expect.objectContaining({
          direction: 'OUTBOUND',
          status: 'SCHEDULED',
          pickup: HOME,
          dropoff: CLINIC,
          waitedMinutes: null,
          distanceMeters: Math.round(10 * METERS_PER_MILE),
        }),
        expect.objectContaining({
          direction: 'RETURN',
          willCall: true,
          pickup: CLINIC,
          dropoff: HOME,
        }),
      ]);
    });

    it('shows unpaid checkouts too', async () => {
      const { body: booking } = await staff
        .get(`/staff/bookings/${ids.pending}`)
        .expect(200);
      expect(booking).toMatchObject({
        status: 'PENDING_PAYMENT',
        payment: { status: 'CARD_PENDING' },
      });
    });

    it('404s for an unknown or deleted booking, 400 for a bad id', async () => {
      await staff.get(`/staff/bookings/${randomUUID()}`).expect(404);
      await staff.get('/staff/bookings/not-a-uuid').expect(400);

      await prisma.booking.update({
        where: { id: ids.pending },
        data: { deletedAt: new Date() },
      });
      try {
        await staff.get(`/staff/bookings/${ids.pending}`).expect(404);
        expect(await listedIds('?status=PENDING_PAYMENT')).toEqual([]);
      } finally {
        await prisma.booking.update({
          where: { id: ids.pending },
          data: { deletedAt: null },
        });
      }
    });
  });

  describe('audit log', () => {
    it('records who viewed which bookings, without patient details', async () => {
      const viewer = await signedInStaff(app);
      await viewer.get(`/staff/bookings/${ids.soon}`).expect(200);
      await viewer.get('/staff/bookings?riderLastName=Okafor').expect(200);

      const entries = await prisma.auditLog.findMany({
        where: { action: { startsWith: 'staff.booking' } },
        orderBy: { createdAt: 'desc' },
        take: 2,
      });
      const [listed, viewed] = entries;

      expect(viewed).toMatchObject({
        actorType: 'STAFF',
        action: 'staff.booking_viewed',
        entityType: 'Booking',
        entityId: ids.soon,
      });
      expect(listed).toMatchObject({
        actorType: 'STAFF',
        staffUserId: viewed.staffUserId,
        action: 'staff.bookings_listed',
        metadata: { bookingIds: [ids.roundTrip], byRiderLastName: true },
      });
      expect(JSON.stringify(entries)).not.toMatch(/okafor|smith|palm|clinic/i);
    });
  });
});
