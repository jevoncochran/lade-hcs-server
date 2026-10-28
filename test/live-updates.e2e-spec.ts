import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { CareLevel } from '../src/generated/prisma/client.js';
import type { LogMailer } from '../src/mail/mailer.js';
import type { Address } from '../src/mileage/address.js';
import { DistanceProvider } from '../src/mileage/distance-provider.js';
import { METERS_PER_MILE } from '../src/pricing/pricing.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { STAFF_IDLE_MS } from '../src/staff-auth/staff-session.service.js';
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

// Pages ask GET …/changes every few seconds and reload when the answer
// changes. These checks must notice changes, reveal nothing, leave no audit
// entries, and never keep a session alive.
describe('Live updates (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let mailer: LogMailer;
  let customer: Awaited<ReturnType<typeof signedInCustomer>>;
  let other: Awaited<ReturnType<typeof signedInCustomer>>;
  let staff: Awaited<ReturnType<typeof signedInStaff>>;

  const book = async (client: typeof customer) => {
    const created = await client
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
      })
      .expect(201);
    const id: string = created.body.booking.id;
    await client.post(`/bookings/${id}/confirm-card`).expect(200);
    return id;
  };

  const staffVersion = async () =>
    (await staff.get('/staff/bookings/changes').expect(200)).body.version;
  const customerVersion = async (client = customer) =>
    (await client.get('/bookings/changes').expect(200)).body.version;

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
    customer = await signedInCustomer(app, mailer);
    other = await signedInCustomer(app, mailer);
    staff = await signedInStaff(app);
  });

  afterAll(async () => {
    await resetBookingTables(prisma);
    await prisma.pricingRule.deleteMany();
    await app.close();
  });

  it('changes when a booking changes, and only then', async () => {
    const id = await book(customer);
    const staffBefore = await staffVersion();
    const customerBefore = await customerVersion();
    expect(await staffVersion()).toBe(staffBefore);
    expect(await customerVersion()).toBe(customerBefore);

    // Staff confirm: the customer's page notices.
    await staff.post(`/staff/bookings/${id}/confirm`).expect(200);
    const customerAfterConfirm = await customerVersion();
    expect(customerAfterConfirm).not.toBe(customerBefore);
    const staffAfterConfirm = await staffVersion();
    expect(staffAfterConfirm).not.toBe(staffBefore);

    // The customer cancels: the staff page notices.
    await customer.post(`/bookings/${id}/cancel`).expect(200);
    expect(await staffVersion()).not.toBe(staffAfterConfirm);
    expect(await customerVersion()).not.toBe(customerAfterConfirm);
  });

  it("only follows a customer's own bookings", async () => {
    const before = await customerVersion(other);
    const id = await book(customer);
    await staff.post(`/staff/bookings/${id}/confirm`).expect(200);
    expect(await customerVersion(other)).toBe(before);
  });

  it('reveals nothing and leaves no audit entries', async () => {
    const { body } = await staff.get('/staff/bookings/changes').expect(200);
    expect(Object.keys(body)).toEqual(['version']);
    expect(body.version).toMatch(/^[\w-]{16}$/);

    const before = await prisma.auditLog.count();
    await staffVersion();
    await customerVersion();
    expect(await prisma.auditLog.count()).toBe(before);
  });

  it('needs the right sign-in', async () => {
    await browser(app).get('/staff/bookings/changes').expect(401);
    await customer.get('/staff/bookings/changes').expect(401);
    await browser(app).get('/bookings/changes').expect(401);
  });

  it("doesn't keep an idle staff session alive", async () => {
    const watcher = await signedInStaff(app);
    const session = await prisma.staffSession.findFirstOrThrow({
      orderBy: { createdAt: 'desc' },
    });
    const idleSince = new Date(Date.now() - STAFF_IDLE_MS + 2 * MINUTE_MS);
    await prisma.staffSession.update({
      where: { id: session.id },
      data: { lastSeenAt: idleSince },
    });

    // Checking for changes works but doesn't count as activity…
    await watcher.get('/staff/bookings/changes').expect(200);
    expect(
      (
        await prisma.staffSession.findUniqueOrThrow({
          where: { id: session.id },
        })
      ).lastSeenAt,
    ).toEqual(idleSince);

    // …so the 15-minute automatic sign-out still happens.
    await prisma.staffSession.update({
      where: { id: session.id },
      data: { lastSeenAt: new Date(Date.now() - STAFF_IDLE_MS - MINUTE_MS) },
    });
    await watcher.get('/staff/bookings/changes').expect(401);
  });

  it('still counts real page loads as activity', async () => {
    const worker = await signedInStaff(app);
    const session = await prisma.staffSession.findFirstOrThrow({
      orderBy: { createdAt: 'desc' },
    });
    const earlier = new Date(Date.now() - 5 * MINUTE_MS);
    await prisma.staffSession.update({
      where: { id: session.id },
      data: { lastSeenAt: earlier },
    });
    await worker.get('/staff/bookings').expect(200);
    expect(
      (
        await prisma.staffSession.findUniqueOrThrow({
          where: { id: session.id },
        })
      ).lastSeenAt.getTime(),
    ).toBeGreaterThan(earlier.getTime());
  });
});
