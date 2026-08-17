ALTER TYPE booking_status ADD VALUE 'SENT_BACK';

ALTER TABLE booking
  ADD COLUMN sent_back_note text,
  ADD COLUMN sent_back_by uuid REFERENCES app_user(user_id),
  ADD COLUMN sent_back_at timestamptz,
  ADD COLUMN coordinator_proposed_sessions jsonb;