import { z } from 'zod';

export const availabilityFilterSchema = z.object({
  sportCategoryId: z.coerce.number().int().positive().optional(),
  equipmentTypeId: z.coerce.number().int().positive().optional(),
  isIndoor: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
});
