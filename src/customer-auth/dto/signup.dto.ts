import { Transform } from 'class-transformer';
import {
  Equals,
  IsEmail,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';
import { NewPasswordDto } from '../../common/dto/new-password.dto.js';
import { trim } from '../../common/transforms.js';

export class SignupDto extends NewPasswordDto {
  @Transform(trim)
  @IsString()
  @Length(1, 50, { message: 'Enter your first name (up to 50 characters)' })
  firstName: string;

  @Transform(trim)
  @IsString()
  @Length(1, 50, { message: 'Enter your last name (up to 50 characters)' })
  lastName: string;

  @Transform(trim)
  @IsEmail({}, { message: 'Enter a valid email address' })
  @MaxLength(254)
  email: string;

  // US numbers in any common format; stored as entered, hashed digits-only.
  @Transform(trim)
  @Matches(/^[+\d\s().-]{10,20}$/, { message: 'Enter a valid phone number' })
  phone: string;

  @Equals(true, { message: 'You must accept the terms to create an account' })
  acceptTerms: boolean;
}
