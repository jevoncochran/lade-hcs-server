import { SESv2Client } from '@aws-sdk/client-sesv2';
import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.validation.js';
import { LogMailer, Mailer } from './mailer.js';
import { SesMailer } from './ses-mailer.js';

@Global()
@Module({
  providers: [
    {
      // MAIL_TRANSPORT: "log" prints emails (development and tests), "ses"
      // sends them.
      provide: Mailer,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): Mailer => {
        if (config.get('MAIL_TRANSPORT', { infer: true }) === 'log') {
          return new LogMailer();
        }
        const accessKeyId = config.get('SES_ACCESS_KEY_ID', { infer: true });
        const secretAccessKey = config.get('SES_SECRET_ACCESS_KEY', {
          infer: true,
        });
        const ses = new SESv2Client({
          region: config.get('AWS_REGION', { infer: true }),
          // No keys: the AWS role the server runs with (production on AWS).
          credentials:
            accessKeyId && secretAccessKey
              ? { accessKeyId, secretAccessKey }
              : undefined,
        });
        return new SesMailer(
          ses,
          config.get('MAIL_FROM', { infer: true }),
          config.get('MAIL_REPLY_TO', { infer: true }) || undefined,
        );
      },
    },
  ],
  exports: [Mailer],
})
export class MailModule {}
