import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.validation.js';
import { contactMessage } from '../mail/contact-templates.js';
import { Mailer } from '../mail/mailer.js';
import {
  CONTACT_TOPICS,
  type ContactMessageDto,
} from './dto/contact-message.dto.js';

// Emails contact form messages to Lade's inbox. Nothing is stored or logged:
// people may write about their health.
@Injectable()
export class ContactService {
  private readonly logger = new Logger(ContactService.name);

  constructor(
    private readonly mailer: Mailer,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async send(dto: ContactMessageDto) {
    // A bot filled in the hidden field: act as if it worked so it moves on.
    if (dto.company) return;

    try {
      await this.mailer.send(
        contactMessage(this.config.get('CONTACT_INBOX', { infer: true }), {
          name: dto.name,
          email: dto.email,
          phone: dto.phone,
          topic: CONTACT_TOPICS[dto.topic],
          text: dto.message,
        }),
      );
    } catch {
      // The mailer already logged why (without the message).
      this.logger.error('A contact form message could not be sent');
      throw new ServiceUnavailableException(
        "Sorry, we couldn't send your message. Please call us or try again in a few minutes.",
      );
    }
  }
}
