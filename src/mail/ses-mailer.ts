import { Logger } from '@nestjs/common';
import { SendEmailCommand, type SESv2Client } from '@aws-sdk/client-sesv2';
import { Mailer, type MailMessage } from './mailer.js';

// Sends email with Amazon SES (covered by the AWS BAA), plain text only.
// Recipient addresses are PHI: they never go in logs, only the subject.
export class SesMailer extends Mailer {
  private readonly logger = new Logger('Mail');

  constructor(
    private readonly ses: Pick<SESv2Client, 'send'>,
    private readonly from: string,
    private readonly replyTo?: string,
  ) {
    super();
  }

  async send(message: MailMessage) {
    try {
      await this.ses.send(
        new SendEmailCommand({
          FromEmailAddress: this.from,
          Destination: { ToAddresses: [message.to] },
          ReplyToAddresses:
            (message.replyTo ?? this.replyTo)
              ? [message.replyTo ?? this.replyTo!]
              : undefined,
          Content: {
            Simple: {
              Subject: { Data: message.subject, Charset: 'UTF-8' },
              Body: { Text: { Data: message.text, Charset: 'UTF-8' } },
            },
          },
        }),
      );
    } catch (error) {
      this.logger.error(
        `Couldn't send "${message.subject}": ${error instanceof Error ? error.name : 'unknown error'}`,
      );
      throw error;
    }
  }
}
