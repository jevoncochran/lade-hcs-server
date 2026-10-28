import { SetMetadata, type ExecutionContext } from '@nestjs/common';

const AUTH_RATE_LIMITED = 'authRateLimited';

// Marks a login / sign-up / reset endpoint, or another public form bots
// target (the contact form), for the stricter per-IP limit (see
// config/rate-limit.config.ts).
export const AuthRateLimit = () => SetMetadata(AUTH_RATE_LIMITED, true);

export const isAuthRateLimited = (context: ExecutionContext) =>
  Reflect.getMetadata(AUTH_RATE_LIMITED, context.getHandler()) === true;
