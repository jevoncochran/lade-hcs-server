import {
  ForbiddenException,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { Env } from '../../config/env.validation.js';
import { SKIP_ORIGIN_CHECK } from '../decorators/skip-origin-check.decorator.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// CSRF protection for cookie-authenticated requests: every state-changing
// request must come from the Lade website's origin. Browsers always send
// Origin on cross-origin POST/PUT/PATCH/DELETE, and pages can't forge it.
@Injectable()
export class OriginGuard implements CanActivate {
  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(request.method)) return true;

    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_ORIGIN_CHECK, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) return true;

    if (
      request.headers.origin !== this.config.get('SITE_URL', { infer: true })
    ) {
      throw new ForbiddenException('Request origin not allowed');
    }
    return true;
  }
}
