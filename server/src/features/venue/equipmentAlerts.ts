/**
 * Equipment Alerts — corrected logic for the Coordinator's "needs attention"
 * list of event equipment (EQUIP-AVAIL-13/14/15/21).
 *
 * WHAT COUNTS AS AN ALERT
 * An event's equipment is locked 24 hours before it starts. A locked line
 * needs attention when either:
 *   1. SHORT — there are not enough ready (AVAILABLE) units for it. Ready
 *      units of a type are shared out to locked events earliest-first, so an
 *      event's own reservation is never counted against itself (this was the
 *      old bug: the page compared the need with what was left AFTER the
 *      event's own lock, so almost every locked event showed as short).
 *   2. PROBLEM ARTICLES — a specific article the coordinator picked for the
 *      event has since been lent out, damaged or retired.
 *
 * HOW THE COORDINATOR FIXES IT
 *   • Swap      — replace a problem article with a ready one of the same
 *                 type. The booking's picked-article list is updated, so the
 *                 alert clears. Permanent record (article_swap).
 *   • Reduce    — lower the quantity to what can be supplied (reason needed).
 *   • Self-managed — the organiser brings this equipment; the reservation is
 *                 released back to the pool (reason needed).
 * Every fix notifies the organiser and the Super Admin.
 *
 * No database migration is needed — only existing tables are used.
 */
import { sql } from 'kysely';
import { db, isPgError, type NotificationType } from '../../db/index.js';
import { AppError, badRequest, conflict, notFound } from '../../middleware/errors.js';
import { sendEmail } from '../../lib/email.js';

type Picked = Array<{ equipmentTypeId: number; articleIds: string[] }>;

function parsePicked(v: unknown): Picked {
  if (!v) return [];
  try {
    const arr = (typeof v === 'string' ? JSON.parse(v) : v) as Picked;
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

function mapDbError(e: unknown): AppError {
  if (isPgError(e)) {
    if (e.code === 'P0001') return new AppError(422, e.message.replace(/^ERROR:\s*/i, ''), 'RULE');
    if (e.code === '23503') return badRequest('Referenced item does not exist.', 'FK');
  }
  if (e instanceof AppError) return e;
  console.error('Equipment alert action failed:', e);
  return new AppError(500, 'Equipment alert action failed');
}

async function notifyRole(role: 'COORDINATOR' | 'SUPER_ADMIN', type: NotificationType, title: string, body: string, bookingId: string | null) {
  const staff = await db.selectFrom('app_user').select('user_id').where('role', '=', role).where('status', '=', 'ACTIVE').execute();
  if (staff.length === 0) return;
  await db.insertInto('notification').values(
    staff.map((s) => ({ recipient_id: s.user_id, type, title, body, booking_id: bookingId })),
  ).execute();
}
async function notifyOrganiser(userId: string | null, type: NotificationType, title: string, body: string, bookingId: string) {
  if (!userId) return; // academic (internal) bookings have no external organiser
  const u = await db.selectFrom('app_user').select('email').where('user_id', '=', userId).executeTakeFirst();
  await db.insertInto('notification').values({ recipient_id: userId, type, title, body, booking_id: bookingId }).execute();
  if (u) sendEmail({ to: u.email, subject: title, html: `<p>${body}</p>`, text: body }).catch((e) => console.error('alert email failed:', e));
}

const fmtWhen = (d: Date) =>
  d.toLocaleString('en-GB', { timeZone: 'Asia/Karachi', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });

// ─── Read model ───────────────────────────────────────────────────────────────

export interface ProblemArticle { article_id: string; barcode: string; state: string }
export interface EquipmentAlert {
  allocation_id: string; booking_id: string; session_id: string; session_no: number;
  purpose: string; organiser: string; venue_name: string; start_at: string; end_at: string;
  equipment_type_id: number; equipment_type_name: string; lending_unit: 'SINGLE' | 'PAIR';
  quantity: number; covered: number; short: number;
  problems: ProblemArticle[];
  picked_count: number;
  picked_ids: string[];
}

/** Locked, still-reserved, organisation-supplied lines of upcoming/ongoing sessions. */
async function activeLockedLines() {
  return db.selectFrom('event_equipment_allocation as ea')
    .innerJoin('booking_session as bs', 'bs.session_id', 'ea.session_id')
    .innerJoin('booking as b', 'b.booking_id', 'bs.booking_id')
    .innerJoin('venue as v', 'v.venue_id', 'bs.venue_id')
    .innerJoin('equipment_type as et', 'et.equipment_type_id', 'ea.equipment_type_id')
    .leftJoin('app_user as u', 'u.user_id', 'b.requested_by')
    .select([
      'ea.allocation_id', 'ea.equipment_type_id', 'ea.quantity',
      'bs.session_id', 'bs.session_no', 'b.booking_id', 'b.purpose', 'b.requested_by', 'b.coordinator_selected_articles',
      'v.name as venue_name', 'et.name as equipment_type_name', 'et.lending_unit',
      sql<string | null>`u.full_name`.as('organiser_name'),
      sql<Date>`lower(bs.slot)`.as('start_at'),
      sql<Date>`upper(bs.slot)`.as('end_at'),
    ])
    .where('ea.locked_at', 'is not', null)
    .where('ea.released_at', 'is', null)
    .where('ea.is_self_managed', '=', false)
    .where('bs.status', 'in', ['SCHEDULED', 'IN_PROGRESS'])
    .orderBy(sql`lower(bs.slot)`, 'asc')
    .orderBy('ea.allocation_id', 'asc')
    .execute();
}

/** Ready units per type (pairs count as one unit for pair-based types). */
async function readyUnitsByType(typeIds: number[]): Promise<Map<number, number>> {
  const m = new Map<number, number>();
  if (typeIds.length === 0) return m;
  const rows = await db.selectFrom('article as a')
    .innerJoin('equipment_type as et', 'et.equipment_type_id', 'a.equipment_type_id')
    .select(['a.equipment_type_id', 'et.lending_unit', sql<string>`count(*)`.as('n')])
    .where('a.state', '=', 'AVAILABLE')
    .where('a.equipment_type_id', 'in', typeIds)
    .groupBy(['a.equipment_type_id', 'et.lending_unit'])
    .execute();
  for (const r of rows) m.set(r.equipment_type_id, r.lending_unit === 'PAIR' ? Math.floor(Number(r.n) / 2) : Number(r.n));
  return m;
}

export async function listEquipmentAlerts(): Promise<EquipmentAlert[]> {
  const lines = await activeLockedLines();
  if (lines.length === 0) return [];

  // 1. Share ready units out to locked events, earliest event first.
  const pool = await readyUnitsByType([...new Set(lines.map((l) => l.equipment_type_id))]);
  const covered = new Map<string, number>();
  for (const l of lines) {
    const left = pool.get(l.equipment_type_id) ?? 0;
    const c = Math.min(l.quantity, left);
    covered.set(l.allocation_id, c);
    pool.set(l.equipment_type_id, left - c);
  }

  // 2. Picked articles that are no longer ready.
  const pickedFor = (l: (typeof lines)[number]) =>
    parsePicked(l.coordinator_selected_articles).find((p) => p.equipmentTypeId === l.equipment_type_id)?.articleIds ?? [];
  const allPicked = [...new Set(lines.flatMap(pickedFor))];
  const states = new Map<string, { barcode: string; state: string }>();
  if (allPicked.length > 0) {
    const rows = await db.selectFrom('article').select(['article_id', 'barcode', 'state']).where('article_id', 'in', allPicked).execute();
    for (const r of rows) states.set(r.article_id, { barcode: r.barcode, state: r.state });
  }

  const out: EquipmentAlert[] = [];
  for (const l of lines) {
    const picked = pickedFor(l);
    const problems = picked
      .map((id) => ({ article_id: id, ...(states.get(id) ?? { barcode: 'Unknown', state: 'MISSING' }) }))
      .filter((a) => a.state !== 'AVAILABLE');
    const c = covered.get(l.allocation_id) ?? 0;
    const short = l.quantity - c;
    if (short <= 0 && problems.length === 0) continue;
    out.push({
      allocation_id: l.allocation_id, booking_id: l.booking_id, session_id: l.session_id, session_no: l.session_no,
      purpose: l.purpose, organiser: l.organiser_name ?? 'BUKC Sports Department', venue_name: l.venue_name,
      start_at: new Date(l.start_at).toISOString(), end_at: new Date(l.end_at).toISOString(),
      equipment_type_id: l.equipment_type_id, equipment_type_name: l.equipment_type_name, lending_unit: l.lending_unit,
      quantity: l.quantity, covered: c, short, problems, picked_count: picked.length, picked_ids: picked,
    });
  }
  return out;
}

export async function countEquipmentAlerts(): Promise<number> {
  return (await listEquipmentAlerts()).length;
}

/** Recent fixes: swaps (permanent log) and lines switched to self-managed after locking. */
export async function listRecentFixes() {
  const swaps = await db.selectFrom('article_swap as s')
    .innerJoin('event_equipment_allocation as ea', 'ea.allocation_id', 's.allocation_id')
    .innerJoin('booking_session as bs', 'bs.session_id', 'ea.session_id')
    .innerJoin('booking as b', 'b.booking_id', 'bs.booking_id')
    .innerJoin('venue as v', 'v.venue_id', 'bs.venue_id')
    .innerJoin('equipment_type as et', 'et.equipment_type_id', 'ea.equipment_type_id')
    .innerJoin('article as ao', 'ao.article_id', 's.outgoing_article_id')
    .innerJoin('article as ai', 'ai.article_id', 's.incoming_article_id')
    .innerJoin('app_user as p', 'p.user_id', 's.performed_by')
    .select([
      's.swap_id as id', 's.performed_at as at', 's.reason', 'b.purpose', 'v.name as venue_name',
      'et.name as equipment_type_name', 'ao.barcode as outgoing_barcode', 'ai.barcode as incoming_barcode',
      'p.full_name as performed_by', sql<Date>`lower(bs.slot)`.as('start_at'),
    ])
    .where(sql<boolean>`s.performed_at >= now() - interval '30 days'`)
    .orderBy('s.performed_at', 'desc')
    .limit(20)
    .execute();

  const selfManaged = await db.selectFrom('event_equipment_allocation as ea')
    .innerJoin('booking_session as bs', 'bs.session_id', 'ea.session_id')
    .innerJoin('booking as b', 'b.booking_id', 'bs.booking_id')
    .innerJoin('venue as v', 'v.venue_id', 'bs.venue_id')
    .innerJoin('equipment_type as et', 'et.equipment_type_id', 'ea.equipment_type_id')
    .select([
      'ea.allocation_id as id', 'ea.released_at as at', 'ea.quantity', 'b.purpose', 'v.name as venue_name',
      'et.name as equipment_type_name', sql<Date>`lower(bs.slot)`.as('start_at'),
    ])
    .where('ea.is_self_managed', '=', true)
    .where('ea.locked_at', 'is not', null)
    .where(sql<boolean>`upper(bs.slot) >= now() - interval '30 days'`)
    .orderBy('ea.released_at', 'desc')
    .limit(20)
    .execute();

  return [
    ...swaps.map((s) => ({ kind: 'SWAP' as const, ...s })),
    ...selfManaged.map((s) => ({ kind: 'SELF_MANAGED' as const, ...s })),
  ].sort((a, b) => new Date(String(b.at ?? 0)).getTime() - new Date(String(a.at ?? 0)).getTime());
}

// ─── Actions ──────────────────────────────────────────────────────────────────

async function loadActiveLine(allocationId: string) {
  const l = await db.selectFrom('event_equipment_allocation as ea')
    .innerJoin('booking_session as bs', 'bs.session_id', 'ea.session_id')
    .innerJoin('booking as b', 'b.booking_id', 'bs.booking_id')
    .innerJoin('venue as v', 'v.venue_id', 'bs.venue_id')
    .innerJoin('equipment_type as et', 'et.equipment_type_id', 'ea.equipment_type_id')
    .select([
      'ea.allocation_id', 'ea.equipment_type_id', 'ea.quantity', 'ea.locked_at', 'ea.released_at', 'ea.is_self_managed',
      'bs.status as session_status', 'b.booking_id', 'b.purpose', 'b.requested_by', 'b.coordinator_selected_articles',
      'v.name as venue_name', 'et.name as equipment_type_name', sql<Date>`lower(bs.slot)`.as('start_at'),
    ])
    .where('ea.allocation_id', '=', allocationId)
    .executeTakeFirst();
  if (!l) throw notFound('Equipment line not found.');
  if (l.released_at || l.is_self_managed || !['SCHEDULED', 'IN_PROGRESS'].includes(l.session_status)) {
    throw conflict('This equipment line is no longer active.', 'NOT_ACTIVE');
  }
  return l;
}

export async function swapArticle(allocationId: string, coordinatorId: string, input: {
  outgoingArticleId: string; incomingArticleId: string; reason?: string;
}) {
  const l = await loadActiveLine(allocationId);
  const picked = parsePicked(l.coordinator_selected_articles);
  const entry = picked.find((p) => p.equipmentTypeId === l.equipment_type_id);
  if (!entry || !entry.articleIds.includes(input.outgoingArticleId)) {
    throw badRequest('The outgoing article is not one of the articles picked for this event.', 'NOT_PICKED');
  }
  if (entry.articleIds.includes(input.incomingArticleId)) {
    throw badRequest('That article is already picked for this event.', 'ALREADY_PICKED');
  }
  const [out, inc] = await Promise.all([
    db.selectFrom('article').select(['barcode', 'state', 'equipment_type_id']).where('article_id', '=', input.outgoingArticleId).executeTakeFirst(),
    db.selectFrom('article').select(['barcode', 'state', 'equipment_type_id']).where('article_id', '=', input.incomingArticleId).executeTakeFirst(),
  ]);
  if (!out || !inc) throw notFound('Article not found.');
  if (out.state === 'AVAILABLE') throw badRequest('The outgoing article is ready — only lent-out, damaged or retired articles need swapping.', 'OUT_READY');
  if (inc.equipment_type_id !== l.equipment_type_id) throw badRequest(`The replacement must also be a ${l.equipment_type_name}.`, 'WRONG_TYPE');
  if (inc.state !== 'AVAILABLE') throw conflict('The replacement article is not available any more.', 'IN_NOT_READY');

  try {
    await db.transaction().execute(async (trx) => {
      await trx.insertInto('article_swap').values({
        allocation_id: allocationId, outgoing_article_id: input.outgoingArticleId,
        incoming_article_id: input.incomingArticleId, performed_by: coordinatorId, reason: input.reason?.trim() || null,
      }).execute();
      const next = picked.map((p) => p.equipmentTypeId !== l.equipment_type_id ? p : {
        ...p, articleIds: p.articleIds.map((id) => (id === input.outgoingArticleId ? input.incomingArticleId : id)),
      });
      await trx.updateTable('booking').set({ coordinator_selected_articles: JSON.stringify(next) })
        .where('booking_id', '=', l.booking_id).execute();
    });
  } catch (e) { throw mapDbError(e); }

  const when = fmtWhen(new Date(l.start_at));
  await notifyRole('SUPER_ADMIN', 'SWAP_NOTICE_SUPERADMIN', 'Article swap performed',
    `${l.equipment_type_name} ${out.barcode} was swapped for ${inc.barcode} for "${l.purpose}" at ${l.venue_name} (${when}).${input.reason ? ` Reason: ${input.reason.trim()}` : ''}`, l.booking_id);
  await notifyOrganiser(l.requested_by, 'SWAP_PERFORMED', 'Equipment updated for your event',
    `One ${l.equipment_type_name} for "${l.purpose}" (${when}) was replaced with another ready item. Nothing changes for you.`, l.booking_id);
  return { outgoing: out.barcode, incoming: inc.barcode };
}

export async function reduceQuantity(allocationId: string, coordinatorId: string, input: { quantity: number; reason: string }) {
  const l = await loadActiveLine(allocationId);
  if (input.quantity >= l.quantity) throw badRequest(`The new quantity must be lower than ${l.quantity}.`, 'NOT_LOWER');
  try {
    await db.updateTable('event_equipment_allocation').set({ quantity: input.quantity })
      .where('allocation_id', '=', allocationId).execute();
  } catch (e) { throw mapDbError(e); }
  void coordinatorId;
  const when = fmtWhen(new Date(l.start_at));
  await notifyOrganiser(l.requested_by, 'EQUIPMENT_SHORTFALL', 'Equipment quantity reduced for your event',
    `We can supply ${input.quantity} of the ${l.quantity} ${l.equipment_type_name} for "${l.purpose}" (${when}). Reason: ${input.reason.trim()}`, l.booking_id);
  await notifyRole('SUPER_ADMIN', 'INVENTORY_ACTION', 'Event equipment quantity reduced',
    `${l.equipment_type_name} for "${l.purpose}" at ${l.venue_name} (${when}) reduced from ${l.quantity} to ${input.quantity}. Reason: ${input.reason.trim()}`, l.booking_id);
  return { from: l.quantity, to: input.quantity };
}

export async function markSelfManaged(allocationId: string, coordinatorId: string, input: { reason: string }) {
  const l = await loadActiveLine(allocationId);
  try {
    // Releasing the reservation returns these units to the shared pool.
    await db.updateTable('event_equipment_allocation').set({ is_self_managed: true, released_at: new Date() })
      .where('allocation_id', '=', allocationId).execute();
  } catch (e) { throw mapDbError(e); }
  void coordinatorId;
  const when = fmtWhen(new Date(l.start_at));
  await notifyOrganiser(l.requested_by, 'EQUIPMENT_SHORTFALL', 'Please bring your own equipment',
    `The sports office cannot supply ${l.quantity} ${l.equipment_type_name} for "${l.purpose}" (${when}). Please arrange this equipment yourself. Reason: ${input.reason.trim()}`, l.booking_id);
  await notifyRole('SUPER_ADMIN', 'INVENTORY_ACTION', 'Event equipment switched to self-managed',
    `${l.quantity} ${l.equipment_type_name} for "${l.purpose}" at ${l.venue_name} (${when}) will be brought by the organiser. Reason: ${input.reason.trim()}`, l.booking_id);
  return { released: l.quantity };
}
