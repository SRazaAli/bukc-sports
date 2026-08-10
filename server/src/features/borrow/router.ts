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
import { badRequest } from '../../middleware/errors.js';
import * as svc from './service.js';
import { submitKitBorrowRequest } from './kitBorrowService.js';
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

// Kit borrow — one request per equipment type in a sport, wrapped in a
// transaction. Must be registered BEFORE the parameterised /requests/:id
// routes so Express does not match "kit" as a borrow request ID.
borrowRouter.post('/requests/kit', ...student, asyncHandler(async (req, res) => {
  const { sportCategoryId, requestedStartAt, requestedReturnAt } = req.body as {
    sportCategoryId?: number;
    requestedStartAt?: string;
    requestedReturnAt?: string;
  };
  if (!sportCategoryId || !requestedStartAt || !requestedReturnAt) {
    throw badRequest('sportCategoryId, requestedStartAt and requestedReturnAt are required.');
  }
  const result = await submitKitBorrowRequest({
    sportCategoryId: Number(sportCategoryId),
    requestedStartAt: new Date(requestedStartAt),
    requestedReturnAt: new Date(requestedReturnAt),
    studentUserId: req.user!.userId,
  });
  res.status(201).json({
    message: `Kit requested: ${result.typeNames.join(', ')}.`,
    requestIds: result.requestIds,
  });
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

// Registered walk-in: coordinator enters enrollment number, system resolves
// the profile, then lends directly (no prior platform request needed).
borrowRouter.get('/lend/walkin/registered/resolve', ...coordinatorOnly, asyncHandler(async (req, res) => {
  const enrollmentNo = req.query['enrollmentNo'];
  if (typeof enrollmentNo !== 'string' || !enrollmentNo.trim()) throw badRequest('enrollmentNo query param required.');
  res.json({ borrower: await svc.resolveRegisteredBorrower(enrollmentNo.trim()) });
}));

borrowRouter.post('/lend/walkin/registered', ...coordinatorOnly, asyncHandler(async (req, res) => {
  const input = parse(v.lendWalkinRegisteredSchema, req.body);
  const created = await svc.lendWalkinRegistered(input, req.user!.userId);
  res.status(201).json({ transaction: created });
}));

// Student's own transaction list — covers both PLATFORM and WALK_IN paths.
// Registered walk-in borrows have borrower_user_id set, so they appear here
// even though they have no borrow_request row.
// Registered BEFORE /:id so "transactions" is not matched as a txn UUID.
borrowRouter.get('/transactions/mine', ...student, asyncHandler(async (req, res) => {
  res.json({ transactions: await svc.listMyTransactions(req.user!.userId) });
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

borrowRouter.get('/reputation/:userId', ...staffRead, asyncHandler(async (req, res) => {
  const userId = req.params.userId;
  if (!userId) throw badRequest('Missing userId');
  res.json(await svc.getReputation(userId));
}));
