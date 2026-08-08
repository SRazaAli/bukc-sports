-- ============================================================================
-- 004 — registration detail additions
--
-- Two additive changes for the redesigned registration + admin review flow.
-- Neither touches the tested 001; both are forward-only.
--
--  1. student_profile.program_title — the specific degree program (e.g.
--     "BS Computer Science") within the chosen department. Department stays as
--     the parent grouping ("Computer Science"). Both are stored.
--
--  2. app_user.rejection_reason — when a Super Admin rejects a pending account,
--     the reason is retained on the record and emailed to the applicant. Nullable
--     because it only applies to rejected accounts.
-- ============================================================================

ALTER TABLE student_profile
  ADD COLUMN program_title text;

-- Backfill any existing rows (there are none in practice yet) so the column can
-- be treated as reliably present by the app.
UPDATE student_profile SET program_title = 'Unspecified' WHERE program_title IS NULL;

ALTER TABLE app_user
  ADD COLUMN rejection_reason text;
