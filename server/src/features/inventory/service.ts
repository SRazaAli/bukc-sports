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
 *
 * Notifications wired here:
 *   INV-01  — SA notified when Coordinator adds an article
 *   INV-21  — SA notified when any damage flag is raised
 *   INV-22  — SA notified when Coordinator edits an equipment type
 *   INV-23  — SA notified when Coordinator decommissions an article
 *   INV-15  — Coordinator notified with weekly HEALTH_CHECK_DUE
 *   INV-29  — Coordinator notified with HEALTH_CHECK_OVERDUE after 48h
 *
 * Audit log (INV-25) written for:
 *   ARTICLE_ENTERED, ARTICLE_DECOMMISSIONED, TYPE_EDITED,
 *   SCAN_RECORDED, DAMAGE_FLAG_RAISED, DAMAGE_FLAG_CLEARED,
 *   CONDITION_OVERRIDDEN, PAIR_FORMED, PAIR_DISSOLVED
 */
import { sql, type Transaction } from 'kysely';
import { db, isPgError, type ConditionLabel, type ArticleState, type DB, type ArticleAuditAction } from '../../db/index.js';
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

// ── Audit log helper (INV-25) ──
async function writeAudit(
  trx: Transaction<DB>,
  action: ArticleAuditAction,
  actorId: string,
  opts: { articleId?: string; equipmentTypeId?: number; detail?: Record<string, unknown> },
) {
  await trx.insertInto('article_audit_log').values({
    action,
    actor_id: actorId,
    article_id: opts.articleId ?? null,
    equipment_type_id: opts.equipmentTypeId ?? null,
    detail: JSON.stringify(opts.detail ?? {}),
  }).execute();
}

// ── Notification helpers ──

/** Find all active Super Admins to notify them. */
async function getSuperAdminIds(): Promise<string[]> {
  const rows = await db.selectFrom('app_user')
    .select('user_id')
    .where('role', '=', 'SUPER_ADMIN')
    .where('status', '=', 'ACTIVE')
    .execute();
  return rows.map((r) => r.user_id);
}

/** Find all active Coordinators to notify them. */
async function getCoordinatorIds(): Promise<string[]> {
  const rows = await db.selectFrom('app_user')
    .select('user_id')
    .where('role', '=', 'COORDINATOR')
    .where('status', '=', 'ACTIVE')
    .execute();
  return rows.map((r) => r.user_id);
}

type NotifType = 'INVENTORY_ACTION' | 'DAMAGE_FLAGGED' | 'HEALTH_CHECK_DUE' | 'HEALTH_CHECK_OVERDUE';

async function notifyMany(
  trx: Transaction<DB>,
  recipientIds: string[],
  type: NotifType,
  title: string,
  body: string,
  articleId?: string,
) {
  if (recipientIds.length === 0) return;
  await trx.insertInto('notification').values(
    recipientIds.map((rid) => ({
      recipient_id: rid,
      type,
      title,
      body,
      article_id: articleId ?? null,
    })),
  ).execute();
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

// Full edit of an equipment type's descriptive/tunable fields.
// INV-22: Super Admin is notified when a Coordinator makes this edit.
// The audit log records the TYPE_EDITED action for every edit regardless of actor.
export async function updateEquipmentType(typeId: number, input: {
  name?: string; isIndoor?: boolean; lowStockThreshold?: number;
  maxBorrowDurationMinutes?: number; conditionGoodMinScore?: number;
  conditionWornMinScore?: number; imageUrl?: string;
}, actorId: string, actorRole: string) {
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
    await db.transaction().execute(async (trx) => {
      const res = await trx.updateTable('equipment_type').set(patch)
        .where('equipment_type_id', '=', typeId).executeTakeFirst();
      if (!res.numUpdatedRows) throw notFound('Equipment type not found.');

      // INV-25: audit log
      await writeAudit(trx, 'TYPE_EDITED', actorId, {
        equipmentTypeId: typeId,
        detail: { changed: Object.keys(patch), actorRole },
      });

      // INV-22: notify Super Admins when Coordinator edits
      if (actorRole === 'COORDINATOR') {
        const saIds = await getSuperAdminIds();
        await notifyMany(trx, saIds, 'INVENTORY_ACTION',
          'Equipment Type Edited',
          `A Coordinator edited the settings for equipment type ID ${typeId}.`,
        );
      }
    });
  } catch (e) { throw mapDbError(e); }
}

export async function deleteEquipmentType(typeId: number) {
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

  try {
    const res = await db.deleteFrom('equipment_type')
      .where('equipment_type_id', '=', typeId).executeTakeFirst();
    if (!res.numDeletedRows) throw notFound('Equipment type not found.');
  } catch (e) {
    if (isPgError(e) && e.code === '23503') {
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

// INV-18/21: raise a system damage flag for an article if one isn't already open.
// Notifies all Super Admins (INV-21) and writes the audit log (INV-25).
async function raiseFlagIfDamaged(
  trx: Transaction<DB>,
  articleId: string,
  label: ConditionLabel,
  sourceScanId: string | null,
  actorId: string,
) {
  if (label !== 'DAMAGED') return;
  const already = await trx.selectFrom('damage_flag').select('flag_id')
    .where('article_id', '=', articleId).where('cleared_at', 'is', null).executeTakeFirst();
  if (already) return;

  await trx.insertInto('damage_flag').values({
    article_id: articleId, raised_by_system: true, source_scan_id: sourceScanId,
  }).execute();

  // INV-25: audit
  await writeAudit(trx, 'DAMAGE_FLAG_RAISED', actorId, {
    articleId,
    detail: { raisedBySystem: true, sourceScanId },
  });

  // INV-21: notify all Super Admins
  const saIds = await getSuperAdminIds();
  await notifyMany(trx, saIds, 'DAMAGE_FLAGGED',
    'Article Flagged as Damaged',
    `Article ${articleId} has been automatically flagged as DAMAGED based on a health check scan score.`,
    articleId,
  );
}

// ── Articles ──
// INV-02/03/04: add a SINGLE article; entry scan sets baseline condition.
// INV-01: Super Admin notified when Coordinator adds an article.
// INV-25: audit log entry for ARTICLE_ENTERED.
export async function addArticle(input: {
  equipmentTypeId: number; barcode: string; entryScore: number; imageData?: string;
}, staffId: string, staffRole: string) {
  try {
    const type = await db.selectFrom('equipment_type').select(['lending_unit', 'name'])
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

      await raiseFlagIfDamaged(trx, art.article_id, label, scan.scan_id, staffId);

      // INV-25: audit log
      await writeAudit(trx, 'ARTICLE_ENTERED', staffId, {
        articleId: art.article_id,
        equipmentTypeId: input.equipmentTypeId,
        detail: { barcode: input.barcode, entryScore: input.entryScore, conditionLabel: label, state: initialState },
      });

      // INV-01: notify Super Admins when Coordinator adds an article
      if (staffRole === 'COORDINATOR') {
        const saIds = await getSuperAdminIds();
        await notifyMany(trx, saIds, 'INVENTORY_ACTION',
          'New Article Added',
          `A Coordinator added article ${input.barcode} (${type.name}) to inventory with condition ${label}.`,
          art.article_id,
        );
      }

      return art.article_id;
    });

    return { articleId, barcode: input.barcode, conditionLabel: label, state: initialState };
  } catch (e) { throw mapDbError(e); }
}

// Pair-type articles are always entered as a pair in one action.
// INV-01: Super Admin notified when Coordinator adds a pair.
// INV-25: audit log for both articles + the pair formed.
export async function addArticlePair(input: {
  equipmentTypeId: number; barcodeA: string; barcodeB: string;
  entryScoreA: number; entryScoreB: number; imageDataA?: string; imageDataB?: string;
}, staffId: string, staffRole: string) {
  try {
    const type = await db.selectFrom('equipment_type').select(['lending_unit', 'name'])
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
        await raiseFlagIfDamaged(trx, art.article_id, label, scan.scan_id, staffId);
        await writeAudit(trx, 'ARTICLE_ENTERED', staffId, {
          articleId: art.article_id,
          equipmentTypeId: input.equipmentTypeId,
          detail: { barcode, entryScore: score, conditionLabel: label, state: sharedState, isPairHalf: true },
        });
        return art.article_id;
      };

      const idA = await insertOne(input.barcodeA, labelA, input.entryScoreA, input.imageDataA);
      const idB = await insertOne(input.barcodeB, labelB, input.entryScoreB, input.imageDataB);

      const [aId, bId] = idA < idB ? [idA, idB] : [idB, idA];
      await trx.insertInto('article_pair')
        .values({ article_a_id: aId, article_b_id: bId, formed_by: staffId }).execute();

      // Audit the pair formation itself
      await writeAudit(trx, 'PAIR_FORMED', staffId, {
        detail: { articleIdA: idA, articleIdB: idB, equipmentTypeId: input.equipmentTypeId },
      });

      // INV-01: notify Super Admins when Coordinator adds a pair
      if (staffRole === 'COORDINATOR') {
        const saIds = await getSuperAdminIds();
        await notifyMany(trx, saIds, 'INVENTORY_ACTION',
          'New Article Pair Added',
          `A Coordinator added a pair (${input.barcodeA} + ${input.barcodeB}) of ${type.name} to inventory.`,
          idA,
        );
      }

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

// INV-27: full lifecycle history of one article.
// Returns: article details + all scans + all damage flags + all pair history
// + the full article_audit_log entries for this article.
export async function getArticleDetail(articleId: string) {
  const article = await db.selectFrom('article as a')
    .innerJoin('equipment_type as et', 'et.equipment_type_id', 'a.equipment_type_id')
    .innerJoin('app_user as entered_user', 'entered_user.user_id', 'a.entered_by')
    .leftJoin('app_user as decom_user', 'decom_user.user_id', 'a.decommissioned_by')
    .select([
      'a.article_id', 'a.barcode', 'a.state', 'a.current_condition_label',
      'a.equipment_type_id', 'et.name as equipment_type_name', 'et.lending_unit',
      'a.entered_at', 'a.decommissioned_at',
      'entered_user.full_name as entered_by_name',
      'decom_user.full_name as decommissioned_by_name',
    ])
    .where('a.article_id', '=', articleId).executeTakeFirst();
  if (!article) throw notFound('Article not found.');

  const scans = await db.selectFrom('health_check_scan as hcs')
    .innerJoin('app_user as u', 'u.user_id', 'hcs.scanned_by')
    .select(['hcs.scan_id', 'hcs.kind', 'hcs.source', 'hcs.health_score', 'hcs.resulting_label', 'hcs.scanned_at', 'u.full_name as scanned_by_name'])
    .where('hcs.article_id', '=', articleId).orderBy('hcs.scanned_at', 'desc').execute();

  const flags = await db.selectFrom('damage_flag as df')
    .leftJoin('app_user as raiser', 'raiser.user_id', 'df.raised_by')
    .leftJoin('app_user as clearer', 'clearer.user_id', 'df.cleared_by')
    .select([
      'df.flag_id', 'df.raised_by_system', 'df.raised_at', 'df.cleared_at', 'df.cleared_with_label',
      'raiser.full_name as raised_by_name', 'clearer.full_name as cleared_by_name',
    ])
    .where('df.article_id', '=', articleId).orderBy('df.raised_at', 'desc').execute();

  const pairs = await db.selectFrom('article_pair as ap')
    .leftJoin('app_user as former', 'former.user_id', 'ap.formed_by')
    .leftJoin('app_user as dissolver', 'dissolver.user_id', 'ap.dissolved_by')
    .select([
      'ap.pair_id', 'ap.article_a_id', 'ap.article_b_id', 'ap.formed_at',
      'ap.dissolved_at', 'ap.dissolution_reason',
      'former.full_name as formed_by_name', 'dissolver.full_name as dissolved_by_name',
    ])
    .where((eb) => eb.or([eb('ap.article_a_id', '=', articleId), eb('ap.article_b_id', '=', articleId)]))
    .orderBy('ap.formed_at', 'desc').execute();

  // INV-27: full audit trail for this article
  const auditLog = await db.selectFrom('article_audit_log as al')
    .innerJoin('app_user as u', 'u.user_id', 'al.actor_id')
    .select(['al.log_id', 'al.action', 'al.occurred_at', 'al.detail', 'u.full_name as actor_name', 'u.role as actor_role'])
    .where('al.article_id', '=', articleId)
    .orderBy('al.occurred_at', 'desc').execute();

  return { article, scans, flags, pairs, auditLog };
}

// INV-23: decommission (terminal). DB enforces INV-24 (cannot un-decommission).
// A pair-type article has no standalone existence — decommissioning one half
// decommissions both, atomically.
// INV-23: Super Admin notified when Coordinator decommissions.
// INV-25: audit log.
export async function decommissionArticle(articleId: string, staffId: string, staffRole: string) {
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

      // INV-25: audit log for each decommissioned article
      for (const id of ids) {
        await writeAudit(trx, 'ARTICLE_DECOMMISSIONED', staffId, {
          articleId: id,
          detail: { isPairDecommission: ids.length > 1, peerArticleId: ids.find((x) => x !== id) },
        });
      }

      // INV-23: notify Super Admins when Coordinator decommissions
      if (staffRole === 'COORDINATOR') {
        const saIds = await getSuperAdminIds();
        const isPair = ids.length > 1;
        await notifyMany(trx, saIds, 'INVENTORY_ACTION',
          'Article Decommissioned',
          isPair
            ? `A Coordinator decommissioned a pair of articles (IDs: ${ids.join(', ')}).`
            : `A Coordinator decommissioned article ${articleId}.`,
          articleId,
        );
      }
    });
  } catch (e) { throw mapDbError(e); }
}

// ── Health check scans (INV-15/16/17/18) ──
async function settleAfterScan(
  trx: Transaction<DB>, articleId: string, label: ConditionLabel, scanId: string, staffId: string,
) {
  if (label === 'DAMAGED') {
    await raiseFlagIfDamaged(trx, articleId, label, scanId, staffId);
    return;
  }

  const openFlag = await trx.selectFrom('damage_flag').select('flag_id')
    .where('article_id', '=', articleId).where('cleared_at', 'is', null).executeTakeFirst();
  if (openFlag) {
    await trx.updateTable('damage_flag')
      .set({ cleared_by: staffId, cleared_at: sql`now()`, cleared_with_label: label })
      .where('flag_id', '=', openFlag.flag_id).execute();

    // INV-25: audit flag clearance
    await writeAudit(trx, 'DAMAGE_FLAG_CLEARED', staffId, {
      articleId,
      detail: { flagId: openFlag.flag_id, clearedWithLabel: label },
    });
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

export async function recordScan(
  articleId: string,
  input: { kind: 'SCHEDULED' | 'AD_HOC'; score: number; imageData?: string },
  staffId: string,
) {
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
      // pair sibling. settleAfterScan handles flag bookkeeping and AVAILABLE restore.
      await settleAfterScan(trx, articleId, label, scan.scan_id, staffId);

      // INV-25: audit scan
      await writeAudit(trx, 'SCAN_RECORDED', staffId, {
        articleId,
        detail: { scanId: scan.scan_id, kind: input.kind, score: input.score, resultingLabel: label },
      });
    });
    return { conditionLabel: label };
  } catch (e) { throw mapDbError(e); }
}

// INV-19: manual condition override — logged with timestamp and actor (INV-25).
export async function overrideCondition(articleId: string, label: ConditionLabel, staffId: string) {
  try {
    await db.transaction().execute(async (trx) => {
      const res = await trx.updateTable('article').set({ current_condition_label: label })
        .where('article_id', '=', articleId).where('state', '!=', 'DECOMMISSIONED')
        .executeTakeFirst();
      if (!res.numUpdatedRows) throw notFound('Article not found or decommissioned.');

      // INV-25: audit override
      await writeAudit(trx, 'CONDITION_OVERRIDDEN', staffId, {
        articleId,
        detail: { overriddenLabel: label },
      });
    });
  } catch (e) { throw mapDbError(e); }
}

// ── Damage flags ──
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

      // INV-25: audit
      await writeAudit(trx, 'DAMAGE_FLAG_CLEARED', staffId, {
        articleId: flag.article_id,
        detail: { flagId, clearedWithScore: score, clearedWithLabel: label },
      });

      return { conditionLabel: label };
    });
  } catch (e) { throw mapDbError(e); }
}

// ── Availability (INV-13/14, read views) ──
export async function equipmentStatus() {
  const rows = await db.selectFrom('v_equipment_status_badge').selectAll().orderBy('name').execute();
  return rows.map((r) => ({ ...r, available_units: Number(r.available_units) }));
}

// ── Weekly health check (INV-15/28/29) — called by scheduled job ──

/**
 * INV-15/28: Fire the weekly HEALTH_CHECK_DUE notification to all Coordinators.
 * Opens a new health_check_session row to track scan progress.
 * Should be called once per week by the scheduler in server.ts.
 * Guard: if there's already an open session (previous week not completed),
 * skip sending a new one — the overdue job will handle it separately.
 */
export async function fireWeeklyHealthCheckAlert(): Promise<void> {
  try {
    // Check for an already-open session — don't double-send
    const openSession = await db.selectFrom('health_check_session')
      .select('session_id')
      .where('completed_at', 'is', null)
      .executeTakeFirst();
    if (openSession) {
      console.log('[HealthCheck] Skipped weekly alert — previous session still open');
      return;
    }

    // Count active (non-decommissioned) articles to scan
    const countRow = await db.selectFrom('article')
      .select(db.fn.countAll().as('n'))
      .where('state', '!=', 'DECOMMISSIONED')
      .executeTakeFirst();
    const totalDue = Number(countRow?.n ?? 0);

    if (totalDue === 0) {
      console.log('[HealthCheck] No active articles — skipping weekly alert');
      return;
    }

    const coordinatorIds = await getCoordinatorIds();
    if (coordinatorIds.length === 0) {
      console.log('[HealthCheck] No active Coordinators to notify');
      return;
    }

    await db.transaction().execute(async (trx) => {
      // Open the health-check session
      await trx.insertInto('health_check_session').values({
        total_articles_due: totalDue,
      }).execute();

      // Notify all Coordinators
      await notifyMany(trx, coordinatorIds, 'HEALTH_CHECK_DUE',
        'Weekly Health Check Due',
        `It's time for the weekly health check. ${totalDue} article${totalDue === 1 ? '' : 's'} need to be scanned. ` +
        `Please complete all scans within 48 hours. Use the Inventory → Articles tab to scan each article.`,
      );
    });

    console.log(`[HealthCheck] Weekly alert sent — ${totalDue} articles due, ${coordinatorIds.length} coordinator(s) notified`);
  } catch (err) {
    console.error('[HealthCheck] fireWeeklyHealthCheckAlert failed:', err);
  }
}

/**
 * INV-29: Check for overdue health-check sessions (open > 48h, no overdue alert yet).
 * Called by the scheduler every hour; fires the overdue notification once per session.
 */
export async function checkHealthCheckOverdue(): Promise<void> {
  try {
    // Find open sessions where 48h has passed and overdue alert not yet sent.
    // Use raw SQL for the timestamp comparison — Kysely's type for Generated<Timestamp>
    // columns doesn't accept a RawBuilder in the .where() helper (same quirk as
    // countRecentAttempts in auth). Raw query is the proven workaround.
    const overdueSessions = await sql<{
      session_id: string; scanned_count: number; total_articles_due: number;
    }>`
      SELECT session_id, scanned_count, total_articles_due
      FROM health_check_session
      WHERE completed_at IS NULL
        AND overdue_notified_at IS NULL
        AND alert_sent_at < now() - interval '48 hours'
    `.execute(db).then((r) => r.rows);

    if (overdueSessions.length === 0) return;

    const coordinatorIds = await getCoordinatorIds();
    if (coordinatorIds.length === 0) return;

    for (const session of overdueSessions) {
      const remaining = session.total_articles_due - session.scanned_count;
      await db.transaction().execute(async (trx) => {
        // Mark overdue alert sent
        await trx.updateTable('health_check_session')
          .set({ overdue_notified_at: sql`now()` })
          .where('session_id', '=', session.session_id)
          .execute();

        // Notify all Coordinators
        await notifyMany(trx, coordinatorIds, 'HEALTH_CHECK_OVERDUE',
          'Health Check Overdue',
          `The weekly health check is overdue. ${remaining} article${remaining === 1 ? '' : 's'} still need to be scanned. ` +
          `Please complete the outstanding scans immediately.`,
        );
      });
      console.log(`[HealthCheck] Overdue alert sent for session ${session.session_id} — ${remaining} articles remaining`);
    }
  } catch (err) {
    console.error('[HealthCheck] checkHealthCheckOverdue failed:', err);
  }
}

// ── Article audit log read (INV-25) — for admin/coordinator review ──
export async function listArticleAuditLog(filter: {
  articleId?: string; equipmentTypeId?: number; limit?: number;
}) {
  let q = db.selectFrom('article_audit_log as al')
    .innerJoin('app_user as u', 'u.user_id', 'al.actor_id')
    .select([
      'al.log_id', 'al.article_id', 'al.equipment_type_id', 'al.action',
      'al.occurred_at', 'al.detail', 'u.full_name as actor_name', 'u.role as actor_role',
    ])
    .orderBy('al.occurred_at', 'desc');
  if (filter.articleId) q = q.where('al.article_id', '=', filter.articleId);
  if (filter.equipmentTypeId) q = q.where('al.equipment_type_id', '=', filter.equipmentTypeId);
  return q.limit(filter.limit ?? 200).execute();
}

// INV-27: standalone lifecycle endpoint (same as getArticleDetail but focused)
export async function getArticleLifecycle(articleId: string) {
  return getArticleDetail(articleId);
}
