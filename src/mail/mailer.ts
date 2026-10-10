import { Injectable, Logger } from '@nestjs/common';

export type MailMessage = { to: string; subject: string; text: string };

// Injection token for sending email. Implementations: LogMailer now; Amazon
// SES (under the AWS BAA) before launch, chosen by MAIL_TRANSPORT.
//
// Emails must not contain PHI beyond the recipient's own address: no rider
// names, addresses, trip details or medical information.
export abstract class Mailer {
  abstract send(message: MailMessage): Promise<void>;
}

// Development and tests: prints the email (including its links) to the log
// instead of sending it. Only ever used with fake data.
@Injectable()
export class LogMailer extends Mailer {
  private readonly logger = new Logger('Mail');
  readonly sent: MailMessage[] = []; // inspected by e2e tests

  async send(message: MailMessage) {
    this.sent.push(message);
    this.logger.log(
      `To: ${message.to}\nSubject: ${message.subject}\n\n${message.text}`,
    );
  }
}
