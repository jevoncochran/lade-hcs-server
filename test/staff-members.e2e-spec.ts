import type { INestApplication } from '@nestjs/common';
import { generate } from 'otplib';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { StaffRole } from '../src/generated/prisma/client.js';
import type { LogMailer } from '../src/mail/mailer.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { StaffInviteService } from '../src/staff-auth/staff-invite.service.js';
import {
  browser,
  createTestApp,
  resetAccountTables,
  step,
  uniqueEmail,
} from './helpers.js';

const PASSWORD = 'staff passphrase 123';

// A code from `offset` 30-second steps ahead: each sign-in needs a newer
// step than the last one used (replay protection).
const codeFor = (secret: string, offset = 0) =>
  generate({ secret, epoch: Math.floor(Date.now() / 1000) + offset * 30 });

const tokenOf = (link: string) => new URL(link).searchParams.get('token')!;

describe('Staff management (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let mailer: LogMailer;
  let admin: ReturnType<typeof browser>;
  let adminId: string;

  // Goes through the setup page's steps with an invite or reset link.
  const accept = async (link: string, name = 'New Person') => {
    const token = tokenOf(link);
    const client = browser(app);
    const start = await step(
      'start',
      client.post('/staff/invites/accept/start', { token }),
      200,
    );
    const secret: string = start.body.secret;
    await step(
      'verify',
      client.post('/staff/invites/accept/verify-code', {
        token,
        mfaCode: await codeFor(secret),
      }),
      200,
    );
    await step(
      'complete',
      client.post('/staff/invites/accept/complete', {
        token,
        name,
        password: PASSWORD,
      }),
      204,
    );
    return { client, secret, start: start.body };
  };

  // A new staff member, invited by the admin through the API.
  const member = async (role: StaffRole = StaffRole.DISPATCHER) => {
    const email = uniqueEmail('member');
    const invited = await step(
      'invite',
      admin.post('/staff/invites', { email, role }),
      201,
    );
    const accepted = await accept(invited.body.link);
    const { id } = await prisma.staffUser.findUniqueOrThrow({
      where: { email },
    });
    return { ...accepted, id, email };
  };

  const list = async () =>
    (await step('list', admin.get('/staff/members'), 200)).body;

  beforeAll(async () => {
    ({ app, prisma, mailer } = await createTestApp(AppModule));
    await resetAccountTables(prisma);
    // The first admin comes from the bootstrap command.
    const { link } = await app
      .get(StaffInviteService)
      .createInvite(uniqueEmail('admin'), StaffRole.ADMIN, null);
    ({ client: admin } = await accept(link, 'First Admin'));
    ({ id: adminId } = await prisma.staffUser.findFirstOrThrow({
      where: { name: 'First Admin' },
    }));
  });

  afterAll(async () => {
    await resetAccountTables(prisma);
    await app.close();
  });

  describe('access', () => {
    it('is for administrators only', async () => {
      const dispatcher = await member();
      const refused = await dispatcher.client.get('/staff/members').expect(403);
      expect(refused.body.message).toBe('Only administrators can do this.');
      await dispatcher.client
        .post('/staff/invites', {
          email: uniqueEmail('x'),
          role: 'ADMIN',
        })
        .expect(403);
      await browser(app).get('/staff/members').expect(401);
    });
  });

  describe('inviting', () => {
    it('emails the invite, lists it, and the link sets up the account', async () => {
      const email = uniqueEmail('invited');
      const { body } = await admin
        .post('/staff/invites', { email, role: 'DISPATCHER' })
        .expect(201);

      expect(body).toMatchObject({
        link: expect.stringContaining('/admin/accept-invite?token='),
        emailed: true,
      });
      expect(body.invites).toContainEqual(
        expect.objectContaining({
          email,
          role: 'DISPATCHER',
          kind: 'invite',
          invitedBy: 'First Admin',
        }),
      );
      const sent = mailer.sent.findLast((m) => m.to === email)!;
      expect(sent.subject).toBe('Set up your Lade staff account');
      expect(sent.text).toContain(body.link);
      expect(sent.text).toContain('as a dispatcher');

      await accept(body.link, 'Invited Person');
      const after = await list();
      expect(
        after.invites.map((i: { email: string }) => i.email),
      ).not.toContain(email);
      expect(after.members).toContainEqual(
        expect.objectContaining({
          email,
          name: 'Invited Person',
          role: 'DISPATCHER',
          isActive: true,
          locked: false,
          pendingReset: false,
        }),
      );
    });

    it('refuses someone who already has an account, or a bad email', async () => {
      const existing = await member();
      await admin
        .post('/staff/invites', { email: existing.email, role: 'ADMIN' })
        .expect(409);
      await admin
        .post('/staff/invites', { email: 'not-an-email', role: 'ADMIN' })
        .expect(400);
      await admin
        .post('/staff/invites', { email: uniqueEmail('x'), role: 'OWNER' })
        .expect(400);
    });

    it('can cancel an invite, which kills its link', async () => {
      const { body } = await admin
        .post('/staff/invites', { email: uniqueEmail('later'), role: 'ADMIN' })
        .expect(201);
      const invite = body.invites[0];
      await admin.post(`/staff/invites/${invite.id}/revoke`).expect(200);
      await admin.post(`/staff/invites/${invite.id}/revoke`).expect(404);

      await browser(app)
        .post('/staff/invites/accept/start', { token: tokenOf(body.link) })
        .expect(400);
    });
  });

  describe('roles', () => {
    it('promotes and demotes, taking effect on the next request', async () => {
      const person = await member();
      await person.client.get('/staff/members').expect(403);

      await admin
        .post(`/staff/members/${person.id}/role`, { role: 'ADMIN' })
        .expect(200);
      await person.client.get('/staff/members').expect(200);

      await admin
        .post(`/staff/members/${person.id}/role`, { role: 'DISPATCHER' })
        .expect(200);
      await person.client.get('/staff/members').expect(403);
    });

    it("can't change your own role", async () => {
      const refused = await admin
        .post(`/staff/members/${adminId}/role`, { role: 'DISPATCHER' })
        .expect(400);
      expect(refused.body.message).toMatch(/Ask another administrator/);
    });

    it('keeps an admin even when two admins demote each other at once', async () => {
      const other = await member(StaffRole.ADMIN);
      const responses = await Promise.all([
        admin.post(`/staff/members/${other.id}/role`, { role: 'DISPATCHER' }),
        other.client.post(`/staff/members/${adminId}/role`, {
          role: 'DISPATCHER',
        }),
      ]);

      // One wins; the other is refused (a conflict, or no longer an admin).
      expect(responses.filter((r) => r.status === 200)).toHaveLength(1);
      expect(
        await prisma.staffUser.count({
          where: {
            role: 'ADMIN',
            isActive: true,
            id: { in: [adminId, other.id] },
          },
        }),
      ).toBe(1);

      // Put the first admin back in charge for the other tests.
      const first = await prisma.staffUser.findUniqueOrThrow({
        where: { id: adminId },
      });
      if (first.role !== 'ADMIN') {
        await other.client
          .post(`/staff/members/${adminId}/role`, { role: 'ADMIN' })
          .expect(200);
      }
    });
  });

  describe('deactivating', () => {
    it('signs them out at once and can be undone', async () => {
      const person = await member();
      await person.client.get('/staff/auth/me').expect(200);

      const { body } = await admin
        .post(`/staff/members/${person.id}/deactivate`)
        .expect(200);
      expect(
        body.members.find((m: { id: string }) => m.id === person.id),
      ).toMatchObject({ isActive: false });
      await person.client.get('/staff/auth/me').expect(401);

      await admin.post(`/staff/members/${person.id}/reactivate`).expect(200);
      // Old sessions stay ended; they sign in again.
      await person.client.get('/staff/auth/me').expect(401);
      await browser(app)
        .post('/staff/auth/login', {
          email: person.email,
          password: PASSWORD,
          mfaCode: await codeFor(person.secret, 1),
        })
        .expect(204);
    });

    it("can't deactivate yourself", async () => {
      await admin.post(`/staff/members/${adminId}/deactivate`).expect(400);
    });
  });

  describe('resetting a sign-in', () => {
    it('gives a new password and phone code, and ends old sessions', async () => {
      const person = await member();
      const { body } = await admin
        .post(`/staff/members/${person.id}/reset-sign-in`)
        .expect(200);
      expect(body).toMatchObject({ emailed: true });
      expect(
        body.members.find((m: { id: string }) => m.id === person.id),
      ).toMatchObject({ pendingReset: true });
      expect(mailer.sent.findLast((m) => m.to === person.email)?.subject).toBe(
        'Reset your Lade staff sign-in',
      );

      // Until it's used, the old sign-in still works.
      await person.client.get('/staff/auth/me').expect(200);

      const reset = await accept(body.link, 'Renamed Person');
      expect(reset.start).toMatchObject({
        kind: 'reset',
        name: 'New Person',
        email: person.email,
      });
      expect(reset.secret).not.toBe(person.secret);
      await person.client.get('/staff/auth/me').expect(401);
      await reset.client.get('/staff/auth/me').expect(200);

      // The old phone code no longer works; the new one does.
      await browser(app)
        .post('/staff/auth/login', {
          email: person.email,
          password: PASSWORD,
          mfaCode: await codeFor(person.secret, 1),
        })
        .expect(401);
      await browser(app)
        .post('/staff/auth/login', {
          email: person.email,
          password: PASSWORD,
          mfaCode: await codeFor(reset.secret, 1),
        })
        .expect(204);

      const after = await list();
      expect(
        after.members.find((m: { id: string }) => m.id === person.id),
      ).toMatchObject({ name: 'Renamed Person', pendingReset: false });
    });

    it('also unlocks a locked account', async () => {
      const person = await member();
      await prisma.staffUser.update({
        where: { id: person.id },
        data: { failedLoginCount: 5, lockedUntil: new Date(Date.now() + 9e5) },
      });
      expect(
        (await list()).members.find((m: { id: string }) => m.id === person.id),
      ).toMatchObject({ locked: true });

      const { body } = await admin
        .post(`/staff/members/${person.id}/reset-sign-in`)
        .expect(200);
      await accept(body.link);
      expect(
        (await list()).members.find((m: { id: string }) => m.id === person.id),
      ).toMatchObject({ locked: false });
    });

    it('only the newest reset link works, and none after deactivating', async () => {
      const person = await member();
      const first = await admin
        .post(`/staff/members/${person.id}/reset-sign-in`)
        .expect(200);
      const second = await admin
        .post(`/staff/members/${person.id}/reset-sign-in`)
        .expect(200);
      await browser(app)
        .post('/staff/invites/accept/start', {
          token: tokenOf(first.body.link),
        })
        .expect(400);

      await admin.post(`/staff/members/${person.id}/deactivate`).expect(200);
      await browser(app)
        .post('/staff/invites/accept/start', {
          token: tokenOf(second.body.link),
        })
        .expect(400);
      await admin.post(`/staff/members/${person.id}/reset-sign-in`).expect(409);
    });

    it("can't reset your own sign-in", async () => {
      await admin.post(`/staff/members/${adminId}/reset-sign-in`).expect(400);
    });
  });

  describe('audit log', () => {
    it('records each change by the admin who made it', async () => {
      const person = await member();
      await admin
        .post(`/staff/members/${person.id}/role`, { role: 'ADMIN' })
        .expect(200);
      await admin.post(`/staff/members/${person.id}/deactivate`).expect(200);

      const entries = await prisma.auditLog.findMany({
        where: { entityId: person.id, staffUserId: adminId },
        orderBy: { createdAt: 'asc' },
      });
      expect(entries.map((e) => e.action)).toEqual([
        'staff.role_changed',
        'staff.deactivated',
      ]);
      expect(entries[0].metadata).toEqual({ from: 'DISPATCHER', to: 'ADMIN' });
    });
  });
});
