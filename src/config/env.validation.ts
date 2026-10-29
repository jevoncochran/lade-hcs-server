import { plainToInstance, Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsIn,
  IsOptional,
  IsInt,
  IsString,
  IsUrl,
  Matches,
  Max,
  Min,
  MinLength,
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

  // Shared secret the website adds to every request it forwards to the API
  // (header x-lade-proxy). When set, the API refuses requests without it
  // (except GET /health), so it's only reachable through the website even
  // though its Cloud Run address is public. Required in production.
  @IsOptional()
  @IsString()
  @MinLength(32, { message: 'PROXY_SECRET must be at least 32 characters' })
  PROXY_SECRET?: string;

  // Proxies between visitors and the API that add to X-Forwarded-For, so the
  // API sees each visitor's real address (rate limits, audit log). On Cloud
  // Run behind the website: Google's front end for the website, then for the
  // API = 2. Production only.
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(5)
  TRUST_PROXY_HOPS = 2;

  // Lets production run with Stripe TEST keys while the site is still being
  // tested (no real money moves). Turn off at launch, with live keys.
  @Transform(
    ({ value }: { value: unknown }) => value === true || value === 'true',
  )
  @IsBoolean()
  ALLOW_TEST_PAYMENTS = false;

  @Matches(/^postgres(ql)?:\/\/.+/, {
    message: 'DATABASE_URL must be a postgres:// or postgresql:// URL',
  })
  DATABASE_URL: string;

  // The Lade website's origin, e.g. https://ladehealthcare.com. The only
  // browser origin allowed to call the API, and the base for links in emails.
  @IsUrl({ require_tld: false, require_protocol: true })
  @Matches(/^[^/]+\/\/[^/]+$/, {
    message: 'SITE_URL must be an origin with no path or trailing slash',
  })
  SITE_URL: string;

  // ---------- Accounts ----------

  // Version of the terms of service / privacy notice customers accept at
  // sign-up and checkout. Bump it when the documents change.
  @IsString()
  TERMS_VERSION = '2026-10-draft';

  // "log" prints emails to the server log (development and tests only);
  // "ses" sends them with Amazon SES (covered by the AWS BAA) in AWS_REGION.
  @IsIn(['log', 'ses'])
  MAIL_TRANSPORT = 'log';

  // Sender of every email. Its domain must be verified in SES.
  @IsString()
  MAIL_FROM = 'Lade Health Care Services <no-reply@ladehcs.com>';

  // Where replies go (no-reply@ can't receive mail). Optional.
  @Transform(({ value }: { value: unknown }) =>
    value === '' ? undefined : value,
  )
  @IsOptional()
  @IsEmail()
  MAIL_REPLY_TO?: string;

  // Lade's inbox for contact form messages (a Google Workspace mailbox,
  // covered by its BAA: messages may contain health details).
  @IsEmail()
  CONTACT_INBOX = 'info@ladehcs.com';

  // Access key of an IAM user allowed only ses:SendEmail. Leave both empty
  // when the server runs on AWS with a role that may send.
  @IsOptional()
  @IsString()
  SES_ACCESS_KEY_ID?: string;

  @IsOptional()
  @IsString()
  SES_SECRET_ACCESS_KEY?: string;

  // "estimate" guesses distances from ZIP codes (development and tests
  // only, no address autofill); "aws" uses Amazon Location Service for real
  // driving distances and address autofill.
  @IsIn(['estimate', 'aws'])
  MILEAGE_PROVIDER = 'estimate';

  // AWS_REGION: where SES and Amazon Location Service are used.
  // Amazon Location Service (when MILEAGE_PROVIDER is "aws"): an API key
  // limited to Places (Autocomplete, GetPlace, Geocode) and Routes
  // (CalculateRoutes), with no referrer restriction. Real rider addresses
  // must not be sent until the AWS BAA is accepted.
  @IsString()
  AWS_REGION = 'us-east-1';

  @IsOptional()
  @IsString()
  AWS_LOCATION_API_KEY?: string;

  // "fake" makes up payment ids and never charges (development and tests
  // only); "stripe" uses the keys below.
  @IsIn(['fake', 'stripe'])
  PAYMENT_PROVIDER = 'fake';

  // Stripe secret key (sk_test_… for development, sk_live_… in production).
  @IsOptional()
  @IsString()
  STRIPE_SECRET_KEY?: string;

  // Stripe publishable key (pk_test_… / pk_live_…, same mode as the secret
  // key). Not secret: the API hands it to the website's card form with each
  // card setup, so test/live is switched here only.
  @IsOptional()
  @IsString()
  STRIPE_PUBLISHABLE_KEY?: string;

  // Signing secret of the Stripe webhook endpoint (whsec_…). Optional in
  // development: the website confirms saved cards directly; the webhook is
  // the production backup.
  @IsOptional()
  @IsString()
  STRIPE_WEBHOOK_SECRET?: string;

  // Requests per minute per IP to each login / sign-up / reset endpoint.
  @Type(() => Number)
  @IsInt()
  @Min(1)
  AUTH_RATE_LIMIT_PER_MINUTE = 10;

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
  'PROXY_SECRET',
  'AWS_LOCATION_API_KEY',
  'SES_SECRET_ACCESS_KEY',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
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

  // An empty value (e.g. "SES_ACCESS_KEY_ID=" in .env) means not set.
  if (Boolean(env.SES_ACCESS_KEY_ID) !== Boolean(env.SES_SECRET_ACCESS_KEY)) {
    messages.push(
      '  - SES_ACCESS_KEY_ID and SES_SECRET_ACCESS_KEY go together: set both or neither',
    );
  }

  if (env.MILEAGE_PROVIDER === 'aws' && !env.AWS_LOCATION_API_KEY) {
    messages.push(
      '  - AWS_LOCATION_API_KEY is required when MILEAGE_PROVIDER is "aws"',
    );
  }

  if (env.PAYMENT_PROVIDER === 'stripe') {
    if (!/^sk_(test|live)_\w+$/.test(env.STRIPE_SECRET_KEY ?? '')) {
      messages.push(
        '  - STRIPE_SECRET_KEY must be a Stripe secret key (sk_test_… or sk_live_…) when PAYMENT_PROVIDER is "stripe"',
      );
    }
    const publishable = env.STRIPE_PUBLISHABLE_KEY ?? '';
    if (!/^pk_(test|live)_\w+$/.test(publishable)) {
      messages.push(
        '  - STRIPE_PUBLISHABLE_KEY must be a Stripe publishable key (pk_test_… or pk_live_…) when PAYMENT_PROVIDER is "stripe"',
      );
    } else if (
      env.STRIPE_SECRET_KEY &&
      publishable.startsWith('pk_live_') !==
        env.STRIPE_SECRET_KEY.startsWith('sk_live_')
    ) {
      messages.push(
        '  - STRIPE_PUBLISHABLE_KEY and STRIPE_SECRET_KEY must both be test keys or both be live keys',
      );
    }
    // An empty value (e.g. "STRIPE_WEBHOOK_SECRET=" in .env) means not set.
    if (
      env.STRIPE_WEBHOOK_SECRET &&
      !/^whsec_\w+$/.test(env.STRIPE_WEBHOOK_SECRET)
    ) {
      messages.push('  - STRIPE_WEBHOOK_SECRET must start with whsec_');
    }
  }

  // Stand-ins that would silently mislead real customers: never in production.
  if (env.NODE_ENV === NodeEnv.Production) {
    if (env.MAIL_TRANSPORT === 'log') {
      messages.push(
        '  - MAIL_TRANSPORT "log" only prints emails; production must send them',
      );
    }
    if (env.PAYMENT_PROVIDER === 'fake') {
      messages.push(
        '  - PAYMENT_PROVIDER "fake" never saves or charges cards; production needs Stripe',
      );
    } else {
      if (
        !env.ALLOW_TEST_PAYMENTS &&
        !env.STRIPE_SECRET_KEY?.startsWith('sk_live_')
      ) {
        messages.push('  - Production needs a live Stripe key (sk_live_…)');
      }
      if (!env.ALLOW_TEST_PAYMENTS && !env.STRIPE_WEBHOOK_SECRET) {
        messages.push(
          '  - Production needs STRIPE_WEBHOOK_SECRET so saved cards are confirmed even if the customer closes the page',
        );
      }
    }
    if (env.MILEAGE_PROVIDER === 'estimate') {
      messages.push(
        '  - MILEAGE_PROVIDER "estimate" makes up distances; production needs real ones',
      );
    }
    if (!env.PROXY_SECRET) {
      messages.push(
        '  - Production needs PROXY_SECRET so only the website can reach the API',
      );
    }
  }

  if (messages.length > 0) {
    throw new Error(`Invalid config:\n${messages.join('\n')}`);
  }
  return env;
};
