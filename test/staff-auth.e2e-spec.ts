import type { INestApplication } from '@nestjs/common';
import { generate } from 'otplib';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { StaffRole } from '../src/generated/prisma/client.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { StaffInviteService } from '../src/staff-auth/staff-invite.service.js';
import { STAFF_IDLE_MS } from '../src/staff-auth/staff-session.service.js';
import {
  browser,
  createTestApp,
  resetAccountTables,
  uniqueEmail,
} from './helpers.js';

const PASSWORD = 'staff passphrase 123';

// A code for the 30-second step `offset` steps from now. Each login must use
// a newer step than the last one (replay protection), so tests step forward.
const codeFor = (secret: string, offset = 0) =>
  generate({ secret, epoch: Math.floor(Date.now() / 1000) + offset * 30 });

describe('Staff accounts (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let invites: StaffInviteService;

  const tokenOf = (link: string) => new URL(link).searchParams.get('token')!;

  // Creates an invite (as the CLI does) and accepts it; returns the signed-in
  // browser and the MFA secret.
  const acceptedStaff = async (role: StaffRole = StaffRole.ADMIN) => {
    const email = uniqueEmail('staff');
    const { link } = await invites.createInvite(email, role, null);
    const token = tokenOf(link);
    const client = browser(app);

    // Same order as the setup page: scan, confirm the code, then details.
    const start = await client
      .post('/staff/invites/accept/start', { token })
      .expect(200);
    await client
      .post('/staff/invites/accept/verify-code', {
        token,
        mfaCode: await codeFor(start.body.secret),
      })
      .expect(200);
    await client
      .post('/staff/invites/accept/complete', {
        token,
        name: 'Owner One',
        password: PASSWORD,
      })
      .expect(204);

    return { client, email, secret: start.body.secret as string, token };
  };

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp(AppModule));
    invites = app.get(StaffInviteService);
    await resetAccountTables(prisma);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('invites', () => {
    it('creates a 48-hour invite link on the website', async () => {
      const before = Date.now();
      const { link, expiresAt } = await invites.createInvite(
        uniqueEmail('owner'),
        StaffRole.ADMIN,
        null,
      );

      expect(link).toMatch(
        /^http:\/\/localhost:3000\/admin\/accept-invite\?token=/,
      );
      expect(expiresAt.getTime() - before).toBeGreaterThanOrEqual(
        48 * 60 * 60 * 1000 - 1000,
      );
    });

    it('returns an authenticator QR code to start accepting', async () => {
      const email = uniqueEmail('qr');
      const { link } = await invites.createInvite(email, StaffRole.ADMIN, null);

      const start = await browser(app)
        .post('/staff/invites/accept/start', { token: tokenOf(link) })
        .expect(200);

      expect(start.body).toMatchObject({
        email,
        role: 'ADMIN',
        otpauthUrl: expect.stringMatching(/^otpauth:\/\/totp\//),
        qrCodeDataUrl: expect.stringMatching(/^data:image\/png;base64,/),
      });
    });

    it('rejects a wrong phone code, and will not finish without a right one', async () => {
      const email = uniqueEmail('wrongcode');
      const { link } = await invites.createInvite(email, StaffRole.ADMIN, null);
      const token = tokenOf(link);
      const client = browser(app);
      await client.post('/staff/invites/accept/start', { token }).expect(200);

      const wrong = await client
        .post('/staff/invites/accept/verify-code', { token, mfaCode: '000000' })
        .expect(400);
      expect(wrong.body.message).toMatch(/didn't match/);

      const complete = await client
        .post('/staff/invites/accept/complete', {
          token,
          name: 'Owner',
          password: PASSWORD,
        })
        .expect(400);
      expect(complete.body.message).toMatch(/Confirm the code from your phone/);

      expect(await prisma.staffUser.count({ where: { email } })).toBe(0);
    });

    it('accepts details long after the code, once the phone is confirmed', async () => {
      const email = uniqueEmail('slow');
      const { link } = await invites.createInvite(email, StaffRole.ADMIN, null);
      const token = tokenOf(link);
      const client = browser(app);
      const start = await client
        .post('/staff/invites/accept/start', { token })
        .expect(200);
      await client
        .post('/staff/invites/accept/verify-code', {
          token,
          mfaCode: await codeFor(start.body.secret),
        })
        .expect(200);

      // The person takes their time on name and password: no new code needed.
      await prisma.staffInvite.updateMany({
        where: { email },
        data: { mfaVerifiedAt: new Date(Date.now() - 10 * 60 * 1000) },
      });

      await client
        .post('/staff/invites/accept/complete', {
          token,
          name: 'Slow Typist',
          password: PASSWORD,
        })
        .expect(204);
    });

    it('needs the phone confirmed again after a new QR code', async () => {
      const email = uniqueEmail('rescan');
      const { link } = await invites.createInvite(email, StaffRole.ADMIN, null);
      const token = tokenOf(link);
      const client = browser(app);
      const first = await client
        .post('/staff/invites/accept/start', { token })
        .expect(200);
      await client
        .post('/staff/invites/accept/verify-code', {
          token,
          mfaCode: await codeFor(first.body.secret),
        })
        .expect(200);

      // Reloading the setup page makes a new QR code.
      await client.post('/staff/invites/accept/start', { token }).expect(200);

      await client
        .post('/staff/invites/accept/complete', {
          token,
          name: 'Rescanned',
          password: PASSWORD,
        })
        .expect(400);
    });

    it('signs the new staff member in; the invite then stops working', async () => {
      const { client, email, token, secret } = await acceptedStaff();

      const me = await client.get('/staff/auth/me').expect(200);
      expect(me.body).toEqual({
        id: expect.any(String),
        email,
        name: 'Owner One',
        role: 'ADMIN',
      });

      await browser(app)
        .post('/staff/invites/accept/verify-code', {
          token,
          mfaCode: await codeFor(secret, 1),
        })
        .expect(400);
      await browser(app)
        .post('/staff/invites/accept/complete', {
          token,
          name: 'Someone Else',
          password: PASSWORD,
        })
        .expect(400);
    });

    it('stores the MFA secret encrypted', async () => {
      const { email } = await acceptedStaff();
      const [raw] = await prisma.$queryRaw<
        { mfaSecret: string }[]
      >`SELECT "mfaSecret" FROM "StaffUser" WHERE email = ${email}`;

      expect(raw.mfaSecret).toMatch(/^v1:/);
    });

    it('refuses to invite an email that already has a staff account', async () => {
      const { email } = await acceptedStaff();

      await expect(
        invites.createInvite(email, StaffRole.DISPATCHER, null),
      ).rejects.toThrow(/already exists/);
    });

    it('only the newest invite for an email works', async () => {
      const email = uniqueEmail('twice');
      const first = await invites.createInvite(email, StaffRole.ADMIN, null);
      await invites.createInvite(email, StaffRole.ADMIN, null);

      await browser(app)
        .post('/staff/invites/accept/start', { token: tokenOf(first.link) })
        .expect(400);
    });

    it('rejects expired invites', async () => {
      const email = uniqueEmail('expired');
      const { link } = await invites.createInvite(email, StaffRole.ADMIN, null);
      await prisma.staffInvite.updateMany({
        where: { email },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      await browser(app)
        .post('/staff/invites/accept/start', { token: tokenOf(link) })
        .expect(400);
    });
  });

  describe('login', () => {
    it('requires password and a fresh MFA code', async () => {
      const { email, secret } = await acceptedStaff();
      const client = browser(app);

      await client
        .post('/staff/auth/login', {
          email,
          password: PASSWORD,
          mfaCode: '000000',
        })
        .expect(401);
      await client
        .post('/staff/auth/login', {
          email,
          password: 'not the password',
          mfaCode: await codeFor(secret, 1),
        })
        .expect(401);
      await client
        .post('/staff/auth/login', {
          email,
          password: PASSWORD,
          mfaCode: await codeFor(secret, 1),
        })
        .expect(204);
      await client.get('/staff/auth/me').expect(200);
    });

    it('rejects a code that was already used (replay)', async () => {
      const { email, secret } = await acceptedStaff();
      const code = await codeFor(secret, 1);
      const client = browser(app);

      await client
        .post('/staff/auth/login', { email, password: PASSWORD, mfaCode: code })
        .expect(204);
      await browser(app)
        .post('/staff/auth/login', { email, password: PASSWORD, mfaCode: code })
        .expect(401);
    });

    it('logs out after 15 minutes idle', async () => {
      const { client, email } = await acceptedStaff();
      await client.get('/staff/auth/me').expect(200);

      const staff = await prisma.staffUser.findUniqueOrThrow({
        where: { email },
      });
      await prisma.staffSession.updateMany({
        where: { staffUserId: staff.id },
        data: { lastSeenAt: new Date(Date.now() - STAFF_IDLE_MS - 1000) },
      });

      await client.get('/staff/auth/me').expect(401);
    });

    it('signs out deactivated staff immediately', async () => {
      const { client, email } = await acceptedStaff();
      await prisma.staffUser.update({
        where: { email },
        data: { isActive: false },
      });

      await client.get('/staff/auth/me').expect(401);
    });

    it('logs out', async () => {
      const { client } = await acceptedStaff();

      await client.post('/staff/auth/logout').expect(204);
      await client.get('/staff/auth/me').expect(401);
    });
  });

  describe('separation from customer accounts', () => {
    it('a staff session is not a customer session', async () => {
      const { client } = await acceptedStaff();

      await client.get('/staff/auth/me').expect(200);
      await client.get('/auth/me').expect(401);
    });

    it('a customer session is not a staff session', async () => {
      const client = browser(app);
      const email = uniqueEmail('cust');
      await client
        .post('/auth/signup', {
          firstName: 'Dana',
          lastName: 'Smith',
          email,
          phone: '8135550100',
          password: PASSWORD,
          acceptTerms: true,
        })
        .expect(202);
      await client
        .post('/auth/login', { email, password: PASSWORD })
        .expect(204);

      await client.get('/auth/me').expect(200);
      await client.get('/staff/auth/me').expect(401);
    });
  });
});
