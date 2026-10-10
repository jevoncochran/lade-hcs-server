import { ConfigService } from '@nestjs/config';
import type { ThrottlerModuleOptions } from '@nestjs/throttler';
import { isAuthRateLimited } from '../common/decorators/auth-rate-limit.decorator.js';
import type { Env } from './env.validation.js';

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
    skipIf: (context) => !isAuthRateLimited(context),
  },
];
