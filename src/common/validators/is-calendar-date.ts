import { applyDecorators } from '@nestjs/common';
import { IsISO8601, Matches } from 'class-validator';

// A real calendar date with no time, e.g. "2026-10-21".
export const IsCalendarDate = (label = 'Date') =>
  applyDecorators(
    IsISO8601({ strict: true }, { message: `${label} must be a real date` }),
    Matches(/^\d{4}-\d{2}-\d{2}$/, {
      message: `${label} must look like 2026-10-21`,
    }),
  );
