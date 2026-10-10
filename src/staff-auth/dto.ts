import { Transform } from 'class-transformer';
import { IsEmail, IsString, Length, Matches, MaxLength } from 'class-validator';
import { PASSWORD_MAX_LENGTH } from '../auth/password.js';
import { PasswordField } from '../customer-auth/dto.js';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

const MFA_CODE = /^\d{6}$/;
const MFA_CODE_MESSAGE = 'Enter the 6-digit code from your authenticator app';

export class InviteTokenDto {
  @IsString()
  @Length(20, 100)
  token: string;
}

export class CompleteInviteDto extends PasswordField {
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
