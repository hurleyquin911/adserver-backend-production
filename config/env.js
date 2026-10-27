require('dotenv').config({ quiet: true });
const { z } = require('zod');
const { envBool } = require('../utils/envBool');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(5003),
  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().int().positive().default(3306),
  DB_NAME: z.string().min(1),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string().default(''),
  JWT_SECRET: z.string().min(16),
  REFRESH_SECRET: z.string().min(16),
  TRACKING_SECRET: z.string().min(16),
  FRONTEND_ORIGIN: z.string().url(),
  /** Comma-separated extra browser origins for admin CORS (local + staging). */
  CORS_ORIGINS: z.string().default(''),
  PUBLIC_BASE_URL: z.string().url().default('http://localhost:5003'),
  STORAGE_DRIVER: z.enum(['local', 'cdn']).default('local'),
  SEED_ADMIN_EMAIL: z.string().email(),
  SEED_ADMIN_PASSWORD: z.string().min(8),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL: z.string().default('7d'),
  UPLOAD_MAX_BYTES: z.coerce.number().int().positive().default(10485760),
  ZIP_MAX_FILES: z.coerce.number().int().positive().default(200),
  ZIP_MAX_UNCOMPRESSED_BYTES: z.coerce.number().int().positive().default(52428800),
  REPORT_TZ: z
    .string()
    .min(1)
    .default('Asia/Jakarta')
    .refine(
      (tz) => {
        try {
          Intl.DateTimeFormat('en-US', { timeZone: tz });
          return true;
        } catch {
          return false;
        }
      },
      { message: 'REPORT_TZ harus IANA timezone valid' }
    ),
  DEV_ALLOWED_ORIGINS: z.string().default('localhost:5500,127.0.0.1:5500,localhost:3000,localhost:3002,localhost:3003'),
  REQUIRE_ALLOWED_DOMAINS: z.preprocess((v) => envBool(v, false), z.boolean()),
  TRUST_PROXY: z.preprocess((v) => envBool(v, false), z.boolean()),
  /** Publisher baru dari Origin/Referer: pending sampai disetujui di dashboard. */
  PUBLISHER_DEFAULT_STATUS: z.enum(['active', 'pending', 'blocked']).default('active'),
  ALLOW_UNKNOWN_PUBLISHER: z.preprocess((v) => envBool(v, true), z.boolean()),
  PACING_ENABLED: z.preprocess((v) => envBool(v, true), z.boolean()),
  DELIVERY_RECOUNT_SECONDS: z.coerce.number().int().positive().default(60),
  ELIGIBLE_CACHE_SECONDS: z.coerce.number().int().min(0).default(20),
  CLICK_APPEND_UTM: z.preprocess((v) => envBool(v, true), z.boolean()),
  TAG_JS_CACHE_SECONDS: z.preprocess((v) => {
    if (v === undefined || v === null || String(v).trim() === '') return undefined;
    return v;
  }, z.coerce.number().int().min(0).optional()),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
  throw new Error(`Invalid environment variables: ${details}`);
}

const data = parsed.data;
if (data.TAG_JS_CACHE_SECONDS === undefined) {
  data.TAG_JS_CACHE_SECONDS = data.NODE_ENV === 'production' ? 300 : 0;
}

const defaultLocalOrigins = [
  'http://localhost:3000',
  'http://localhost:3002',
  'http://localhost:3003',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3002',
  'http://127.0.0.1:3003',
];

data.ADMIN_CORS_ORIGINS = Array.from(
  new Set(
    [data.FRONTEND_ORIGIN, ...String(data.CORS_ORIGINS || '').split(','), ...defaultLocalOrigins]
      .map((o) => String(o || '').trim())
      .filter(Boolean)
  )
);

module.exports = data;
