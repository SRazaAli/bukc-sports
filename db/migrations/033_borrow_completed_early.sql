-- ============================================================================
-- 033 — Borrow outcome "Completed — Early".
--
-- A student who hands the equipment back well before the end of their borrow
-- window (e.g. booked 3–4 pm, returned 3:30) is recorded as COMPLETED_EARLY.
--   before (end − 10 min)         → COMPLETED_EARLY
--   end − 10 min … end            → COMPLETED
--   after end                     → COMPLETED_LATE
--   any damaged article           → COMPLETED_DAMAGED (unchanged)
-- The 10-minute band lives in server/src/features/borrow/returnOutcome.ts.
--
-- The two checks that listed the terminal statuses by name are rewritten as
-- "starts with COMPLETED" so they accept the new value (and don't reference
-- the new enum label inside this transaction). Additive, safe to re-run.
-- ============================================================================

ALTER TYPE borrow_txn_status ADD VALUE IF NOT EXISTS 'COMPLETED_EARLY';

ALTER TABLE borrow_transaction DROP CONSTRAINT IF EXISTS ck_idcard;
ALTER TABLE borrow_transaction ADD CONSTRAINT ck_idcard CHECK (
  id_card_returned_at IS NULL OR status::text LIKE 'COMPLETED%');

CREATE OR REPLACE FUNCTION fn_hist_terminal_guard() RETURNS trigger AS $$
DECLARE st text;
BEGIN
  IF NEW.kind = 'EQUIPMENT_BORROW' THEN
    SELECT status::text INTO st FROM borrow_transaction WHERE borrow_txn_id = NEW.borrow_txn_id;
    IF st IS NULL OR st NOT LIKE 'COMPLETED%' THEN
      RAISE EXCEPTION 'HIST-03: transaction is % — only terminal states enter Usage History', st;
    END IF;
  ELSE
    SELECT status::text INTO st FROM booking_session WHERE session_id = NEW.session_id;
    IF st NOT IN ('COMPLETED','CANCELLED') THEN
      RAISE EXCEPTION 'HIST-02: session is % — only terminal states enter Usage History', st;
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
