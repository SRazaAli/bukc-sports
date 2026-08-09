-- ============================================================================
-- 023 — Coordinator send-back workflow (VENUE-12/15/16/22).
--
-- When a Coordinator finds conflicts or equipment issues with a submitted
-- booking, rather than rejecting outright, they can send it back to the
-- requester with:
--   1. A plain-text note explaining the issue and any proposed resolution
--   2. An optional alternative schedule (array of proposed session windows)
--
-- The requester then sees the SENT_BACK booking in their history, reads the
-- coordinator's note, and either:
--   ACCEPTS: booking returns to PENDING with the coordinator's proposed
--            sessions replacing the original (same booking_id, new session rows)
--   DECLINES: booking transitions to REJECTED
--
-- This mirrors the SHORTFALL_PENDING pattern from migration 010 — same
-- booking ID moves through the round-trip, no new booking is created.
-- ============================================================================

ALTER TYPE booking_status ADD VALUE 'SENT_BACK';

ALTER TABLE booking
  ADD COLUMN sent_back_note         text,
  ADD COLUMN sent_back_by           uuid REFERENCES app_user(user_id),
  ADD COLUMN sent_back_at           timestamptz,
  -- Coordinator's proposed alternative sessions as jsonb.
  -- Shape: [{ sessionNo, startAt (ISO string), endAt (ISO string) }, ...]
  -- NULL when coordinator sends back for reasons other than schedule change
  -- (e.g. equipment-only note).
  ADD COLUMN coordinator_proposed_sessions jsonb;

COMMENT ON COLUMN booking.sent_back_note IS
  'Rich-text note from the Coordinator to the requester explaining why the '
  'booking was sent back and what changes are being proposed (schedule, '
  'equipment, or both). Shown in the requester''s booking detail view.';

COMMENT ON COLUMN booking.coordinator_proposed_sessions IS
  'Optional alternative schedule proposed by the Coordinator. jsonb array of '
  '{ sessionNo: int, startAt: string, endAt: string }. When the requester '
  'accepts, these replace the booking_session_request rows.';
