/**
 * Borrow desk routes — /api/borrow-desk (additive; the original /api/borrow
 * routes are unchanged). Mounted on its own prefix because /api/borrow has a
 * catch-all GET /:id route that would swallow new GET paths.
 *
 *   GET  /badges                 sidebar counts for the signed-in user
 *   GET  /overview               coordinator: approved requests ready to collect + enrollment lookup
 *   POST /groups/:groupId/lend   coordinator: lend after checking the university card (requested day only)
 *   GET  /active                 staff: live active borrows with enrollment no. and borrow window
 *   GET  /on-loan                coordinator: Borrow Queue "On loan" list (lent, not yet submitted)
 *   POST /submitted              coordinator: student handed everything back → Completed / Completed late
 *   GET  /mine/history           student: full borrow history
 *   POST /mine/seen              student: clear the "approved" badge
 *   GET  /mine/late              student: loans past their return time (Late submission pop-up)
 */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/async.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { badRequest } from '../../middleware/errors.js';
import * as desk from './deskService.js';

export const borrowDeskRouter = Router();

const staffRead = [requireAuth, requireRole('SUPER_ADMIN', 'COORDINATOR')] as const;
const coordinatorOnly = [requireAuth, requireRole('COORDINATOR')] as const;
const student = [requireAuth, requireRole('STUDENT')] as const;

const lendSchema = z.object({
  idCardEnrollmentNo: z.string().trim().min(1, 'Enter the enrollment number printed on the university card'),
  articlesPerType: z.record(z.string(), z.array(z.string().uuid()).min(1)),
});

borrowDeskRouter.get('/badges', requireAuth, asyncHandler(async (req, res) => {
  res.json(await desk.badgeCounts(req.user!.userId, req.user!.role));
}));

borrowDeskRouter.get('/overview', ...coordinatorOnly, asyncHandler(async (_req, res) => {
  res.json(await desk.getDeskOverview());
}));

borrowDeskRouter.post('/groups/:groupId/lend', ...coordinatorOnly, asyncHandler(async (req, res) => {
  const groupId = req.params.groupId;
  if (!groupId) throw badRequest('Missing groupId');
  const r = lendSchema.safeParse(req.body);
  if (!r.success) throw badRequest(r.error.issues.map((i) => i.message).join('; '));
  const articlesPerType = Object.fromEntries(Object.entries(r.data.articlesPerType).map(([k, v]) => [Number(k), v]));
  const result = await desk.lendWithCard(groupId, { idCardEnrollmentNo: r.data.idCardEnrollmentNo, articlesPerType }, req.user!.userId);
  res.status(201).json({ transactions: result.borrowTxnIds });
}));

const submittedSchema = z.object({ txnIds: z.array(z.string().uuid()).min(1).max(50) });

borrowDeskRouter.get('/on-loan', ...coordinatorOnly, asyncHandler(async (_req, res) => {
  res.json(await desk.listOnLoan());
}));

borrowDeskRouter.post('/submitted', ...coordinatorOnly, asyncHandler(async (req, res) => {
  const r = submittedSchema.safeParse(req.body);
  if (!r.success) throw badRequest(r.error.issues.map((i) => i.message).join('; '));
  res.json(await desk.markSubmitted(r.data.txnIds, req.user!.userId));
}));

borrowDeskRouter.get('/active', ...staffRead, asyncHandler(async (_req, res) => {
  res.json(await desk.listActiveDetailed());
}));

borrowDeskRouter.get('/mine/history', ...student, asyncHandler(async (req, res) => {
  res.json(await desk.myHistory(req.user!.userId));
}));

borrowDeskRouter.post('/mine/seen', ...student, asyncHandler(async (req, res) => {
  await desk.markMyApprovalsSeen(req.user!.userId);
  res.json({ ok: true });
}));

borrowDeskRouter.get('/mine/late', ...student, asyncHandler(async (req, res) => {
  res.json(await desk.myLateLoans(req.user!.userId));
}));
