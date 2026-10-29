import { Transform } from 'class-transformer';
import { IsEmail, IsString, MaxLength } from 'class-validator';
import { PASSWORD_MAX_LENGTH } from '../../auth/password.js';
import { trim } from '../../common/transforms.js';

export class LoginDto {
  @Transform(trim)
  @IsEmail()
  email: string;

  @IsString()
  @MaxLength(PASSWORD_MAX_LENGTH)
  password: string;
}
