/**
 * Minimal migration runner. Applies db/migrations/*.sql in filename order,
 * inside a transaction each, and records applied files in _migrations.
 *
 * Deliberately NOT an ORM migration engine: those diff against the live schema
 * and try to "fix" drift, which would fight our 41 triggers and exclusion
 * constraint. This runner only ever moves forward.
 *
 * Usage: tsx db/run-migrations.ts   (reads DATABASE_URL from env)
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, 'migrations');

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');

  const client = new Client({ connectionString: url });
  await client.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        filename   text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      );
    `);

    const applied = new Set<string>(
      (await client.query('SELECT filename FROM _migrations')).rows.map((r) => r.filename),
    );

    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    let ran = 0;
    for (const file of files) {
      if (applied.has(file)) {
        console.log(`  skip  ${file} (already applied)`);
        continue;
      }
      const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
      console.log(`  apply ${file} ...`);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO _migrations (filename) VALUES ($1)', [file]);
        await client.query('COMMIT');
        ran++;
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`  FAILED ${file}:`, (err as Error).message);
        throw err;
      }
    }
    console.log(ran === 0 ? 'Database already up to date.' : `Applied ${ran} migration(s).`);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
