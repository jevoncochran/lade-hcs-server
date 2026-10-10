import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { configureApp } from '../src/app.setup.js';
import { LogMailer, Mailer } from '../src/mail/mailer.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

export const SITE_URL = 'http://localhost:3000';

// Boots the full app (same pipeline as main.ts) against lade_hcs_test.
// Pass `AppModule` in: test files that change env vars must import it only
// after changing them.
export const createTestApp = async (appModule: unknown) => {
  const moduleRef = await Test.createTestingModule({
    imports: [appModule as never],
  }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({
    logger: ['error', 'warn'],
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

// Wipes account data between test files. Test database only.
export const resetAccountTables = async (prisma: PrismaService) => {
  const [{ name }] = await prisma.$queryRaw<
    { name: string }[]
  >`SELECT current_database() AS name`;
  if (!/_(test|ci)$/.test(name)) {
    throw new Error(
      `Refusing to wipe tables in "${name}": not a test database`,
    );
  }
  await prisma.$executeRawUnsafe(
    'TRUNCATE "AuditLog", "CustomerToken", "CustomerSession", "Customer", ' +
      '"StaffSession", "StaffInvite", "StaffUser" CASCADE',
  );
};

export const uniqueEmail = (label: string) =>
  `${label}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@example.com`;
