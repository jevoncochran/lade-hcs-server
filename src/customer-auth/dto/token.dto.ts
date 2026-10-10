import { IsString, Length } from 'class-validator';

// A one-time token from an emailed link (e.g. email verification).
export class TokenDto {
  @IsString()
  @Length(20, 100)
  token: string;
}
