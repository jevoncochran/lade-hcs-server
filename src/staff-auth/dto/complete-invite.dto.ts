import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';
import { NewPasswordDto } from '../../common/dto/new-password.dto.js';
import { trim } from '../../common/transforms.js';

// The phone code is verified in the step before (VerifyInviteCodeDto).
export class CompleteInviteDto extends NewPasswordDto {
  @IsString()
  @Length(20, 100)
  token: string;

  @Transform(trim)
  @IsString()
  @Length(1, 100)
  name: string;
}
