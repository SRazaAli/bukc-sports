-- ============================================================================
-- BUKC Sports Platform — canonical schema, v1.2
-- Verified: 128/128 rule tests pass (see db/test-harness).
--
-- This is ONE migration on purpose. The schema's correctness depends on exact
-- load order: 41 triggers reference tables and enums defined earlier in the
-- file, and splitting it risks the ordering we spent three test rounds proving.
-- Treat this file as immutable. Schema changes for V1/V2 go in NEW migrations
-- (002_..., 003_...) that ALTER, never by editing this one.
-- ============================================================================

-- BUKC Sports Platform — DDL translated directly from ERD v1.0
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ===== ENUMS =====
CREATE TYPE user_role        AS ENUM ('SUPER_ADMIN','COORDINATOR','STUDENT','EXTERNAL');
CREATE TYPE user_status      AS ENUM ('PENDING_VERIFICATION','ACTIVE','DEACTIVATED');
CREATE TYPE lending_unit_type AS ENUM ('SINGLE','PAIR');
CREATE TYPE article_state    AS ENUM ('UNPAIRED','AVAILABLE','ON_LOAN','DAMAGED','DECOMMISSIONED');
CREATE TYPE condition_label  AS ENUM ('GOOD','WORN','DAMAGED');
CREATE TYPE scan_kind        AS ENUM ('ENTRY','SCHEDULED','AD_HOC');
CREATE TYPE scan_source      AS ENUM ('MANUAL','CV_MODEL');
CREATE TYPE borrow_request_status AS ENUM ('PENDING','APPROVED','REJECTED','CANCELLED');
CREATE TYPE borrow_txn_status AS ENUM ('ACTIVE','OVERDUE','INCOMPLETE','COMPLETED','COMPLETED_LATE','COMPLETED_DAMAGED');
CREATE TYPE borrow_path      AS ENUM ('PLATFORM','WALK_IN');
CREATE TYPE booking_status   AS ENUM ('PENDING','FORWARDED','APPROVED','REJECTED','CANCELLED','COMPLETED');
CREATE TYPE session_status   AS ENUM ('SCHEDULED','IN_PROGRESS','COMPLETED','NEEDS_RESCHEDULING','CANCELLED');
CREATE TYPE booking_origin   AS ENUM ('CLIENT','EXTERNAL','ACADEMIC');
CREATE TYPE approval_subject AS ENUM ('VENUE_BOOKING','BORROW_REQUEST','ACCOUNT_VERIFICATION','EQUIPMENT_EXCEPTION');
CREATE TYPE approval_verb    AS ENUM ('SUBMIT','FORWARD','APPROVE','REJECT','RETURN_FOR_REEVALUATION','CANCEL');
CREATE TYPE exception_kind   AS ENUM ('INCREASE_QUANTITY','CHANGE_TYPE','REMOVE_LINE');
CREATE TYPE exception_status AS ENUM ('PENDING','APPROVED','REJECTED');
CREATE TYPE history_kind     AS ENUM ('VENUE_SESSION','EQUIPMENT_BORROW');
CREATE TYPE notification_type AS ENUM (
  'ACCOUNT_VERIFIED','BOOKING_APPROVED','BOOKING_REJECTED','BOOKING_CANCELLED',
  'BOOKING_POSTPONED','BOOKING_RESCHEDULED','EQUIPMENT_SHORTFALL',
  'BORROW_APPROVED','BORROW_REJECTED','BORROW_DUE_REMINDER','BORROW_OVERDUE_CLIENT',
  'QUEUE_NEW_ITEM','QUEUE_PENDING_REMINDER','ITEM_FORWARDED','ITEM_RETURNED_FOR_REEVAL',
  'ITEM_APPROVED_UPSTREAM','ITEM_REJECTED_UPSTREAM',
  'BORROW_OVERDUE_COORDINATOR','T24_LOCK_ALERT','HEALTH_CHECK_DUE','HEALTH_CHECK_OVERDUE',
  'POST_EVENT_REVIEW','SWAP_PERFORMED','SWAP_NOTICE_SUPERADMIN',
  'DAMAGE_FLAGGED','INVENTORY_ACTION','MULTISESSION_PROGRESS','FALLBACK_ENTRY_MADE'
);

-- ===== IDENTITY =====
CREATE TABLE app_user (
  user_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role user_role NOT NULL,
  status user_status NOT NULL DEFAULT 'PENDING_VERIFICATION',
  full_name text NOT NULL,
  email citext NOT NULL UNIQUE,
  contact_number text NOT NULL,
  password_hash text NOT NULL,
  failed_login_count smallint NOT NULL DEFAULT 0,
  locked_until timestamptz,
  verified_by uuid REFERENCES app_user(user_id),
  verified_at timestamptz,
  created_by uuid REFERENCES app_user(user_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  deactivated_at timestamptz,
  CONSTRAINT ck_no_self_verify CHECK (verified_by IS NULL OR verified_by <> user_id),
  CONSTRAINT ck_active_implies_verified CHECK (status <> 'ACTIVE' OR verified_at IS NOT NULL),
  CONSTRAINT ck_coord_created_by CHECK (role <> 'COORDINATOR' OR created_by IS NOT NULL)
);

CREATE TABLE student_profile (
  user_id uuid PRIMARY KEY REFERENCES app_user(user_id) ON DELETE RESTRICT,
  enrollment_no text NOT NULL UNIQUE,
  department text NOT NULL,
  CONSTRAINT ck_enroll_fmt CHECK (enrollment_no ~ '^[0-9]{2}-[0-9]{6}-[0-9]{3}$')
);

CREATE TABLE external_profile (
  user_id uuid PRIMARY KEY REFERENCES app_user(user_id) ON DELETE RESTRICT,
  institution_name text NOT NULL,
  representative_name text NOT NULL,
  designation text NOT NULL
);

CREATE TABLE password_reset_token (
  token_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_user(user_id),
  token_hash text NOT NULL UNIQUE,
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  CONSTRAINT ck_reset_window CHECK (expires_at = issued_at + interval '15 minutes')
);

-- AUTH-13: at least one active Super Admin
CREATE FUNCTION fn_protect_last_superadmin() RETURNS trigger AS $$
DECLARE n int;
BEGIN
  IF (TG_OP='DELETE' AND OLD.role='SUPER_ADMIN' AND OLD.status='ACTIVE')
     OR (TG_OP='UPDATE' AND OLD.role='SUPER_ADMIN' AND OLD.status='ACTIVE'
         AND (NEW.status<>'ACTIVE' OR NEW.role<>'SUPER_ADMIN')) THEN
    SELECT count(*) INTO n FROM app_user
      WHERE role='SUPER_ADMIN' AND status='ACTIVE' AND user_id<>OLD.user_id;
    IF n = 0 THEN
      RAISE EXCEPTION 'AUTH-13: cannot deactivate the last active Super Admin';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$ LANGUAGE plpgsql;
CREATE TRIGGER tg_protect_last_sa BEFORE UPDATE OR DELETE ON app_user
  FOR EACH ROW EXECUTE FUNCTION fn_protect_last_superadmin();

-- AUTH-05: subtype disjointness
CREATE FUNCTION fn_check_subtype() RETURNS trigger AS $$
DECLARE r user_role;
BEGIN
  SELECT role INTO r FROM app_user WHERE user_id = NEW.user_id;
  IF TG_TABLE_NAME='student_profile' AND r<>'STUDENT' THEN
    RAISE EXCEPTION 'AUTH-05: student_profile requires role STUDENT (got %)', r;
  END IF;
  IF TG_TABLE_NAME='external_profile' AND r<>'EXTERNAL' THEN
    RAISE EXCEPTION 'AUTH-05: external_profile requires role EXTERNAL (got %)', r;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER tg_sp_subtype BEFORE INSERT OR UPDATE ON student_profile
  FOR EACH ROW EXECUTE FUNCTION fn_check_subtype();
CREATE TRIGGER tg_ep_subtype BEFORE INSERT OR UPDATE ON external_profile
  FOR EACH ROW EXECUTE FUNCTION fn_check_subtype();

-- ===== INVENTORY =====
CREATE TABLE sport_category (
  sport_category_id smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL UNIQUE,
  is_indoor boolean NOT NULL
);

CREATE TABLE equipment_type (
  equipment_type_id int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sport_category_id smallint NOT NULL REFERENCES sport_category(sport_category_id),
  name text NOT NULL,
  lending_unit lending_unit_type NOT NULL,
  low_stock_threshold int NOT NULL DEFAULT 0 CHECK (low_stock_threshold >= 0),
  max_borrow_duration_minutes int NOT NULL CHECK (max_borrow_duration_minutes > 0),
  condition_good_min_score numeric(5,2) NOT NULL,
  condition_worn_min_score numeric(5,2) NOT NULL,
  UNIQUE (sport_category_id, name),
  CONSTRAINT ck_thresholds_ordered CHECK (condition_good_min_score > condition_worn_min_score)
);

CREATE TABLE article (
  article_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  equipment_type_id int NOT NULL REFERENCES equipment_type(equipment_type_id),
  barcode text NOT NULL UNIQUE,
  state article_state NOT NULL,
  current_condition_label condition_label NOT NULL,
  entered_by uuid NOT NULL REFERENCES app_user(user_id),
  entered_at timestamptz NOT NULL DEFAULT now(),
  decommissioned_by uuid REFERENCES app_user(user_id),
  decommissioned_at timestamptz,
  CONSTRAINT ck_decom CHECK ((state='DECOMMISSIONED') = (decommissioned_at IS NOT NULL))
);

-- INV-05 barcode immutable; INV-24 decommission terminal
CREATE FUNCTION fn_article_guard() RETURNS trigger AS $$
BEGIN
  IF NEW.barcode <> OLD.barcode THEN
    RAISE EXCEPTION 'INV-05: barcode is immutable';
  END IF;
  IF OLD.state='DECOMMISSIONED' AND NEW.state<>'DECOMMISSIONED' THEN
    RAISE EXCEPTION 'INV-24: decommission is terminal';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER tg_article_guard BEFORE UPDATE ON article
  FOR EACH ROW EXECUTE FUNCTION fn_article_guard();

-- INV-26 no deletion
CREATE FUNCTION fn_no_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% : records cannot be deleted by any role', TG_ARGV[0];
END $$ LANGUAGE plpgsql;
CREATE TRIGGER tg_article_nodel BEFORE DELETE ON article
  FOR EACH ROW EXECUTE FUNCTION fn_no_delete('INV-26');

CREATE TABLE article_pair (
  pair_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  article_a_id uuid NOT NULL REFERENCES article(article_id),
  article_b_id uuid NOT NULL REFERENCES article(article_id),
  formed_by uuid NOT NULL REFERENCES app_user(user_id),
  formed_at timestamptz NOT NULL DEFAULT now(),
  dissolved_by uuid REFERENCES app_user(user_id),
  dissolved_at timestamptz,
  dissolution_reason text,
  CONSTRAINT ck_pair_distinct CHECK (article_a_id <> article_b_id),
  CONSTRAINT ck_pair_canonical CHECK (article_a_id < article_b_id),
  CONSTRAINT ck_dissolve_pair CHECK ((dissolved_at IS NULL) = (dissolved_by IS NULL))
);
CREATE UNIQUE INDEX uq_pair_active_a ON article_pair (article_a_id) WHERE dissolved_at IS NULL;
CREATE UNIQUE INDEX uq_pair_active_b ON article_pair (article_b_id) WHERE dissolved_at IS NULL;

-- INV-07 same type; INV-08 one live pair per article across BOTH columns
CREATE FUNCTION fn_pair_guard() RETURNS trigger AS $$
DECLARE ta int; tb int; n int;
BEGIN
  SELECT equipment_type_id INTO ta FROM article WHERE article_id=NEW.article_a_id;
  SELECT equipment_type_id INTO tb FROM article WHERE article_id=NEW.article_b_id;
  IF ta <> tb THEN
    RAISE EXCEPTION 'INV-07: pair requires same equipment type';
  END IF;
  IF NEW.dissolved_at IS NULL THEN
    SELECT count(*) INTO n FROM article_pair
      WHERE dissolved_at IS NULL AND pair_id <> NEW.pair_id
        AND (article_a_id IN (NEW.article_a_id,NEW.article_b_id)
          OR article_b_id IN (NEW.article_a_id,NEW.article_b_id));
    IF n > 0 THEN
      RAISE EXCEPTION 'INV-08: article already in a live pair';
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER tg_pair_guard BEFORE INSERT OR UPDATE ON article_pair
  FOR EACH ROW EXECUTE FUNCTION fn_pair_guard();

CREATE TABLE health_check_scan (
  scan_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id uuid NOT NULL REFERENCES article(article_id),
  kind scan_kind NOT NULL,
  source scan_source NOT NULL DEFAULT 'MANUAL',
  health_score numeric(5,2) NOT NULL CHECK (health_score BETWEEN 0 AND 100),
  resulting_label condition_label NOT NULL,
  scanned_by uuid NOT NULL REFERENCES app_user(user_id),
  scanned_at timestamptz NOT NULL DEFAULT now(),
  cv_model_version text,
  cv_confidence numeric(4,3),
  CONSTRAINT ck_cv_cols CHECK (source='CV_MODEL' OR (cv_model_version IS NULL AND cv_confidence IS NULL))
);

-- INV-17/18: scan updates label; damaged range auto-flags
CREATE FUNCTION fn_scan_applies() RETURNS trigger AS $$
BEGIN
  UPDATE article SET current_condition_label = NEW.resulting_label
    WHERE article_id = NEW.article_id;
  IF NEW.resulting_label = 'DAMAGED' THEN
    UPDATE article SET state='DAMAGED'
      WHERE article_id=NEW.article_id AND state NOT IN ('DECOMMISSIONED','ON_LOAN');
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER tg_scan_applies AFTER INSERT ON health_check_scan
  FOR EACH ROW EXECUTE FUNCTION fn_scan_applies();

CREATE TABLE damage_flag (
  flag_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id uuid NOT NULL REFERENCES article(article_id),
  raised_by uuid REFERENCES app_user(user_id),
  raised_by_system boolean NOT NULL DEFAULT false,
  raised_at timestamptz NOT NULL DEFAULT now(),
  source_scan_id uuid REFERENCES health_check_scan(scan_id),
  cleared_by uuid REFERENCES app_user(user_id),
  cleared_at timestamptz,
  cleared_with_label condition_label,
  CONSTRAINT ck_flag_actor CHECK ((raised_by IS NULL) = raised_by_system),
  CONSTRAINT ck_flag_clear CHECK (
    (cleared_at IS NULL) = (cleared_by IS NULL)
    AND (cleared_at IS NULL) = (cleared_with_label IS NULL))
);
CREATE UNIQUE INDEX uq_active_damage_flag ON damage_flag (article_id) WHERE cleared_at IS NULL;

-- ===== BORROWING =====
CREATE TABLE borrow_request (
  borrow_request_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requested_by uuid NOT NULL REFERENCES app_user(user_id),
  equipment_type_id int NOT NULL REFERENCES equipment_type(equipment_type_id),
  requested_start_at timestamptz NOT NULL,
  requested_return_at timestamptz NOT NULL,
  status borrow_request_status NOT NULL DEFAULT 'PENDING',
  decided_by uuid REFERENCES app_user(user_id),
  decided_at timestamptz,
  rejection_reason text,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_br_sameday CHECK (
    (requested_start_at AT TIME ZONE 'Asia/Karachi')::date
    = (requested_return_at AT TIME ZONE 'Asia/Karachi')::date),
  CONSTRAINT ck_br_order CHECK (requested_return_at > requested_start_at),
  CONSTRAINT ck_br_reason CHECK (status <> 'REJECTED' OR rejection_reason IS NOT NULL),
  CONSTRAINT ck_br_decided CHECK ((status IN ('APPROVED','REJECTED')) = (decided_at IS NOT NULL))
);
CREATE UNIQUE INDEX uq_one_open_borrow_request ON borrow_request (requested_by) WHERE status='PENDING';

-- EQUIP-AVAIL-01: External cannot borrow
CREATE FUNCTION fn_borrow_role_guard() RETURNS trigger AS $$
DECLARE r user_role;
BEGIN
  SELECT role INTO r FROM app_user WHERE user_id=NEW.requested_by;
  IF r <> 'STUDENT' THEN
    RAISE EXCEPTION 'EQUIP-AVAIL-01: only STUDENT may submit borrow requests (got %)', r;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER tg_borrow_role BEFORE INSERT OR UPDATE ON borrow_request
  FOR EACH ROW EXECUTE FUNCTION fn_borrow_role_guard();

CREATE TABLE guest_borrower (
  guest_borrower_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  id_number text NOT NULL,
  contact_number text NOT NULL,
  is_faculty boolean NOT NULL
);

CREATE TABLE borrow_transaction (
  borrow_txn_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  path borrow_path NOT NULL,
  borrow_request_id uuid UNIQUE REFERENCES borrow_request(borrow_request_id),
  borrower_user_id uuid REFERENCES app_user(user_id),
  guest_borrower_id uuid UNIQUE REFERENCES guest_borrower(guest_borrower_id),
  equipment_type_id int NOT NULL REFERENCES equipment_type(equipment_type_id),
  agreed_start_at timestamptz NOT NULL,
  agreed_return_at timestamptz NOT NULL,
  actual_start_at timestamptz NOT NULL DEFAULT now(),
  actual_return_at timestamptz,
  status borrow_txn_status NOT NULL DEFAULT 'ACTIVE',
  id_card_held boolean NOT NULL DEFAULT true,
  id_card_returned_at timestamptz,
  lent_by uuid NOT NULL REFERENCES app_user(user_id),
  entered_via_offline_fallback boolean NOT NULL DEFAULT false,
  CONSTRAINT ck_borrower_xor CHECK (
    (borrower_user_id IS NOT NULL AND guest_borrower_id IS NULL)
    OR (borrower_user_id IS NULL AND guest_borrower_id IS NOT NULL)),
  CONSTRAINT ck_path_platform CHECK ((path='PLATFORM') = (borrow_request_id IS NOT NULL)),
  CONSTRAINT ck_path_walkin CHECK (path<>'WALK_IN' OR guest_borrower_id IS NOT NULL),
  CONSTRAINT ck_path_plat_user CHECK (path<>'PLATFORM' OR borrower_user_id IS NOT NULL),
  CONSTRAINT ck_txn_order CHECK (agreed_return_at > agreed_start_at),
  CONSTRAINT ck_txn_sameday CHECK (
    (agreed_start_at AT TIME ZONE 'Asia/Karachi')::date
    = (agreed_return_at AT TIME ZONE 'Asia/Karachi')::date),
  CONSTRAINT ck_idcard CHECK (id_card_returned_at IS NULL
    OR status IN ('COMPLETED','COMPLETED_LATE','COMPLETED_DAMAGED')),
  CONSTRAINT ck_completed_ret CHECK (
    (status::text LIKE 'COMPLETED%') = (actual_return_at IS NOT NULL))
);
CREATE UNIQUE INDEX uq_one_active_borrow_registered ON borrow_transaction (borrower_user_id)
  WHERE status IN ('ACTIVE','OVERDUE','INCOMPLETE') AND borrower_user_id IS NOT NULL;
CREATE TRIGGER tg_txn_nodel BEFORE DELETE ON borrow_transaction
  FOR EACH ROW EXECUTE FUNCTION fn_no_delete('BORROW-24');
CREATE TRIGGER tg_guest_nodel BEFORE DELETE ON guest_borrower
  FOR EACH ROW EXECUTE FUNCTION fn_no_delete('BORROW-24');

CREATE TABLE borrow_transaction_article (
  borrow_txn_id uuid NOT NULL REFERENCES borrow_transaction(borrow_txn_id),
  article_id uuid NOT NULL REFERENCES article(article_id),
  pair_id uuid REFERENCES article_pair(pair_id),
  selection_method text NOT NULL CHECK (selection_method IN ('BARCODE_SCAN','MANUAL_SELECT')),
  returned_at timestamptz,
  return_condition condition_label,
  is_temporary_swap boolean NOT NULL DEFAULT false,
  PRIMARY KEY (borrow_txn_id, article_id)
);

-- BORROW-03: 1 row for SINGLE, 2 for PAIR (deferred to commit)
CREATE FUNCTION fn_lending_unit_check() RETURNS trigger AS $$
DECLARE lu lending_unit_type; n int; txn uuid;
BEGIN
  txn := COALESCE(NEW.borrow_txn_id, OLD.borrow_txn_id);
  SELECT et.lending_unit INTO lu FROM borrow_transaction bt
    JOIN equipment_type et USING (equipment_type_id) WHERE bt.borrow_txn_id = txn;
  SELECT count(*) INTO n FROM borrow_transaction_article WHERE borrow_txn_id = txn;
  IF lu='SINGLE' AND n<>1 THEN
    RAISE EXCEPTION 'BORROW-03: SINGLE lending unit requires exactly 1 article (got %)', n;
  END IF;
  IF lu='PAIR' AND n<>2 THEN
    RAISE EXCEPTION 'BORROW-03: PAIR lending unit requires exactly 2 articles (got %)', n;
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;
CREATE CONSTRAINT TRIGGER tg_lending_unit AFTER INSERT OR UPDATE OR DELETE ON borrow_transaction_article
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fn_lending_unit_check();

-- ===== VENUE =====
CREATE TABLE venue (
  venue_id int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL UNIQUE,
  sport_category_id smallint REFERENCES sport_category(sport_category_id),
  capacity int NOT NULL CHECK (capacity > 0),
  is_indoor boolean NOT NULL,
  is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE booking (
  booking_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id int NOT NULL REFERENCES venue(venue_id),
  origin booking_origin NOT NULL,
  requested_by uuid REFERENCES app_user(user_id),
  internal_client_ref text,
  purpose text NOT NULL,
  estimated_participants int NOT NULL CHECK (estimated_participants > 0),
  status booking_status NOT NULL DEFAULT 'PENDING',
  submitted_at timestamptz NOT NULL DEFAULT now(),
  forwarded_by uuid REFERENCES app_user(user_id),
  forwarded_at timestamptz,
  feasibility_note text,
  decided_by uuid REFERENCES app_user(user_id),
  decided_at timestamptz,
  rejection_reason text,
  self_managed_equipment boolean NOT NULL DEFAULT false,
  entered_via_offline_fallback boolean NOT NULL DEFAULT false,
  CONSTRAINT ck_academic_ref CHECK (
    (origin='ACADEMIC' AND requested_by IS NULL AND internal_client_ref='BUKC SPORTS DEPARTMENT')
    OR (origin<>'ACADEMIC' AND requested_by IS NOT NULL AND internal_client_ref IS NULL)),
  CONSTRAINT ck_bk_reason CHECK (status <> 'REJECTED' OR rejection_reason IS NOT NULL),
  CONSTRAINT ck_bk_forwarded CHECK (status NOT IN ('FORWARDED','APPROVED') OR forwarded_at IS NOT NULL),
  CONSTRAINT ck_bk_cancel CHECK (status <> 'CANCELLED' OR forwarded_at IS NULL)
);
CREATE UNIQUE INDEX uq_one_active_booking ON booking (requested_by)
  WHERE status IN ('PENDING','FORWARDED','APPROVED') AND requested_by IS NOT NULL;

CREATE TABLE booking_session (
  session_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES booking(booking_id) ON DELETE RESTRICT,
  session_no smallint NOT NULL CHECK (session_no BETWEEN 1 AND 30),
  venue_id int NOT NULL REFERENCES venue(venue_id),
  slot tstzrange NOT NULL,
  status session_status NOT NULL DEFAULT 'SCHEDULED',
  reschedule_reason text,
  cancellation_reason text,
  cancelled_by uuid REFERENCES app_user(user_id),
  equipment_lock_at timestamptz NOT NULL,
  UNIQUE (booking_id, session_no),
  CONSTRAINT ck_slot_bounds CHECK (NOT isempty(slot) AND lower_inc(slot) AND NOT upper_inc(slot)),
  CONSTRAINT ck_cancel_reason CHECK (status<>'CANCELLED' OR cancellation_reason IS NOT NULL),
  CONSTRAINT ck_resched_reason CHECK (status<>'NEEDS_RESCHEDULING' OR reschedule_reason IS NOT NULL),
  CONSTRAINT no_overlapping_approved_sessions EXCLUDE USING GIST (
    venue_id WITH =, slot WITH &&
  ) WHERE (status IN ('SCHEDULED','IN_PROGRESS','COMPLETED'))
);

-- VENUE-06 same venue as parent; VENUE-35 cap 30
CREATE FUNCTION fn_session_guard() RETURNS trigger AS $$
DECLARE bv int; n int;
BEGIN
  NEW.equipment_lock_at := lower(NEW.slot) - interval '24 hours';
  SELECT venue_id INTO bv FROM booking WHERE booking_id=NEW.booking_id;
  IF bv <> NEW.venue_id THEN
    RAISE EXCEPTION 'VENUE-06: session venue must match parent booking venue';
  END IF;
  SELECT count(*) INTO n FROM booking_session
    WHERE booking_id=NEW.booking_id AND session_id<>NEW.session_id;
  IF n + 1 > 30 THEN
    RAISE EXCEPTION 'VENUE-35: multi-session booking capped at 30 sessions';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER tg_session_guard BEFORE INSERT OR UPDATE ON booking_session
  FOR EACH ROW EXECUTE FUNCTION fn_session_guard();

CREATE TABLE session_participant (
  participant_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES booking_session(session_id) ON DELETE CASCADE,
  team_name text NOT NULL,
  member_name text NOT NULL,
  member_identifier text,
  is_team_contact boolean NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX uq_one_contact_per_team ON session_participant (session_id, team_name)
  WHERE is_team_contact;

CREATE TABLE event_equipment_allocation (
  allocation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES booking_session(session_id),
  equipment_type_id int NOT NULL REFERENCES equipment_type(equipment_type_id),
  quantity int NOT NULL CHECK (quantity > 0),
  allocated_by uuid NOT NULL REFERENCES app_user(user_id),
  allocated_at timestamptz NOT NULL DEFAULT now(),
  is_self_managed boolean NOT NULL DEFAULT false,
  locked_at timestamptz,
  released_at timestamptz,
  UNIQUE (session_id, equipment_type_id)
);

CREATE TABLE article_swap (
  swap_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  allocation_id uuid NOT NULL REFERENCES event_equipment_allocation(allocation_id),
  outgoing_article_id uuid NOT NULL REFERENCES article(article_id),
  incoming_article_id uuid NOT NULL REFERENCES article(article_id),
  performed_by uuid NOT NULL REFERENCES app_user(user_id),
  performed_at timestamptz NOT NULL DEFAULT now(),
  reason text
);

-- EQUIP-AVAIL-14: same sport category only
CREATE FUNCTION fn_swap_guard() RETURNS trigger AS $$
DECLARE ca smallint; cb smallint;
BEGIN
  SELECT et.sport_category_id INTO ca FROM article a
    JOIN equipment_type et USING (equipment_type_id) WHERE a.article_id=NEW.outgoing_article_id;
  SELECT et.sport_category_id INTO cb FROM article a
    JOIN equipment_type et USING (equipment_type_id) WHERE a.article_id=NEW.incoming_article_id;
  IF ca <> cb THEN
    RAISE EXCEPTION 'EQUIP-AVAIL-14: cross-category swaps are not permitted';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER tg_swap_guard BEFORE INSERT ON article_swap
  FOR EACH ROW EXECUTE FUNCTION fn_swap_guard();
-- EQUIP-AVAIL-21: permanent, no reversal
CREATE FUNCTION fn_no_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% : record is permanent and cannot be modified', TG_ARGV[0];
END $$ LANGUAGE plpgsql;
CREATE TRIGGER tg_swap_noupd BEFORE UPDATE OR DELETE ON article_swap
  FOR EACH ROW EXECUTE FUNCTION fn_no_update('EQUIP-AVAIL-21');

CREATE TABLE equipment_exception_request (
  exception_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  allocation_id uuid NOT NULL REFERENCES event_equipment_allocation(allocation_id),
  kind exception_kind NOT NULL,
  proposed_quantity int,
  proposed_equipment_type_id int REFERENCES equipment_type(equipment_type_id),
  status exception_status NOT NULL DEFAULT 'PENDING',
  requested_by uuid NOT NULL REFERENCES app_user(user_id),
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid REFERENCES app_user(user_id),
  decided_at timestamptz,
  rejection_reason text,
  CONSTRAINT ck_exc_qty CHECK (kind<>'INCREASE_QUANTITY' OR proposed_quantity IS NOT NULL),
  CONSTRAINT ck_exc_type CHECK (kind<>'CHANGE_TYPE' OR proposed_equipment_type_id IS NOT NULL),
  CONSTRAINT ck_exc_reason CHECK (status<>'REJECTED' OR rejection_reason IS NOT NULL)
);

-- ===== APPROVAL / NOTIFICATION / HISTORY =====
CREATE TABLE approval_action (
  action_id bigserial PRIMARY KEY,
  subject approval_subject NOT NULL,
  verb approval_verb NOT NULL,
  booking_id uuid REFERENCES booking(booking_id),
  borrow_request_id uuid REFERENCES borrow_request(borrow_request_id),
  subject_user_id uuid REFERENCES app_user(user_id),
  exception_id uuid REFERENCES equipment_exception_request(exception_id),
  actor_id uuid REFERENCES app_user(user_id),
  note text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_appr_target CHECK (
    (subject='VENUE_BOOKING' AND booking_id IS NOT NULL AND borrow_request_id IS NULL
      AND subject_user_id IS NULL AND exception_id IS NULL)
    OR (subject='BORROW_REQUEST' AND borrow_request_id IS NOT NULL AND booking_id IS NULL
      AND subject_user_id IS NULL AND exception_id IS NULL)
    OR (subject='ACCOUNT_VERIFICATION' AND subject_user_id IS NOT NULL AND booking_id IS NULL
      AND borrow_request_id IS NULL AND exception_id IS NULL)
    OR (subject='EQUIPMENT_EXCEPTION' AND exception_id IS NOT NULL AND booking_id IS NULL
      AND borrow_request_id IS NULL AND subject_user_id IS NULL)),
  CONSTRAINT ck_reeval_venue_only CHECK (verb<>'RETURN_FOR_REEVALUATION' OR subject='VENUE_BOOKING'),
  CONSTRAINT ck_forward_venue_only CHECK (verb<>'FORWARD' OR subject='VENUE_BOOKING'),
  CONSTRAINT ck_reject_note CHECK (verb<>'REJECT' OR note IS NOT NULL),
  CONSTRAINT ck_reeval_note CHECK (verb<>'RETURN_FOR_REEVALUATION' OR note IS NOT NULL)
);
CREATE TRIGGER tg_appr_noupd BEFORE UPDATE OR DELETE ON approval_action
  FOR EACH ROW EXECUTE FUNCTION fn_no_update('APPR-18');

CREATE TABLE notification (
  notification_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id uuid NOT NULL REFERENCES app_user(user_id),
  type notification_type NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  booking_id uuid REFERENCES booking(booking_id),
  session_id uuid REFERENCES booking_session(session_id),
  borrow_request_id uuid REFERENCES borrow_request(borrow_request_id),
  borrow_txn_id uuid REFERENCES borrow_transaction(borrow_txn_id),
  article_id uuid REFERENCES article(article_id),
  allocation_id uuid REFERENCES event_equipment_allocation(allocation_id),
  exception_id uuid REFERENCES equipment_exception_request(exception_id),
  subject_user_id uuid REFERENCES app_user(user_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  email_dispatched_at timestamptz,
  email_suppressed boolean NOT NULL DEFAULT false
);
CREATE INDEX ix_notif_unread ON notification (recipient_id, created_at DESC) WHERE read_at IS NULL;

CREATE TABLE usage_history (
  history_id bigserial PRIMARY KEY,
  kind history_kind NOT NULL,
  occurred_on date NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  session_id uuid UNIQUE REFERENCES booking_session(session_id),
  borrow_txn_id uuid UNIQUE REFERENCES borrow_transaction(borrow_txn_id),
  actor_user_id uuid REFERENCES app_user(user_id),
  guest_borrower_id uuid REFERENCES guest_borrower(guest_borrower_id),
  venue_id int REFERENCES venue(venue_id),
  equipment_type_id int REFERENCES equipment_type(equipment_type_id),
  sport_category_id smallint REFERENCES sport_category(sport_category_id),
  outcome text NOT NULL,
  snapshot jsonb NOT NULL,
  entered_via_offline_fallback boolean NOT NULL DEFAULT false,
  CONSTRAINT ck_hist_kind CHECK (
    (kind='VENUE_SESSION' AND session_id IS NOT NULL AND borrow_txn_id IS NULL)
    OR (kind='EQUIPMENT_BORROW' AND borrow_txn_id IS NOT NULL AND session_id IS NULL)),
  CONSTRAINT ck_hist_actor CHECK (
    (actor_user_id IS NOT NULL AND guest_borrower_id IS NULL)
    OR (actor_user_id IS NULL AND guest_borrower_id IS NOT NULL)
    OR (actor_user_id IS NULL AND guest_borrower_id IS NULL)),
  CONSTRAINT ck_hist_venue CHECK (kind<>'VENUE_SESSION' OR venue_id IS NOT NULL),
  CONSTRAINT ck_hist_equip CHECK (kind<>'EQUIPMENT_BORROW' OR equipment_type_id IS NOT NULL)
);
CREATE TRIGGER tg_hist_noupd BEFORE UPDATE OR DELETE ON usage_history
  FOR EACH ROW EXECUTE FUNCTION fn_no_update('HIST-05');

-- HIST-09: External users have no equipment history
CREATE FUNCTION fn_hist_external_guard() RETURNS trigger AS $$
DECLARE r user_role;
BEGIN
  IF NEW.kind='EQUIPMENT_BORROW' AND NEW.actor_user_id IS NOT NULL THEN
    SELECT role INTO r FROM app_user WHERE user_id=NEW.actor_user_id;
    IF r='EXTERNAL' THEN
      RAISE EXCEPTION 'HIST-09: External users have no equipment borrow history';
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER tg_hist_external BEFORE INSERT ON usage_history
  FOR EACH ROW EXECUTE FUNCTION fn_hist_external_guard();

CREATE INDEX ix_hist_occurred ON usage_history (occurred_on DESC);
CREATE INDEX ix_hist_actor ON usage_history (actor_user_id, occurred_on DESC);
CREATE INDEX ix_hist_kind_outcome ON usage_history (kind, outcome);
CREATE INDEX ix_hist_sport_month ON usage_history (sport_category_id, occurred_on);
CREATE INDEX ix_hist_fallback ON usage_history (occurred_on) WHERE entered_via_offline_fallback;

-- ===== VIEWS =====
CREATE VIEW v_article_availability AS
SELECT et.equipment_type_id, et.name, et.sport_category_id,
  count(*) FILTER (WHERE a.state <> 'DECOMMISSIONED') AS total_stock,
  count(*) FILTER (WHERE a.state = 'ON_LOAN') AS on_loan,
  count(*) FILTER (WHERE a.state = 'DAMAGED') AS damaged,
  count(*) FILTER (WHERE a.state = 'UNPAIRED') AS unpaired,
  COALESCE(lk.locked_units,0) AS event_locked,
  count(*) FILTER (WHERE a.state <> 'DECOMMISSIONED')
    - count(*) FILTER (WHERE a.state = 'ON_LOAN')
    - count(*) FILTER (WHERE a.state = 'DAMAGED')
    - count(*) FILTER (WHERE a.state = 'UNPAIRED')
    - COALESCE(lk.locked_units,0) AS available_units
FROM equipment_type et
JOIN article a USING (equipment_type_id)
LEFT JOIN LATERAL (
  SELECT sum(quantity) AS locked_units FROM event_equipment_allocation
  WHERE equipment_type_id = et.equipment_type_id AND locked_at IS NOT NULL AND released_at IS NULL
) lk ON true
GROUP BY et.equipment_type_id, et.name, et.sport_category_id, lk.locked_units;

CREATE VIEW v_equipment_status_badge AS
SELECT v.equipment_type_id, v.name, v.sport_category_id, v.available_units,
  CASE WHEN v.available_units = 0 THEN 'CHECKED_OUT'
       WHEN v.available_units <= et.low_stock_threshold THEN 'LOW_STOCK'
       ELSE 'AVAILABLE' END AS status_badge
FROM v_article_availability v JOIN equipment_type et USING (equipment_type_id);

CREATE VIEW v_client_reputation AS
SELECT actor_user_id AS user_id,
  count(*) AS total_borrows,
  count(*) FILTER (WHERE outcome='COMPLETED_LATE') AS late_returns,
  count(*) FILTER (WHERE outcome='COMPLETED_DAMAGED') AS damaged_returns,
  max(occurred_on) FILTER (WHERE outcome='COMPLETED_LATE') AS last_late_return
FROM usage_history
WHERE kind='EQUIPMENT_BORROW' AND actor_user_id IS NOT NULL
GROUP BY actor_user_id;

CREATE VIEW v_calendar AS
SELECT s.session_id, s.venue_id, v.name AS venue_name,
  lower(s.slot) AS starts_at, upper(s.slot) AS ends_at,
  s.status, s.session_no, b.booking_id, b.origin,
  (SELECT count(*) FROM booking_session x WHERE x.booking_id=b.booking_id) AS total_sessions
FROM booking_session s
JOIN booking b USING (booking_id)
JOIN venue v ON v.venue_id = s.venue_id
WHERE b.status IN ('APPROVED','COMPLETED') AND s.status <> 'NEEDS_RESCHEDULING';

CREATE VIEW v_coordinator_queue AS
  SELECT 'VENUE_BOOKING'::approval_subject AS tab, b.booking_id AS item_id,
         b.requested_by AS requesting_party, b.submitted_at
  FROM booking b WHERE b.status='PENDING'
UNION ALL
  SELECT 'BORROW_REQUEST'::approval_subject, br.borrow_request_id, br.requested_by, br.submitted_at
  FROM borrow_request br WHERE br.status='PENDING';
-- ERD v1.1 — corrective patch closing 8 defects found by adversarial testing.
-- Root cause of all 8: integrity enforced WITHIN tables but not ACROSS parent-child boundaries.

-- ============================================================================
-- DEFECT 1 (CRITICAL) — A-002: same physical article lent to two people at once.
-- Nothing prevented an article appearing in two ACTIVE transactions.
-- Fix: partial unique index over articles in open transactions.
-- ============================================================================
-- The predicate must be IMMUTABLE, so it cannot subquery borrow_transaction.
-- Denormalise the open/closed flag onto the child row, maintained by trigger.
ALTER TABLE borrow_transaction_article ADD COLUMN txn_open boolean NOT NULL DEFAULT true;

CREATE UNIQUE INDEX uq_article_single_open_lend
  ON borrow_transaction_article (article_id) WHERE txn_open;

-- keep txn_open in sync with the parent's status
CREATE FUNCTION fn_sync_txn_open() RETURNS trigger AS $$
BEGIN
  UPDATE borrow_transaction_article
     SET txn_open = (NEW.status IN ('ACTIVE','OVERDUE','INCOMPLETE'))
   WHERE borrow_txn_id = NEW.borrow_txn_id
     AND txn_open <> (NEW.status IN ('ACTIVE','OVERDUE','INCOMPLETE'));
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER tg_sync_txn_open AFTER UPDATE OF status ON borrow_transaction
  FOR EACH ROW EXECUTE FUNCTION fn_sync_txn_open();

-- set txn_open correctly at insert time based on parent status
CREATE FUNCTION fn_set_txn_open() RETURNS trigger AS $$
DECLARE st borrow_txn_status;
BEGIN
  SELECT status INTO st FROM borrow_transaction WHERE borrow_txn_id = NEW.borrow_txn_id;
  NEW.txn_open := (st IN ('ACTIVE','OVERDUE','INCOMPLETE'));
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER tg_set_txn_open BEFORE INSERT ON borrow_transaction_article
  FOR EACH ROW EXECUTE FUNCTION fn_set_txn_open();

-- ============================================================================
-- DEFECT 2 — A-003: DECOMMISSIONED / DAMAGED articles could be lent.
-- DEFECT 3 — A-004: article's equipment_type could differ from the transaction's.
-- Fix: one guard trigger on the link table.
-- ============================================================================
CREATE FUNCTION fn_lend_article_guard() RETURNS trigger AS $$
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
  IF a_state = 'UNPAIRED' THEN
    RAISE EXCEPTION 'INV-09: an unpaired article is unavailable for lending';
  END IF;
  IF a_type <> t_type THEN
    RAISE EXCEPTION 'BORROW-08: article type % does not match transaction type %', a_type, t_type;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER tg_lend_article_guard BEFORE INSERT ON borrow_transaction_article
  FOR EACH ROW EXECUTE FUNCTION fn_lend_article_guard();

-- ============================================================================
-- DEFECT 4 — A-005: platform txn lent a different equipment_type than requested.
-- DEFECT 5 — A-006: transaction created from a REJECTED / PENDING request.
-- DEFECT 6 — A-007: transaction lent to a different student than the requester.
-- Fix: one guard trigger on borrow_transaction (BORROW-07/09).
-- ============================================================================
CREATE FUNCTION fn_txn_request_guard() RETURNS trigger AS $$
DECLARE r_status borrow_request_status; r_by uuid; r_type int;
BEGIN
  IF NEW.borrow_request_id IS NULL THEN
    RETURN NEW;  -- walk-in path has no originating request
  END IF;
  SELECT status, requested_by, equipment_type_id INTO r_status, r_by, r_type
    FROM borrow_request WHERE borrow_request_id = NEW.borrow_request_id;

  IF r_status <> 'APPROVED' THEN
    RAISE EXCEPTION 'BORROW-07: cannot lend against a % request (must be APPROVED)', r_status;
  END IF;
  IF NEW.borrower_user_id <> r_by THEN
    RAISE EXCEPTION 'BORROW-09: borrower must be the student who submitted the request';
  END IF;
  IF NEW.equipment_type_id <> r_type THEN
    RAISE EXCEPTION 'BORROW-09: transaction type must match the requested equipment type';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER tg_txn_request_guard BEFORE INSERT OR UPDATE ON borrow_transaction
  FOR EACH ROW EXECUTE FUNCTION fn_txn_request_guard();

-- ============================================================================
-- DEFECT 7 (SERIOUS) — A-008: a session whose booking was REJECTED/CANCELLED stays
-- SCHEDULED and keeps occupying the exclusion index — an invisible ghost booking
-- that blocks the slot for everyone while showing on nobody's calendar.
-- Fix: cascade the parent's terminal state to its sessions (CAL-01).
-- ============================================================================
CREATE FUNCTION fn_cascade_booking_terminal() RETURNS trigger AS $$
BEGIN
  IF NEW.status IN ('REJECTED','CANCELLED') AND OLD.status NOT IN ('REJECTED','CANCELLED') THEN
    UPDATE booking_session
       SET status = 'CANCELLED',
           cancellation_reason = COALESCE(cancellation_reason,
             'Parent booking ' || NEW.status::text),
           cancelled_by = NEW.decided_by
     WHERE booking_id = NEW.booking_id
       AND status IN ('SCHEDULED','IN_PROGRESS','NEEDS_RESCHEDULING');
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER tg_cascade_booking_terminal AFTER UPDATE OF status ON booking
  FOR EACH ROW EXECUTE FUNCTION fn_cascade_booking_terminal();

-- A session may only be SCHEDULED if its parent is APPROVED (CAL-01)
CREATE FUNCTION fn_session_parent_guard() RETURNS trigger AS $$
DECLARE b_status booking_status;
BEGIN
  SELECT status INTO b_status FROM booking WHERE booking_id = NEW.booking_id;
  IF NEW.status IN ('SCHEDULED','IN_PROGRESS','COMPLETED')
     AND b_status NOT IN ('APPROVED','COMPLETED') THEN
    RAISE EXCEPTION 'CAL-01: session cannot hold a calendar slot while parent booking is %', b_status;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER tg_session_parent_guard BEFORE INSERT OR UPDATE ON booking_session
  FOR EACH ROW EXECUTE FUNCTION fn_session_parent_guard();

-- ============================================================================
-- DEFECT 8 (V1 RISK) — A-010: usage_history.sport_category_id could contradict
-- its own equipment_type_id. This is the denormalised column that V1 Phase A
-- demand prediction groups by — and history is IMMUTABLE, so a wrong value is
-- permanent and silently corrupts every future forecast.
-- Fix: derive it on write. Never trust the caller.
-- ============================================================================
CREATE FUNCTION fn_hist_derive_sport() RETURNS trigger AS $$
DECLARE derived smallint;
BEGIN
  IF NEW.equipment_type_id IS NOT NULL THEN
    SELECT sport_category_id INTO derived FROM equipment_type
      WHERE equipment_type_id = NEW.equipment_type_id;
    IF NEW.sport_category_id IS NOT NULL AND NEW.sport_category_id <> derived THEN
      RAISE EXCEPTION 'HIST-04: sport_category_id % contradicts equipment_type % (category %)',
        NEW.sport_category_id, NEW.equipment_type_id, derived;
    END IF;
    NEW.sport_category_id := derived;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER tg_hist_derive_sport BEFORE INSERT ON usage_history
  FOR EACH ROW EXECUTE FUNCTION fn_hist_derive_sport();

-- ============================================================================
-- DEFECT 9 — A-011: history written for a transaction still ACTIVE/OVERDUE.
-- HIST-03 is explicit that only terminal states enter history.
-- ============================================================================
CREATE FUNCTION fn_hist_terminal_guard() RETURNS trigger AS $$
DECLARE st text;
BEGIN
  IF NEW.kind = 'EQUIPMENT_BORROW' THEN
    SELECT status::text INTO st FROM borrow_transaction WHERE borrow_txn_id = NEW.borrow_txn_id;
    IF st NOT IN ('COMPLETED','COMPLETED_LATE','COMPLETED_DAMAGED') THEN
      RAISE EXCEPTION 'HIST-03: transaction is % — only terminal states enter Usage History', st;
    END IF;
  ELSE
    SELECT status::text INTO st FROM booking_session WHERE session_id = NEW.session_id;
    IF st NOT IN ('COMPLETED','CANCELLED') THEN
      RAISE EXCEPTION 'HIST-02: session is % — only terminal states enter Usage History', st;
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER tg_hist_terminal_guard BEFORE INSERT ON usage_history
  FOR EACH ROW EXECUTE FUNCTION fn_hist_terminal_guard();
-- ============================================================================
-- ERD v1.2 — Round 3 corrective patch (12 defects) + 2 ruled decisions.
--
-- Round 3 defect families (all new, none visible to Rounds 1-2):
--   FAMILY A — role legality was left entirely to application middleware
--   FAMILY B — usage_history could contradict the very row it describes
--   FAMILY C — swap integrity (state, self-swap, allocation coherence)
--   FAMILY D — pair coherence at lending time
--   FAMILY E — allocation vs. real stock
-- ============================================================================


-- ============================================================================
-- DECISION 1 — Guest borrow limits.
-- Ruling: BORROW-25 stands. Guest transactions remain unlinked; no unique key
-- on guest_borrower.id_number. Physical enforcement is the ID card (BORROW-06).
--
-- Applied as a documented, queryable control rather than a silent gap: the
-- Coordinator gets a view surfacing concurrent guest borrows sharing an ID
-- number, so the rule's trade-off is visible in the UI instead of invisible.
-- No constraint — that would BE the linkage BORROW-25 forbids.
-- ============================================================================
CREATE VIEW v_guest_concurrent_borrows AS
SELECT g.id_number,
       count(*)                       AS concurrent_open_borrows,
       array_agg(DISTINCT g.full_name) AS names_used,
       array_agg(bt.borrow_txn_id)     AS transactions
FROM borrow_transaction bt
JOIN guest_borrower g USING (guest_borrower_id)
WHERE bt.status IN ('ACTIVE','OVERDUE','INCOMPLETE')
GROUP BY g.id_number
HAVING count(*) > 1;

COMMENT ON VIEW v_guest_concurrent_borrows IS
  'BORROW-02 vs BORROW-25: guest transactions are deliberately unlinked (BORROW-25), '
  'so concurrent guest borrows cannot be blocked by constraint without creating the '
  'linkage that rule forbids. This view surfaces them for Coordinator judgement. '
  'Advisory only - never gates an action.';


-- ============================================================================
-- DECISION 2 — VENUE-07: is APPROVED an active state?
--
-- The rule contradicts itself:
--   "A client can have only one active venue booking request - pending,
--    forwarded, or approved - at a time."          <- lists APPROVED as active
--   "...until the current one reaches a terminal state (approved, rejected,
--    or completed)."                               <- calls APPROVED terminal
--
-- v1.0 took the first clause: APPROVED sat INSIDE the uniqueness index.
--
-- RECOMMENDED FIX (applied): keep APPROVED inside the index, but scope the
-- index to bookings that have not yet finished playing. Rationale:
--
--   * The first clause is the operative mechanism; the parenthetical is a gloss.
--   * The rule's PURPOSE is to stop a client hoarding venue slots. An approved-
--     but-unplayed booking still holds a slot, so excluding it would defeat
--     the rule entirely.
--   * But v1.0 was too strict: it trapped a client whose booking was approved
--     and fully played, because the parent only reaches COMPLETED when its LAST
--     session concludes (VENUE-33). A student who played their match on Monday
--     could not rebook until the tournament's final session ended weeks later.
--
-- The fix resolves the contradiction in the direction BOTH clauses agree on:
-- a booking stops being "active" once it no longer holds any future slot.
-- ============================================================================
DROP INDEX uq_one_active_booking;

-- Maintained flag: true while the booking still holds at least one un-played session.
ALTER TABLE booking ADD COLUMN holds_future_slot boolean NOT NULL DEFAULT true;

CREATE UNIQUE INDEX uq_one_active_booking
  ON booking (requested_by)
  WHERE status IN ('PENDING','FORWARDED','APPROVED')
    AND requested_by IS NOT NULL
    AND holds_future_slot;

CREATE FUNCTION fn_sync_holds_future_slot() RETURNS trigger AS $$
DECLARE bid uuid; remaining int;
BEGIN
  bid := COALESCE(NEW.booking_id, OLD.booking_id);
  SELECT count(*) INTO remaining FROM booking_session
   WHERE booking_id = bid
     AND status IN ('SCHEDULED','IN_PROGRESS','NEEDS_RESCHEDULING');
  UPDATE booking SET holds_future_slot = (remaining > 0)
   WHERE booking_id = bid AND holds_future_slot <> (remaining > 0);
  RETURN NULL;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER tg_sync_holds_future_slot
  AFTER INSERT OR UPDATE OF status OR DELETE ON booking_session
  FOR EACH ROW EXECUTE FUNCTION fn_sync_holds_future_slot();

COMMENT ON COLUMN booking.holds_future_slot IS
  'VENUE-07: true while any session remains SCHEDULED/IN_PROGRESS/NEEDS_RESCHEDULING. '
  'Scopes the one-active-booking index so a client is released once their bookings '
  'have finished playing, without letting them hoard un-played slots.';


-- ============================================================================
-- FAMILY A — ROLE LEGALITY (B-010, B-011, B-012)
--
-- Round 3 found: a STUDENT could approve their own borrow request
-- (requester=Ali Student | approver=Ali Student | status=APPROVED), and a
-- COORDINATOR could perform the final approval on a venue booking - directly
-- contradicting APPR-07 ("The Coordinator cannot grant final approval on any
-- item that requires Super Admin sign-off") and VENUE-19 ("The Super Admin is
-- the sole final approval authority").
--
-- v1.0/v1.1 left ALL role checks to Express middleware. One route that forgets
-- the check, and the database happily records an illegal approval permanently
-- in the audit trail. These are the rules' hardest authority guarantees; they
-- belong in the schema.
-- ============================================================================
CREATE FUNCTION fn_role_of(u uuid) RETURNS user_role AS $$
  SELECT role FROM app_user WHERE user_id = u;
$$ LANGUAGE sql STABLE;

-- BORROW-07/12: the Coordinator alone decides borrow requests.
CREATE FUNCTION fn_borrow_decider_guard() RETURNS trigger AS $$
BEGIN
  IF NEW.decided_by IS NOT NULL AND fn_role_of(NEW.decided_by) <> 'COORDINATOR' THEN
    RAISE EXCEPTION 'BORROW-07: only a COORDINATOR may decide a borrow request (got %)',
      fn_role_of(NEW.decided_by);
  END IF;
  IF NEW.decided_by IS NOT NULL AND NEW.decided_by = NEW.requested_by THEN
    RAISE EXCEPTION 'BORROW-07: a requester cannot decide their own borrow request';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER tg_borrow_decider BEFORE INSERT OR UPDATE ON borrow_request
  FOR EACH ROW EXECUTE FUNCTION fn_borrow_decider_guard();

-- VENUE-13/19, APPR-07: Coordinator forwards; Super Admin alone decides.
CREATE FUNCTION fn_booking_authority_guard() RETURNS trigger AS $$
BEGIN
  IF NEW.forwarded_by IS NOT NULL AND fn_role_of(NEW.forwarded_by) <> 'COORDINATOR' THEN
    RAISE EXCEPTION 'VENUE-13: only a COORDINATOR may forward a booking (got %)',
      fn_role_of(NEW.forwarded_by);
  END IF;
  IF NEW.decided_by IS NOT NULL AND fn_role_of(NEW.decided_by) <> 'SUPER_ADMIN' THEN
    RAISE EXCEPTION 'VENUE-19: only a SUPER_ADMIN may decide a booking (got %)',
      fn_role_of(NEW.decided_by);
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER tg_booking_authority BEFORE INSERT OR UPDATE ON booking
  FOR EACH ROW EXECUTE FUNCTION fn_booking_authority_guard();

-- APPR-07/16: every approval verb must be performed by a role permitted to perform it.
CREATE FUNCTION fn_approval_actor_guard() RETURNS trigger AS $$
DECLARE r user_role;
BEGIN
  IF NEW.actor_id IS NULL THEN RETURN NEW; END IF;
  r := fn_role_of(NEW.actor_id);

  IF NEW.verb = 'FORWARD' AND r <> 'COORDINATOR' THEN
    RAISE EXCEPTION 'APPR-07: only a COORDINATOR may FORWARD (got %)', r;
  END IF;

  IF NEW.verb IN ('APPROVE','RETURN_FOR_REEVALUATION') THEN
    IF NEW.subject = 'VENUE_BOOKING' AND r <> 'SUPER_ADMIN' THEN
      RAISE EXCEPTION 'VENUE-19/22: only a SUPER_ADMIN may % a venue booking (got %)', NEW.verb, r;
    END IF;
    IF NEW.subject = 'BORROW_REQUEST' AND r <> 'COORDINATOR' THEN
      RAISE EXCEPTION 'BORROW-07: only a COORDINATOR may % a borrow request (got %)', NEW.verb, r;
    END IF;
    IF NEW.subject IN ('ACCOUNT_VERIFICATION','EQUIPMENT_EXCEPTION') AND r <> 'SUPER_ADMIN' THEN
      RAISE EXCEPTION 'AUTH-04/EQUIP-AVAIL-17: only a SUPER_ADMIN may % a % (got %)',
        NEW.verb, NEW.subject, r;
    END IF;
  END IF;

  IF NEW.verb = 'REJECT' AND r NOT IN ('COORDINATOR','SUPER_ADMIN') THEN
    RAISE EXCEPTION 'APPR-06: only a COORDINATOR or SUPER_ADMIN may REJECT (got %)', r;
  END IF;

  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER tg_approval_actor BEFORE INSERT ON approval_action
  FOR EACH ROW EXECUTE FUNCTION fn_approval_actor_guard();

-- AUTH-04: only a Super Admin verifies accounts.
CREATE FUNCTION fn_verifier_guard() RETURNS trigger AS $$
BEGIN
  IF NEW.verified_by IS NOT NULL AND fn_role_of(NEW.verified_by) <> 'SUPER_ADMIN' THEN
    RAISE EXCEPTION 'AUTH-04: only a SUPER_ADMIN may verify an account (got %)',
      fn_role_of(NEW.verified_by);
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER tg_verifier BEFORE INSERT OR UPDATE ON app_user
  FOR EACH ROW EXECUTE FUNCTION fn_verifier_guard();

-- EQUIP-AVAIL-17: Coordinator requests exceptions; Super Admin decides them.
CREATE FUNCTION fn_exception_authority_guard() RETURNS trigger AS $$
BEGIN
  IF fn_role_of(NEW.requested_by) <> 'COORDINATOR' THEN
    RAISE EXCEPTION 'EQUIP-AVAIL-17: only a COORDINATOR may request an equipment exception (got %)',
      fn_role_of(NEW.requested_by);
  END IF;
  IF NEW.decided_by IS NOT NULL AND fn_role_of(NEW.decided_by) <> 'SUPER_ADMIN' THEN
    RAISE EXCEPTION 'EQUIP-AVAIL-17: only a SUPER_ADMIN may decide an equipment exception (got %)',
      fn_role_of(NEW.decided_by);
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER tg_exception_authority BEFORE INSERT OR UPDATE ON equipment_exception_request
  FOR EACH ROW EXECUTE FUNCTION fn_exception_authority_guard();

-- INV-01/16/23: inventory actions belong to staff only.
-- NOTE: one function per table. A single CASE over TG_TABLE_NAME fails because
-- PL/pgSQL resolves every branch's field reference against NEW regardless of
-- which branch is taken -- NEW.scanned_by does not exist on an article row.
CREATE FUNCTION fn_assert_staff(actor uuid, ctx text) RETURNS void AS $$
DECLARE r user_role;
BEGIN
  r := fn_role_of(actor);
  IF r NOT IN ('SUPER_ADMIN','COORDINATOR') THEN
    RAISE EXCEPTION 'INV/EQUIP: % requires SUPER_ADMIN or COORDINATOR (got %)', ctx, r;
  END IF;
END $$ LANGUAGE plpgsql STABLE;

CREATE FUNCTION fn_article_staff() RETURNS trigger AS $$
BEGIN PERFORM fn_assert_staff(NEW.entered_by, 'article entry'); RETURN NEW; END $$ LANGUAGE plpgsql;
CREATE TRIGGER tg_article_staff BEFORE INSERT ON article
  FOR EACH ROW EXECUTE FUNCTION fn_article_staff();

CREATE FUNCTION fn_scan_staff() RETURNS trigger AS $$
BEGIN PERFORM fn_assert_staff(NEW.scanned_by, 'health check scan'); RETURN NEW; END $$ LANGUAGE plpgsql;
CREATE TRIGGER tg_scan_staff BEFORE INSERT ON health_check_scan
  FOR EACH ROW EXECUTE FUNCTION fn_scan_staff();

CREATE FUNCTION fn_pair_staff() RETURNS trigger AS $$
BEGIN PERFORM fn_assert_staff(NEW.formed_by, 'article pairing'); RETURN NEW; END $$ LANGUAGE plpgsql;
CREATE TRIGGER tg_pair_staff BEFORE INSERT ON article_pair
  FOR EACH ROW EXECUTE FUNCTION fn_pair_staff();

-- EQUIP-AVAIL-14/15: only the Coordinator performs swaps (no Super Admin approval needed).
CREATE FUNCTION fn_swap_actor_guard() RETURNS trigger AS $$
BEGIN
  IF fn_role_of(NEW.performed_by) <> 'COORDINATOR' THEN
    RAISE EXCEPTION 'EQUIP-AVAIL-14: only a COORDINATOR may perform an article swap (got %)',
      fn_role_of(NEW.performed_by);
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER tg_swap_actor BEFORE INSERT ON article_swap
  FOR EACH ROW EXECUTE FUNCTION fn_swap_actor_guard();

-- BORROW-07: only the Coordinator hands equipment out.
CREATE FUNCTION fn_lent_by_guard() RETURNS trigger AS $$
BEGIN
  IF fn_role_of(NEW.lent_by) <> 'COORDINATOR' THEN
    RAISE EXCEPTION 'BORROW-07: only a COORDINATOR may lend equipment (got %)',
      fn_role_of(NEW.lent_by);
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER tg_lent_by BEFORE INSERT ON borrow_transaction
  FOR EACH ROW EXECUTE FUNCTION fn_lent_by_guard();


-- ============================================================================
-- FAMILY B — HISTORY COHERENCE (B-013, B-014, B-015)
--
-- Round 3 found history could contradict the very transaction it describes:
--   txn_says=COMPLETED_LATE | history_says=COMPLETED | reputation_late_count=0
--
-- That is BORROW-19 reputation - the feature explicitly ruled in - reading zero
-- late returns for a late return. And because HIST-05 makes history immutable,
-- the wrong value is PERMANENT.
--
-- Fix: derive every descriptive column from the source row. Never trust the
-- caller for anything that already exists elsewhere in the database.
-- ============================================================================
CREATE FUNCTION fn_hist_coherence_guard() RETURNS trigger AS $$
DECLARE
  t_status text; t_user uuid; t_guest uuid; t_type int;
  s_venue int; s_status text;
BEGIN
  IF NEW.kind = 'EQUIPMENT_BORROW' THEN
    SELECT status::text, borrower_user_id, guest_borrower_id, equipment_type_id
      INTO t_status, t_user, t_guest, t_type
      FROM borrow_transaction WHERE borrow_txn_id = NEW.borrow_txn_id;

    -- outcome must equal the transaction's actual terminal status
    IF NEW.outcome <> t_status THEN
      RAISE EXCEPTION 'HIST-04: history outcome % contradicts transaction status %',
        NEW.outcome, t_status;
    END IF;
    -- borrower identity must match, on whichever side of the XOR it lives
    IF NEW.actor_user_id IS DISTINCT FROM t_user THEN
      RAISE EXCEPTION 'HIST-04: history borrower does not match the transaction borrower';
    END IF;
    IF NEW.guest_borrower_id IS DISTINCT FROM t_guest THEN
      RAISE EXCEPTION 'HIST-04: history guest does not match the transaction guest';
    END IF;
    -- equipment type must match
    IF NEW.equipment_type_id IS DISTINCT FROM t_type THEN
      RAISE EXCEPTION 'HIST-04: history equipment type does not match the transaction';
    END IF;

  ELSE
    SELECT venue_id, status::text INTO s_venue, s_status
      FROM booking_session WHERE session_id = NEW.session_id;

    IF NEW.venue_id IS DISTINCT FROM s_venue THEN
      RAISE EXCEPTION 'HIST-04: history venue % contradicts session venue %',
        NEW.venue_id, s_venue;
    END IF;
    IF NEW.outcome <> s_status THEN
      RAISE EXCEPTION 'HIST-04: history outcome % contradicts session status %',
        NEW.outcome, s_status;
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER tg_hist_coherence BEFORE INSERT ON usage_history
  FOR EACH ROW EXECUTE FUNCTION fn_hist_coherence_guard();


-- ============================================================================
-- FAMILY C — SWAP INTEGRITY (B-005, B-006, B-007)
-- ============================================================================
ALTER TABLE article_swap
  ADD CONSTRAINT ck_swap_not_self CHECK (outgoing_article_id <> incoming_article_id);

CREATE FUNCTION fn_swap_integrity_guard() RETURNS trigger AS $$
DECLARE in_state article_state; in_type int; out_type int; alloc_type int;
BEGIN
  SELECT state, equipment_type_id INTO in_state, in_type
    FROM article WHERE article_id = NEW.incoming_article_id;
  SELECT equipment_type_id INTO out_type
    FROM article WHERE article_id = NEW.outgoing_article_id;
  SELECT equipment_type_id INTO alloc_type
    FROM event_equipment_allocation WHERE allocation_id = NEW.allocation_id;

  -- EQUIP-AVAIL-14: replacement must be an AVAILABLE unit
  IF in_state <> 'AVAILABLE' THEN
    RAISE EXCEPTION 'EQUIP-AVAIL-14: incoming article is % - a swap replaces an unavailable unit with an available one',
      in_state;
  END IF;
  -- swap must concern the allocation it is attached to
  IF out_type <> alloc_type THEN
    RAISE EXCEPTION 'EQUIP-AVAIL-14: outgoing article type % does not match allocation type %',
      out_type, alloc_type;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER tg_swap_integrity BEFORE INSERT ON article_swap
  FOR EACH ROW EXECUTE FUNCTION fn_swap_integrity_guard();


-- ============================================================================
-- FAMILY D — PAIR COHERENCE AT LENDING (B-001)
--
-- BORROW-04: "The Coordinator pairs any two available articles of the same
-- pair-type at the time of lending (ad-hoc pairing). Both articles are linked
-- under one borrow transaction."
-- INV-08: a paired article is managed as a single unit everywhere.
--
-- So the two articles on a PAIR transaction must either be a live article_pair,
-- or be explicitly flagged as an INV-11 temporary swap pair. v1.1 permitted any
-- two same-type articles.
-- ============================================================================
CREATE FUNCTION fn_pair_lending_coherence() RETURNS trigger AS $$
DECLARE lu lending_unit_type; txn uuid; n int; a1 uuid; a2 uuid; tmp_count int; live int;
BEGIN
  txn := COALESCE(NEW.borrow_txn_id, OLD.borrow_txn_id);
  SELECT et.lending_unit INTO lu FROM borrow_transaction bt
    JOIN equipment_type et USING (equipment_type_id) WHERE bt.borrow_txn_id = txn;
  IF lu <> 'PAIR' THEN RETURN NULL; END IF;

  SELECT count(*) INTO n FROM borrow_transaction_article WHERE borrow_txn_id = txn;
  IF n <> 2 THEN RETURN NULL; END IF;   -- BORROW-03 trigger reports the count error

  SELECT count(*) FILTER (WHERE is_temporary_swap) INTO tmp_count
    FROM borrow_transaction_article WHERE borrow_txn_id = txn;
  IF tmp_count = 2 THEN RETURN NULL; END IF;   -- INV-11 ad-hoc temporary pair: allowed

  -- NOTE: PostgreSQL has no min()/max() aggregate for uuid. Order explicitly.
  SELECT article_id INTO a1 FROM borrow_transaction_article
   WHERE borrow_txn_id = txn ORDER BY article_id ASC LIMIT 1;
  SELECT article_id INTO a2 FROM borrow_transaction_article
   WHERE borrow_txn_id = txn ORDER BY article_id DESC LIMIT 1;

  SELECT count(*) INTO live FROM article_pair
   WHERE dissolved_at IS NULL
     AND ((article_a_id = a1 AND article_b_id = a2)
       OR (article_a_id = a2 AND article_b_id = a1));

  IF live = 0 THEN
    RAISE EXCEPTION 'BORROW-04/INV-08: the two articles are not a live pair; mark both is_temporary_swap for an INV-11 ad-hoc pair';
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;
CREATE CONSTRAINT TRIGGER tg_pair_lending_coherence
  AFTER INSERT OR UPDATE ON borrow_transaction_article
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fn_pair_lending_coherence();


-- ============================================================================
-- FAMILY E — ALLOCATION VS REAL STOCK (B-004)
--
-- EQUIP-AVAIL-04 subtracts locked units from the available count. Allocating
-- more units than physically exist makes that count go negative and the whole
-- availability view meaningless.
-- ============================================================================
CREATE FUNCTION fn_allocation_stock_guard() RETURNS trigger AS $$
DECLARE stock int;
BEGIN
  SELECT count(*) INTO stock FROM article
   WHERE equipment_type_id = NEW.equipment_type_id
     AND state <> 'DECOMMISSIONED';
  IF NEW.quantity > stock THEN
    RAISE EXCEPTION 'EQUIP-AVAIL-04: cannot allocate % units - only % in stock for this type',
      NEW.quantity, stock;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER tg_allocation_stock BEFORE INSERT OR UPDATE ON event_equipment_allocation
  FOR EACH ROW EXECUTE FUNCTION fn_allocation_stock_guard();


-- ============================================================================
-- B-016 — damage_flag.source_scan_id must belong to the flagged article.
-- ============================================================================
CREATE FUNCTION fn_flag_scan_guard() RETURNS trigger AS $$
DECLARE scan_article uuid;
BEGIN
  IF NEW.source_scan_id IS NULL THEN RETURN NEW; END IF;
  SELECT article_id INTO scan_article FROM health_check_scan WHERE scan_id = NEW.source_scan_id;
  IF scan_article <> NEW.article_id THEN
    RAISE EXCEPTION 'INV-18: source scan belongs to a different article';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER tg_flag_scan BEFORE INSERT OR UPDATE ON damage_flag
  FOR EACH ROW EXECUTE FUNCTION fn_flag_scan_guard();
