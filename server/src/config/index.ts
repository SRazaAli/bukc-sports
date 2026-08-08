/**
 * Typed configuration, validated at startup. If a required env var is missing or
 * malformed the process refuses to start — better than discovering it mid-request.
 */
import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().url(),
  PORT: z.coerce.number().int().positive().default(4000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  CLIENT_ORIGIN: z.string().default('http://localhost:5173'),

  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  ACCESS_TOKEN_TTL_MIN: z.coerce.number().int().min(15).max(60).default(30), // AUTH-09
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(14),
  BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12), // AUTH-08

  EMAIL_PROVIDER: z.enum(['resend', 'smtp', 'console']).default('console'),
  RESEND_API_KEY: z.string().optional(),
  // SMTP works with any real mail account (Gmail, Outlook, a university
  // mailbox...) — free, no domain purchase required, delivers to any real
  // recipient. Gmail: host=smtp.gmail.com, port=587, user=the Gmail address,
  // pass=a 16-character App Password (not the account's normal password —
  // Google requires 2-Step Verification to be enabled before one can be
  // generated).
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  EMAIL_FROM: z.string().default('BUKC Sports <noreply@bukc-sports.dev>'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;

if (config.EMAIL_PROVIDER === 'smtp' && (!config.SMTP_HOST || !config.SMTP_USER || !config.SMTP_PASS)) {
  console.error('EMAIL_PROVIDER=smtp requires SMTP_HOST, SMTP_USER, and SMTP_PASS to be set.');
  process.exit(1);
}
export const isProd = config.NODE_ENV === 'production';
export const isTest = config.NODE_ENV === 'test';

// The origins allowed to call the API and receive cookies. Comma-separated.
export const allowedOrigins = config.CLIENT_ORIGIN.split(',').map((s) => s.trim());
