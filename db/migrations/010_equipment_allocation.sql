-- ============================================================================
-- 010 — equipment allocation for events (VENUE-13/15/16/17, EQUIP-AVAIL-11..21).
--
-- Same pattern as booking_session_request: event_equipment_allocation's FK to
-- booking_session means it can only exist post-approval, but VENUE-13 has the
-- Coordinator "forward it... along with the completed inline equipment
-- allocation" — i.e. allocation is planned BEFORE forwarding. A pre-approval
-- table mirrors booking_session_request and materializes into real
-- event_equipment_allocation rows in the same transaction as the sessions
-- themselves, at approval time.
--
-- Shortfall handling (VENUE-15/16/17), per explicit product decision: no new
-- booking is created for the shortfall round-trip. The SAME booking_id moves
-- through an added status — PENDING → SHORTFALL_PENDING (client asked to
-- confirm self-managed equipment) → back to PENDING (client confirmed, or
-- REJECTED if they decline) → FORWARDED → APPROVED, same as any booking.
-- ============================================================================

ALTER TYPE booking_status ADD VALUE 'SHORTFALL_PENDING';

CREATE TABLE booking_session_request_equipment (
  allocation_request_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_session_id    uuid NOT NULL REFERENCES booking_session_request(request_session_id) ON DELETE CASCADE,
  equipment_type_id     int NOT NULL REFERENCES equipment_type(equipment_type_id),
  quantity               int NOT NULL CHECK (quantity > 0),
  -- Set true once the client has confirmed they'll self-manage this shortfall
  -- item (VENUE-16); a self-managed line never gets a T-24hr lock — there's
  -- nothing from our own stock to lock.
  is_self_managed        boolean NOT NULL DEFAULT false,
  -- True while this line is short (planned quantity exceeded availability at
  -- planning time) and awaiting the client's yes/no on self-managing it. The
  -- SAME booking carries this state (no separate booking row, per product
  -- decision) — booking.status = SHORTFALL_PENDING mirrors this at the
  -- booking level while any line here is still awaiting confirmation.
  needs_shortfall_confirmation boolean NOT NULL DEFAULT false,
  allocated_by           uuid NOT NULL REFERENCES app_user(user_id),
  CONSTRAINT uq_bsre_type UNIQUE (request_session_id, equipment_type_id)
);

-- No hard stock-block trigger here on purpose: a Coordinator planning MORE
-- than is currently available is exactly the shortfall scenario this table
-- exists to support (VENUE-15/16/17) — it must be *allowed*, then resolved
-- through the confirmation workflow, not rejected outright. The service
-- layer compares against v_article_availability to detect and flag it.

-- fn_allocation_stock_guard (on the real, post-approval event_equipment_
-- allocation table) originally checked every row against our own total
-- stock — but a self-managed line (VENUE-16: the client brings their own
-- equipment) draws on nothing of ours and must be exempt from that check.
CREATE OR REPLACE FUNCTION fn_allocation_stock_guard() RETURNS trigger AS $$
DECLARE stock int;
BEGIN
  IF NEW.is_self_managed THEN RETURN NEW; END IF;
  SELECT count(*) INTO stock FROM article
   WHERE equipment_type_id = NEW.equipment_type_id AND state <> 'DECOMMISSIONED';
  IF NEW.quantity > stock THEN
    RAISE EXCEPTION 'EQUIP-AVAIL-04: cannot allocate % units - only % in stock for this type', NEW.quantity, stock;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
