-- ============================================================================
-- 020 — Inventory audit log (INV-25) + health-check session tracking (INV-15/28/29).
--
-- Part A: article_audit_log
--   Every mutation to the inventory — article entry, equipment-type edit,
--   scan, damage flag, flag clearance, condition override, decommission — is
--   written here with the actor's identity and a wall-clock timestamp.
--   Records are IMMUTABLE (no UPDATE/DELETE). INV-25/26.
--
-- Part B: health_check_session
--   Tracks the weekly scan window: when the alert was sent (alert_sent_at),
--   how many articles were outstanding at that moment (total_articles_due),
--   how many have since been scanned (scanned_count — trigger-maintained),
--   and whether the overdue alert has already been sent (overdue_notified_at).
--   INV-15/28/29.
-- ============================================================================

-- ── Part A: article_audit_log ──

CREATE TYPE article_audit_action AS ENUM (
  'ARTICLE_ENTERED',
  'ARTICLE_DECOMMISSIONED',
  'TYPE_EDITED',
  'SCAN_RECORDED',
  'DAMAGE_FLAG_RAISED',
  'DAMAGE_FLAG_CLEARED',
  'CONDITION_OVERRIDDEN',
  'PAIR_FORMED',
  'PAIR_DISSOLVED'
);

CREATE TABLE article_audit_log (
  log_id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id     uuid        REFERENCES article(article_id),   -- NULL for type-level edits
  equipment_type_id int      REFERENCES equipment_type(equipment_type_id),
  action         article_audit_action NOT NULL,
  actor_id       uuid        NOT NULL REFERENCES app_user(user_id),
  occurred_at    timestamptz NOT NULL DEFAULT now(),
  detail         jsonb       NOT NULL DEFAULT '{}'
);

CREATE INDEX ix_audit_article ON article_audit_log (article_id, occurred_at DESC)
  WHERE article_id IS NOT NULL;
CREATE INDEX ix_audit_type    ON article_audit_log (equipment_type_id, occurred_at DESC)
  WHERE equipment_type_id IS NOT NULL;
CREATE INDEX ix_audit_actor   ON article_audit_log (actor_id, occurred_at DESC);

-- Immutability: no UPDATE or DELETE allowed on audit log rows.
CREATE FUNCTION fn_audit_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'INV-25/26: audit log records are permanent and cannot be modified or deleted';
END $$ LANGUAGE plpgsql;

CREATE TRIGGER tg_audit_noupd BEFORE UPDATE OR DELETE ON article_audit_log
  FOR EACH ROW EXECUTE FUNCTION fn_audit_immutable();

COMMENT ON TABLE article_audit_log IS
  'INV-25: full mutation trail for every inventory record. Every row is permanent '
  '(fn_audit_immutable blocks UPDATE/DELETE). detail carries action-specific context '
  'as a JSON object (e.g. old/new values, scan score, condition label).';

-- ── Part B: health_check_session ──

CREATE TABLE health_check_session (
  session_id        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- When the HEALTH_CHECK_DUE alert was sent to the Coordinator.
  alert_sent_at     timestamptz NOT NULL DEFAULT now(),
  -- Total articles that need scanning in this window (snapshotted at alert time
  -- so the overdue calculation is stable even as articles are added/removed).
  total_articles_due int        NOT NULL CHECK (total_articles_due >= 0),
  -- How many of those articles have had a SCHEDULED scan recorded since alert_sent_at.
  -- Incremented by a trigger on health_check_scan (kind = 'SCHEDULED').
  scanned_count     int        NOT NULL DEFAULT 0 CHECK (scanned_count >= 0),
  -- When the HEALTH_CHECK_OVERDUE alert was sent (INV-29). NULL until fired.
  overdue_notified_at timestamptz,
  -- When the session was closed (all articles scanned within window). NULL if open.
  completed_at      timestamptz,
  CONSTRAINT ck_hcs_scanned CHECK (scanned_count <= total_articles_due)
);

CREATE INDEX ix_hcs_open ON health_check_session (alert_sent_at DESC)
  WHERE completed_at IS NULL;

-- Trigger: increment scanned_count on the current open health-check session
-- whenever a SCHEDULED scan is recorded, and close the session if all done.
CREATE FUNCTION fn_hcs_count_scan() RETURNS trigger AS $$
DECLARE open_session_id uuid;
BEGIN
  IF NEW.kind <> 'SCHEDULED' THEN
    RETURN NEW;
  END IF;

  SELECT session_id INTO open_session_id
    FROM health_check_session
    WHERE completed_at IS NULL
    ORDER BY alert_sent_at DESC
    LIMIT 1;

  IF open_session_id IS NULL THEN
    RETURN NEW;   -- no open session; ad-hoc or stray scan — ignore
  END IF;

  UPDATE health_check_session
    SET scanned_count = scanned_count + 1,
        completed_at  = CASE
          WHEN scanned_count + 1 >= total_articles_due THEN now()
          ELSE NULL
        END
    WHERE session_id = open_session_id;

  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER tg_hcs_count_scan AFTER INSERT ON health_check_scan
  FOR EACH ROW EXECUTE FUNCTION fn_hcs_count_scan();

COMMENT ON TABLE health_check_session IS
  'INV-15/28/29: one row per weekly health-check window. '
  'alert_sent_at = when HEALTH_CHECK_DUE fired; total_articles_due = snapshot '
  'of active articles at that moment; scanned_count = SCHEDULED scans recorded '
  'since then (trigger-maintained); overdue_notified_at = when the 48h overdue '
  'alert fired (INV-29); completed_at = when all articles were scanned.';
