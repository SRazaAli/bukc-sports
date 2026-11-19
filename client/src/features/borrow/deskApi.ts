/**
 * Borrow desk API (/api/borrow-desk) — collection on the requested day with a
 * university-card check, borrow history, live active borrows, sidebar badges.
 * The original borrow API (./api.ts) is unchanged.
 */
import { api } from '../../lib/api.js';

export interface ReadyGroup {
  groupId: string; studentId: string; studentName: string; studentEmail: string;
  enrollmentNo: string | null; department: string | null; approvedAt: string | null;
  startAt: string; returnAt: string;
  items: Array<{ borrowRequestId: string; equipmentTypeId: number; equipmentTypeName: string; lendingUnit: 'SINGLE' | 'PAIR'; availableUnits: number }>;
  lendable: boolean; reason: 'TOO_EARLY' | 'WINDOW_PASSED' | 'WEEKEND' | null; message: string | null;
}
export interface DeskOverview { ready: ReadyGroup[]; pendingEnrollments: Record<string, string | null>; now: string }

export interface ActiveLoan {
  borrow_txn_id: string; status: 'ACTIVE' | 'OVERDUE' | 'INCOMPLETE'; path: string;
  agreed_start_at: string; agreed_return_at: string; actual_start_at: string;
  equipment_type_name: string; borrower_user_id: string | null; borrower_name: string | null; borrower_email: string | null;
  enrollment_no: string | null; department: string | null; guest_name: string | null; guest_id_number: string | null;
  barcodes: string | null; lent_by_name: string | null;
}

export type HistoryStage =
  | 'PENDING' | 'READY_TO_COLLECT' | 'NOT_COLLECTED' | 'ON_LOAN' | 'OVERDUE' | 'PARTLY_RETURNED'
  | 'RETURNED' | 'RETURNED_EARLY' | 'RETURNED_LATE' | 'REJECTED' | 'CANCELLED' | 'EXPIRED';
export interface HistoryRow {
  borrow_request_id: string; request_group_id: string; status: string; stage: HistoryStage;
  requested_start_at: string; requested_return_at: string; submitted_at: string; decided_at: string | null;
  rejection_reason: string | null; equipment_type_name: string;
  txn_status: string | null; actual_start_at: string | null; agreed_return_at: string | null; actual_return_at: string | null; barcodes: string | null;
}
export interface LateLoan { borrow_txn_id: string; equipment_type_name: string; agreed_return_at: string; barcodes: string | null }

/** Borrow Queue "On loan": lent, waiting for the Coordinator to press Submitted. */
export interface OnLoanGroup {
  key: string; txnIds: string[]; borrowerName: string; borrowerEmail: string | null; enrollmentNo: string | null;
  department: string | null; isGuest: boolean; guestIdNumber: string | null; path: string;
  startAt: string; returnAt: string; items: Array<{ equipmentTypeName: string; barcodes: string | null }>;
  overdue: boolean; windowEnded: boolean;
}
export const listOnLoan = () => api<{ loans: OnLoanGroup[]; now: string }>('/api/borrow-desk/on-loan');
export const markSubmitted = (txnIds: string[]) =>
  api<{ outcome: 'COMPLETED' | 'COMPLETED_EARLY' | 'COMPLETED_LATE' | 'COMPLETED_DAMAGED'; transactions: Array<{ borrowTxnId: string; status: string }> }>(
    '/api/borrow-desk/submitted', { method: 'POST', body: { txnIds } });

export const getBadges = () => api<{ borrowQueue?: number; myBorrowRequests?: number; equipmentAlerts?: number }>('/api/borrow-desk/badges');
export const getDeskOverview = () => api<DeskOverview>('/api/borrow-desk/overview');
export const lendWithCard = (groupId: string, body: { idCardEnrollmentNo: string; articlesPerType: Record<number, string[]> }) =>
  api<{ transactions: string[] }>(`/api/borrow-desk/groups/${groupId}/lend`, { method: 'POST', body });
export const listActiveDetailed = () => api<{ transactions: ActiveLoan[]; now: string }>('/api/borrow-desk/active');
export const getMyHistory = () => api<{ requests: HistoryRow[]; now: string }>('/api/borrow-desk/mine/history');
export const markApprovalsSeen = () => api<{ ok: boolean }>('/api/borrow-desk/mine/seen', { method: 'POST', body: {} });
export const getMyLateLoans = () => api<{ late: LateLoan[]; now: string }>('/api/borrow-desk/mine/late');

/** Fire after anything that changes a badge count, so the sidebar refreshes at once. */
export const BORROW_BADGES_CHANGED = 'bukc:borrow-badges-changed';
export function notifyBorrowBadgesChanged() {
  window.dispatchEvent(new Event(BORROW_BADGES_CHANGED));
}

/** "22-123456-789" from whatever the coordinator typed. */
export function normalizeEnrollment(v: string): string {
  const d = v.replace(/\D/g, '');
  return d.length === 11 ? `${d.slice(0, 2)}-${d.slice(2, 8)}-${d.slice(8)}` : v.trim();
}

/** "1h 05m" / "12m" / "40s" */
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

/**
 * Same rule as the server (returnOutcome.ts): back after the window → Late;
 * in the last 10 minutes → Completed; earlier → Completed — Earlier.
 */
export const ON_TIME_BAND_MINUTES = 10;
export function previewOutcome(returnAt: string, now = Date.now()): 'COMPLETED' | 'COMPLETED_EARLY' | 'COMPLETED_LATE' {
  const end = new Date(returnAt).getTime();
  if (now > end) return 'COMPLETED_LATE';
  if (now < end - ON_TIME_BAND_MINUTES * 60_000) return 'COMPLETED_EARLY';
  return 'COMPLETED';
}
export const OUTCOME_LABEL: Record<string, string> = {
  COMPLETED: 'Completed', COMPLETED_EARLY: 'Completed — Earlier', COMPLETED_LATE: 'Completed — Late', COMPLETED_DAMAGED: 'Completed — Damaged',
};
