/**
 * CV Equipment Health Check service.
 *
 * Flow of POST /api/health-check/scans
 *   1. Look up the article; it must exist, not be decommissioned, and be one of
 *      the three supported kinds (Basketball / Football / Volleyball) —
 *      and match the kind the coordinator selected (WRONG_EQUIPMENT_TYPE).
 *   2. Send the 1–4 photos to the CV service (DINOv2 anomaly detection).
 *   3. In ONE transaction:
 *        - insert a health_check_scan row (source = CV_MODEL). Its GOOD/WORN/
 *          DAMAGED label comes from the equipment type's own thresholds
 *          (INV-17), exactly like a manual scan. Existing DB triggers then
 *          update the article's condition, auto-DAMAGE if needed, and count
 *          SCHEDULED scans toward the weekly session.
 *        - settleAfterScan: raise/clear damage flags + notify Super Admins (INV-18/21)
 *        - audit log entry SCAN_RECORDED (INV-25) with the CV details
 *        - insert the CV detail row into cv_health_assessment (migration 030)
 *
 * Nothing in the existing inventory flow is changed; the helpers are reused.
 */
import { sql } from 'kysely';
import { db } from '../../db/index.js';
import { AppError, badRequest, notFound } from '../../middleware/errors.js';
import { mapDbError, scoreToLabel, settleAfterScan, writeAudit } from '../inventory/service.js';
import { runHealthCheck, type CvEquipmentType, type PhotoBlob } from './cvClient.js';
import type { CreateScanInput, EquipmentKind } from './validators.js';

/** Which inventory equipment-type names count as each supported kind. */
const KIND_NAMES: Record<EquipmentKind, string[]> = {
  BASKETBALL: ['basketball'],
  FOOTBALL: ['football'],
  VOLLEYBALL: ['volleyball', 'volley ball'],
};
const KIND_TO_CV: Record<EquipmentKind, CvEquipmentType> = {
  BASKETBALL: 'basketball', FOOTBALL: 'football', VOLLEYBALL: 'volleyball',
};
const KIND_LABEL: Record<EquipmentKind, string> = {
  BASKETBALL: 'Basketball', FOOTBALL: 'Football', VOLLEYBALL: 'Volleyball',
};

export function kindOfTypeName(name: string): EquipmentKind | null {
  const n = name.trim().toLowerCase();
  return (Object.keys(KIND_NAMES) as EquipmentKind[]).find((k) => KIND_NAMES[k].includes(n)) ?? null;
}

function decodePhoto(dataUrl: string): PhotoBlob {
  const m = /^data:(image\/[a-z]+);base64,(.*)$/s.exec(dataUrl);
  if (!m) throw badRequest('Each photo must be a JPG or PNG image.', 'INVALID_IMAGE');
  const mime = m[1] === 'image/jpg' ? 'image/jpeg' : m[1]!;
  const bytes = Buffer.from(m[2]!.replace(/\s/g, ''), 'base64');
  if (bytes.length === 0) throw badRequest('One of the photos is empty.', 'INVALID_IMAGE');
  if (bytes.length > 5 * 1024 * 1024) throw new AppError(413, 'Each photo must be 5 MB or smaller.', 'IMAGE_TOO_LARGE');
  return { bytes, mime };
}

// ── Items the coordinator can pick for a given kind ──
export async function listCandidateArticles(kind: EquipmentKind) {
  const rows = await sql<{
    article_id: string; barcode: string; state: string; current_condition_label: string;
    equipment_type_name: string; last_score: string | null; last_cv_label: string | null; last_scanned_at: Date | null;
  }>`
    SELECT a.article_id, a.barcode, a.state, a.current_condition_label, et.name AS equipment_type_name,
           last.health_score AS last_score, last.cv_label AS last_cv_label, last.created_at AS last_scanned_at
    FROM article a
    JOIN equipment_type et ON et.equipment_type_id = a.equipment_type_id
    LEFT JOIN LATERAL (
      SELECT cv.health_score, cv.cv_label, cv.created_at
      FROM cv_health_assessment cv JOIN health_check_scan s ON s.scan_id = cv.scan_id
      WHERE s.article_id = a.article_id
      ORDER BY cv.created_at DESC LIMIT 1
    ) last ON true
    WHERE a.state <> 'DECOMMISSIONED' AND lower(btrim(et.name)) IN (${sql.join(KIND_NAMES[kind])})
    ORDER BY a.barcode`.execute(db);
  return rows.rows.map((r) => ({
    articleId: r.article_id, barcode: r.barcode, state: r.state, conditionLabel: r.current_condition_label,
    equipmentTypeName: r.equipment_type_name,
    lastScore: r.last_score === null ? null : Number(r.last_score), lastCvLabel: r.last_cv_label,
    lastScannedAt: r.last_scanned_at,
  }));
}

// ── Run a CV health check and save it against the article ──
export async function createScan(input: CreateScanInput, staffId: string) {
  const art = await db.selectFrom('article as a')
    .innerJoin('equipment_type as et', 'et.equipment_type_id', 'a.equipment_type_id')
    .select(['a.article_id', 'a.barcode', 'a.state', 'a.equipment_type_id', 'et.name as type_name'])
    .where('a.article_id', '=', input.articleId)
    .executeTakeFirst();
  if (!art) throw notFound('Item not found.');
  if (art.state === 'DECOMMISSIONED') throw badRequest('This item has been decommissioned and cannot be scanned.');

  const actualKind = kindOfTypeName(art.type_name);
  if (!actualKind) {
    throw badRequest(`Health checks support only Basketball, Football and Volleyball — this item is a ${art.type_name}.`,
      'WRONG_EQUIPMENT_TYPE');
  }
  if (actualKind !== input.equipmentKind) {
    throw badRequest(`Item ${art.barcode} is a ${KIND_LABEL[actualKind]}, but ${KIND_LABEL[input.equipmentKind]} is selected.`,
      'WRONG_EQUIPMENT_TYPE');
  }

  const photos = input.images.map(decodePhoto);
  const cv = await runHealthCheck(KIND_TO_CV[input.equipmentKind], photos);

  const score = Math.max(0, Math.min(100, Math.round(cv.health_score)));
  const conditionLabel = await scoreToLabel(art.equipment_type_id, score);
  const confidence = Math.max(0, Math.min(1, cv.confidence));
  const perView = cv.views.map((v) => ({
    index: v.index, health_score: v.health_score, anomaly_percent: v.anomaly_percent,
    severity: v.severity, heatmap_image: v.heatmap_image,
  }));

  try {
    const scanId = await db.transaction().execute(async (trx) => {
      const scan = await trx.insertInto('health_check_scan').values({
        article_id: art.article_id, kind: input.scanKind, source: 'CV_MODEL',
        health_score: score, resulting_label: conditionLabel, scanned_by: staffId,
        cv_model_version: cv.model_version.slice(0, 200), cv_confidence: confidence.toFixed(3),
        image_data: cv.processed_image,
      }).returning('scan_id').executeTakeFirstOrThrow();

      // Same bookkeeping as a manual scan (damage flags, availability restore, SA notification).
      await settleAfterScan(trx, art.article_id, conditionLabel, scan.scan_id, staffId);

      await writeAudit(trx, 'SCAN_RECORDED', staffId, {
        articleId: art.article_id,
        detail: {
          scanId: scan.scan_id, kind: input.scanKind, source: 'CV_MODEL', score, resultingLabel: conditionLabel,
          cvLabel: cv.label, anomalyPercent: cv.anomaly_percent, severity: cv.severity, views: cv.views.length,
          modelVersion: cv.model_version,
        },
      });

      await sql`
        INSERT INTO cv_health_assessment
          (scan_id, equipment_kind, cv_label, health_score, anomaly_percent, severity, views_count,
           heatmap_image, processed_image, per_view, warnings, model_version, processing_ms)
        VALUES
          (${scan.scan_id}, ${input.equipmentKind}::cv_equipment_kind, ${cv.label}::cv_health_label, ${score},
           ${Math.min(100, Math.max(0, cv.anomaly_percent))}, ${Math.min(1, Math.max(0, cv.severity))},
           ${cv.views.length}, ${cv.heatmap_image}, ${cv.processed_image},
           ${JSON.stringify(perView)}::jsonb, ${JSON.stringify(cv.warnings ?? [])}::jsonb,
           ${cv.model_version}, ${cv.processing_ms ?? null})`.execute(trx);

      return scan.scan_id;
    });
    return getScan(scanId);
  } catch (e) {
    throw mapDbError(e);
  }
}

// ── History ──
interface ScanRow {
  scan_id: string; scanned_at: Date; scan_kind: string; scanned_by_name: string;
  article_id: string; barcode: string; equipment_type_name: string; equipment_kind: EquipmentKind;
  health_score: string; cv_label: string; anomaly_percent: string; severity: string; views_count: number;
  condition_label: string; model_version: string; cv_confidence: string | null; processing_ms: number | null;
}

function mapRow(r: ScanRow) {
  return {
    scanId: r.scan_id, scannedAt: r.scanned_at, scanKind: r.scan_kind, scannedByName: r.scanned_by_name,
    articleId: r.article_id, barcode: r.barcode, equipmentTypeName: r.equipment_type_name,
    equipmentKind: r.equipment_kind, healthScore: Number(r.health_score), cvLabel: r.cv_label,
    anomalyPercent: Number(r.anomaly_percent), severity: Number(r.severity), viewsCount: r.views_count,
    conditionLabel: r.condition_label, modelVersion: r.model_version,
    confidence: r.cv_confidence === null ? null : Number(r.cv_confidence), processingMs: r.processing_ms,
  };
}

const SELECT_SCAN = sql`
  SELECT s.scan_id, s.scanned_at, s.kind AS scan_kind, u.full_name AS scanned_by_name,
         a.article_id, a.barcode, et.name AS equipment_type_name, cv.equipment_kind,
         cv.health_score, cv.cv_label, cv.anomaly_percent, cv.severity, cv.views_count,
         s.resulting_label AS condition_label, cv.model_version, s.cv_confidence, cv.processing_ms`;
const FROM_SCAN = sql`
  FROM cv_health_assessment cv
  JOIN health_check_scan s ON s.scan_id = cv.scan_id
  JOIN article a ON a.article_id = s.article_id
  JOIN equipment_type et ON et.equipment_type_id = a.equipment_type_id
  JOIN app_user u ON u.user_id = s.scanned_by`;

export async function listScans(f: { limit: number; offset: number; equipmentKind?: EquipmentKind; articleId?: string }) {
  const conds = [sql`true`];
  if (f.equipmentKind) conds.push(sql`cv.equipment_kind = ${f.equipmentKind}::cv_equipment_kind`);
  if (f.articleId) conds.push(sql`s.article_id = ${f.articleId}`);
  const where = sql.join(conds, sql` AND `);
  const rows = await sql<ScanRow>`${SELECT_SCAN} ${FROM_SCAN} WHERE ${where}
    ORDER BY s.scanned_at DESC LIMIT ${f.limit} OFFSET ${f.offset}`.execute(db);
  const total = await sql<{ n: string }>`SELECT count(*)::text AS n ${FROM_SCAN} WHERE ${where}`.execute(db);
  return { scans: rows.rows.map(mapRow), total: Number(total.rows[0]?.n ?? 0) };
}

export async function getScan(scanId: string) {
  const r = await sql<ScanRow & { heatmap_image: string; processed_image: string | null; per_view: unknown; warnings: unknown }>`
    ${SELECT_SCAN}, cv.heatmap_image, cv.processed_image, cv.per_view, cv.warnings
    ${FROM_SCAN} WHERE cv.scan_id = ${scanId}`.execute(db);
  const row = r.rows[0];
  if (!row) throw notFound('Health check not found.');
  return {
    ...mapRow(row),
    heatmapImage: row.heatmap_image,
    processedImage: row.processed_image,
    perView: row.per_view as Array<{ index: number; health_score: number; anomaly_percent: number; severity: number; heatmap_image: string }>,
    warnings: row.warnings as string[],
  };
}
