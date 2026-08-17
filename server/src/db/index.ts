/**
 * Kysely database instance + typed schema.
 *
 * Kysely does NOT own the schema — it never migrates or diffs. It's a typed
 * query builder over the schema our migrations already created, so it can't
 * fight the 41 triggers or the exclusion constraint. The DB remains the final
 * arbiter of every rule; these types just make our queries type-safe.
 *
 * Types are added per feature. This file starts with the identity domain that
 * Feature 1 (Auth) needs. Later features append their tables to `DB`.
 */
import { Kysely, PostgresDialect, type Generated, type ColumnType } from 'kysely';
import pg from 'pg';
import { config } from '../config/index.js';

// ── Enum unions mirroring the DB enums ──
export type UserRole = 'SUPER_ADMIN' | 'COORDINATOR' | 'STUDENT' | 'EXTERNAL';
export type UserStatus = 'PENDING_VERIFICATION' | 'ACTIVE' | 'DEACTIVATED';

// Convenience column helpers
type Timestamp = ColumnType<Date, Date | string, Date | string>;

// ── Tables (identity domain — Feature 1) ──
export interface AppUserTable {
  user_id: Generated<string>;
  role: UserRole;
  status: ColumnType<UserStatus, UserStatus | undefined, UserStatus>;
  full_name: string;
  email: string;
  contact_number: string;
  password_hash: string;
  failed_login_count: ColumnType<number, number | undefined, number>;
  locked_until: Timestamp | null;
  verified_by: string | null;
  verified_at: Timestamp | null;
  created_by: string | null;
  created_at: Generated<Timestamp>;
  deactivated_at: Timestamp | null;
  deactivated_until: Timestamp | null;
  deactivated_by: string | null;
  deleted_at: Timestamp | null;
  deleted_by: string | null;
  rejection_reason: string | null;
}

export interface StudentProfileTable {
  user_id: string;
  enrollment_no: string;
  department: string;
  program_title: string | null;
}

export interface ExternalProfileTable {
  user_id: string;
  institution_name: string;
  designation: string;
}

export interface RefreshTokenTable {
  token_id: Generated<string>;
  user_id: string;
  token_hash: string;
  issued_at: Generated<Timestamp>;
  expires_at: Timestamp;
  revoked_at: Timestamp | null;
}

export interface PasswordResetTokenTable {
  token_id: Generated<string>;
  user_id: string;
  token_hash: string;
  issued_at: Generated<Timestamp>;
  expires_at: ColumnType<Date, Date | string | undefined, Date | string>;
  used_at: Timestamp | null;
  purpose: ColumnType<'RESET' | 'CHANGE_CONFIRM', 'RESET' | 'CHANGE_CONFIRM' | undefined, 'RESET' | 'CHANGE_CONFIRM'>;
  failed_attempts: ColumnType<number, number | undefined, number>;
}

export interface LoginAttemptTable {
  attempt_id: Generated<number>;
  email_attempted: string;
  user_id: string | null;
  succeeded: boolean;
  attempted_at: Generated<Timestamp>;
  ip_address: string | null;
}

export interface PasswordResetAttemptTable {
  attempt_id: Generated<number>;
  email_attempted: string;
  ip_address: string | null;
  attempted_at: Generated<Timestamp>;
}

export interface SystemSettingTable {
  setting_key: string;
  setting_value: ColumnType<unknown, string, string>;
  updated_by: string | null;
  updated_at: Generated<Timestamp>;
}

export interface CoordinatorInviteTable {
  invite_id: Generated<string>;
  user_id: string;
  token_hash: string;
  invited_by: string;
  issued_at: Generated<Timestamp>;
  expires_at: Timestamp;
  accepted_at: Timestamp | null;
}

// ── The DB interface. Later features extend this. ──
// ── Inventory domain (Feature 4) ──
export type LendingUnitType = 'SINGLE' | 'PAIR';
export type ArticleState = 'AVAILABLE' | 'ON_LOAN' | 'DAMAGED' | 'DECOMMISSIONED';
export type ConditionLabel = 'GOOD' | 'WORN' | 'DAMAGED';
export type ScanKind = 'ENTRY' | 'SCHEDULED' | 'AD_HOC';
export type ScanSource = 'MANUAL' | 'CV_MODEL';

export interface SportCategoryTable {
  sport_category_id: Generated<number>;
  name: string;
  is_indoor: boolean;
  is_custom: ColumnType<boolean, boolean | undefined, boolean>;
  image_data: string | null;
}

export interface EquipmentItemPresetTable {
  preset_id: Generated<number>;
  sport_category_id: number;
  name: string;
  image_key: string;
  default_lending_unit: LendingUnitType;
}

export interface EquipmentTypeTable {
  equipment_type_id: Generated<number>;
  sport_category_id: number;
  name: string;
  lending_unit: LendingUnitType;
  low_stock_threshold: ColumnType<number, number | undefined, number>;
  max_borrow_duration_minutes: number;
  condition_good_min_score: ColumnType<string, number | string, number | string>;
  condition_worn_min_score: ColumnType<string, number | string, number | string>;
  is_indoor: ColumnType<boolean, boolean | undefined, boolean>;
  image_url: string | null;
  is_active: ColumnType<boolean, boolean | undefined, boolean>;
}

export interface ArticleTable {
  article_id: Generated<string>;
  equipment_type_id: number;
  barcode: string;
  state: ArticleState;
  current_condition_label: ConditionLabel;
  entered_by: string;
  entered_at: Generated<Timestamp>;
  decommissioned_by: string | null;
  decommissioned_at: Timestamp | null;
}

export interface ArticlePairTable {
  pair_id: Generated<string>;
  article_a_id: string;
  article_b_id: string;
  formed_by: string;
  formed_at: Generated<Timestamp>;
  dissolved_by: string | null;
  dissolved_at: Timestamp | null;
  dissolution_reason: string | null;
}

export interface HealthCheckScanTable {
  scan_id: Generated<string>;
  article_id: string;
  kind: ScanKind;
  source: ColumnType<ScanSource, ScanSource | undefined, ScanSource>;
  health_score: ColumnType<string, number | string, number | string>;
  resulting_label: ConditionLabel;
  scanned_by: string;
  scanned_at: Generated<Timestamp>;
  cv_model_version: string | null;
  cv_confidence: string | null;
  image_data: string | null;
}

export interface DamageFlagTable {
  flag_id: Generated<string>;
  article_id: string;
  raised_by: string | null;
  raised_by_system: ColumnType<boolean, boolean | undefined, boolean>;
  raised_at: Generated<Timestamp>;
  source_scan_id: string | null;
  cleared_by: string | null;
  cleared_at: Timestamp | null;
  cleared_with_label: ConditionLabel | null;
}

export interface VEquipmentStatusBadge {
  equipment_type_id: number;
  name: string;
  sport_category_id: number;
  available_units: number;
  status_badge: string;
}

export interface VArticleAvailability {
  equipment_type_id: number;
  name: string;
  sport_category_id: number;
  total_stock: string | number;
  on_loan: string | number;
  damaged: string | number;
  event_locked: string | number;
  available_units: string | number;
}

// ── Borrowing domain (Feature 3) ──
export type BorrowPath = 'PLATFORM' | 'WALK_IN';
export type BorrowRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'EXPIRED';
export type BorrowTxnStatus = 'ACTIVE' | 'OVERDUE' | 'INCOMPLETE' | 'COMPLETED' | 'COMPLETED_LATE' | 'COMPLETED_DAMAGED';
export type NotificationType =
  | 'ACCOUNT_VERIFIED' | 'BOOKING_APPROVED' | 'BOOKING_REJECTED' | 'BOOKING_CANCELLED'
  | 'BOOKING_POSTPONED' | 'BOOKING_RESCHEDULED' | 'EQUIPMENT_SHORTFALL'
  | 'BORROW_APPROVED' | 'BORROW_REJECTED' | 'BORROW_DUE_REMINDER' | 'BORROW_OVERDUE_CLIENT'
  | 'QUEUE_NEW_ITEM' | 'QUEUE_PENDING_REMINDER' | 'ITEM_FORWARDED' | 'ITEM_RETURNED_FOR_REEVAL'
  | 'ITEM_APPROVED_UPSTREAM' | 'ITEM_REJECTED_UPSTREAM' | 'BORROW_OVERDUE_COORDINATOR'
  | 'T24_LOCK_ALERT' | 'HEALTH_CHECK_DUE' | 'HEALTH_CHECK_OVERDUE' | 'POST_EVENT_REVIEW'
  | 'SWAP_PERFORMED' | 'SWAP_NOTICE_SUPERADMIN' | 'DAMAGE_FLAGGED' | 'INVENTORY_ACTION'
  | 'MULTISESSION_PROGRESS' | 'FALLBACK_ENTRY_MADE'
  | 'RETURN_CONDITION_UNVERIFIED' | 'BAD_SPORT_FLAGGED'
  | 'ACCOUNT_DEACTIVATED' | 'ACCOUNT_REACTIVATED'
  | 'BOOKING_SENT_BACK';

export interface BorrowRequestTable {
  borrow_request_id: Generated<string>;
  request_group_id: ColumnType<string, string | undefined, string>;
  requested_by: string;
  equipment_type_id: number;
  requested_start_at: Timestamp;
  requested_return_at: Timestamp;
  status: ColumnType<BorrowRequestStatus, BorrowRequestStatus | undefined, BorrowRequestStatus>;
  decided_by: string | null;
  decided_at: Timestamp | null;
  rejection_reason: string | null;
  submitted_at: Generated<Timestamp>;
}

export interface BorrowTransactionTable {
  borrow_txn_id: Generated<string>;
  path: BorrowPath;
  borrow_request_id: string | null;
  borrower_user_id: string | null;
  guest_borrower_id: string | null;
  equipment_type_id: number;
  agreed_start_at: Timestamp;
  agreed_return_at: Timestamp;
  actual_start_at: Generated<Timestamp>;
  actual_return_at: Timestamp | null;
  status: ColumnType<BorrowTxnStatus, BorrowTxnStatus | undefined, BorrowTxnStatus>;
  id_card_held: ColumnType<boolean, boolean | undefined, boolean>;
  id_card_returned_at: Timestamp | null;
  lent_by: string;
  entered_via_offline_fallback: ColumnType<boolean, boolean | undefined, boolean>;
}

export interface BorrowTransactionArticleTable {
  borrow_txn_id: string;
  article_id: string;
  pair_id: string | null;
  selection_method: string;
  returned_at: Timestamp | null;
  return_condition: ConditionLabel | null;
  is_temporary_swap: ColumnType<boolean, boolean | undefined, boolean>;
  txn_open: ColumnType<boolean, boolean | undefined, boolean>;
}

export interface GuestBorrowerTable {
  guest_borrower_id: Generated<string>;
  full_name: string;
  id_number: string;
  contact_number: string;
  is_faculty: ColumnType<boolean, boolean | undefined, boolean>;
}

export interface NotificationTable {
  notification_id: Generated<string>;
  recipient_id: string;
  type: NotificationType;
  title: string;
  body: string;
  booking_id: string | null;
  session_id: string | null;
  borrow_request_id: string | null;
  borrow_txn_id: string | null;
  article_id: string | null;
  allocation_id: string | null;
  exception_id: string | null;
  subject_user_id: string | null;
  created_at: Generated<Timestamp>;
  read_at: Timestamp | null;
  email_dispatched_at: Timestamp | null;
  email_suppressed: ColumnType<boolean, boolean | undefined, boolean>;
}

export interface VClientReputation {
  user_id: string;
  total_borrows: string | number;
  late_returns: string | number;
  damaged_returns: string | number;
  last_late_return: string | null;
}

export type HistoryKind = 'VENUE_SESSION' | 'EQUIPMENT_BORROW';

export interface UsageHistoryTable {
  history_id: Generated<number>;
  kind: HistoryKind;
  occurred_on: ColumnType<string, string, never>;
  recorded_at: Generated<Timestamp>;
  session_id: string | null;
  borrow_txn_id: string | null;
  actor_user_id: string | null;
  guest_borrower_id: string | null;
  venue_id: number | null;
  equipment_type_id: number | null;
  sport_category_id: number | null;
  outcome: string;
  snapshot: ColumnType<unknown, string, string>;
  entered_via_offline_fallback: ColumnType<boolean, boolean | undefined, boolean>;
}

// ── Venue booking domain (Feature 5) ──
export type BookingOrigin = 'CLIENT' | 'EXTERNAL' | 'ACADEMIC';
export type BookingStatus = 'PENDING' | 'FORWARDED' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'COMPLETED' | 'SHORTFALL_PENDING' | 'SENT_BACK';
export type SessionStatus = 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'NEEDS_RESCHEDULING' | 'CANCELLED';
export type ApprovalSubject = 'VENUE_BOOKING' | 'BORROW_REQUEST' | 'ACCOUNT_VERIFICATION' | 'EQUIPMENT_EXCEPTION';
export type ApprovalVerb = 'SUBMIT' | 'FORWARD' | 'APPROVE' | 'REJECT' | 'RETURN_FOR_REEVALUATION' | 'CANCEL' | 'SEND_BACK' | 'ACCEPT_SENT_BACK' | 'DECLINE_SENT_BACK';

export type VenueAvailabilityStatus = 'AVAILABLE' | 'UNDER_MAINTENANCE' | 'CLOSED';

export interface VenueTable {
  venue_id: Generated<number>;
  name: string;
  capacity: number;
  is_indoor: boolean;
  is_active: ColumnType<boolean, boolean | undefined, boolean>;
  availability_status: ColumnType<VenueAvailabilityStatus, VenueAvailabilityStatus | undefined, VenueAvailabilityStatus>;
  description: string | null;
  location: string | null;
  surface_type: string | null;
  photos: ColumnType<string[], string, string>; // jsonb — stored as JSON string, read as array
}

export interface VenueSportTable {
  venue_id: number;
  sport_category_id: number;
}

export type BookingEventType = 'INTER_UNIVERSITY' | 'INTERNAL';

export interface BookingTable {
  booking_id: Generated<string>;
  venue_id: number;
  origin: BookingOrigin;
  requested_by: string | null;
  internal_client_ref: string | null;
  purpose: string;
  estimated_participants: number;
  status: ColumnType<BookingStatus, BookingStatus | undefined, BookingStatus>;
  submitted_at: Generated<Timestamp>;
  forwarded_by: string | null;
  forwarded_at: Timestamp | null;
  feasibility_note: string | null;
  decided_by: string | null;
  decided_at: Timestamp | null;
  rejection_reason: string | null;
  self_managed_equipment: ColumnType<boolean, boolean | undefined, boolean>;
  entered_via_offline_fallback: ColumnType<boolean, boolean | undefined, boolean>;
  holds_future_slot: ColumnType<boolean, boolean | undefined, boolean>;
  booking_type: BookingEventType | null;
  booking_metadata: ColumnType<Record<string, unknown> | null, string | null, string | null>;
  // Migration 023: coordinator send-back workflow
  sent_back_note: string | null;
  sent_back_by: string | null;
  sent_back_at: Timestamp | null;
  coordinator_proposed_sessions: ColumnType<Array<{ sessionNo: number; startAt: string; endAt: string }> | null, string | null, string | null>;
  // Migration 026: coordinator article selections persist across send-back round-trips
  coordinator_selected_articles: ColumnType<Array<{ equipmentTypeId: number; articleIds: string[] }> | null, string | null, string | null>;
}

export interface BookingSessionRequestTable {
  request_session_id: Generated<string>;
  booking_id: string;
  session_no: number;
  requested_start_at: Timestamp;
  requested_end_at: Timestamp;
  team_name: string;
  participant_details: string | null;
}

export interface BookingSessionRequestEquipmentTable {
  allocation_request_id: Generated<string>;
  request_session_id: string;
  equipment_type_id: number;
  quantity: number;
  is_self_managed: ColumnType<boolean, boolean | undefined, boolean>;
  needs_shortfall_confirmation: ColumnType<boolean, boolean | undefined, boolean>;
  allocated_by: string;
}

export interface EventEquipmentAllocationTable {
  allocation_id: Generated<string>;
  session_id: string;
  equipment_type_id: number;
  quantity: number;
  allocated_by: string;
  allocated_at: Generated<Timestamp>;
  is_self_managed: ColumnType<boolean, boolean | undefined, boolean>;
  locked_at: Timestamp | null;
  released_at: Timestamp | null;
}

export interface ArticleSwapTable {
  swap_id: Generated<string>;
  allocation_id: string;
  outgoing_article_id: string;
  incoming_article_id: string;
  performed_by: string;
  performed_at: Generated<Timestamp>;
  reason: string | null;
}


export interface BookingSessionTable {
  session_id: Generated<string>;
  booking_id: string;
  session_no: number;
  venue_id: number;
  slot: ColumnType<string, string, never>; // tstzrange — written via sql`tstzrange(...)`
  status: ColumnType<SessionStatus, SessionStatus | undefined, SessionStatus>;
  reschedule_reason: string | null;
  cancellation_reason: string | null;
  cancelled_by: string | null;
  equipment_lock_at: Generated<Timestamp>;
}

export interface SessionParticipantTable {
  participant_id: Generated<string>;
  session_id: string;
  team_name: string;
  member_name: string;
  member_identifier: string | null;
  is_team_contact: ColumnType<boolean, boolean | undefined, boolean>;
}

export interface ApprovalActionTable {
  action_id: Generated<number>;
  subject: ApprovalSubject;
  verb: ApprovalVerb;
  booking_id: string | null;
  borrow_request_id: string | null;
  subject_user_id: string | null;
  exception_id: string | null;
  actor_id: string | null;
  note: string | null;
  occurred_at: Generated<Timestamp>;
}

export interface VCalendar {
  session_id: string;
  venue_id: number;
  venue_name: string;
  starts_at: Timestamp;
  ends_at: Timestamp;
  status: SessionStatus;
  session_no: number;
  booking_id: string;
  origin: BookingOrigin;
  total_sessions: string | number;
}

// ── Offline Fallback Audit (Feature 11) ──
export interface OfflineFallbackAuditTable {
  audit_id:         Generated<string>;
  entered_by:       string;
  entered_at:       Generated<Timestamp>;
  transaction_kind: 'BOOKING' | 'BORROW' | 'RETURN';
  booking_id:       string | null;
  borrow_txn_id:    string | null;
  note:             string | null;
}

// ── Inventory audit log (Feature 4 — INV-25) ──
export type ArticleAuditAction =
  | 'ARTICLE_ENTERED'
  | 'ARTICLE_DECOMMISSIONED'
  | 'TYPE_EDITED'
  | 'SCAN_RECORDED'
  | 'DAMAGE_FLAG_RAISED'
  | 'DAMAGE_FLAG_CLEARED'
  | 'CONDITION_OVERRIDDEN'
  | 'PAIR_FORMED'
  | 'PAIR_DISSOLVED';

export interface ArticleAuditLogTable {
  log_id:            Generated<string>;
  article_id:        string | null;
  equipment_type_id: number | null;
  action:            ArticleAuditAction;
  actor_id:          string;
  occurred_at:       Generated<Timestamp>;
  detail:            ColumnType<Record<string, unknown>, string, string>;
}

// ── Health check session (INV-15/28/29) ──
export interface HealthCheckSessionTable {
  session_id:          Generated<string>;
  alert_sent_at:       Generated<Timestamp>;
  total_articles_due:  number;
  scanned_count:       ColumnType<number, number | undefined, number>;
  overdue_notified_at: Timestamp | null;
  completed_at:        Timestamp | null;
}

export interface DB {
  app_user: AppUserTable;
  student_profile: StudentProfileTable;
  external_profile: ExternalProfileTable;
  refresh_token: RefreshTokenTable;
  password_reset_token: PasswordResetTokenTable;
  password_reset_attempt: PasswordResetAttemptTable;
  login_attempt: LoginAttemptTable;
  system_setting: SystemSettingTable;
  coordinator_invite: CoordinatorInviteTable;
  // inventory
  sport_category: SportCategoryTable;
  equipment_item_preset: EquipmentItemPresetTable;
  equipment_type: EquipmentTypeTable;
  article: ArticleTable;
  article_pair: ArticlePairTable;
  health_check_scan: HealthCheckScanTable;
  damage_flag: DamageFlagTable;
  v_equipment_status_badge: VEquipmentStatusBadge;
  v_article_availability: VArticleAvailability;
  // borrowing
  borrow_request: BorrowRequestTable;
  borrow_transaction: BorrowTransactionTable;
  borrow_transaction_article: BorrowTransactionArticleTable;
  guest_borrower: GuestBorrowerTable;
  notification: NotificationTable;
  v_client_reputation: VClientReputation;
  usage_history: UsageHistoryTable;
  // venue booking
  venue: VenueTable;
  venue_sport: VenueSportTable;
  booking: BookingTable;
  booking_session_request: BookingSessionRequestTable;
  booking_session_request_equipment: BookingSessionRequestEquipmentTable;
  event_equipment_allocation: EventEquipmentAllocationTable;
  article_swap: ArticleSwapTable;
  booking_session: BookingSessionTable;
  session_participant: SessionParticipantTable;
  approval_action: ApprovalActionTable;
  v_calendar: VCalendar;
  // offline fallback
  offline_fallback_audit: OfflineFallbackAuditTable;
  // inventory audit + health check sessions (Feature 4 — INV-25/28/29)
  article_audit_log: ArticleAuditLogTable;
  health_check_session: HealthCheckSessionTable;
}

const { Pool } = pg;

export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  // Neon requires SSL in production; local docker does not.
  ssl: config.DATABASE_URL.includes('neon.tech') ? { rejectUnauthorized: false } : undefined,
});

export const db = new Kysely<DB>({
  dialect: new PostgresDialect({ pool }),
});

/**
 * Postgres error codes we translate into domain responses. The DB triggers raise
 * with rule tags in the message (e.g. 'AUTH-13: ...'); '23P01' is the exclusion
 * constraint (conflict detection), '23505' unique violation, 'P0001' a raise
 * from a trigger. Feature services map these to HTTP status + user-facing text.
 */
export const PG_ERRORS = {
  UNIQUE_VIOLATION: '23505',
  EXCLUSION_VIOLATION: '23P01',
  CHECK_VIOLATION: '23514',
  FOREIGN_KEY_VIOLATION: '23503',
  RAISE_EXCEPTION: 'P0001', // trigger RAISE
} as const;

export function isPgError(e: unknown): e is { code: string; message: string; constraint?: string } {
  return typeof e === 'object' && e !== null && 'code' in e;
}
