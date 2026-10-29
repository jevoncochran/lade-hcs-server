import { Type } from 'class-transformer';
import { IsEnum, ValidateNested } from 'class-validator';
import { IsZonedDateTime } from '../../common/validators/is-zoned-date-time.js';
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

  @IsZonedDateTime('Pickup time')
  pickupAt: string;
}
