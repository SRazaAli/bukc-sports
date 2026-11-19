/**
 * Coordinator Dashboard — equipment health scans and inventory levels.
 *
 * Read-only aggregates over tables the inventory and health-check features
 * already own (equipment_type, article, health_check_scan, cv_health_assessment,
 * health_check_session, damage_flag). No business logic is introduced.
 *
 * Definitions used everywhere on this page and in both CSV exports:
 *   Stock (units)   articles that are not decommissioned and not damaged
 *                   (on-loan items count — they come back). PAIR types count
 *                   2 articles as 1 unit.
 *   Minimum stock   equipment_type.low_stock_threshold
 *   Stock level     LOW  when stock < minimum, otherwise HIGH
 *   Needed          minimum − stock (0 when HIGH)
 *   Scan status     Up to date   last scan within the last 7 days
 *                   Due          last scan 7+ days ago
 *                   Never scanned no scan recorded
 */
import { sql } from 'kysely';
import { db } from '../../db/index.js';

export const SCAN_FRESH_DAYS = 7;
const TZ = 'Asia/Karachi';

export type StockLevel = 'LOW' | 'HIGH';
export type ScanStatus = 'UP_TO_DATE' | 'DUE' | 'NEVER';

export interface StockRow {
  equipmentTypeId: number; name: string; sport: string; lendingUnit: 'SINGLE' | 'PAIR';
  totalArticles: number; stockUnits: number; availableUnits: number; onLoanUnits: number; damagedArticles: number;
  minimumStock: number; level: StockLevel; needed: number;
  good: number; worn: number; damaged: number;
}

export interface ArticleScanRow {
  articleId: string; barcode: string; equipmentTypeId: number; equipmentName: string; sport: string;
  state: string; currentCondition: 'GOOD' | 'WORN' | 'DAMAGED';
  lastScanAt: Date | null; lastScore: number | null; lastLabel: string | null; lastCvLabel: string | null;
  lastSource: string | null; lastKind: string | null; openFlag: boolean;
  scanStatus: ScanStatus; daysSinceScan: number | null;
}

// ── raw reads ──

export async function stockRows(): Promise<StockRow[]> {
  const r = await sql<{
    equipment_type_id: number; name: string; sport: string; lending_unit: 'SINGLE' | 'PAIR'; low_stock_threshold: number;
    total_articles: string; usable_articles: string; available_articles: string; on_loan_articles: string; damaged_articles: string;
    good: string; worn: string; damaged_label: string; locked: string | null;
  }>`
    SELECT et.equipment_type_id, et.name, sc.name AS sport, et.lending_unit::text AS lending_unit, et.low_stock_threshold,
           count(a.article_id) FILTER (WHERE a.state <> 'DECOMMISSIONED')                         AS total_articles,
           count(a.article_id) FILTER (WHERE a.state NOT IN ('DECOMMISSIONED','DAMAGED'))         AS usable_articles,
           count(a.article_id) FILTER (WHERE a.state = 'AVAILABLE')                               AS available_articles,
           count(a.article_id) FILTER (WHERE a.state = 'ON_LOAN')                                 AS on_loan_articles,
           count(a.article_id) FILTER (WHERE a.state = 'DAMAGED')                                 AS damaged_articles,
           count(a.article_id) FILTER (WHERE a.state <> 'DECOMMISSIONED' AND a.current_condition_label = 'GOOD')    AS good,
           count(a.article_id) FILTER (WHERE a.state <> 'DECOMMISSIONED' AND a.current_condition_label = 'WORN')    AS worn,
           count(a.article_id) FILTER (WHERE a.state <> 'DECOMMISSIONED' AND a.current_condition_label = 'DAMAGED') AS damaged_label,
           (SELECT sum(quantity) FROM event_equipment_allocation e
             WHERE e.equipment_type_id = et.equipment_type_id AND e.locked_at IS NOT NULL AND e.released_at IS NULL) AS locked
      FROM equipment_type et
      JOIN sport_category sc ON sc.sport_category_id = et.sport_category_id
      LEFT JOIN article a ON a.equipment_type_id = et.equipment_type_id
     WHERE et.is_active
     GROUP BY et.equipment_type_id, et.name, sc.name, et.lending_unit, et.low_stock_threshold
     ORDER BY sc.name, et.name`.execute(db);

  return r.rows.map((x) => {
    const per = x.lending_unit === 'PAIR' ? 2 : 1;
    const stockUnits = Math.floor(Number(x.usable_articles) / per);
    const minimumStock = Number(x.low_stock_threshold);
    const level: StockLevel = stockUnits < minimumStock ? 'LOW' : 'HIGH';
    return {
      equipmentTypeId: x.equipment_type_id, name: x.name, sport: x.sport, lendingUnit: x.lending_unit,
      totalArticles: Number(x.total_articles), stockUnits,
      availableUnits: Math.max(0, Math.floor(Number(x.available_articles) / per) - Number(x.locked ?? 0)),
      onLoanUnits: Math.floor(Number(x.on_loan_articles) / per), damagedArticles: Number(x.damaged_articles),
      minimumStock, level, needed: Math.max(0, minimumStock - stockUnits),
      good: Number(x.good), worn: Number(x.worn), damaged: Number(x.damaged_label),
    };
  });
}

export async function articleScanRows(): Promise<ArticleScanRow[]> {
  const r = await sql<{
    article_id: string; barcode: string; equipment_type_id: number; equipment_name: string; sport: string; state: string;
    current_condition_label: 'GOOD' | 'WORN' | 'DAMAGED'; scanned_at: Date | null; health_score: string | null;
    resulting_label: string | null; cv_label: string | null; source: string | null; kind: string | null; open_flag: boolean;
  }>`
    SELECT a.article_id, a.barcode, et.equipment_type_id, et.name AS equipment_name, sc.name AS sport, a.state::text AS state,
           a.current_condition_label, ls.scanned_at, ls.health_score, ls.resulting_label::text AS resulting_label,
           cv.cv_label::text AS cv_label, ls.source::text AS source, ls.kind::text AS kind,
           EXISTS (SELECT 1 FROM damage_flag f WHERE f.article_id = a.article_id AND f.cleared_at IS NULL) AS open_flag
      FROM article a
      JOIN equipment_type et ON et.equipment_type_id = a.equipment_type_id
      JOIN sport_category sc ON sc.sport_category_id = et.sport_category_id
      LEFT JOIN LATERAL (
        SELECT s.scan_id, s.scanned_at, s.health_score, s.resulting_label, s.source, s.kind
          FROM health_check_scan s WHERE s.article_id = a.article_id
         ORDER BY s.scanned_at DESC LIMIT 1
      ) ls ON true
      LEFT JOIN cv_health_assessment cv ON cv.scan_id = ls.scan_id
     WHERE a.state <> 'DECOMMISSIONED'
     ORDER BY et.name, a.barcode`.execute(db);

  const now = Date.now();
  return r.rows.map((x) => {
    const days = x.scanned_at ? Math.floor((now - new Date(x.scanned_at).getTime()) / 86_400_000) : null;
    const scanStatus: ScanStatus = days === null ? 'NEVER' : days < SCAN_FRESH_DAYS ? 'UP_TO_DATE' : 'DUE';
    return {
      articleId: x.article_id, barcode: x.barcode, equipmentTypeId: x.equipment_type_id, equipmentName: x.equipment_name,
      sport: x.sport, state: x.state, currentCondition: x.current_condition_label,
      lastScanAt: x.scanned_at, lastScore: x.health_score === null ? null : Number(x.health_score),
      lastLabel: x.resulting_label, lastCvLabel: x.cv_label, lastSource: x.source, lastKind: x.kind,
      openFlag: x.open_flag, scanStatus, daysSinceScan: days,
    };
  });
}

// ── dashboard payload ──

export async function getCoordinatorDashboard() {
  const [stock, articles, perDay, session] = await Promise.all([
    stockRows(),
    articleScanRows(),
    sql<{ day: string; manual: string; photo: string }>`
      SELECT to_char(d::date, 'YYYY-MM-DD') AS day,
             count(s.scan_id) FILTER (WHERE s.source = 'MANUAL')   AS manual,
             count(s.scan_id) FILTER (WHERE s.source = 'CV_MODEL') AS photo
        FROM generate_series((now() AT TIME ZONE ${TZ})::date - 13, (now() AT TIME ZONE ${TZ})::date, interval '1 day') d
        LEFT JOIN health_check_scan s ON (s.scanned_at AT TIME ZONE ${TZ})::date = d::date
       GROUP BY d ORDER BY d`.execute(db),
    db.selectFrom('health_check_session')
      .select(['alert_sent_at', 'total_articles_due', 'scanned_count', 'overdue_notified_at', 'completed_at'])
      .orderBy('alert_sent_at', 'desc').limit(1).executeTakeFirst(),
  ]);

  const scored = articles.filter((a) => a.lastScore !== null);
  const avg = scored.length ? Math.round(scored.reduce((n, a) => n + (a.lastScore ?? 0), 0) / scored.length) : null;
  const buckets = [0, 20, 40, 60, 80].map((lo) => ({
    label: lo === 80 ? '80–100' : `${lo}–${lo + 19}`,
    from: lo, to: lo === 80 ? 100 : lo + 19,
    count: scored.filter((a) => (a.lastScore ?? 0) >= lo && ((a.lastScore ?? 0) < lo + 20 || (lo === 80 && (a.lastScore ?? 0) <= 100))).length,
  }));
  const scanStatus = {
    upToDate: articles.filter((a) => a.scanStatus === 'UP_TO_DATE').length,
    due: articles.filter((a) => a.scanStatus === 'DUE').length,
    never: articles.filter((a) => a.scanStatus === 'NEVER').length,
  };
  const condition = {
    good: articles.filter((a) => a.currentCondition === 'GOOD').length,
    worn: articles.filter((a) => a.currentCondition === 'WORN').length,
    damaged: articles.filter((a) => a.currentCondition === 'DAMAGED').length,
  };

  // Worst first: damaged → worn → never scanned → longest since last scan.
  const rank = (a: ArticleScanRow) =>
    (a.currentCondition === 'DAMAGED' ? 0 : a.currentCondition === 'WORN' ? 1 : a.scanStatus === 'NEVER' ? 2 : a.scanStatus === 'DUE' ? 3 : 9);
  const attention = articles
    .filter((a) => rank(a) < 9)
    .sort((x, y) => rank(x) - rank(y) || (y.daysSinceScan ?? 1e9) - (x.daysSinceScan ?? 1e9) || (x.lastScore ?? 101) - (y.lastScore ?? 101))
    .slice(0, 8);

  return {
    generatedAt: new Date().toISOString(),
    scanFreshDays: SCAN_FRESH_DAYS,
    kpis: {
      equipmentTypes: stock.length,
      totalArticles: articles.length,
      lowStockTypes: stock.filter((s) => s.level === 'LOW').length,
      unitsNeeded: stock.reduce((n, s) => n + s.needed, 0),
      averageScore: avg,
      scannedThisWeek: scanStatus.upToDate,
      needsAttention: condition.damaged + condition.worn,
      openFlags: articles.filter((a) => a.openFlag).length,
    },
    stock,
    condition,
    scanStatus,
    scoreBuckets: buckets,
    scansPerDay: perDay.rows.map((d) => ({ day: d.day, manual: Number(d.manual), photo: Number(d.photo) })),
    weeklySession: session ? {
      alertSentAt: session.alert_sent_at, totalDue: session.total_articles_due, scanned: session.scanned_count,
      overdue: !!session.overdue_notified_at && !session.completed_at, completedAt: session.completed_at,
    } : null,
    attention: attention.map((a) => ({
      articleId: a.articleId, barcode: a.barcode, equipmentName: a.equipmentName, currentCondition: a.currentCondition,
      lastScore: a.lastScore, lastScanAt: a.lastScanAt, scanStatus: a.scanStatus, daysSinceScan: a.daysSinceScan, openFlag: a.openFlag,
    })),
  };
}

// ── CSV exports (opened by Excel) ──

/** RFC 4180 field. Text that Excel would mangle (barcodes, long digit IDs) is wrapped as ="…" so it stays text. */
function cell(v: unknown, asText = false): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (asText) return `"=""${s.replace(/"/g, '""')}"""`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function toCsv(header: string[], rows: Array<Array<{ v: unknown; text?: boolean } | unknown>>): string {
  const lines = [header.map((h) => cell(h)).join(',')];
  for (const r of rows) {
    lines.push(r.map((c) => (c && typeof c === 'object' && 'v' in (c as object)
      ? cell((c as { v: unknown }).v, (c as { text?: boolean }).text)
      : cell(c))).join(','));
  }
  // BOM so Excel opens UTF-8 (en dashes, Urdu names) correctly; CRLF line ends.
  return '﻿' + lines.join('\r\n') + '\r\n';
}
function karachiStamp(d: Date | null): string {
  if (!d) return '';
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
    .formatToParts(new Date(d));
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return `${g('year')}-${g('month')}-${g('day')} ${g('hour') === '24' ? '00' : g('hour')}:${g('minute')}`;
}
function fileStamp(): string { return karachiStamp(new Date()).slice(0, 10); }

const TITLE: Record<string, string> = {
  GOOD: 'Good', WORN: 'Worn', DAMAGED: 'Damaged', FAIR: 'Fair', POOR: 'Poor', REPLACE: 'Replace',
  AVAILABLE: 'Available', ON_LOAN: 'On loan', UNPAIRED: 'Unpaired',
  MANUAL: 'Manual', CV_MODEL: 'Photo Scan', ENTRY: 'Entry', SCHEDULED: 'Weekly', AD_HOC: 'Ad hoc',
  UP_TO_DATE: 'Up to date', DUE: 'Due', NEVER: 'Never scanned',
};
const t = (v: string | null) => (v ? TITLE[v] ?? v : '');

export async function inventoryCsv() {
  const rows = await stockRows();
  const csv = toCsv(
    ['Equipment', 'Sport', 'Lending unit', 'Articles (not decommissioned)', 'Stock (units)', 'Available now (units)',
      'On loan (units)', 'Damaged articles', 'Minimum stock (units)', 'Stock level', 'Units needed to reach minimum'],
    rows.map((r) => [r.name, r.sport, r.lendingUnit === 'PAIR' ? 'Pair' : 'Single', r.totalArticles, r.stockUnits,
      r.availableUnits, r.onLoanUnits, r.damagedArticles, r.minimumStock, r.level === 'LOW' ? 'Low' : 'High', r.needed]),
  );
  return { filename: `bukc-inventory-stock-${fileStamp()}.csv`, csv, rows: rows.length };
}

export async function healthScanCsv() {
  const rows = await articleScanRows();
  const csv = toCsv(
    ['Equipment', 'Sport', 'Barcode', 'Scan result (health score %)', 'Scan result (label)', 'Photo Scan rating',
      'Current condition', 'Item state', 'Last scan date', 'Days since last scan', 'Scan status', 'Scan method', 'Scan type', 'Open damage flag'],
    rows.map((r) => [r.equipmentName, r.sport, { v: r.barcode, text: true },
      r.lastScore === null ? '' : r.lastScore, t(r.lastLabel), t(r.lastCvLabel),
      t(r.currentCondition), t(r.state), karachiStamp(r.lastScanAt), r.daysSinceScan ?? '', t(r.scanStatus),
      t(r.lastSource), t(r.lastKind), r.openFlag ? 'Yes' : 'No']),
  );
  return { filename: `bukc-health-scans-${fileStamp()}.csv`, csv, rows: rows.length };
}
