import { SetMetadata, type ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ThrottlerModuleOptions } from '@nestjs/throttler';
import type { Env } from '../config/env.validation.js';

const AUTH_RATE_LIMITED = 'authRateLimited';

// Marks a login / sign-up / reset endpoint for the stricter per-IP limit.
export const AuthRateLimit = () => SetMetadata(AUTH_RATE_LIMITED, true);

const isAuthRoute = (context: ExecutionContext) =>
  Reflect.getMetadata(AUTH_RATE_LIMITED, context.getHandler()) === true;

// Limits are per IP, per endpoint, per Cloud Run instance (in memory). That's
// enough to blunt password guessing at Lade's scale; the per-account lockout
// is the main defence.
export const rateLimitOptions = (
  config: ConfigService<Env, true>,
): ThrottlerModuleOptions => [
  { name: 'default', ttl: 60_000, limit: 300 },
  {
    name: 'auth',
    ttl: 60_000,
    limit: config.get('AUTH_RATE_LIMIT_PER_MINUTE', { infer: true }),
    skipIf: (context) => !isAuthRoute(context),
  },
];
