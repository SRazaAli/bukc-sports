-- ============================================================================
-- 018 — Password reset/change moves from a link token to an email OTP.
--
-- Deliberate deviation from AUTH-18's literal text ("reset link") — a
-- product decision, not a bug: the flow now sends a short numeric code
-- instead of a clickable link, matching the step-up verification pattern
-- (see GitHub's "Verify via email" flow). The password_reset_token table
-- already fit the shape (hash + expiry + single-use); it just needed two
-- additions:
--
-- 1. purpose — distinguishes a forgot-password OTP (unauthenticated,
--    proves inbox ownership) from a change-password confirmation OTP
--    (authenticated, a step-up check after the current password was
--    already verified). Same table, same security properties, different
--    context.
-- 2. failed_attempts — an 8-digit OTP has far less entropy than the old
--    256-bit random token, so guessing needs its own limit independent of
--    the per-email/per-IP request rate limit (migration 017) — that limits
--    how many codes get ISSUED, this limits how many guesses a single
--    issued code tolerates before it's burned and a fresh one is required.
-- ============================================================================

ALTER TABLE password_reset_token
  ADD COLUMN purpose text NOT NULL DEFAULT 'RESET'
    CHECK (purpose IN ('RESET', 'CHANGE_CONFIRM'));
ALTER TABLE password_reset_token ADD COLUMN failed_attempts int NOT NULL DEFAULT 0;
