import {
  createParamDecorator,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';
import { CUSTOMER_SESSION_COOKIE } from '../auth/session-cookie.js';
import {
  CustomerSessionService,
  type SessionCustomer,
} from './customer-session.service.js';

type CustomerRequest = Request & { customer?: SessionCustomer };

// Requires a signed-in customer (session cookie). Use with @CurrentCustomer().
@Injectable()
export class CustomerAuthGuard implements CanActivate {
  constructor(private readonly sessions: CustomerSessionService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<CustomerRequest>();
    const token: unknown = request.cookies?.[CUSTOMER_SESSION_COOKIE];
    const customer =
      typeof token === 'string'
        ? await this.sessions.findCustomer(token)
        : null;

    if (!customer) throw new UnauthorizedException('Please sign in.');
    request.customer = customer;
    return true;
  }
}

export const CurrentCustomer = createParamDecorator(
  (_data: unknown, context: ExecutionContext) =>
    context.switchToHttp().getRequest<CustomerRequest>().customer!,
);
