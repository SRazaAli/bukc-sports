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

// ── External request metadata (current rules — externals are the only requesters) ──
// University ID is free text on purpose: every university uses its own format.
const externalMemberSchema = z.object({
  fullName: z.string().trim().min(2, 'Member name must be at least 2 characters.').max(100),
  universityName: z.string().trim().min(2, 'University name is required.').max(150),
  universityId: z.string().trim().min(1, 'University ID is required.').max(50),
});
const externalTeamSchema = z.object({
  teamName: z.string().trim().min(1, 'Team name is required.').max(120),
  members: z.array(externalMemberSchema).min(1, 'Each team needs at least one member.').max(30),
});
const externalEventMetaSchema = z.object({
  bookingType: z.literal('EXTERNAL_EVENT'),
  sport: z.string().trim().min(1).max(80),
  numberOfTeams: z.number().int().min(1).max(16),
  teams: z.array(externalTeamSchema).min(1).max(16),
  specialRequirements: z.string().max(500).optional(),
}).superRefine((v, ctx) => {
  if (v.teams.length !== v.numberOfTeams) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['teams'], message: `Expected details for ${v.numberOfTeams} team(s), got ${v.teams.length}.` });
  }
  const seen = new Set<string>();
  v.teams.forEach((t, i) => {
    const key = t.teamName.replace(/\s+/g, '').toLowerCase();
    if (seen.has(key)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['teams', i, 'teamName'], message: 'Team names must be different.' });
    seen.add(key);
  });
});

// Legacy student pitches are kept in the union only so old rows still type-check
// when read back; the submit route accepts EXTERNAL_EVENT only.
const bookingMetaSchema = z.discriminatedUnion('bookingType', [
  interUniversityMetaSchema,
  internalMetaSchema,
]);

export const submitBookingSchema = z.object({
  venueId: z.number().int().positive(),
  estimatedParticipants: z.number().int().positive(),
  sessions: z.array(sessionSchema).min(1).max(30),
  metadata: externalEventMetaSchema,
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

export const reduceAllocationSchema = z.object({
  quantity: z.number().int().min(1),
  reason: z.string().trim().min(3, 'Please give a reason.').max(300),
});
export const selfManageAllocationSchema = z.object({
  reason: z.string().trim().min(3, 'Please give a reason.').max(300),
});

export type BookingMetadata = z.infer<typeof bookingMetaSchema>;
export type ExternalEventMeta = z.infer<typeof externalEventMetaSchema>;
export type InterUniversityMeta = z.infer<typeof interUniversityMetaSchema>;
export type InternalMeta = z.infer<typeof internalMetaSchema>;
