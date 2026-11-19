-- ============================================================================
-- 032 — External venue booking (new approval workflow).
--
-- Rules (Nov 2026):
--   * Only EXTERNAL users can request a venue. BUKC students can no longer book.
--   * An external request carries: venue, sport, number of teams, and for each
--     team its members (full name, university name, university ID — free text,
--     no format, because every university numbers its students differently),
--     plus the date(s) and time window(s).
--   * Coordinator reviews + checks conflicts, then forwards to the Super Admin.
--   * Super Admin approves or rejects (with a reason). The external is notified
--     either way — with the confirmed schedule, or with the rejection reason.
--
-- The request details live in booking.booking_metadata (jsonb) exactly like
-- the earlier INTER_UNIVERSITY / INTERNAL pitches; this migration only adds the
-- new booking type. Additive and safe to re-run.
-- ============================================================================

ALTER TYPE booking_event_type ADD VALUE IF NOT EXISTS 'EXTERNAL_EVENT';

COMMENT ON COLUMN booking.booking_type IS
  'EXTERNAL_EVENT = request from an external user (teams + members with university details); '
  'INTER_UNIVERSITY / INTERNAL = legacy student pitches (no longer accepted); '
  'NULL for academic events and bookings predating migration 022.';
