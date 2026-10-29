import { IsString, Length, Matches } from 'class-validator';
import { MFA_CODE, MFA_CODE_MESSAGE } from './mfa-code.js';

export class VerifyInviteCodeDto {
  @IsString()
  @Length(20, 100)
  token: string;

  @Matches(MFA_CODE, { message: MFA_CODE_MESSAGE })
  mfaCode: string;
}
