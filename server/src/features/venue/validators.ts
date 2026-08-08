import { z } from 'zod';

// VENUE-01: casual-vs-official thresholds are surfaced as guidance, not
// enforced as a hard block — nothing in the rules requires rejecting a
// below-threshold submission; the Coordinator judges feasibility at review.
export const INDOOR_THRESHOLD = 6;
export const OUTDOOR_THRESHOLD = 10;

const SURFACE_TYPES = ['Hardwood', 'Synthetic', 'Grass', 'Concrete', 'Artificial Turf', 'Clay', 'Other'] as const;

// Photos: base64 data URIs, max 3, max 400 KB each
const photosSchema = z.array(
  z.string().max(550_000, 'Each photo must be under 400 KB'),
).max(3, 'Maximum 3 photos per venue').default([]);

export const createVenueSchema = z.object({
  name: z.string().min(2).max(120),
  capacity: z.number().int().positive(),
  isIndoor: z.boolean(),
  sportCategoryIds: z.array(z.number().int().positive()).default([]),
  description: z.string().max(500).optional(),
  location: z.string().max(120).optional(),
  surfaceType: z.enum(SURFACE_TYPES).optional(),
  photos: photosSchema,
});

export const updateVenueSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  capacity: z.number().int().positive().optional(),
  isIndoor: z.boolean().optional(),
  sportCategoryIds: z.array(z.number().int().positive()).optional(),
  description: z.string().max(500).optional(),
  location: z.string().max(120).optional(),
  surfaceType: z.enum(SURFACE_TYPES).optional().nullable(),
  photos: photosSchema.optional(),
  availabilityStatus: z.enum(['AVAILABLE', 'UNDER_MAINTENANCE', 'CLOSED']).optional(),
}).refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update.' });


// VENUE-06/35/36: one or more sessions (max 30), one venue, roster per session.
const sessionSchema = z.object({
  sessionNo: z.number().int().min(1).max(30),
  requestedStartAt: z.string().datetime(),
  requestedEndAt: z.string().datetime(),
  teamName: z.string().min(1).max(120),
  participantDetails: z.string().max(2000).optional(),
}).refine((v) => new Date(v.requestedEndAt) > new Date(v.requestedStartAt), {
  message: 'End time must be after start time', path: ['requestedEndAt'],
});

// VENUE-05: venue, date/time window(s), purpose, team(s), participant count.
export const submitBookingSchema = z.object({
  venueId: z.number().int().positive(),
  purpose: z.string().min(2).max(300),
  estimatedParticipants: z.number().int().positive(),
  sessions: z.array(sessionSchema).min(1).max(30),
});

// VENUE-28/29: Coordinator-initiated academic event, same shape minus a requester.
export const academicEventSchema = z.object({
  venueId: z.number().int().positive(),
  purpose: z.string().min(2).max(300),
  estimatedParticipants: z.number().int().positive(),
  sessions: z.array(sessionSchema).min(1).max(30),
});

export const feasibilityNoteSchema = z.object({
  note: z.string().max(500).optional(),
});
export const rejectBookingSchema = z.object({
  reason: z.string().min(1).max(300),
});
export const returnForReevalSchema = z.object({
  note: z.string().min(1).max(500),
});

// VENUE-13: Coordinator's per-session equipment plan.
export const planAllocationSchema = z.object({
  allocations: z.array(z.object({
    requestSessionId: z.string().uuid(),
    equipmentTypeId: z.number().int().positive(),
    quantity: z.number().int().positive(),
  })).min(1),
});

// VENUE-16: client confirms or declines self-managing a shortfall.
export const confirmShortfallSchema = z.object({
  confirm: z.boolean(),
});

// EQUIP-AVAIL-14: swap an unavailable/short article for an available one.
export const performSwapSchema = z.object({
  outgoingArticleId: z.string().uuid(),
  incomingArticleId: z.string().uuid(),
  reason: z.string().max(300).optional(),
});
