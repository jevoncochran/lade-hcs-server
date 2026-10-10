import { plainToInstance, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsString,
  IsUrl,
  Matches,
  Max,
  Min,
  validateSync,
  type ValidationError,
} from 'class-validator';
import { checkCryptoSettings } from '../crypto/keys.js';

export enum NodeEnv {
  Development = 'development',
  Test = 'test',
  Production = 'production',
}

// Every environment variable the API reads. The app refuses to start if any
// value is missing or invalid, so a bad setting is caught at deploy time
// instead of by a customer. Read values through ConfigService, never
// `process.env`:
//
//   constructor(private readonly config: ConfigService<Env, true>) {}
//   this.config.get('MIN_NOTICE_HOURS', { infer: true }) // number
//
// Add new settings here when the feature that needs them is built.
export class Env {
  @IsEnum(NodeEnv)
  NODE_ENV: NodeEnv = NodeEnv.Development;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT = 4000;

  @Matches(/^postgres(ql)?:\/\/.+/, {
    message: 'DATABASE_URL must be a postgres:// or postgresql:// URL',
  })
  DATABASE_URL: string;

  // The Lade website's origin, the only browser origin allowed to call the API.
  @IsUrl({ require_tld: false, require_protocol: true })
  CORS_ORIGIN: string;

  // ---------- PHI encryption (see src/crypto/keys.ts) ----------
  // Generate local values with `npm run keys:generate`.

  @IsString()
  ENCRYPTION_KEYS: string;

  @IsString()
  ENCRYPTION_ACTIVE_KEY_ID: string;

  @IsString()
  BLIND_INDEX_KEY: string;

  // ---------- Booking rules (see docs/plan.md) ----------

  @Type(() => Number)
  @IsInt()
  @Min(0)
  MIN_NOTICE_HOURS = 24;

  // Trips with a leg longer than this get "call for a quote".
  @Type(() => Number)
  @IsInt()
  @Min(1)
  LONG_DISTANCE_MAX_MILES = 50;

  // Cancelling closer than this to pickup incurs the late-cancel fee.
  @Type(() => Number)
  @IsInt()
  @Min(0)
  LATE_CANCEL_WINDOW_MINUTES = 120;

  // Bookings still waiting on a card after this long are deleted.
  @Type(() => Number)
  @IsInt()
  @Min(5)
  PENDING_PAYMENT_EXPIRY_MINUTES = 60;

  @IsString()
  @Matches(/^[A-Za-z_]+\/[A-Za-z_]+$/, {
    message: 'BUSINESS_TIMEZONE must be an IANA zone like America/New_York',
  })
  BUSINESS_TIMEZONE = 'America/New_York';
}

// Values never echoed in error messages: they'd end up in deploy logs.
const SECRET_SETTINGS = new Set([
  'DATABASE_URL',
  'ENCRYPTION_KEYS',
  'BLIND_INDEX_KEY',
]);

const formatErrors = (
  errors: ValidationError[],
  raw: Record<string, unknown>,
) =>
  errors.flatMap((error) => {
    const got =
      raw[error.property] === undefined
        ? 'missing'
        : SECRET_SETTINGS.has(error.property)
          ? 'value hidden'
          : `got "${String(raw[error.property])}"`;
    return Object.values(error.constraints ?? {}).map(
      (message) => `  - ${message} (${got})`,
    );
  });

const isRealTimeZone = (zone: string) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
};

// Passed to ConfigModule.forRoot({ validate }). Returns the typed, defaulted
// config or throws one error listing every problem at once.
export const validateEnv = (raw: Record<string, unknown>): Env => {
  // Numbers are converted with explicit @Type(() => Number) rather than
  // implicit conversion, which silently skips un-annotated properties.
  const env = plainToInstance(Env, raw);
  const errors = validateSync(env);
  const messages = formatErrors(errors, raw);

  const zoneHasError = errors.some((e) => e.property === 'BUSINESS_TIMEZONE');
  if (!zoneHasError && !isRealTimeZone(env.BUSINESS_TIMEZONE)) {
    messages.push(
      `  - BUSINESS_TIMEZONE is not a known time zone (got "${env.BUSINESS_TIMEZONE}")`,
    );
  }

  const cryptoHasError = errors.some((e) =>
    ['ENCRYPTION_KEYS', 'ENCRYPTION_ACTIVE_KEY_ID', 'BLIND_INDEX_KEY'].includes(
      e.property,
    ),
  );
  if (!cryptoHasError) {
    messages.push(
      ...checkCryptoSettings(env).map((problem) => `  - ${problem}`),
    );
  }

  if (messages.length > 0) {
    throw new Error(`Invalid config:\n${messages.join('\n')}`);
  }
  return env;
};
