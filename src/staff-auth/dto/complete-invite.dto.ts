import { Transform } from 'class-transformer';
import { IsString, Length, Matches } from 'class-validator';
import { NewPasswordDto } from '../../common/dto/new-password.dto.js';
import { trim } from '../../common/transforms.js';
import { MFA_CODE, MFA_CODE_MESSAGE } from './mfa-code.js';

export class CompleteInviteDto extends NewPasswordDto {
  @IsString()
  @Length(20, 100)
  token: string;

  @Transform(trim)
  @IsString()
  @Length(1, 100)
  name: string;

  @Matches(MFA_CODE, { message: MFA_CODE_MESSAGE })
  mfaCode: string;
}
