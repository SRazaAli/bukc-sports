/**
 * Feature 10 — Usage History & Records (HIST-01..16).
 *
 * Tests cover:
 *  - HIST-03: EQUIPMENT_BORROW entries written on terminal return
 *  - HIST-02: VENUE_SESSION entries written when a session is COMPLETED/CANCELLED
 *  - HIST-05: immutability (no update or delete)
 *  - HIST-08: students/External see only their own history
 *  - HIST-09: External is scoped to VENUE_SESSION only
 *  - HIST-10: staff see full history across all users
 *  - HIST-12: filtering by kind, outcome, date range, sport category
 *  - HIST-13: staff can filter by a specific actorUserId
 *  - HIST-14: default order is reverse-chronological
 */
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { seedCreds, bc } from './setup.js';
import { db } from '../src/db/index.js';

const app = createApp();

// ── helpers ──────────────────────────────────────────────────────────────────

async function staffAgent() {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send(seedCreds);
  const bearer = { Authorization: `Bearer ${res.body.accessToken}` };
  return {
    userId: res.body.user.userId as string,
    get: (u: string) => agent.get(u).set(bearer),
    post: (u: string) => agent.post(u).set(bearer),
  };
}

let coordCounter = 0;
async function coordinatorAgent(staff: Awaited<ReturnType<typeof staffAgent>>) {
  coordCounter += 1;
  const email = `hist.coord${coordCounter}@bukc.edu.pk`;
  const inv = await staff.post('/api/auth/admin/invite-coordinator').send({
    fullName: 'Hist Coord', email, contactNumber: '03005550001',
  });
  await request(app).post('/api/auth/accept-invite').send({ token: inv.body.devToken, password: 'CoordPass1!' });
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
  const email = `hist.stu${n}@bukc.edu.pk`;
  const enrollmentNo = `84-100${n.toString().padStart(3, '0')}-100`;
  const reg = await request(app).post('/api/auth/register/student').send({
    fullName: 'Hist Student', email, contactNumber: '03001112222',
    password: 'Passw0rd!', enrollmentNo, department: 'Computer Science', programTitle: 'BS Computer Science',
  });
  await staff.post('/api/auth/admin/verify').send({ userId: reg.body.user.userId });
  const login = await request(app).post('/api/auth/login/student').send({ enrollmentNo, password: 'Passw0rd!' });
  const bearer = { Authorization: `Bearer ${login.body.accessToken}` };
  return {
    userId: reg.body.user.userId as string,
    get: (u: string) => request(app).get(u).set(bearer),
    post: (u: string) => request(app).post(u).set(bearer),
  };
}

let externalCounter = 0;
async function externalAgent(staff: Awaited<ReturnType<typeof staffAgent>>) {
  externalCounter += 1;
  const email = `hist.ext${externalCounter}@external.edu.pk`;
  const reg = await request(app).post('/api/auth/register/external').send({
    fullName: 'Hist External', email, contactNumber: '03001112233',
    password: 'Passw0rd!', institutionName: 'Test Uni', designation: 'Student',
  });
  await staff.post('/api/auth/admin/verify').send({ userId: reg.body.user.userId });
  const login = await request(app).post('/api/auth/login').send({ email, password: 'Passw0rd!' });
  const bearer = { Authorization: `Bearer ${login.body.accessToken}` };
  return {
    userId: reg.body.user.userId as string,
    get: (u: string) => request(app).get(u).set(bearer),
    post: (u: string) => request(app).post(u).set(bearer),
  };
}

async function firstSportId(): Promise<number> {
  const c = await db.selectFrom('sport_category').select('sport_category_id').orderBy('name').executeTakeFirstOrThrow();
  return c.sport_category_id;
}

async function makeEquipmentType(staff: Awaited<ReturnType<typeof staffAgent>>, name: string) {
  const res = await staff.post('/api/inventory/types').send({
    sportCategoryId: await firstSportId(), name, lendingUnit: 'SINGLE',
    lowStockThreshold: 1, maxBorrowDurationMinutes: 120,
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

/** Submit → approve → lend → return (scan GOOD) a single borrow. Returns the txnId. */
async function completeBorrow(
  staff: Awaited<ReturnType<typeof staffAgent>>,
  coord: Awaited<ReturnType<typeof coordinatorAgent>>,
  stu: Awaited<ReturnType<typeof studentAgent>>,
  typeName: string,
  barcode: string,
) {
  const typeId = await makeEquipmentType(staff, typeName);
  const articleId = await addArticle(staff, typeId, barcode);
  const { start, end } = todayWindow();
  const r = await stu.post('/api/borrow/requests').send({ equipmentTypeId: typeId, requestedStartAt: start, requestedReturnAt: end });
  await coord.post(`/api/borrow/requests/${r.body.request.borrowRequestId}/approve`).send({});
  const lend = await coord.post('/api/borrow/lend/platform').send({
    borrowRequestId: r.body.request.borrowRequestId, articleIds: [articleId], agreedStartAt: start, agreedReturnAt: end,
  });
  const txnId = lend.body.transaction.borrowTxnId as string;
  await coord.post(`/api/borrow/${txnId}/return`).send({ articleIds: [articleId], mode: 'scan', score: 90 });
  return txnId;
}

/** Submit → forward → approve a booking. Returns sessionId (first session on the calendar). */
async function makeApprovedSession(
  staff: Awaited<ReturnType<typeof staffAgent>>,
  coord: Awaited<ReturnType<typeof coordinatorAgent>>,
  requester: Awaited<ReturnType<typeof studentAgent>>,
  venueName: string,
) {
  const vRes = await staff.post('/api/venue/venues').send({ name: venueName, capacity: 30, isIndoor: true });
  const venueId = vRes.body.venue.venue_id as number;

  const start = new Date(); start.setDate(start.getDate() + 2); start.setHours(10, 0, 0, 0);
  const end = new Date(); end.setDate(end.getDate() + 2); end.setHours(12, 0, 0, 0);
  const booking = await requester.post('/api/venue/bookings').send({
    venueId, purpose: 'Hist test match', estimatedParticipants: 10,
    sessions: [{ sessionNo: 1, requestedStartAt: iso(start), requestedEndAt: iso(end), teamName: 'Team A' }],
  });
  const bookingId = booking.body.booking.bookingId as string;
  await coord.post(`/api/venue/bookings/${bookingId}/forward`).send({});
  await staff.post(`/api/venue/bookings/${bookingId}/approve`).send({});

  // Get the created session_id from the calendar
  const cal = await staff.get(`/api/venue/calendar?venueId=${venueId}`);
  const session = cal.body.sessions.find((s: { booking_id: string }) => s.booking_id === bookingId);
  return { sessionId: session.session_id as string, venueId };
}

let staff: Awaited<ReturnType<typeof staffAgent>>;
let coord: Awaited<ReturnType<typeof coordinatorAgent>>;
beforeEach(async () => {
  staff = await staffAgent();
  coord = await coordinatorAgent(staff);
});

// ════════════════════════════════════════════════════════
// HIST-03 — equipment borrow write path
// ════════════════════════════════════════════════════════
describe('Equipment borrow write path (HIST-03)', () => {
  it('T-H01: completing a borrow writes one EQUIPMENT_BORROW usage_history row with correct outcome', async () => {
    const stu = await studentAgent(staff);
    await completeBorrow(staff, coord, stu, 'Basketball', bc(900));

    const rows = await db
      .selectFrom('usage_history')
      .select(['kind', 'outcome', 'actor_user_id'])
      .where('kind', '=', 'EQUIPMENT_BORROW')
      .where('actor_user_id', '=', stu.userId)
      .execute();

    expect(rows).toHaveLength(1);
    expect(rows[0].outcome).toBe('COMPLETED');
    expect(rows[0].actor_user_id).toBe(stu.userId);
  });

  it('T-H02 HIST-03: ACTIVE/OVERDUE transactions do not appear in usage_history', async () => {
    const stu = await studentAgent(staff);
    const typeId = await makeEquipmentType(staff, 'Tennis Racket');
    const articleId = await addArticle(staff, typeId, bc(901));
    const { start, end } = todayWindow();
    const r = await stu.post('/api/borrow/requests').send({ equipmentTypeId: typeId, requestedStartAt: start, requestedReturnAt: end });
    await coord.post(`/api/borrow/requests/${r.body.request.borrowRequestId}/approve`).send({});
    await coord.post('/api/borrow/lend/platform').send({
      borrowRequestId: r.body.request.borrowRequestId, articleIds: [articleId], agreedStartAt: start, agreedReturnAt: end,
    });
    // Transaction is now ACTIVE — NOT in history
    const rows = await db
      .selectFrom('usage_history')
      .selectAll()
      .where('actor_user_id', '=', stu.userId)
      .execute();
    expect(rows).toHaveLength(0);
  });

  it('T-H03 HIST-03: COMPLETED_DAMAGED outcome is recorded correctly', async () => {
    const stu = await studentAgent(staff);
    const typeId = await makeEquipmentType(staff, 'Shuttlecock Box');
    const articleId = await addArticle(staff, typeId, bc(902));
    const { start, end } = todayWindow();
    const r = await stu.post('/api/borrow/requests').send({ equipmentTypeId: typeId, requestedStartAt: start, requestedReturnAt: end });
    await coord.post(`/api/borrow/requests/${r.body.request.borrowRequestId}/approve`).send({});
    const lend = await coord.post('/api/borrow/lend/platform').send({
      borrowRequestId: r.body.request.borrowRequestId, articleIds: [articleId], agreedStartAt: start, agreedReturnAt: end,
    });
    const txnId = lend.body.transaction.borrowTxnId as string;
    await coord.post(`/api/borrow/${txnId}/return`).send({ articleIds: [articleId], mode: 'manual', label: 'DAMAGED' });

    const row = await db
      .selectFrom('usage_history')
      .select('outcome')
      .where('actor_user_id', '=', stu.userId)
      .executeTakeFirst();
    expect(row?.outcome).toBe('COMPLETED_DAMAGED');
  });
});

// ════════════════════════════════════════════════════════
// HIST-02 — venue session write path
// ════════════════════════════════════════════════════════
describe('Venue session write path (HIST-02)', () => {
  it('T-H04 HIST-02: completing a session writes one VENUE_SESSION usage_history row', async () => {
    const stu = await studentAgent(staff);
    const { sessionId } = await makeApprovedSession(staff, coord, stu, 'Court Alpha');

    const complete = await coord.post(`/api/venue/sessions/${sessionId}/complete`);
    expect(complete.status).toBe(200);

    const rows = await db
      .selectFrom('usage_history')
      .select(['kind', 'outcome', 'session_id'])
      .where('session_id', '=', sessionId)
      .execute();

    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('VENUE_SESSION');
    expect(rows[0].outcome).toBe('COMPLETED');
  });

  it('T-H05 HIST-02: cancelling a session writes a CANCELLED usage_history row', async () => {
    const stu = await studentAgent(staff);
    const { sessionId } = await makeApprovedSession(staff, coord, stu, 'Court Beta');

    const cancel = await coord.post(`/api/venue/sessions/${sessionId}/cancel`).send({ reason: 'Venue flooded' });
    expect(cancel.status).toBe(200);

    const row = await db
      .selectFrom('usage_history')
      .select(['kind', 'outcome'])
      .where('session_id', '=', sessionId)
      .executeTakeFirst();

    expect(row?.outcome).toBe('CANCELLED');
  });

  it('T-H06 HIST-02: cannot complete a session twice', async () => {
    const stu = await studentAgent(staff);
    const { sessionId } = await makeApprovedSession(staff, coord, stu, 'Court Gamma');
    await coord.post(`/api/venue/sessions/${sessionId}/complete`);
    const res = await coord.post(`/api/venue/sessions/${sessionId}/complete`);
    expect(res.status).toBe(409);
  });

  it('T-H07: cannot cancel a session that is already completed', async () => {
    const stu = await studentAgent(staff);
    const { sessionId } = await makeApprovedSession(staff, coord, stu, 'Court Delta');
    await coord.post(`/api/venue/sessions/${sessionId}/complete`);
    const res = await coord.post(`/api/venue/sessions/${sessionId}/cancel`).send({ reason: 'Oops' });
    expect(res.status).toBe(409);
  });

  it('T-H08: cancel without a reason body is rejected 400', async () => {
    const stu = await studentAgent(staff);
    const { sessionId } = await makeApprovedSession(staff, coord, stu, 'Court Epsilon');
    const res = await coord.post(`/api/venue/sessions/${sessionId}/cancel`).send({});
    expect(res.status).toBe(400);
  });
});

// ════════════════════════════════════════════════════════
// HIST-05 — immutability
// ════════════════════════════════════════════════════════
describe('Immutability (HIST-05)', () => {
  it('T-H09 HIST-05: DB trigger rejects UPDATE on a usage_history row', async () => {
    const stu = await studentAgent(staff);
    await completeBorrow(staff, coord, stu, 'Volleyball', bc(903));

    const row = await db
      .selectFrom('usage_history')
      .select('history_id')
      .where('actor_user_id', '=', stu.userId)
      .executeTakeFirstOrThrow();

    await expect(
      db.updateTable('usage_history').set({ outcome: 'TAMPERED' }).where('history_id', '=', row.history_id).execute(),
    ).rejects.toThrow();
  });

  it('T-H10 HIST-05: DB trigger rejects DELETE on a usage_history row', async () => {
    const stu = await studentAgent(staff);
    await completeBorrow(staff, coord, stu, 'Handball', bc(904));

    const row = await db
      .selectFrom('usage_history')
      .select('history_id')
      .where('actor_user_id', '=', stu.userId)
      .executeTakeFirstOrThrow();

    await expect(
      db.deleteFrom('usage_history').where('history_id', '=', row.history_id).execute(),
    ).rejects.toThrow();
  });
});

// ════════════════════════════════════════════════════════
// HIST-08/09/10 — visibility by role
// ════════════════════════════════════════════════════════
describe('Visibility rules (HIST-08/09/10)', () => {
  it('T-H11 HIST-08: a student sees only their own history, not another student\'s', async () => {
    const stu1 = await studentAgent(staff);
    const stu2 = await studentAgent(staff);
    await completeBorrow(staff, coord, stu1, 'Frisbee', bc(905));
    await completeBorrow(staff, coord, stu2, 'Rugby Ball', bc(906));

    const res = await stu1.get('/api/history');
    expect(res.status).toBe(200);
    const ids = res.body.history.map((h: { borrowTxnId: string }) => h.borrowTxnId);
    // stu1 sees their borrow; stu2's borrow is not visible
    expect(ids.length).toBe(1);
    const row = res.body.history[0];
    expect(row.borrowerName).not.toBeNull();
  });

  it('T-H12 HIST-10: staff see all users\' history', async () => {
    const stu1 = await studentAgent(staff);
    const stu2 = await studentAgent(staff);
    await completeBorrow(staff, coord, stu1, 'Cricket Bat H', bc(907));
    await completeBorrow(staff, coord, stu2, 'Tennis Ball H', bc(908));

    const res = await staff.get('/api/history');
    expect(res.status).toBe(200);
    // Both borrows are visible to staff
    const userIds = res.body.history.map((h: { historyId: number }) => h.historyId);
    expect(userIds.length).toBeGreaterThanOrEqual(2);
  });

  it('T-H13 HIST-09: External user can only see VENUE_SESSION history', async () => {
    const ext = await externalAgent(staff);
    // External cannot borrow equipment — so just check the endpoint respects kind filter
    const res = await ext.get('/api/history?kind=EQUIPMENT_BORROW');
    expect(res.status).toBe(403);
  });

  it('T-H14 HIST-08: a student cannot pass actorUserId to cross-query another user', async () => {
    const stu = await studentAgent(staff);
    const res = await stu.get(`/api/history?actorUserId=${staff.userId}`);
    expect(res.status).toBe(403);
  });
});

// ════════════════════════════════════════════════════════
// HIST-12/13 — filters
// ════════════════════════════════════════════════════════
describe('Filtering (HIST-12/13)', () => {
  it('T-H15 HIST-12: filter by kind=EQUIPMENT_BORROW returns only borrow rows', async () => {
    const stu = await studentAgent(staff);
    await completeBorrow(staff, coord, stu, 'Netball H', bc(909));
    // Also make a venue session so both kinds exist
    const { sessionId } = await makeApprovedSession(staff, coord, stu, 'Court Filter');
    await coord.post(`/api/venue/sessions/${sessionId}/complete`);

    const res = await staff.get('/api/history?kind=EQUIPMENT_BORROW');
    expect(res.status).toBe(200);
    const kinds = res.body.history.map((h: { kind: string }) => h.kind);
    expect(kinds.every((k: string) => k === 'EQUIPMENT_BORROW')).toBe(true);
  });

  it('T-H16 HIST-12: filter by kind=VENUE_SESSION returns only session rows', async () => {
    const stu = await studentAgent(staff);
    await completeBorrow(staff, coord, stu, 'Hockey H', bc(910));
    const { sessionId } = await makeApprovedSession(staff, coord, stu, 'Court Filter2');
    await coord.post(`/api/venue/sessions/${sessionId}/complete`);

    const res = await staff.get('/api/history?kind=VENUE_SESSION');
    expect(res.status).toBe(200);
    const kinds = res.body.history.map((h: { kind: string }) => h.kind);
    expect(kinds.every((k: string) => k === 'VENUE_SESSION')).toBe(true);
  });

  it('T-H17 HIST-12: filter by outcome=COMPLETED returns only COMPLETED rows', async () => {
    const stu = await studentAgent(staff);
    await completeBorrow(staff, coord, stu, 'Squash Racket', bc(911));
    // Also create a COMPLETED_DAMAGED one
    const typeId = await makeEquipmentType(staff, 'Squash Ball');
    const aId = await addArticle(staff, typeId, bc(912));
    const { start, end } = todayWindow();
    const r = await stu.post('/api/borrow/requests').send({ equipmentTypeId: typeId, requestedStartAt: start, requestedReturnAt: end });
    await coord.post(`/api/borrow/requests/${r.body.request.borrowRequestId}/approve`).send({});
    const lend = await coord.post('/api/borrow/lend/platform').send({
      borrowRequestId: r.body.request.borrowRequestId, articleIds: [aId], agreedStartAt: start, agreedReturnAt: end,
    });
    await coord.post(`/api/borrow/${lend.body.transaction.borrowTxnId}/return`).send({ articleIds: [aId], mode: 'manual', label: 'DAMAGED' });

    const res = await staff.get('/api/history?outcome=COMPLETED');
    expect(res.status).toBe(200);
    const outcomes = res.body.history.map((h: { outcome: string }) => h.outcome);
    expect(outcomes.every((o: string) => o === 'COMPLETED')).toBe(true);
  });

  it('T-H18 HIST-13: staff can filter by a specific actorUserId', async () => {
    const stu1 = await studentAgent(staff);
    const stu2 = await studentAgent(staff);
    await completeBorrow(staff, coord, stu1, 'Table Tennis Bat', bc(913));
    await completeBorrow(staff, coord, stu2, 'Badminton Racket', bc(914));

    const res = await staff.get(`/api/history?actorUserId=${stu1.userId}`);
    expect(res.status).toBe(200);
    expect(res.body.history).toHaveLength(1);
    expect(res.body.history[0].borrowerName).toBe('Hist Student');
  });

  it('T-H19 HIST-12: filter by date range limits results', async () => {
    const stu = await studentAgent(staff);
    await completeBorrow(staff, coord, stu, 'Goalpost H', bc(915));

    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

    // within range → finds it
    const within = await staff.get(`/api/history?from=${yesterday}&to=${tomorrow}`);
    expect(within.status).toBe(200);
    expect(within.body.history.length).toBeGreaterThanOrEqual(1);

    // future range → finds nothing for this user
    const future = await staff.get(`/api/history?from=${tomorrow}&actorUserId=${stu.userId}`);
    expect(future.status).toBe(200);
    expect(future.body.history).toHaveLength(0);
  });
});

// ════════════════════════════════════════════════════════
// HIST-14 — ordering + pagination
// ════════════════════════════════════════════════════════
describe('Order and pagination (HIST-14)', () => {
  it('T-H20 HIST-14: results are in reverse-chronological order (most recent first)', async () => {
    const stu = await studentAgent(staff);
    await completeBorrow(staff, coord, stu, 'Box Gloves', bc(916));
    await completeBorrow(staff, coord, stu, 'Speed Rope', bc(917));

    const res = await staff.get(`/api/history?actorUserId=${stu.userId}`);
    expect(res.status).toBe(200);
    expect(res.body.history.length).toBe(2);
    // recorded_at of first row should be >= second row
    const [a, b] = res.body.history as { recordedAt: string }[];
    expect(new Date(a.recordedAt).getTime()).toBeGreaterThanOrEqual(new Date(b.recordedAt).getTime());
  });

  it('T-H21: total count and pagination limit work correctly', async () => {
    const stu = await studentAgent(staff);
    await completeBorrow(staff, coord, stu, 'Medicine Ball', bc(918));
    await completeBorrow(staff, coord, stu, 'Balance Board', bc(919));
    await completeBorrow(staff, coord, stu, 'Resistance Band', bc(920));

    const page1 = await staff.get(`/api/history?actorUserId=${stu.userId}&limit=2&offset=0`);
    expect(page1.status).toBe(200);
    expect(page1.body.history).toHaveLength(2);
    expect(page1.body.total).toBe(3);

    const page2 = await staff.get(`/api/history?actorUserId=${stu.userId}&limit=2&offset=2`);
    expect(page2.status).toBe(200);
    expect(page2.body.history).toHaveLength(1);
  });
});

// ════════════════════════════════════════════════════════
// API — misc guards
// ════════════════════════════════════════════════════════
describe('API guards', () => {
  it('T-H22: unauthenticated request to /api/history returns 401', async () => {
    const res = await request(app).get('/api/history');
    expect(res.status).toBe(401);
  });

  it('T-H23: invalid date format in from/to returns 400', async () => {
    const res = await staff.get('/api/history?from=notadate');
    expect(res.status).toBe(400);
  });
});
