/**
 * Borrow & Return service (Feature 3). Two intake paths (BORROW-07): PLATFORM
 * (student requests, Coordinator approves, then lends against the approved
 * request) and WALK_IN (Coordinator lends directly, registered student or
 * unregistered guest). The DB triggers enforce the hard invariants (BORROW-03
 * article-count-per-lending-unit, BORROW-07/09 request↔transaction coherence,
 * one-active-borrow, staff-only); this service orchestrates the workflow,
 * notifications, and the late-return / reputation logic layered on top.
 */
import { sql } from 'kysely';
import { db, isPgError, type ConditionLabel } from '../../db/index.js';
import { AppError, badRequest, notFound, conflict } from '../../middleware/errors.js';
import { sendEmail } from '../../lib/email.js';

function mapDbError(e: unknown): AppError {
  if (isPgError(e)) {
    if (e.code === 'P0001') return new AppError(422, e.message.replace(/^ERROR:\s*/i, ''), 'RULE');
    if (e.code === '23505') {
      if (e.constraint === 'uq_one_open_borrow_request') {
        return conflict('You already have a pending request. Wait for it to be reviewed before submitting another.', 'DUPLICATE');
      }
      return conflict('That conflicts with an existing record.', 'DUPLICATE');
    }
    if (e.code === '23503') return badRequest('Referenced item does not exist.', 'FK');
  }
  if (e instanceof AppError) return e;
  console.error('Borrow operation failed:', e);
  return new AppError(500, 'Borrow operation failed');
}

const BAD_SPORT_THRESHOLD = 3; // informational only — BORROW-19: no automatic punitive action

// ── notifications (in-app row + optional email) ──
async function notifyStaff(type: import('../../db/index.js').NotificationType, title: string, body: string, refs: Partial<{
  borrowRequestId: string; borrowTxnId: string; subjectUserId: string; articleId: string;
}> = {}) {
  const staff = await db.selectFrom('app_user').select('user_id')
    .where('role', 'in', ['COORDINATOR', 'SUPER_ADMIN']).where('status', '=', 'ACTIVE').execute();
  if (staff.length === 0) return;
  await db.insertInto('notification').values(
    staff.map((s) => ({
      recipient_id: s.user_id, type, title, body,
      borrow_request_id: refs.borrowRequestId ?? null,
      borrow_txn_id: refs.borrowTxnId ?? null,
      subject_user_id: refs.subjectUserId ?? null,
      article_id: refs.articleId ?? null,
    })),
  ).execute();
}

async function notifyStudent(type: import('../../db/index.js').NotificationType, userId: string, title: string, body: string, refs: Partial<{
  borrowRequestId: string; borrowTxnId: string;
}> = {}) {
  const user = await db.selectFrom('app_user').select(['email', 'full_name'])
    .where('user_id', '=', userId).executeTakeFirst();
  await db.insertInto('notification').values({
    recipient_id: userId, type, title, body,
    borrow_request_id: refs.borrowRequestId ?? null,
    borrow_txn_id: refs.borrowTxnId ?? null,
  }).execute();
  if (user) {
    sendEmail({ to: user.email, subject: title, html: `<p>${body}</p>`, text: body })
      .catch((e) => console.error('notifyStudent email failed:', e));
  }
}

// ── reputation ──
export async function getReputation(userId: string) {
  const row = await db.selectFrom('v_client_reputation').selectAll()
    .where('user_id', '=', userId).executeTakeFirst();
  const lateReturns = row ? Number(row.late_returns) : 0;
  return {
    totalBorrows: row ? Number(row.total_borrows) : 0,
    lateReturns,
    damagedReturns: row ? Number(row.damaged_returns) : 0,
    lastLateReturn: row?.last_late_return ?? null,
    isBadSport: lateReturns >= BAD_SPORT_THRESHOLD,
  };
}

// ── requests (BORROW-01..14) ──
export async function submitRequest(studentId: string, input: {
  equipmentTypeId: number; requestedStartAt: string; requestedReturnAt: string;
}) {
  // BORROW-13: 30-minute cooldown after a rejection.
  const lastRejected = await db.selectFrom('borrow_request').select('decided_at')
    .where('requested_by', '=', studentId).where('status', '=', 'REJECTED')
    .orderBy('decided_at', 'desc').limit(1).executeTakeFirst();
  if (lastRejected?.decided_at) {
    const cooldownEnds = new Date(lastRejected.decided_at).getTime() + 30 * 60_000;
    if (Date.now() < cooldownEnds) {
      throw conflict(`You can resubmit in ${Math.ceil((cooldownEnds - Date.now()) / 60000)} minute(s).`, 'COOLDOWN');
    }
  }

  // BORROW-14: cannot request equipment with zero available units.
  // Archived types are excluded from the availability checker, but guard here
  // too in case of a direct API call with a stale/known type id.
  const type = await db.selectFrom('equipment_type').select(['is_active', 'name', 'max_borrow_duration_minutes'])
    .where('equipment_type_id', '=', input.equipmentTypeId).executeTakeFirst();
  if (!type) throw notFound('Equipment type not found.');
  if (!type.is_active) throw conflict('This equipment type is no longer offered for borrowing.', 'ARCHIVED');

  // Enforce max borrow duration.
  const maxMinutes = type.max_borrow_duration_minutes;
  const requestedMinutes = (new Date(input.requestedReturnAt).getTime() - new Date(input.requestedStartAt).getTime()) / 60_000;
  if (requestedMinutes > maxMinutes) {
    const h = Math.floor(maxMinutes / 60);
    const m = maxMinutes % 60;
    const dur = h > 0 && m > 0 ? `${h}h ${m}m` : h > 0 ? `${h}h` : `${m}m`;
    throw badRequest(`${type.name} can be borrowed for at most ${dur}. Shorten your requested window.`, 'MAX_DURATION');
  }

  const avail = await db.selectFrom('v_article_availability').select('available_units')
    .where('equipment_type_id', '=', input.equipmentTypeId).executeTakeFirst();
  if (!avail || Number(avail.available_units) <= 0) {
    throw conflict('No units of this equipment are currently available.', 'NO_STOCK');
  }

  try {
    const row = await db.insertInto('borrow_request').values({
      requested_by: studentId,
      equipment_type_id: input.equipmentTypeId,
      requested_start_at: input.requestedStartAt,
      requested_return_at: input.requestedReturnAt,
    }).returning('borrow_request_id').executeTakeFirstOrThrow();

    await notifyStaff('QUEUE_NEW_ITEM', 'New equipment borrow request',
      'A student submitted a new equipment borrow request awaiting review.',
      { borrowRequestId: row.borrow_request_id, subjectUserId: studentId });

    return row;
  } catch (e) { throw mapDbError(e); }
}

export async function listMyRequests(studentId: string) {
  return db.selectFrom('borrow_request as br')
    .innerJoin('equipment_type as et', 'et.equipment_type_id', 'br.equipment_type_id')
    .select(['br.borrow_request_id', 'br.status', 'br.requested_start_at', 'br.requested_return_at',
      'br.rejection_reason', 'br.submitted_at', 'et.name as equipment_type_name'])
    .where('br.requested_by', '=', studentId)
    .orderBy('br.submitted_at', 'desc').execute();
}

export async function listQueue() {
  const rows = await db.selectFrom('borrow_request as br')
    .innerJoin('equipment_type as et', 'et.equipment_type_id', 'br.equipment_type_id')
    .innerJoin('app_user as u', 'u.user_id', 'br.requested_by')
    .leftJoin('v_article_availability as va', 'va.equipment_type_id', 'br.equipment_type_id')
    .leftJoin('v_client_reputation as cr', 'cr.user_id', 'br.requested_by')
    .select([
      'br.borrow_request_id', 'br.requested_start_at', 'br.requested_return_at', 'br.submitted_at',
      'br.equipment_type_id', 'et.name as equipment_type_name',
      'u.user_id as student_id', 'u.full_name as student_name', 'u.email as student_email',
      sql<number>`coalesce(va.available_units, 0)`.as('available_units'),
      sql<number>`coalesce(cr.late_returns, 0)`.as('late_returns'),
    ])
    .where('br.status', '=', 'PENDING')
    .orderBy('br.submitted_at', 'asc').execute();

  return rows.map((r) => ({
    ...r,
    available_units: Number(r.available_units),
    is_bad_sport: Number(r.late_returns) >= BAD_SPORT_THRESHOLD,
    late_returns: undefined, // don't leak raw count to client
  }));
}

export async function approveRequest(requestId: string, coordinatorId: string) {
  try {
    const req = await db.selectFrom('borrow_request').select(['requested_by', 'equipment_type_id', 'status'])
      .where('borrow_request_id', '=', requestId).executeTakeFirst();
    if (!req) throw notFound('Request not found.');
    if (req.status !== 'PENDING') throw conflict(`Request is already ${req.status}.`);

    // Check live stock BEFORE approving — don't let a coordinator approve a
    // request only to discover at hand-out time that nothing is available.
    const avail = await db.selectFrom('v_article_availability').select('available_units')
      .where('equipment_type_id', '=', req.equipment_type_id).executeTakeFirst();
    if (!avail || Number(avail.available_units) <= 0) {
      throw conflict(
        'No units of this equipment are currently available to lend. ' +
        'Reject the request (the student will be notified) or leave it pending until stock frees up.',
        'NO_STOCK',
      );
    }

    await db.updateTable('borrow_request')
      .set({ status: 'APPROVED', decided_by: coordinatorId, decided_at: sql`now()` })
      .where('borrow_request_id', '=', requestId).execute();

    await notifyStudent('BORROW_APPROVED', req.requested_by, 'Your borrow request was approved',
      'Bring your ID card to the sports office to collect your equipment.', { borrowRequestId: requestId });
  } catch (e) { throw mapDbError(e); }
}

export async function rejectRequest(requestId: string, coordinatorId: string, reason: string) {
  try {
    const req = await db.selectFrom('borrow_request').select(['requested_by', 'status'])
      .where('borrow_request_id', '=', requestId).executeTakeFirst();
    if (!req) throw notFound('Request not found.');
    if (req.status !== 'PENDING') throw conflict(`Request is already ${req.status}.`);

    await db.updateTable('borrow_request')
      .set({ status: 'REJECTED', decided_by: coordinatorId, decided_at: sql`now()`, rejection_reason: reason })
      .where('borrow_request_id', '=', requestId).execute();

    await notifyStudent('BORROW_REJECTED', req.requested_by, 'Your borrow request was rejected',
      `Reason: ${reason}. You can submit a new request in 30 minutes.`, { borrowRequestId: requestId });
  } catch (e) { throw mapDbError(e); }
}

// ── lending (BORROW-07..11) ──
async function markArticlesOnLoan(trx: import('kysely').Transaction<import('../../db/index.js').DB>, articleIds: string[]) {
  await trx.updateTable('article').set({ state: 'ON_LOAN' })
    .where('article_id', 'in', articleIds).execute();
}

export async function lendPlatform(input: {
  borrowRequestId: string; articleIds: string[]; agreedStartAt: string; agreedReturnAt: string;
}, coordinatorId: string) {
  try {
    const req = await db.selectFrom('borrow_request')
      .select(['requested_by', 'equipment_type_id', 'status'])
      .where('borrow_request_id', '=', input.borrowRequestId).executeTakeFirst();
    if (!req) throw notFound('Request not found.');
    if (req.status !== 'APPROVED') throw conflict('Request must be APPROVED before lending.');

    const txnId = await db.transaction().execute(async (trx) => {
      const txn = await trx.insertInto('borrow_transaction').values({
        path: 'PLATFORM',
        borrow_request_id: input.borrowRequestId,
        borrower_user_id: req.requested_by,
        equipment_type_id: req.equipment_type_id,
        agreed_start_at: input.agreedStartAt,
        agreed_return_at: input.agreedReturnAt,
        lent_by: coordinatorId,
      }).returning('borrow_txn_id').executeTakeFirstOrThrow();

      for (const articleId of input.articleIds) {
        await trx.insertInto('borrow_transaction_article').values({
          borrow_txn_id: txn.borrow_txn_id, article_id: articleId, selection_method: 'BARCODE_SCAN',
        }).execute();
      }
      await markArticlesOnLoan(trx, input.articleIds);
      return txn.borrow_txn_id;
    });

    return { borrowTxnId: txnId };
  } catch (e) { throw mapDbError(e); }
}

export async function lendWalkinGuest(input: {
  guestFullName: string; guestIdNumber: string; guestContactNumber: string; guestIsFaculty: boolean;
  equipmentTypeId: number; articleIds: string[]; agreedStartAt: string; agreedReturnAt: string;
}, coordinatorId: string) {
  try {
    const txnId = await db.transaction().execute(async (trx) => {
      // BORROW-25: every guest transaction is independent — a fresh row each time.
      const guest = await trx.insertInto('guest_borrower').values({
        full_name: input.guestFullName, id_number: input.guestIdNumber,
        contact_number: input.guestContactNumber, is_faculty: input.guestIsFaculty,
      }).returning('guest_borrower_id').executeTakeFirstOrThrow();

      const txn = await trx.insertInto('borrow_transaction').values({
        path: 'WALK_IN',
        guest_borrower_id: guest.guest_borrower_id,
        equipment_type_id: input.equipmentTypeId,
        agreed_start_at: input.agreedStartAt,
        agreed_return_at: input.agreedReturnAt,
        lent_by: coordinatorId,
      }).returning('borrow_txn_id').executeTakeFirstOrThrow();
      for (const articleId of input.articleIds) {
        await trx.insertInto('borrow_transaction_article').values({
          borrow_txn_id: txn.borrow_txn_id, article_id: articleId, selection_method: 'MANUAL_SELECT',
        }).execute();
      }
      await markArticlesOnLoan(trx, input.articleIds);
      return txn.borrow_txn_id;
    });
    return { borrowTxnId: txnId };
  } catch (e) { throw mapDbError(e); }
}

export async function listActiveBorrows() {
  return db.selectFrom('borrow_transaction as bt')
    .innerJoin('equipment_type as et', 'et.equipment_type_id', 'bt.equipment_type_id')
    .leftJoin('app_user as u', 'u.user_id', 'bt.borrower_user_id')
    .leftJoin('guest_borrower as g', 'g.guest_borrower_id', 'bt.guest_borrower_id')
    .select(['bt.borrow_txn_id', 'bt.status', 'bt.agreed_return_at', 'bt.actual_start_at',
      'et.name as equipment_type_name', 'u.full_name as borrower_name', 'g.full_name as guest_name'])
    .where('bt.status', 'in', ['ACTIVE', 'OVERDUE', 'INCOMPLETE'])
    .orderBy('bt.agreed_return_at', 'asc').execute();
}

export async function getTransactionDetail(txnId: string) {
  const txn = await db.selectFrom('borrow_transaction as bt')
    .innerJoin('equipment_type as et', 'et.equipment_type_id', 'bt.equipment_type_id')
    .leftJoin('app_user as u', 'u.user_id', 'bt.borrower_user_id')
    .leftJoin('guest_borrower as g', 'g.guest_borrower_id', 'bt.guest_borrower_id')
    .select(['bt.borrow_txn_id', 'bt.path', 'bt.status', 'bt.agreed_start_at', 'bt.agreed_return_at',
      'bt.actual_start_at', 'bt.actual_return_at', 'bt.equipment_type_id', 'et.name as equipment_type_name',
      'et.lending_unit', 'bt.borrower_user_id', 'u.full_name as borrower_name', 'g.full_name as guest_name'])
    .where('bt.borrow_txn_id', '=', txnId).executeTakeFirst();
  if (!txn) throw notFound('Transaction not found.');

  const articles = await db.selectFrom('borrow_transaction_article as bta')
    .innerJoin('article as a', 'a.article_id', 'bta.article_id')
    .select(['bta.article_id', 'a.barcode', 'bta.returned_at', 'bta.return_condition'])
    .where('bta.borrow_txn_id', '=', txnId).execute();

  return { ...txn, articles };
}

// ── return (BORROW-20..24) ──
function scoreToLabel(score: number, good = 70, worn = 40): ConditionLabel {
  if (score >= good) return 'GOOD';
  if (score >= worn) return 'WORN';
  return 'DAMAGED';
}

export async function returnArticles(txnId: string, input: {
  articleIds: string[]; mode: 'scan' | 'manual' | 'dismiss'; score?: number; label?: ConditionLabel;
}, coordinatorId: string) {
  try {
    const txn = await db.selectFrom('borrow_transaction')
      .select(['status', 'agreed_return_at', 'equipment_type_id', 'borrower_user_id'])
      .where('borrow_txn_id', '=', txnId).executeTakeFirst();
    if (!txn) throw notFound('Transaction not found.');
    if (!['ACTIVE', 'OVERDUE', 'INCOMPLETE'].includes(txn.status)) {
      throw conflict(`Transaction is already ${txn.status}.`);
    }

    let label: ConditionLabel;
    if (input.mode === 'scan') {
      const type = await db.selectFrom('equipment_type')
        .select(['condition_good_min_score', 'condition_worn_min_score'])
        .where('equipment_type_id', '=', txn.equipment_type_id).executeTakeFirst();
      label = scoreToLabel(input.score!, Number(type?.condition_good_min_score ?? 70), Number(type?.condition_worn_min_score ?? 40));
    } else if (input.mode === 'manual') {
      label = input.label!;
    } else {
      label = 'GOOD'; // dismiss: condition left unverified — article's prior label is kept, see below
    }

    await db.transaction().execute(async (trx) => {
      for (const articleId of input.articleIds) {
        await trx.updateTable('borrow_transaction_article')
          .set({ returned_at: sql`now()`, return_condition: input.mode === 'dismiss' ? null : label })
          .where('borrow_txn_id', '=', txnId).where('article_id', '=', articleId).execute();
      }

      if (input.mode === 'dismiss') {
        // Condition is left unverified — article state returns to AVAILABLE
        // without touching its current_condition_label (no scan/manual entry).
        await trx.updateTable('article').set({ state: 'AVAILABLE' })
          .where('article_id', 'in', input.articleIds).where('state', '=', 'ON_LOAN').execute();
      } else if (label === 'DAMAGED') {
        await trx.updateTable('article').set({ state: 'DAMAGED', current_condition_label: 'DAMAGED' })
          .where('article_id', 'in', input.articleIds).execute();
        for (const articleId of input.articleIds) {
          await trx.insertInto('damage_flag').values({ article_id: articleId, raised_by_system: true }).execute();
        }
      } else {
        await trx.updateTable('article').set({ state: 'AVAILABLE', current_condition_label: label })
          .where('article_id', 'in', input.articleIds).execute();
      }

      if (input.mode === 'scan') {
        for (const articleId of input.articleIds) {
          await trx.insertInto('health_check_scan').values({
            article_id: articleId, kind: 'AD_HOC', source: 'MANUAL',
            health_score: input.score!, resulting_label: label, scanned_by: coordinatorId,
          }).execute();
        }
      }
    });

    // BORROW-21: all articles must be back to close the transaction.
    const remaining = await db.selectFrom('borrow_transaction_article')
      .select('article_id').where('borrow_txn_id', '=', txnId).where('returned_at', 'is', null).execute();

    if (remaining.length > 0) {
      await db.updateTable('borrow_transaction').set({ status: 'INCOMPLETE' })
        .where('borrow_txn_id', '=', txnId).execute();
      return { status: 'INCOMPLETE' as const };
    }

    const now = new Date();
    const isLate = now > new Date(txn.agreed_return_at);
    const anyDamaged = input.mode !== 'dismiss' && label === 'DAMAGED';
    const finalStatus = anyDamaged ? 'COMPLETED_DAMAGED' : isLate ? 'COMPLETED_LATE' : 'COMPLETED';

    await db.updateTable('borrow_transaction')
      .set({ status: finalStatus, actual_return_at: sql`now()`, id_card_returned_at: sql`now()` })
      .where('borrow_txn_id', '=', txnId).execute();

    // HIST-02/03: a borrow transaction enters Usage History the moment it
    // reaches a terminal state. v_client_reputation (and later Feature 10's
    // analytics) are built entirely on this permanent record, not on
    // borrow_transaction directly — HIST-15/16 require that immutability.
    if (txn.borrower_user_id) {
      await db.insertInto('usage_history').values({
        kind: 'EQUIPMENT_BORROW',
        occurred_on: sql`current_date`,
        borrow_txn_id: txnId,
        actor_user_id: txn.borrower_user_id,
        equipment_type_id: txn.equipment_type_id,
        outcome: finalStatus,
        snapshot: JSON.stringify({ articleIds: input.articleIds, mode: input.mode }),
      }).execute();
    }
    // Guests have no history entry — HIST-08/09 scope Usage History to
    // registered users; guest transactions remain deliberately unlinked
    // (BORROW-25) and are audited via borrow_transaction itself.

    if (input.mode === 'dismiss') {
      await notifyStaff('RETURN_CONDITION_UNVERIFIED', 'Return condition not verified',
        'A return was dismissed without a health check. This article\'s condition data may now be inaccurate.',
        { borrowTxnId: txnId });
    }

    if (isLate && txn.borrower_user_id) {
      await notifyStaff('BORROW_OVERDUE_COORDINATOR', 'Equipment returned late',
        'A student returned equipment after the agreed time.', { borrowTxnId: txnId, subjectUserId: txn.borrower_user_id });
      await notifyStudent('BORROW_OVERDUE_CLIENT', txn.borrower_user_id, 'Your equipment return was late',
        'Your return was recorded after the agreed return time. Repeated late returns affect your standing.',
        { borrowTxnId: txnId });

      const rep = await getReputation(txn.borrower_user_id);
      if (rep.lateReturns === BAD_SPORT_THRESHOLD) {
        await notifyStaff('BAD_SPORT_FLAGGED', 'Student flagged: repeated late returns',
          `A student has reached ${BAD_SPORT_THRESHOLD} late returns.`, { subjectUserId: txn.borrower_user_id });
      }
    }

    return { status: finalStatus };
  } catch (e) { throw mapDbError(e); }
}

// ── overdue detection (BORROW-18) ──
// Called periodically (server.ts) and opportunistically when the queue/active
// list is read, so status is never stale by more than the poll interval.
export async function checkOverdueBorrows() {
  const overdue = await db.selectFrom('borrow_transaction')
    .select(['borrow_txn_id', 'borrower_user_id'])
    .where('status', '=', 'ACTIVE').where('agreed_return_at', '<', new Date()).execute();

  for (const txn of overdue) {
    await db.updateTable('borrow_transaction').set({ status: 'OVERDUE' })
      .where('borrow_txn_id', '=', txn.borrow_txn_id).execute();
    await notifyStaff('BORROW_OVERDUE_COORDINATOR', 'Equipment overdue',
      'A borrowed item has passed its agreed return time and has not been returned.',
      { borrowTxnId: txn.borrow_txn_id, subjectUserId: txn.borrower_user_id ?? undefined });
  }
  return overdue.length;
}
