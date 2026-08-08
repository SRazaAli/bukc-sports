-- ============================================================================
-- 012 — Pair model correction, UPC/EAN barcodes, preset lending units, scan images.
--
-- 1. Remove UNPAIRED article state. Pair-type articles are always entered and
--    kept as a pair; there is no state in which one half stands alone. Each
--    half keeps its own condition_label, but the pair's `state` is a single
--    shared value — DAMAGED if either half's condition is DAMAGED, otherwise
--    mirrors the shared lifecycle (AVAILABLE / ON_LOAN / DECOMMISSIONED).
-- 2. Barcode format tightened to UPC-A (12 numeric digits).
-- 3. equipment_item_preset gets a default_lending_unit (drives the read-only
--    lending-unit field in the Add Type form for predefined items).
-- 4. health_check_scan gets an optional image_data (base64) column for photos
--    taken at entry/scan time — plumbing for future CV integration.
-- ============================================================================

-- ── 1. Remove UNPAIRED ──
-- Any pre-existing UNPAIRED articles need staff review before the enum value
-- disappears — flag them as DAMAGED so they surface in the Damage Flags tab.
INSERT INTO damage_flag (article_id, raised_by_system, source_scan_id)
SELECT article_id, true, NULL FROM article a
WHERE a.state = 'UNPAIRED'
  AND NOT EXISTS (SELECT 1 FROM damage_flag df WHERE df.article_id = a.article_id AND df.cleared_at IS NULL);

UPDATE article SET state = 'DAMAGED' WHERE state = 'UNPAIRED';

-- v_article_availability / v_equipment_status_badge both depend on
-- article.state — drop them before the column type change below, then
-- recreate (without the UNPAIRED column/filter) afterward.
DROP VIEW IF EXISTS v_equipment_status_badge;
DROP VIEW IF EXISTS v_article_availability;

-- Postgres cannot drop an enum value directly — recreate the type. The
-- ck_decom CHECK constraint compares state='DECOMMISSIONED', a comparison
-- compiled against the current type — it must be dropped before the column
-- retype and recreated after, or the rewrite fails comparing old vs new enum.
ALTER TABLE article DROP CONSTRAINT ck_decom;
ALTER TYPE article_state RENAME TO article_state_old;
CREATE TYPE article_state AS ENUM ('AVAILABLE','ON_LOAN','DAMAGED','DECOMMISSIONED');
ALTER TABLE article ALTER COLUMN state TYPE article_state USING state::text::article_state;
DROP TYPE article_state_old;
ALTER TABLE article ADD CONSTRAINT ck_decom CHECK ((state='DECOMMISSIONED') = (decommissioned_at IS NOT NULL));

-- Rebind functions that declared variables of the old type by name (their
-- compiled bodies still reference the old OID otherwise).
CREATE OR REPLACE FUNCTION fn_lend_article_guard() RETURNS trigger AS $$
DECLARE a_state article_state; a_type int; t_type int;
BEGIN
  SELECT state, equipment_type_id INTO a_state, a_type
    FROM article WHERE article_id = NEW.article_id;
  SELECT equipment_type_id INTO t_type
    FROM borrow_transaction WHERE borrow_txn_id = NEW.borrow_txn_id;

  IF a_state = 'DECOMMISSIONED' THEN
    RAISE EXCEPTION 'INV-12: cannot lend a decommissioned article';
  END IF;
  IF a_state = 'DAMAGED' THEN
    RAISE EXCEPTION 'INV-13: cannot lend a damaged article';
  END IF;
  IF a_type <> t_type THEN
    RAISE EXCEPTION 'BORROW-08: article type % does not match transaction type %', a_type, t_type;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_swap_integrity_guard() RETURNS trigger AS $$
DECLARE in_state article_state; in_type int; out_type int; alloc_type int;
BEGIN
  SELECT state, equipment_type_id INTO in_state, in_type
    FROM article WHERE article_id = NEW.incoming_article_id;
  SELECT equipment_type_id INTO out_type
    FROM article WHERE article_id = NEW.outgoing_article_id;
  SELECT equipment_type_id INTO alloc_type
    FROM event_equipment_allocation WHERE allocation_id = NEW.allocation_id;

  IF in_state <> 'AVAILABLE' THEN
    RAISE EXCEPTION 'EQUIP-AVAIL-14: incoming article is % - a swap replaces an unavailable unit with an available one',
      in_state;
  END IF;
  IF out_type <> alloc_type THEN
    RAISE EXCEPTION 'EQUIP-AVAIL-14: outgoing article type % does not match allocation type %',
      out_type, alloc_type;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

-- A scan that lands DAMAGED now also DAMAGES the pair sibling (if any) —
-- the two halves share one state even though their condition_label can differ.
CREATE OR REPLACE FUNCTION fn_scan_applies() RETURNS trigger AS $$
DECLARE sibling_id uuid;
BEGIN
  UPDATE article SET current_condition_label = NEW.resulting_label
    WHERE article_id = NEW.article_id;
  IF NEW.resulting_label = 'DAMAGED' THEN
    UPDATE article SET state='DAMAGED'
      WHERE article_id=NEW.article_id AND state NOT IN ('DECOMMISSIONED','ON_LOAN');

    SELECT CASE WHEN article_a_id = NEW.article_id THEN article_b_id ELSE article_a_id END
      INTO sibling_id
      FROM article_pair
      WHERE dissolved_at IS NULL AND (article_a_id = NEW.article_id OR article_b_id = NEW.article_id);

    IF sibling_id IS NOT NULL THEN
      UPDATE article SET state='DAMAGED'
        WHERE article_id = sibling_id AND state NOT IN ('DECOMMISSIONED','ON_LOAN');
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

-- Recreate the views (UNPAIRED column/filter removed).
CREATE VIEW v_article_availability AS
SELECT et.equipment_type_id, et.name, et.sport_category_id,
  count(*) FILTER (WHERE a.state <> 'DECOMMISSIONED') AS total_stock,
  count(*) FILTER (WHERE a.state = 'ON_LOAN') AS on_loan,
  count(*) FILTER (WHERE a.state = 'DAMAGED') AS damaged,
  COALESCE(lk.locked_units,0) AS event_locked,
  CASE WHEN et.lending_unit = 'PAIR'
    THEN count(*) FILTER (WHERE a.state = 'AVAILABLE') / 2
    ELSE count(*) FILTER (WHERE a.state = 'AVAILABLE')
  END - COALESCE(lk.locked_units,0) AS available_units
FROM equipment_type et
JOIN article a USING (equipment_type_id)
LEFT JOIN LATERAL (
  SELECT sum(quantity) AS locked_units FROM event_equipment_allocation
  WHERE equipment_type_id = et.equipment_type_id AND locked_at IS NOT NULL AND released_at IS NULL
) lk ON true
GROUP BY et.equipment_type_id, et.name, et.sport_category_id, et.lending_unit, lk.locked_units;

CREATE VIEW v_equipment_status_badge AS
SELECT v.equipment_type_id, v.name, v.sport_category_id, v.available_units,
  CASE WHEN v.available_units = 0 THEN 'CHECKED_OUT'
       WHEN v.available_units <= et.low_stock_threshold THEN 'LOW_STOCK'
       ELSE 'AVAILABLE' END AS status_badge
FROM v_article_availability v JOIN equipment_type et USING (equipment_type_id);

-- ── 2. Barcode format: UPC-A, 12 numeric digits ──
-- Existing articles entered under the old free-form format won't match the
-- new constraint — auto-convert them to valid, unique 12-digit codes first
-- (prefixed with 9 so they're visibly distinguishable as migrated values and
-- can't collide with anything entered under the old or new format). This is
-- the one legitimate exception to INV-05 (barcode immutable) — a one-time
-- format migration, not an in-app edit — so the guard trigger is bypassed
-- only for this statement and restored immediately after.
ALTER TABLE article DISABLE TRIGGER tg_article_guard;

WITH renumbered AS (
  SELECT article_id, lpad((900000000000 + row_number() OVER (ORDER BY entered_at))::text, 12, '0') AS new_barcode
  FROM article
  WHERE barcode !~ '^[0-9]{12}$'
)
UPDATE article a SET barcode = r.new_barcode
FROM renumbered r
WHERE a.article_id = r.article_id;

ALTER TABLE article ENABLE TRIGGER tg_article_guard;

ALTER TABLE article DROP CONSTRAINT IF EXISTS ck_article_barcode_length;
ALTER TABLE article ADD CONSTRAINT ck_article_barcode_format
  CHECK (barcode ~ '^[0-9]{12}$');

-- ── 3. Preset default lending unit (drives the read-only field in Add Type) ──
ALTER TABLE equipment_item_preset ADD COLUMN default_lending_unit lending_unit_type NOT NULL DEFAULT 'SINGLE';

-- ── 4. Optional photo captured at entry/scan time ──
ALTER TABLE health_check_scan ADD COLUMN image_data text;
