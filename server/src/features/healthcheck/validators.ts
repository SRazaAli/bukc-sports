/**
 * Request validation for the CV Equipment Health Check feature.
 * First-line checks only; the CV service and the DB triggers remain the final gates.
 */
import { z } from 'zod';

export const EQUIPMENT_KINDS = ['BASKETBALL', 'FOOTBALL', 'VOLLEYBALL'] as const;
export type EquipmentKind = (typeof EQUIPMENT_KINDS)[number];

/** A photo sent by the browser as a data URL (the UI shrinks it to ≤1600 px first). */
const photoSchema = z.string()
  .regex(/^data:image\/(jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=\s]+$/, 'Each photo must be a JPG or PNG image')
  .max(7_500_000, 'Each photo must be 5 MB or smaller');

export const createScanSchema = z.object({
  equipmentKind: z.enum(EQUIPMENT_KINDS),
  articleId: z.string().uuid('Choose the item (barcode) you are checking'),
  scanKind: z.enum(['AD_HOC', 'SCHEDULED']).default('AD_HOC'),
  images: z.array(photoSchema).min(1, 'Upload at least one photo').max(4, 'Upload at most 4 photos (angles) of one item'),
});
export type CreateScanInput = z.infer<typeof createScanSchema>;

export const listScansSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(10),
  offset: z.coerce.number().int().min(0).default(0),
  equipmentKind: z.enum(EQUIPMENT_KINDS).optional(),
  articleId: z.string().uuid().optional(),
});
