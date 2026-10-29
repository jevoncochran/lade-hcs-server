import { IsString, Length } from 'class-validator';

export class InviteTokenDto {
  @IsString()
  @Length(20, 100)
  token: string;
}
