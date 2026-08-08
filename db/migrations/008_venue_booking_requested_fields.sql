-- ============================================================================
-- 008 — venue booking: requested-session fields (single-session pass).
--
-- booking_session rows can only exist as SCHEDULED once the parent booking is
-- APPROVED (fn_session_parent_guard) — that's what keeps CAL-01/CAL-02 true
-- (the calendar never shows a pending or unresolved slot). So the *requested*
-- date/time and roster must live somewhere before approval. For this pass
-- (single-session bookings only — multi-session/tournaments are a fast-follow)
-- the simplest correct home is directly on `booking`: one requested window,
-- materialized into a real booking_session (+ session_participant) row at the
-- moment of approval, which is exactly where the exclusion constraint gives
-- its authoritative, final overlap check (CONF-08).
-- ============================================================================

ALTER TABLE booking ADD COLUMN requested_start_at timestamptz;
ALTER TABLE booking ADD COLUMN requested_end_at timestamptz;
ALTER TABLE booking ADD COLUMN team_name text;
ALTER TABLE booking ADD COLUMN participant_details text;

ALTER TABLE booking ADD CONSTRAINT ck_booking_window
  CHECK (requested_end_at IS NULL OR requested_end_at > requested_start_at);

-- Not NOT-NULL at the column level: ACADEMIC-origin bookings (a later pass)
-- may be entered differently. CLIENT/EXTERNAL submissions always populate
-- these — enforced in the service layer for those origins.
