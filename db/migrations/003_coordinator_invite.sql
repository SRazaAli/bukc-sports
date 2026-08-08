-- ============================================================================
-- 003 — Coordinator invite tokens (email-invite flow, AUTH-06)
--
-- AUTH-06: COORDINATOR accounts are created exclusively by the Super Admin.
-- We implement this as an email invite: the Super Admin creates the invite
-- (email + name), the system emails a single-use link, and the Coordinator
-- sets their own password to activate. More secure than an admin-typed password.
--
-- The account row is created at invite time in PENDING_VERIFICATION with a
-- placeholder password hash and is flipped to ACTIVE when the invite is accepted
-- (which is also the AUTH-04 verification, performed by the inviting Super Admin).
-- ============================================================================
CREATE TABLE coordinator_invite (
  invite_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES app_user(user_id),
  token_hash   text NOT NULL UNIQUE,
  invited_by   uuid NOT NULL REFERENCES app_user(user_id),
  issued_at    timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  accepted_at  timestamptz,
  CONSTRAINT ck_invite_window CHECK (expires_at > issued_at)
);
CREATE INDEX ix_invite_pending ON coordinator_invite (user_id) WHERE accepted_at IS NULL;
