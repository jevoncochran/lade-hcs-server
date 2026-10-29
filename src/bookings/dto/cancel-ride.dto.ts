import { Transform } from 'class-transformer';
import { IsInt, IsOptional, Length, Min } from 'class-validator';
import { trim } from '../../common/transforms.js';

// POST /bookings/:id/cancel (the customer cancelling their own ride)
export class CancelRideDto {
  // Optional: helps Lade, never required from a customer.
  @IsOptional()
  @Transform(trim)
  @Length(0, 500)
  reason?: string;

  // The late-cancellation fee the customer saw and agreed to (0 or absent:
  // none). If the pickup gets closer while they decide and a fee now
  // applies, the API refuses rather than charge one they didn't see.
  @IsOptional()
  @IsInt()
  @Min(0)
  acceptedFeeCents?: number;
}
