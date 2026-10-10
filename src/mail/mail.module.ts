import { Global, Module } from '@nestjs/common';
import { LogMailer, Mailer } from './mailer.js';

@Global()
@Module({
  // MAIL_TRANSPORT only allows "log" until the SES mailer exists.
  providers: [{ provide: Mailer, useClass: LogMailer }],
  exports: [Mailer],
})
export class MailModule {}
