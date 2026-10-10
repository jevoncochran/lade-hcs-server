import { Transform } from 'class-transformer';
import {
  Equals,
  IsEmail,
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../auth/password.js';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class PasswordField {
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH, {
    message: `Password must be at least ${PASSWORD_MIN_LENGTH} characters`,
  })
  @MaxLength(PASSWORD_MAX_LENGTH)
  password: string;
}

export class SignupDto extends PasswordField {
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

export class LoginDto {
  @Transform(trim)
  @IsEmail()
  email: string;

  @IsString()
  @MaxLength(PASSWORD_MAX_LENGTH)
  password: string;
}

export class EmailDto {
  @Transform(trim)
  @IsEmail()
  email: string;
}

export class TokenDto {
  @IsString()
  @Length(20, 100)
  token: string;
}

export class ResetPasswordDto extends PasswordField {
  @IsString()
  @Length(20, 100)
  token: string;
}
