/**
 * Venue booking & conflict detection (Feature 5 + Feature 9).
 * VENUE-01..29, CONF-01..16.
 *
 * A booking is a package of one or more proposed sessions (VENUE-06/35: one
 * venue, up to 30 sessions), stored pre-approval in booking_session_request —
 * a single-session booking is simply a package of one. At approval, every row
 * is materialized into a real booking_session (+ session_participant) row.
 *
 * Two distinct conflict checks, deliberately different in scope, per a real
 * ambiguity in the rules:
 *   - Coordinator-stage validation (VENUE-11, CONF-12) checks EVERY proposed
 *     session and reports back exactly WHICH ones conflict — "one session
 *     failing does not automatically fail its siblings" is about surfacing
 *     the problem early, before forwarding.
 *   - Final approval (VENUE-19, CONF-08) stays atomic: booking_status has no
 *     "partially approved" state, and VENUE-19 frames one approval as
 *     covering the entire package. If ANY session in the package collides at
 *     approval time, the whole package is rejected together (CONF-15).
 *
 * Feature 9 additions:
 *   - queryApprovedSessions: advisory view of all SCHEDULED sessions for a
 *     venue/date range — used by the conflict detection screen (CONF-16).
 *   - markNeedsRescheduling: soft resolution path. Marks a session as
 *     NEEDS_RESCHEDULING so the Coordinator or Super Admin can handle the
 *     rebooking. CONF-13: a rescheduled session goes through the identical
 *     lock-and-conflict process as a brand-new submission.
 *   - cancelSession already existed; exposed via the conflict resolution screen.
 */
import { sql } from 'kysely';
import { db, isPgError } from '../../db/index.js';
import { AppError, badRequest, notFound, conflict } from '../../middleware/errors.js';
import { sendEmail } from '../../lib/email.js';
import { materializeAllocations } from './equipment.js';

function mapDbError(e: unknown): AppError {
  if (isPgError(e)) {
    if (e.code === '23P01') return conflict('That venue slot is no longer available.', 'SLOT_CONFLICT');
    if (e.code === 'P0001') return new AppError(422, e.message.replace(/^ERROR:\s*/i, ''), 'RULE');
    if (e.code === '23505') return conflict('That already exists.', 'DUPLICATE');
    if (e.code === '23503') return badRequest('Referenced item does not exist.', 'FK');
  }
  if (e instanceof AppError) return e;
  console.error('Venue booking operation failed:', e);
  return new AppError(500, 'Venue booking operation failed');
}

export interface SessionInput {
  sessionNo: number; requestedStartAt: string; requestedEndAt: string;
  teamName: string; participantDetails?: string;
}

// ── notifications ──
async function notifyStaffRole(role: 'COORDINATOR' | 'SUPER_ADMIN', type: import('../../db/index.js').NotificationType, title: string, body: string, bookingId?: string) {
  const staff = await db.selectFrom('app_user').select('user_id').where('role', '=', role).where('status', '=', 'ACTIVE').execute();
  if (staff.length === 0) return;
  await db.insertInto('notification').values(
    staff.map((s) => ({ recipient_id: s.user_id, type, title, body, booking_id: bookingId ?? null })),
  ).execute();
}
async function notifyRequester(type: import('../../db/index.js').NotificationType, userId: string, title: string, body: string, bookingId: string) {
  const user = await db.selectFrom('app_user').select(['email']).where('user_id', '=', userId).executeTakeFirst();
  await db.insertInto('notification').values({ recipient_id: userId, type, title, body, booking_id: bookingId }).execute();
  if (user) sendEmail({ to: user.email, subject: title, html: `<p>${body}</p>`, text: body }).catch((e) => console.error('notifyRequester email failed:', e));
}

// ── venues ──
export async function listVenues() {
  return db.selectFrom('venue as v')
    .leftJoin('sport_category as sc', 'sc.sport_category_id', 'v.sport_category_id')
    .select(['v.venue_id', 'v.name', 'v.capacity', 'v.is_indoor', 'v.is_active', 'sc.name as sport_category_name'])
    .where('v.is_active', '=', true).orderBy('v.name').execute();
}
export async function createVenue(input: { name: string; sportCategoryId?: number; capacity: number; isIndoor: boolean }) {
  try {
    return await db.insertInto('venue').values({
      name: input.name, sport_category_id: input.sportCategoryId ?? null,
      capacity: input.capacity, is_indoor: input.isIndoor,
    }).returning(['venue_id', 'name']).executeTakeFirstOrThrow();
  } catch (e) { throw mapDbError(e); }
}

// Per-session overlap check (CONF-09/12). Returns the session numbers (from
// the caller's proposed list) that collide with an existing SCHEDULED session.
async function findConflictingSessions(venueId: number, sessions: SessionInput[]): Promise<number[]> {
  const conflicting: number[] = [];
  for (const s of sessions) {
    const row = await db.selectFrom('booking_session')
      .select('session_id')
      .where('venue_id', '=', venueId)
      .where('status', 'in', ['SCHEDULED', 'IN_PROGRESS', 'COMPLETED'])
      .where(sql<boolean>`slot && tstzrange(${s.requestedStartAt}::timestamptz, ${s.requestedEndAt}::timestamptz, '[)')`)
      .executeTakeFirst();
    if (row) conflicting.push(s.sessionNo);
  }
  return conflicting;
}

function validateSessions(sessions: SessionInput[]) {
  if (sessions.length === 0) throw badRequest('At least one session is required.');
  if (sessions.length > 30) throw badRequest('VENUE-35: a booking cannot exceed 30 sessions.'); // belt-and-suspenders; DB also enforces this
  const nos = new Set<number>();
  for (const s of sessions) {
    if (new Date(s.requestedEndAt) <= new Date(s.requestedStartAt)) {
      throw badRequest(`Session ${s.sessionNo}: end time must be after start time.`);
    }
    if (nos.has(s.sessionNo)) throw badRequest(`Duplicate session number ${s.sessionNo}.`);
    nos.add(s.sessionNo);
  }
}

// ── submission (VENUE-04..14, VENUE-06/35/36 multi-session) ──
export async function submitBooking(requesterId: string, origin: 'CLIENT' | 'EXTERNAL', input: {
  venueId: number; purpose: string; estimatedParticipants: number; sessions: SessionInput[];
}) {
  validateSessions(input.sessions);

  // VENUE-07: one active booking (PENDING/FORWARDED) at a time.
  const active = await db.selectFrom('booking').select('booking_id')
    .where('requested_by', '=', requesterId)
    .where('status', 'in', ['PENDING', 'FORWARDED'])
    .executeTakeFirst();
  if (active) throw conflict('You already have an active booking request.', 'ACTIVE_REQUEST');

  const conflicts = await findConflictingSessions(input.venueId, input.sessions);
  if (conflicts.length > 0) {
    throw conflict(`That venue is already booked for session(s) ${conflicts.join(', ')}.`, 'PRELIMINARY_CONFLICT');
  }

  try {
    const bookingId = await db.transaction().execute(async (trx) => {
      const row = await trx.insertInto('booking').values({
        venue_id: input.venueId, origin, requested_by: requesterId,
        purpose: input.purpose, estimated_participants: input.estimatedParticipants,
      }).returning('booking_id').executeTakeFirstOrThrow();

      for (const s of input.sessions) {
        await trx.insertInto('booking_session_request').values({
          booking_id: row.booking_id, session_no: s.sessionNo,
          requested_start_at: s.requestedStartAt, requested_end_at: s.requestedEndAt,
          team_name: s.teamName, participant_details: s.participantDetails ?? null,
        }).execute();
      }

      await trx.insertInto('approval_action').values({
        subject: 'VENUE_BOOKING', verb: 'SUBMIT', booking_id: row.booking_id, actor_id: requesterId,
      }).execute();

      return row.booking_id;
    });

    await notifyStaffRole('COORDINATOR', 'QUEUE_NEW_ITEM', 'New venue booking request',
      `A new ${input.sessions.length > 1 ? `${input.sessions.length}-session ` : ''}venue booking request is awaiting review.`, bookingId);

    return { booking_id: bookingId };
  } catch (e) { throw mapDbError(e); }
}

// VENUE-28/29: Coordinator initiates an academic calendar event through the
// SAME pipeline (no exemption from conflict detection — VENUE-27). No
// requester; ck_academic_ref requires internal_client_ref to be exactly this
// fixed label. The Coordinator then forwards it like any other PENDING item.
export async function initiateAcademicEvent(coordinatorId: string, input: {
  venueId: number; purpose: string; estimatedParticipants: number; sessions: SessionInput[];
}) {
  validateSessions(input.sessions);

  const conflicts = await findConflictingSessions(input.venueId, input.sessions);
  if (conflicts.length > 0) {
    throw conflict(`That venue is already booked for session(s) ${conflicts.join(', ')}.`, 'PRELIMINARY_CONFLICT');
  }

  try {
    const bookingId = await db.transaction().execute(async (trx) => {
      const row = await trx.insertInto('booking').values({
        venue_id: input.venueId, origin: 'ACADEMIC', requested_by: null,
        internal_client_ref: 'BUKC SPORTS DEPARTMENT',
        purpose: input.purpose, estimated_participants: input.estimatedParticipants,
      }).returning('booking_id').executeTakeFirstOrThrow();

      for (const s of input.sessions) {
        await trx.insertInto('booking_session_request').values({
          booking_id: row.booking_id, session_no: s.sessionNo,
          requested_start_at: s.requestedStartAt, requested_end_at: s.requestedEndAt,
          team_name: s.teamName, participant_details: s.participantDetails ?? null,
        }).execute();
      }

      await trx.insertInto('approval_action').values({
        subject: 'VENUE_BOOKING', verb: 'SUBMIT', booking_id: row.booking_id, actor_id: coordinatorId,
      }).execute();

      return row.booking_id;
    });
    return { booking_id: bookingId };
  } catch (e) { throw mapDbError(e); }
}

export async function listMyBookings(requesterId: string) {
  const bookings = await db.selectFrom('booking as b')
    .innerJoin('venue as v', 'v.venue_id', 'b.venue_id')
    .select(['b.booking_id', 'b.status', 'b.purpose', 'b.rejection_reason', 'b.submitted_at', 'v.name as venue_name'])
    .where('b.requested_by', '=', requesterId)
    .orderBy('b.submitted_at', 'desc').execute();
  return attachSessionSummary(bookings);
}

// Attach a light per-booking session summary (count + earliest window) without
// an N+1 per row — one extra query for the whole list.
async function attachSessionSummary<T extends { booking_id: string }>(rows: T[]) {
  if (rows.length === 0) return rows.map((r) => ({ ...r, sessionCount: 0, firstStart: null as string | null, lastEnd: null as string | null }));
  const ids = rows.map((r) => r.booking_id);
  const summaries = await db.selectFrom('booking_session_request')
    .select(['booking_id', (eb) => eb.fn.count<number>('session_no').as('session_count'),
      (eb) => eb.fn.min('requested_start_at').as('first_start'), (eb) => eb.fn.max('requested_end_at').as('last_end')])
    .where('booking_id', 'in', ids).groupBy('booking_id').execute();
  const byId = new Map(summaries.map((s) => [s.booking_id, s]));
  return rows.map((r) => {
    const s = byId.get(r.booking_id);
    return { ...r, sessionCount: s ? Number(s.session_count) : 0, firstStart: s?.first_start ?? null, lastEnd: s?.last_end ?? null };
  });
}

// ── coordinator review (VENUE-09..17) ──
export async function listCoordinatorQueue() {
  const rows = await db.selectFrom('booking as b')
    .innerJoin('venue as v', 'v.venue_id', 'b.venue_id')
    .leftJoin('app_user as u', 'u.user_id', 'b.requested_by')
    .select(['b.booking_id', 'b.origin', 'b.purpose', 'b.estimated_participants', 'b.submitted_at',
      'v.venue_id', 'v.name as venue_name', 'u.user_id as requester_id', 'u.full_name as requester_name', 'u.email as requester_email'])
    .where('b.status', '=', 'PENDING')
    .orderBy('b.submitted_at', 'asc').execute();
  return attachSessionSummary(rows);
}

export async function getSessionRequests(bookingId: string) {
  return db.selectFrom('booking_session_request')
    .select(['request_session_id', 'session_no', 'requested_start_at', 'requested_end_at', 'team_name', 'participant_details'])
    .where('booking_id', '=', bookingId).orderBy('session_no', 'asc').execute();
}

export async function forwardBooking(bookingId: string, coordinatorId: string, note: string | undefined) {
  try {
    const b = await db.selectFrom('booking').select(['status', 'venue_id']).where('booking_id', '=', bookingId).executeTakeFirst();
    if (!b) throw notFound('Booking not found.');
    if (b.status !== 'PENDING') throw conflict(`Booking is already ${b.status}.`);

    // VENUE-11: complete upfront validation across every session before forwarding.
    const sessions = await getSessionRequests(bookingId);
    const conflicts = await findConflictingSessions(b.venue_id, sessions.map((s) => ({
      sessionNo: s.session_no, requestedStartAt: s.requested_start_at as unknown as string,
      requestedEndAt: s.requested_end_at as unknown as string, teamName: s.team_name,
    })));
    if (conflicts.length > 0) {
      throw conflict(`Session(s) ${conflicts.join(', ')} now conflict with an approved booking — cannot forward as-is.`, 'PRELIMINARY_CONFLICT');
    }

    await db.updateTable('booking')
      .set({ status: 'FORWARDED', forwarded_by: coordinatorId, forwarded_at: sql`now()`, feasibility_note: note ?? null })
      .where('booking_id', '=', bookingId).execute();
    await db.insertInto('approval_action').values({
      subject: 'VENUE_BOOKING', verb: 'FORWARD', booking_id: bookingId, actor_id: coordinatorId, note: note ?? null,
    }).execute();
    await notifyStaffRole('SUPER_ADMIN', 'ITEM_FORWARDED', 'Venue booking forwarded for approval',
      'A Coordinator forwarded a venue booking request for your decision.', bookingId);
  } catch (e) { throw mapDbError(e); }
}

export async function rejectBooking(bookingId: string, actorId: string, actorRole: 'COORDINATOR' | 'SUPER_ADMIN', reason: string) {
  try {
    const b = await db.selectFrom('booking').select(['status', 'requested_by']).where('booking_id', '=', bookingId).executeTakeFirst();
    if (!b) throw notFound('Booking not found.');
    if (!['PENDING', 'FORWARDED'].includes(b.status)) throw conflict(`Booking is already ${b.status}.`);

    // fn_booking_authority_guard treats decided_by/decided_at as Super-Admin-
    // only fields (VENUE-19). A Coordinator's direct rejection at PENDING
    // (VENUE-12) is a different, earlier decision point — recorded via the
    // approval_action audit row instead, not the booking's decided_by.
    const patch: { status: 'REJECTED'; rejection_reason: string; decided_by?: string; decided_at?: Date } = {
      status: 'REJECTED', rejection_reason: reason,
    };
    if (actorRole === 'SUPER_ADMIN') {
      patch.decided_by = actorId;
      patch.decided_at = new Date();
    }
    await db.updateTable('booking').set(patch).where('booking_id', '=', bookingId).execute();

    await db.insertInto('approval_action').values({
      subject: 'VENUE_BOOKING', verb: 'REJECT', booking_id: bookingId, actor_id: actorId, note: reason,
    }).execute();
    if (b.requested_by) {
      await notifyRequester('BOOKING_REJECTED', b.requested_by, 'Your venue booking was rejected',
        `Reason: ${reason}`, bookingId);
    }
  } catch (e) { throw mapDbError(e); }
}

// ── super admin decision (VENUE-18..27, CONF-08..16) ──
export async function listSuperAdminQueue() {
  const rows = await db.selectFrom('booking as b')
    .innerJoin('venue as v', 'v.venue_id', 'b.venue_id')
    .leftJoin('app_user as u', 'u.user_id', 'b.requested_by')
    .select(['b.booking_id', 'b.origin', 'b.purpose', 'b.estimated_participants', 'b.feasibility_note', 'b.forwarded_at',
      'v.venue_id', 'v.name as venue_name', 'u.full_name as requester_name', 'u.email as requester_email'])
    .where('b.status', '=', 'FORWARDED')
    .orderBy('b.forwarded_at', 'asc').execute();
  return attachSessionSummary(rows);
}

export async function approveBooking(bookingId: string, superAdminId: string) {
  const b = await db.selectFrom('booking')
    .select(['status', 'venue_id', 'requested_by'])
    .where('booking_id', '=', bookingId).executeTakeFirst();
  if (!b) throw notFound('Booking not found.');
  if (b.status !== 'FORWARDED') throw conflict(`Booking is already ${b.status}.`);

  const sessions = await getSessionRequests(bookingId);
  if (sessions.length === 0) throw badRequest('Booking has no session requests.');

  try {
    await db.transaction().execute(async (trx) => {
      // fn_session_parent_guard requires the parent booking to already be
      // APPROVED at the moment ANY session is inserted — status update first.
      await trx.updateTable('booking')
        .set({ status: 'APPROVED', decided_by: superAdminId, decided_at: sql`now()` })
        .where('booking_id', '=', bookingId).execute();

      // CONF-08: the exclusion constraint is the authoritative gate, checked
      // per session. If ANY session collides, this throws 23P01 and the
      // whole transaction rolls back — the entire package is one unit
      // (VENUE-19), not a partial success.
      for (const s of sessions) {
        const session = await trx.insertInto('booking_session').values({
          booking_id: bookingId, session_no: s.session_no, venue_id: b.venue_id,
          slot: sql`tstzrange(${s.requested_start_at}::timestamptz, ${s.requested_end_at}::timestamptz, '[)')`,
        }).returning('session_id').executeTakeFirstOrThrow();

        await trx.insertInto('session_participant').values({
          session_id: session.session_id, team_name: s.team_name,
          member_name: s.participant_details ?? 'See booking details', is_team_contact: true,
        }).execute();

        // VENUE-13: materialize the Coordinator's planned equipment allocation
        // for this session into the real, post-approval table.
        await materializeAllocations(trx, s.request_session_id, session.session_id, superAdminId);
      }

      await trx.insertInto('approval_action').values({
        subject: 'VENUE_BOOKING', verb: 'APPROVE', booking_id: bookingId, actor_id: superAdminId,
      }).execute();
    });
  } catch (e) {
    if (isPgError(e) && e.code === '23P01') {
      // CONF-15: a conflict discovered only at approval is rejected, not left dangling.
      await db.updateTable('booking').set({
        status: 'REJECTED', decided_by: superAdminId, decided_at: sql`now()`,
        rejection_reason: 'One or more sessions in this package collided with another approved booking before it could be confirmed.',
      }).where('booking_id', '=', bookingId).execute();
      await db.insertInto('approval_action').values({
        subject: 'VENUE_BOOKING', verb: 'REJECT', booking_id: bookingId, actor_id: superAdminId,
        note: 'Automatic: conflict detected at approval (CONF-15)',
      }).execute();
      if (b.requested_by) {
        await notifyRequester('BOOKING_REJECTED', b.requested_by, 'Your venue booking could not be confirmed',
          'A session in your booking package was taken by another booking just before yours could be confirmed. Please submit a new request.', bookingId);
      }
      throw conflict('One or more sessions were just taken by another approved booking. The request has been rejected.', 'SLOT_CONFLICT');
    }
    throw mapDbError(e);
  }

  if (b.requested_by) {
    await notifyRequester('BOOKING_APPROVED', b.requested_by, 'Your venue booking was approved',
      `Your ${sessions.length > 1 ? `${sessions.length}-session ` : ''}venue booking is confirmed. Check the calendar for details.`, bookingId);
  }
}

// VENUE-22: Super Admin can send back to Coordinator instead of rejecting outright.
export async function returnForReevaluation(bookingId: string, superAdminId: string, note: string) {
  try {
    const b = await db.selectFrom('booking').select('status').where('booking_id', '=', bookingId).executeTakeFirst();
    if (!b) throw notFound('Booking not found.');
    if (b.status !== 'FORWARDED') throw conflict(`Booking is already ${b.status}.`);

    await db.updateTable('booking').set({ status: 'PENDING', feasibility_note: note }).where('booking_id', '=', bookingId).execute();
    await db.insertInto('approval_action').values({
      subject: 'VENUE_BOOKING', verb: 'RETURN_FOR_REEVALUATION', booking_id: bookingId, actor_id: superAdminId, note,
    }).execute();
    await notifyStaffRole('COORDINATOR', 'ITEM_RETURNED_FOR_REEVAL', 'Venue booking returned for re-evaluation',
      note, bookingId);
  } catch (e) { throw mapDbError(e); }
}

export async function getBookingDetail(bookingId: string) {
  const b = await db.selectFrom('booking as b')
    .innerJoin('venue as v', 'v.venue_id', 'b.venue_id')
    .select(['b.booking_id', 'b.origin', 'b.status', 'b.purpose', 'b.estimated_participants',
      'b.feasibility_note', 'b.rejection_reason', 'v.name as venue_name'])
    .where('b.booking_id', '=', bookingId).executeTakeFirst();
  if (!b) throw notFound('Booking not found.');
  const sessions = await getSessionRequests(bookingId);
  return { ...b, sessions };
}

// ── calendar (CAL-01..05) ──
export async function listCalendar(filter: { venueId?: number; from?: string; to?: string }) {
  let q = db.selectFrom('v_calendar').selectAll();
  if (filter.venueId) q = q.where('venue_id', '=', filter.venueId);
  if (filter.from) q = q.where('starts_at', '>=', new Date(filter.from));
  if (filter.to) q = q.where('starts_at', '<=', new Date(filter.to));
  return q.orderBy('starts_at', 'asc').execute();
}

// ── Feature 9: advisory query — approved sessions for a venue/date window ──
// Used by the Conflict Detection screen to let staff see what's currently
// holding slots, so they can decide which booking to cancel/reschedule.
// Returns SCHEDULED + IN_PROGRESS sessions (the ones that actively hold slots).
// CONF-16: metadata about each slot is surfaced to help staff understand conflicts.
export async function queryApprovedSessions(filter: {
  venueId?: number;
  from?: string;
  to?: string;
}) {
  let q = db
    .selectFrom('booking_session as bs')
    .innerJoin('booking as b', 'b.booking_id', 'bs.booking_id')
    .innerJoin('venue as v', 'v.venue_id', 'bs.venue_id')
    .leftJoin('app_user as u', 'u.user_id', 'b.requested_by')
    .select([
      'bs.session_id',
      'bs.session_no',
      'bs.status',
      'bs.venue_id',
      'v.name as venue_name',
      'b.booking_id',
      'b.origin',
      'b.purpose',
      'b.internal_client_ref',
      'u.full_name as requester_name',
      'u.email as requester_email',
      sql<string>`lower(bs.slot)`.as('starts_at'),
      sql<string>`upper(bs.slot)`.as('ends_at'),
    ])
    .where('bs.status', 'in', ['SCHEDULED', 'IN_PROGRESS'])
    .where('b.status', '=', 'APPROVED');

  if (filter.venueId) {
    q = q.where('bs.venue_id', '=', filter.venueId);
  }
  if (filter.from) {
    q = q.where(sql<boolean>`lower(bs.slot) >= ${filter.from}::timestamptz`);
  }
  if (filter.to) {
    q = q.where(sql<boolean>`lower(bs.slot) <= ${filter.to}::timestamptz`);
  }

  return q.orderBy('starts_at', 'asc').execute();
}

// ── session lifecycle: HIST-02 write path ──
// Coordinators mark sessions COMPLETED or CANCELLED once they've occurred
// or been called off. Each state transition writes one immutable usage_history
// row per HIST-02. The schema's tg_hist_terminal_guard and tg_hist_coherence
// triggers enforce correctness — the DB will reject a row if the session
// hasn't actually reached a terminal state.

export async function completeSession(sessionId: string, staffId: string) {
  try {
    const row = await db
      .selectFrom('booking_session as bs')
      .innerJoin('booking as b', 'b.booking_id', 'bs.booking_id')
      .select(['bs.session_id', 'bs.status', 'bs.venue_id', 'b.requested_by'])
      .where('bs.session_id', '=', sessionId)
      .executeTakeFirst();

    if (!row) throw notFound('Session not found.');
    if (row.status === 'COMPLETED') throw conflict('Session is already COMPLETED.');
    if (row.status === 'CANCELLED') throw conflict('Session is CANCELLED — cannot complete.');
    if (row.status === 'NEEDS_RESCHEDULING') throw conflict('Session needs rescheduling — resolve it before completing.');

    // Fetch venue sport_category_id separately (booking doesn't carry it directly)
    const venue = await db
      .selectFrom('venue')
      .select('sport_category_id')
      .where('venue_id', '=', row.venue_id)
      .executeTakeFirst();

    await db.transaction().execute(async (trx) => {
      await trx
        .updateTable('booking_session')
        .set({ status: 'COMPLETED' })
        .where('session_id', '=', sessionId)
        .execute();

      // HIST-02: write usage_history row now that session is COMPLETED.
      // The tg_hist_coherence trigger will validate our outcome matches the
      // session's actual status — if the UPDATE above failed, we'd never reach here.
      await trx
        .insertInto('usage_history')
        .values({
          kind: 'VENUE_SESSION',
          occurred_on: sql`current_date`,
          session_id: sessionId,
          actor_user_id: row.requested_by ?? null,
          venue_id: row.venue_id,
          sport_category_id: venue?.sport_category_id ?? null,
          outcome: 'COMPLETED',
          snapshot: JSON.stringify({ completedBy: staffId }),
        })
        .execute();
    });
  } catch (e) {
    throw mapDbError(e);
  }
}

export async function cancelSession(sessionId: string, staffId: string, reason: string) {
  try {
    const row = await db
      .selectFrom('booking_session as bs')
      .innerJoin('booking as b', 'b.booking_id', 'bs.booking_id')
      .select(['bs.session_id', 'bs.status', 'bs.venue_id', 'b.requested_by', 'b.booking_id'])
      .where('bs.session_id', '=', sessionId)
      .executeTakeFirst();

    if (!row) throw notFound('Session not found.');
    if (row.status === 'CANCELLED') throw conflict('Session is already CANCELLED.');
    if (row.status === 'COMPLETED') throw conflict('Session is already COMPLETED — cannot cancel.');

    const venue = await db
      .selectFrom('venue')
      .select('sport_category_id')
      .where('venue_id', '=', row.venue_id)
      .executeTakeFirst();

    await db.transaction().execute(async (trx) => {
      await trx
        .updateTable('booking_session')
        .set({ status: 'CANCELLED', cancellation_reason: reason, cancelled_by: staffId })
        .where('session_id', '=', sessionId)
        .execute();

      // HIST-02: write usage_history on CANCELLED terminal state.
      await trx
        .insertInto('usage_history')
        .values({
          kind: 'VENUE_SESSION',
          occurred_on: sql`current_date`,
          session_id: sessionId,
          actor_user_id: row.requested_by ?? null,
          venue_id: row.venue_id,
          sport_category_id: venue?.sport_category_id ?? null,
          outcome: 'CANCELLED',
          snapshot: JSON.stringify({ cancelledBy: staffId, reason }),
        })
        .execute();
    });

    // Notify requester if this was a client booking
    if (row.requested_by) {
      await notifyRequester(
        'BOOKING_CANCELLED',
        row.requested_by,
        'A venue session has been cancelled',
        reason,
        row.booking_id,
      );
    }
  } catch (e) {
    throw mapDbError(e);
  }
}

// ── Feature 9: markNeedsRescheduling (CONF-13) ──
// Soft resolution path — puts the session into NEEDS_RESCHEDULING so the
// Coordinator can arrange a new time. The slot is released from the exclusion
// constraint (v_calendar excludes NEEDS_RESCHEDULING sessions), allowing
// another booking to claim that window.
// CONF-13: when the new time is eventually submitted, it goes through the
// identical lock-and-conflict pipeline as a brand-new booking.
export async function markNeedsRescheduling(sessionId: string, staffId: string, reason: string) {
  try {
    const row = await db
      .selectFrom('booking_session as bs')
      .innerJoin('booking as b', 'b.booking_id', 'bs.booking_id')
      .select(['bs.session_id', 'bs.status', 'b.requested_by', 'b.booking_id'])
      .where('bs.session_id', '=', sessionId)
      .executeTakeFirst();

    if (!row) throw notFound('Session not found.');
    if (row.status === 'CANCELLED') throw conflict('Session is already CANCELLED — cannot reschedule.');
    if (row.status === 'COMPLETED') throw conflict('Session is already COMPLETED — cannot reschedule.');
    if (row.status === 'NEEDS_RESCHEDULING') throw conflict('Session is already marked as NEEDS_RESCHEDULING.');

    await db
      .updateTable('booking_session')
      .set({ status: 'NEEDS_RESCHEDULING', reschedule_reason: reason })
      .where('session_id', '=', sessionId)
      .execute();

    // Notify the requester that their session needs rescheduling.
    if (row.requested_by) {
      await notifyRequester(
        'BOOKING_RESCHEDULED',
        row.requested_by,
        'A session in your booking needs rescheduling',
        `Reason: ${reason}. The Coordinator will be in touch to arrange a new time.`,
        row.booking_id,
      );
    }
  } catch (e) {
    throw mapDbError(e);
  }
}
