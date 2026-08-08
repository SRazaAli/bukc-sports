/**
 * Offline Fallback Entry routes (Feature 11).
 *
 * POST /api/offline/booking  — enter a paper-logged venue booking (OFFL-04/06)
 * POST /api/offline/borrow   — enter a paper-logged equipment borrow (OFFL-04/07)
 * POST /api/offline/return   — enter a paper-logged equipment return (OFFL-04)
 * GET  /api/offline/audit    — list fallback audit log (OFFL-15/17)
 *
 * Access: COORDINATOR and SUPER_ADMIN only (OFFL-03).
 * OFFL-11: no approval workflow. Entry = submission + approval in one step.
 * OFFL-08: the form is designed for one entry at a time; the server imposes no
 *   ordering constraint (that is the Coordinator's responsibility), but
 *   conflict/inventory checks naturally enforce correctness.
 */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/async.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { badRequest } from '../../middleware/errors.js';
import * as svc from './service.js';
import {
  fallbackBookingSchema,
  fallbackBorrowSchema,
  fallbackReturnSchema,
} from './validators.js';

export const offlineRouter = Router();

const staffOnly = [requireAuth, requireRole('SUPER_ADMIN', 'COORDINATOR')] as const;

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success) {
    throw badRequest(r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  }
  return r.data;
}

// ── Fallback booking (OFFL-04/06) ──
offlineRouter.post('/booking', ...staffOnly, asyncHandler(async (req, res) => {
  const input = parse(fallbackBookingSchema, req.body);
  const result = await svc.enterFallbackBooking(input, req.user!.userId);
  res.status(201).json({ message: 'Fallback booking entry synced.', ...result });
}));

// ── Fallback borrow (OFFL-04/07) ──
offlineRouter.post('/borrow', ...staffOnly, asyncHandler(async (req, res) => {
  const input = parse(fallbackBorrowSchema, req.body);
  const result = await svc.enterFallbackBorrow(input, req.user!.userId);
  res.status(201).json({ message: 'Fallback borrow entry synced.', ...result });
}));

// ── Fallback return (OFFL-04) ──
offlineRouter.post('/return', ...staffOnly, asyncHandler(async (req, res) => {
  const input = parse(fallbackReturnSchema, req.body);
  const result = await svc.enterFallbackReturn(input, req.user!.userId);
  res.status(201).json({ message: 'Fallback return entry synced.', ...result });
}));

// ── Audit log (OFFL-15/17) ──
offlineRouter.get('/audit', ...staffOnly, asyncHandler(async (req, res) => {
  const from = typeof req.query.from === 'string' ? req.query.from : undefined;
  const to   = typeof req.query.to   === 'string' ? req.query.to   : undefined;
  const entries = await svc.listFallbackAudit({ from, to });
  res.json({ entries });
}));
