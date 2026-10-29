import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';
import { trim } from '../../common/transforms.js';

export const CONTACT_TOPICS = {
  rider: 'Rider or family member',
  facility: 'Facility or case manager',
  billing: 'Insurance or billing',
  other: 'Something else',
} as const;

// POST /contact — the website's contact form. Same rules as the form
// (lade-healthcare-services: src/lib/contact.ts).
export class ContactMessageDto {
  @Transform(trim)
  @Length(1, 100, { message: 'Please enter your name.' })
  name: string;

  @Transform(trim)
  @IsEmail({}, { message: 'Please enter a valid email address.' })
  email: string;

  // Optional: 10 digits, or 11 starting with 1.
  @IsOptional()
  @Transform(trim)
  @Matches(/^$|^\D*(1\D*)?(\d\D*){10}$/, {
    message: 'Please enter a 10-digit phone number, or leave it blank.',
  })
  phone?: string;

  @IsIn(Object.keys(CONTACT_TOPICS), {
    message: 'Please choose what your message is about.',
  })
  topic: keyof typeof CONTACT_TOPICS;

  @Transform(trim)
  @Length(10, 2000, {
    message: 'Please write between 10 and 2,000 characters.',
  })
  message: string;

  // Honeypot: hidden from people, filled in by bots.
  @IsOptional()
  @IsString()
  company?: string;
}
