/**
 * CV Equipment Health Check routes — /api/health-check
 *
 *   GET  /status                 CV service online? which equipment types are ready
 *   GET  /articles?kind=...      items of that kind the coordinator can scan
 *   POST /scans                  run a health check (1–4 photos) and save it
 *   GET  /scans?limit&offset     scan history (newest first)
 *   GET  /scans/:id              one scan with heatmap + per-photo results
 *
 * Staff only (COORDINATOR, SUPER_ADMIN) — the DB trigger fn_scan_staff enforces
 * the same rule again. The UI for this feature is shown to Coordinators.
 *
 * Photos arrive as base64 data URLs inside JSON, so this router has its own
 * JSON parser with a larger limit. It is mounted in app.ts BEFORE the global
 * express.json() (100 kb limit), which therefore stays exactly as it was for
 * every other route.
 */
import express, { Router } from 'express';
import type { z } from 'zod';
import { asyncHandler } from '../../middleware/async.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { badRequest } from '../../middleware/errors.js';
import { cvStatus } from './cvClient.js';
import * as svc from './service.js';
import { EQUIPMENT_KINDS, createScanSchema, listScansSchema, type EquipmentKind } from './validators.js';

export const healthCheckRouter = Router();

healthCheckRouter.use(express.json({ limit: '25mb' }));
const staff = [requireAuth, requireRole('SUPER_ADMIN', 'COORDINATOR')] as const;

function parse<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success) throw badRequest(r.error.issues.map((i) => i.message).join('; '));
  return r.data;
}

healthCheckRouter.get('/status', ...staff, asyncHandler(async (_req, res) => {
  res.json(await cvStatus());
}));

healthCheckRouter.get('/articles', ...staff, asyncHandler(async (req, res) => {
  const kind = String(req.query.kind ?? '') as EquipmentKind;
  if (!EQUIPMENT_KINDS.includes(kind)) {
    throw badRequest('kind must be BASKETBALL, FOOTBALL or VOLLEYBALL', 'WRONG_EQUIPMENT_TYPE');
  }
  res.json({ articles: await svc.listCandidateArticles(kind) });
}));

healthCheckRouter.post('/scans', ...staff, asyncHandler(async (req, res) => {
  const input = parse(createScanSchema, req.body);
  const scan = await svc.createScan(input, req.user!.userId);
  res.status(201).json({ scan });
}));

healthCheckRouter.get('/scans', ...staff, asyncHandler(async (req, res) => {
  const q = parse(listScansSchema, req.query);
  res.json(await svc.listScans(q));
}));

healthCheckRouter.get('/scans/:id', ...staff, asyncHandler(async (req, res) => {
  const id = req.params.id ?? '';
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw badRequest('Invalid scan id');
  res.json({ scan: await svc.getScan(id) });
}));

// Body-parser errors from this router's own JSON parser (photos too big / bad JSON)
// become clear 413/400 responses instead of a generic 500.
healthCheckRouter.use(((err, _req, res, next) => {
  const type = (err as { type?: string })?.type;
  if (type === 'entity.too.large') {
    return res.status(413).json({ error: 'The photos are too large. Use at most 4 photos of 5 MB each.', code: 'IMAGE_TOO_LARGE' });
  }
  if (type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed request body.', code: 'BAD_JSON' });
  return next(err);
}) as express.ErrorRequestHandler);
