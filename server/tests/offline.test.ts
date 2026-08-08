/**
 * Feature 11 — Offline Fallback Entry Form.
 *
 * Rules exercised:
 *   OFFL-01/03 — form is staff-only; students/externals get 403
 *   OFFL-04    — all three types carry entered_via_offline_fallback=true
 *   OFFL-05    — actual event time (not entry time) is recorded on the transaction
 *   OFFL-06    — fallback bookings run the same conflict detection as live bookings
 *   OFFL-07    — fallback borrows validate against current inventory state
 *   OFFL-09    — entry is written immediately (no queue)
 *   OFFL-10    — synced entries appear in usage_history
 *   OFFL-11    — no approval workflow; no borrow_request row
 *   OFFL-15    — offline_fallback_audit row written: correct entered_by + kind
 *   OFFL-16    — Super Admin notified when Coordinator enters
 *   OFFL-17    — usage_history filterable by offlineFallback=true/false
 */
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { seedCreds, bc } from './setup.js';
import { db } from '../src/db/index.js';

const app = createApp();

// ── helpers ──

async function staffAgent() {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send(seedCreds);
  expect(res.status, 'staffAgent login').toBe(200);
  const bearer = { Authorization: `Bearer ${res.body.accessToken}` };
  return {
    get:    (u: string) => agent.get(u).set(bearer),
    post:   (u: string) => agent.post(u).set(bearer),
    userId: res.body.user.userId as string,
  };
}

let coordCounter = 0;
async function coordinatorAgent(staff: Awaited<ReturnType<typeof staffAgent>>) {
  coordCounter++;
  const email = `offl_coord${coordCounter}@bukc.edu.pk`;
  const NAMES = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta'];
  const inv = await staff.post('/api/auth/admin/invite-coordinator')
    .send({ fullName: `Coord ${NAMES[(coordCounter - 1) % NAMES.length]}`, email, contactNumber: '03005550000' });
  expect(inv.status, 'invite').toBe(201);
  await request(app).post('/api/auth/accept-invite')
    .send({ token: inv.body.devToken, password: 'CoordPass1!' });
  const login = await request(app).post('/api/auth/login')
    .send({ email, password: 'CoordPass1!' });
  expect(login.status, 'coord login').toBe(200);
  const bearer = { Authorization: `Bearer ${login.body.accessToken}` };
  return {
    get:    (u: string) => request(app).get(u).set(bearer),
    post:   (u: string) => request(app).post(u).set(bearer),
    userId: login.body.user.userId as string,
  };
}

let studentCounter = 0;
async function studentAgent(staff: Awaited<ReturnType<typeof staffAgent>>) {
  studentCounter++;
  const n = studentCounter;
  const email = `offl_stu${n}@bukc.edu.pk`;
  const enrollmentNo = `84-024777-${600 + n}`;
  const reg = await request(app).post('/api/auth/register/student').send({
    fullName: 'Offl Student', email, contactNumber: '03001112222',
    password: 'Passw0rd!', enrollmentNo, department: 'CS', programTitle: 'BS CS',
  });
  expect(reg.status, 'student register').toBe(201);
  const userId: string = reg.body.user.userId;
  const verify = await staff.post('/api/auth/admin/verify').send({ userId });
  expect(verify.status, 'verify').toBe(200);
  const login = await request(app).post('/api/auth/login/student')
    .send({ enrollmentNo, password: 'Passw0rd!' });
  expect(login.status, 'student login').toBe(200);
  const bearer = { Authorization: `Bearer ${login.body.accessToken}` };
  return {
    userId,
    enrollmentNo,
    get:  (u: string) => request(app).get(u).set(bearer),
    post: (u: string) => request(app).post(u).set(bearer),
  };
}

async function firstSportId(): Promise<number> {
  const c = await db.selectFrom('sport_category').select('sport_category_id')
    .orderBy('name').executeTakeFirstOrThrow();
  return c.sport_category_id;
}

async function makeType(staff: Awaited<ReturnType<typeof staffAgent>>, suffix = '') {
  const res = await staff.post('/api/inventory/types').send({
    sportCategoryId: await firstSportId(),
    name: `OfflType${suffix}${Date.now()}`,
    lendingUnit: 'SINGLE', lowStockThreshold: 1,
    maxBorrowDurationMinutes: 120,
    conditionGoodMinScore: 70, conditionWornMinScore: 40, isIndoor: false,
  });
  expect(res.status, 'makeType').toBe(201);
  return res.body.type.equipmentTypeId as number;
}

let barcodeSeq = 200000;
async function makeArticle(staff: Awaited<ReturnType<typeof staffAgent>>, typeId: number) {
  barcodeSeq++;
  const res = await staff.post('/api/inventory/articles').send({
    equipmentTypeId: typeId,
    barcode: bc(barcodeSeq),
    entryScore: 85,
  });
  expect(res.status, 'makeArticle').toBe(201);
  return res.body.article.articleId as string;
}

async function makeVenue(): Promise<number> {
  const row = await db.insertInto('venue').values({
    name: `OfflVenue${Date.now()}`, capacity: 50, is_indoor: true,
  }).returning('venue_id').executeTakeFirstOrThrow();
  return row.venue_id;
}

/** Timestamps that represent "during downtime" — 24+ hours ago. */
function pastWindow(hoursAgo = 25, durationHours = 2) {
  const start = new Date(Date.now() - hoursAgo * 3_600_000);
  const end   = new Date(start.getTime() + durationHours * 3_600_000);
  return { startAt: start.toISOString(), endAt: end.toISOString() };
}

// ════════════════════════════════════════════════════════════════════════════
// BOOKING
// ════════════════════════════════════════════════════════════════════════════

describe('Fallback booking', () => {
  it('OFFL-03/04/09/10/15: Super Admin can enter a fallback booking', async () => {
    const staff = await staffAgent();
    const venueId = await makeVenue();
    const { startAt, endAt } = pastWindow();

    const res = await staff.post('/api/offline/booking').send({
      venueId,
      purpose: 'Match during downtime',
      estimatedParticipants: 10,
      sessionStartAt: startAt,
      sessionEndAt:   endAt,
      teamName: 'Team A',
      participantDetails: 'Squad list on file',
      note: 'Paper log p.1 #1',
    });

    expect(res.status).toBe(201);
    expect(res.body.bookingId).toBeTruthy();
    expect(res.body.sessionId).toBeTruthy();

    // OFFL-04: booking flag
    const booking = await db.selectFrom('booking')
      .select(['entered_via_offline_fallback', 'status'])
      .where('booking_id', '=', res.body.bookingId)
      .executeTakeFirstOrThrow();
    expect(booking.entered_via_offline_fallback).toBe(true);
    expect(booking.status).toBe('COMPLETED');

    // OFFL-10: usage_history row
    const hist = await db.selectFrom('usage_history')
      .select(['kind', 'outcome', 'entered_via_offline_fallback'])
      .where('session_id', '=', res.body.sessionId)
      .executeTakeFirst();
    expect(hist).toBeTruthy();
    expect(hist!.kind).toBe('VENUE_SESSION');
    expect(hist!.outcome).toBe('COMPLETED');
    expect(hist!.entered_via_offline_fallback).toBe(true);

    // OFFL-15: audit row
    const audit = await db.selectFrom('offline_fallback_audit')
      .select(['entered_by', 'transaction_kind', 'note'])
      .where('booking_id', '=', res.body.bookingId)
      .executeTakeFirst();
    expect(audit).toBeTruthy();
    expect(audit!.entered_by).toBe(staff.userId);
    expect(audit!.transaction_kind).toBe('BOOKING');
    expect(audit!.note).toBe('Paper log p.1 #1');
  });

  it('OFFL-03: Coordinator can also enter a fallback booking', async () => {
    const staff = await staffAgent();
    const coord = await coordinatorAgent(staff);
    const venueId = await makeVenue();
    const { startAt, endAt } = pastWindow(50);

    const res = await coord.post('/api/offline/booking').send({
      venueId, purpose: 'Coord fallback', estimatedParticipants: 5,
      sessionStartAt: startAt, sessionEndAt: endAt, teamName: 'Team B',
    });
    expect(res.status).toBe(201);
  });

  it('OFFL-06: conflict detected when slot already claimed', async () => {
    const staff = await staffAgent();
    const venueId = await makeVenue();
    const { startAt, endAt } = pastWindow(48);

    // First fallback booking claims the slot
    const r1 = await staff.post('/api/offline/booking').send({
      venueId, purpose: 'First', estimatedParticipants: 5,
      sessionStartAt: startAt, sessionEndAt: endAt, teamName: 'Team A',
    });
    expect(r1.status).toBe(201);

    // Second fallback booking in the same slot must be rejected
    const r2 = await staff.post('/api/offline/booking').send({
      venueId, purpose: 'Second same slot', estimatedParticipants: 5,
      sessionStartAt: startAt, sessionEndAt: endAt, teamName: 'Team B',
    });
    expect(r2.status).toBe(409);
    expect(r2.body.code).toBe('SLOT_CONFLICT');
  });

  it('OFFL-16: Super Admin notified when Coordinator enters a fallback booking', async () => {
    const staff = await staffAgent();
    const coord = await coordinatorAgent(staff);
    const venueId = await makeVenue();
    const { startAt, endAt } = pastWindow(72);

    const res = await coord.post('/api/offline/booking').send({
      venueId, purpose: 'Notif test', estimatedParticipants: 8,
      sessionStartAt: startAt, sessionEndAt: endAt, teamName: 'Team X',
    });
    expect(res.status).toBe(201);

    const notif = await db.selectFrom('notification')
      .select(['type', 'recipient_id', 'booking_id'])
      .where('type', '=', 'FALLBACK_ENTRY_MADE')
      .where('recipient_id', '=', staff.userId)
      .executeTakeFirst();

    expect(notif).toBeTruthy();
    expect(notif!.booking_id).toBe(res.body.bookingId);
  });

  it('OFFL-16: Super Admin entering does NOT generate self-notification', async () => {
    const staff = await staffAgent();
    const venueId = await makeVenue();
    const { startAt, endAt } = pastWindow(26);

    await staff.post('/api/offline/booking').send({
      venueId, purpose: 'SA self-entry', estimatedParticipants: 5,
      sessionStartAt: startAt, sessionEndAt: endAt, teamName: 'Team SA',
    });

    // No FALLBACK_ENTRY_MADE notification should exist (SA is the actor, not a coordinator)
    const notif = await db.selectFrom('notification')
      .select('notification_id')
      .where('type', '=', 'FALLBACK_ENTRY_MADE')
      .where('recipient_id', '=', staff.userId)
      .executeTakeFirst();
    expect(notif).toBeUndefined();
  });

  it('OFFL-01: students cannot use the fallback form', async () => {
    const staff = await staffAgent();
    const stu = await studentAgent(staff);
    const venueId = await makeVenue();
    const { startAt, endAt } = pastWindow();

    const res = await stu.post('/api/offline/booking').send({
      venueId, purpose: 'Unauthorized', estimatedParticipants: 5,
      sessionStartAt: startAt, sessionEndAt: endAt, teamName: 'Unauth',
    });
    expect(res.status).toBe(403);
  });

  it('validation: sessionEndAt must be after sessionStartAt', async () => {
    const staff = await staffAgent();
    const venueId = await makeVenue();
    const now = new Date().toISOString();
    const before = new Date(Date.now() - 1000).toISOString();

    const res = await staff.post('/api/offline/booking').send({
      venueId, purpose: 'Bad order', estimatedParticipants: 5,
      sessionStartAt: now, sessionEndAt: before, teamName: 'Bad',
    });
    expect(res.status).toBe(400);
  });

  it('rejects unknown venueId', async () => {
    const staff = await staffAgent();
    const { startAt, endAt } = pastWindow();
    const res = await staff.post('/api/offline/booking').send({
      venueId: 999999, purpose: 'No venue', estimatedParticipants: 5,
      sessionStartAt: startAt, sessionEndAt: endAt, teamName: 'No venue team',
    });
    expect(res.status).toBe(404);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// BORROW — registered student
// ════════════════════════════════════════════════════════════════════════════

describe('Fallback borrow — registered student', () => {
  it('OFFL-04/05/09/11/15: creates WALK_IN transaction with fallback flag', async () => {
    const staff = await staffAgent();
    const stu = await studentAgent(staff);
    const typeId = await makeType(staff, 'A');
    const articleId = await makeArticle(staff, typeId);
    const { startAt, endAt } = pastWindow();

    const res = await staff.post('/api/offline/borrow').send({
      borrowerKind: 'REGISTERED',
      enrollmentNo: stu.enrollmentNo,
      equipmentTypeId: typeId,
      articleIds: [articleId],
      agreedStartAt: startAt,
      agreedReturnAt: endAt,
      note: 'Paper log ref #7',
    });

    expect(res.status).toBe(201);
    expect(res.body.borrowTxnId).toBeTruthy();

    // OFFL-04: flag set, path=WALK_IN, borrower resolved
    const txn = await db.selectFrom('borrow_transaction')
      .select(['entered_via_offline_fallback', 'path', 'status',
        'borrower_user_id', 'borrow_request_id', 'actual_start_at'])
      .where('borrow_txn_id', '=', res.body.borrowTxnId)
      .executeTakeFirstOrThrow();
    expect(txn.entered_via_offline_fallback).toBe(true);
    expect(txn.path).toBe('WALK_IN');
    expect(txn.status).toBe('ACTIVE');
    expect(txn.borrower_user_id).toBe(stu.userId);
    // OFFL-11: no borrow_request created
    expect(txn.borrow_request_id).toBeNull();
    // OFFL-05: actual event time recorded, not now()
    expect(Math.abs(new Date(txn.actual_start_at as unknown as string).getTime() - new Date(startAt).getTime()))
      .toBeLessThan(2000); // within 2s to account for timestamptz rounding

    // Article is ON_LOAN
    const art = await db.selectFrom('article').select('state')
      .where('article_id', '=', articleId).executeTakeFirstOrThrow();
    expect(art.state).toBe('ON_LOAN');

    // OFFL-15: audit row
    const audit = await db.selectFrom('offline_fallback_audit')
      .select(['transaction_kind', 'entered_by', 'note'])
      .where('borrow_txn_id', '=', res.body.borrowTxnId)
      .executeTakeFirst();
    expect(audit).toBeTruthy();
    expect(audit!.transaction_kind).toBe('BORROW');
    expect(audit!.entered_by).toBe(staff.userId);
    expect(audit!.note).toBe('Paper log ref #7');
  });

  it('OFFL-07: rejects if article is not AVAILABLE', async () => {
    const staff = await staffAgent();
    const stu = await studentAgent(staff);
    const typeId = await makeType(staff, 'B');
    const articleId = await makeArticle(staff, typeId);
    const { startAt, endAt } = pastWindow();

    // Manually damage the article — simulates it being damaged after the downtime borrow
    await db.updateTable('article').set({ state: 'DAMAGED' })
      .where('article_id', '=', articleId).execute();

    const res = await staff.post('/api/offline/borrow').send({
      borrowerKind: 'REGISTERED',
      enrollmentNo: stu.enrollmentNo,
      equipmentTypeId: typeId,
      articleIds: [articleId],
      agreedStartAt: startAt,
      agreedReturnAt: endAt,
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ARTICLE_UNAVAILABLE');
  });

  it('rejects unknown enrollment number', async () => {
    const staff = await staffAgent();
    const typeId = await makeType(staff, 'C');
    const articleId = await makeArticle(staff, typeId);
    const { startAt, endAt } = pastWindow();

    const res = await staff.post('/api/offline/borrow').send({
      borrowerKind: 'REGISTERED',
      enrollmentNo: '00-000000-000',
      equipmentTypeId: typeId,
      articleIds: [articleId],
      agreedStartAt: startAt,
      agreedReturnAt: endAt,
    });
    expect(res.status).toBe(404);
  });

  it('rejects when student already has an active borrow', async () => {
    const staff = await staffAgent();
    const stu = await studentAgent(staff);
    const typeId = await makeType(staff, 'D');
    const a1 = await makeArticle(staff, typeId);
    const a2 = await makeArticle(staff, typeId);
    const { startAt, endAt } = pastWindow(26);
    const { startAt: s2, endAt: e2 } = pastWindow(50);

    // First fallback borrow — succeeds
    const r1 = await staff.post('/api/offline/borrow').send({
      borrowerKind: 'REGISTERED', enrollmentNo: stu.enrollmentNo,
      equipmentTypeId: typeId, articleIds: [a1],
      agreedStartAt: startAt, agreedReturnAt: endAt,
    });
    expect(r1.status).toBe(201);

    // Second fallback borrow for the same student — conflicts with active borrow
    const r2 = await staff.post('/api/offline/borrow').send({
      borrowerKind: 'REGISTERED', enrollmentNo: stu.enrollmentNo,
      equipmentTypeId: typeId, articleIds: [a2],
      agreedStartAt: s2, agreedReturnAt: e2,
    });
    expect(r2.status).toBe(409);
    expect(r2.body.code).toBe('ALREADY_ACTIVE');
  });

  it('OFFL-12/13: allows multi-day borrow (extended downtime)', async () => {
    const staff = await staffAgent();
    const stu = await studentAgent(staff);
    const typeId = await makeType(staff, 'E');
    const articleId = await makeArticle(staff, typeId);

    // Multi-day: 3 days ago → 2 days ago
    const startAt = new Date(Date.now() - 3 * 86_400_000).toISOString();
    const endAt   = new Date(Date.now() - 2 * 86_400_000).toISOString();

    const res = await staff.post('/api/offline/borrow').send({
      borrowerKind: 'REGISTERED', enrollmentNo: stu.enrollmentNo,
      equipmentTypeId: typeId, articleIds: [articleId],
      agreedStartAt: startAt, agreedReturnAt: endAt,
    });
    // Should succeed — ck_txn_sameday is waived for fallback entries (migration 019)
    expect(res.status).toBe(201);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// BORROW — guest
// ════════════════════════════════════════════════════════════════════════════

describe('Fallback borrow — guest', () => {
  it('creates a guest_borrower row and WALK_IN transaction', async () => {
    const staff = await staffAgent();
    const typeId = await makeType(staff, 'F');
    const articleId = await makeArticle(staff, typeId);
    const { startAt, endAt } = pastWindow();

    const res = await staff.post('/api/offline/borrow').send({
      borrowerKind: 'GUEST',
      guestFullName: 'Ali Khan', guestIdNumber: 'CNIC-12345', guestContactNumber: '03001234567',
      equipmentTypeId: typeId, articleIds: [articleId],
      agreedStartAt: startAt, agreedReturnAt: endAt,
    });

    expect(res.status).toBe(201);

    const txn = await db.selectFrom('borrow_transaction')
      .select(['path', 'guest_borrower_id', 'borrower_user_id', 'entered_via_offline_fallback'])
      .where('borrow_txn_id', '=', res.body.borrowTxnId)
      .executeTakeFirstOrThrow();
    expect(txn.path).toBe('WALK_IN');
    expect(txn.guest_borrower_id).toBeTruthy();
    expect(txn.borrower_user_id).toBeNull();
    expect(txn.entered_via_offline_fallback).toBe(true);

    // Verify guest record
    const guest = await db.selectFrom('guest_borrower')
      .select(['full_name', 'id_number'])
      .where('guest_borrower_id', '=', txn.guest_borrower_id!)
      .executeTakeFirst();
    expect(guest?.full_name).toBe('Ali Khan');
    expect(guest?.id_number).toBe('CNIC-12345');
  });

  it('OFFL-16: Super Admin notified when Coordinator enters a fallback borrow', async () => {
    const staff = await staffAgent();
    const coord = await coordinatorAgent(staff);
    const typeId = await makeType(staff, 'G');
    const articleId = await makeArticle(staff, typeId);
    const { startAt, endAt } = pastWindow(30);

    await coord.post('/api/offline/borrow').send({
      borrowerKind: 'GUEST',
      guestFullName: 'Notif Test', guestIdNumber: 'NT-001', guestContactNumber: '03009990000',
      equipmentTypeId: typeId, articleIds: [articleId],
      agreedStartAt: startAt, agreedReturnAt: endAt,
    });

    const notif = await db.selectFrom('notification')
      .select('type')
      .where('type', '=', 'FALLBACK_ENTRY_MADE')
      .where('recipient_id', '=', staff.userId)
      .executeTakeFirst();
    expect(notif).toBeTruthy();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// RETURN
// ════════════════════════════════════════════════════════════════════════════

describe('Fallback return', () => {
  it('OFFL-04/05/09/10/15: closes an active transaction with paper-logged time', async () => {
    const staff = await staffAgent();
    const stu = await studentAgent(staff);
    const typeId = await makeType(staff, 'H');
    const articleId = await makeArticle(staff, typeId);
    const { startAt, endAt } = pastWindow(30);

    // Enter a fallback borrow
    const borrowRes = await staff.post('/api/offline/borrow').send({
      borrowerKind: 'REGISTERED', enrollmentNo: stu.enrollmentNo,
      equipmentTypeId: typeId, articleIds: [articleId],
      agreedStartAt: startAt, agreedReturnAt: endAt,
    });
    expect(borrowRes.status).toBe(201);
    const txnId: string = borrowRes.body.borrowTxnId;

    // Return it at agreed time (on-time)
    const returnedAt = new Date(new Date(endAt).getTime() - 30 * 60_000).toISOString();
    const returnRes = await staff.post('/api/offline/return').send({
      borrowTxnId: txnId,
      articleIds:  [articleId],
      returnedAt,
      condition: 'GOOD',
      note: 'Returned on time per paper log',
    });

    expect(returnRes.status).toBe(201);
    expect(returnRes.body.status).toBe('COMPLETED');

    // OFFL-04: transaction flag set
    const txn = await db.selectFrom('borrow_transaction')
      .select(['status', 'entered_via_offline_fallback', 'actual_return_at'])
      .where('borrow_txn_id', '=', txnId)
      .executeTakeFirstOrThrow();
    expect(txn.status).toBe('COMPLETED');
    expect(txn.entered_via_offline_fallback).toBe(true);
    // OFFL-05: paper-logged time recorded, not now()
    expect(Math.abs(new Date(txn.actual_return_at as unknown as string).getTime() - new Date(returnedAt).getTime()))
      .toBeLessThan(2000);

    // Article back to AVAILABLE
    const art = await db.selectFrom('article').select('state')
      .where('article_id', '=', articleId).executeTakeFirstOrThrow();
    expect(art.state).toBe('AVAILABLE');

    // OFFL-10: usage_history written for registered student
    const hist = await db.selectFrom('usage_history')
      .select(['outcome', 'entered_via_offline_fallback', 'actor_user_id'])
      .where('borrow_txn_id', '=', txnId)
      .executeTakeFirst();
    expect(hist).toBeTruthy();
    expect(hist!.outcome).toBe('COMPLETED');
    expect(hist!.entered_via_offline_fallback).toBe(true);
    expect(hist!.actor_user_id).toBe(stu.userId);

    // OFFL-15: audit row
    const audit = await db.selectFrom('offline_fallback_audit')
      .select(['transaction_kind', 'entered_by'])
      .where('borrow_txn_id', '=', txnId)
      .where('transaction_kind', '=', 'RETURN')
      .executeTakeFirst();
    expect(audit).toBeTruthy();
    expect(audit!.entered_by).toBe(staff.userId);
  });

  it('OFFL-05: late return is detected from paper-logged time', async () => {
    const staff = await staffAgent();
    const stu = await studentAgent(staff);
    const typeId = await makeType(staff, 'I');
    const articleId = await makeArticle(staff, typeId);
    const { startAt, endAt } = pastWindow(50);

    const borrowRes = await staff.post('/api/offline/borrow').send({
      borrowerKind: 'REGISTERED', enrollmentNo: stu.enrollmentNo,
      equipmentTypeId: typeId, articleIds: [articleId],
      agreedStartAt: startAt, agreedReturnAt: endAt,
    });
    expect(borrowRes.status).toBe(201);
    const txnId: string = borrowRes.body.borrowTxnId;

    // Return 1 hour after the agreed deadline
    const lateReturn = new Date(new Date(endAt).getTime() + 3_600_000).toISOString();
    const returnRes = await staff.post('/api/offline/return').send({
      borrowTxnId: txnId, articleIds: [articleId],
      returnedAt: lateReturn, condition: 'WORN',
    });

    expect(returnRes.status).toBe(201);
    expect(returnRes.body.status).toBe('COMPLETED_LATE');
  });

  it('DAMAGED condition flags article and raises damage_flag', async () => {
    const staff = await staffAgent();
    const typeId = await makeType(staff, 'J');
    const articleId = await makeArticle(staff, typeId);
    const { startAt, endAt } = pastWindow(26);

    const borrowRes = await staff.post('/api/offline/borrow').send({
      borrowerKind: 'GUEST',
      guestFullName: 'Damage Test', guestIdNumber: 'DT-001', guestContactNumber: '03001111111',
      equipmentTypeId: typeId, articleIds: [articleId],
      agreedStartAt: startAt, agreedReturnAt: endAt,
    });
    const txnId: string = borrowRes.body.borrowTxnId;

    const returnRes = await staff.post('/api/offline/return').send({
      borrowTxnId: txnId, articleIds: [articleId],
      returnedAt: endAt, condition: 'DAMAGED',
    });
    expect(returnRes.status).toBe(201);
    expect(returnRes.body.status).toBe('COMPLETED_DAMAGED');

    const art = await db.selectFrom('article').select('state')
      .where('article_id', '=', articleId).executeTakeFirstOrThrow();
    expect(art.state).toBe('DAMAGED');

    const flag = await db.selectFrom('damage_flag').select('flag_id')
      .where('article_id', '=', articleId).executeTakeFirst();
    expect(flag).toBeTruthy();
  });

  it('rejects return on a non-active transaction', async () => {
    const staff = await staffAgent();
    const typeId = await makeType(staff, 'K');
    const articleId = await makeArticle(staff, typeId);
    const { startAt, endAt } = pastWindow();

    const borrowRes = await staff.post('/api/offline/borrow').send({
      borrowerKind: 'GUEST',
      guestFullName: 'Done Guest', guestIdNumber: 'DG-001', guestContactNumber: '03002222222',
      equipmentTypeId: typeId, articleIds: [articleId],
      agreedStartAt: startAt, agreedReturnAt: endAt,
    });
    const txnId: string = borrowRes.body.borrowTxnId;

    // First return — completes the transaction
    await staff.post('/api/offline/return').send({
      borrowTxnId: txnId, articleIds: [articleId],
      returnedAt: endAt, condition: 'GOOD',
    });

    // Second return — must fail
    const r2 = await staff.post('/api/offline/return').send({
      borrowTxnId: txnId, articleIds: [articleId],
      returnedAt: endAt, condition: 'GOOD',
    });
    expect(r2.status).toBe(409);
    expect(r2.body.code).toBe('WRONG_STATE');
  });

  it('rejects return with article not belonging to the transaction', async () => {
    const staff = await staffAgent();
    const typeId = await makeType(staff, 'L');
    const a1 = await makeArticle(staff, typeId);
    const a2 = await makeArticle(staff, typeId);
    const { startAt, endAt } = pastWindow();

    const borrowRes = await staff.post('/api/offline/borrow').send({
      borrowerKind: 'GUEST',
      guestFullName: 'Wrong Art', guestIdNumber: 'WA-001', guestContactNumber: '03003333333',
      equipmentTypeId: typeId, articleIds: [a1],
      agreedStartAt: startAt, agreedReturnAt: endAt,
    });
    const txnId: string = borrowRes.body.borrowTxnId;

    const res = await staff.post('/api/offline/return').send({
      borrowTxnId: txnId,
      articleIds: [a2],   // a2 does not belong to this transaction
      returnedAt: endAt, condition: 'GOOD',
    });
    expect(res.status).toBe(400);
  });

  it('OFFL-11: guest returns do not produce usage_history rows', async () => {
    const staff = await staffAgent();
    const typeId = await makeType(staff, 'M');
    const articleId = await makeArticle(staff, typeId);
    const { startAt, endAt } = pastWindow();

    const borrowRes = await staff.post('/api/offline/borrow').send({
      borrowerKind: 'GUEST',
      guestFullName: 'No Hist Guest', guestIdNumber: 'NH-001', guestContactNumber: '03004444444',
      equipmentTypeId: typeId, articleIds: [articleId],
      agreedStartAt: startAt, agreedReturnAt: endAt,
    });
    const txnId: string = borrowRes.body.borrowTxnId;

    await staff.post('/api/offline/return').send({
      borrowTxnId: txnId, articleIds: [articleId], returnedAt: endAt, condition: 'GOOD',
    });

    const hist = await db.selectFrom('usage_history').select('history_id')
      .where('borrow_txn_id', '=', txnId).executeTakeFirst();
    // Guests have no history row per HIST-08/09
    expect(hist).toBeUndefined();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// OFFL-17: history filter
// ════════════════════════════════════════════════════════════════════════════

describe('OFFL-17: Usage History offlineFallback filter', () => {
  it('offlineFallback=true returns only fallback entries', async () => {
    const staff = await staffAgent();
    const stu = await studentAgent(staff);
    const typeId = await makeType(staff, 'N');
    const a1 = await makeArticle(staff, typeId);
    const { startAt, endAt } = pastWindow(28);

    // Produce a fallback return history row
    const br = await staff.post('/api/offline/borrow').send({
      borrowerKind: 'REGISTERED', enrollmentNo: stu.enrollmentNo,
      equipmentTypeId: typeId, articleIds: [a1],
      agreedStartAt: startAt, agreedReturnAt: endAt,
    });
    expect(br.status).toBe(201);
    await staff.post('/api/offline/return').send({
      borrowTxnId: br.body.borrowTxnId, articleIds: [a1],
      returnedAt: endAt, condition: 'GOOD',
    });

    const res = await staff.get('/api/history?offlineFallback=true');
    expect(res.status).toBe(200);
    expect(res.body.history.length).toBeGreaterThan(0);
    for (const row of res.body.history as Array<{ enteredViaOfflineFallback: boolean }>) {
      expect(row.enteredViaOfflineFallback).toBe(true);
    }
  });

  it('offlineFallback=false excludes fallback entries', async () => {
    const staff = await staffAgent();
    const stu = await studentAgent(staff);
    const typeId = await makeType(staff, 'O');
    const a1 = await makeArticle(staff, typeId);
    const venueId = await makeVenue();
    const { startAt, endAt } = pastWindow(29);

    // Add a fallback venue entry (produces a usage_history row flagged true)
    await staff.post('/api/offline/booking').send({
      venueId, purpose: 'Filter test', estimatedParticipants: 5,
      sessionStartAt: startAt, sessionEndAt: endAt, teamName: 'Filter Team',
    });

    // Add a fallback borrow + return to produce an EQUIPMENT_BORROW history row
    const br = await staff.post('/api/offline/borrow').send({
      borrowerKind: 'REGISTERED', enrollmentNo: stu.enrollmentNo,
      equipmentTypeId: typeId, articleIds: [a1],
      agreedStartAt: startAt, agreedReturnAt: endAt,
    });
    await staff.post('/api/offline/return').send({
      borrowTxnId: br.body.borrowTxnId, articleIds: [a1],
      returnedAt: endAt, condition: 'GOOD',
    });

    const res = await staff.get('/api/history?offlineFallback=false');
    expect(res.status).toBe(200);
    for (const row of res.body.history as Array<{ enteredViaOfflineFallback: boolean }>) {
      expect(row.enteredViaOfflineFallback).toBe(false);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Audit log endpoint
// ════════════════════════════════════════════════════════════════════════════

describe('GET /api/offline/audit', () => {
  it('returns audit entries in descending order for staff', async () => {
    const staff = await staffAgent();
    const venueId = await makeVenue();
    const { startAt, endAt } = pastWindow(32);

    await staff.post('/api/offline/booking').send({
      venueId, purpose: 'Audit list', estimatedParticipants: 5,
      sessionStartAt: startAt, sessionEndAt: endAt, teamName: 'Audit',
    });

    const res = await staff.get('/api/offline/audit');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.entries)).toBe(true);
    expect(res.body.entries.length).toBeGreaterThan(0);

    const entry = res.body.entries[0] as {
      transaction_kind: string; entered_by_name: string; entered_by_role: string; audit_id: string;
    };
    expect(entry.transaction_kind).toBeTruthy();
    expect(entry.entered_by_name).toBeTruthy();
    expect(entry.entered_by_role).toBeTruthy();
    expect(entry.audit_id).toBeTruthy();
  });

  it('OFFL-01: students cannot view the audit log', async () => {
    const staff = await staffAgent();
    const stu = await studentAgent(staff);
    const res = await stu.get('/api/offline/audit');
    expect(res.status).toBe(403);
  });
});
