import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, Length, ValidateIf } from 'class-validator';
import { trim } from '../../common/transforms.js';

// POST /staff/bookings/:id/cancel
export class CancelBookingDto {
  // Why it was cancelled, e.g. "Rider's appointment moved". Encrypted.
  @Transform(trim)
  @Length(1, 500, { message: 'Enter why the ride is cancelled' })
  reason: string;

  // Admins only: don't charge the late-cancellation fee.
  @IsOptional()
  @IsBoolean()
  waiveFee?: boolean;

  @ValidateIf((dto: CancelBookingDto) => dto.waiveFee === true)
  @Transform(trim)
  @Length(1, 500, { message: 'Enter why the fee is waived' })
  waiveReason?: string;
}
