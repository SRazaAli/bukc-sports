/**
 * Token helpers. We store only HASHES of refresh, reset, and invite tokens
 * (AUTH-08 spirit) — a leaked DB dump must not yield usable tokens. The raw
 * token goes to the user (cookie / email link); the hash goes to the DB.
 */
import { randomBytes, randomInt, createHash, createHmac } from 'node:crypto';
import { config } from '../config/index.js';

/** A URL-safe random token to hand to the user. */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Deterministic hash for DB storage & lookup. SHA-256 is fine for high-entropy tokens. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** A crypto-secure random N-digit numeric OTP (default 8 digits, e.g. "53589691"). */
export function generateOtp(digits = 8): string {
  const min = 10 ** (digits - 1);
  const max = 10 ** digits; // exclusive upper bound
  return String(randomInt(min, max));
}

/**
 * OTPs get an HMAC, not the plain SHA-256 used for high-entropy tokens above.
 * An 8-digit code has ~26.6 bits of entropy — a DB dump alone would let an
 * attacker exhaustively hash and match every possible code in well under a
 * second. Keying the hash with the server secret means the dump alone isn't
 * enough; they'd also need that secret.
 */
export function hashOtp(otp: string): string {
  return createHmac('sha256', config.JWT_ACCESS_SECRET).update(otp).digest('hex');
}
