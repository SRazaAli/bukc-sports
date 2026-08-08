-- ============================================================================
-- 009 — multi-session bookings: proper pre-approval storage (VENUE-06/35/36).
--
-- The single pass added the requested window directly on `booking` (one row =
-- one session). That doesn't extend to tournaments (up to 30 sessions, one
-- venue, roster can vary per session — VENUE-06/35/36). This migration
-- replaces those single-row fields with a proper one-row-per-proposed-session
-- table, so single- and multi-session bookings share one mechanism instead of
-- two: a single-session booking is simply a booking with exactly one row here.
--
-- At approval, every row here is materialized into a real booking_session (+
-- session_participant) row in one transaction — VENUE-19: "one approval
-- covers the entire package." If any session in the package collides with an
-- existing approved session, the whole package is rejected together (see the
-- service layer's comment on the CONF-12 vs VENUE-19 reading).
-- ============================================================================

CREATE TABLE booking_session_request (
  request_session_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id          uuid NOT NULL REFERENCES booking(booking_id) ON DELETE CASCADE,
  session_no          int NOT NULL CHECK (session_no BETWEEN 1 AND 30), -- VENUE-35
  requested_start_at  timestamptz NOT NULL,
  requested_end_at    timestamptz NOT NULL,
  team_name           text NOT NULL,
  participant_details text,
  CONSTRAINT ck_bsr_window CHECK (requested_end_at > requested_start_at),
  CONSTRAINT uq_bsr_session_no UNIQUE (booking_id, session_no)
);

-- Retire the single-row fields from the prior pass — booking_session_request
-- now holds this data for every booking, single- or multi-session alike.
ALTER TABLE booking DROP CONSTRAINT IF EXISTS ck_booking_window;
ALTER TABLE booking DROP COLUMN IF EXISTS requested_start_at;
ALTER TABLE booking DROP COLUMN IF EXISTS requested_end_at;
ALTER TABLE booking DROP COLUMN IF EXISTS team_name;
ALTER TABLE booking DROP COLUMN IF EXISTS participant_details;
