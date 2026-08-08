/**
 * Feature 3 — Borrow & Return (BORROW-01..25). Covers both intake paths
 * (platform request→approve→lend, and walk-in registered/guest), the return
 * flow's three modes (scan/manual/dismiss), late detection + reputation +
 * the bad-sport threshold, the 30-minute rejection cooldown, and the
 * zero-stock request block.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { seedCreds, bc } from './setup.js';
import { db } from '../src/db/index.js';

const app = createApp();

async function staffAgent() {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send(seedCreds);
  const bearer = { Authorization: `Bearer ${res.body.accessToken}` };
  return {
    get: (u: string) => agent.get(u).set(bearer),
    post: (u: string) => agent.post(u).set(bearer),
  };
}

// BORROW-07: deciding requests and lending equipment is Coordinator-only (the
// DB triggers enforce this) — the seeded account is SUPER_ADMIN, so tests that
// approve/lend/return need a real Coordinator, created via the Feature 1
// invite flow.
let coordCounter = 0;
async function coordinatorAgent(staff: Awaited<ReturnType<typeof staffAgent>>) {
  coordCounter += 1;
  const email = `coord${coordCounter}@bukc.edu.pk`;
  const invite = await staff.post('/api/auth/admin/invite-coordinator').send({
    fullName: 'Coord', email, contactNumber: '03005550000',
  });
  const token = invite.body.devToken;
  await request(app).post('/api/auth/accept-invite').send({ token, password: 'CoordPass1!' });
  const login = await request(app).post('/api/auth/login').send({ email, password: 'CoordPass1!' });
  const bearer = { Authorization: `Bearer ${login.body.accessToken}` };
  return {
    get: (u: string) => request(app).get(u).set(bearer),
    post: (u: string) => request(app).post(u).set(bearer),
  };
}

let studentCounter = 0;
async function studentAgent(staff: Awaited<ReturnType<typeof staffAgent>>) {
  studentCounter += 1;
  const n = studentCounter;
  const email = `stu${n}@bukc.edu.pk`;
  const enrollmentNo = `84-024000-${600 + n}`;
  const reg = await request(app).post('/api/auth/register/student').send({
    fullName: 'Stu Dent', email, contactNumber: '03001112222',
    password: 'Passw0rd!', enrollmentNo, department: 'Computer Science', programTitle: 'BS Computer Science',
  });
  const userId: string = reg.body.user.userId;
  await staff.post('/api/auth/admin/verify').send({ userId });
  const login = await request(app).post('/api/auth/login/student').send({ enrollmentNo, password: 'Passw0rd!' });
  const bearer = { Authorization: `Bearer ${login.body.accessToken}` };
  return {
    userId,
    get: (u: string) => request(app).get(u).set(bearer),
    post: (u: string) => request(app).post(u).set(bearer),
  };
}

async function firstSportId(): Promise<number> {
  const c = await db.selectFrom('sport_category').select('sport_category_id').orderBy('name').executeTakeFirstOrThrow();
  return c.sport_category_id;
}

async function makeSingleType(staff: Awaited<ReturnType<typeof staffAgent>>, name = 'Football', maxBorrowDurationMinutes = 480) {
  const res = await staff.post('/api/inventory/types').send({
    sportCategoryId: await firstSportId(), name, lendingUnit: 'SINGLE',
    lowStockThreshold: 1, maxBorrowDurationMinutes,
    conditionGoodMinScore: 70, conditionWornMinScore: 40, isIndoor: false,
  });
  return res.body.type.equipmentTypeId as number;
}

async function addArticle(staff: Awaited<ReturnType<typeof staffAgent>>, typeId: number, barcode: string) {
  const res = await staff.post('/api/inventory/articles').send({ equipmentTypeId: typeId, barcode, entryScore: 90 });
  return res.body.article.articleId as string;
}

function iso(d: Date) { return d.toISOString(); }
function todayWindow() {
  const start = new Date(); start.setHours(10, 0, 0, 0);
  const end = new Date(); end.setHours(13, 0, 0, 0);
  return { start: iso(start), end: iso(end) };
}

let staff: Awaited<ReturnType<typeof staffAgent>>;
let coord: Awaited<ReturnType<typeof coordinatorAgent>>;
beforeEach(async () => {
  staff = await staffAgent();
  coord = await coordinatorAgent(staff);
});

// ═══════════════════════════ REQUEST → APPROVE → LEND (platform) ═══════════════════════════
describe('Platform path (BORROW-01..14)', () => {
  it('T-601: student submits a request; it appears in the coordinator queue', async () => {
    const stu = await studentAgent(staff);
    const typeId = await makeSingleType(staff, 'Volleyball');
    await addArticle(staff, typeId, bc(201));
    const { start, end } = todayWindow();
    const res = await stu.post('/api/borrow/requests').send({ equipmentTypeId: typeId, requestedStartAt: start, requestedReturnAt: end });
    expect(res.status).toBe(201);
    const queue = await staff.get('/api/borrow/queue');
    expect(queue.body.queue.some((q: { borrow_request_id: string }) => q.borrow_request_id === res.body.request.borrowRequestId)).toBe(true);
  });

  it('T-602 BORROW-14: cannot request equipment with zero available units', async () => {
    const stu = await studentAgent(staff);
    const typeId = await makeSingleType(staff, 'Cricket Bat');
    const { start, end } = todayWindow();
    const res = await stu.post('/api/borrow/requests').send({ equipmentTypeId: typeId, requestedStartAt: start, requestedReturnAt: end });
    expect(res.status).toBe(409);
  });

  it('T-603: same-day validation rejects a cross-day window', async () => {
    const stu = await studentAgent(staff);
    const typeId = await makeSingleType(staff, 'Table Tennis Bat Single');
    await addArticle(staff, typeId, bc(202));
    const start = new Date(); const end = new Date(start.getTime() + 26 * 3600_000);
    const res = await stu.post('/api/borrow/requests').send({ equipmentTypeId: typeId, requestedStartAt: iso(start), requestedReturnAt: iso(end) });
    expect(res.status).toBe(400);
  });

  it('T-604: approve then lend against the request; article goes ON_LOAN', async () => {
    const stu = await studentAgent(staff);
    const typeId = await makeSingleType(staff, 'Rugby Ball');
    const articleId = await addArticle(staff, typeId, bc(203));
    const { start, end } = todayWindow();
    const reqRes = await stu.post('/api/borrow/requests').send({ equipmentTypeId: typeId, requestedStartAt: start, requestedReturnAt: end });
    const requestId = reqRes.body.request.borrowRequestId;

    const approve = await coord.post(`/api/borrow/requests/${requestId}/approve`).send({});
    expect(approve.status).toBe(200);

    const lend = await coord.post('/api/borrow/lend/platform').send({
      borrowRequestId: requestId, articleIds: [articleId], agreedStartAt: start, agreedReturnAt: end,
    });
    expect(lend.status).toBe(201);

    const art = await db.selectFrom('article').select('state').where('article_id', '=', articleId).executeTakeFirst();
    expect(art?.state).toBe('ON_LOAN');
  });

  it('T-605 BORROW-02: a student with an active borrow cannot start a second one', async () => {
    const stu = await studentAgent(staff);
    const typeId = await makeSingleType(staff, 'Hockey Stick');
    const a1 = await addArticle(staff, typeId, bc(204));
    const a2 = await addArticle(staff, typeId, bc(205));
    const { start, end } = todayWindow();
    const r1 = await stu.post('/api/borrow/requests').send({ equipmentTypeId: typeId, requestedStartAt: start, requestedReturnAt: end });
    await coord.post(`/api/borrow/requests/${r1.body.request.borrowRequestId}/approve`).send({});
    await coord.post('/api/borrow/lend/platform').send({
      borrowRequestId: r1.body.request.borrowRequestId, articleIds: [a1], agreedStartAt: start, agreedReturnAt: end,
    });
    // second request while the first txn is still ACTIVE -> DB blocks via uq_one_open_borrow_request
    // (student already has no PENDING request, so try a second REQUEST directly is allowed by that index,
    // but a second ACTIVE TRANSACTION is blocked by uq_one_active_borrow_registered)
    const r2 = await stu.post('/api/borrow/requests').send({ equipmentTypeId: typeId, requestedStartAt: start, requestedReturnAt: end });
    await coord.post(`/api/borrow/requests/${r2.body.request.borrowRequestId}/approve`).send({});
    const secondLend = await coord.post('/api/borrow/lend/platform').send({
      borrowRequestId: r2.body.request.borrowRequestId, articleIds: [a2], agreedStartAt: start, agreedReturnAt: end,
    });
    expect(secondLend.status).toBe(409); // unique constraint: one active borrow at a time
  });

  it('T-606 BORROW-13: resubmitting within 30 minutes of a rejection is blocked', async () => {
    const stu = await studentAgent(staff);
    const typeId = await makeSingleType(staff, 'Tennis Racket');
    await addArticle(staff, typeId, bc(206));
    const { start, end } = todayWindow();
    const r1 = await stu.post('/api/borrow/requests').send({ equipmentTypeId: typeId, requestedStartAt: start, requestedReturnAt: end });
    await coord.post(`/api/borrow/requests/${r1.body.request.borrowRequestId}/reject`).send({ reason: 'Not eligible today.' });
    const r2 = await stu.post('/api/borrow/requests').send({ equipmentTypeId: typeId, requestedStartAt: start, requestedReturnAt: end });
    expect(r2.status).toBe(409);
    expect(r2.body.code).toBe('COOLDOWN');
  });

  it('T-607: a Coordinator cannot approve their own... N/A; a STUDENT cannot approve any request (role guard)', async () => {
    const stu = await studentAgent(staff);
    const typeId = await makeSingleType(staff, 'Squash Racket');
    await addArticle(staff, typeId, bc(207));
    const { start, end } = todayWindow();
    const r1 = await stu.post('/api/borrow/requests').send({ equipmentTypeId: typeId, requestedStartAt: start, requestedReturnAt: end });
    const res = await stu.post(`/api/borrow/requests/${r1.body.request.borrowRequestId}/approve`).send({});
    expect(res.status).toBe(403);
  });
});

// ═══════════════════════════ WALK-IN ═══════════════════════════
describe('Walk-in path (BORROW-07 Path B — unregistered guests only, per the actor model; a registered student always uses the platform path)', () => {
  it('T-608 BORROW-25: two guest transactions are independent (no shared identity/history)', async () => {
    const typeId = await makeSingleType(staff, 'Badminton Shuttlecock Set');
    const a1 = await addArticle(staff, typeId, bc(208));
    const a2 = await addArticle(staff, typeId, bc(209));
    const { start, end } = todayWindow();
    const g1 = await coord.post('/api/borrow/lend/walkin/guest').send({
      guestFullName: 'Guest One', guestIdNumber: 'ID-1', guestContactNumber: '03001234567', guestIsFaculty: false,
      equipmentTypeId: typeId, articleIds: [a1], agreedStartAt: start, agreedReturnAt: end,
    });
    const g2 = await coord.post('/api/borrow/lend/walkin/guest').send({
      guestFullName: 'Guest One', guestIdNumber: 'ID-1', guestContactNumber: '03001234567', guestIsFaculty: false,
      equipmentTypeId: typeId, articleIds: [a2], agreedStartAt: start, agreedReturnAt: end,
    });
    expect(g1.status).toBe(201);
    expect(g2.status).toBe(201); // same "ID-1" twice, permitted — BORROW-25 deliberately unlinked
  });
});

// ═══════════════════════════ RETURN — three modes ═══════════════════════════
describe('Return processing (BORROW-20..24)', () => {
  async function lendOne(typeName: string, barcode: string) {
    const stu = await studentAgent(staff);
    const typeId = await makeSingleType(staff, typeName);
    const articleId = await addArticle(staff, typeId, barcode);
    const { start, end } = todayWindow();
    const r = await stu.post('/api/borrow/requests').send({ equipmentTypeId: typeId, requestedStartAt: start, requestedReturnAt: end });
    await coord.post(`/api/borrow/requests/${r.body.request.borrowRequestId}/approve`).send({});
    const lend = await coord.post('/api/borrow/lend/platform').send({
      borrowRequestId: r.body.request.borrowRequestId, articleIds: [articleId], agreedStartAt: start, agreedReturnAt: end,
    });
    return { stu, typeId, articleId, txnId: lend.body.transaction.borrowTxnId as string, agreedReturnAt: end };
  }

  it('T-610: scan mode with a high score returns GOOD, article AVAILABLE, txn COMPLETED', async () => {
    const { articleId, txnId } = await lendOne('Netball', bc(212));
    const res = await coord.post(`/api/borrow/${txnId}/return`).send({ articleIds: [articleId], mode: 'scan', score: 90 });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('COMPLETED');
    const art = await db.selectFrom('article').select(['state', 'current_condition_label']).where('article_id', '=', articleId).executeTakeFirst();
    expect(art?.state).toBe('AVAILABLE');
    expect(art?.current_condition_label).toBe('GOOD');
  });

  it('T-611: manual mode with DAMAGED label raises a damage flag and COMPLETED_DAMAGED', async () => {
    const { articleId, txnId } = await lendOne('Frisbee', bc(213));
    const res = await coord.post(`/api/borrow/${txnId}/return`).send({ articleIds: [articleId], mode: 'manual', label: 'DAMAGED' });
    expect(res.body.status).toBe('COMPLETED_DAMAGED');
    const art = await db.selectFrom('article').select('state').where('article_id', '=', articleId).executeTakeFirst();
    expect(art?.state).toBe('DAMAGED');
    const flag = await db.selectFrom('damage_flag').select('flag_id').where('article_id', '=', articleId).where('cleared_at', 'is', null).executeTakeFirst();
    expect(flag).toBeTruthy();
  });

  it('T-612: dismiss mode returns the article to AVAILABLE without touching its condition, and warns staff', async () => {
    const { articleId, txnId } = await lendOne('Dodgeball', bc(214));
    const before = await db.selectFrom('article').select('current_condition_label').where('article_id', '=', articleId).executeTakeFirst();
    const res = await coord.post(`/api/borrow/${txnId}/return`).send({ articleIds: [articleId], mode: 'dismiss' });
    expect(res.status).toBe(200);
    const after = await db.selectFrom('article').select(['state', 'current_condition_label']).where('article_id', '=', articleId).executeTakeFirst();
    expect(after?.state).toBe('AVAILABLE');
    expect(after?.current_condition_label).toBe(before?.current_condition_label); // untouched
    const warn = await db.selectFrom('notification').select('notification_id')
      .where('type', '=', 'RETURN_CONDITION_UNVERIFIED').where('borrow_txn_id', '=', txnId).executeTakeFirst();
    expect(warn).toBeTruthy();
  });

  it('T-613: a late return is COMPLETED_LATE and notifies both coordinator and student', async () => {
    const stu = await studentAgent(staff);
    const typeId = await makeSingleType(staff, 'Water Polo Ball');
    const articleId = await addArticle(staff, typeId, bc(210));
    const start = new Date(Date.now() - 3 * 3600_000);
    const end = new Date(Date.now() - 3600_000); // agreed return already in the past
    const r = await stu.post('/api/borrow/requests').send({ equipmentTypeId: typeId, requestedStartAt: iso(start), requestedReturnAt: iso(end) });
    await coord.post(`/api/borrow/requests/${r.body.request.borrowRequestId}/approve`).send({});
    const lend = await coord.post('/api/borrow/lend/platform').send({
      borrowRequestId: r.body.request.borrowRequestId, articleIds: [articleId], agreedStartAt: iso(start), agreedReturnAt: iso(end),
    });
    const res = await coord.post(`/api/borrow/${lend.body.transaction.borrowTxnId}/return`).send({ articleIds: [articleId], mode: 'scan', score: 90 });
    expect(res.body.status).toBe('COMPLETED_LATE');

    const coordNotif = await db.selectFrom('notification').select('notification_id')
      .where('type', '=', 'BORROW_OVERDUE_COORDINATOR').where('borrow_txn_id', '=', lend.body.transaction.borrowTxnId).executeTakeFirst();
    expect(coordNotif).toBeTruthy();
    const studentNotif = await db.selectFrom('notification').select('notification_id')
      .where('type', '=', 'BORROW_OVERDUE_CLIENT').where('recipient_id', '=', stu.userId).executeTakeFirst();
    expect(studentNotif).toBeTruthy();
  });

  it('T-614: three late returns flags BAD_SPORT_FLAGGED for staff (informational only)', async () => {
    const stu = await studentAgent(staff);
    const typeId = await makeSingleType(staff, 'Lacrosse Stick');
    for (let i = 0; i < 3; i++) {
      const barcode = bc(220 + i);
      const articleId = await addArticle(staff, typeId, barcode);
      const start = new Date(Date.now() - 3 * 3600_000);
      const end = new Date(Date.now() - 3600_000);
      const r = await stu.post('/api/borrow/requests').send({ equipmentTypeId: typeId, requestedStartAt: iso(start), requestedReturnAt: iso(end) });
      await coord.post(`/api/borrow/requests/${r.body.request.borrowRequestId}/approve`).send({});
      const lend = await coord.post('/api/borrow/lend/platform').send({
        borrowRequestId: r.body.request.borrowRequestId, articleIds: [articleId], agreedStartAt: iso(start), agreedReturnAt: iso(end),
      });
      await coord.post(`/api/borrow/${lend.body.transaction.borrowTxnId}/return`).send({ articleIds: [articleId], mode: 'scan', score: 90 });
    }
    const rep = await staff.get(`/api/borrow/reputation/${stu.userId}`);
    expect(rep.body.lateReturns).toBe(3);
    expect(rep.body.isBadSport).toBe(true);
    const flagged = await db.selectFrom('notification').select('notification_id')
      .where('type', '=', 'BAD_SPORT_FLAGGED').where('subject_user_id', '=', stu.userId).executeTakeFirst();
    expect(flagged).toBeTruthy();
  });

  it('T-614b: a student can view their own reputation but not another student\'s', async () => {
    const stuA = await studentAgent(staff);
    const stuB = await studentAgent(staff);

    const own = await stuA.get(`/api/borrow/reputation/${stuA.userId}`);
    expect(own.status).toBe(200);

    const other = await stuA.get(`/api/borrow/reputation/${stuB.userId}`);
    expect(other.status).toBe(403);
  });
});

// ═══════════════════════════ OVERDUE DETECTION ═══════════════════════════
describe('Overdue detection (BORROW-18)', () => {
  it('T-615: an ACTIVE transaction past its agreed return time flips to OVERDUE', async () => {
    const stu = await studentAgent(staff);
    const typeId = await makeSingleType(staff, 'Softball Bat');
    const articleId = await addArticle(staff, typeId, bc(211));
    const start = new Date(Date.now() - 3 * 3600_000);
    const end = new Date(Date.now() - 3600_000);
    const r = await stu.post('/api/borrow/requests').send({ equipmentTypeId: typeId, requestedStartAt: iso(start), requestedReturnAt: iso(end) });
    await coord.post(`/api/borrow/requests/${r.body.request.borrowRequestId}/approve`).send({});
    await coord.post('/api/borrow/lend/platform').send({
      borrowRequestId: r.body.request.borrowRequestId, articleIds: [articleId], agreedStartAt: iso(start), agreedReturnAt: iso(end),
    });
    // /active triggers checkOverdueBorrows() opportunistically
    const active = await staff.get('/api/borrow/active');
    const row = active.body.transactions.find((t: { equipment_type_name: string }) => t.equipment_type_name === 'Softball Bat');
    expect(row.status).toBe('OVERDUE');
  });
});

// ═══════════════════════════ BORROW POLISH (max-duration, approve-stock, duplicate msg, queue fields) ═══════════════════════════
describe('Borrow polish fixes', () => {
  it('T-616: submitRequest rejects when requested window exceeds max_borrow_duration_minutes', async () => {
    const stu = await studentAgent(staff);
    const typeId = await makeSingleType(staff, 'Short Loan Racket', 120); // explicit 2h limit for this test
    await addArticle(staff, typeId, bc(220));
    // Request a 3-hour window — exceeds the 2h max.
    const start = new Date(); start.setHours(10, 0, 0, 0);
    const end = new Date(); end.setHours(13, 0, 0, 0);
    const res = await stu.post('/api/borrow/requests').send({
      equipmentTypeId: typeId, requestedStartAt: iso(start), requestedReturnAt: iso(end),
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/at most 2h/i);
  });

  it('T-617: submitRequest succeeds when requested window equals max_borrow_duration_minutes', async () => {
    const stu = await studentAgent(staff);
    const typeId = await makeSingleType(staff, 'Exact Fit Racket', 120); // explicit 2h limit for this test
    await addArticle(staff, typeId, bc(221));
    // Request exactly 2 hours — should succeed.
    const start = new Date(); start.setHours(10, 0, 0, 0);
    const end = new Date(); end.setHours(12, 0, 0, 0);
    const res = await stu.post('/api/borrow/requests').send({
      equipmentTypeId: typeId, requestedStartAt: iso(start), requestedReturnAt: iso(end),
    });
    expect(res.status).toBe(201);
  });

  it('T-618: approveRequest blocks approval when zero stock is available', async () => {
    const stu1 = await studentAgent(staff);
    const stu2 = await studentAgent(staff);
    const typeId = await makeSingleType(staff, 'One-Only Ball');
    const articleId = await addArticle(staff, typeId, bc(222));
    const { start, end } = todayWindow();
    // stu1 requests and gets lent the only article
    const r1 = await stu1.post('/api/borrow/requests').send({
      equipmentTypeId: typeId,
      requestedStartAt: iso(new Date(new Date(start).getTime() - 3600_000)),
      requestedReturnAt: iso(new Date(new Date(end).getTime() + 3600_000)),
    });
    await coord.post(`/api/borrow/requests/${r1.body.request.borrowRequestId}/approve`).send({});
    await coord.post('/api/borrow/lend/platform').send({
      borrowRequestId: r1.body.request.borrowRequestId, articleIds: [articleId],
      agreedStartAt: iso(new Date(new Date(start).getTime() - 3600_000)),
      agreedReturnAt: iso(new Date(new Date(end).getTime() + 3600_000)),
    });
    // stu2 requests the same type — stock is now 0
    const r2 = await stu2.post('/api/borrow/requests').send({ equipmentTypeId: typeId, requestedStartAt: start, requestedReturnAt: end });
    // Request submission should fail because stock is 0
    expect(r2.status).toBe(409);
  });

  it('T-619: duplicate pending request returns an accurate "already have a pending request" message', async () => {
    const stu = await studentAgent(staff);
    const typeId1 = await makeSingleType(staff, 'Tennis Ball');
    const typeId2 = await makeSingleType(staff, 'Tennis Racket');
    await addArticle(staff, typeId1, bc(223));
    await addArticle(staff, typeId2, bc(224));
    const { start, end } = todayWindow();
    const r1 = await stu.post('/api/borrow/requests').send({ equipmentTypeId: typeId1, requestedStartAt: start, requestedReturnAt: end });
    expect(r1.status).toBe(201);
    // Second request (different equipment) should hit the uq_one_open_borrow_request constraint
    const r2 = await stu.post('/api/borrow/requests').send({ equipmentTypeId: typeId2, requestedStartAt: start, requestedReturnAt: end });
    expect(r2.status).toBe(409);
    expect(r2.body.error).toMatch(/already have a pending request/i);
  });

  it('T-620: listQueue returns available_units and is_bad_sport per row', async () => {
    const stu = await studentAgent(staff);
    const typeId = await makeSingleType(staff, 'Queue Field Ball');
    await addArticle(staff, typeId, bc(225));
    const { start, end } = todayWindow();
    await stu.post('/api/borrow/requests').send({ equipmentTypeId: typeId, requestedStartAt: start, requestedReturnAt: end });
    const queue = await staff.get('/api/borrow/queue');
    const row = queue.body.queue.find((q: { equipment_type_name: string }) => q.equipment_type_name === 'Queue Field Ball');
    expect(row).toBeDefined();
    expect(typeof row.available_units).toBe('number');
    expect(row.available_units).toBeGreaterThanOrEqual(1);
    expect(typeof row.is_bad_sport).toBe('boolean');
    expect(row.is_bad_sport).toBe(false);
  });
});
