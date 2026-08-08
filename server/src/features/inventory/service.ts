/**
 * Inventory service (Feature 4 — Basic Inventory Tracking).
 *
 * The database owns the hard invariants (barcode immutable INV-05, decommission
 * terminal INV-24, same-type pairs INV-07, one live pair INV-08, staff-only,
 * scan auto-applies condition + auto-DAMAGED). This service orchestrates the
 * multi-step operations the rules describe and reads the availability views.
 *
 * Score → label mapping (INV-04/17) uses the per-type thresholds:
 *   score >= condition_good_min_score  → GOOD
 *   score >= condition_worn_min_score  → WORN
 *   else                               → DAMAGED
 */
import { sql, type Transaction } from 'kysely';
import { db, isPgError, type ConditionLabel, type ArticleState, type DB } from '../../db/index.js';
import { AppError, badRequest, notFound, conflict } from '../../middleware/errors.js';

function mapDbError(e: unknown): AppError {
  if (isPgError(e)) {
    if (e.code === '23505') {
      const c = (e as { constraint?: string }).constraint ?? '';
      if (c.includes('barcode')) return conflict('That barcode already exists.', 'DUPLICATE_BARCODE');
      return conflict('That already exists.', 'DUPLICATE');
    }
    if (e.code === 'P0001') return new AppError(422, e.message.replace(/^ERROR:\s*/i, ''), 'RULE');
    if (e.code === '23503') return badRequest('Referenced item does not exist.', 'FK');
    if (e.code === '23514') return new AppError(422, 'Value does not meet a data rule (e.g. barcode length).', 'CHECK');
  }
  if (e instanceof AppError) return e;
  return new AppError(500, "Inventory operation failed");
}

// ── Reference data ──
export async function listSportCategories() {
  return db.selectFrom('sport_category')
    .select(['sport_category_id', 'name', 'is_indoor', 'is_custom', 'image_data'])
    .orderBy('name').execute();
}

export async function createSportCategory(input: {
  name: string; isIndoor: boolean; imageData?: string;
}) {
  try {
    const row = await db.insertInto('sport_category').values({
      name: input.name,
      is_indoor: input.isIndoor,
      is_custom: true,
      image_data: input.imageData ?? null,
    }).returning(['sport_category_id', 'name']).executeTakeFirstOrThrow();
    return row;
  } catch (e) { throw mapDbError(e); }
}

export async function listItemPresets(sportCategoryId?: number) {
  let q = db.selectFrom('equipment_item_preset')
    .select(['preset_id', 'sport_category_id', 'name', 'image_key', 'default_lending_unit']);
  if (sportCategoryId) q = q.where('sport_category_id', '=', sportCategoryId);
  return q.orderBy('name').execute();
}

// ── Equipment types ──
export async function listEquipmentTypes() {
  return db.selectFrom('equipment_type as et')
    .innerJoin('sport_category as sc', 'sc.sport_category_id', 'et.sport_category_id')
    .select([
      'et.equipment_type_id', 'et.name', 'et.lending_unit', 'et.low_stock_threshold',
      'et.max_borrow_duration_minutes', 'et.condition_good_min_score', 'et.condition_worn_min_score',
      'et.sport_category_id', 'sc.name as sport_category_name', 'et.is_indoor', 'et.image_url',
    ])
    .where('et.is_active', '=', true)
    .orderBy('sc.name').orderBy('et.name').execute();
}

export async function createEquipmentType(input: {
  sportCategoryId: number; name: string; lendingUnit: 'SINGLE' | 'PAIR';
  lowStockThreshold?: number; maxBorrowDurationMinutes: number;
  conditionGoodMinScore: number; conditionWornMinScore: number;
  isIndoor: boolean; imageUrl?: string;
}) {
  try {
    // If a soft-deleted type with the same sport+name already exists, reactivate
    // it with the new settings instead of hitting the UNIQUE constraint.
    const existing = await db.selectFrom('equipment_type')
      .select('equipment_type_id')
      .where('sport_category_id', '=', input.sportCategoryId)
      .where('name', '=', input.name)
      .where('is_active', '=', false)
      .executeTakeFirst();

    if (existing) {
      await db.updateTable('equipment_type').set({
        is_active: true,
        lending_unit: input.lendingUnit,
        low_stock_threshold: input.lowStockThreshold ?? 7,
        max_borrow_duration_minutes: input.maxBorrowDurationMinutes,
        condition_good_min_score: input.conditionGoodMinScore,
        condition_worn_min_score: input.conditionWornMinScore,
        is_indoor: input.isIndoor,
        image_url: input.imageUrl || null,
      }).where('equipment_type_id', '=', existing.equipment_type_id).execute();
      return { equipment_type_id: existing.equipment_type_id, name: input.name };
    }

    const row = await db.insertInto('equipment_type').values({
      sport_category_id: input.sportCategoryId,
      name: input.name,
      lending_unit: input.lendingUnit,
      low_stock_threshold: input.lowStockThreshold ?? 7,
      max_borrow_duration_minutes: input.maxBorrowDurationMinutes,
      condition_good_min_score: input.conditionGoodMinScore,
      condition_worn_min_score: input.conditionWornMinScore,
      is_indoor: input.isIndoor,
      image_url: input.imageUrl || null,
    }).returning(['equipment_type_id', 'name']).executeTakeFirstOrThrow();
    return row;
  } catch (e) { throw mapDbError(e); }
}

// INV-06: thresholds/duration set per type at entry or any time after.
export async function updateThresholds(typeId: number, input: {
  lowStockThreshold?: number; maxBorrowDurationMinutes?: number;
}) {
  const patch: Record<string, number> = {};
  if (input.lowStockThreshold !== undefined) patch.low_stock_threshold = input.lowStockThreshold;
  if (input.maxBorrowDurationMinutes !== undefined) patch.max_borrow_duration_minutes = input.maxBorrowDurationMinutes;
  if (Object.keys(patch).length === 0) throw badRequest('Nothing to update.');
  const res = await db.updateTable('equipment_type').set(patch)
    .where('equipment_type_id', '=', typeId).executeTakeFirst();
  if (!res.numUpdatedRows) throw notFound('Equipment type not found.');
}

// Full edit of an equipment type's descriptive/tunable fields. sportCategoryId
// and lendingUnit are intentionally not editable here — changing the sport a
// type belongs to, or flipping SINGLE/PAIR after articles exist, would orphan
// the pairing and lending-unit invariants those articles were entered under.
export async function updateEquipmentType(typeId: number, input: {
  name?: string; isIndoor?: boolean; lowStockThreshold?: number;
  maxBorrowDurationMinutes?: number; conditionGoodMinScore?: number;
  conditionWornMinScore?: number; imageUrl?: string;
}) {
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.isIndoor !== undefined) patch.is_indoor = input.isIndoor;
  if (input.lowStockThreshold !== undefined) patch.low_stock_threshold = input.lowStockThreshold;
  if (input.maxBorrowDurationMinutes !== undefined) patch.max_borrow_duration_minutes = input.maxBorrowDurationMinutes;
  if (input.conditionGoodMinScore !== undefined) patch.condition_good_min_score = input.conditionGoodMinScore;
  if (input.conditionWornMinScore !== undefined) patch.condition_worn_min_score = input.conditionWornMinScore;
  if (input.imageUrl !== undefined) patch.image_url = input.imageUrl || null;
  if (Object.keys(patch).length === 0) throw badRequest('Nothing to update.');
  try {
    const res = await db.updateTable('equipment_type').set(patch)
      .where('equipment_type_id', '=', typeId).executeTakeFirst();
    if (!res.numUpdatedRows) throw notFound('Equipment type not found.');
  } catch (e) { throw mapDbError(e); }
}

// Delete logic:
//   1. If the type has ANY active articles (AVAILABLE, ON_LOAN, DAMAGED) →
//      BLOCK. You must decommission all articles first.
//   2. If zero active articles but historical references still prevent a hard
//      DELETE (decommissioned article rows, past borrow_transaction rows, etc.)
//      → soft-delete (is_active = false). The type disappears from every list
//      while the historical FK integrity stays intact.
//   3. If nothing references the type at all → hard DELETE, gone from the DB.
export async function deleteEquipmentType(typeId: number) {
  // Guard: block if any article under this type is still active.
  const activeCount = await db.selectFrom('article')
    .select(db.fn.countAll().as('n'))
    .where('equipment_type_id', '=', typeId)
    .where('state', 'in', ['AVAILABLE', 'ON_LOAN', 'DAMAGED'])
    .executeTakeFirst();
  if (activeCount && Number(activeCount.n) > 0) {
    throw conflict(
      `Cannot delete — this equipment type still has ${Number(activeCount.n)} active article(s). Decommission all articles first, then delete the type.`,
      'HAS_ACTIVE_ARTICLES',
    );
  }

  // No active articles — try hard-delete first (works if zero references at all).
  try {
    const res = await db.deleteFrom('equipment_type')
      .where('equipment_type_id', '=', typeId).executeTakeFirst();
    if (!res.numDeletedRows) throw notFound('Equipment type not found.');
  } catch (e) {
    if (isPgError(e) && e.code === '23503') {
      // Historical references (decommissioned articles, past borrows, etc.)
      // prevent hard-delete — soft-delete instead, silently.
      const res = await db.updateTable('equipment_type').set({ is_active: false })
        .where('equipment_type_id', '=', typeId).executeTakeFirst();
      if (!res.numUpdatedRows) throw notFound('Equipment type not found.');
      return;
    }
    throw mapDbError(e);
  }
}

// Score → condition label using the type's thresholds (INV-04/17).
async function scoreToLabel(equipmentTypeId: number, score: number): Promise<ConditionLabel> {
  const t = await db.selectFrom('equipment_type')
    .select(['condition_good_min_score', 'condition_worn_min_score'])
    .where('equipment_type_id', '=', equipmentTypeId).executeTakeFirst();
  if (!t) throw notFound('Equipment type not found.');
  const good = Number(t.condition_good_min_score);
  const worn = Number(t.condition_worn_min_score);
  if (score >= good) return 'GOOD';
  if (score >= worn) return 'WORN';
  return 'DAMAGED';
}

// INV-18/21: raise a system damage flag for an article if one isn't already open —
// shared by entry (a damaged article at intake) and scans (a damaged result later).
async function raiseFlagIfDamaged(
  trx: Transaction<DB>, articleId: string, label: ConditionLabel, sourceScanId: string | null,
) {
  if (label !== 'DAMAGED') return;
  const already = await trx.selectFrom('damage_flag').select('flag_id')
    .where('article_id', '=', articleId).where('cleared_at', 'is', null).executeTakeFirst();
  if (already) return;
  await trx.insertInto('damage_flag').values({
    article_id: articleId, raised_by_system: true, source_scan_id: sourceScanId,
  }).execute();
}

// ── Articles ──
// INV-02/03/04: add a SINGLE article; entry scan sets baseline condition.
// A DAMAGED entry label sets state DAMAGED immediately and raises a flag —
// damaged-at-intake items need review just like damaged-in-service ones.
export async function addArticle(input: {
  equipmentTypeId: number; barcode: string; entryScore: number; imageData?: string;
}, staffId: string) {
  try {
    const type = await db.selectFrom('equipment_type').select(['lending_unit'])
      .where('equipment_type_id', '=', input.equipmentTypeId).executeTakeFirst();
    if (!type) throw notFound('Equipment type not found.');
    if (type.lending_unit === 'PAIR') {
      throw badRequest('This equipment type lends in pairs — use "Add Pair" to enter both articles together.');
    }

    const label = await scoreToLabel(input.equipmentTypeId, input.entryScore);
    const initialState: ArticleState = label === 'DAMAGED' ? 'DAMAGED' : 'AVAILABLE';

    const articleId = await db.transaction().execute(async (trx) => {
      const art = await trx.insertInto('article').values({
        equipment_type_id: input.equipmentTypeId,
        barcode: input.barcode,
        state: initialState,
        current_condition_label: label,
        entered_by: staffId,
      }).returning('article_id').executeTakeFirstOrThrow();

      const scan = await trx.insertInto('health_check_scan').values({
        article_id: art.article_id, kind: 'ENTRY', source: 'MANUAL',
        health_score: input.entryScore, resulting_label: label, scanned_by: staffId,
        image_data: input.imageData ?? null,
      }).returning('scan_id').executeTakeFirstOrThrow();

      await raiseFlagIfDamaged(trx, art.article_id, label, scan.scan_id);
      return art.article_id;
    });

    return { articleId, barcode: input.barcode, conditionLabel: label, state: initialState };
  } catch (e) { throw mapDbError(e); }
}

// Pair-type articles are always entered as a pair in one action, unconditionally
// — there is no state in which a pair-type article stands alone. Each half keeps
// its own condition_label from its own score, but the pair shares one `state`:
// DAMAGED if either half's condition is DAMAGED, else AVAILABLE.
export async function addArticlePair(input: {
  equipmentTypeId: number; barcodeA: string; barcodeB: string;
  entryScoreA: number; entryScoreB: number; imageDataA?: string; imageDataB?: string;
}, staffId: string) {
  try {
    const type = await db.selectFrom('equipment_type').select(['lending_unit'])
      .where('equipment_type_id', '=', input.equipmentTypeId).executeTakeFirst();
    if (!type) throw notFound('Equipment type not found.');
    if (type.lending_unit !== 'PAIR') {
      throw badRequest('This equipment type is not a pair-lending type.');
    }

    const labelA = await scoreToLabel(input.equipmentTypeId, input.entryScoreA);
    const labelB = await scoreToLabel(input.equipmentTypeId, input.entryScoreB);
    const sharedState: ArticleState = (labelA === 'DAMAGED' || labelB === 'DAMAGED') ? 'DAMAGED' : 'AVAILABLE';

    const result = await db.transaction().execute(async (trx) => {
      const insertOne = async (barcode: string, label: ConditionLabel, score: number, imageData?: string) => {
        const art = await trx.insertInto('article').values({
          equipment_type_id: input.equipmentTypeId, barcode, state: sharedState,
          current_condition_label: label, entered_by: staffId,
        }).returning('article_id').executeTakeFirstOrThrow();
        const scan = await trx.insertInto('health_check_scan').values({
          article_id: art.article_id, kind: 'ENTRY', source: 'MANUAL',
          health_score: score, resulting_label: label, scanned_by: staffId,
          image_data: imageData ?? null,
        }).returning('scan_id').executeTakeFirstOrThrow();
        await raiseFlagIfDamaged(trx, art.article_id, label, scan.scan_id);
        return art.article_id;
      };

      const idA = await insertOne(input.barcodeA, labelA, input.entryScoreA, input.imageDataA);
      const idB = await insertOne(input.barcodeB, labelB, input.entryScoreB, input.imageDataB);

      // Always paired, regardless of individual scores.
      const [aId, bId] = idA < idB ? [idA, idB] : [idB, idA];
      await trx.insertInto('article_pair')
        .values({ article_a_id: aId, article_b_id: bId, formed_by: staffId }).execute();

      return { idA, idB };
    });

    return {
      articleIdA: result.idA, articleIdB: result.idB,
      barcodeA: input.barcodeA, barcodeB: input.barcodeB,
      conditionLabelA: labelA, conditionLabelB: labelB,
      state: sharedState,
    };
  } catch (e) { throw mapDbError(e); }
}

export async function listArticles(filter: {
  equipmentTypeId?: number; state?: ArticleState; condition?: ConditionLabel;
}) {
  let q = db.selectFrom('article as a')
    .innerJoin('equipment_type as et', 'et.equipment_type_id', 'a.equipment_type_id')
    .leftJoin('article_pair as ap', (join) =>
      join.on((eb) => eb.and([
        eb('ap.dissolved_at', 'is', null),
        eb.or([eb('ap.article_a_id', '=', eb.ref('a.article_id')), eb('ap.article_b_id', '=', eb.ref('a.article_id'))]),
      ])))
    .select([
      'a.article_id', 'a.barcode', 'a.state', 'a.current_condition_label',
      'a.equipment_type_id', 'et.name as equipment_type_name', 'et.lending_unit', 'a.entered_at',
      'ap.pair_id', 'ap.article_a_id', 'ap.article_b_id',
    ])
    .where('a.state', '!=', 'DECOMMISSIONED');
  if (filter.equipmentTypeId) q = q.where('a.equipment_type_id', '=', filter.equipmentTypeId);
  if (filter.state) q = q.where('a.state', '=', filter.state);
  if (filter.condition) q = q.where('a.current_condition_label', '=', filter.condition);
  return q.orderBy('et.name').orderBy('a.barcode').execute();
}

// INV-25/27: full lifecycle history of one article.
export async function getArticleDetail(articleId: string) {
  const article = await db.selectFrom('article as a')
    .innerJoin('equipment_type as et', 'et.equipment_type_id', 'a.equipment_type_id')
    .select([
      'a.article_id', 'a.barcode', 'a.state', 'a.current_condition_label',
      'a.equipment_type_id', 'et.name as equipment_type_name', 'et.lending_unit',
      'a.entered_at', 'a.decommissioned_at',
    ])
    .where('a.article_id', '=', articleId).executeTakeFirst();
  if (!article) throw notFound('Article not found.');

  const scans = await db.selectFrom('health_check_scan')
    .select(['scan_id', 'kind', 'source', 'health_score', 'resulting_label', 'scanned_at'])
    .where('article_id', '=', articleId).orderBy('scanned_at', 'desc').execute();

  const flags = await db.selectFrom('damage_flag')
    .select(['flag_id', 'raised_by_system', 'raised_at', 'cleared_at', 'cleared_with_label'])
    .where('article_id', '=', articleId).orderBy('raised_at', 'desc').execute();

  const pairs = await db.selectFrom('article_pair')
    .select(['pair_id', 'article_a_id', 'article_b_id', 'formed_at', 'dissolved_at', 'dissolution_reason'])
    .where((eb) => eb.or([eb('article_a_id', '=', articleId), eb('article_b_id', '=', articleId)]))
    .orderBy('formed_at', 'desc').execute();

  return { article, scans, flags, pairs };
}

// INV-23: decommission (terminal). DB enforces INV-24 (cannot un-decommission).
// A pair-type article has no standalone existence — decommissioning one half
// decommissions both, atomically.
export async function decommissionArticle(articleId: string, staffId: string) {
  try {
    await db.transaction().execute(async (trx) => {
      const pair = await trx.selectFrom('article_pair')
        .select(['article_a_id', 'article_b_id'])
        .where('dissolved_at', 'is', null)
        .where((eb) => eb.or([eb('article_a_id', '=', articleId), eb('article_b_id', '=', articleId)]))
        .executeTakeFirst();

      const ids = pair ? [pair.article_a_id, pair.article_b_id] : [articleId];
      const res = await trx.updateTable('article')
        .set({ state: 'DECOMMISSIONED', decommissioned_by: staffId, decommissioned_at: sql`now()` })
        .where('article_id', 'in', ids)
        .where('state', '!=', 'DECOMMISSIONED')
        .executeTakeFirst();
      if (!res.numUpdatedRows) throw notFound('Article not found or already decommissioned.');
    });
  } catch (e) { throw mapDbError(e); }
}

// ── Health check scans (INV-15/16/17/18) ──
// A scan that lands GOOD/WORN now also auto-clears any open damage flag on
// this article and lifts the shared pair state back to AVAILABLE (unless the
// pair sibling is still separately flagged) — scanning an article back to
// health is the resolution, not a separate "review" ceremony. This merges
// what used to require a trip to a dedicated Damage Flags screen into the
// same Scan action used everywhere else.
async function settleAfterScan(
  trx: Transaction<DB>, articleId: string, label: ConditionLabel, scanId: string, staffId: string,
) {
  if (label === 'DAMAGED') {
    await raiseFlagIfDamaged(trx, articleId, label, scanId);
    return;
  }

  const openFlag = await trx.selectFrom('damage_flag').select('flag_id')
    .where('article_id', '=', articleId).where('cleared_at', 'is', null).executeTakeFirst();
  if (openFlag) {
    await trx.updateTable('damage_flag')
      .set({ cleared_by: staffId, cleared_at: sql`now()`, cleared_with_label: label })
      .where('flag_id', '=', openFlag.flag_id).execute();
  }

  const pair = await trx.selectFrom('article_pair')
    .select(['article_a_id', 'article_b_id'])
    .where('dissolved_at', 'is', null)
    .where((eb) => eb.or([eb('article_a_id', '=', articleId), eb('article_b_id', '=', articleId)]))
    .executeTakeFirst();
  const siblingId = pair
    ? (pair.article_a_id === articleId ? pair.article_b_id : pair.article_a_id)
    : null;

  let siblingStillFlagged = false;
  if (siblingId) {
    const siblingOpenFlag = await trx.selectFrom('damage_flag').select('flag_id')
      .where('article_id', '=', siblingId).where('cleared_at', 'is', null).executeTakeFirst();
    siblingStillFlagged = Boolean(siblingOpenFlag);
  }

  if (!siblingStillFlagged) {
    const ids = siblingId ? [articleId, siblingId] : [articleId];
    await trx.updateTable('article').set({ state: 'AVAILABLE' })
      .where('article_id', 'in', ids).where('state', '=', 'DAMAGED').execute();
  }
}

export async function recordScan(articleId: string, input: { kind: 'SCHEDULED' | 'AD_HOC'; score: number; imageData?: string }, staffId: string) {
  try {
    const art = await db.selectFrom('article').select(['equipment_type_id', 'state'])
      .where('article_id', '=', articleId).executeTakeFirst();
    if (!art) throw notFound('Article not found.');
    if (art.state === 'DECOMMISSIONED') throw badRequest('Cannot scan a decommissioned article.');

    const label = await scoreToLabel(art.equipment_type_id, input.score);

    await db.transaction().execute(async (trx) => {
      const scan = await trx.insertInto('health_check_scan').values({
        article_id: articleId, kind: input.kind, source: 'MANUAL',
        health_score: input.score, resulting_label: label, scanned_by: staffId,
        image_data: input.imageData ?? null,
      }).returning('scan_id').executeTakeFirstOrThrow();
      // fn_scan_applies (DB trigger) already updated current_condition_label,
      // and — if label is DAMAGED — set state=DAMAGED on this article and its
      // pair sibling. settleAfterScan handles flag bookkeeping and, for a
      // non-DAMAGED result, lifting the state back to AVAILABLE.
      await settleAfterScan(trx, articleId, label, scan.scan_id, staffId);
    });
    return { conditionLabel: label };
  } catch (e) { throw mapDbError(e); }
}

// INV-19: manual condition override (logged via the label change on the article).
export async function overrideCondition(articleId: string, label: ConditionLabel) {
  const res = await db.updateTable('article').set({ current_condition_label: label })
    .where('article_id', '=', articleId).where('state', '!=', 'DECOMMISSIONED')
    .executeTakeFirst();
  if (!res.numUpdatedRows) throw notFound('Article not found or decommissioned.');
}

// ── Damage flags (INV-20/21) — retained for audit/history and API
// completeness. The Articles tab's Scan action now handles the common case
// end to end (see settleAfterScan above), so day-to-day staff work never
// needs these endpoints — but the underlying flag history stays intact for
// whoever wants to review what was flagged, when, and by what scan.
export async function listOpenDamageFlags() {
  return db.selectFrom('damage_flag as df')
    .innerJoin('article as a', 'a.article_id', 'df.article_id')
    .innerJoin('equipment_type as et', 'et.equipment_type_id', 'a.equipment_type_id')
    .select([
      'df.flag_id', 'df.article_id', 'a.barcode', 'et.name as equipment_type_name',
      'df.raised_by_system', 'df.raised_at',
    ])
    .where('df.cleared_at', 'is', null)
    .orderBy('df.raised_at', 'desc').execute();
}

// INV-20: clearing a flag requires a fresh health score (label is derived from
// it, same as any other scan) — the article returns to AVAILABLE unless its
// pair sibling is still flagged, in which case the shared state stays DAMAGED.
export async function clearDamageFlag(flagId: string, score: number, staffId: string, imageData?: string) {
  try {
    return await db.transaction().execute(async (trx) => {
      const flag = await trx.selectFrom('damage_flag').select(['article_id', 'cleared_at'])
        .where('flag_id', '=', flagId).executeTakeFirst();
      if (!flag) throw notFound('Damage flag not found.');
      if (flag.cleared_at) throw conflict('This flag is already cleared.');

      const art = await trx.selectFrom('article').select(['equipment_type_id'])
        .where('article_id', '=', flag.article_id).executeTakeFirstOrThrow();
      const label = await scoreToLabel(art.equipment_type_id, score);

      const scan = await trx.insertInto('health_check_scan').values({
        article_id: flag.article_id, kind: 'AD_HOC', source: 'MANUAL',
        health_score: score, resulting_label: label, scanned_by: staffId,
        image_data: imageData ?? null,
      }).returning('scan_id').executeTakeFirstOrThrow();
      await settleAfterScan(trx, flag.article_id, label, scan.scan_id, staffId);

      return { conditionLabel: label };
    });
  } catch (e) { throw mapDbError(e); }
}

// ── Availability (INV-13/14, read views) ──
export async function equipmentStatus() {
  const rows = await db.selectFrom('v_equipment_status_badge').selectAll().orderBy('name').execute();
  return rows.map((r) => ({ ...r, available_units: Number(r.available_units) }));
}
