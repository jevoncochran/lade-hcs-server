import { randomBytes } from 'node:crypto';
import { NodeEnv, validateEnv } from './env.validation.js';

const key = () => randomBytes(32).toString('base64');

const required = {
  DATABASE_URL: 'postgresql://lade@localhost:5432/lade_hcs_test',
  SITE_URL: 'http://localhost:3000',
  ENCRYPTION_KEYS: `k1:${key()}`,
  ENCRYPTION_ACTIVE_KEY_ID: 'k1',
  BLIND_INDEX_KEY: key(),
};

describe('validateEnv', () => {
  it('applies defaults when only required values are set', () => {
    const env = validateEnv(required);

    expect(env).toMatchObject({
      NODE_ENV: NodeEnv.Development,
      PORT: 4000,
      MIN_NOTICE_HOURS: 24,
      LONG_DISTANCE_MAX_MILES: 50,
      LATE_CANCEL_WINDOW_MINUTES: 120,
      PENDING_PAYMENT_EXPIRY_MINUTES: 60,
      BUSINESS_TIMEZONE: 'America/New_York',
    });
  });

  it('converts numeric strings from the environment to numbers', () => {
    const env = validateEnv({
      ...required,
      PORT: '8080',
      MIN_NOTICE_HOURS: '48',
    });

    expect(env.PORT).toBe(8080);
    expect(env.MIN_NOTICE_HOURS).toBe(48);
  });

  it('ignores unrelated environment variables', () => {
    expect(() =>
      validateEnv({ ...required, HOME: '/Users/someone', PATH: '/usr/bin' }),
    ).not.toThrow();
  });

  it('rejects a missing DATABASE_URL', () => {
    expect(() => validateEnv({ SITE_URL: required.SITE_URL })).toThrow(
      /DATABASE_URL must be a postgres.*\(missing\)/,
    );
  });

  it('rejects a non-numeric rule and shows the bad value', () => {
    expect(() => validateEnv({ ...required, MIN_NOTICE_HOURS: '24h' })).toThrow(
      /MIN_NOTICE_HOURS must be an integer.*\(got "24h"\)/,
    );
  });

  it('rejects an out-of-range port', () => {
    expect(() => validateEnv({ ...required, PORT: '70000' })).toThrow(/PORT/);
  });

  it('rejects an unknown NODE_ENV', () => {
    expect(() => validateEnv({ ...required, NODE_ENV: 'prod' })).toThrow(
      /NODE_ENV/,
    );
  });

  it('rejects a time zone that does not exist', () => {
    expect(() =>
      validateEnv({ ...required, BUSINESS_TIMEZONE: 'America/Tampa' }),
    ).toThrow(/not a known time zone/);
  });

  it('lists every problem in one error', () => {
    expect(() => validateEnv({ PORT: 'abc' })).toThrow(
      /DATABASE_URL[\s\S]*SITE_URL[\s\S]*PORT|PORT[\s\S]*DATABASE_URL[\s\S]*SITE_URL/,
    );
  });

  it('rejects invalid encryption keys', () => {
    expect(() =>
      validateEnv({ ...required, ENCRYPTION_KEYS: 'k1:REPLACE_ME' }),
    ).toThrow(/ENCRYPTION_KEYS: key "k1" must be 32 bytes/);
  });

  it('rejects an active key id that is not in the keyring', () => {
    expect(() =>
      validateEnv({ ...required, ENCRYPTION_ACTIVE_KEY_ID: 'k2' }),
    ).toThrow(/ENCRYPTION_ACTIVE_KEY_ID "k2"/);
  });

  it('requires the encryption settings', () => {
    const { ENCRYPTION_KEYS: _keys, ...withoutKeys } = required;

    expect(() => validateEnv(withoutKeys)).toThrow(/ENCRYPTION_KEYS/);
  });

  it('never echoes secret values in errors', () => {
    const badUrl = 'mysql://admin:hunter2@db.example.com/lade';
    const error = (() => {
      try {
        validateEnv({ ...required, DATABASE_URL: badUrl, PORT: 'abc' });
      } catch (e) {
        return (e as Error).message;
      }
    })();

    expect(error).toMatch(/DATABASE_URL .*\(value hidden\)/);
    expect(error).not.toContain('hunter2');
    expect(error).toContain('got "abc"'); // non-secrets still shown
  });
});
