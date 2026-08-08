/**
 * Venue booking routes (Feature 5 + Feature 9).
 *
 * Feature 5: Students/External submit; Coordinator reviews+forwards; Super
 * Admin decides. Mirrors the DB's authority triggers.
 *
 * Feature 9 additions:
 *   GET  /venue/conflicts         — advisory view of current approved sessions
 *                                   for a venue/date range (staff only, CONF-16).
 *   GET  /venue/sessions          — list approved booking_session rows with
 *                                   booking context (staff only).
 *   POST /venue/sessions/:id/reschedule — mark NEEDS_RESCHEDULING (CONF-13).
 *   POST /venue/sessions/:id/cancel    — already existed; conflict resolution path.
 *   POST /venue/sessions/:id/complete  — already existed; session lifecycle.
 */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/async.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { badRequest } from '../../middleware/errors.js';
import * as svc from './service.js';
import * as eq from './equipment.js';
import * as v from './validators.js';

export const venueRouter = Router();

const requester = [requireAuth, requireRole('STUDENT', 'EXTERNAL')] as const;
const coordinatorOnly = [requireAuth, requireRole('COORDINATOR')] as const;
const superAdminOnly = [requireAuth, requireRole('SUPER_ADMIN')] as const;
const anyStaff = [requireAuth, requireRole('SUPER_ADMIN', 'COORDINATOR')] as const;

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success) throw badRequest(r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  return r.data;
}
function reqId(req: { params: Record<string, string | undefined> }): string {
  const id = req.params.id;
  if (!id) throw badRequest('Missing id');
  return id;
}

// ── venues ──
venueRouter.get('/venues', requireAuth, asyncHandler(async (_req, res) => {
  res.json({ venues: await svc.listVenues() });
}));
venueRouter.post('/venues', ...superAdminOnly, asyncHandler(async (req, res) => {
  const input = parse(v.createVenueSchema, req.body);
  res.status(201).json({ venue: await svc.createVenue(input) });
}));

// ── requester ──
venueRouter.post('/bookings', ...requester, asyncHandler(async (req, res) => {
  const input = parse(v.submitBookingSchema, req.body);
  const origin = req.user!.role === 'STUDENT' ? 'CLIENT' : 'EXTERNAL';
  const created = await svc.submitBooking(req.user!.userId, origin, input);
  res.status(201).json({ booking: { bookingId: created.booking_id } });
}));
venueRouter.get('/bookings/mine', ...requester, asyncHandler(async (req, res) => {
  res.json({ bookings: await svc.listMyBookings(req.user!.userId) });
}));

// ── coordinator ──
venueRouter.get('/queue', ...coordinatorOnly, asyncHandler(async (_req, res) => {
  res.json({ queue: await svc.listCoordinatorQueue() });
}));
venueRouter.post('/bookings/:id/forward', ...coordinatorOnly, asyncHandler(async (req, res) => {
  const input = parse(v.feasibilityNoteSchema, req.body);
  await svc.forwardBooking(reqId(req), req.user!.userId, input.note);
  res.json({ message: 'Booking forwarded to Super Admin.' });
}));

// VENUE-28/29: Coordinator initiates a recurring academic calendar event
// through the same pipeline (they then forward it like any other PENDING item).
venueRouter.post('/academic-events', ...coordinatorOnly, asyncHandler(async (req, res) => {
  const input = parse(v.academicEventSchema, req.body);
  const created = await svc.initiateAcademicEvent(req.user!.userId, input);
  res.status(201).json({ booking: { bookingId: created.booking_id } });
}));

// ── shared reject (Coordinator at PENDING, Super Admin at FORWARDED) ──
venueRouter.post('/bookings/:id/reject', ...anyStaff, asyncHandler(async (req, res) => {
  const input = parse(v.rejectBookingSchema, req.body);
  await svc.rejectBooking(reqId(req), req.user!.userId, req.user!.role as 'COORDINATOR' | 'SUPER_ADMIN', input.reason);
  res.json({ message: 'Booking rejected.' });
}));

// ── super admin ──
venueRouter.get('/admin-queue', ...superAdminOnly, asyncHandler(async (_req, res) => {
  res.json({ queue: await svc.listSuperAdminQueue() });
}));
venueRouter.post('/bookings/:id/approve', ...superAdminOnly, asyncHandler(async (req, res) => {
  await svc.approveBooking(reqId(req), req.user!.userId);
  res.json({ message: 'Booking approved.' });
}));
venueRouter.post('/bookings/:id/return', ...superAdminOnly, asyncHandler(async (req, res) => {
  const input = parse(v.returnForReevalSchema, req.body);
  await svc.returnForReevaluation(reqId(req), req.user!.userId, input.note);
  res.json({ message: 'Booking returned to the Coordinator for re-evaluation.' });
}));

// ── shared reads ──
venueRouter.get('/bookings/:id', ...anyStaff, asyncHandler(async (req, res) => {
  res.json(await svc.getBookingDetail(reqId(req)));
}));
venueRouter.get('/calendar', requireAuth, asyncHandler(async (req, res) => {
  const venueId = req.query.venueId ? Number(req.query.venueId) : undefined;
  const from = typeof req.query.from === 'string' ? req.query.from : undefined;
  const to = typeof req.query.to === 'string' ? req.query.to : undefined;
  res.json({ sessions: await svc.listCalendar({ venueId, from, to }) });
}));

// ── equipment allocation (VENUE-13/15/16/17, EQUIP-AVAIL-11..21) ──
venueRouter.post('/bookings/:id/equipment', ...coordinatorOnly, asyncHandler(async (req, res) => {
  const input = parse(v.planAllocationSchema, req.body);
  const result = await eq.planAllocation(reqId(req), req.user!.userId, input.allocations);
  res.json({
    ...result,
    message: result.shortfalls.length > 0
      ? 'Shortfall detected — the requester has been asked to confirm coverage.'
      : 'Equipment plan saved.',
  });
}));
venueRouter.get('/bookings/:id/equipment', ...anyStaff, asyncHandler(async (req, res) => {
  res.json({ allocations: await eq.getAllocationPlan(reqId(req)) });
}));

// VENUE-16: the requester (Student/External) confirms or declines the shortfall.
venueRouter.post('/bookings/:id/shortfall-confirm', ...requester, asyncHandler(async (req, res) => {
  const input = parse(v.confirmShortfallSchema, req.body);
  const result = await eq.confirmShortfall(reqId(req), req.user!.userId, input.confirm);
  res.json({ ...result, message: input.confirm ? 'Confirmed — your booking is back with the Coordinator.' : 'Booking rejected.' });
}));

// ── session lifecycle (HIST-02) ──
// Staff mark sessions COMPLETED or CANCELLED. Each call writes one immutable
// usage_history row. COMPLETED = session was held; CANCELLED = called off.
venueRouter.post('/sessions/:id/complete', ...anyStaff, asyncHandler(async (req, res) => {
  await svc.completeSession(reqId(req), req.user!.userId);
  res.json({ message: 'Session marked completed.' });
}));
venueRouter.post('/sessions/:id/cancel', ...anyStaff, asyncHandler(async (req, res) => {
  const { reason } = req.body as { reason?: string };
  if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
    throw badRequest('reason is required when cancelling a session.');
  }
  await svc.cancelSession(reqId(req), req.user!.userId, reason.trim());
  res.json({ message: 'Session cancelled.' });
}));

// ── Feature 9: CONF-13 — mark NEEDS_RESCHEDULING ──
// Soft conflict resolution: releases the slot from the exclusion constraint
// without writing a terminal usage_history row (the session isn't done yet).
// The Coordinator then arranges a new time, which goes through the same
// conflict gate as any new booking submission (CONF-13).
venueRouter.post('/sessions/:id/reschedule', ...anyStaff, asyncHandler(async (req, res) => {
  const { reason } = req.body as { reason?: string };
  if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
    throw badRequest('reason is required when marking a session as needing rescheduling.');
  }
  await svc.markNeedsRescheduling(reqId(req), req.user!.userId, reason.trim());
  res.json({ message: 'Session marked as NEEDS_RESCHEDULING.' });
}));

// ── Feature 9: advisory conflict query (CONF-16) ──
// Returns all currently SCHEDULED/IN_PROGRESS sessions for a venue and
// optional date range. Staff use this to identify which booking holds a slot
// that a conflicting new request needs, then decide whether to cancel or
// reschedule it. This is a read-only advisory — no action is taken here.
venueRouter.get('/conflicts', ...anyStaff, asyncHandler(async (req, res) => {
  const venueId = req.query.venueId ? Number(req.query.venueId) : undefined;
  const from = typeof req.query.from === 'string' ? req.query.from : undefined;
  const to = typeof req.query.to === 'string' ? req.query.to : undefined;
  const sessions = await svc.queryApprovedSessions({ venueId, from, to });
  res.json({ sessions });
}));

// ── Feature 9: list approved sessions (staff view) ──
// Companion to the conflicts endpoint — lets staff browse all active sessions
// by venue/date to understand the schedule before acting.
venueRouter.get('/sessions', ...anyStaff, asyncHandler(async (req, res) => {
  const venueId = req.query.venueId ? Number(req.query.venueId) : undefined;
  const from = typeof req.query.from === 'string' ? req.query.from : undefined;
  const to = typeof req.query.to === 'string' ? req.query.to : undefined;
  const sessions = await svc.queryApprovedSessions({ venueId, from, to });
  res.json({ sessions });
}));

venueRouter.get('/event-equipment/alerts', ...coordinatorOnly, asyncHandler(async (_req, res) => {
  await eq.checkEquipmentLocks();
  await eq.checkPostEventRelease();
  res.json({ alerts: await eq.listAlertingAllocations() });
}));
venueRouter.post('/event-equipment/:id/swap', ...coordinatorOnly, asyncHandler(async (req, res) => {
  const input = parse(v.performSwapSchema, req.body);
  await eq.performSwap(reqId(req), req.user!.userId, input);
  res.json({ message: 'Swap recorded.' });
}));
