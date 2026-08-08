-- ============================================================================
-- 019 — Offline Fallback Entry Form (Feature 11).
--
-- Part A: audit log table (OFFL-15).
--   Every fallback entry permanently records: who entered it (entered_by),
--   the wall-clock submission timestamp (entered_at, auto-set), the
--   produced transaction (booking_id XOR borrow_txn_id), and an optional
--   coordinator note. The transaction's own event time lives on the booking
--   or borrow_transaction row — OFFL-05 mandates the actual event time, not
--   the entry time, is recorded there.
--
-- Part B: constraint relaxations for the borrow path.
--   Three existing constraints on borrow_transaction block valid fallback
--   borrows that are otherwise legitimate:
--
--   1. ck_path_walkin — requires guest_borrower_id IS NOT NULL for WALK_IN.
--      Fallback borrows for registered students use WALK_IN with a real
--      borrower_user_id and no guest record. The constraint is too narrow.
--      Fix: carve out the case where borrower_user_id IS NOT NULL (registered
--      student on WALK_IN is unambiguous).
--
--   2. fn_lent_by_guard — requires lent_by to be COORDINATOR. SUPER_ADMIN can
--      also enter fallback transactions (role table, OFFL-03).
--      Fix: update the function to also allow SUPER_ADMIN when the row is a
--      fallback entry.
--
--   3. ck_txn_sameday — requires agreed_start_at and agreed_return_at to fall
--      on the same calendar day (Asia/Karachi). This is correct for live
--      borrows (BORROW-01) but paper-logged borrows during extended downtime
--      may span multiple days (OFFL-12/13).
--      Fix: carve out fallback entries from this constraint.
-- ============================================================================

-- ── Part A: audit log ──

CREATE TABLE offline_fallback_audit (
  audit_id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  entered_by        uuid        NOT NULL REFERENCES app_user(user_id),
  entered_at        timestamptz NOT NULL DEFAULT now(),
  transaction_kind  text        NOT NULL CHECK (transaction_kind IN ('BOOKING','BORROW','RETURN')),
  booking_id        uuid        REFERENCES booking(booking_id),
  borrow_txn_id     uuid        REFERENCES borrow_transaction(borrow_txn_id),
  note              text,
  -- Exactly one of booking_id / borrow_txn_id must be set.
  CONSTRAINT ck_audit_one_ref CHECK (
    (booking_id IS NOT NULL AND borrow_txn_id IS NULL)
    OR (booking_id IS NULL   AND borrow_txn_id IS NOT NULL)
  )
);

CREATE INDEX ix_ofl_audit_entered_at ON offline_fallback_audit (entered_at DESC);
CREATE INDEX ix_ofl_audit_entered_by ON offline_fallback_audit (entered_by);
CREATE INDEX ix_ofl_audit_booking    ON offline_fallback_audit (booking_id)    WHERE booking_id    IS NOT NULL;
CREATE INDEX ix_ofl_audit_txn        ON offline_fallback_audit (borrow_txn_id) WHERE borrow_txn_id IS NOT NULL;

COMMENT ON TABLE offline_fallback_audit IS
  'OFFL-15: permanent audit of every fallback entry. '
  'entered_at is the wall-clock submission timestamp; '
  'the transaction''s own event time lives on the booking or borrow_transaction row.';

-- ── Part B-1: relax ck_path_walkin ──
-- Old: path<>'WALK_IN' OR guest_borrower_id IS NOT NULL
-- New: path<>'WALK_IN' OR guest_borrower_id IS NOT NULL OR borrower_user_id IS NOT NULL
-- The added arm covers registered-student fallback borrows on the WALK_IN path.

ALTER TABLE borrow_transaction
  DROP CONSTRAINT ck_path_walkin,
  ADD  CONSTRAINT ck_path_walkin CHECK (
    path <> 'WALK_IN'
    OR guest_borrower_id IS NOT NULL
    OR borrower_user_id  IS NOT NULL
  );

-- ── Part B-2: relax fn_lent_by_guard to allow SUPER_ADMIN on fallback entries ──
CREATE OR REPLACE FUNCTION fn_lent_by_guard() RETURNS trigger AS $$
DECLARE r user_role;
BEGIN
  r := fn_role_of(NEW.lent_by);
  -- BORROW-07: only a COORDINATOR may lend in the live flow.
  -- OFFL-03: SUPER_ADMIN may also enter fallback transactions.
  IF r = 'COORDINATOR' THEN
    RETURN NEW;
  END IF;
  IF r = 'SUPER_ADMIN' AND NEW.entered_via_offline_fallback THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'BORROW-07: only a COORDINATOR (or SUPER_ADMIN for offline fallback) may lend equipment (got %)', r;
END $$ LANGUAGE plpgsql;

-- ── Part B-3: relax ck_txn_sameday for fallback entries ──
-- Live borrows are same-day only (BORROW-01). Fallback borrows recorded on
-- paper during extended downtime may legitimately span multiple days (OFFL-12/13).

ALTER TABLE borrow_transaction
  DROP CONSTRAINT ck_txn_sameday,
  ADD  CONSTRAINT ck_txn_sameday CHECK (
    entered_via_offline_fallback
    OR (
      (agreed_start_at AT TIME ZONE 'Asia/Karachi')::date
      = (agreed_return_at AT TIME ZONE 'Asia/Karachi')::date
    )
  );
