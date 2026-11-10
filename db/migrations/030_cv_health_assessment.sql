-- ============================================================================
-- 030 — Computer-vision Equipment Health Check (DINOv2 anomaly detection).
--
-- Additive only. Nothing existing is altered.
--
-- A CV health check is stored in TWO places, so every existing rule keeps
-- working unchanged:
--   1. health_check_scan  (existing)  — one row with source = 'CV_MODEL',
--      health_score 0-100, resulting_label GOOD/WORN/DAMAGED from the type's
--      own thresholds (INV-17). The existing triggers then do what they always
--      do: update the article's condition label (fn_scan_applies), auto-DAMAGE
--      on a DAMAGED label, count SCHEDULED scans (fn_hcs_count_scan), and the
--      staff-only guard (fn_scan_staff).
--   2. cv_health_assessment (new) — the CV-specific detail for that scan:
--      4-level CV label (Good/Fair/Poor/Replace), anomaly % of the object
--      area, severity, number of photos, heatmap image, per-photo scores, and
--      the model/calibration version that produced it.
--
-- Supported equipment (fixed scope): Basketball, Football, Volleyball.
-- ============================================================================

CREATE TYPE cv_equipment_kind AS ENUM ('BASKETBALL', 'FOOTBALL', 'VOLLEYBALL');
CREATE TYPE cv_health_label   AS ENUM ('GOOD', 'FAIR', 'POOR', 'REPLACE');

CREATE TABLE cv_health_assessment (
  scan_id          uuid PRIMARY KEY REFERENCES health_check_scan(scan_id),
  equipment_kind   cv_equipment_kind NOT NULL,
  cv_label         cv_health_label   NOT NULL,
  health_score     numeric(5,2) NOT NULL CHECK (health_score BETWEEN 0 AND 100),
  anomaly_percent  numeric(5,2) NOT NULL CHECK (anomaly_percent BETWEEN 0 AND 100),
  severity         numeric(4,3) NOT NULL CHECK (severity BETWEEN 0 AND 1),
  views_count      smallint     NOT NULL CHECK (views_count BETWEEN 1 AND 4),
  heatmap_image    text NOT NULL,          -- data:image/jpeg;base64,... (worst photo, 448x448)
  processed_image  text,                   -- the background-replaced photo the model saw
  per_view         jsonb NOT NULL DEFAULT '[]',  -- [{index, health_score, anomaly_percent, severity, heatmap_image}]
  warnings         jsonb NOT NULL DEFAULT '[]',
  model_version    text NOT NULL,
  processing_ms    int,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_cv_assessment_created ON cv_health_assessment (created_at DESC);

-- The linked scan must be a CV scan (source = 'CV_MODEL') and its score must match.
CREATE FUNCTION fn_cv_assessment_guard() RETURNS trigger AS $$
DECLARE s_source scan_source; s_score numeric(5,2);
BEGIN
  SELECT source, health_score INTO s_source, s_score FROM health_check_scan WHERE scan_id = NEW.scan_id;
  IF s_source IS DISTINCT FROM 'CV_MODEL' THEN
    RAISE EXCEPTION 'CV-01: a CV assessment must belong to a CV_MODEL scan';
  END IF;
  IF s_score <> NEW.health_score THEN
    RAISE EXCEPTION 'CV-02: CV assessment score must equal the scan health score';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER tg_cv_assessment_guard BEFORE INSERT ON cv_health_assessment
  FOR EACH ROW EXECUTE FUNCTION fn_cv_assessment_guard();

-- INV-25/26 spirit: assessment records are permanent.
CREATE FUNCTION fn_cv_assessment_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'CV-03: CV assessment records are permanent and cannot be modified or deleted';
END $$ LANGUAGE plpgsql;
CREATE TRIGGER tg_cv_assessment_noupd BEFORE UPDATE OR DELETE ON cv_health_assessment
  FOR EACH ROW EXECUTE FUNCTION fn_cv_assessment_immutable();

COMMENT ON TABLE cv_health_assessment IS
  'CV equipment health check detail (DINOv2 + background replacement + patch anomaly detection). '
  'One row per health_check_scan with source = CV_MODEL.';
