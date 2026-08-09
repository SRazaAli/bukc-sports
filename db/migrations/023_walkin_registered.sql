-- Migration 023: allow registered walk-in borrowers (BORROW-07 Path B restored)
--
-- The original ck_path_walkin forced every WALK_IN transaction to carry a
-- guest_borrower_id, which ruled out lending directly to a registered student
-- at the counter without a prior platform request.
--
-- BORROW-08 lists "registration status (Registered / Unregistered)" as an
-- explicit lending-form field, making both sub-types valid.
--
-- After this change the invariants are fully covered by the existing constraints:
--   ck_borrower_xor  — exactly one of borrower_user_id / guest_borrower_id is set
--   ck_path_platform — PLATFORM  ↔  borrow_request_id IS NOT NULL
--   ck_path_plat_user— PLATFORM  ↔  borrower_user_id  IS NOT NULL
-- A WALK_IN row therefore naturally carries either a user or a guest — no
-- additional constraint is needed.

ALTER TABLE borrow_transaction
  DROP CONSTRAINT ck_path_walkin;
