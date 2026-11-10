-- ============================================================================
-- 031 — CV Equipment Health Check: Volleyball replaces Badminton Racket.
--
-- Only needed if an EARLIER version of migration 030 (with 'BADMINTON_RACKET')
-- was already applied. On a fresh database 030 already contains 'VOLLEYBALL'
-- and this file does nothing ("IF NOT EXISTS"). Safe to run either way.
-- An old 'BADMINTON_RACKET' enum value, if present, is left unused (PostgreSQL
-- cannot drop enum values safely).
-- ============================================================================
ALTER TYPE cv_equipment_kind ADD VALUE IF NOT EXISTS 'VOLLEYBALL';
