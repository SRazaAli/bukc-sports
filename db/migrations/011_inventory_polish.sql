-- ============================================================================
-- 011 — Inventory polish.
--
-- 1. sport_category: is_custom flag + image_data (base64) for custom sports
-- 2. equipment_item_preset: predefined item names per sport with image keys
-- 3. Fix v_article_availability pair counting (PAIR = 1 lendable unit, not 2)
-- 4. Change low_stock_threshold default from 0 to 7
-- ============================================================================

-- 1. Sport category enhancements for custom sport support
ALTER TABLE sport_category ADD COLUMN is_custom boolean NOT NULL DEFAULT false;
ALTER TABLE sport_category ADD COLUMN image_data text;

-- 2. Predefined item names per sport category
CREATE TABLE equipment_item_preset (
  preset_id smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sport_category_id smallint NOT NULL REFERENCES sport_category(sport_category_id),
  name text NOT NULL,
  image_key text NOT NULL,
  UNIQUE (sport_category_id, name)
);

-- 3. Fix pair counting: a PAIR lending unit = 2 articles = 1 lendable unit.
--    The view must express available_units in lendable units, not raw articles.
DROP VIEW IF EXISTS v_equipment_status_badge;
DROP VIEW IF EXISTS v_article_availability;

CREATE VIEW v_article_availability AS
SELECT et.equipment_type_id, et.name, et.sport_category_id,
  count(*) FILTER (WHERE a.state <> 'DECOMMISSIONED') AS total_stock,
  count(*) FILTER (WHERE a.state = 'ON_LOAN') AS on_loan,
  count(*) FILTER (WHERE a.state = 'DAMAGED') AS damaged,
  count(*) FILTER (WHERE a.state = 'UNPAIRED') AS unpaired,
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

-- 4. Change default low_stock_threshold to 7
ALTER TABLE equipment_type ALTER COLUMN low_stock_threshold SET DEFAULT 7;
