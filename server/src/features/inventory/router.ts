/**
 * Inventory routes (Feature 4). All mutations are staff-only (SUPER_ADMIN or
 * COORDINATOR) per INV role table; the DB staff-guard triggers enforce this
 * again. Reads of availability status are open to any authenticated user
 * (clients see the derived availability, EQUIP-AVAIL feature builds on it).
 *
 * Actor identity (userId + role) is now threaded into mutating service calls so
 * notifications (INV-01/21/22/23) and audit log (INV-25) can record who acted.
 */
import { Router } from 'express';
import { asyncHandler } from '../../middleware/async.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import type { ArticleState, ConditionLabel } from '../../db/index.js';
import * as svc from './service.js';
import * as v from './validators.js';
import { z } from 'zod';
import { badRequest } from '../../middleware/errors.js';

export const inventoryRouter = Router();

const staff = [requireAuth, requireRole('SUPER_ADMIN', 'COORDINATOR')] as const;

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success) {
    const msg = r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw badRequest(msg);
  }
  return r.data;
}

function reqId(req: { params: Record<string, string | undefined> }): string {
  const id = req.params.id;
  if (!id) throw badRequest('Missing id');
  return id;
}

// ── Reference ──
inventoryRouter.get('/sport-categories', requireAuth, asyncHandler(async (_req, res) => {
  res.json({ categories: await svc.listSportCategories() });
}));

inventoryRouter.post('/sport-categories', ...staff, asyncHandler(async (req, res) => {
  const input = parse(v.createSportCategorySchema, req.body);
  const created = await svc.createSportCategory(input);
  res.status(201).json({ category: created });
}));

inventoryRouter.get('/item-presets', requireAuth, asyncHandler(async (req, res) => {
  const sportCategoryId = req.query.sportCategoryId ? Number(req.query.sportCategoryId) : undefined;
  res.json({ presets: await svc.listItemPresets(sportCategoryId) });
}));

// ── Equipment types ──
inventoryRouter.get('/types', requireAuth, asyncHandler(async (_req, res) => {
  res.json({ types: await svc.listEquipmentTypes() });
}));

inventoryRouter.post('/types', ...staff, asyncHandler(async (req, res) => {
  const input = parse(v.createEquipmentTypeSchema, req.body);
  const created = await svc.createEquipmentType(input);
  res.status(201).json({ type: { equipmentTypeId: created.equipment_type_id, name: created.name } });
}));

inventoryRouter.patch('/types/:id/thresholds', ...staff, asyncHandler(async (req, res) => {
  const input = parse(v.updateThresholdsSchema, req.body);
  await svc.updateThresholds(Number(reqId(req)), input);
  res.json({ message: 'Thresholds updated.' });
}));

// Full edit — name, indoor flag, thresholds/duration, condition bands, image.
// INV-22: actor identity and role are passed through for SA notification + audit.
inventoryRouter.patch('/types/:id', ...staff, asyncHandler(async (req, res) => {
  const input = parse(v.updateEquipmentTypeSchema, req.body);
  await svc.updateEquipmentType(Number(reqId(req)), input, req.user!.userId, req.user!.role);
  res.json({ message: 'Equipment type updated.' });
}));

inventoryRouter.delete('/types/:id', ...staff, asyncHandler(async (req, res) => {
  await svc.deleteEquipmentType(Number(reqId(req)));
  res.json({ message: 'Equipment type deleted.' });
}));

// ── Availability status (read — any authenticated user) ──
inventoryRouter.get('/status', requireAuth, asyncHandler(async (_req, res) => {
  res.json({ status: await svc.equipmentStatus() });
}));

// ── Articles ──
inventoryRouter.get('/articles', ...staff, asyncHandler(async (req, res) => {
  const equipmentTypeId = req.query.equipmentTypeId ? Number(req.query.equipmentTypeId) : undefined;
  const state = req.query.state as ArticleState | undefined;
  const condition = req.query.condition as ConditionLabel | undefined;
  res.json({ articles: await svc.listArticles({ equipmentTypeId, state, condition }) });
}));

// INV-02/03/04: add single article. INV-01/25: actor info passed through.
inventoryRouter.post('/articles', ...staff, asyncHandler(async (req, res) => {
  const input = parse(v.addArticleSchema, req.body);
  const created = await svc.addArticle(input, req.user!.userId, req.user!.role);
  res.status(201).json({ article: created });
}));

// Pair-type articles are always entered as a pair (INV-07/08 at intake).
// INV-01/25: actor info passed through.
inventoryRouter.post('/articles/pair', ...staff, asyncHandler(async (req, res) => {
  const input = parse(v.addArticlePairSchema, req.body);
  const created = await svc.addArticlePair(input, req.user!.userId, req.user!.role);
  res.status(201).json({ pairEntry: created });
}));

// INV-27: full lifecycle of one article (scans, flags, pairs, audit log).
inventoryRouter.get('/articles/:id', ...staff, asyncHandler(async (req, res) => {
  res.json(await svc.getArticleDetail(reqId(req)));
}));

// INV-27: dedicated lifecycle endpoint (same data, explicit path).
inventoryRouter.get('/articles/:id/lifecycle', ...staff, asyncHandler(async (req, res) => {
  res.json(await svc.getArticleLifecycle(reqId(req)));
}));

// Decommissioning a pair-type article decommissions both halves (service-level).
// INV-23/25: actor info passed through.
inventoryRouter.post('/articles/:id/decommission', ...staff, asyncHandler(async (req, res) => {
  await svc.decommissionArticle(reqId(req), req.user!.userId, req.user!.role);
  res.json({ message: 'Article decommissioned.' });
}));

inventoryRouter.post('/articles/:id/scan', ...staff, asyncHandler(async (req, res) => {
  const input = parse(v.scanSchema, req.body);
  const result = await svc.recordScan(reqId(req), input, req.user!.userId);
  res.json({ ...result, message: 'Scan recorded.' });
}));

// INV-19: manual condition override — logged via INV-25 audit.
inventoryRouter.post('/articles/:id/condition', ...staff, asyncHandler(async (req, res) => {
  const input = parse(v.overrideConditionSchema, req.body);
  await svc.overrideCondition(reqId(req), input.label, req.user!.userId);
  res.json({ message: 'Condition updated.' });
}));

// ── Damage flags ──
inventoryRouter.get('/damage-flags', ...staff, asyncHandler(async (_req, res) => {
  res.json({ flags: await svc.listOpenDamageFlags() });
}));

inventoryRouter.post('/damage-flags/:id/clear', ...staff, asyncHandler(async (req, res) => {
  const input = parse(v.clearFlagSchema, req.body);
  const result = await svc.clearDamageFlag(reqId(req), input.score, req.user!.userId, input.imageData);
  res.json({ ...result, message: 'Damage flag cleared.' });
}));

// ── Audit log (INV-25) — staff read ──
inventoryRouter.get('/audit-log', ...staff, asyncHandler(async (req, res) => {
  const articleId = req.query.articleId as string | undefined;
  const equipmentTypeId = req.query.equipmentTypeId ? Number(req.query.equipmentTypeId) : undefined;
  const limit = req.query.limit ? Math.min(Number(req.query.limit), 500) : 200;
  res.json({ log: await svc.listArticleAuditLog({ articleId, equipmentTypeId, limit }) });
}));
