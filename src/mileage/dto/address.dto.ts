import { Transform } from 'class-transformer';
import {
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';
import { trim } from '../../common/transforms.js';
import type { Address } from '../address.js';

const upper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

// A pickup or drop-off address in a quote or booking request.
export class AddressDto implements Address {
  @Transform(trim)
  @IsString()
  @Length(1, 100, { message: 'Enter the street address' })
  line1: string;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  line2?: string;

  @Transform(trim)
  @IsString()
  @Length(1, 60, { message: 'Enter the city' })
  city: string;

  @Transform(upper)
  @Matches(/^[A-Z]{2}$/, {
    message: 'Enter the two-letter state code, e.g. FL',
  })
  state: string;

  @Transform(trim)
  @Matches(/^\d{5}(-\d{4})?$/, { message: 'Enter a 5-digit ZIP code' })
  zip: string;
}
