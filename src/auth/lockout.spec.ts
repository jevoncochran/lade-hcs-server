import {
  afterFailedLogin,
  isLocked,
  LOCKOUT_MS,
  MAX_FAILED_LOGINS,
} from './lockout.js';

describe('login lockout', () => {
  const now = new Date('2026-10-10T12:00:00Z');

  it('counts failures below the limit without locking', () => {
    let state = { failedLoginCount: 0, lockedUntil: null as Date | null };
    for (let i = 1; i < MAX_FAILED_LOGINS; i++) {
      state = afterFailedLogin(state, now);
      expect(state).toEqual({ failedLoginCount: i, lockedUntil: null });
    }
  });

  it('locks for 15 minutes on the 5th failure and resets the count', () => {
    const state = afterFailedLogin(
      { failedLoginCount: MAX_FAILED_LOGINS - 1, lockedUntil: null },
      now,
    );

    expect(state.failedLoginCount).toBe(0);
    expect(state.lockedUntil).toEqual(new Date(now.getTime() + LOCKOUT_MS));
    expect(isLocked(state, now)).toBe(true);
  });

  it('unlocks once the lock time has passed', () => {
    const lockedUntil = new Date(now.getTime() + LOCKOUT_MS);

    expect(isLocked({ failedLoginCount: 0, lockedUntil }, now)).toBe(true);
    expect(
      isLocked(
        { failedLoginCount: 0, lockedUntil },
        new Date(lockedUntil.getTime() + 1),
      ),
    ).toBe(false);
  });
});
