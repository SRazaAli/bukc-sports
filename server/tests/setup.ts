/**
 * Test setup. Migrates once, then between tests TRUNCATEs all data and re-seeds.
 * Far faster than dropping/re-creating the schema every test, and just as clean.
 */
import { beforeAll, beforeEach, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { Client } from 'pg';

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
if (!TEST_DB_URL) {
  throw new Error('TEST_DATABASE_URL must be set (a throwaway database)');
}
process.env.DATABASE_URL = TEST_DB_URL;
process.env.NODE_ENV = 'test';
process.env.EMAIL_PROVIDER = 'console';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-16chars';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-16chars';
process.env.BCRYPT_ROUNDS ??= '10';

const SA_EMAIL = 'admin@bukc.edu.pk';
const SA_PASSWORD = 'AdminPass123!';

let client: Client;

beforeAll(async () => {
  const c = new Client({ connectionString: TEST_DB_URL });
  await c.connect();
  await c.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await c.end();
  const env = { ...process.env, DATABASE_URL: TEST_DB_URL };
  // server/ is the cwd when vitest runs; db/ is a sibling.
  // Use path.resolve instead of URL().pathname — the latter produces a
  // leading slash on Windows (/D:/...) which execSync then doubles to D:/D:/...
  const dbDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../db');
  const migrationsScript = resolve(dbDir, 'run-migrations.ts');
  execSync(`npx tsx "${migrationsScript}"`, { env, stdio: 'pipe' });

  client = new Client({ connectionString: TEST_DB_URL });
  await client.connect();
});

beforeEach(async () => {
  const { rows } = await client.query(`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_migrations'
  `);
  const tables = rows.map((r) => '"' + r.tablename + '"').join(', ');
  if (tables) {
    await client.query('TRUNCATE ' + tables + ' RESTART IDENTITY CASCADE');
  }
  const hash = await bcrypt.hash(SA_PASSWORD, 10);
  const sa = await client.query(
    "INSERT INTO app_user (role, status, full_name, email, contact_number, password_hash, verified_at) " +
    "VALUES ('SUPER_ADMIN','ACTIVE','System Administrator',$1,'0000000000',$2, now()) RETURNING user_id",
    [SA_EMAIL, hash],
  );
  const saId = sa.rows[0].user_id;
  for (const [n, indoor] of [['Badminton', true], ['Football', false], ['Cricket', false]]) {
    await client.query('INSERT INTO sport_category (name, is_indoor) VALUES ($1,$2)', [n, indoor]);
  }
  for (const [k, val] of [['borrow_rejection_cooldown_minutes', 30], ['event_lock_lead_hours', 24]]) {
    await client.query(
      'INSERT INTO system_setting (setting_key, setting_value, updated_by) VALUES ($1,$2::jsonb,$3)',
      [k, JSON.stringify(val), saId],
    );
  }
});

afterAll(async () => {
  await client?.end();
  const { pool } = await import('../src/db/index.js');
  await pool.end();
});

export const seedCreds = { email: SA_EMAIL, password: SA_PASSWORD };

// UPC-A barcodes are exactly 12 numeric digits (ck_article_barcode_format).
// Deterministic per-call-site codes keep tests readable while staying valid.
export function bc(n: number): string {
  return String(n).padStart(12, '0');
}
