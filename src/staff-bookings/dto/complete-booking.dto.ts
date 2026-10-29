import { IsIn, IsInt, IsOptional, Max, Min, ValidateIf } from 'class-validator';

const MAX_WAIT_MINUTES = 12 * 60;

// POST /staff/bookings/:id/complete
//
// Waits are the minutes the driver waited at that pickup (or during the
// appointment, for wait-and-return); the first 15 are free.
export class CompleteBookingDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_WAIT_MINUTES)
  outboundWaitMinutes?: number;

  // Round trips: did the ride back happen? A ride back that wasn't needed
  // isn't charged (the trip is billed as one-way).
  @ValidateIf((dto: CompleteBookingDto) => dto.returnLeg !== undefined)
  @IsIn(['COMPLETED', 'CANCELLED'])
  returnLeg?: 'COMPLETED' | 'CANCELLED';

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_WAIT_MINUTES)
  returnWaitMinutes?: number;
}
