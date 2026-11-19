/**
 * Coordinator Dashboard — /api/coordinator-dashboard
 *
 *   GET /                     equipment health + inventory overview (charts)
 *   GET /export/inventory     { filename, csv } — every equipment type with stock, Low/High and units needed
 *   GET /export/health-scans  { filename, csv } — every article with its latest scan result and scan status
 *
 * The CSVs come back inside JSON so the normal authenticated api() call (with
 * its silent token refresh) can fetch them; the browser then saves the file.
 */
import { Router } from 'express';
import { asyncHandler } from '../../middleware/async.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import * as svc from './service.js';

export const coordinatorDashboardRouter = Router();
const staff = [requireAuth, requireRole('COORDINATOR', 'SUPER_ADMIN')] as const;

coordinatorDashboardRouter.get('/', ...staff, asyncHandler(async (_req, res) => {
  res.json(await svc.getCoordinatorDashboard());
}));
coordinatorDashboardRouter.get('/export/inventory', ...staff, asyncHandler(async (_req, res) => {
  res.json(await svc.inventoryCsv());
}));
coordinatorDashboardRouter.get('/export/health-scans', ...staff, asyncHandler(async (_req, res) => {
  res.json(await svc.healthScanCsv());
}));
