-- ============================================================================
-- 006 — real-time availability NOTIFY triggers (EQUIP-AVAIL-07)
--
-- Anything that changes an equipment type's available_units (article state,
-- and — once venue booking exists — event equipment locks) fires
-- pg_notify('equipment_availability', equipment_type_id) so the server's SSE
-- hub can push a fresh snapshot to connected clients without polling.
-- ============================================================================

CREATE FUNCTION fn_notify_equipment_change() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('equipment_availability', COALESCE(NEW.equipment_type_id, OLD.equipment_type_id)::text);
  RETURN NULL; -- AFTER trigger; return value ignored
END $$ LANGUAGE plpgsql;

CREATE TRIGGER tg_notify_article_change
  AFTER INSERT OR UPDATE ON article
  FOR EACH ROW EXECUTE FUNCTION fn_notify_equipment_change();

-- Forward-compatible: this table already exists (venue booking's schema), so
-- the notify wiring is ready the moment Feature 5 starts writing to it —
-- event equipment locks will already push live updates with no further work.
CREATE TRIGGER tg_notify_allocation_change
  AFTER INSERT OR UPDATE ON event_equipment_allocation
  FOR EACH ROW EXECUTE FUNCTION fn_notify_equipment_change();
