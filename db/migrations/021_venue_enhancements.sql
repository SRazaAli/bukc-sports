-- ============================================================================
-- 021 — Venue enhancements.
--
-- Part A: venue_availability_status enum + column
--   AVAILABLE     — fully bookable (default)
--   UNDER_MAINTENANCE — temporarily unavailable; no new bookings accepted
--   CLOSED        — permanently closed but record retained (soft form of is_active=false)
--   A DB trigger blocks new booking submissions when status <> 'AVAILABLE'.
--
-- Part B: new venue columns
--   description   — free-text notes (optional, max 500 chars enforced at app layer)
--   location      — building/room short text (optional)
--   surface_type  — controlled vocabulary (optional)
--   photos        — jsonb array of base64 data-URI strings (optional, max 3)
--
-- Part C: case-insensitive name uniqueness
--   The existing UNIQUE constraint on venue.name is case-sensitive (Postgres
--   text). Replace it with a unique index on lower(name) so "Main Court" and
--   "main court" are correctly treated as the same name.
--
-- Part D: multi-sport via venue_sport junction table
--   Drops the single sport_category_id FK column from venue (it becomes NULL
--   on existing rows — migration preserves existing single-sport rows by
--   copying the value into venue_sport before dropping the column).
--
-- Part E: guard trigger — block bookings on non-AVAILABLE venues
-- ============================================================================

-- ── Part A: enum ──
CREATE TYPE venue_availability_status AS ENUM ('AVAILABLE', 'UNDER_MAINTENANCE', 'CLOSED');

ALTER TABLE venue
  ADD COLUMN availability_status venue_availability_status NOT NULL DEFAULT 'AVAILABLE',
  ADD COLUMN description text,
  ADD COLUMN location text,
  ADD COLUMN surface_type text,
  ADD COLUMN photos jsonb NOT NULL DEFAULT '[]'::jsonb;

-- ── Part C: case-insensitive name uniqueness ──
-- Drop the existing case-sensitive UNIQUE constraint and replace with a
-- lower() functional unique index (no need for citext extension change —
-- lower() index is sufficient and avoids rewriting the column type).
ALTER TABLE venue DROP CONSTRAINT venue_name_key;
CREATE UNIQUE INDEX uq_venue_name_ci ON venue (lower(name));

-- ── Part D: multi-sport junction table ──
CREATE TABLE venue_sport (
  venue_id    int NOT NULL REFERENCES venue(venue_id) ON DELETE CASCADE,
  sport_category_id smallint NOT NULL REFERENCES sport_category(sport_category_id),
  PRIMARY KEY (venue_id, sport_category_id)
);
CREATE INDEX ix_venue_sport_sport ON venue_sport (sport_category_id);

-- Copy existing single-sport associations before dropping the column
INSERT INTO venue_sport (venue_id, sport_category_id)
SELECT venue_id, sport_category_id
FROM venue
WHERE sport_category_id IS NOT NULL;

ALTER TABLE venue DROP COLUMN sport_category_id;

-- ── Part E: guard trigger — block bookings when venue not AVAILABLE ──
CREATE FUNCTION fn_venue_availability_guard() RETURNS trigger AS $$
DECLARE avail venue_availability_status;
BEGIN
  SELECT availability_status INTO avail FROM venue WHERE venue_id = NEW.venue_id;
  IF avail = 'UNDER_MAINTENANCE' THEN
    RAISE EXCEPTION 'VENUE-AVAIL: this venue is currently under maintenance and cannot be booked';
  END IF;
  IF avail = 'CLOSED' THEN
    RAISE EXCEPTION 'VENUE-AVAIL: this venue is closed and cannot be booked';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER tg_venue_availability_guard
  BEFORE INSERT ON booking
  FOR EACH ROW EXECUTE FUNCTION fn_venue_availability_guard();

COMMENT ON TABLE venue_sport IS
  'Many-to-many: a venue can host multiple sports. Replaces the single '
  'sport_category_id FK that was on the venue table in migration 001.';

COMMENT ON COLUMN venue.availability_status IS
  'AVAILABLE = bookable; UNDER_MAINTENANCE = temp unavailable (trigger blocks '
  'new bookings); CLOSED = permanent (use is_active=false to hide entirely).';

COMMENT ON COLUMN venue.photos IS
  'jsonb array of base64 data-URI strings, max 3. Stored as-is; '
  'app layer enforces size limit (400 KB each) and array length.';
