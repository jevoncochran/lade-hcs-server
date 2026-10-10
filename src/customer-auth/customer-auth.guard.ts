import {
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

export type CustomerRequest = Request & { customer?: SessionCustomer };

// Requires a signed-in customer (session cookie). Read them with
// @CurrentCustomer().
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
