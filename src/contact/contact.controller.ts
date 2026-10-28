import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { AuthRateLimit } from '../common/decorators/auth-rate-limit.decorator.js';
import { ContactService } from './contact.service.js';
import { ContactMessageDto } from './dto/contact-message.dto.js';

// The website's contact form (public). The browser posts it here directly,
// so the strict per-visitor rate limit and the Origin check apply.
@Controller('contact')
export class ContactController {
  constructor(private readonly contact: ContactService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @AuthRateLimit()
  send(@Body() dto: ContactMessageDto) {
    return this.contact.send(dto);
  }
}
