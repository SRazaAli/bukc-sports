-- ============================================================================
-- 017 — Rate-limit tracking for password reset requests.
--
-- AUTH-21 hardening: reset requests must be rate-limited per email and per IP
-- to prevent abuse/spam. This mirrors login_attempt's shape (migration
-- 002) but is dedicated to reset requests — every call to
-- requestPasswordReset logs a row here regardless of whether the email
-- exists or the request was rate-limited, purely for the rate-limit math.
-- Nothing about it is ever exposed to the caller (the response stays the
-- same generic message either way — no enumeration signal).
-- ============================================================================

CREATE TABLE password_reset_attempt (
  attempt_id      bigserial PRIMARY KEY,
  email_attempted citext NOT NULL,
  ip_address      inet,
  attempted_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_reset_attempt_email ON password_reset_attempt (email_attempted, attempted_at);
CREATE INDEX ix_reset_attempt_ip ON password_reset_attempt (ip_address, attempted_at);
