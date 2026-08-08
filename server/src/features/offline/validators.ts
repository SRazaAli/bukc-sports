import { z } from 'zod';

const isoDatetime = z.string().datetime({ offset: true, message: 'Must be an ISO 8601 datetime with timezone offset (e.g. 2025-01-15T10:00:00+05:00)' });

// ── OFFL-04/05: Fallback booking entry ──
// Captures the same fields as a live booking (VENUE-05): venue, actual event
// time, and team/participant details for one session. The actual event time —
// not the entry time — is recorded as the session's slot (OFFL-05).
// Single-session only: a paper log entry covers one session at a time (OFFL-08).
export const fallbackBookingSchema = z.object({
  venueId:               z.number().int().positive(),
  purpose:               z.string().min(1).max(300),
  estimatedParticipants: z.number().int().positive(),
  sessionStartAt:        isoDatetime,
  sessionEndAt:          isoDatetime,
  teamName:              z.string().min(1).max(120),
  participantDetails:    z.string().max(500).optional(),
  note:                  z.string().max(500).optional(),
}).refine(
  (v) => new Date(v.sessionEndAt) > new Date(v.sessionStartAt),
  { message: 'Session end must be after start', path: ['sessionEndAt'] },
);

// ── OFFL-04/05: Fallback borrow entry ──
// Captures the same fields as the lending form (BORROW-08). The borrower is
// identified by enrollment number (registered student) or by name/ID (guest).
// Inventory validation against current state happens in the service (OFFL-07).
// Unlike live borrows, the same-day constraint is waived for fallback entries
// (OFFL-12/13: extended downtime may produce multi-day borrows).
const borrowerRegistered = z.object({
  borrowerKind: z.literal('REGISTERED'),
  enrollmentNo: z.string().min(1).max(30),
});

const borrowerGuest = z.object({
  borrowerKind:       z.literal('GUEST'),
  guestFullName:      z.string().min(2).max(120),
  guestIdNumber:      z.string().min(2).max(60),
  guestContactNumber: z.string().min(6).max(30),
});

export const fallbackBorrowSchema = z.discriminatedUnion('borrowerKind', [
  borrowerRegistered.extend({
    equipmentTypeId: z.number().int().positive(),
    articleIds:      z.array(z.string().uuid()).min(1).max(2),
    agreedStartAt:   isoDatetime,
    agreedReturnAt:  isoDatetime,
    note:            z.string().max(500).optional(),
  }),
  borrowerGuest.extend({
    equipmentTypeId: z.number().int().positive(),
    articleIds:      z.array(z.string().uuid()).min(1).max(2),
    agreedStartAt:   isoDatetime,
    agreedReturnAt:  isoDatetime,
    note:            z.string().max(500).optional(),
  }),
]).refine(
  (v) => new Date(v.agreedReturnAt) > new Date(v.agreedStartAt),
  { message: 'Return time must be after start time', path: ['agreedReturnAt'] },
);

// ── OFFL-04: Fallback return entry ──
// Closes an existing ACTIVE/OVERDUE/INCOMPLETE borrow transaction. The actual
// return time from the paper log is used (OFFL-05), not the current time.
export const fallbackReturnSchema = z.object({
  borrowTxnId: z.string().uuid(),
  articleIds:  z.array(z.string().uuid()).min(1).max(2),
  returnedAt:  isoDatetime,
  condition:   z.enum(['GOOD', 'WORN', 'DAMAGED']),
  note:        z.string().max(500).optional(),
});

export type FallbackBookingInput = z.infer<typeof fallbackBookingSchema>;
export type FallbackBorrowInput  = z.infer<typeof fallbackBorrowSchema>;
export type FallbackReturnInput  = z.infer<typeof fallbackReturnSchema>;
