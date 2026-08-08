/**
 * Usage History service (Feature 10).
 *
 * Write path: borrow/service.ts writes EQUIPMENT_BORROW rows on every terminal
 * return; venue/service.ts writes VENUE_SESSION rows on completeSession /
 * cancelSession. This file is the read side only.
 *
 * HIST-05 makes the table immutable — no mutations here.
 */
import { db } from '../../db/index.js';
import type { UserRole } from '../../db/index.js';

export interface HistoryFilter {
  from?: string;
  to?: string;
  kind?: 'VENUE_SESSION' | 'EQUIPMENT_BORROW';
  outcome?: string;
  sportCategoryId?: number;
  actorUserId?: string;
  // OFFL-17: filter by the "Entered via Offline Fallback" flag
  offlineFallback?: 'true' | 'false';
  limit?: number;
  offset?: number;
}

export interface HistoryRow {
  historyId: number;
  kind: 'VENUE_SESSION' | 'EQUIPMENT_BORROW';
  occurredOn: string;
  recordedAt: string;
  outcome: string;
  borrowTxnId: string | null;
  equipmentTypeName: string | null;
  borrowerName: string | null;
  guestName: string | null;
  sessionId: string | null;
  venueName: string | null;
  teamName: string | null;
  sportCategoryName: string | null;
  enteredViaOfflineFallback: boolean;
}

export async function listHistory(
  callerId: string,
  callerRole: UserRole,
  filter: HistoryFilter,
): Promise<{ rows: HistoryRow[]; total: number }> {
  const limit = Math.min(filter.limit ?? 50, 200);
  const offset = filter.offset ?? 0;
  const isStaff = callerRole === 'SUPER_ADMIN' || callerRole === 'COORDINATOR';

  // ── count ──
  // Build a fresh base for the count so we don't need clearSelect.
  let countQ = db.selectFrom('usage_history').select(db.fn.countAll<number>().as('n'));

  if (!isStaff) countQ = countQ.where('actor_user_id', '=', callerId);
  if (callerRole === 'EXTERNAL') countQ = countQ.where('kind', '=', 'VENUE_SESSION');
  if (isStaff && filter.actorUserId) countQ = countQ.where('actor_user_id', '=', filter.actorUserId);
  if (filter.kind) countQ = countQ.where('kind', '=', filter.kind);
  if (filter.from) countQ = countQ.where('occurred_on', '>=', filter.from);
  if (filter.to) countQ = countQ.where('occurred_on', '<=', filter.to);
  if (filter.outcome) countQ = countQ.where('outcome', '=', filter.outcome);
  if (filter.sportCategoryId) countQ = countQ.where('sport_category_id', '=', filter.sportCategoryId);
  // OFFL-17
  if (filter.offlineFallback === 'true')  countQ = countQ.where('entered_via_offline_fallback', '=', true);
  if (filter.offlineFallback === 'false') countQ = countQ.where('entered_via_offline_fallback', '=', false);

  const countRow = await countQ.executeTakeFirstOrThrow();
  const total = Number(countRow.n);

  if (total === 0) return { rows: [], total: 0 };

  // ── data ──
  let dataQ = db
    .selectFrom('usage_history')
    .leftJoin('app_user as bu', 'bu.user_id', 'usage_history.actor_user_id')
    .leftJoin('guest_borrower as gb', 'gb.guest_borrower_id', 'usage_history.guest_borrower_id')
    .leftJoin('equipment_type as et', 'et.equipment_type_id', 'usage_history.equipment_type_id')
    .leftJoin('booking_session as bs', 'bs.session_id', 'usage_history.session_id')
    .leftJoin('venue as v', 'v.venue_id', 'usage_history.venue_id')
    .leftJoin('sport_category as sc', 'sc.sport_category_id', 'usage_history.sport_category_id')
    .leftJoin('session_participant as sp', (join) =>
      join.onRef('sp.session_id', '=', 'bs.session_id').on('sp.is_team_contact', '=', true),
    )
    .select([
      'usage_history.history_id',
      'usage_history.kind',
      'usage_history.occurred_on',
      'usage_history.recorded_at',
      'usage_history.outcome',
      'usage_history.borrow_txn_id',
      'et.name as equipment_type_name',
      'bu.full_name as borrower_name',
      'gb.full_name as guest_name',
      'usage_history.session_id',
      'v.name as venue_name',
      'sp.team_name',
      'usage_history.entered_via_offline_fallback',
      'sc.name as sport_category_name',
    ]);

  // Mirror the same predicates on the data query
  if (!isStaff) dataQ = dataQ.where('usage_history.actor_user_id', '=', callerId);
  if (callerRole === 'EXTERNAL') dataQ = dataQ.where('usage_history.kind', '=', 'VENUE_SESSION');
  if (isStaff && filter.actorUserId) dataQ = dataQ.where('usage_history.actor_user_id', '=', filter.actorUserId);
  if (filter.kind) dataQ = dataQ.where('usage_history.kind', '=', filter.kind);
  if (filter.from) dataQ = dataQ.where('usage_history.occurred_on', '>=', filter.from);
  if (filter.to) dataQ = dataQ.where('usage_history.occurred_on', '<=', filter.to);
  if (filter.outcome) dataQ = dataQ.where('usage_history.outcome', '=', filter.outcome);
  if (filter.sportCategoryId) dataQ = dataQ.where('usage_history.sport_category_id', '=', filter.sportCategoryId);
  // OFFL-17
  if (filter.offlineFallback === 'true')  dataQ = dataQ.where('usage_history.entered_via_offline_fallback', '=', true);
  if (filter.offlineFallback === 'false') dataQ = dataQ.where('usage_history.entered_via_offline_fallback', '=', false);

  const rawRows = await dataQ
    .orderBy('usage_history.recorded_at', 'desc')  // HIST-14
    .limit(limit)
    .offset(offset)
    .execute();

  const rows: HistoryRow[] = rawRows.map((r) => ({
    historyId: Number(r.history_id),
    kind: r.kind as 'VENUE_SESSION' | 'EQUIPMENT_BORROW',
    occurredOn: String(r.occurred_on),
    recordedAt: String(r.recorded_at),
    outcome: r.outcome,
    borrowTxnId: r.borrow_txn_id ?? null,
    equipmentTypeName: r.equipment_type_name ?? null,
    borrowerName: r.borrower_name ?? null,
    guestName: r.guest_name ?? null,
    sessionId: r.session_id ?? null,
    venueName: r.venue_name ?? null,
    teamName: r.team_name ?? null,
    sportCategoryName: r.sport_category_name ?? null,
    enteredViaOfflineFallback: Boolean(r.entered_via_offline_fallback),
  }));

  return { rows, total };
}
