export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_MS = 15 * 60 * 1000;

type LockoutState = { failedLoginCount: number; lockedUntil: Date | null };

export const isLocked = (account: LockoutState, now = new Date()) =>
  account.lockedUntil !== null && account.lockedUntil > now;

// The update to apply after a failed attempt. The 5th failure locks the
// account for 15 minutes and resets the count for the next round.
export const afterFailedLogin = (
  account: LockoutState,
  now = new Date(),
): LockoutState => {
  const failures = account.failedLoginCount + 1;
  return failures >= MAX_FAILED_LOGINS
    ? { failedLoginCount: 0, lockedUntil: new Date(now.getTime() + LOCKOUT_MS) }
    : { failedLoginCount: failures, lockedUntil: account.lockedUntil };
};

export const afterSuccessfulLogin = (now = new Date()) => ({
  failedLoginCount: 0,
  lockedUntil: null,
  lastLoginAt: now,
});

// Same message for unknown email, wrong password and locked account, so the
// response never reveals which one it was (or that a password was right
// during a lockout).
export const LOGIN_FAILED_MESSAGE =
  'Incorrect email or password. After 5 failed attempts, sign-in is paused for 15 minutes.';
