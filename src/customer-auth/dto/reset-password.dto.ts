import { IsString, Length } from 'class-validator';
import { NewPasswordDto } from '../../common/dto/new-password.dto.js';

export class ResetPasswordDto extends NewPasswordDto {
  @IsString()
  @Length(20, 100)
  token: string;
}
