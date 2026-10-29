import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { LogMailer, Mailer, type MailMessage } from '../src/mail/mailer.js';
import { browser, createTestApp } from './helpers.js';

const message = {
  name: 'Dana Smith',
  email: 'dana@example.com',
  phone: '813-555-0100',
  topic: 'rider',
  message: 'My mother needs a wheelchair ride to dialysis three times a week.',
};

describe('Contact form (e2e)', () => {
  let app: INestApplication<App>;
  let mailer: LogMailer;

  beforeAll(async () => {
    ({ app, mailer } = await createTestApp(AppModule));
  });

  afterAll(async () => {
    await app.close();
  });

  const sentTo = (to: string) => mailer.sent.filter((m) => m.to === to);

  it("emails the message to Lade's inbox, with the visitor as reply-to", async () => {
    await browser(app).post('/contact', message).expect(202);

    const sent = sentTo('info@ladehcs.com').at(-1)!;
    expect(sent).toMatchObject({
      to: 'info@ladehcs.com',
      replyTo: 'dana@example.com',
      subject: 'Website message from Dana Smith',
    });
    expect(sent.text).toContain('About: Rider or family member');
    expect(sent.text).toContain('Phone: 813-555-0100');
    expect(sent.text).toContain(message.message);
  });

  it('accepts a message without a phone number', async () => {
    await browser(app)
      .post('/contact', { ...message, phone: '' })
      .expect(202);
    expect(sentTo('info@ladehcs.com').at(-1)!.text).toContain(
      'Phone: Not provided',
    );
  });

  it('keeps line breaks out of the subject', async () => {
    await browser(app)
      .post('/contact', { ...message, name: 'Dana\r\nBcc: x@example.com' })
      .expect(202);
    expect(sentTo('info@ladehcs.com').at(-1)!.subject).toBe(
      'Website message from Dana Bcc: x@example.com',
    );
  });

  it('quietly drops messages from bots (honeypot)', async () => {
    const before = mailer.sent.length;
    await browser(app)
      .post('/contact', { ...message, company: 'Spam Inc' })
      .expect(202);
    expect(mailer.sent.length).toBe(before);
  });

  it.each([
    ['no name', { name: '' }],
    ['a bad email', { email: 'nope' }],
    ['a short phone number', { phone: '12345' }],
    ['an unknown topic', { topic: 'sales' }],
    ['a too-short message', { message: 'Hi' }],
    ['a too-long message', { message: 'x'.repeat(2001) }],
    ['an unexpected field', { website: 'http://spam.example' }],
  ])('rejects %s', async (_label, change) => {
    await browser(app)
      .post('/contact', { ...message, ...change })
      .expect(400);
  });

  it('only accepts messages sent from the website', async () => {
    const { agent } = browser(app);
    await agent.post('/contact').send(message).expect(403);
  });
});

describe('Contact form when email is down (e2e)', () => {
  let app: INestApplication<App>;

  class BrokenMailer extends Mailer {
    async send(_message: MailMessage) {
      throw new Error('SES is down');
    }
  }

  beforeAll(async () => {
    ({ app } = await createTestApp(AppModule, (builder) =>
      builder.overrideProvider(Mailer).useValue(new BrokenMailer()),
    ));
  });

  afterAll(async () => {
    await app.close();
  });

  it('tells the visitor to call instead', async () => {
    const { body } = await browser(app).post('/contact', message).expect(503);
    expect(body.message).toMatch(/Please call us/);
  });
});
