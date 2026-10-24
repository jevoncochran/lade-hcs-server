import type { SendEmailCommand } from '@aws-sdk/client-sesv2';
import { SesMailer } from './ses-mailer.js';

const message = {
  to: 'rider@example.com',
  subject: 'Confirm your email address',
  text: 'Open this link: https://example.com/verify?token=abc',
};

describe('SesMailer', () => {
  it('sends a plain-text email from MAIL_FROM, with the reply-to', async () => {
    const sent: SendEmailCommand[] = [];
    const mailer = new SesMailer(
      {
        send: async (command: SendEmailCommand) => void sent.push(command),
      } as never,
      'Lade <no-reply@ladehcs.com>',
      'info@example.com',
    );

    await mailer.send(message);

    expect(sent[0].input).toEqual({
      FromEmailAddress: 'Lade <no-reply@ladehcs.com>',
      Destination: { ToAddresses: ['rider@example.com'] },
      ReplyToAddresses: ['info@example.com'],
      Content: {
        Simple: {
          Subject: { Data: message.subject, Charset: 'UTF-8' },
          Body: { Text: { Data: message.text, Charset: 'UTF-8' } },
        },
      },
    });
  });

  it('passes failures on without logging the recipient', async () => {
    const mailer = new SesMailer(
      {
        send: async () => {
          throw Object.assign(new Error('Email address is not verified'), {
            name: 'MessageRejected',
          });
        },
      } as never,
      'Lade <no-reply@ladehcs.com>',
    );
    const logged: string[] = [];
    (mailer as unknown as { logger: { error: (m: string) => void } }).logger = {
      error: (line: string) => void logged.push(line),
    };

    await expect(mailer.send(message)).rejects.toThrow('not verified');
    expect(logged).toEqual([
      `Couldn't send "Confirm your email address": MessageRejected`,
    ]);
    expect(logged.join()).not.toContain('rider@example.com');
  });
});
