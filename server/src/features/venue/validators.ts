import { z } from 'zod';

export const INDOOR_THRESHOLD = 6;
export const OUTDOOR_THRESHOLD = 10;

const SURFACE_TYPES = ['Hardwood', 'Synthetic', 'Grass', 'Concrete', 'Artificial Turf', 'Clay', 'Other'] as const;

// ── Venue schemas ──
const photosSchema = z.array(z.string().max(550_000)).max(3).default([]);

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

// ── Session schema ──
const sessionSchema = z.object({
  sessionNo: z.number().int().min(1).max(30),
  requestedStartAt: z.string().datetime(),
  requestedEndAt: z.string().datetime(),
  teamName: z.string().max(120).optional().default(''),
  participantDetails: z.string().max(2000).optional(),
}).refine((v) => new Date(v.requestedEndAt) > new Date(v.requestedStartAt), {
  message: 'End time must be after start time', path: ['requestedEndAt'],
});

// ── Player entries ──
const bukcPlayerSchema = z.object({
  enrollmentNo: z.string().min(1).max(30),
  fullName: z.string().min(2).max(100),
});
const visitingPlayerSchema = z.object({ fullName: z.string().min(2).max(100) });
const equipmentItemSchema = z.object({
  equipmentTypeId: z.number().int().positive(),
  name: z.string().min(1).max(120),
  quantity: z.number().int().positive(),
});

// ── Inter-University metadata ──
const interUniversityMetaSchema = z.object({
  bookingType: z.literal('INTER_UNIVERSITY'),
  sport: z.string().min(1).max(80),
  eventFormat: z.enum(['SINGLE_MATCH', 'TOURNAMENT']),
  matchFormat: z.enum(['FRIENDLY', 'LEAGUE', 'KNOCKOUT', 'ROUND_ROBIN']),
  // BUKC team
  bukcTeamName: z.string().min(1).max(120),
  bukcHasCaptain: z.boolean(),
  bukcCaptainName: z.string().min(2).max(100).optional(),
  bukcCaptainEnrollment: z.string().min(1).max(30).optional(),
  bukcCaptainContact: z.string().min(6).max(20).optional(),
  bukcPlayers: z.array(bukcPlayerSchema).min(1).max(30),
  // Visiting team
  visitingUniversity: z.string().min(2).max(150),
  visitingCity: z.string().min(1).max(80),
  visitingTeamName: z.string().min(1).max(120),
  visitingHasCaptain: z.boolean(),
  visitingCaptainName: z.string().min(2).max(100).optional(),
  visitingCaptainContact: z.string().min(6).max(20).optional(),
  // Equipment
  equipmentSupport: z.enum(['SELF', 'UNIVERSITY']),
  equipmentItems: z.array(equipmentItemSchema),
  specialRequirements: z.string().max(500).optional(),
});

// ── Internal match metadata ──
const internalMetaSchema = z.object({
  bookingType: z.literal('INTERNAL'),
  sport: z.string().min(1).max(80),
  eventFormat: z.enum(['SINGLE_MATCH', 'TOURNAMENT']),
  matchFormat: z.enum(['FRIENDLY', 'LEAGUE', 'KNOCKOUT', 'ROUND_ROBIN']),
  // Team A (BUKC)
  teamAName: z.string().min(1).max(120),
  teamAHasCaptain: z.boolean(),
  teamACaptainName: z.string().min(2).max(100).optional(),
  teamACaptainEnrollment: z.string().min(1).max(30).optional(),
  teamACaptainContact: z.string().min(6).max(20).optional(),
  teamAPlayers: z.array(bukcPlayerSchema).min(1).max(30),
  // Team B
  teamBName: z.string().min(1).max(120),
  teamBHasCaptain: z.boolean(),
  teamBCaptainName: z.string().min(2).max(100).optional(),
  teamBCaptainContact: z.string().min(6).max(20).optional(),
  teamBPlayers: z.array(visitingPlayerSchema).min(1).max(30),
  organizingEntity: z.string().min(1).max(120),
  // Equipment
  equipmentSupport: z.enum(['SELF', 'UNIVERSITY']),
  equipmentItems: z.array(equipmentItemSchema),
  specialRequirements: z.string().max(500).optional(),
});

const bookingMetaSchema = z.discriminatedUnion('bookingType', [
  interUniversityMetaSchema,
  internalMetaSchema,
]);

export const submitBookingSchema = z.object({
  venueId: z.number().int().positive(),
  estimatedParticipants: z.number().int().positive(),
  sessions: z.array(sessionSchema).min(1).max(30),
  metadata: bookingMetaSchema,
});

export const academicEventSchema = z.object({
  venueId: z.number().int().positive(),
  purpose: z.string().min(2).max(300),
  estimatedParticipants: z.number().int().positive(),
  sessions: z.array(sessionSchema).min(1).max(30),
});

export const feasibilityNoteSchema = z.object({ note: z.string().max(500).optional() });
export const rejectBookingSchema = z.object({ reason: z.string().min(1).max(300) });
export const returnForReevalSchema = z.object({ note: z.string().min(1).max(500) });
export const planAllocationSchema = z.object({
  allocations: z.array(z.object({
    requestSessionId: z.string().uuid(),
    equipmentTypeId: z.number().int().positive(),
    quantity: z.number().int().positive(),
  })).min(1),
});
export const confirmShortfallSchema = z.object({ confirm: z.boolean() });
export const performSwapSchema = z.object({
  outgoingArticleId: z.string().uuid(),
  incomingArticleId: z.string().uuid(),
  reason: z.string().max(300).optional(),
});

export type BookingMetadata = z.infer<typeof bookingMetaSchema>;
export type InterUniversityMeta = z.infer<typeof interUniversityMetaSchema>;
export type InternalMeta = z.infer<typeof internalMetaSchema>;
