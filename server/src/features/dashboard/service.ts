/**
 * Dashboard service (Feature 12 — DASH-01/05/07).
 *
 * This file introduces NO new business logic.  Every function is a thin
 * aggregate read over tables already owned by Features 1–11.  Two roles can
 * reach this service: SUPER_ADMIN (full set) and COORDINATOR (operational
 * subset, per DASH-03).
 *
 * DASH-07: counts here and the counts in their full-detail views agree because
 * both read the same live tables at request time — no caching.
 */
import { db } from '../../db/index.js';
import { sql } from 'kysely';

// ── User-management panel (SUPER_ADMIN only — DASH-02) ──────────────────────

export interface UserManagementSummary {
  pendingVerification: number;
  activeStudents: number;
  activeExternal: number;
  activeCoordinators: number;
}

export async function getUserManagementSummary(): Promise<UserManagementSummary> {
  const [pending, students, externals, coordinators] = await Promise.all([
    db.selectFrom('app_user')
      .select(db.fn.countAll<number>().as('n'))
      .where('status', '=', 'PENDING_VERIFICATION')
      .where('role', 'in', ['STUDENT', 'EXTERNAL'])
      .executeTakeFirstOrThrow(),
    db.selectFrom('app_user')
      .select(db.fn.countAll<number>().as('n'))
      .where('status', '=', 'ACTIVE')
      .where('role', '=', 'STUDENT')
      .where('deleted_at', 'is', null)
      .executeTakeFirstOrThrow(),
    db.selectFrom('app_user')
      .select(db.fn.countAll<number>().as('n'))
      .where('status', '=', 'ACTIVE')
      .where('role', '=', 'EXTERNAL')
      .where('deleted_at', 'is', null)
      .executeTakeFirstOrThrow(),
    db.selectFrom('app_user')
      .select(db.fn.countAll<number>().as('n'))
      .where('status', '=', 'ACTIVE')
      .where('role', '=', 'COORDINATOR')
      .where('deleted_at', 'is', null)
      .executeTakeFirstOrThrow(),
  ]);

  return {
    pendingVerification: Number(pending.n),
    activeStudents: Number(students.n),
    activeExternal: Number(externals.n),
    activeCoordinators: Number(coordinators.n),
  };
}

// ── Approval-queue overview panel (both roles — DASH-02/03) ─────────────────

export interface ApprovalQueueSummary {
  /** Borrow requests pending a coordinator decision */
  pendingBorrowRequests: number;
  /** Venue bookings sitting in the coordinator queue (PENDING status) */
  pendingVenueBookings: number;
  /** Venue bookings forwarded to Super Admin (FORWARDED status) */
  forwardedVenueBookings: number;
}

export async function getApprovalQueueSummary(): Promise<ApprovalQueueSummary> {
  const [borrows, pendingBookings, forwardedBookings] = await Promise.all([
    db.selectFrom('borrow_request')
      .select(db.fn.countAll<number>().as('n'))
      .where('status', '=', 'PENDING')
      .executeTakeFirstOrThrow(),
    db.selectFrom('booking')
      .select(db.fn.countAll<number>().as('n'))
      .where('status', '=', 'PENDING')
      .executeTakeFirstOrThrow(),
    db.selectFrom('booking')
      .select(db.fn.countAll<number>().as('n'))
      .where('status', '=', 'FORWARDED')
      .executeTakeFirstOrThrow(),
  ]);

  return {
    pendingBorrowRequests: Number(borrows.n),
    pendingVenueBookings: Number(pendingBookings.n),
    forwardedVenueBookings: Number(forwardedBookings.n),
  };
}

// Top-5 borrow requests (oldest first) for the quick-action widget.
export interface BorrowRequestPreview {
  borrowRequestId: string;
  studentName: string;
  studentEmail: string;
  equipmentTypeName: string;
  requestedStartAt: Date;
  requestedReturnAt: Date;
  submittedAt: Date;
}

export async function getPendingBorrowPreviews(): Promise<BorrowRequestPreview[]> {
  const rows = await db.selectFrom('borrow_request as br')
    .innerJoin('equipment_type as et', 'et.equipment_type_id', 'br.equipment_type_id')
    .innerJoin('app_user as u', 'u.user_id', 'br.requested_by')
    .select([
      'br.borrow_request_id', 'u.full_name as student_name', 'u.email as student_email',
      'et.name as equipment_type_name',
      'br.requested_start_at', 'br.requested_return_at', 'br.submitted_at',
    ])
    .where('br.status', '=', 'PENDING')
    .orderBy('br.submitted_at', 'asc')
    .limit(5)
    .execute();

  return rows.map((r) => ({
    borrowRequestId: r.borrow_request_id,
    studentName: r.student_name,
    studentEmail: r.student_email,
    equipmentTypeName: r.equipment_type_name,
    requestedStartAt: r.requested_start_at as unknown as Date,
    requestedReturnAt: r.requested_return_at as unknown as Date,
    submittedAt: r.submitted_at as unknown as Date,
  }));
}

// ── Inventory overview panel (both roles — DASH-02/03) ──────────────────────

export interface InventoryOverviewSummary {
  totalActiveTypes: number;
  totalArticles: number;
  articlesOnLoan: number;
  articlesDamaged: number;
  openDamageFlags: number;
  lowStockTypes: number;
}

export async function getInventoryOverview(): Promise<InventoryOverviewSummary> {
  const [types, articles, onLoan, damaged, flags, lowStock] = await Promise.all([
    db.selectFrom('equipment_type')
      .select(db.fn.countAll<number>().as('n'))
      .where('is_active', '=', true)
      .executeTakeFirstOrThrow(),
    db.selectFrom('article')
      .select(db.fn.countAll<number>().as('n'))
      .where('state', '!=', 'DECOMMISSIONED')
      .executeTakeFirstOrThrow(),
    db.selectFrom('article')
      .select(db.fn.countAll<number>().as('n'))
      .where('state', '=', 'ON_LOAN')
      .executeTakeFirstOrThrow(),
    db.selectFrom('article')
      .select(db.fn.countAll<number>().as('n'))
      .where('state', '=', 'DAMAGED')
      .executeTakeFirstOrThrow(),
    db.selectFrom('damage_flag')
      .select(db.fn.countAll<number>().as('n'))
      .where('cleared_at', 'is', null)
      .executeTakeFirstOrThrow(),
    // Low-stock: available_units < low_stock_threshold — join to equipment_type
    // which holds the threshold since v_equipment_status_badge doesn't expose it.
    db.selectFrom('v_equipment_status_badge as v')
      .innerJoin('equipment_type as et', 'et.equipment_type_id', 'v.equipment_type_id')
      .select(db.fn.countAll<number>().as('n'))
      .where(sql<boolean>`v.available_units < et.low_stock_threshold`)
      .executeTakeFirstOrThrow(),
  ]);

  return {
    totalActiveTypes: Number(types.n),
    totalArticles: Number(articles.n),
    articlesOnLoan: Number(onLoan.n),
    articlesDamaged: Number(damaged.n),
    openDamageFlags: Number(flags.n),
    lowStockTypes: Number(lowStock.n),
  };
}

// ── Equipment health panel (both roles — DASH-02/03) ────────────────────────

export interface EquipmentHealthSummary {
  goodCondition: number;
  wornCondition: number;
  damagedCondition: number;
  openDamageFlags: number;
}

export async function getEquipmentHealthSummary(): Promise<EquipmentHealthSummary> {
  const [good, worn, damaged, flags] = await Promise.all([
    db.selectFrom('article')
      .select(db.fn.countAll<number>().as('n'))
      .where('current_condition_label', '=', 'GOOD')
      .where('state', '!=', 'DECOMMISSIONED')
      .executeTakeFirstOrThrow(),
    db.selectFrom('article')
      .select(db.fn.countAll<number>().as('n'))
      .where('current_condition_label', '=', 'WORN')
      .where('state', '!=', 'DECOMMISSIONED')
      .executeTakeFirstOrThrow(),
    db.selectFrom('article')
      .select(db.fn.countAll<number>().as('n'))
      .where('current_condition_label', '=', 'DAMAGED')
      .where('state', '!=', 'DECOMMISSIONED')
      .executeTakeFirstOrThrow(),
    db.selectFrom('damage_flag')
      .select(db.fn.countAll<number>().as('n'))
      .where('cleared_at', 'is', null)
      .executeTakeFirstOrThrow(),
  ]);

  return {
    goodCondition: Number(good.n),
    wornCondition: Number(worn.n),
    damagedCondition: Number(damaged.n),
    openDamageFlags: Number(flags.n),
  };
}

// ── Active borrows panel (both roles — DASH-02/03) ──────────────────────────

export interface ActiveBorrowsSummary {
  active: number;
  overdue: number;
  incomplete: number;
  dueSoonCount: number; // due within 24 hours
}

export async function getActiveBorrowsSummary(): Promise<ActiveBorrowsSummary> {
  const soon = new Date(Date.now() + 24 * 60 * 60 * 1000);

  const [active, overdue, incomplete, dueSoon] = await Promise.all([
    db.selectFrom('borrow_transaction')
      .select(db.fn.countAll<number>().as('n'))
      .where('status', '=', 'ACTIVE')
      .executeTakeFirstOrThrow(),
    db.selectFrom('borrow_transaction')
      .select(db.fn.countAll<number>().as('n'))
      .where('status', '=', 'OVERDUE')
      .executeTakeFirstOrThrow(),
    db.selectFrom('borrow_transaction')
      .select(db.fn.countAll<number>().as('n'))
      .where('status', '=', 'INCOMPLETE')
      .executeTakeFirstOrThrow(),
    db.selectFrom('borrow_transaction')
      .select(db.fn.countAll<number>().as('n'))
      .where('status', '=', 'ACTIVE')
      .where('agreed_return_at', '<=', soon)
      .executeTakeFirstOrThrow(),
  ]);

  return {
    active: Number(active.n),
    overdue: Number(overdue.n),
    incomplete: Number(incomplete.n),
    dueSoonCount: Number(dueSoon.n),
  };
}

// ── Usage history summary panel (both roles — DASH-02/03) ───────────────────

export interface UsageHistorySummary {
  totalRecords: number;
  equipmentBorrows: number;
  venueSessions: number;
  last30Days: number;
}

export async function getUsageHistorySummary(): Promise<UsageHistorySummary> {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const [total, borrows, sessions, recent] = await Promise.all([
    db.selectFrom('usage_history')
      .select(db.fn.countAll<number>().as('n'))
      .executeTakeFirstOrThrow(),
    db.selectFrom('usage_history')
      .select(db.fn.countAll<number>().as('n'))
      .where('kind', '=', 'EQUIPMENT_BORROW')
      .executeTakeFirstOrThrow(),
    db.selectFrom('usage_history')
      .select(db.fn.countAll<number>().as('n'))
      .where('kind', '=', 'VENUE_SESSION')
      .executeTakeFirstOrThrow(),
    db.selectFrom('usage_history')
      .select(db.fn.countAll<number>().as('n'))
      .where('occurred_on', '>=', cutoff)
      .executeTakeFirstOrThrow(),
  ]);

  return {
    totalRecords: Number(total.n),
    equipmentBorrows: Number(borrows.n),
    venueSessions: Number(sessions.n),
    last30Days: Number(recent.n),
  };
}

// ── Combined dashboard response ──────────────────────────────────────────────

export interface SuperAdminDashboard {
  userManagement: UserManagementSummary;
  approvalQueue: ApprovalQueueSummary;
  pendingBorrowPreviews: BorrowRequestPreview[];
  inventory: InventoryOverviewSummary;
  equipmentHealth: EquipmentHealthSummary;
  activeBorrows: ActiveBorrowsSummary;
  usageHistory: UsageHistorySummary;
}

export interface CoordinatorDashboard {
  approvalQueue: ApprovalQueueSummary;
  pendingBorrowPreviews: BorrowRequestPreview[];
  inventory: InventoryOverviewSummary;
  equipmentHealth: EquipmentHealthSummary;
  activeBorrows: ActiveBorrowsSummary;
  usageHistory: UsageHistorySummary;
}

// Run panel functions sequentially rather than via a single top-level
// Promise.all. Each panel function already fans out its own parallel queries
// internally; stacking seven of those in parallel at the top level blows past
// the connection pool ceiling on Neon's free-tier (~25 connections), causing
// "Connection terminated unexpectedly" under test load. Sequential panel
// execution stays well within the limit while each panel still benefits from
// its own internal parallelism.
export async function getSuperAdminDashboard(): Promise<SuperAdminDashboard> {
  const userManagement = await getUserManagementSummary();
  const approvalQueue = await getApprovalQueueSummary();
  const pendingBorrowPreviews = await getPendingBorrowPreviews();
  const inventory = await getInventoryOverview();
  const equipmentHealth = await getEquipmentHealthSummary();
  const activeBorrows = await getActiveBorrowsSummary();
  const usageHistory = await getUsageHistorySummary();

  return { userManagement, approvalQueue, pendingBorrowPreviews, inventory, equipmentHealth, activeBorrows, usageHistory };
}

export async function getCoordinatorDashboard(): Promise<CoordinatorDashboard> {
  const approvalQueue = await getApprovalQueueSummary();
  const pendingBorrowPreviews = await getPendingBorrowPreviews();
  const inventory = await getInventoryOverview();
  const equipmentHealth = await getEquipmentHealthSummary();
  const activeBorrows = await getActiveBorrowsSummary();
  const usageHistory = await getUsageHistorySummary();

  return { approvalQueue, pendingBorrowPreviews, inventory, equipmentHealth, activeBorrows, usageHistory };
}
