import { applyDecorators } from '@nestjs/common';
import { IsISO8601, Matches } from 'class-validator';

// A real ISO 8601 date and time WITH a time zone, e.g.
// "2026-10-14T09:30:00-04:00", so there's no doubt which 9:30 is meant.
export const IsZonedDateTime = (label = 'Time') =>
  applyDecorators(
    IsISO8601(
      { strict: true, strictSeparator: true },
      { message: `${label} must be a real date and time` },
    ),
    Matches(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/,
      {
        message: `${label} must be a date and time with a time zone`,
      },
    ),
  );
