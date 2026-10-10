import { IsString, MaxLength, MinLength } from 'class-validator';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from '../../auth/password.js';

// Base for any DTO that sets a new password (sign-up, reset, staff invite).
// Passwords are never trimmed: spaces can be part of them.
export class NewPasswordDto {
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH, {
    message: `Password must be at least ${PASSWORD_MIN_LENGTH} characters`,
  })
  @MaxLength(PASSWORD_MAX_LENGTH)
  password: string;
}
