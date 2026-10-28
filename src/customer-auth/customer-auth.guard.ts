import {
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { BACKGROUND_CHECK } from '../common/decorators/background-check.decorator.js';
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
  constructor(
    private readonly sessions: CustomerSessionService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<CustomerRequest>();
    const token: unknown = request.cookies?.[CUSTOMER_SESSION_COOKIE];
    const background = this.reflector.getAllAndOverride<boolean>(
      BACKGROUND_CHECK,
      [context.getHandler(), context.getClass()],
    );
    const customer =
      typeof token === 'string'
        ? await this.sessions.findCustomer(token, { touch: !background })
        : null;

    if (!customer) throw new UnauthorizedException('Please sign in.');
    request.customer = customer;
    return true;
  }
}
