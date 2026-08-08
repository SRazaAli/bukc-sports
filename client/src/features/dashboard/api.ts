/**
 * Dashboard API client (Feature 12).
 * Single GET /api/dashboard call; response shape differs by role (DASH-02/03).
 */
import { api } from '../../lib/api.js';

export interface UserManagementSummary {
  pendingVerification: number;
  activeStudents: number;
  activeExternal: number;
  activeCoordinators: number;
}

export interface ApprovalQueueSummary {
  pendingBorrowRequests: number;
  pendingVenueBookings: number;
  forwardedVenueBookings: number;
}

export interface BorrowRequestPreview {
  borrowRequestId: string;
  studentName: string;
  studentEmail: string;
  equipmentTypeName: string;
  requestedStartAt: string;
  requestedReturnAt: string;
  submittedAt: string;
}

export interface InventoryOverviewSummary {
  totalActiveTypes: number;
  totalArticles: number;
  articlesOnLoan: number;
  articlesDamaged: number;
  openDamageFlags: number;
  lowStockTypes: number;
}

export interface EquipmentHealthSummary {
  goodCondition: number;
  wornCondition: number;
  damagedCondition: number;
  openDamageFlags: number;
}

export interface ActiveBorrowsSummary {
  active: number;
  overdue: number;
  incomplete: number;
  dueSoonCount: number;
}

export interface UsageHistorySummary {
  totalRecords: number;
  equipmentBorrows: number;
  venueSessions: number;
  last30Days: number;
}

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

export type DashboardResponse =
  | { role: 'SUPER_ADMIN'; dashboard: SuperAdminDashboard }
  | { role: 'COORDINATOR'; dashboard: CoordinatorDashboard };

export const getDashboard = () => api<DashboardResponse>('/api/dashboard');
