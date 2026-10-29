import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { StaffRequest } from './staff-auth.guard.js';

// The signed-in person, set by the guard. Only use on routes behind it.
export const CurrentStaff = createParamDecorator(
  (_data: unknown, context: ExecutionContext) =>
    context.switchToHttp().getRequest<StaffRequest>().staff!,
);
