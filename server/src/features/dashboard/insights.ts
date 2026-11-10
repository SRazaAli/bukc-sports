/**
 * Dashboard insights (read-only, additive).
 *
 * GET /api/dashboard-insights?days=7|30|90
 *
 * Powers the redesigned Admin Dashboard with trend data the original
 * /api/dashboard endpoint does not return (daily/period series, recent
 * activity, top sports, pending list, upcoming events, equipment health mix).
 *
 * Rules:
 *  - NO writes, NO business logic — plain aggregate reads over existing tables.
 *  - The original /api/dashboard route and service are untouched.
 *  - Days are counted in the university's time zone (Asia/Karachi).
 *  - Same access rule as the dashboard: SUPER_ADMIN and COORDINATOR.
 */
import { Router } from 'express';
import { sql } from 'kysely';
import { db } from '../../db/index.js';
import { asyncHandler } from '../../middleware/async.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';

const TZ = 'Asia/Karachi';
const ALLOWED_DAYS = [7, 30, 90] as const;
type Days = (typeof ALLOWED_DAYS)[number];
/** How many days each chart point covers for a given range. */
const BUCKET_DAYS: Record<Days, number> = { 7: 1, 30: 5, 90: 7 };

// ── date helpers (all in Karachi local days) ────────────────────────────────

/** Today's date in Karachi as YYYY-MM-DD. */
function karachiToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/** Every day from `from` to `to` inclusive. */
function dayList(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

type DayCount = { day: string; n: string | number };

/** Count rows per Karachi day for one table/timestamp column since `from`. */
async function countPerDay(table: string, tsCol: string, from: string, extraWhere = sql`true`): Promise<Map<string, number>> {
  const res = await sql<DayCount>`
    SELECT to_char((${sql.ref(tsCol)} AT TIME ZONE ${TZ})::date, 'YYYY-MM-DD') AS day, count(*) AS n
    FROM ${sql.table(table)}
    WHERE ${sql.ref(tsCol)} >= (${from}::date)::timestamp AT TIME ZONE ${TZ}
      AND ${extraWhere}
    GROUP BY 1`.execute(db);
  return new Map(res.rows.map((r) => [r.day, Number(r.n)]));
}

function series(map: Map<string, number>, days: string[]): number[] {
  return days.map((d) => map.get(d) ?? 0);
}
function sum(a: number[]): number {
  return a.reduce((x, y) => x + y, 0);
}
/** Group a daily series into chart buckets of `size` days. */
function bucketize(daily: number[], size: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < daily.length; i += size) out.push(sum(daily.slice(i, i + size)));
  return out;
}

// ── the payload ─────────────────────────────────────────────────────────────

export async function getInsights(days: Days, isSuperAdmin: boolean) {
  const today = karachiToday();
  const curFrom = addDays(today, -(days - 1));
  const prevFrom = addDays(curFrom, -days);
  const prevTo = addDays(curFrom, -1);
  const curDays = dayList(curFrom, today);
  const prevDays = dayList(prevFrom, prevTo);
  const bucket = BUCKET_DAYS[days];

  // Daily counts over current + previous period, one query each.
  const [borrowMap, bookingMap, usageMap, articleMap] = await Promise.all([
    countPerDay('borrow_request', 'submitted_at', prevFrom),
    countPerDay('booking', 'submitted_at', prevFrom),
    countPerDay('borrow_transaction', 'actual_start_at', prevFrom),
    countPerDay('article', 'entered_at', prevFrom),
  ]);

  const kpiOf = (m: Map<string, number>) => {
    const daily = series(m, curDays);
    const prevDaily = series(m, prevDays);
    return { current: sum(daily), previous: sum(prevDaily), daily, prevDaily };
  };
  const borrowK = kpiOf(borrowMap);
  const bookingK = kpiOf(bookingMap);
  const usageK = kpiOf(usageMap);
  const articleK = kpiOf(articleMap);

  // ── snapshot counts ──
  const snap = await sql<{
    articles: string; available: string; borrow_pending: string; venue_pending: string;
    venue_forwarded: string; accounts_pending: string;
  }>`
    SELECT
      (SELECT count(*) FROM article WHERE state <> 'DECOMMISSIONED') AS articles,
      (SELECT count(*) FROM article WHERE state = 'AVAILABLE') AS available,
      (SELECT count(*) FROM borrow_request WHERE status = 'PENDING') AS borrow_pending,
      (SELECT count(*) FROM booking WHERE status = 'PENDING') AS venue_pending,
      (SELECT count(*) FROM booking WHERE status = 'FORWARDED') AS venue_forwarded,
      (SELECT count(*) FROM app_user WHERE status = 'PENDING_VERIFICATION' AND role IN ('STUDENT','EXTERNAL')) AS accounts_pending
  `.execute(db);
  const s = snap.rows[0]!;
  const accountsPending = isSuperAdmin ? Number(s.accounts_pending) : null;
  const pendingTotal = Number(s.borrow_pending) + Number(s.venue_pending) + Number(s.venue_forwarded) + (accountsPending ?? 0);
  // New requests per day (borrow + venue) — the pending card's trend line.
  const newRequestsDaily = borrowK.daily.map((v, i) => v + bookingK.daily[i]!);

  // ── equipment health mix ──
  const health = await sql<{ label: string; n: string }>`
    SELECT current_condition_label::text AS label, count(*) AS n
    FROM article WHERE state <> 'DECOMMISSIONED' GROUP BY 1`.execute(db);
  const hm = Object.fromEntries(health.rows.map((r) => [r.label, Number(r.n)]));
  const latestScores = await sql<{ avg: string | null; n: string }>`
    SELECT avg(score) AS avg, count(*) AS n FROM (
      SELECT DISTINCT ON (s.article_id) s.health_score AS score
      FROM health_check_scan s JOIN article a ON a.article_id = s.article_id
      WHERE a.state <> 'DECOMMISSIONED'
      ORDER BY s.article_id, s.scanned_at DESC
    ) t`.execute(db);
  const flags = await sql<{ n: string }>`SELECT count(*) AS n FROM damage_flag WHERE cleared_at IS NULL`.execute(db);
  const cvMix = await sql<{ label: string; n: string }>`
    SELECT cv_label::text AS label, count(*) AS n FROM cv_health_assessment
    WHERE created_at >= (${curFrom}::date)::timestamp AT TIME ZONE ${TZ} GROUP BY 1`.execute(db)
    .catch(() => ({ rows: [] as { label: string; n: string }[] })); // table exists only after migration 030

  // ── recent activity (newest first across sources) ──
  const activity = await sql<{ kind: string; title: string; detail: string; at: Date }>`
    (SELECT 'BORROW_REQUEST' AS kind, 'New borrow request' AS title,
            et.name || ' • by ' || u.full_name AS detail, br.submitted_at AS at
       FROM borrow_request br JOIN equipment_type et ON et.equipment_type_id = br.equipment_type_id
       JOIN app_user u ON u.user_id = br.requested_by
      ORDER BY br.submitted_at DESC LIMIT 8)
    UNION ALL
    (SELECT 'VENUE_BOOKING', 'New venue booking',
            v.name || ' • by ' || coalesce(u.full_name, 'BUKC Sports Department'), b.submitted_at
       FROM booking b JOIN venue v ON v.venue_id = b.venue_id LEFT JOIN app_user u ON u.user_id = b.requested_by
      ORDER BY b.submitted_at DESC LIMIT 8)
    UNION ALL
    (SELECT 'DECISION_' || aa.verb::text,
            CASE aa.subject WHEN 'VENUE_BOOKING' THEN 'Venue booking ' WHEN 'BORROW_REQUEST' THEN 'Borrow request '
                            WHEN 'ACCOUNT_VERIFICATION' THEN 'Account ' ELSE 'Equipment exception ' END
            || CASE aa.verb WHEN 'APPROVE' THEN 'approved' WHEN 'REJECT' THEN 'rejected' WHEN 'FORWARD' THEN 'forwarded'
                            WHEN 'CANCEL' THEN 'cancelled' WHEN 'RETURN_FOR_REEVALUATION' THEN 'sent back' ELSE 'submitted' END,
            coalesce(v.name, et.name, su.full_name, 'Request') || coalesce(' • by ' || actor.full_name, ''),
            aa.occurred_at
       FROM approval_action aa
       LEFT JOIN booking b ON b.booking_id = aa.booking_id LEFT JOIN venue v ON v.venue_id = b.venue_id
       LEFT JOIN borrow_request br ON br.borrow_request_id = aa.borrow_request_id
       LEFT JOIN equipment_type et ON et.equipment_type_id = br.equipment_type_id
       LEFT JOIN app_user su ON su.user_id = aa.subject_user_id
       LEFT JOIN app_user actor ON actor.user_id = aa.actor_id
      WHERE aa.verb <> 'SUBMIT'
      ORDER BY aa.occurred_at DESC LIMIT 8)
    UNION ALL
    (SELECT 'DAMAGE_FLAG', 'Equipment flagged',
            et.name || ' ' || a.barcode || coalesce(' • Health: ' || round(hs.health_score)::text || '%', ''), df.raised_at
       FROM damage_flag df JOIN article a ON a.article_id = df.article_id
       JOIN equipment_type et ON et.equipment_type_id = a.equipment_type_id
       LEFT JOIN health_check_scan hs ON hs.scan_id = df.source_scan_id
      ORDER BY df.raised_at DESC LIMIT 8)
    UNION ALL
    (SELECT 'RETURN', 'Equipment returned', et.name || coalesce(' • by ' || u.full_name, ''), bt.actual_return_at
       FROM borrow_transaction bt JOIN equipment_type et ON et.equipment_type_id = bt.equipment_type_id
       LEFT JOIN app_user u ON u.user_id = bt.borrower_user_id
      WHERE bt.actual_return_at IS NOT NULL
      ORDER BY bt.actual_return_at DESC LIMIT 8)
    ORDER BY at DESC LIMIT 8`.execute(db);

  // ── top sports by activity (borrows + venue sessions in the period) ──
  const sports = await sql<{ sport: string; borrows: string; sessions: string }>`
    WITH b AS (
      SELECT et.sport_category_id AS sid, count(*) AS n
        FROM borrow_transaction bt JOIN equipment_type et ON et.equipment_type_id = bt.equipment_type_id
       WHERE bt.actual_start_at >= (${curFrom}::date)::timestamp AT TIME ZONE ${TZ}
       GROUP BY 1),
    s AS (
      SELECT (SELECT min(vs.sport_category_id) FROM venue_sport vs WHERE vs.venue_id = bs.venue_id) AS sid, count(*) AS n
        FROM booking_session bs
       WHERE lower(bs.slot) >= (${curFrom}::date)::timestamp AT TIME ZONE ${TZ}
         AND lower(bs.slot) < ((${today}::date + 1)::timestamp AT TIME ZONE ${TZ})
         AND bs.status <> 'CANCELLED'
       GROUP BY 1)
    SELECT sc.name AS sport, coalesce(b.n, 0) AS borrows, coalesce(s.n, 0) AS sessions
      FROM sport_category sc LEFT JOIN b ON b.sid = sc.sport_category_id LEFT JOIN s ON s.sid = sc.sport_category_id
     WHERE coalesce(b.n, 0) + coalesce(s.n, 0) > 0
     ORDER BY coalesce(b.n, 0) + coalesce(s.n, 0) DESC, sc.name LIMIT 5`.execute(db);

  // ── pending requests (newest first) ──
  const pending = await sql<{ id: string; type: string; requested_by: string; item: string; status: string; at: Date }>`
    (SELECT br.borrow_request_id::text AS id, 'EQUIPMENT' AS type, u.full_name AS requested_by, et.name AS item,
            'PENDING' AS status, br.submitted_at AS at
       FROM borrow_request br JOIN app_user u ON u.user_id = br.requested_by
       JOIN equipment_type et ON et.equipment_type_id = br.equipment_type_id
      WHERE br.status = 'PENDING')
    UNION ALL
    (SELECT b.booking_id::text, 'VENUE', coalesce(u.full_name, 'BUKC Sports Department'), v.name, b.status::text, b.submitted_at
       FROM booking b JOIN venue v ON v.venue_id = b.venue_id LEFT JOIN app_user u ON u.user_id = b.requested_by
      WHERE b.status IN ('PENDING', 'FORWARDED'))
    UNION ALL
    (SELECT u.user_id::text, 'ACCOUNT', u.full_name,
            CASE u.role WHEN 'STUDENT' THEN 'Student account' ELSE 'External account' END, 'PENDING', u.created_at
       FROM app_user u
      WHERE ${isSuperAdmin} AND u.status = 'PENDING_VERIFICATION' AND u.role IN ('STUDENT', 'EXTERNAL'))
    ORDER BY at DESC LIMIT 6`.execute(db);

  // ── upcoming approved sessions ──
  const upcoming = await sql<{ start: Date; end: Date; title: string; venue: string; sport: string | null; booking_type: string | null }>`
    SELECT lower(bs.slot) AS start, upper(bs.slot) AS end, b.purpose AS title, v.name AS venue,
           (SELECT string_agg(sc.name, ', ' ORDER BY sc.name) FROM venue_sport vs
              JOIN sport_category sc ON sc.sport_category_id = vs.sport_category_id WHERE vs.venue_id = v.venue_id) AS sport,
           b.booking_type::text AS booking_type
      FROM booking_session bs JOIN booking b ON b.booking_id = bs.booking_id JOIN venue v ON v.venue_id = bs.venue_id
     WHERE bs.status = 'SCHEDULED' AND b.status = 'APPROVED' AND lower(bs.slot) >= now()
     ORDER BY lower(bs.slot) LIMIT 4`.execute(db);

  // chart labels: first day of each bucket, e.g. "Nov 5"
  const fmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const labels: string[] = [];
  for (let i = 0; i < curDays.length; i += bucket) labels.push(fmt.format(new Date(`${curDays[i]}T00:00:00Z`)));

  return {
    range: { days, bucketDays: bucket, from: curFrom, to: today, previousFrom: prevFrom, previousTo: prevTo },
    kpis: {
      borrowRequests: { current: borrowK.current, previous: borrowK.previous, daily: borrowK.daily },
      venueBookings: { current: bookingK.current, previous: bookingK.previous, daily: bookingK.daily },
      equipmentUsage: { current: usageK.current, previous: usageK.previous, daily: usageK.daily },
      equipmentItems: {
        total: Number(s.articles), available: Number(s.available),
        addedCurrent: articleK.current, addedPrevious: articleK.previous, daily: articleK.daily,
      },
      pending: {
        total: pendingTotal, borrow: Number(s.borrow_pending), venue: Number(s.venue_pending),
        forwarded: Number(s.venue_forwarded), accounts: accountsPending, daily: newRequestsDaily,
      },
    },
    analytics: {
      labels,
      borrowRequests: { current: bucketize(borrowK.daily, bucket), previous: bucketize(borrowK.prevDaily, bucket) },
      venueBookings: { current: bucketize(bookingK.daily, bucket), previous: bucketize(bookingK.prevDaily, bucket) },
      equipmentUsage: { current: bucketize(usageK.daily, bucket), previous: bucketize(usageK.prevDaily, bucket) },
    },
    health: {
      good: hm.GOOD ?? 0, worn: hm.WORN ?? 0, damaged: hm.DAMAGED ?? 0,
      averageScore: latestScores.rows[0]?.avg == null ? null : Math.round(Number(latestScores.rows[0].avg)),
      scannedArticles: Number(latestScores.rows[0]?.n ?? 0),
      openFlags: Number(flags.rows[0]?.n ?? 0),
      cvScansInPeriod: Object.fromEntries(cvMix.rows.map((r) => [r.label, Number(r.n)])),
    },
    activity: activity.rows.map((r) => ({ kind: r.kind, title: r.title, detail: r.detail, at: r.at })),
    topSports: sports.rows.map((r) => ({ sport: r.sport, borrows: Number(r.borrows), sessions: Number(r.sessions) })),
    pending: pending.rows.map((r) => ({ id: r.id, type: r.type, requestedBy: r.requested_by, item: r.item, status: r.status, at: r.at })),
    upcoming: upcoming.rows.map((r) => ({ start: r.start, end: r.end, title: r.title, venue: r.venue, sport: r.sport, bookingType: r.booking_type })),
  };
}

export const dashboardInsightsRouter = Router();

dashboardInsightsRouter.get(
  '/',
  requireAuth,
  requireRole('SUPER_ADMIN', 'COORDINATOR'),
  asyncHandler(async (req, res) => {
    const n = Number(req.query.days ?? 30);
    const days = (ALLOWED_DAYS as readonly number[]).includes(n) ? (n as Days) : 30;
    res.json(await getInsights(days, req.user!.role === 'SUPER_ADMIN'));
  }),
);
