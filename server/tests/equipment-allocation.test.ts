/**
 * Event equipment allocation (VENUE-13/15/16/17, EQUIP-AVAIL-11..21).
 * Covers the shortfall round-trip (same booking_id throughout, per product
 * decision), atomic materialization at approval, the T-24hr lock + alert
 * (and its silence-is-confirmation counterpart), swaps, and post-event
 * release including the parent booking's own completion.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { seedCreds, bc } from './setup.js';
import { db } from '../src/db/index.js';
import { checkEquipmentLocks, checkPostEventRelease } from '../src/features/venue/equipment.js';

const app = createApp();

async function staffAgent() {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send(seedCreds);
  const bearer = { Authorization: `Bearer ${res.body.accessToken}` };
  return { get: (u: string) => agent.get(u).set(bearer), post: (u: string) => agent.post(u).set(bearer) };
}
let coordCounter = 0;
async function coordinatorAgent(staff: Awaited<ReturnType<typeof staffAgent>>) {
  coordCounter += 1;
  const email = `eacoord${coordCounter}@bukc.edu.pk`;
  const invite = await staff.post('/api/auth/admin/invite-coordinator').send({ fullName: 'EACoord', email, contactNumber: '03005550000' });
  await request(app).post('/api/auth/accept-invite').send({ token: invite.body.devToken, password: 'CoordPass1!' });
  const login = await request(app).post('/api/auth/login').send({ email, password: 'CoordPass1!' });
  const bearer = { Authorization: `Bearer ${login.body.accessToken}` };
  return { get: (u: string) => request(app).get(u).set(bearer), post: (u: string) => request(app).post(u).set(bearer) };
}
let studentCounter = 0;
async function studentAgent(staff: Awaited<ReturnType<typeof staffAgent>>) {
  studentCounter += 1;
  const n = studentCounter;
  const email = `eastu${n}@bukc.edu.pk`;
  const enrollmentNo = `84-024000-${900 + n}`;
  const reg = await request(app).post('/api/auth/register/student').send({
    fullName: 'EA Stu', email, contactNumber: '03001112222', password: 'Passw0rd!',
    enrollmentNo, department: 'Computer Science', programTitle: 'BS Computer Science',
  });
  const userId: string = reg.body.user.userId;
  await staff.post('/api/auth/admin/verify').send({ userId });
  const login = await request(app).post('/api/auth/login/student').send({ enrollmentNo, password: 'Passw0rd!' });
  const bearer = { Authorization: `Bearer ${login.body.accessToken}` };
  return { userId, get: (u: string) => request(app).get(u).set(bearer), post: (u: string) => request(app).post(u).set(bearer) };
}
async function makeVenue(staff: Awaited<ReturnType<typeof staffAgent>>, name: string) {
  const res = await staff.post('/api/venue/venues').send({ name, capacity: 50, isIndoor: true });
  return res.body.venue.venue_id as number;
}
async function makeEquipmentType(staff: Awaited<ReturnType<typeof staffAgent>>, name: string) {
  const cat = await staff.get('/api/inventory/sport-categories');
  const res = await staff.post('/api/inventory/types').send({
    sportCategoryId: cat.body.categories[0].sport_category_id, name, lendingUnit: 'SINGLE',
    lowStockThreshold: 1, maxBorrowDurationMinutes: 120, conditionGoodMinScore: 70, conditionWornMinScore: 40, isIndoor: false,
  });
  return res.body.type.equipmentTypeId as number;
}
async function addArticles(staff: Awaited<ReturnType<typeof staffAgent>>, typeId: number, count: number, prefix: string) {
  // Barcodes are now 12-digit UPC codes — derive a stable numeric base from the
  // test's prefix (its last character) so each call site's codes stay distinct.
  const base = prefix.charCodeAt(prefix.length - 1) * 1000;
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const res = await staff.post('/api/inventory/articles').send({ equipmentTypeId: typeId, barcode: bc(base + i), entryScore: 90 });
    ids.push(res.body.article.articleId);
  }
  return ids;
}
function iso(d: Date) { return d.toISOString(); }
function futureWindow(daysFromNow: number, startHour: number, endHour: number) {
  const start = new Date(); start.setDate(start.getDate() + daysFromNow); start.setHours(startHour, 0, 0, 0);
  const end = new Date(); end.setDate(end.getDate() + daysFromNow); end.setHours(endHour, 0, 0, 0);
  return { start: iso(start), end: iso(end) };
}
function oneSession(daysFromNow: number, startHour: number, endHour: number, teamName = 'A') {
  const { start, end } = futureWindow(daysFromNow, startHour, endHour);
  return [{ sessionNo: 1, requestedStartAt: start, requestedEndAt: end, teamName }];
}
// A window that already started (so equipment_lock_at = start-24h is in the past)
// but hasn't ended yet — for T-24hr lock tests.
function withinLockWindow() {
  const start = new Date(Date.now() - 3600_000); // started 1h ago
  const end = new Date(Date.now() + 2 * 3600_000); // ends in 2h
  return [{ sessionNo: 1, requestedStartAt: iso(start), requestedEndAt: iso(end), teamName: 'A' }];
}
// A window that has fully ended — for post-event release tests.
function endedWindow() {
  const start = new Date(Date.now() - 4 * 3600_000);
  const end = new Date(Date.now() - 3600_000);
  return [{ sessionNo: 1, requestedStartAt: iso(start), requestedEndAt: iso(end), teamName: 'A' }];
}

async function fullyApprove(staff: Awaited<ReturnType<typeof staffAgent>>, coord: Awaited<ReturnType<typeof coordinatorAgent>>, bookingId: string) {
  await coord.post(`/api/venue/bookings/${bookingId}/forward`).send({});
  return staff.post(`/api/venue/bookings/${bookingId}/approve`).send({});
}

let staff: Awaited<ReturnType<typeof staffAgent>>;
let coord: Awaited<ReturnType<typeof coordinatorAgent>>;
beforeEach(async () => { staff = await staffAgent(); coord = await coordinatorAgent(staff); });

// ═══════════════════════════ PLANNING & SHORTFALL ═══════════════════════════
describe('Equipment planning (VENUE-13) and shortfall (VENUE-15/16/17)', () => {
  it('T-801: plan within available stock — no shortfall, booking stays PENDING', async () => {
    const venueId = await makeVenue(staff, 'EA Court A');
    const typeId = await makeEquipmentType(staff, 'EA Balls A');
    await addArticles(staff, typeId, 5, 'EAB-A');
    const stu = await studentAgent(staff);
    const r = await stu.post('/api/venue/bookings').send({ venueId, purpose: 'Match', estimatedParticipants: 10, sessions: oneSession(5, 9, 11) });
    const sessions = await staff.get(`/api/venue/bookings/${r.body.booking.bookingId}`);
    const sessionRequestId = sessions.body.sessions[0].request_session_id;

    const res = await coord.post(`/api/venue/bookings/${r.body.booking.bookingId}/equipment`).send({
      allocations: [{ requestSessionId: sessionRequestId, equipmentTypeId: typeId, quantity: 3 }],
    });
    expect(res.status).toBe(200);
    expect(res.body.shortfalls.length).toBe(0);
    const row = await db.selectFrom('booking').select('status').where('booking_id', '=', r.body.booking.bookingId).executeTakeFirst();
    expect(row?.status).toBe('PENDING');
  });

  it('T-802: plan beyond available stock — shortfall detected, booking SHORTFALL_PENDING, requester notified', async () => {
    const venueId = await makeVenue(staff, 'EA Court B');
    const typeId = await makeEquipmentType(staff, 'EA Balls B');
    await addArticles(staff, typeId, 2, 'EAB-B');
    const stu = await studentAgent(staff);
    const r = await stu.post('/api/venue/bookings').send({ venueId, purpose: 'Match', estimatedParticipants: 10, sessions: oneSession(6, 9, 11) });
    const detail = await staff.get(`/api/venue/bookings/${r.body.booking.bookingId}`);
    const sessionRequestId = detail.body.sessions[0].request_session_id;

    const res = await coord.post(`/api/venue/bookings/${r.body.booking.bookingId}/equipment`).send({
      allocations: [{ requestSessionId: sessionRequestId, equipmentTypeId: typeId, quantity: 5 }],
    });
    expect(res.status).toBe(200);
    expect(res.body.shortfalls.length).toBe(1);
    const row = await db.selectFrom('booking').select('status').where('booking_id', '=', r.body.booking.bookingId).executeTakeFirst();
    expect(row?.status).toBe('SHORTFALL_PENDING');
    const notif = await db.selectFrom('notification').select('notification_id')
      .where('type', '=', 'EQUIPMENT_SHORTFALL').where('recipient_id', '=', stu.userId).executeTakeFirst();
    expect(notif).toBeTruthy();
  });

  it('T-803: requester confirms self-managing the shortfall — same booking returns to PENDING', async () => {
    const venueId = await makeVenue(staff, 'EA Court C');
    const typeId = await makeEquipmentType(staff, 'EA Balls C');
    await addArticles(staff, typeId, 1, 'EAB-C');
    const stu = await studentAgent(staff);
    const r = await stu.post('/api/venue/bookings').send({ venueId, purpose: 'Match', estimatedParticipants: 10, sessions: oneSession(7, 9, 11) });
    const detail = await staff.get(`/api/venue/bookings/${r.body.booking.bookingId}`);
    const sessionRequestId = detail.body.sessions[0].request_session_id;
    await coord.post(`/api/venue/bookings/${r.body.booking.bookingId}/equipment`).send({
      allocations: [{ requestSessionId: sessionRequestId, equipmentTypeId: typeId, quantity: 4 }],
    });

    const bookingIdBefore = r.body.booking.bookingId;
    const confirm = await stu.post(`/api/venue/bookings/${bookingIdBefore}/shortfall-confirm`).send({ confirm: true });
    expect(confirm.status).toBe(200);
    expect(confirm.body.status).toBe('PENDING');

    // SAME booking_id throughout — no new booking created.
    const row = await db.selectFrom('booking').select('booking_id').where('booking_id', '=', bookingIdBefore).executeTakeFirst();
    expect(row?.booking_id).toBe(bookingIdBefore);

    const plan = await staff.get(`/api/venue/bookings/${bookingIdBefore}/equipment`);
    expect(plan.body.allocations[0].is_self_managed).toBe(true);
  });

  it('T-804: requester declines the shortfall — booking rejected, same booking_id', async () => {
    const venueId = await makeVenue(staff, 'EA Court D');
    const typeId = await makeEquipmentType(staff, 'EA Balls D');
    await addArticles(staff, typeId, 1, 'EAB-D');
    const stu = await studentAgent(staff);
    const r = await stu.post('/api/venue/bookings').send({ venueId, purpose: 'Match', estimatedParticipants: 10, sessions: oneSession(8, 9, 11) });
    const detail = await staff.get(`/api/venue/bookings/${r.body.booking.bookingId}`);
    const sessionRequestId = detail.body.sessions[0].request_session_id;
    await coord.post(`/api/venue/bookings/${r.body.booking.bookingId}/equipment`).send({
      allocations: [{ requestSessionId: sessionRequestId, equipmentTypeId: typeId, quantity: 4 }],
    });

    const decline = await stu.post(`/api/venue/bookings/${r.body.booking.bookingId}/shortfall-confirm`).send({ confirm: false });
    expect(decline.status).toBe(200);
    expect(decline.body.status).toBe('REJECTED');
    const row = await db.selectFrom('booking').select(['status', 'booking_id']).where('booking_id', '=', r.body.booking.bookingId).executeTakeFirst();
    expect(row?.status).toBe('REJECTED');
    expect(row?.booking_id).toBe(r.body.booking.bookingId); // still the same booking
  });
});

// ═══════════════════════════ MATERIALIZATION AT APPROVAL ═══════════════════════════
describe('Materialization at approval (VENUE-13, EQUIP-AVAIL-04)', () => {
  it('T-805: approval materializes a real event_equipment_allocation row matching the plan', async () => {
    const venueId = await makeVenue(staff, 'EA Court E');
    const typeId = await makeEquipmentType(staff, 'EA Balls E');
    await addArticles(staff, typeId, 5, 'EAB-E');
    const stu = await studentAgent(staff);
    const r = await stu.post('/api/venue/bookings').send({ venueId, purpose: 'Match', estimatedParticipants: 10, sessions: oneSession(9, 9, 11) });
    const detail = await staff.get(`/api/venue/bookings/${r.body.booking.bookingId}`);
    const sessionRequestId = detail.body.sessions[0].request_session_id;
    await coord.post(`/api/venue/bookings/${r.body.booking.bookingId}/equipment`).send({
      allocations: [{ requestSessionId: sessionRequestId, equipmentTypeId: typeId, quantity: 3 }],
    });

    const approve = await fullyApprove(staff, coord, r.body.booking.bookingId);
    expect(approve.status).toBe(200);

    const row = await db.selectFrom('event_equipment_allocation').select(['quantity', 'is_self_managed', 'locked_at'])
      .where('equipment_type_id', '=', typeId).executeTakeFirst();
    expect(row?.quantity).toBe(3);
    expect(row?.is_self_managed).toBe(false);
    expect(row?.locked_at).toBeNull(); // not due yet — session is 9 days out
  });

  it('T-806: a self-managed line materializes too, but is excluded from the stock guard and never gets locked', async () => {
    const venueId = await makeVenue(staff, 'EA Court F');
    const typeId = await makeEquipmentType(staff, 'EA Balls F');
    await addArticles(staff, typeId, 1, 'EAB-F'); // only 1 in stock
    const stu = await studentAgent(staff);
    const r = await stu.post('/api/venue/bookings').send({ venueId, purpose: 'Match', estimatedParticipants: 10, sessions: oneSession(10, 9, 11) });
    const detail = await staff.get(`/api/venue/bookings/${r.body.booking.bookingId}`);
    const sessionRequestId = detail.body.sessions[0].request_session_id;
    // plan for 10 (way beyond stock) -> shortfall -> confirm self-managed
    await coord.post(`/api/venue/bookings/${r.body.booking.bookingId}/equipment`).send({
      allocations: [{ requestSessionId: sessionRequestId, equipmentTypeId: typeId, quantity: 10 }],
    });
    await stu.post(`/api/venue/bookings/${r.body.booking.bookingId}/shortfall-confirm`).send({ confirm: true });

    const approve = await fullyApprove(staff, coord, r.body.booking.bookingId);
    expect(approve.status).toBe(200); // does NOT hit the (now-exempted) stock guard

    const row = await db.selectFrom('event_equipment_allocation').select(['quantity', 'is_self_managed'])
      .where('equipment_type_id', '=', typeId).executeTakeFirst();
    expect(row?.quantity).toBe(10);
    expect(row?.is_self_managed).toBe(true);
  });
});

// ═══════════════════════════ T-24HR LOCK (EQUIP-AVAIL-11/12/13/19) ═══════════════════════════
describe('T-24hr lock', () => {
  it('T-807: a due, sufficiently-stocked allocation locks silently — no alert (EQUIP-AVAIL-19)', async () => {
    const venueId = await makeVenue(staff, 'EA Court G');
    const typeId = await makeEquipmentType(staff, 'EA Balls G');
    await addArticles(staff, typeId, 5, 'EAB-G');
    const stu = await studentAgent(staff);
    const r = await stu.post('/api/venue/bookings').send({ venueId, purpose: 'Match', estimatedParticipants: 10, sessions: withinLockWindow() });
    const detail = await staff.get(`/api/venue/bookings/${r.body.booking.bookingId}`);
    const sessionRequestId = detail.body.sessions[0].request_session_id;
    await coord.post(`/api/venue/bookings/${r.body.booking.bookingId}/equipment`).send({
      allocations: [{ requestSessionId: sessionRequestId, equipmentTypeId: typeId, quantity: 2 }],
    });
    await fullyApprove(staff, coord, r.body.booking.bookingId);

    const locked = await checkEquipmentLocks();
    expect(locked).toBeGreaterThanOrEqual(1);
    const row = await db.selectFrom('event_equipment_allocation').select('locked_at')
      .where('equipment_type_id', '=', typeId).executeTakeFirst();
    expect(row?.locked_at).not.toBeNull();
    const alert = await db.selectFrom('notification').select('notification_id').where('type', '=', 'T24_LOCK_ALERT').executeTakeFirst();
    expect(alert).toBeUndefined(); // silence is confirmation
  });

  it('T-808 EQUIP-AVAIL-13: a due, understocked allocation locks AND alerts the Coordinator', async () => {
    const venueId = await makeVenue(staff, 'EA Court H');
    const typeId = await makeEquipmentType(staff, 'EA Balls H');
    const [articleId] = await addArticles(staff, typeId, 1, 'EAB-H'); // exactly 1 in stock
    const stu = await studentAgent(staff);
    const r = await stu.post('/api/venue/bookings').send({ venueId, purpose: 'Match', estimatedParticipants: 10, sessions: withinLockWindow() });
    const detail = await staff.get(`/api/venue/bookings/${r.body.booking.bookingId}`);
    const sessionRequestId = detail.body.sessions[0].request_session_id;
    await coord.post(`/api/venue/bookings/${r.body.booking.bookingId}/equipment`).send({
      allocations: [{ requestSessionId: sessionRequestId, equipmentTypeId: typeId, quantity: 1 }],
    });
    await fullyApprove(staff, coord, r.body.booking.bookingId);

    // Now make the only article unavailable (borrowed out) so the lock check finds a real shortfall.
    await db.updateTable('article').set({ state: 'ON_LOAN' }).where('article_id', '=', articleId).execute();

    await checkEquipmentLocks();
    const alert = await db.selectFrom('notification').select('notification_id').where('type', '=', 'T24_LOCK_ALERT').executeTakeFirst();
    expect(alert).toBeTruthy();
  });
});

// ═══════════════════════════ SWAPS (EQUIP-AVAIL-14/15) ═══════════════════════════
describe('Article swaps', () => {
  it('T-809: Coordinator swaps a locked allocation to an available article; Super Admin notified', async () => {
    const venueId = await makeVenue(staff, 'EA Court I');
    const typeId = await makeEquipmentType(staff, 'EA Balls I');
    const [a1, a2] = await addArticles(staff, typeId, 2, 'EAB-I');
    const stu = await studentAgent(staff);
    const r = await stu.post('/api/venue/bookings').send({ venueId, purpose: 'Match', estimatedParticipants: 10, sessions: withinLockWindow() });
    const detail = await staff.get(`/api/venue/bookings/${r.body.booking.bookingId}`);
    const sessionRequestId = detail.body.sessions[0].request_session_id;
    await coord.post(`/api/venue/bookings/${r.body.booking.bookingId}/equipment`).send({
      allocations: [{ requestSessionId: sessionRequestId, equipmentTypeId: typeId, quantity: 1 }],
    });
    await fullyApprove(staff, coord, r.body.booking.bookingId);
    await checkEquipmentLocks();

    const allocation = await db.selectFrom('event_equipment_allocation').select('allocation_id')
      .where('equipment_type_id', '=', typeId).executeTakeFirstOrThrow();

    const swap = await coord.post(`/api/venue/event-equipment/${allocation.allocation_id}/swap`).send({
      outgoingArticleId: a1, incomingArticleId: a2, reason: 'Damaged',
    });
    expect(swap.status).toBe(200);
    const notif = await db.selectFrom('notification').select('notification_id').where('type', '=', 'SWAP_NOTICE_SUPERADMIN').executeTakeFirst();
    expect(notif).toBeTruthy();
  });

  it('T-810 EQUIP-AVAIL-14: swap into an unavailable article is rejected (DB guard, tested end to end)', async () => {
    const venueId = await makeVenue(staff, 'EA Court J');
    const typeId = await makeEquipmentType(staff, 'EA Balls J');
    const [a1, a2] = await addArticles(staff, typeId, 2, 'EAB-J');
    await db.updateTable('article').set({ state: 'ON_LOAN' }).where('article_id', '=', a2).execute(); // incoming is NOT available
    const stu = await studentAgent(staff);
    const r = await stu.post('/api/venue/bookings').send({ venueId, purpose: 'Match', estimatedParticipants: 10, sessions: withinLockWindow() });
    const detail = await staff.get(`/api/venue/bookings/${r.body.booking.bookingId}`);
    const sessionRequestId = detail.body.sessions[0].request_session_id;
    await coord.post(`/api/venue/bookings/${r.body.booking.bookingId}/equipment`).send({
      allocations: [{ requestSessionId: sessionRequestId, equipmentTypeId: typeId, quantity: 1 }],
    });
    await fullyApprove(staff, coord, r.body.booking.bookingId);
    const allocation = await db.selectFrom('event_equipment_allocation').select('allocation_id')
      .where('equipment_type_id', '=', typeId).executeTakeFirstOrThrow();

    const swap = await coord.post(`/api/venue/event-equipment/${allocation.allocation_id}/swap`).send({
      outgoingArticleId: a1, incomingArticleId: a2,
    });
    expect(swap.status).toBe(422);
  });
});

// ═══════════════════════════ POST-EVENT RELEASE (EQUIP-AVAIL-18/20, VENUE-32/33) ═══════════════════════════
describe('Post-event release', () => {
  it('T-811: an ended session releases its equipment, notifies the Coordinator, and completes the booking', async () => {
    const venueId = await makeVenue(staff, 'EA Court K');
    const typeId = await makeEquipmentType(staff, 'EA Balls K');
    await addArticles(staff, typeId, 3, 'EAB-K');
    const stu = await studentAgent(staff);
    const r = await stu.post('/api/venue/bookings').send({ venueId, purpose: 'Match', estimatedParticipants: 10, sessions: endedWindow() });
    const detail = await staff.get(`/api/venue/bookings/${r.body.booking.bookingId}`);
    const sessionRequestId = detail.body.sessions[0].request_session_id;
    await coord.post(`/api/venue/bookings/${r.body.booking.bookingId}/equipment`).send({
      allocations: [{ requestSessionId: sessionRequestId, equipmentTypeId: typeId, quantity: 2 }],
    });
    await fullyApprove(staff, coord, r.body.booking.bookingId);

    const released = await checkPostEventRelease();
    expect(released).toBeGreaterThanOrEqual(1);

    const alloc = await db.selectFrom('event_equipment_allocation').select('released_at')
      .where('equipment_type_id', '=', typeId).executeTakeFirst();
    expect(alloc?.released_at).not.toBeNull();

    const notif = await db.selectFrom('notification').select('notification_id').where('type', '=', 'POST_EVENT_REVIEW').executeTakeFirst();
    expect(notif).toBeTruthy();

    const booking = await db.selectFrom('booking').select('status').where('booking_id', '=', r.body.booking.bookingId).executeTakeFirst();
    expect(booking?.status).toBe('COMPLETED'); // VENUE-33: last (only) session done -> booking completes
  });
});
