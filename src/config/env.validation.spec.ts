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

  it('refuses development stand-ins in production', () => {
    expect(() => validateEnv({ ...required, NODE_ENV: 'production' })).toThrow(
      /MAIL_TRANSPORT "log"[\s\S]*PAYMENT_PROVIDER "fake"[\s\S]*MILEAGE_PROVIDER "estimate"/,
    );
  });

  it('allows the stand-ins outside production', () => {
    expect(() =>
      validateEnv({ ...required, NODE_ENV: 'development' }),
    ).not.toThrow();
    expect(() => validateEnv({ ...required, NODE_ENV: 'test' })).not.toThrow();
  });

  describe('email', () => {
    it('sends with SES from the default address', () => {
      expect(validateEnv({ ...required, MAIL_TRANSPORT: 'ses' })).toMatchObject(
        {
          MAIL_TRANSPORT: 'ses',
          MAIL_FROM: 'Lade Health Care Services <no-reply@ladehcs.com>',
        },
      );
    });

    it('treats an empty reply-to as not set, but checks a real one', () => {
      expect(
        validateEnv({ ...required, MAIL_REPLY_TO: '' }).MAIL_REPLY_TO,
      ).toBe(undefined);
      expect(() =>
        validateEnv({ ...required, MAIL_REPLY_TO: 'not an email' }),
      ).toThrow(/MAIL_REPLY_TO/);
    });

    it('needs both SES keys or neither, without echoing the secret', () => {
      const run = () =>
        validateEnv({
          ...required,
          MAIL_TRANSPORT: 'ses',
          SES_SECRET_ACCESS_KEY: 'super-secret-value',
        });
      expect(run).toThrow(/set both or neither/);
      expect(run).not.toThrow(/super-secret-value/);
    });
  });

  describe('AWS Location', () => {
    it('requires an API key when mileage uses AWS', () => {
      expect(() =>
        validateEnv({ ...required, MILEAGE_PROVIDER: 'aws' }),
      ).toThrow(/AWS_LOCATION_API_KEY is required/);
      expect(() =>
        validateEnv({
          ...required,
          MILEAGE_PROVIDER: 'aws',
          AWS_LOCATION_API_KEY: 'v1.public.abc',
        }),
      ).not.toThrow();
    });

    it('defaults to us-east-1', () => {
      expect(validateEnv(required).AWS_REGION).toBe('us-east-1');
    });
  });

  describe('Stripe', () => {
    const stripe = { ...required, PAYMENT_PROVIDER: 'stripe' };

    it('accepts a test key in development', () => {
      expect(() =>
        validateEnv({ ...stripe, STRIPE_SECRET_KEY: 'sk_test_abc123' }),
      ).not.toThrow();
    });

    it('requires a secret key when Stripe is on', () => {
      expect(() => validateEnv(stripe)).toThrow(/STRIPE_SECRET_KEY must be/);
      expect(() =>
        validateEnv({ ...stripe, STRIPE_SECRET_KEY: 'pk_test_abc' }),
      ).toThrow(/STRIPE_SECRET_KEY must be/);
    });

    it('checks the webhook secret format', () => {
      expect(() =>
        validateEnv({
          ...stripe,
          STRIPE_SECRET_KEY: 'sk_test_abc',
          STRIPE_WEBHOOK_SECRET: 'nope',
        }),
      ).toThrow(/whsec_/);
    });

    it('requires a live key and a webhook secret in production', () => {
      const error = (() => {
        try {
          validateEnv({
            ...stripe,
            NODE_ENV: 'production',
            STRIPE_SECRET_KEY: 'sk_test_abc',
          });
        } catch (e) {
          return (e as Error).message;
        }
      })();

      expect(error).toMatch(/live Stripe key/);
      expect(error).toMatch(/STRIPE_WEBHOOK_SECRET/);
      expect(error).not.toContain('sk_test_abc');
    });
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
