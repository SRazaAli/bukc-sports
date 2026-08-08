/**
 * Inventory request validators (Feature 4). First-line validation; the DB
 * triggers/constraints remain the final gate (INV-05 barcode immutable, INV-07
 * same-type pair, INV-24 decommission terminal, etc.).
 */
import { z } from 'zod';

// UPC-A / EAN barcode format: exactly 12 numeric digits.
const barcodeSchema = z.string().regex(/^\d{12}$/, 'Barcode must be exactly 12 digits (UPC-A format)');

// Base64 data URI for an optional photo captured at entry/scan time.
const imageDataSchema = z.string().max(500_000).optional();

export const createEquipmentTypeSchema = z.object({
  sportCategoryId: z.number().int().positive(),
  name: z.string().min(2).max(120),
  lendingUnit: z.enum(['SINGLE', 'PAIR']),
  lowStockThreshold: z.number().int().min(0).default(7),
  maxBorrowDurationMinutes: z.number().int().positive().max(1440), // BORROW-01 same-day
  conditionGoodMinScore: z.number().min(0).max(100),
  conditionWornMinScore: z.number().min(0).max(100),
  isIndoor: z.boolean(),
  imageUrl: z.string().max(500_000).optional().or(z.literal('')), // base64 data URIs can be large
}).refine((v) => v.conditionGoodMinScore > v.conditionWornMinScore, {
  message: 'GOOD threshold must be higher than WORN threshold',
  path: ['conditionGoodMinScore'],
});

export const createSportCategorySchema = z.object({
  name: z.string().min(2).max(60),
  isIndoor: z.boolean(),
  imageData: imageDataSchema,
});

export const updateThresholdsSchema = z.object({
  lowStockThreshold: z.number().int().min(0).optional(),
  maxBorrowDurationMinutes: z.number().int().positive().max(1440).optional(),
});

// Full edit — everything except sportCategoryId/lendingUnit, which stay fixed
// once articles may exist under the type.
export const updateEquipmentTypeSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  isIndoor: z.boolean().optional(),
  lowStockThreshold: z.number().int().min(0).optional(),
  maxBorrowDurationMinutes: z.number().int().positive().max(1440).optional(),
  conditionGoodMinScore: z.number().min(0).max(100).optional(),
  conditionWornMinScore: z.number().min(0).max(100).optional(),
  imageUrl: z.string().max(500_000).optional().or(z.literal('')),
}).refine((v) => v.conditionGoodMinScore === undefined || v.conditionWornMinScore === undefined
  || v.conditionGoodMinScore > v.conditionWornMinScore, {
  message: 'GOOD threshold must be higher than WORN threshold',
  path: ['conditionGoodMinScore'],
});

// INV-02/03: a SINGLE article is added on its own. Barcode is the permanent identifier.
export const addArticleSchema = z.object({
  equipmentTypeId: z.number().int().positive(),
  barcode: barcodeSchema,
  entryScore: z.number().min(0).max(100), // INV-04
  imageData: imageDataSchema,
});

// Pair-type articles are always entered as a pair in one action (both barcodes
// together, stored already paired regardless of individual scores).
export const addArticlePairSchema = z.object({
  equipmentTypeId: z.number().int().positive(),
  barcodeA: barcodeSchema,
  barcodeB: barcodeSchema,
  entryScoreA: z.number().min(0).max(100),
  entryScoreB: z.number().min(0).max(100),
  imageDataA: imageDataSchema,
  imageDataB: imageDataSchema,
}).refine((v) => v.barcodeA !== v.barcodeB, {
  message: 'The two barcodes must be different', path: ['barcodeB'],
});

// INV-17: a scan (scheduled or ad-hoc) produces a score and updates the label.
export const scanSchema = z.object({
  kind: z.enum(['SCHEDULED', 'AD_HOC']),
  score: z.number().min(0).max(100),
  imageData: imageDataSchema,
});

// INV-19: manual condition override.
export const overrideConditionSchema = z.object({
  label: z.enum(['GOOD', 'WORN', 'DAMAGED']),
});

// INV-20: clearing a damage flag requires a fresh health score — the label is
// derived from it via the article's type thresholds, same as any other scan.
export const clearFlagSchema = z.object({
  score: z.number().min(0).max(100),
  imageData: imageDataSchema,
});
