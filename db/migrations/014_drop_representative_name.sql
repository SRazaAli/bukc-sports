-- ============================================================================
-- 014 — Drop the redundant representative_name column.
--
-- external_profile.representative_name and app_user.full_name captured the
-- same person's name twice on every real registration (the person filling
-- out the form types their own name into both fields) — there was no UI
-- guidance distinguishing "account holder" from "on-the-ground contact", so
-- in practice it was pure duplication. Removed rather than kept unused.
-- ============================================================================

ALTER TABLE external_profile DROP COLUMN representative_name;
