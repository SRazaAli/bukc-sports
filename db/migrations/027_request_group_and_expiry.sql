-- 027 — Request group ID + EXPIRED status
ALTER TYPE borrow_request_status ADD VALUE IF NOT EXISTS 'EXPIRED';

ALTER TABLE borrow_request
  ADD COLUMN IF NOT EXISTS request_group_id uuid;

UPDATE borrow_request
   SET request_group_id = borrow_request_id
 WHERE request_group_id IS NULL;

ALTER TABLE borrow_request
  ALTER COLUMN request_group_id SET DEFAULT gen_random_uuid();
ALTER TABLE borrow_request
  ALTER COLUMN request_group_id SET NOT NULL;

DROP INDEX IF EXISTS uq_one_open_borrow_request;

CREATE OR REPLACE FUNCTION fn_one_open_group_guard()
RETURNS trigger AS $$
DECLARE
  open_group uuid;
BEGIN
  IF (TG_OP = 'UPDATE' AND NEW.status = OLD.status) THEN RETURN NEW; END IF;
  IF NEW.status <> 'PENDING' THEN RETURN NEW; END IF;

  SELECT request_group_id INTO open_group
    FROM borrow_request
   WHERE requested_by = NEW.requested_by
     AND status = 'PENDING'
     AND request_group_id <> NEW.request_group_id
   LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'You already have a pending request. Wait for it to be reviewed before submitting another.'
      USING ERRCODE = '23505', CONSTRAINT = 'uq_one_open_borrow_request';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tg_one_open_group ON borrow_request;
CREATE TRIGGER tg_one_open_group
  BEFORE INSERT OR UPDATE ON borrow_request
  FOR EACH ROW EXECUTE FUNCTION fn_one_open_group_guard();

CREATE INDEX IF NOT EXISTS idx_br_pending_by
  ON borrow_request (requested_by, request_group_id)
  WHERE status = 'PENDING';