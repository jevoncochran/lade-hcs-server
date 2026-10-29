import type { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.validation.js';
import { Mailer, type MailMessage } from '../mail/mailer.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { BookingNotificationsService } from './booking-notifications.service.js';

const booking = {
  id: 'b1',
  reference: 'LD-7K3Q9X',
  requesterEmail: 'booker@example.com',
  payments: [{ status: 'CHARGED' }],
  charges: [{ amountCents: 9060 }],
};

const prisma = {
  booking: { findUnique: async () => booking },
  staffUser: { findMany: async () => [{ email: 'staff@example.com' }] },
} as unknown as PrismaService;

const config = {
  get: () => 'https://ladehcs.com',
} as unknown as ConfigService<Env, true>;

class BrokenMailer extends Mailer {
  attempts: MailMessage[] = [];
  async send(message: MailMessage) {
    this.attempts.push(message);
    throw new Error('SES is down');
  }
}

describe('BookingNotificationsService', () => {
  it("keeps going when an email can't be sent", async () => {
    const mailer = new BrokenMailer();
    const service = new BookingNotificationsService(prisma, mailer, config);

    await expect(service.requestReceived('b1')).resolves.toBeUndefined();
    // Both the customer's and the staff email were still attempted.
    expect(mailer.attempts.map((m) => m.to)).toEqual([
      'booker@example.com',
      'staff@example.com',
    ]);

    await expect(
      service.afterStaffAction('b1', 'completed'),
    ).resolves.toBeUndefined();
    expect(mailer.attempts.at(-1)?.subject).toBe('Receipt for ride LD-7K3Q9X');
  });
});
