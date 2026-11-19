/**
 * Borrow desk — collection, history, live loans and sidebar badges.
 *
 * Additive to the borrow feature (service.ts / router.ts are reused, not
 * rewritten). It fixes the "approve today, lend days early" gap:
 *
 *   1. A coordinator APPROVES a request any time (existing approveGroup).
 *   2. The request then stays visible as "Approved — ready to collect".
 *   3. LENDING happens only on the requested day, when the student is at the
 *      desk with their university card: the coordinator types the enrollment
 *      number printed on the card and it must match the student's account.
 *
 * Also: the student's full borrow history, the live Active Borrows list
 * (with enrollment no. and borrow window), the student's late-return alert,
 * and the counts shown as badges in the sidebar.
 */
import { countEquipmentAlerts } from '../venue/equipmentAlerts.js';
import { sql } from 'kysely';
import { db } from '../../db/index.js';
import { AppError, badRequest, conflict, notFound } from '../../middleware/errors.js';
import { approveGroup, checkOverdueBorrows, lendPlatformGroup, returnArticles } from './service.js';
import { isWeekendKarachi } from './returnOutcome.js';

const TZ = 'Asia/Karachi';

/** "22-123456-789" ← " 22 123456 789 " / "22-123456-789". Digits only, then re-hyphenate. */
export function normalizeEnrollment(v: string): string {
  const d = v.replace(/\D/g, '');
  return d.length === 11 ? `${d.slice(0, 2)}-${d.slice(2, 8)}-${d.slice(8)}` : v.trim();
}

function karachiDay(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
function karachiLabel(d: Date): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' }).format(d);
}
function karachiTime(d: Date): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }).format(d);
}

/** Can a request with this window be handed out right now? */
export function lendWindow(start: Date, end: Date, now = new Date()) {
  const today = karachiDay(now);
  const day = karachiDay(start);
  if (isWeekendKarachi(start)) {
    return { lendable: false, reason: 'WEEKEND' as const,
      message: `${karachiLabel(start)} is a weekend — equipment is not lent on Saturdays or Sundays. Reject it or ask the student to request a weekday.` };
  }
  if (today < day) {
    return { lendable: false, reason: 'TOO_EARLY' as const,
      message: `This request is for ${karachiLabel(start)}. It can be lent on that day when the student brings their university card.` };
  }
  if (now >= end) {
    return { lendable: false, reason: 'WINDOW_PASSED' as const,
      message: `The borrow window ended at ${karachiTime(end)} on ${karachiLabel(end)}. Ask the student to submit a new request.` };
  }
  return { lendable: true, reason: null, message: null };
}

// ── coordinator: approved requests waiting for collection + enrollment lookup ──

export async function getDeskOverview() {
  // Approved, not yet lent, window not long past (hide after a day so the list stays clean).
  const rows = await sql<{
    borrow_request_id: string; request_group_id: string; requested_start_at: Date; requested_return_at: Date;
    decided_at: Date | null; equipment_type_id: number; equipment_type_name: string; lending_unit: 'SINGLE' | 'PAIR';
    student_id: string; student_name: string; student_email: string; enrollment_no: string | null; department: string | null;
    available_units: string;
  }>`
    SELECT br.borrow_request_id, br.request_group_id, br.requested_start_at, br.requested_return_at, br.decided_at,
           br.equipment_type_id, et.name AS equipment_type_name, et.lending_unit::text AS lending_unit,
           u.user_id AS student_id, u.full_name AS student_name, u.email AS student_email,
           sp.enrollment_no, sp.department, coalesce(va.available_units, 0) AS available_units
      FROM borrow_request br
      JOIN equipment_type et ON et.equipment_type_id = br.equipment_type_id
      JOIN app_user u ON u.user_id = br.requested_by
      LEFT JOIN student_profile sp ON sp.user_id = u.user_id
      LEFT JOIN v_article_availability va ON va.equipment_type_id = br.equipment_type_id
     WHERE br.status = 'APPROVED'
       AND NOT EXISTS (SELECT 1 FROM borrow_transaction bt WHERE bt.borrow_request_id = br.borrow_request_id)
       AND br.requested_return_at > now() - interval '1 day'
     ORDER BY br.requested_start_at`.execute(db);

  const groups = new Map<string, {
    groupId: string; studentId: string; studentName: string; studentEmail: string;
    enrollmentNo: string | null; department: string | null; approvedAt: Date | null;
    startAt: Date; returnAt: Date; items: Array<{ borrowRequestId: string; equipmentTypeId: number; equipmentTypeName: string; lendingUnit: 'SINGLE' | 'PAIR'; availableUnits: number }>;
  }>();
  for (const r of rows.rows) {
    const g = groups.get(r.request_group_id) ?? {
      groupId: r.request_group_id, studentId: r.student_id, studentName: r.student_name, studentEmail: r.student_email,
      enrollmentNo: r.enrollment_no, department: r.department, approvedAt: r.decided_at,
      startAt: r.requested_start_at, returnAt: r.requested_return_at, items: [],
    };
    g.items.push({ borrowRequestId: r.borrow_request_id, equipmentTypeId: r.equipment_type_id,
      equipmentTypeName: r.equipment_type_name, lendingUnit: r.lending_unit, availableUnits: Number(r.available_units) });
    if (r.requested_start_at < g.startAt) g.startAt = r.requested_start_at;
    if (r.requested_return_at > g.returnAt) g.returnAt = r.requested_return_at;
    groups.set(r.request_group_id, g);
  }
  const now = new Date();
  const ready = [...groups.values()].map((g) => ({ ...g, ...lendWindow(g.startAt, g.returnAt, now) }));

  // Enrollment numbers of students with PENDING requests (so the queue can be searched by card number).
  const pend = await sql<{ user_id: string; enrollment_no: string | null }>`
    SELECT DISTINCT u.user_id, sp.enrollment_no
      FROM borrow_request br JOIN app_user u ON u.user_id = br.requested_by
      LEFT JOIN student_profile sp ON sp.user_id = u.user_id
     WHERE br.status = 'PENDING'`.execute(db);

  return {
    ready,
    pendingEnrollments: Object.fromEntries(pend.rows.map((r) => [r.user_id, r.enrollment_no])),
    now: now.toISOString(),
  };
}

// ── coordinator: lend after checking the university card ──

export async function lendWithCard(groupId: string, input: {
  idCardEnrollmentNo: string; articlesPerType: Record<number, string[]>;
}, coordinatorId: string) {
  const rows = await db.selectFrom('borrow_request as br')
    .leftJoin('student_profile as sp', 'sp.user_id', 'br.requested_by')
    .innerJoin('app_user as u', 'u.user_id', 'br.requested_by')
    .select(['br.borrow_request_id', 'br.status', 'br.requested_by', 'br.requested_start_at', 'br.requested_return_at',
      'sp.enrollment_no', 'u.full_name'])
    .where('br.request_group_id', '=', groupId)
    .execute();
  if (rows.length === 0) throw notFound('Request not found.');
  const open = rows.filter((r) => r.status === 'PENDING' || r.status === 'APPROVED');
  if (open.length === 0) throw conflict('This request is no longer open (it was rejected, cancelled or expired).');

  const lent = await db.selectFrom('borrow_transaction').select('borrow_txn_id')
    .where('borrow_request_id', 'in', open.map((r) => r.borrow_request_id)).executeTakeFirst();
  if (lent) throw conflict('This request has already been lent.', 'ALREADY_LENT');

  // 1) university card must belong to the student who made the request
  const first = open[0]!;
  if (!first.enrollment_no) throw badRequest('This borrower has no enrollment number on file, so the card cannot be checked.');
  const typed = normalizeEnrollment(input.idCardEnrollmentNo ?? '');
  if (!typed) throw badRequest('Enter the enrollment number printed on the university card.', 'CARD_REQUIRED');
  if (typed !== normalizeEnrollment(first.enrollment_no)) {
    throw new AppError(422, `The card number ${typed} does not match ${first.full_name}'s enrollment number. Lend only to the student who made the request.`, 'CARD_MISMATCH');
  }

  // 2) only on the requested day, and before the window ends
  const start = new Date(Math.min(...open.map((r) => new Date(r.requested_start_at).getTime())));
  const end = new Date(Math.max(...open.map((r) => new Date(r.requested_return_at).getTime())));
  const w = lendWindow(start, end);
  if (!w.lendable) throw conflict(w.message!, w.reason === 'TOO_EARLY' ? 'LEND_TOO_EARLY' : w.reason === 'WEEKEND' ? 'WEEKEND' : 'WINDOW_PASSED');

  // 3) approve if still pending (same stock check + student notification as the Approve button)
  if (open.some((r) => r.status === 'PENDING')) await approveGroup(groupId, coordinatorId);

  // 4) lend with the existing logic — agreed window = the requested window
  return lendPlatformGroup({
    groupId, articlesPerType: input.articlesPerType,
    agreedStartAt: start.toISOString(), agreedReturnAt: end.toISOString(),
  }, coordinatorId);
}

// ── coordinator / admin: live active borrows ──

export async function listActiveDetailed() {
  await checkOverdueBorrows();
  const r = await sql<{
    borrow_txn_id: string; status: string; path: string; agreed_start_at: Date; agreed_return_at: Date; actual_start_at: Date;
    equipment_type_name: string; borrower_user_id: string | null; borrower_name: string | null; borrower_email: string | null;
    enrollment_no: string | null; department: string | null; guest_name: string | null; guest_id_number: string | null;
    barcodes: string | null; lent_by_name: string | null;
  }>`
    SELECT bt.borrow_txn_id, bt.status::text AS status, bt.path::text AS path, bt.agreed_start_at, bt.agreed_return_at, bt.actual_start_at,
           et.name AS equipment_type_name, bt.borrower_user_id, u.full_name AS borrower_name, u.email AS borrower_email,
           sp.enrollment_no, sp.department, g.full_name AS guest_name, g.id_number AS guest_id_number,
           (SELECT string_agg(a.barcode, ', ' ORDER BY a.barcode) FROM borrow_transaction_article bta
              JOIN article a ON a.article_id = bta.article_id
             WHERE bta.borrow_txn_id = bt.borrow_txn_id AND bta.returned_at IS NULL) AS barcodes,
           lb.full_name AS lent_by_name
      FROM borrow_transaction bt
      JOIN equipment_type et ON et.equipment_type_id = bt.equipment_type_id
      LEFT JOIN app_user u ON u.user_id = bt.borrower_user_id
      LEFT JOIN student_profile sp ON sp.user_id = bt.borrower_user_id
      LEFT JOIN guest_borrower g ON g.guest_borrower_id = bt.guest_borrower_id
      LEFT JOIN app_user lb ON lb.user_id = bt.lent_by
     WHERE bt.status IN ('ACTIVE', 'OVERDUE', 'INCOMPLETE')
     ORDER BY bt.agreed_return_at`.execute(db);
  return { transactions: r.rows, now: new Date().toISOString() };
}

// ── coordinator: Borrow Queue "On loan" list + Submitted ──
// Lent requests stay on the Borrow Queue until the Coordinator presses
// "Submitted" (the student has handed everything back at the desk).

export async function listOnLoan() {
  await checkOverdueBorrows();
  const r = await sql<{
    borrow_txn_id: string; request_group_id: string | null; status: string; path: string;
    agreed_start_at: Date; agreed_return_at: Date; actual_start_at: Date; equipment_type_name: string;
    borrower_name: string | null; borrower_email: string | null; enrollment_no: string | null; department: string | null;
    guest_name: string | null; guest_id_number: string | null; barcodes: string | null;
  }>`
    SELECT bt.borrow_txn_id, br.request_group_id, bt.status::text AS status, bt.path::text AS path,
           bt.agreed_start_at, bt.agreed_return_at, bt.actual_start_at, et.name AS equipment_type_name,
           u.full_name AS borrower_name, u.email AS borrower_email, sp.enrollment_no, sp.department,
           g.full_name AS guest_name, g.id_number AS guest_id_number,
           (SELECT string_agg(a.barcode, ', ' ORDER BY a.barcode) FROM borrow_transaction_article bta
              JOIN article a ON a.article_id = bta.article_id
             WHERE bta.borrow_txn_id = bt.borrow_txn_id AND bta.returned_at IS NULL) AS barcodes
      FROM borrow_transaction bt
      JOIN equipment_type et ON et.equipment_type_id = bt.equipment_type_id
      LEFT JOIN borrow_request br ON br.borrow_request_id = bt.borrow_request_id
      LEFT JOIN app_user u ON u.user_id = bt.borrower_user_id
      LEFT JOIN student_profile sp ON sp.user_id = bt.borrower_user_id
      LEFT JOIN guest_borrower g ON g.guest_borrower_id = bt.guest_borrower_id
     WHERE bt.status IN ('ACTIVE', 'OVERDUE', 'INCOMPLETE')
     ORDER BY bt.agreed_return_at`.execute(db);

  // One row per logical request (kit = several transactions); walk-ins stand alone.
  const groups = new Map<string, {
    key: string; txnIds: string[]; borrowerName: string; borrowerEmail: string | null; enrollmentNo: string | null;
    department: string | null; isGuest: boolean; guestIdNumber: string | null; path: string;
    startAt: Date; returnAt: Date; items: Array<{ equipmentTypeName: string; barcodes: string | null }>; overdue: boolean;
  }>();
  for (const t of r.rows) {
    const key = t.request_group_id ?? t.borrow_txn_id;
    const g = groups.get(key) ?? {
      key, txnIds: [], borrowerName: t.borrower_name ?? t.guest_name ?? 'Unknown borrower', borrowerEmail: t.borrower_email,
      enrollmentNo: t.enrollment_no, department: t.department, isGuest: !t.borrower_name && !!t.guest_name,
      guestIdNumber: t.guest_id_number, path: t.path, startAt: t.agreed_start_at, returnAt: t.agreed_return_at, items: [], overdue: false,
    };
    g.txnIds.push(t.borrow_txn_id);
    g.items.push({ equipmentTypeName: t.equipment_type_name, barcodes: t.barcodes });
    if (t.agreed_start_at < g.startAt) g.startAt = t.agreed_start_at;
    if (t.agreed_return_at > g.returnAt) g.returnAt = t.agreed_return_at;
    if (t.status === 'OVERDUE') g.overdue = true;
    groups.set(key, g);
  }
  const now = new Date();
  return {
    loans: [...groups.values()].map((g) => ({ ...g, overdue: g.overdue || g.returnAt < now, windowEnded: g.returnAt <= now })),
    now: now.toISOString(),
  };
}

/**
 * "Submitted": the student has handed everything back to the Coordinator.
 * Closes every transaction of the request — early → COMPLETED_EARLY, last
 * 10 min of the window → COMPLETED, after the window → COMPLETED_LATE — and
 * writes it to Usage History.
 */
export async function markSubmitted(txnIds: string[], coordinatorId: string) {
  const txns = await db.selectFrom('borrow_transaction')
    .select(['borrow_txn_id', 'status', 'agreed_return_at'])
    .where('borrow_txn_id', 'in', txnIds).execute();
  if (txns.length !== txnIds.length) throw notFound('One or more loans were not found.');
  const open = txns.filter((t) => ['ACTIVE', 'OVERDUE', 'INCOMPLETE'].includes(t.status));
  if (open.length === 0) throw conflict('This loan has already been closed.', 'ALREADY_SUBMITTED');

  const results: Array<{ borrowTxnId: string; status: string }> = [];
  for (const t of open) {
    const outstanding = await db.selectFrom('borrow_transaction_article').select('article_id')
      .where('borrow_txn_id', '=', t.borrow_txn_id).where('returned_at', 'is', null).execute();
    if (outstanding.length === 0) continue;
    const r = await returnArticles(t.borrow_txn_id,
      { articleIds: outstanding.map((a) => a.article_id), mode: 'dismiss' }, coordinatorId, { source: 'SUBMITTED' });
    results.push({ borrowTxnId: t.borrow_txn_id, status: r.status });
  }
  // A kit's transactions share one window, so they share one outcome.
  const order = ['COMPLETED_DAMAGED', 'COMPLETED_LATE', 'COMPLETED', 'COMPLETED_EARLY'];
  const outcome = (order.find((o) => results.some((r) => r.status === o)) ?? 'COMPLETED') as
    'COMPLETED' | 'COMPLETED_EARLY' | 'COMPLETED_LATE' | 'COMPLETED_DAMAGED';
  return { outcome, transactions: results };
}

// ── student: full history ──

export async function myHistory(studentId: string) {
  await checkOverdueBorrows();
  const r = await sql<{
    borrow_request_id: string; request_group_id: string; status: string; requested_start_at: Date; requested_return_at: Date;
    submitted_at: Date; decided_at: Date | null; rejection_reason: string | null; equipment_type_name: string;
    txn_status: string | null; actual_start_at: Date | null; agreed_return_at: Date | null; actual_return_at: Date | null; barcodes: string | null;
  }>`
    SELECT br.borrow_request_id, br.request_group_id, br.status::text AS status, br.requested_start_at, br.requested_return_at,
           br.submitted_at, br.decided_at, br.rejection_reason, et.name AS equipment_type_name,
           bt.status::text AS txn_status, bt.actual_start_at, bt.agreed_return_at, bt.actual_return_at,
           (SELECT string_agg(a.barcode, ', ' ORDER BY a.barcode) FROM borrow_transaction_article bta
              JOIN article a ON a.article_id = bta.article_id WHERE bta.borrow_txn_id = bt.borrow_txn_id) AS barcodes
      FROM borrow_request br
      JOIN equipment_type et ON et.equipment_type_id = br.equipment_type_id
      LEFT JOIN borrow_transaction bt ON bt.borrow_request_id = br.borrow_request_id
     WHERE br.requested_by = ${studentId}
     ORDER BY br.submitted_at DESC`.execute(db);

  const now = Date.now();
  return {
    requests: r.rows.map((x) => {
      // One clear stage for the student.
      let stage: string;
      if (x.txn_status) {
        if (x.actual_return_at) {
          stage = x.txn_status === 'COMPLETED_LATE' || (x.agreed_return_at && new Date(x.actual_return_at) > new Date(x.agreed_return_at))
            ? 'RETURNED_LATE' : x.txn_status === 'COMPLETED_EARLY' ? 'RETURNED_EARLY' : 'RETURNED';
        } else if (x.txn_status === 'OVERDUE' || (x.agreed_return_at && new Date(x.agreed_return_at).getTime() < now)) {
          stage = 'OVERDUE';
        } else if (x.txn_status === 'INCOMPLETE') {
          stage = 'PARTLY_RETURNED';
        } else stage = 'ON_LOAN';
      } else if (x.status === 'APPROVED') {
        stage = new Date(x.requested_return_at).getTime() < now ? 'NOT_COLLECTED' : 'READY_TO_COLLECT';
      } else stage = x.status; // PENDING / REJECTED / CANCELLED / EXPIRED
      return { ...x, stage };
    }),
    now: new Date(now).toISOString(),
  };
}

/** Marks the student's "request approved" notifications as seen (clears the sidebar badge). */
export async function markMyApprovalsSeen(studentId: string) {
  await db.updateTable('notification').set({ read_at: sql`now()` })
    .where('recipient_id', '=', studentId).where('type', '=', 'BORROW_APPROVED').where('read_at', 'is', null)
    .execute();
}

/** Student's loans that are past their return time (for the "Late submission" pop-up). */
export async function myLateLoans(studentId: string) {
  await checkOverdueBorrows();
  const r = await sql<{ borrow_txn_id: string; equipment_type_name: string; agreed_return_at: Date; barcodes: string | null }>`
    SELECT bt.borrow_txn_id, et.name AS equipment_type_name, bt.agreed_return_at,
           (SELECT string_agg(a.barcode, ', ' ORDER BY a.barcode) FROM borrow_transaction_article bta
              JOIN article a ON a.article_id = bta.article_id
             WHERE bta.borrow_txn_id = bt.borrow_txn_id AND bta.returned_at IS NULL) AS barcodes
      FROM borrow_transaction bt JOIN equipment_type et ON et.equipment_type_id = bt.equipment_type_id
     WHERE bt.borrower_user_id = ${studentId}
       AND bt.status IN ('ACTIVE', 'OVERDUE', 'INCOMPLETE')
       AND bt.agreed_return_at < now()
     ORDER BY bt.agreed_return_at`.execute(db);
  return { late: r.rows, now: new Date().toISOString() };
}

// ── sidebar badges ──

export async function badgeCounts(userId: string, role: string) {
  if (role === 'COORDINATOR') {
    // Each logical request (group) counts once; requests whose start has passed are about to expire.
    const r = await sql<{ n: string }>`
      SELECT count(DISTINCT request_group_id) AS n FROM borrow_request
       WHERE status = 'PENDING' AND requested_start_at >= now()`.execute(db);
    // Equipment Alerts badge: locked event equipment lines that need attention.
    const equipmentAlerts = await countEquipmentAlerts().catch(() => 0);
    return { borrowQueue: Number(r.rows[0]?.n ?? 0), equipmentAlerts };
  }
  if (role === 'STUDENT') {
    const r = await sql<{ n: string }>`
      SELECT count(*) AS n FROM notification
       WHERE recipient_id = ${userId} AND type = 'BORROW_APPROVED' AND read_at IS NULL`.execute(db);
    return { myBorrowRequests: Number(r.rows[0]?.n ?? 0) };
  }
  return {};
}
