-- ============================================================================
-- 016 — Two notification_type values for account deactivate/reactivate.
--
-- Same pattern as migration 007 (which added two BORROW-specific values to
-- this same enum for Feature 3). Used by the Active Accounts tab's
-- deactivate/reactivate actions to write an in-app notification alongside
-- the email that already gets sent, consistent with AUTH-20's pattern for
-- account verification.
-- ============================================================================

ALTER TYPE notification_type ADD VALUE 'ACCOUNT_DEACTIVATED';
ALTER TYPE notification_type ADD VALUE 'ACCOUNT_REACTIVATED';
