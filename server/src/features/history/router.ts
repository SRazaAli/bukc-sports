/**
 * Usage History routes (Feature 10).
 *
 * GET /api/history       — list + filter (HIST-12/13/14)
 *
 * All authenticated roles can call this endpoint; scoping is done in the
 * service layer per HIST-08/09/10. No write endpoints — HIST-05 makes the
 * table immutable; writes happen inside the borrow and venue services at
 * transaction-terminal time.
 */
import { Router } from 'express';
import { asyncHandler } from '../../middleware/async.js';
import { requireAuth } from '../../middleware/auth.js';
import { badRequest, forbidden } from '../../middleware/errors.js';
import * as svc from './service.js';
import { historyFilterSchema } from './validators.js';

export const historyRouter = Router();

historyRouter.get('/', requireAuth, asyncHandler(async (req, res) => {
  const parsed = historyFilterSchema.safeParse(req.query);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw badRequest(msg);
  }

  const filter = parsed.data;
  const callerRole = req.user!.role;
  const isStaff = callerRole === 'SUPER_ADMIN' || callerRole === 'COORDINATOR';

  // HIST-13: actorUserId filter is staff-only; clients cannot cross-query
  if (filter.actorUserId && !isStaff) {
    throw forbidden('Only staff can filter by a specific user.');
  }

  // EXTERNAL cannot query EQUIPMENT_BORROW history (HIST-09)
  if (callerRole === 'EXTERNAL' && filter.kind === 'EQUIPMENT_BORROW') {
    throw forbidden('External accounts have no equipment borrow history.');
  }

  const result = await svc.listHistory(req.user!.userId, callerRole, filter);
  res.json({ history: result.rows, total: result.total });
}));
