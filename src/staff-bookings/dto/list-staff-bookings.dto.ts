import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  Length,
  Max,
  Min,
} from 'class-validator';
import { trim } from '../../common/transforms.js';
import { IsCalendarDate } from '../../common/validators/is-calendar-date.js';
import { BookingStatus } from '../../generated/prisma/client.js';

export const BOOKING_SORTS = ['pickup', 'newest'] as const;
export type BookingSort = (typeof BOOKING_SORTS)[number];

export const MAX_PAGE_SIZE = 100;

// GET /staff/bookings?status=REQUESTED,CONFIRMED&from=2026-10-21&to=2026-10-27
//
// Dates are pickup days in the business time zone, both ends included. With
// no dates and no search, the list starts today.
export class ListStaffBookingsDto {
  // One or more, comma-separated or repeated. Default: every status except
  // PENDING_PAYMENT (checkouts where the card was never saved).
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.split(',').map((s) => s.trim()) : value,
  )
  @IsEnum(BookingStatus, {
    each: true,
    message: `status must be one of ${Object.values(BookingStatus).join(', ')}`,
  })
  status?: BookingStatus[];

  @IsOptional()
  @IsCalendarDate('from')
  from?: string;

  @IsOptional()
  @IsCalendarDate('to')
  to?: string;

  // Exact booking reference, e.g. "LD-7K3Q9X" (what a caller reads out).
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @Length(1, 20)
  reference?: string;

  // Exact last name (any capitalization). Encrypted in the database, so
  // there's no partial match.
  @IsOptional()
  @Transform(trim)
  @Length(1, 50)
  riderLastName?: string;

  // "pickup": soonest first (dispatch). "newest": latest requests first.
  @IsOptional()
  @IsIn(BOOKING_SORTS)
  sort: BookingSort = 'pickup';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  pageSize: number = 50;
}
