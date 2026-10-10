import type { CookieOptions } from 'express';
import { NodeEnv } from '../config/env.validation.js';

// Separate cookie names for customers and staff, so one can never be used as
// the other.
export const CUSTOMER_SESSION_COOKIE = 'lade_sid';
export const STAFF_SESSION_COOKIE = 'lade_staff_sid';

// httpOnly: page scripts can't read it. secure: HTTPS only in production.
// sameSite lax: not sent on cross-site POSTs (OriginGuard is the second layer).
export const sessionCookieOptions = (
  nodeEnv: NodeEnv,
  maxAgeMs?: number,
): CookieOptions => ({
  httpOnly: true,
  secure: nodeEnv === NodeEnv.Production,
  sameSite: 'lax',
  path: '/',
  ...(maxAgeMs === undefined ? {} : { maxAge: maxAgeMs }),
});

export type SessionTimeouts = { idleMs: number; absoluteMs: number };

// Whether a stored session is still usable. Revoked, past its absolute limit,
// or idle too long all mean "log in again".
export const isSessionActive = (
  session: { lastSeenAt: Date; expiresAt: Date; revokedAt: Date | null },
  idleMs: number,
  now = new Date(),
) =>
  session.revokedAt === null &&
  session.expiresAt > now &&
  now.getTime() - session.lastSeenAt.getTime() < idleMs;

// lastSeenAt is refreshed at most once a minute to avoid a write per request.
export const SESSION_TOUCH_INTERVAL_MS = 60_000;
