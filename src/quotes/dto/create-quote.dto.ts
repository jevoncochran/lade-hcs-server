import { Type } from 'class-transformer';
import { IsEnum, IsISO8601, Matches, ValidateNested } from 'class-validator';
import { CareLevel, TripKind } from '../../generated/prisma/client.js';
import { AddressDto } from '../../mileage/dto/address.dto.js';

export class CreateQuoteDto {
  @IsEnum(CareLevel, { message: 'Choose a level of care' })
  careLevel: CareLevel;

  @IsEnum(TripKind, {
    message: 'Choose one-way, round trip or wait and return',
  })
  tripKind: TripKind;

  @ValidateNested()
  @Type(() => AddressDto)
  pickup: AddressDto;

  @ValidateNested()
  @Type(() => AddressDto)
  dropoff: AddressDto;

  // ISO 8601 with a time zone, e.g. "2026-10-14T09:30:00-04:00", so there's
  // no doubt which 9:30 is meant.
  @IsISO8601(
    { strict: true, strictSeparator: true },
    { message: 'Pickup time must be a real date and time' },
  )
  @Matches(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/,
    {
      message: 'Pickup time must be a date and time with a time zone',
    },
  )
  pickupAt: string;
}
