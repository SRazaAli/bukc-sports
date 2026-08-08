-- ============================================================================
-- 002 — identity support tables (refresh_token, password_reset_token exists,
--       login_attempt, system_setting)
--
-- These are specified in the ERD (§3.4, §3.6, §3.7) but were absent from the
-- tested DDL (schema_v1_2.sql). They carry NO cross-table invariants, which is
-- why the 128-test suite never exercised them — the tests attack boundaries,
-- and these tables have none. Added here as a forward migration rather than by
-- editing 001, per the immutability rule on the canonical schema.
--
-- password_reset_token already exists in 001; refresh_token does not. We add
-- refresh_token, login_attempt, and system_setting.
-- ============================================================================

-- AUTH-09/10 — refresh tokens are stored (access tokens are stateless JWTs and
-- are NOT stored). Stored because AUTH-10 requires immediate invalidation on
-- logout, impossible for a stateless token. Store the HASH, never the token.
CREATE TABLE refresh_token (
  token_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES app_user(user_id),
  token_hash  text NOT NULL UNIQUE,
  issued_at   timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  CONSTRAINT ck_refresh_window CHECK (expires_at > issued_at)
);
CREATE INDEX ix_refresh_active ON refresh_token (user_id) WHERE revoked_at IS NULL;

-- AUTH-11 — forensic record of login attempts. The fast-path counter lives on
-- app_user.failed_login_count; this is the audit trail. user_id is nullable so
-- attempts against a non-existent email are still recorded.
CREATE TABLE login_attempt (
  attempt_id      bigserial PRIMARY KEY,
  email_attempted citext NOT NULL,
  user_id         uuid REFERENCES app_user(user_id),
  succeeded       boolean NOT NULL,
  attempted_at    timestamptz NOT NULL DEFAULT now(),
  ip_address      inet
);
CREATE INDEX ix_login_attempt_email ON login_attempt (email_attempted, attempted_at DESC);

-- APPR-19 / INV-29 / BORROW-13 / EQUIP-AVAIL-11 — configurable windows the rules
-- call "configurable system setting" rather than hardcoded constants.
CREATE TABLE system_setting (
  setting_key   text PRIMARY KEY,
  setting_value jsonb NOT NULL,
  updated_by    uuid REFERENCES app_user(user_id),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
