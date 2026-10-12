import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { configureApp } from '../src/app.setup.js';
import { LogMailer, Mailer } from '../src/mail/mailer.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

export const SITE_URL = 'http://localhost:3000';

// Boots the full app (same pipeline as main.ts) against lade_hcs_test.
// Pass `AppModule` in: test files that change env vars must import it only
// after changing them.
export const createTestApp = async (
  appModule: unknown,
  // e.g. (builder) => builder.overrideProvider(X).useValue(fake)
  customize: (builder: TestingModuleBuilder) => TestingModuleBuilder = (b) => b,
) => {
  const moduleRef = await customize(
    Test.createTestingModule({ imports: [appModule as never] }),
  ).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({
    logger: ['error', 'warn'],
    rawBody: true, // same as main.ts
  });
  configureApp(app);
  await app.init();

  return {
    app: app as INestApplication<App>,
    prisma: app.get(PrismaService),
    mailer: app.get(Mailer) as LogMailer,
  };
};

// A browser-like client: keeps cookies and sends the site's Origin header on
// every request, like the real website would.
export const browser = (app: INestApplication<App>) => {
  const agent = request.agent(app.getHttpServer());
  return {
    agent,
    get: (path: string) => agent.get(path).set('Origin', SITE_URL),
    post: (path: string, body?: object) =>
      agent
        .post(path)
        .set('Origin', SITE_URL)
        .send(body ?? {}),
  };
};

// Pulls the one-time token out of the most recent email to `to`.
export const tokenFromLastEmail = (mailer: LogMailer, to: string) => {
  const message = mailer.sent.findLast((m) => m.to === to);
  const token = message?.text.match(/[?&]token=([\w-]+)/)?.[1];
  if (!token) throw new Error(`No email with a token sent to ${to}`);
  return token;
};

// Refuses to run against anything but a test database.
const assertTestDatabase = async (prisma: PrismaService) => {
  const [{ name }] = await prisma.$queryRaw<
    { name: string }[]
  >`SELECT current_database() AS name`;
  if (!/_(test|ci)$/.test(name)) {
    throw new Error(
      `Refusing to wipe tables in "${name}": not a test database`,
    );
  }
};

// Wipes account data between test files. Test database only.
export const resetAccountTables = async (prisma: PrismaService) => {
  await assertTestDatabase(prisma);
  await prisma.$executeRawUnsafe(
    'TRUNCATE "AuditLog", "CustomerToken", "CustomerSession", "Customer", ' +
      '"StaffSession", "StaffInvite", "StaffUser" CASCADE',
  );
};

// Wipes bookings and everything hanging off them (payments, legs, charges,
// history). Test database only.
export const resetBookingTables = async (prisma: PrismaService) => {
  await assertTestDatabase(prisma);
  await prisma.$executeRawUnsafe(
    'TRUNCATE "Payment", "BookingCharge", "BookingEvent", "TripLeg", "Booking" CASCADE',
  );
};

export const uniqueEmail = (label: string) =>
  `${label}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@example.com`;

// Signs up, verifies and signs in a new customer; returns their browser.
export const signedInCustomer = async (
  app: INestApplication<App>,
  mailer: LogMailer,
) => {
  const email = uniqueEmail('customer');
  const password = 'customer passphrase';
  const client = browser(app);
  await client
    .post('/auth/signup', {
      firstName: 'Dana',
      lastName: 'Smith',
      email,
      phone: '813-555-0100',
      password,
      acceptTerms: true,
    })
    .expect(202);
  await client
    .post('/auth/verify-email', { token: tokenFromLastEmail(mailer, email) })
    .expect(200);
  await client.post('/auth/login', { email, password }).expect(204);
  return client;
};
