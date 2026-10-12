import { Transform, Type } from 'class-transformer';
import {
  Equals,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { IsZonedDateTime } from '../../common/validators/is-zoned-date-time.js';
import { trim } from '../../common/transforms.js';
import {
  CareLevel,
  RequesterRelationship,
  TripKind,
  TripType,
} from '../../generated/prisma/client.js';
import { AddressDto } from '../../mileage/dto/address.dto.js';

// Rules that involve more than one field (return times, rider names for
// someone else) are checked in BookingsService.
export class CreateBookingDto {
  // Made by the website once per checkout, so a double-click or retry never
  // creates two bookings.
  @IsUUID('4')
  idempotencyKey: string;

  @IsEnum(CareLevel, { message: 'Choose a level of care' })
  careLevel: CareLevel;

  @IsEnum(TripKind, {
    message: 'Choose one-way, round trip or wait and return',
  })
  tripKind: TripKind;

  @IsEnum(TripType, { message: 'Choose what the trip is for' })
  tripType: TripType;

  @ValidateNested()
  @Type(() => AddressDto)
  pickup: AddressDto;

  @ValidateNested()
  @Type(() => AddressDto)
  dropoff: AddressDto;

  @IsZonedDateTime('Pickup time')
  pickupAt: string;

  // When the rider needs to be there, if it's an appointment.
  @IsOptional()
  @IsZonedDateTime('Appointment time')
  appointmentAt?: string;

  // Round trips: a set time for the ride back, or "will call" (they phone
  // when ready, e.g. a hospital discharge).
  @IsOptional()
  @IsZonedDateTime('Return pickup time')
  returnPickupAt?: string;

  @IsOptional()
  @IsBoolean()
  returnWillCall?: boolean;

  // Wait-and-return: roughly how long the driver will wait, if known.
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(480)
  expectedWaitMinutes?: number;

  // Who the ride is for. SELF uses the account holder's name.
  @IsEnum(RequesterRelationship, { message: 'Choose who the ride is for' })
  requesterRelationship: RequesterRelationship;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 50, {
    message: "Enter the rider's first name (up to 50 characters)",
  })
  riderFirstName?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 50, {
    message: "Enter the rider's last name (up to 50 characters)",
  })
  riderLastName?: string;

  @IsOptional()
  @Transform(trim)
  @Matches(/^[+\d\s().-]{10,20}$/, {
    message: 'Enter a valid phone number for the rider',
  })
  riderPhone?: string;

  // Family members or caregivers riding along (no extra charge).
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(3)
  companionCount?: number;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  mobilityNotes?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  instructions?: string;

  // Consent to later charges on the saved card: waiting time, no-shows and
  // late cancellations.
  @Equals(true, { message: 'Please agree to the booking terms' })
  acceptTerms: boolean;
}
