import { z } from 'zod';

// BORROW-01: same-day, hour-window based.
export const submitRequestSchema = z.object({
  equipmentTypeId: z.number().int().positive(),
  requestedStartAt: z.string().datetime(),
  requestedReturnAt: z.string().datetime(),
}).refine((v) => new Date(v.requestedReturnAt) > new Date(v.requestedStartAt), {
  message: 'Return time must be after start time', path: ['requestedReturnAt'],
}).refine((v) => {
  const s = new Date(v.requestedStartAt);
  const r = new Date(v.requestedReturnAt);
  return s.toDateString() === r.toDateString();
}, { message: 'BORROW-01: borrowing is same-day only', path: ['requestedReturnAt'] });

export const rejectRequestSchema = z.object({
  reason: z.string().min(1).max(300),
});

// BORROW-08: lending form fields. articleIds length is validated against the
// equipment type's lending_unit by the DB trigger (BORROW-03).
export const lendPlatformSchema = z.object({
  borrowRequestId: z.string().uuid(),
  articleIds: z.array(z.string().uuid()).min(1).max(2),
  agreedStartAt: z.string().datetime(),
  agreedReturnAt: z.string().datetime(),
});

const walkinCommon = z.object({
  equipmentTypeId: z.number().int().positive(),
  articleIds: z.array(z.string().uuid()).min(1).max(2),
  agreedStartAt: z.string().datetime(),
  agreedReturnAt: z.string().datetime(),
});
export const lendWalkinGuestSchema = walkinCommon.extend({
  guestFullName: z.string().min(2).max(120),
  guestIdNumber: z.string().min(2).max(60),
  guestContactNumber: z.string().min(6).max(30),
  guestIsFaculty: z.boolean(),
});

// BORROW-22: on return, acceptable / damaged / trigger-a-scan / dismiss.
export const returnSchema = z.object({
  articleIds: z.array(z.string().uuid()).min(1).max(2),
  mode: z.enum(['scan', 'manual', 'dismiss']),
  score: z.number().min(0).max(100).optional(),
  label: z.enum(['GOOD', 'WORN', 'DAMAGED']).optional(),
}).refine((v) => v.mode !== 'scan' || v.score !== undefined, {
  message: 'score is required when mode is "scan"', path: ['score'],
}).refine((v) => v.mode !== 'manual' || v.label !== undefined, {
  message: 'label is required when mode is "manual"', path: ['label'],
});
