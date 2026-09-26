-- 024 duplicated 023_sent_back_workflow.sql exactly, which made a fresh
-- database fail here ("enum label SENT_BACK already exists"). Made idempotent:
-- a no-op when 023 already ran, identical effect when it didn't.
ALTER TYPE booking_status ADD VALUE IF NOT EXISTS 'SENT_BACK';

ALTER TABLE booking
  ADD COLUMN IF NOT EXISTS sent_back_note text,
  ADD COLUMN IF NOT EXISTS sent_back_by uuid REFERENCES app_user(user_id),
  ADD COLUMN IF NOT EXISTS sent_back_at timestamptz,
  ADD COLUMN IF NOT EXISTS coordinator_proposed_sessions jsonb;
