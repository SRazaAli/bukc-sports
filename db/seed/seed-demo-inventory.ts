/**
 * Demo inventory data — populates real equipment_type rows (from the presets
 * already defined in seed.ts) with a realistic spread of physical articles,
 * so a freshly migrated+seeded database has something to actually see and
 * test against on the Availability/Inventory/Borrow screens instead of being
 * empty. Opt-in and separate from the core seed.ts on purpose — seed.ts stays
 * the minimal "accounts + presets + settings" baseline every teammate runs;
 * this is bulk sample data for local development only.
 *
 * Idempotent: re-running tops up article counts to the target quantities
 * instead of duplicating anything (equipment types via
 * ON CONFLICT (sport_category_id, name) DO NOTHING, articles by checking the
 * current count per type first).
 *
 * Usage: tsx db/seed/seed-demo-inventory.ts
 * (requires seed.ts to have already been run at least once, for the sport
 * categories and the seeded Super Admin account)
 */
import { Client } from 'pg';

// [sportName, itemName, imageKey, lendingUnit, targetQuantity]
// targetQuantity = number of SINGLE articles, or number of PAIRS for PAIR types.
// Nets/wickets deliberately kept low (2) so they show LOW_STOCK / near-zero in
// the UI — a genuinely useful thing to have real data for when testing those
// states, not just an oversight.
const DEMO_ITEMS: Array<[string, string, string, 'SINGLE' | 'PAIR', number]> = [
  ['Badminton', 'Badminton Racket', 'badminton-racket', 'PAIR', 4],
  ['Badminton', 'Shuttlecock', 'shuttlecock', 'SINGLE', 10],
  ['Badminton', 'Badminton Net', 'badminton-net', 'SINGLE', 2],
  ['Table Tennis', 'Table Tennis Racket', 'tt-racket', 'PAIR', 3],
  ['Table Tennis', 'Table Tennis Ball', 'tt-ball', 'SINGLE', 12],
  ['Table Tennis', 'Table Tennis Net', 'tt-net', 'SINGLE', 2],
  ['Basketball', 'Basketball', 'basketball', 'SINGLE', 6],
  ['Volleyball', 'Volleyball', 'volleyball', 'SINGLE', 5],
  ['Volleyball', 'Volleyball Net', 'volleyball-net', 'SINGLE', 2],
  ['Football', 'Football', 'football', 'SINGLE', 6],
  ['Football', 'Goalpost Net', 'goalpost-net', 'SINGLE', 2],
  ['Cricket', 'Cricket Bat', 'cricket-bat', 'SINGLE', 5],
  ['Cricket', 'Cricket Ball', 'cricket-ball', 'SINGLE', 10],
  ['Cricket', 'Batting Pads', 'batting-pads', 'PAIR', 3],
  ['Cricket', 'Batting Gloves', 'batting-gloves', 'PAIR', 4],
  ['Cricket', 'Wicket Set', 'wicket-set', 'SINGLE', 3],
  ['Cricket', 'Helmet', 'cricket-helmet', 'SINGLE', 4],
  ['Tennis', 'Tennis Racket', 'tennis-racket', 'PAIR', 4],
  ['Tennis', 'Tennis Ball', 'tennis-ball', 'SINGLE', 15],
  ['Tennis', 'Tennis Net', 'tennis-net', 'SINGLE', 2],
];

const INDOOR_SPORTS = new Set(['Badminton', 'Table Tennis', 'Basketball', 'Volleyball']);

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');

  const client = new Client({ connectionString: url });
  await client.connect();

  try {
    const admin = await client.query(`SELECT user_id FROM app_user WHERE role = 'SUPER_ADMIN' ORDER BY created_at LIMIT 1`);
    if (admin.rowCount === 0) {
      throw new Error('No SUPER_ADMIN found — run `npm run seed` first.');
    }
    const adminId: string = admin.rows[0].user_id;

    let typesCreated = 0;
    let articlesCreated = 0;

    for (const [sportName, itemName, imageKey, lendingUnit, targetQty] of DEMO_ITEMS) {
      const sportRes = await client.query('SELECT sport_category_id FROM sport_category WHERE name = $1', [sportName]);
      if (sportRes.rowCount === 0) {
        console.log(`  skip "${itemName}" — sport category "${sportName}" not found (run npm run seed first)`);
        continue;
      }
      const sportCategoryId: number = sportRes.rows[0].sport_category_id;
      const isIndoor = INDOOR_SPORTS.has(sportName);
      const imageUrl = `/equipment/${imageKey}.png`;

      const insertType = await client.query(
        `INSERT INTO equipment_type
           (sport_category_id, name, lending_unit, low_stock_threshold, max_borrow_duration_minutes,
            condition_good_min_score, condition_worn_min_score, is_indoor, image_url)
         VALUES ($1, $2, $3, 2, 120, 70, 40, $4, $5)
         ON CONFLICT (sport_category_id, name) DO NOTHING
         RETURNING equipment_type_id`,
        [sportCategoryId, itemName, lendingUnit, isIndoor, imageUrl],
      );

      let typeId: number;
      if (insertType.rowCount && insertType.rowCount > 0) {
        typeId = insertType.rows[0].equipment_type_id;
        typesCreated += 1;
        console.log(`  created equipment type: ${itemName} (${sportName})`);
      } else {
        const existing = await client.query(
          'SELECT equipment_type_id FROM equipment_type WHERE sport_category_id = $1 AND name = $2',
          [sportCategoryId, itemName],
        );
        typeId = existing.rows[0].equipment_type_id;
      }

      if (lendingUnit === 'SINGLE') {
        const countRes = await client.query('SELECT count(*)::int AS n FROM article WHERE equipment_type_id = $1', [typeId]);
        const have: number = countRes.rows[0].n;
        for (let i = have; i < targetQty; i++) {
          const barcode = makeBarcode(typeId, i);
          const score = 82 + Math.floor(Math.random() * 16); // 82-97, comfortably GOOD
          const artRes = await client.query(
            `INSERT INTO article (equipment_type_id, barcode, state, current_condition_label, entered_by)
             VALUES ($1, $2, 'AVAILABLE', 'GOOD', $3) RETURNING article_id`,
            [typeId, barcode, adminId],
          );
          const articleId = artRes.rows[0].article_id;
          await client.query(
            `INSERT INTO health_check_scan (article_id, kind, source, health_score, resulting_label, scanned_by)
             VALUES ($1, 'ENTRY', 'MANUAL', $2, 'GOOD', $3)`,
            [articleId, score, adminId],
          );
          articlesCreated += 1;
        }
      } else {
        // PAIR: targetQty is a count of PAIRS, each pair = 2 articles + 1 article_pair row.
        const pairCountRes = await client.query(
          `SELECT count(*)::int AS n FROM article_pair ap
             JOIN article a ON a.article_id = ap.article_a_id
           WHERE a.equipment_type_id = $1 AND ap.dissolved_at IS NULL`,
          [typeId],
        );
        const havePairs: number = pairCountRes.rows[0].n;
        for (let i = havePairs; i < targetQty; i++) {
          const barcodeA = makeBarcode(typeId, i * 2);
          const barcodeB = makeBarcode(typeId, i * 2 + 1);
          const scoreA = 82 + Math.floor(Math.random() * 16);
          const scoreB = 82 + Math.floor(Math.random() * 16);

          const artA = await client.query(
            `INSERT INTO article (equipment_type_id, barcode, state, current_condition_label, entered_by)
             VALUES ($1, $2, 'AVAILABLE', 'GOOD', $3) RETURNING article_id`,
            [typeId, barcodeA, adminId],
          );
          const artB = await client.query(
            `INSERT INTO article (equipment_type_id, barcode, state, current_condition_label, entered_by)
             VALUES ($1, $2, 'AVAILABLE', 'GOOD', $3) RETURNING article_id`,
            [typeId, barcodeB, adminId],
          );
          const idA: string = artA.rows[0].article_id;
          const idB: string = artB.rows[0].article_id;

          await client.query(
            `INSERT INTO health_check_scan (article_id, kind, source, health_score, resulting_label, scanned_by)
             VALUES ($1, 'ENTRY', 'MANUAL', $2, 'GOOD', $3)`,
            [idA, scoreA, adminId],
          );
          await client.query(
            `INSERT INTO health_check_scan (article_id, kind, source, health_score, resulting_label, scanned_by)
             VALUES ($1, 'ENTRY', 'MANUAL', $2, 'GOOD', $3)`,
            [idB, scoreB, adminId],
          );

          // ck_pair_canonical requires article_a_id < article_b_id (UUID compare)
          const [lo, hi] = idA < idB ? [idA, idB] : [idB, idA];
          await client.query(
            `INSERT INTO article_pair (article_a_id, article_b_id, formed_by) VALUES ($1, $2, $3)`,
            [lo, hi, adminId],
          );
          articlesCreated += 2;
        }
      }
    }

    console.log(`\nDemo inventory ready — ${typesCreated} equipment type(s) created, ${articlesCreated} article(s) added.`);
    console.log('Re-run any time to top up existing types back to their target quantities.');
  } finally {
    await client.end();
  }
}

// 12-digit barcode, deterministic per (type, index) so reruns are stable and
// collision-free without needing a DB round-trip to check uniqueness first:
// '9' + 4-digit type id + 7-digit index.
function makeBarcode(typeId: number, index: number): string {
  return `9${String(typeId).padStart(4, '0')}${String(index).padStart(7, '0')}`;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
