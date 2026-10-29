import { NestFactory } from '@nestjs/core';
import { parseArgs } from 'node:util';
import { AppModule } from '../app.module.js';
import { StaffRole } from '../generated/prisma/client.js';
import { StaffInviteService } from '../staff-auth/staff-invite.service.js';

// Bootstrap command: creates a staff invite without needing an existing
// admin, and prints the one-time link to send to that person.
//
//   npm run staff:invite -- --email owner@ladehcs.com --role ADMIN
//
// Send the link privately (text or call). It works once and expires in 48
// hours; the person sets their own password and MFA, so nobody else ever
// knows their credentials. Runs against the database in DATABASE_URL.
const main = async () => {
  const { values } = parseArgs({
    options: {
      email: { type: 'string' },
      role: { type: 'string', default: StaffRole.DISPATCHER },
    },
  });

  const role = values.role as StaffRole;
  if (!values.email || !Object.values(StaffRole).includes(role)) {
    console.error(
      `Usage: npm run staff:invite -- --email <email> [--role ${Object.values(StaffRole).join('|')}]`,
    );
    process.exitCode = 1;
    return;
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  try {
    const { link, expiresAt } = await app
      .get(StaffInviteService)
      .createInvite(values.email, role, null);

    console.log(
      `\nInvite created for ${values.email.trim().toLowerCase()} (${role}).`,
    );
    console.log(
      `Expires: ${expiresAt.toLocaleString('en-US', { timeZone: 'America/New_York' })} (Tampa time)\n`,
    );
    console.log(link);
    console.log('\nSend this link privately. It works once.\n');
  } finally {
    await app.close();
  }
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
