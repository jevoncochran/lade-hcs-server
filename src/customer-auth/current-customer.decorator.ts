import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { CustomerRequest } from './customer-auth.guard.js';

// The signed-in person, set by the guard. Only use on routes behind it.
export const CurrentCustomer = createParamDecorator(
  (_data: unknown, context: ExecutionContext) =>
    context.switchToHttp().getRequest<CustomerRequest>().customer!,
);
