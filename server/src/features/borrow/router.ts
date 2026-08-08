/**
 * Borrow & return routes (Feature 3). Students submit/view their own requests;
 * Coordinators (and Super Admin) review, lend, and process returns. Role
 * checks mirror the DB triggers (fn_borrow_role_guard, fn_borrow_decider_guard,
 * fn_lent_by_guard) — defense in depth.
 */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/async.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { badRequest, forbidden } from '../../middleware/errors.js';
import * as svc from './service.js';
import * as v from './validators.js';

export const borrowRouter = Router();

// Reads: either staff role. Decide/lend/return: BORROW-07 makes this
// Coordinator-only (the DB triggers fn_borrow_decider_guard/fn_lent_by_guard
// already enforce this — the router mirrors it so a request never reaches a
// query it isn't allowed to make).
const staffRead = [requireAuth, requireRole('SUPER_ADMIN', 'COORDINATOR')] as const;
const coordinatorOnly = [requireAuth, requireRole('COORDINATOR')] as const;
const student = [requireAuth, requireRole('STUDENT')] as const;

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

// ── student ──
borrowRouter.post('/requests', ...student, asyncHandler(async (req, res) => {
  const input = parse(v.submitRequestSchema, req.body);
  const created = await svc.submitRequest(req.user!.userId, input);
  res.status(201).json({ request: { borrowRequestId: created.borrow_request_id } });
}));

borrowRouter.get('/requests/mine', ...student, asyncHandler(async (req, res) => {
  res.json({ requests: await svc.listMyRequests(req.user!.userId) });
}));

// ── coordinator ──
borrowRouter.get('/queue', ...staffRead, asyncHandler(async (_req, res) => {
  await svc.checkOverdueBorrows();
  res.json({ queue: await svc.listQueue() });
}));

borrowRouter.post('/requests/:id/approve', ...coordinatorOnly, asyncHandler(async (req, res) => {
  await svc.approveRequest(reqId(req), req.user!.userId);
  res.json({ message: 'Request approved.' });
}));

borrowRouter.post('/requests/:id/reject', ...coordinatorOnly, asyncHandler(async (req, res) => {
  const input = parse(v.rejectRequestSchema, req.body);
  await svc.rejectRequest(reqId(req), req.user!.userId, input.reason);
  res.json({ message: 'Request rejected.' });
}));

borrowRouter.post('/lend/platform', ...coordinatorOnly, asyncHandler(async (req, res) => {
  const input = parse(v.lendPlatformSchema, req.body);
  const created = await svc.lendPlatform(input, req.user!.userId);
  res.status(201).json({ transaction: created });
}));

borrowRouter.post('/lend/walkin/guest', ...coordinatorOnly, asyncHandler(async (req, res) => {
  const input = parse(v.lendWalkinGuestSchema, req.body);
  const created = await svc.lendWalkinGuest(input, req.user!.userId);
  res.status(201).json({ transaction: created });
}));

borrowRouter.get('/active', ...staffRead, asyncHandler(async (_req, res) => {
  await svc.checkOverdueBorrows();
  res.json({ transactions: await svc.listActiveBorrows() });
}));

borrowRouter.get('/:id', ...staffRead, asyncHandler(async (req, res) => {
  res.json(await svc.getTransactionDetail(reqId(req)));
}));

borrowRouter.post('/:id/return', ...coordinatorOnly, asyncHandler(async (req, res) => {
  const input = parse(v.returnSchema, req.body);
  const result = await svc.returnArticles(reqId(req), input, req.user!.userId);
  res.json({ ...result, message: 'Return processed.' });
}));

borrowRouter.get('/reputation/:userId', requireAuth, asyncHandler(async (req, res) => {
  const userId = req.params.userId;
  if (!userId) throw badRequest('Missing userId');
  const isStaff = req.user!.role === 'SUPER_ADMIN' || req.user!.role === 'COORDINATOR';
  if (!isStaff && userId !== req.user!.userId) {
    throw forbidden('Cannot view another user\'s reputation.');
  }
  res.json(await svc.getReputation(userId));
}));
