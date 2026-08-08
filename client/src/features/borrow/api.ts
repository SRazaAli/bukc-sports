import { api } from '../../lib/api.js';

export interface MyRequest {
  borrow_request_id: string; status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  requested_start_at: string; requested_return_at: string;
  rejection_reason: string | null; submitted_at: string; equipment_type_name: string;
}
export interface QueueItem {
  borrow_request_id: string; requested_start_at: string; requested_return_at: string; submitted_at: string;
  equipment_type_id: number; equipment_type_name: string;
  student_id: string; student_name: string; student_email: string;
  available_units: number; is_bad_sport: boolean;
}
export interface ActiveBorrow {
  borrow_txn_id: string; status: string; agreed_return_at: string; actual_start_at: string;
  equipment_type_name: string; borrower_name: string | null; guest_name: string | null;
}
export interface TxnDetail {
  borrow_txn_id: string; path: string; status: string;
  agreed_start_at: string; agreed_return_at: string; actual_start_at: string; actual_return_at: string | null;
  equipment_type_id: number; equipment_type_name: string; lending_unit: 'SINGLE' | 'PAIR';
  borrower_user_id: string | null; borrower_name: string | null; guest_name: string | null;
  articles: Array<{ article_id: string; barcode: string; returned_at: string | null; return_condition: string | null }>;
}
export interface Reputation {
  totalBorrows: number; lateReturns: number; damagedReturns: number; lastLateReturn: string | null; isBadSport: boolean;
}

// student
export const submitRequest = (input: { equipmentTypeId: number; requestedStartAt: string; requestedReturnAt: string }) =>
  api<{ request: { borrowRequestId: string } }>('/api/borrow/requests', { method: 'POST', body: input });
export const listMyRequests = () => api<{ requests: MyRequest[] }>('/api/borrow/requests/mine');

// coordinator
export const listQueue = () => api<{ queue: QueueItem[] }>('/api/borrow/queue');
export const approveRequest = (id: string) => api<{ message: string }>(`/api/borrow/requests/${id}/approve`, { method: 'POST', body: {} });
export const rejectRequest = (id: string, reason: string) =>
  api<{ message: string }>(`/api/borrow/requests/${id}/reject`, { method: 'POST', body: { reason } });

export const lendPlatform = (input: { borrowRequestId: string; articleIds: string[]; agreedStartAt: string; agreedReturnAt: string }) =>
  api<{ transaction: { borrowTxnId: string } }>('/api/borrow/lend/platform', { method: 'POST', body: input });
export const lendWalkinGuest = (input: {
  guestFullName: string; guestIdNumber: string; guestContactNumber: string; guestIsFaculty: boolean;
  equipmentTypeId: number; articleIds: string[]; agreedStartAt: string; agreedReturnAt: string;
}) => api<{ transaction: { borrowTxnId: string } }>('/api/borrow/lend/walkin/guest', { method: 'POST', body: input });

export const listActive = () => api<{ transactions: ActiveBorrow[] }>('/api/borrow/active');
export const getTransaction = (id: string) => api<TxnDetail>(`/api/borrow/${id}`);
export const returnArticles = (id: string, input: { articleIds: string[]; mode: 'scan' | 'manual' | 'dismiss'; score?: number; label?: string }) =>
  api<{ status: string; message: string }>(`/api/borrow/${id}/return`, { method: 'POST', body: input });
export const getReputation = (userId: string) => api<Reputation>(`/api/borrow/reputation/${userId}`);
