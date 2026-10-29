import { Transform } from 'class-transformer';
import { IsEmail } from 'class-validator';
import { trim } from '../../common/transforms.js';

// Forgot password and resend verification.
export class EmailDto {
  @Transform(trim)
  @IsEmail()
  email: string;
}
