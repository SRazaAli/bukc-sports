/**
 * Idempotent seed. Creates:
 *  - the single seeded SUPER_ADMIN (AUTH-06: seeded at setup, never self-registered)
 *  - sport categories
 *  - system_setting rows the rules reference (APPR-19, INV-29, BORROW-13, EQUIP-AVAIL-11)
 *
 * Safe to run repeatedly: every insert is guarded by ON CONFLICT / existence checks.
 * Usage: tsx db/seed/seed.ts
 */
import bcrypt from 'bcryptjs';
import { Client } from 'pg';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');

  const email = process.env.SEED_SUPERADMIN_EMAIL ?? 'admin@bukc.edu.pk';
  const password = process.env.SEED_SUPERADMIN_PASSWORD ?? 'ChangeThisOnFirstLogin!';
  const name = process.env.SEED_SUPERADMIN_NAME ?? 'System Administrator';
  const rounds = Number(process.env.BCRYPT_ROUNDS ?? 12);

  const client = new Client({ connectionString: url });
  await client.connect();

  try {
    await client.query('BEGIN');

    // ── Super Admin (AUTH-06) ──
    // AUTH-05: exactly one role. AUTH-04: ACTIVE requires verified_at; a seeded admin
    // is verified by definition of being seeded (no human verifier exists yet), so we
    // set verified_at = now() and leave verified_by NULL (the ck_no_self_verify check
    // permits NULL; the AUTH-04 role-trigger only fires when verified_by is set).
    const existing = await client.query('SELECT 1 FROM app_user WHERE email = $1', [email]);
    if (existing.rowCount === 0) {
      const hash = await bcrypt.hash(password, rounds);
      await client.query(
        `INSERT INTO app_user (role, status, full_name, email, contact_number, password_hash, verified_at)
         VALUES ('SUPER_ADMIN', 'ACTIVE', $1, $2, $3, $4, now())`,
        [name, email, '0000000000', hash],
      );
      console.log(`  created SUPER_ADMIN: ${email}`);
    } else {
      console.log(`  SUPER_ADMIN ${email} already exists — skipping`);
    }

    // ── Sport categories (EQUIP-AVAIL-08 filter; VENUE-01 indoor/outdoor thresholds) ──
    const sports: Array<[string, boolean]> = [
      ['Badminton', true],
      ['Table Tennis', true],
      ['Basketball', true],
      ['Volleyball', true],
      ['Football', false],
      ['Cricket', false],
      ['Tennis', false],
    ];
    for (const [n, indoor] of sports) {
      await client.query(
        `INSERT INTO sport_category (name, is_indoor) VALUES ($1, $2)
         ON CONFLICT (name) DO NOTHING`,
        [n, indoor],
      );
    }
    console.log(`  ensured ${sports.length} sport categories`);

    // ── Equipment item presets (predefined item names per sport) ──
    // [name, image_key, defaultLendingUnit] — PAIR only for items actually
    // lent as a matched pair (rackets, batting pads, batting gloves).
    const presets: Record<string, Array<[string, string, 'SINGLE' | 'PAIR']>> = {
      Badminton: [
        ['Badminton Racket', 'badminton-racket', 'PAIR'],
        ['Shuttlecock', 'shuttlecock', 'SINGLE'],
        ['Badminton Net', 'badminton-net', 'SINGLE'],
      ],
      'Table Tennis': [
        ['Table Tennis Racket', 'tt-racket', 'PAIR'],
        ['Table Tennis Ball', 'tt-ball', 'SINGLE'],
        ['Table Tennis Net', 'tt-net', 'SINGLE'],
      ],
      Basketball: [['Basketball', 'basketball', 'SINGLE']],
      Volleyball: [
        ['Volleyball', 'volleyball', 'SINGLE'],
        ['Volleyball Net', 'volleyball-net', 'SINGLE'],
      ],
      Football: [
        ['Football', 'football', 'SINGLE'],
        ['Goalpost Net', 'goalpost-net', 'SINGLE'],
      ],
      Cricket: [
        ['Cricket Bat', 'cricket-bat', 'SINGLE'],
        ['Cricket Ball', 'cricket-ball', 'SINGLE'],
        ['Batting Pads', 'batting-pads', 'PAIR'],
        ['Batting Gloves', 'batting-gloves', 'PAIR'],
        ['Wicket Set', 'wicket-set', 'SINGLE'],
        ['Helmet', 'cricket-helmet', 'SINGLE'],
      ],
      Tennis: [
        ['Tennis Racket', 'tennis-racket', 'PAIR'],
        ['Tennis Ball', 'tennis-ball', 'SINGLE'],
        ['Tennis Net', 'tennis-net', 'SINGLE'],
      ],
    };
    let presetCount = 0;
    for (const [sportName, items] of Object.entries(presets)) {
      const sc = await client.query('SELECT sport_category_id FROM sport_category WHERE name = $1', [sportName]);
      if (sc.rowCount === 0) continue;
      const scId = sc.rows[0].sport_category_id;
      for (const [itemName, imageKey, lendingUnit] of items) {
        await client.query(
          `INSERT INTO equipment_item_preset (sport_category_id, name, image_key, default_lending_unit)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (sport_category_id, name)
           DO UPDATE SET image_key = EXCLUDED.image_key, default_lending_unit = EXCLUDED.default_lending_unit`,
          [scId, itemName, imageKey, lendingUnit],
        );
        presetCount++;
      }
    }
    console.log(`  ensured ${presetCount} equipment item presets`);

    // ── System settings (configurable windows the rules cite) ──
    const settings: Array<[string, unknown]> = [
      ['pending_queue_reminder_hours', 24],   // APPR-19
      ['health_check_overdue_hours', 48],     // INV-29
      ['borrow_rejection_cooldown_minutes', 30], // BORROW-13
      ['event_lock_lead_hours', 24],          // EQUIP-AVAIL-11
    ];
    // updated_by must reference a real user; use the seeded super admin.
    const sa = await client.query(
      `SELECT user_id FROM app_user WHERE role = 'SUPER_ADMIN' ORDER BY created_at LIMIT 1`,
    );
    const saId = sa.rows[0]?.user_id ?? null;
    for (const [key, val] of settings) {
      await client.query(
        `INSERT INTO system_setting (setting_key, setting_value, updated_by)
         VALUES ($1, $2::jsonb, $3)
         ON CONFLICT (setting_key) DO NOTHING`,
        [key, JSON.stringify(val), saId],
      );
    }
    console.log(`  ensured ${settings.length} system settings`);

    await client.query('COMMIT');
    console.log('Seed complete.');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
