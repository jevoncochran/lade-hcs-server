import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { CUSTOMER_IDLE_MS } from '../src/customer-auth/customer-session.service.js';
import type { LogMailer } from '../src/mail/mailer.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import {
  browser,
  createTestApp,
  resetAccountTables,
  SITE_URL,
  tokenFromLastEmail,
  uniqueEmail,
} from './helpers.js';

const PASSWORD = 'correct horse battery';

describe('Customer accounts (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let mailer: LogMailer;

  const signupBody = (email: string) => ({
    firstName: 'Dana',
    lastName: 'Smith',
    email,
    phone: '(813) 555-0100',
    password: PASSWORD,
    acceptTerms: true,
  });

  // Signs up and verifies a customer; returns a logged-in browser.
  const verifiedCustomer = async (email = uniqueEmail('dana')) => {
    const client = browser(app);
    await client.post('/auth/signup', signupBody(email)).expect(202);
    await client
      .post('/auth/verify-email', { token: tokenFromLastEmail(mailer, email) })
      .expect(200);
    await client.post('/auth/login', { email, password: PASSWORD }).expect(204);
    return { client, email };
  };

  beforeAll(async () => {
    ({ app, prisma, mailer } = await createTestApp(AppModule));
    await resetAccountTables(prisma);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('sign-up', () => {
    it('creates an account, encrypts it, and emails a verification link', async () => {
      const email = uniqueEmail('new');
      const response = await browser(app)
        .post('/auth/signup', signupBody(email))
        .expect(202);

      expect(response.body.message).toMatch(/check your email/i);
      expect(mailer.sent.at(-1)).toMatchObject({
        to: email,
        subject: 'Confirm your email address',
      });

      const [raw] = await prisma.$queryRaw<
        {
          email: string;
          firstName: string;
          lastName: string;
          phone: string;
          passwordHash: string;
        }[]
      >`SELECT email, "firstName", "lastName", phone, "passwordHash" FROM "Customer" ORDER BY "createdAt" DESC LIMIT 1`;
      expect(raw.email).toMatch(/^v1:/);
      expect(raw.firstName).toMatch(/^v1:/);
      expect(raw.lastName).toMatch(/^v1:/);
      expect(raw.phone).toMatch(/^v1:/);
      expect(raw.passwordHash).toMatch(/^\$argon2id\$/);
    });

    it('gives the same response for an existing email and creates no duplicate', async () => {
      const { email } = await verifiedCustomer();
      const before = await prisma.customer.count();

      const response = await browser(app)
        .post('/auth/signup', signupBody(email.toUpperCase()))
        .expect(202);

      expect(response.body.message).toMatch(/check your email/i);
      expect(await prisma.customer.count()).toBe(before);
      expect(mailer.sent.at(-1)?.subject).toBe('You already have an account');
    });

    it('rejects short passwords, unaccepted terms, blank names and unknown fields', async () => {
      const client = browser(app);
      const email = uniqueEmail('bad');

      await client
        .post('/auth/signup', { ...signupBody(email), password: 'short' })
        .expect(400);
      await client
        .post('/auth/signup', { ...signupBody(email), acceptTerms: false })
        .expect(400);
      await client
        .post('/auth/signup', { ...signupBody(email), role: 'ADMIN' })
        .expect(400);
      await client
        .post('/auth/signup', { ...signupBody(email), lastName: '   ' })
        .expect(400);
      await client
        .post('/auth/signup', { ...signupBody(email), name: 'Dana Smith' })
        .expect(400);
    });
  });

  describe('password length', () => {
    it('requires at least 8 characters', async () => {
      const client = browser(app);

      await client
        .post('/auth/signup', {
          ...signupBody(uniqueEmail('seven')),
          password: '7chars!',
        })
        .expect(400);
      await client
        .post('/auth/signup', {
          ...signupBody(uniqueEmail('eight')),
          password: '8chars!!',
        })
        .expect(202);
    });
  });

  describe('email verification', () => {
    it('verifies once; the link cannot be reused', async () => {
      const email = uniqueEmail('verify');
      const client = browser(app);
      await client.post('/auth/signup', signupBody(email)).expect(202);
      const token = tokenFromLastEmail(mailer, email);

      await client.post('/auth/verify-email', { token }).expect(200);
      await client.post('/auth/verify-email', { token }).expect(400);
    });

    it('shows unverified accounts as such after login', async () => {
      const email = uniqueEmail('unverified');
      const client = browser(app);
      await client.post('/auth/signup', signupBody(email)).expect(202);
      await client
        .post('/auth/login', { email, password: PASSWORD })
        .expect(204);

      const me = await client.get('/auth/me').expect(200);
      expect(me.body.emailVerified).toBe(false);
    });
  });

  describe('login & sessions', () => {
    it('logs in with any email casing and returns the decrypted profile', async () => {
      const email = uniqueEmail('case');
      const { client } = await verifiedCustomer(email);

      const me = await client.get('/auth/me').expect(200);
      expect(me.body).toEqual({
        id: expect.any(String),
        firstName: 'Dana',
        lastName: 'Smith',
        email,
        phone: '(813) 555-0100',
        emailVerified: true,
      });

      const other = browser(app);
      await other
        .post('/auth/login', { email: email.toUpperCase(), password: PASSWORD })
        .expect(204);
    });

    it('sets an httpOnly session cookie', async () => {
      const { email } = await verifiedCustomer();
      const response = await browser(app)
        .post('/auth/login', { email, password: PASSWORD })
        .expect(204);

      const cookie = response.headers['set-cookie']?.[0] ?? '';
      expect(cookie).toMatch(/^lade_sid=/);
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/SameSite=Lax/i);
    });

    it('uses one message for unknown email and wrong password', async () => {
      const { email } = await verifiedCustomer();
      const client = browser(app);

      const wrong = await client
        .post('/auth/login', { email, password: 'not the password' })
        .expect(401);
      const unknown = await client
        .post('/auth/login', {
          email: uniqueEmail('nobody'),
          password: PASSWORD,
        })
        .expect(401);

      expect(wrong.body.message).toBe(unknown.body.message);
    });

    it('locks after 5 failures, even for the right password', async () => {
      const { email } = await verifiedCustomer();
      const client = browser(app);

      for (let i = 0; i < 5; i++) {
        await client
          .post('/auth/login', { email, password: 'wrong password!' })
          .expect(401);
      }
      await client
        .post('/auth/login', { email, password: PASSWORD })
        .expect(401);

      // Once the lock expires, the right password works again.
      await prisma.customer.updateMany({
        where: { lockedUntil: { not: null } },
        data: { lockedUntil: new Date(Date.now() - 1000) },
      });
      await client
        .post('/auth/login', { email, password: PASSWORD })
        .expect(204);
    });

    it('logs out and the old cookie stops working', async () => {
      const { client } = await verifiedCustomer();
      await client.get('/auth/me').expect(200);

      await client.post('/auth/logout').expect(204);
      await client.get('/auth/me').expect(401);
    });

    it('ends sessions after 7 days idle', async () => {
      const { client } = await verifiedCustomer();
      const me = await client.get('/auth/me').expect(200);

      await prisma.customerSession.updateMany({
        where: { customerId: me.body.id },
        data: { lastSeenAt: new Date(Date.now() - CUSTOMER_IDLE_MS - 1000) },
      });
      await client.get('/auth/me').expect(401);
    });
  });

  describe('password reset', () => {
    it('resets the password and signs out every other session', async () => {
      const { client: oldDevice, email } = await verifiedCustomer();
      const client = browser(app);

      await client.post('/auth/forgot-password', { email }).expect(202);
      const token = tokenFromLastEmail(mailer, email);
      const newPassword = 'a brand new passphrase';

      await client
        .post('/auth/reset-password', { token, password: newPassword })
        .expect(200);

      await oldDevice.get('/auth/me').expect(401);
      await client
        .post('/auth/login', { email, password: PASSWORD })
        .expect(401);
      await client
        .post('/auth/login', { email, password: newPassword })
        .expect(204);
      expect(mailer.sent.at(-1)?.subject).toBe('Your password was changed');

      // The link works once.
      await client
        .post('/auth/reset-password', {
          token,
          password: 'yet another passphrase',
        })
        .expect(400);
    });

    it('responds the same for unknown emails and sends nothing', async () => {
      const sentBefore = mailer.sent.length;

      const response = await browser(app)
        .post('/auth/forgot-password', { email: uniqueEmail('ghost') })
        .expect(202);

      expect(response.body.message).toMatch(/if there's an account/i);
      expect(mailer.sent.length).toBe(sentBefore);
    });
  });

  describe('protections', () => {
    it('rejects state-changing requests from other origins', async () => {
      const server = app.getHttpServer();
      const body = { email: uniqueEmail('x'), password: PASSWORD };

      await request(server).post('/auth/login').send(body).expect(403);
      await request(server)
        .post('/auth/login')
        .set('Origin', 'https://evil.example')
        .send(body)
        .expect(403);
    });

    it('allows the website origin in CORS', async () => {
      const response = await request(app.getHttpServer())
        .options('/auth/login')
        .set('Origin', SITE_URL)
        .set('Access-Control-Request-Method', 'POST');

      expect(response.headers['access-control-allow-origin']).toBe(SITE_URL);
      expect(response.headers['access-control-allow-credentials']).toBe('true');
    });

    it('keeps PHI out of the audit log', async () => {
      const { email } = await verifiedCustomer();
      const rows = await prisma.auditLog.findMany();

      const dump = JSON.stringify(rows);
      expect(dump).not.toContain(email);
      expect(dump).not.toContain('Dana');
      expect(dump).not.toContain('Smith');
      expect(dump).not.toContain('555-0100');
      expect(rows.map((r) => r.action)).toEqual(
        expect.arrayContaining([
          'customer.signup',
          'customer.email_verified',
          'customer.login',
          'customer.login_failed',
        ]),
      );
    });
  });
});
