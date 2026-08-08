import { api } from '../../lib/api.js';

// ── Input types ──

export interface FallbackBookingInput {
  venueId: number;
  purpose: string;
  estimatedParticipants: number;
  sessionStartAt: string;
  sessionEndAt: string;
  teamName: string;
  participantDetails?: string;
  note?: string;
}

interface FallbackBorrowBase {
  equipmentTypeId: number;
  articleIds: string[];
  agreedStartAt: string;
  agreedReturnAt: string;
  note?: string;
}

export interface FallbackBorrowRegisteredInput extends FallbackBorrowBase {
  borrowerKind: 'REGISTERED';
  enrollmentNo: string;
}

export interface FallbackBorrowGuestInput extends FallbackBorrowBase {
  borrowerKind: 'GUEST';
  guestFullName: string;
  guestIdNumber: string;
  guestContactNumber: string;
}

export type FallbackBorrowInput = FallbackBorrowRegisteredInput | FallbackBorrowGuestInput;

export interface FallbackReturnInput {
  borrowTxnId: string;
  articleIds: string[];
  returnedAt: string;
  condition: 'GOOD' | 'WORN' | 'DAMAGED';
  note?: string;
}

// ── Response types ──

export interface AuditEntry {
  audit_id:        string;
  entered_at:      string;
  transaction_kind: 'BOOKING' | 'BORROW' | 'RETURN';
  booking_id:      string | null;
  borrow_txn_id:   string | null;
  note:            string | null;
  entered_by_name: string;
  entered_by_role: string;
}

// ── API calls ──

export const enterFallbackBooking = (input: FallbackBookingInput) =>
  api<{ message: string; bookingId: string; sessionId: string }>(
    '/api/offline/booking', { method: 'POST', body: input },
  );

export const enterFallbackBorrow = (input: FallbackBorrowInput) =>
  api<{ message: string; borrowTxnId: string }>(
    '/api/offline/borrow', { method: 'POST', body: input },
  );

export const enterFallbackReturn = (input: FallbackReturnInput) =>
  api<{ message: string; borrowTxnId: string; status: string }>(
    '/api/offline/return', { method: 'POST', body: input },
  );

export const getAuditLog = (params?: { from?: string; to?: string }) => {
  const qs = new URLSearchParams();
  if (params?.from) qs.set('from', params.from);
  if (params?.to)   qs.set('to',   params.to);
  const suffix = qs.toString() ? `?${qs}` : '';
  return api<{ entries: AuditEntry[] }>(`/api/offline/audit${suffix}`);
};
