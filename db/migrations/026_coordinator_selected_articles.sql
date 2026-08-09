-- 026 — Coordinator selected article IDs on booking.
--
-- booking_session_request_equipment stores the quantities the coordinator
-- planned, but not which specific articles they selected. This column stores
-- the article-level selections so they survive the send-back round-trip
-- and can be pre-populated when the coordinator re-opens the booking.
--
-- Shape: [{ equipmentTypeId: int, articleIds: string[] }, ...]
-- Updated each time the coordinator saves their equipment plan.
ALTER TABLE booking
  ADD COLUMN coordinator_selected_articles jsonb;

COMMENT ON COLUMN booking.coordinator_selected_articles IS
  'Article IDs selected by the Coordinator per equipment type during planning.
   Persisted so selections survive send-back round-trips. Updated on each
   planAllocation call. Shape: [{equipmentTypeId, articleIds}].';
