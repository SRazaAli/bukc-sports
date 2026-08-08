-- ============================================================================
-- 015 — Admin account management: timed deactivation + soft delete.
--
-- AUTH-14 (a DEACTIVATED user cannot log in; records are fully retained) was
-- already enforced at login, but nothing in the admin UI ever exercised it —
-- there was no way to deactivate an active account, temporarily or otherwise.
--
-- 1. deactivated_until — NULL means "deactivated until an admin reactivates
--    it" (indefinite); a timestamp means "auto-reactivate at this time".
--    Auto-reactivation is checked opportunistically (same pattern as
--    checkOverdueBorrows for BORROW-18), not a background job.
-- 2. deactivated_by — who deactivated it, for the audit trail.
-- 3. deleted_at / deleted_by — a UI-level "delete". Hard-deleting app_user
--    rows is not possible (they're referenced everywhere: articles entered,
--    borrows, damage flags, approvals...), so a deleted account is really a
--    permanent deactivation that's also hidden from every admin listing and
--    whose login now behaves exactly as if the account never existed (see
--    the login() changes in this same patch).
-- ============================================================================

ALTER TABLE app_user ADD COLUMN deactivated_until timestamptz;
ALTER TABLE app_user ADD COLUMN deactivated_by uuid REFERENCES app_user(user_id);
ALTER TABLE app_user ADD COLUMN deleted_at timestamptz;
ALTER TABLE app_user ADD COLUMN deleted_by uuid REFERENCES app_user(user_id);

ALTER TABLE app_user ADD CONSTRAINT ck_deactivated_until_requires_deactivated
  CHECK (deactivated_until IS NULL OR status = 'DEACTIVATED');
ALTER TABLE app_user ADD CONSTRAINT ck_deleted_requires_deactivated
  CHECK (deleted_at IS NULL OR status = 'DEACTIVATED');

-- contact_number has no index yet; email and enrollment_no already have one
-- via their UNIQUE constraints, so nothing needed there for prefix search.
CREATE INDEX idx_app_user_contact_number ON app_user (contact_number);
