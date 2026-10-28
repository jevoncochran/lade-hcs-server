import {
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { BACKGROUND_CHECK } from '../common/decorators/background-check.decorator.js';
import { STAFF_SESSION_COOKIE } from '../auth/session-cookie.js';
import {
  StaffSessionService,
  type SessionStaff,
} from './staff-session.service.js';

export type StaffRequest = Request & { staff?: SessionStaff };

// Requires a signed-in staff member (staff session cookie). Read them with
// @CurrentStaff(). Role checks come with the admin endpoints.
@Injectable()
export class StaffAuthGuard implements CanActivate {
  constructor(
    private readonly sessions: StaffSessionService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<StaffRequest>();
    const token: unknown = request.cookies?.[STAFF_SESSION_COOKIE];
    const background = this.reflector.getAllAndOverride<boolean>(
      BACKGROUND_CHECK,
      [context.getHandler(), context.getClass()],
    );
    const staff =
      typeof token === 'string'
        ? await this.sessions.findStaff(token, { touch: !background })
        : null;

    if (!staff) throw new UnauthorizedException('Please sign in.');
    request.staff = staff;
    return true;
  }
}
