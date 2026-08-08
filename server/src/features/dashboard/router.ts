/**
 * Dashboard routes (Feature 12).
 *
 * DASH-13: only SUPER_ADMIN and COORDINATOR can access this route.
 * DASH-03: the response shape differs per role — Super Admin gets the full set,
 *          Coordinator gets the operational subset (no user management, no
 *          delegation controls).
 * DASH-01: no business logic lives here — all data is read from the source
 *          modules that Feature 1–11 already own.
 */
import { Router } from 'express';
import { asyncHandler } from '../../middleware/async.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import * as svc from './service.js';

export const dashboardRouter = Router();

// GET /api/dashboard — returns the role-scoped panel set (DASH-02/03)
dashboardRouter.get(
  '/',
  requireAuth,
  requireRole('SUPER_ADMIN', 'COORDINATOR'),
  asyncHandler(async (req, res) => {
    if (req.user!.role === 'SUPER_ADMIN') {
      const data = await svc.getSuperAdminDashboard();
      res.json({ role: 'SUPER_ADMIN', dashboard: data });
    } else {
      const data = await svc.getCoordinatorDashboard();
      res.json({ role: 'COORDINATOR', dashboard: data });
    }
  }),
);
