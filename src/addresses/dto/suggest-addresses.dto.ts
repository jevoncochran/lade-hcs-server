import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';
import { trim } from '../../common/transforms.js';

export class SuggestAddressesDto {
  @Transform(trim)
  @IsString()
  @Length(3, 200)
  q: string;
}
