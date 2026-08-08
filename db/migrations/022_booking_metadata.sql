-- ============================================================================
-- 022 — Structured booking metadata for venue booking pitches (VENUE-01).
--
-- The existing `purpose` field is a free-text string (max 300 chars) that was
-- adequate for a simple request form. The new booking experience requires a
-- structured pitch with booking type, team rosters, captain details, match
-- format, and VENUE-01 eligibility fields. Rather than adding many nullable
-- columns to `booking`, all structured data goes into one jsonb column.
--
-- `purpose` is kept intact and still populated (as a human-readable summary)
-- so every existing read path — coordinator queue, admin queue, conflict
-- detection — continues to display a meaningful title without any change.
--
-- `booking_type` is a separate indexed column (not buried in jsonb) so the
-- coordinator queue can filter/sort by type efficiently without jsonb ops.
-- ============================================================================

CREATE TYPE booking_event_type AS ENUM ('INTER_UNIVERSITY', 'INTERNAL');

ALTER TABLE booking
  ADD COLUMN booking_type booking_event_type,
  ADD COLUMN booking_metadata jsonb;

CREATE INDEX ix_booking_type ON booking (booking_type) WHERE booking_type IS NOT NULL;

COMMENT ON COLUMN booking.booking_type IS
  'INTER_UNIVERSITY = BUKC hosts a visiting university; '
  'INTERNAL = intra-campus match or practice between BUKC entities. '
  'NULL for academic events and bookings predating this migration.';

COMMENT ON COLUMN booking.booking_metadata IS
  'Structured pitch data as jsonb. Shape documented in the service layer. '
  'NULL for legacy bookings. Never mutated after submission — treat as immutable '
  'for audit purposes (the booking row itself carries is_active / status for lifecycle).';
