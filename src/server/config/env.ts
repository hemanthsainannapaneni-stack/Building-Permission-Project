import 'server-only';
import { z } from 'zod';

/**
 * The ONLY place in the codebase that reads process.env.
 *
 * Parsed once at boot. A missing or malformed value fails fast with a message
 * that names every offending key, rather than surfacing as `undefined` three
 * layers deep at request time.
 *
 * This file holds SECRETS AND INFRASTRUCTURE. Business configuration — SLA
 * days, rounding rules, mock scrutiny behaviour — lives in `system_settings`
 * and is edited in the admin UI. See docs/00-architecture.md A.6.
 */

const bool = (fallback: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? fallback : v.toLowerCase() === 'true' || v === '1'));

const int = (fallback: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? fallback : Number(v)))
    .pipe(z.number().int());

const optional = z
  .string()
  .optional()
  .transform((v) => v ?? '');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  APP_URL: z.string().default('http://localhost:3000'),
  APP_NAME: z.string().default('BBAS'),
  ORG_SHORT_NAME: z.string().default('BBAS'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required').default('postgresql://postgres.bunfbgaxbueririehybw:Digitaltwin%405678@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=20&pool_timeout=30'),
  DIRECT_URL: optional,

  AUTH_SECRET: z.string().min(32, 'AUTH_SECRET must be at least 32 characters').default('dev-only-secret-change-me-at-least-32-chars-long'),
  ACCESS_TOKEN_TTL_MINUTES: int(15),
  SESSION_IDLE_TTL_HOURS: int(8),
  SESSION_ABSOLUTE_TTL_HOURS: int(24),
  MAX_FAILED_LOGINS: int(5),
  LOCKOUT_MINUTES: int(15),

  STORAGE_PROVIDER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('./.storage'),
  S3_ENDPOINT: optional,
  S3_REGION: optional,
  S3_BUCKET: optional,
  S3_ACCESS_KEY_ID: optional,
  S3_SECRET_ACCESS_KEY: optional,
  S3_FORCE_PATH_STYLE: bool(true),
  SIGNED_URL_TTL_SECONDS: int(300),
  MAX_UPLOAD_MB: int(25),

  SCRUTINY_PROVIDER: z.enum(['mock', 'http']).default('mock'),
  SCRUTINY_HTTP_URL: optional,
  SCRUTINY_HTTP_API_KEY: optional,
  SCRUTINY_CALLBACK_SECRET: optional,

  // One of the approved gateways, or the mock. Adding a fourth is a value here
  // and a driver in src/server/payments — no call site changes.
  PAYMENT_PROVIDER: z.enum(['mock', 'razorpay', 'payu', 'ccavenue']).default('mock'),
  PAYMENT_KEY_ID: optional,
  PAYMENT_KEY_SECRET: optional,
  PAYMENT_WEBHOOK_SECRET: optional,
  /// CCAvenue issues a third credential — the access code — alongside the
  /// merchant id and the working key. Named for what it is rather than forced
  /// into PAYMENT_KEY_ID, because an operator copying values from a gateway
  /// dashboard should not have to guess our mapping.
  PAYMENT_ACCESS_CODE: optional,
  PAYMENT_API_BASE: optional,

  SMS_PROVIDER: z.enum(['mock', 'msg91']).default('mock'),
  SMS_API_KEY: optional,
  SMS_SENDER_ID: optional,

  EMAIL_PROVIDER: z.enum(['console', 'smtp']).default('console'),
  EMAIL_FROM: z.string().default('LAMS <no-reply@example.gov.in>'),
  SMTP_HOST: optional,
  SMTP_PORT: int(587),
  SMTP_USER: optional,
  SMTP_PASSWORD: optional,

  ANTIVIRUS_PROVIDER: z.enum(['noop', 'clamav']).default('noop'),
  CLAMAV_HOST: optional,
  CLAMAV_PORT: int(3310),

  ALLOW_MOCK_SCRUTINY_IN_PRODUCTION: bool(true),
  ALLOW_MOCK_PAYMENTS_IN_PRODUCTION: bool(true),

  WORKER_ENABLED: bool(true),
  WORKER_POLL_MS: int(2000),
  WORKER_CONCURRENCY: int(2),
  WORKER_ID: optional,

  CRON_SECRET: optional,

  DEMO_MODE: bool(true),
  DEMO_PASSWORD: z.string().default('Demo@12345'),

  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

function parse() {
  const result = schema.safeParse(process.env);

  if (!result.success) {
    const lines = result.error.issues.map((i) => `  • ${i.path.join('.')}: ${i.message}`);
    throw new Error(
      `Environment is not valid. Fix these and restart:\n${lines.join('\n')}\n\n` +
        `Copy .env.example to .env if you have not already.`
    );
  }

  const e = result.data;

  // ── Production guardrails ────────────────────────────────────────────
  const isBuildPhase = process.env.NEXT_PHASE === 'phase-production-build';

  if (e.NODE_ENV === 'production' && !isBuildPhase && !e.DEMO_MODE) {
    const problems: string[] = [];

    if (e.AUTH_SECRET.startsWith('dev-only')) {
      problems.push('AUTH_SECRET is still the sample value — generate one with `openssl rand -base64 48`');
    }
    if (e.STORAGE_PROVIDER === 'local') {
      problems.push('STORAGE_PROVIDER=local will not survive a restart — use s3');
    }
    if (problems.length) {
      console.warn(`Production warnings:\n${problems.map((p) => `  • ${p}`).join('\n')}`);
    }
  }

  if (e.STORAGE_PROVIDER === 's3' && !e.S3_BUCKET) {
    throw new Error('STORAGE_PROVIDER=s3 requires S3_BUCKET.');
  }
  if (e.SCRUTINY_PROVIDER === 'http' && !e.SCRUTINY_HTTP_URL) {
    throw new Error('SCRUTINY_PROVIDER=http requires SCRUTINY_HTTP_URL.');
  }
  if (e.PAYMENT_PROVIDER !== 'mock' && !(e.PAYMENT_KEY_ID && e.PAYMENT_KEY_SECRET)) {
    throw new Error(`PAYMENT_PROVIDER=${e.PAYMENT_PROVIDER} requires PAYMENT_KEY_ID and PAYMENT_KEY_SECRET.`);
  }

  return {
    nodeEnv: e.NODE_ENV,
    isProduction: e.NODE_ENV === 'production',
    isTest: e.NODE_ENV === 'test',

    appUrl: e.APP_URL,
    appName: 'BBAS',
    orgShortName: 'BBAS',

    databaseUrl: e.DATABASE_URL,
    directUrl: e.DIRECT_URL || e.DATABASE_URL,

    authSecret: e.AUTH_SECRET,
    accessTokenTtlMinutes: e.ACCESS_TOKEN_TTL_MINUTES,
    sessionIdleTtlHours: e.SESSION_IDLE_TTL_HOURS,
    sessionAbsoluteTtlHours: e.SESSION_ABSOLUTE_TTL_HOURS,
    maxFailedLogins: e.MAX_FAILED_LOGINS,
    lockoutMinutes: e.LOCKOUT_MINUTES,

    storageProvider: e.STORAGE_PROVIDER,
    storageLocalDir: e.STORAGE_LOCAL_DIR,
    s3: {
      endpoint: e.S3_ENDPOINT,
      region: e.S3_REGION,
      bucket: e.S3_BUCKET,
      accessKeyId: e.S3_ACCESS_KEY_ID,
      secretAccessKey: e.S3_SECRET_ACCESS_KEY,
      forcePathStyle: e.S3_FORCE_PATH_STYLE,
    },
    signedUrlTtlSeconds: e.SIGNED_URL_TTL_SECONDS,
    maxUploadBytes: e.MAX_UPLOAD_MB * 1024 * 1024,

    scrutinyProvider: e.SCRUTINY_PROVIDER,
    scrutinyHttpUrl: e.SCRUTINY_HTTP_URL,
    scrutinyHttpApiKey: e.SCRUTINY_HTTP_API_KEY,
    scrutinyCallbackSecret: e.SCRUTINY_CALLBACK_SECRET,
    allowMockScrutinyInProduction: e.ALLOW_MOCK_SCRUTINY_IN_PRODUCTION,

    paymentProvider: e.PAYMENT_PROVIDER,
    paymentKeyId: e.PAYMENT_KEY_ID,
    paymentKeySecret: e.PAYMENT_KEY_SECRET,
    paymentWebhookSecret: e.PAYMENT_WEBHOOK_SECRET,
    paymentAccessCode: e.PAYMENT_ACCESS_CODE,
    paymentApiBase: e.PAYMENT_API_BASE,
    allowMockPaymentsInProduction: e.ALLOW_MOCK_PAYMENTS_IN_PRODUCTION,

    smsProvider: e.SMS_PROVIDER,
    smsApiKey: e.SMS_API_KEY,
    smsSenderId: e.SMS_SENDER_ID,

    emailProvider: e.EMAIL_PROVIDER,
    emailFrom: e.EMAIL_FROM,
    smtp: {
      host: e.SMTP_HOST,
      port: e.SMTP_PORT,
      user: e.SMTP_USER,
      password: e.SMTP_PASSWORD,
    },

    antivirusProvider: e.ANTIVIRUS_PROVIDER,
    clamav: { host: e.CLAMAV_HOST, port: e.CLAMAV_PORT },

    workerEnabled: e.WORKER_ENABLED,
    workerPollMs: e.WORKER_POLL_MS,
    workerConcurrency: e.WORKER_CONCURRENCY,
    workerId: e.WORKER_ID,

    cronSecret: e.CRON_SECRET,

    demoMode: e.DEMO_MODE,
    demoPassword: e.DEMO_PASSWORD,

    logLevel: e.LOG_LEVEL,
  } as const;
}

export const env = parse();
export type Env = typeof env;
