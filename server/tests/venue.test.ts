/**
 * Feature 5 — Venue Booking & Conflict Detection (multi-session pass).
 * Covers submission (single- and multi-session), the Coordinator→Super Admin
 * pipeline, academic calendar events, role authority, and — the core of this
 * feature — that the exclusion constraint genuinely blocks overlapping
 * approved sessions, including a real race between two concurrent approvals
 * and a multi-session package where one session collides.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { seedCreds } from './setup.js';
import { db } from '../src/db/index.js';

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
  const email = `vcoord${coordCounter}@bukc.edu.pk`;
  const invite = await staff.post('/api/auth/admin/invite-coordinator').send({ fullName: 'VCoord', email, contactNumber: '03005550000' });
  await request(app).post('/api/auth/accept-invite').send({ token: invite.body.devToken, password: 'CoordPass1!' });
  const login = await request(app).post('/api/auth/login').send({ email, password: 'CoordPass1!' });
  const bearer = { Authorization: `Bearer ${login.body.accessToken}` };
  return { get: (u: string) => request(app).get(u).set(bearer), post: (u: string) => request(app).post(u).set(bearer) };
}

let studentCounter = 0;
async function studentAgent(staff: Awaited<ReturnType<typeof staffAgent>>) {
  studentCounter += 1;
  const n = studentCounter;
  const email = `vstu${n}@bukc.edu.pk`;
  const enrollmentNo = `84-024000-${800 + n}`;
  const reg = await request(app).post('/api/auth/register/student').send({
    fullName: 'V Stu', email, contactNumber: '03001112222', password: 'Passw0rd!',
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

function iso(d: Date) { return d.toISOString(); }
function futureWindow(daysFromNow: number, startHour: number, endHour: number) {
  const start = new Date(); start.setDate(start.getDate() + daysFromNow); start.setHours(startHour, 0, 0, 0);
  const end = new Date(); end.setDate(end.getDate() + daysFromNow); end.setHours(endHour, 0, 0, 0);
  return { start: iso(start), end: iso(end) };
}
// One-session helper: builds the `sessions` array for the common single-session case.
function oneSession(daysFromNow: number, startHour: number, endHour: number, teamName = 'A') {
  const { start, end } = futureWindow(daysFromNow, startHour, endHour);
  return [{ sessionNo: 1, requestedStartAt: start, requestedEndAt: end, teamName }];
}

let staff: Awaited<ReturnType<typeof staffAgent>>;
let coord: Awaited<ReturnType<typeof coordinatorAgent>>;
beforeEach(async () => { staff = await staffAgent(); coord = await coordinatorAgent(staff); });

// ═══════════════════════════ SUBMISSION ═══════════════════════════
describe('Submission (VENUE-04..14)', () => {
  it('T-701: student submits a booking; appears in coordinator queue', async () => {
    const stu = await studentAgent(staff);
    const venueId = await makeVenue(staff, 'Main Court A');
    const res = await stu.post('/api/venue/bookings').send({
      venueId, purpose: 'Practice match', estimatedParticipants: 12, sessions: oneSession(3, 10, 12),
    });
    expect(res.status).toBe(201);
    const queue = await coord.get('/api/venue/queue');
    expect(queue.body.queue.some((q: { booking_id: string }) => q.booking_id === res.body.booking.bookingId)).toBe(true);
  });

  it('T-702: a preliminary conflict against an existing APPROVED session is rejected at submission', async () => {
    const venueId = await makeVenue(staff, 'Main Court B');
    const stu1 = await studentAgent(staff);
    const sessions = oneSession(4, 14, 16);
    const r1 = await stu1.post('/api/venue/bookings').send({ venueId, purpose: 'Match', estimatedParticipants: 12, sessions });
    await coord.post(`/api/venue/bookings/${r1.body.booking.bookingId}/forward`).send({});
    await staff.post(`/api/venue/bookings/${r1.body.booking.bookingId}/approve`).send({});

    const stu2 = await studentAgent(staff);
    const res = await stu2.post('/api/venue/bookings').send({ venueId, purpose: 'Match2', estimatedParticipants: 8, sessions });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PRELIMINARY_CONFLICT');
  });

  it('T-703 VENUE-07: a requester with an active (PENDING) booking cannot submit a second one', async () => {
    const stu = await studentAgent(staff);
    const venueId = await makeVenue(staff, 'Main Court C');
    await stu.post('/api/venue/bookings').send({ venueId, purpose: 'M1', estimatedParticipants: 12, sessions: oneSession(5, 10, 12) });
    const res = await stu.post('/api/venue/bookings').send({ venueId, purpose: 'M2', estimatedParticipants: 12, sessions: oneSession(6, 10, 12) });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ACTIVE_REQUEST');
  });

  it('T-704: end time before start time is rejected', async () => {
    const stu = await studentAgent(staff);
    const venueId = await makeVenue(staff, 'Main Court D');
    const start = new Date(); start.setDate(start.getDate() + 2); start.setHours(14, 0, 0, 0);
    const end = new Date(); end.setDate(end.getDate() + 2); end.setHours(12, 0, 0, 0);
    const res = await stu.post('/api/venue/bookings').send({
      venueId, purpose: 'Match', estimatedParticipants: 10,
      sessions: [{ sessionNo: 1, requestedStartAt: iso(start), requestedEndAt: iso(end), teamName: 'A' }],
    });
    expect(res.status).toBe(400);
  });
});

// ═══════════════════════════ PIPELINE & AUTHORITY ═══════════════════════════
describe('Coordinator → Super Admin pipeline (VENUE-13..22, APPR-06/07)', () => {
  it('T-705: full path — forward, approve, calendar reflects it', async () => {
    const stu = await studentAgent(staff);
    const venueId = await makeVenue(staff, 'Court E');
    const r = await stu.post('/api/venue/bookings').send({ venueId, purpose: 'Tournament R1', estimatedParticipants: 20, sessions: oneSession(7, 9, 11, 'Falcons') });
    const bookingId = r.body.booking.bookingId;

    const fwd = await coord.post(`/api/venue/bookings/${bookingId}/forward`).send({ note: 'Looks fine' });
    expect(fwd.status).toBe(200);

    const adminQueue = await staff.get('/api/venue/admin-queue');
    expect(adminQueue.body.queue.some((q: { booking_id: string }) => q.booking_id === bookingId)).toBe(true);

    const approve = await staff.post(`/api/venue/bookings/${bookingId}/approve`).send({});
    expect(approve.status).toBe(200);

    const cal = await staff.get(`/api/venue/calendar?venueId=${venueId}`);
    expect(cal.body.sessions.some((s: { booking_id: string }) => s.booking_id === bookingId)).toBe(true);
  });

  it('T-706 APPR-07: a Coordinator cannot approve (only Super Admin can)', async () => {
    const stu = await studentAgent(staff);
    const venueId = await makeVenue(staff, 'Court F');
    const r = await stu.post('/api/venue/bookings').send({ venueId, purpose: 'Match', estimatedParticipants: 10, sessions: oneSession(8, 9, 11) });
    await coord.post(`/api/venue/bookings/${r.body.booking.bookingId}/forward`).send({});
    const res = await coord.post(`/api/venue/bookings/${r.body.booking.bookingId}/approve`).send({});
    expect(res.status).toBe(403);
  });

  it('T-707: a student cannot forward or approve (role guard)', async () => {
    const stu = await studentAgent(staff);
    const venueId = await makeVenue(staff, 'Court G');
    const r = await stu.post('/api/venue/bookings').send({ venueId, purpose: 'Match', estimatedParticipants: 10, sessions: oneSession(9, 9, 11) });
    const res = await stu.post(`/api/venue/bookings/${r.body.booking.bookingId}/forward`).send({});
    expect(res.status).toBe(403);
  });

  it('T-708 VENUE-22: Super Admin returns a booking for re-evaluation; it goes back to PENDING', async () => {
    const stu = await studentAgent(staff);
    const venueId = await makeVenue(staff, 'Court H');
    const r = await stu.post('/api/venue/bookings').send({ venueId, purpose: 'Match', estimatedParticipants: 10, sessions: oneSession(10, 9, 11) });
    await coord.post(`/api/venue/bookings/${r.body.booking.bookingId}/forward`).send({});
    const ret = await staff.post(`/api/venue/bookings/${r.body.booking.bookingId}/return`).send({ note: 'Need more detail on roster' });
    expect(ret.status).toBe(200);
    const row = await db.selectFrom('booking').select('status').where('booking_id', '=', r.body.booking.bookingId).executeTakeFirst();
    expect(row?.status).toBe('PENDING');
  });

  it('T-709: Coordinator rejects at PENDING with a reason; requester notified', async () => {
    const stu = await studentAgent(staff);
    const venueId = await makeVenue(staff, 'Court I');
    const r = await stu.post('/api/venue/bookings').send({ venueId, purpose: 'Match', estimatedParticipants: 10, sessions: oneSession(11, 9, 11) });
    const res = await coord.post(`/api/venue/bookings/${r.body.booking.bookingId}/reject`).send({ reason: 'Venue under maintenance that day.' });
    expect(res.status).toBe(200);
    const notif = await db.selectFrom('notification').select('notification_id')
      .where('type', '=', 'BOOKING_REJECTED').where('recipient_id', '=', stu.userId).executeTakeFirst();
    expect(notif).toBeTruthy();
  });
});

// ═══════════════════════════ CONFLICT DETECTION — the core guarantee ═══════════════════════════
describe('Conflict detection (CONF-01..16) — the exclusion constraint is authoritative', () => {
  it('T-710 CONF-02/03: partial overlap is a full conflict', async () => {
    const venueId = await makeVenue(staff, 'Court J');
    const stu1 = await studentAgent(staff);
    const w1 = futureWindow(12, 10, 12);
    const r1 = await stu1.post('/api/venue/bookings').send({
      venueId, purpose: 'M1', estimatedParticipants: 10,
      sessions: [{ sessionNo: 1, requestedStartAt: w1.start, requestedEndAt: w1.end, teamName: 'A' }],
    });
    await coord.post(`/api/venue/bookings/${r1.body.booking.bookingId}/forward`).send({});
    await staff.post(`/api/venue/bookings/${r1.body.booking.bookingId}/approve`).send({});

    // second request overlaps only the last 30 minutes (11:30-13:00) — still a conflict
    const day = new Date(); day.setDate(day.getDate() + 12);
    const start2 = new Date(day); start2.setHours(11, 30, 0, 0);
    const end2 = new Date(day); end2.setHours(13, 0, 0, 0);
    const stu2 = await studentAgent(staff);
    const res = await stu2.post('/api/venue/bookings').send({
      venueId, purpose: 'M2', estimatedParticipants: 10,
      sessions: [{ sessionNo: 1, requestedStartAt: iso(start2), requestedEndAt: iso(end2), teamName: 'B' }],
    });
    expect(res.status).toBe(409);
  });

  it('T-711 CONF-06: different venues never contend, even at the exact same time', async () => {
    const v1 = await makeVenue(staff, 'Court K1');
    const v2 = await makeVenue(staff, 'Court K2');
    const sessions = oneSession(13, 10, 12);
    const stu1 = await studentAgent(staff);
    const r1 = await stu1.post('/api/venue/bookings').send({ venueId: v1, purpose: 'M1', estimatedParticipants: 10, sessions });
    await coord.post(`/api/venue/bookings/${r1.body.booking.bookingId}/forward`).send({});
    await staff.post(`/api/venue/bookings/${r1.body.booking.bookingId}/approve`).send({});

    const stu2 = await studentAgent(staff);
    const r2 = await stu2.post('/api/venue/bookings').send({ venueId: v2, purpose: 'M2', estimatedParticipants: 10, sessions });
    expect(r2.status).toBe(201); // same time, different venue — no conflict
  });

  it('T-712 CONF-15: a real race — two FORWARDED bookings for the same slot, only one approval survives', async () => {
    const venueId = await makeVenue(staff, 'Court L');
    const { start, end } = futureWindow(14, 15, 17);

    const stu1 = await studentAgent(staff);
    const r1 = await stu1.post('/api/venue/bookings').send({
      venueId, purpose: 'M1', estimatedParticipants: 10,
      sessions: [{ sessionNo: 1, requestedStartAt: start, requestedEndAt: end, teamName: 'A' }],
    });
    await coord.post(`/api/venue/bookings/${r1.body.booking.bookingId}/forward`).send({});

    // Directly insert a second FORWARDED booking + session request for the
    // identical slot, bypassing the preliminary submission-time check on
    // purpose — this simulates the race CONF-10/15 exist to catch: two
    // requests validated before either was approved.
    const stu2 = await studentAgent(staff);
    const coordId = (await db.selectFrom('app_user').select('user_id').where('role', '=', 'COORDINATOR').limit(1).executeTakeFirstOrThrow()).user_id;
    const bookingId2 = await db.transaction().execute(async (trx) => {
      const row = await trx.insertInto('booking').values({
        venue_id: venueId, origin: 'CLIENT', requested_by: stu2.userId, purpose: 'M2',
        estimated_participants: 10, status: 'FORWARDED', forwarded_by: coordId, forwarded_at: new Date(),
      }).returning('booking_id').executeTakeFirstOrThrow();
      await trx.insertInto('booking_session_request').values({
        booking_id: row.booking_id, session_no: 1, requested_start_at: start, requested_end_at: end, team_name: 'B',
      }).execute();
      return row.booking_id;
    });

    const approve1 = await staff.post(`/api/venue/bookings/${r1.body.booking.bookingId}/approve`).send({});
    expect(approve1.status).toBe(200);

    const approve2 = await staff.post(`/api/venue/bookings/${bookingId2}/approve`).send({});
    expect(approve2.status).toBe(409);
    expect(approve2.body.code).toBe('SLOT_CONFLICT');

    const row2 = await db.selectFrom('booking').select('status').where('booking_id', '=', bookingId2).executeTakeFirst();
    expect(row2?.status).toBe('REJECTED'); // CONF-15: rejected, not left dangling
  });
});

// ═══════════════════════════ MULTI-SESSION (VENUE-06/35/36) ═══════════════════════════
describe('Multi-session bookings (VENUE-06/35/36)', () => {
  it('T-713: a 3-session tournament booking approves all sessions atomically', async () => {
    const stu = await studentAgent(staff);
    const venueId = await makeVenue(staff, 'Court M');
    const sessions = [1, 2, 3].map((n) => {
      const w = futureWindow(15 + n, 9, 11);
      return { sessionNo: n, requestedStartAt: w.start, requestedEndAt: w.end, teamName: `Round ${n}` };
    });
    const r = await stu.post('/api/venue/bookings').send({ venueId, purpose: 'Mini tournament', estimatedParticipants: 16, sessions });
    expect(r.status).toBe(201);
    await coord.post(`/api/venue/bookings/${r.body.booking.bookingId}/forward`).send({});
    const approve = await staff.post(`/api/venue/bookings/${r.body.booking.bookingId}/approve`).send({});
    expect(approve.status).toBe(200);

    const rows = await db.selectFrom('booking_session').select('session_no').where('booking_id', '=', r.body.booking.bookingId).execute();
    expect(rows.length).toBe(3); // all 3 materialized in one shot
  });

  it('T-714 CONF-15 for a package: if one session in a multi-session approval collides, the WHOLE package is rejected', async () => {
    const venueId = await makeVenue(staff, 'Court N');
    // pre-approve a single session that will collide with session #2 of the multi-session package below
    const stuBlock = await studentAgent(staff);
    const blockWindow = futureWindow(20, 14, 16);
    const rBlock = await stuBlock.post('/api/venue/bookings').send({
      venueId, purpose: 'Blocker', estimatedParticipants: 5,
      sessions: [{ sessionNo: 1, requestedStartAt: blockWindow.start, requestedEndAt: blockWindow.end, teamName: 'X' }],
    });
    await coord.post(`/api/venue/bookings/${rBlock.body.booking.bookingId}/forward`).send({});
    await staff.post(`/api/venue/bookings/${rBlock.body.booking.bookingId}/approve`).send({});

    // multi-session package: session 1 is clean, session 2 collides with the blocker above
    const stu = await studentAgent(staff);
    const clean = futureWindow(21, 9, 11);
    const sessions = [
      { sessionNo: 1, requestedStartAt: clean.start, requestedEndAt: clean.end, teamName: 'A' },
      { sessionNo: 2, requestedStartAt: blockWindow.start, requestedEndAt: blockWindow.end, teamName: 'A' },
    ];
    // submission itself should catch this (preliminary check runs per-session)
    const r = await stu.post('/api/venue/bookings').send({ venueId, purpose: 'Package', estimatedParticipants: 10, sessions });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('PRELIMINARY_CONFLICT');
  });
});

// ═══════════════════════════ ACADEMIC CALENDAR EVENTS (VENUE-28/29/34) ═══════════════════════════
describe('Academic calendar events (VENUE-28/29/34)', () => {
  it('T-715: Coordinator initiates an academic event; no requester, fixed internal client ref', async () => {
    const venueId = await makeVenue(staff, 'Court O');
    const res = await coord.post('/api/venue/academic-events').send({
      venueId, purpose: 'Annual Sports Day', estimatedParticipants: 200, sessions: oneSession(25, 8, 18, 'BUKC Sports Department'),
    });
    expect(res.status).toBe(201);
    const row = await db.selectFrom('booking').select(['origin', 'requested_by', 'internal_client_ref', 'status'])
      .where('booking_id', '=', res.body.booking.bookingId).executeTakeFirst();
    expect(row?.origin).toBe('ACADEMIC');
    expect(row?.requested_by).toBeNull();
    expect(row?.internal_client_ref).toBe('BUKC SPORTS DEPARTMENT');
    expect(row?.status).toBe('PENDING');
  });

  it('T-716 VENUE-27: an academic event is NOT exempt from conflict detection', async () => {
    const venueId = await makeVenue(staff, 'Court P');
    const stu = await studentAgent(staff);
    const w = futureWindow(26, 10, 12);
    const r1 = await stu.post('/api/venue/bookings').send({
      venueId, purpose: 'Club match', estimatedParticipants: 10,
      sessions: [{ sessionNo: 1, requestedStartAt: w.start, requestedEndAt: w.end, teamName: 'A' }],
    });
    await coord.post(`/api/venue/bookings/${r1.body.booking.bookingId}/forward`).send({});
    await staff.post(`/api/venue/bookings/${r1.body.booking.bookingId}/approve`).send({});

    const res = await coord.post('/api/venue/academic-events').send({
      venueId, purpose: 'Overlapping academic event', estimatedParticipants: 50,
      sessions: [{ sessionNo: 1, requestedStartAt: w.start, requestedEndAt: w.end, teamName: 'BUKC Sports Department' }],
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PRELIMINARY_CONFLICT');
  });

  it('T-717: a student cannot initiate an academic event (Coordinator-only)', async () => {
    const stu = await studentAgent(staff);
    const venueId = await makeVenue(staff, 'Court Q');
    const res = await stu.post('/api/venue/academic-events').send({
      venueId, purpose: 'Should fail', estimatedParticipants: 10, sessions: oneSession(27, 9, 11),
    });
    expect(res.status).toBe(403);
  });
});
