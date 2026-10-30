import type { INestApplication } from '@nestjs/common';
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

describe('Staff accounts (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let invites: StaffInviteService;

  const tokenOf = (link: string) => new URL(link).searchParams.get('token')!;

  // Creates an invite (as the CLI does) and accepts it; returns the signed-in
  // browser.
  const acceptedStaff = async (role: StaffRole = StaffRole.ADMIN) => {
    const email = uniqueEmail('staff');
    const { link } = await invites.createInvite(email, role, null);
    const token = tokenOf(link);
    const client = browser(app);

    // Same order as the setup page: open the link, then details.
    await client.post('/staff/invites/accept/start', { token }).expect(200);
    await client
      .post('/staff/invites/accept/complete', {
        token,
        name: 'Owner One',
        password: PASSWORD,
      })
      .expect(204);

    return { client, email, token };
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

    it('tells the setup page who the invite is for', async () => {
      const email = uniqueEmail('start');
      const { link } = await invites.createInvite(email, StaffRole.ADMIN, null);

      const start = await browser(app)
        .post('/staff/invites/accept/start', { token: tokenOf(link) })
        .expect(200);

      expect(start.body).toEqual({
        kind: 'invite',
        name: null,
        email,
        role: 'ADMIN',
      });
    });

    it('signs the new staff member in; the invite then stops working', async () => {
      const { client, email, token } = await acceptedStaff();

      const me = await client.get('/staff/auth/me').expect(200);
      expect(me.body).toEqual({
        id: expect.any(String),
        email,
        name: 'Owner One',
        role: 'ADMIN',
      });

      await browser(app)
        .post('/staff/invites/accept/start', { token })
        .expect(400);
      await browser(app)
        .post('/staff/invites/accept/complete', {
          token,
          name: 'Someone Else',
          password: PASSWORD,
        })
        .expect(400);
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
    it('signs in with email and password', async () => {
      const { email } = await acceptedStaff();
      const client = browser(app);

      const wrong = await client
        .post('/staff/auth/login', { email, password: 'not the password' })
        .expect(401);
      expect(wrong.body.message).toMatch(/^Incorrect email or password\./);
      await client
        .post('/staff/auth/login', { email, password: PASSWORD })
        .expect(204);
      await client.get('/staff/auth/me').expect(200);
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
