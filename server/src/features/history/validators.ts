import { z } from 'zod';

// ISO date string yyyy-mm-dd
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD');

export const historyFilterSchema = z.object({
  from: dateStr.optional(),
  to: dateStr.optional(),
  kind: z.enum(['VENUE_SESSION', 'EQUIPMENT_BORROW']).optional(),
  outcome: z.string().max(32).optional(),
  sportCategoryId: z.coerce.number().int().positive().optional(),
  // HIST-13: staff only — validated in router before passing to service
  actorUserId: z.string().uuid().optional(),
  // OFFL-17: filter the "Entered via Offline Fallback" set
  offlineFallback: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export type HistoryFilterInput = z.infer<typeof historyFilterSchema>;
