-- ============================================================================
-- 028 — Venue booking expiry.
--
-- A venue request that is still waiting for a decision (PENDING at the
-- Coordinator, or FORWARDED to the Super Admin) once its first session's start
-- time has passed can no longer be honoured as requested. Before this, such
-- requests stayed PENDING forever: they cluttered the queue, could still be
-- forwarded/approved for a date already gone, and — because VENUE-07 allows
-- one active request per requester — blocked that student from ever
-- submitting a new one.
--
-- The application marks these EXPIRED (see expireStaleBookings() in
-- server/src/features/venue/service.ts) before every queue/list read and
-- before every decision. EXPIRED is terminal. Pre-approval bookings own no
-- booking_session rows, so nothing on the calendar needs releasing.
-- ============================================================================
ALTER TYPE booking_status ADD VALUE IF NOT EXISTS 'EXPIRED';

ALTER TABLE booking ADD COLUMN IF NOT EXISTS expired_at timestamptz;

COMMENT ON COLUMN booking.expired_at IS
  'When the booking was marked EXPIRED because its first requested session '
  'started before a decision was made.';

-- Speeds up the "earliest session start" lookup used by the expiry sweep and
-- the open-request overlap check.
CREATE INDEX IF NOT EXISTS idx_bsr_booking_start
  ON booking_session_request (booking_id, requested_start_at);
