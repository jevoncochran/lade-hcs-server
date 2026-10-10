import { Transform } from 'class-transformer';
import { IsEmail, IsString, Matches, MaxLength } from 'class-validator';
import { PASSWORD_MAX_LENGTH } from '../../auth/password.js';
import { trim } from '../../common/transforms.js';
import { MFA_CODE, MFA_CODE_MESSAGE } from './mfa-code.js';

export class StaffLoginDto {
  @Transform(trim)
  @IsEmail()
  email: string;

  @IsString()
  @MaxLength(PASSWORD_MAX_LENGTH)
  password: string;

  @Matches(MFA_CODE, { message: MFA_CODE_MESSAGE })
  mfaCode: string;
}
