/**
 * Inventory routes (Feature 4). All mutations are staff-only (SUPER_ADMIN or
 * COORDINATOR) per INV role table; the DB staff-guard triggers enforce this
 * again. Reads of availability status are open to any authenticated user
 * (clients see the derived availability, EQUIP-AVAIL feature builds on it).
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
inventoryRouter.patch('/types/:id', ...staff, asyncHandler(async (req, res) => {
  const input = parse(v.updateEquipmentTypeSchema, req.body);
  await svc.updateEquipmentType(Number(reqId(req)), input);
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

inventoryRouter.post('/articles', ...staff, asyncHandler(async (req, res) => {
  const input = parse(v.addArticleSchema, req.body);
  const created = await svc.addArticle(input, req.user!.userId);
  res.status(201).json({ article: created });
}));

// Pair-type articles are always entered as a pair in one action (INV-07/08 at intake).
inventoryRouter.post('/articles/pair', ...staff, asyncHandler(async (req, res) => {
  const input = parse(v.addArticlePairSchema, req.body);
  const created = await svc.addArticlePair(input, req.user!.userId);
  res.status(201).json({ pairEntry: created });
}));

inventoryRouter.get('/articles/:id', ...staff, asyncHandler(async (req, res) => {
  res.json(await svc.getArticleDetail(reqId(req)));
}));

// Decommissioning a pair-type article decommissions both halves (service-level).
inventoryRouter.post('/articles/:id/decommission', ...staff, asyncHandler(async (req, res) => {
  await svc.decommissionArticle(reqId(req), req.user!.userId);
  res.json({ message: 'Article decommissioned.' });
}));

inventoryRouter.post('/articles/:id/scan', ...staff, asyncHandler(async (req, res) => {
  const input = parse(v.scanSchema, req.body);
  const result = await svc.recordScan(reqId(req), input, req.user!.userId);
  res.json({ ...result, message: 'Scan recorded.' });
}));

inventoryRouter.post('/articles/:id/condition', ...staff, asyncHandler(async (req, res) => {
  const input = parse(v.overrideConditionSchema, req.body);
  await svc.overrideCondition(reqId(req), input.label);
  res.json({ message: 'Condition updated.' });
}));

// ── Damage flags ──
inventoryRouter.get('/damage-flags', ...staff, asyncHandler(async (_req, res) => {
  res.json({ flags: await svc.listOpenDamageFlags() });
}));

// Clearing now takes a fresh health score (like any scan) — the label is derived
// from the article's type thresholds, consistent with scoring everywhere else.
inventoryRouter.post('/damage-flags/:id/clear', ...staff, asyncHandler(async (req, res) => {
  const input = parse(v.clearFlagSchema, req.body);
  const result = await svc.clearDamageFlag(reqId(req), input.score, req.user!.userId, input.imageData);
  res.json({ ...result, message: 'Damage flag cleared.' });
}));
