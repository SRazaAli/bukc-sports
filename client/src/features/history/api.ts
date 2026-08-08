import { api } from '../../lib/api.js';

export interface HistoryRow {
  historyId: number;
  kind: 'VENUE_SESSION' | 'EQUIPMENT_BORROW';
  occurredOn: string;
  recordedAt: string;
  outcome: string;
  // borrow
  borrowTxnId: string | null;
  equipmentTypeName: string | null;
  borrowerName: string | null;
  guestName: string | null;
  // venue
  sessionId: string | null;
  venueName: string | null;
  teamName: string | null;
  // shared
  sportCategoryName: string | null;
  enteredViaOfflineFallback: boolean;
}

export interface HistoryFilter {
  from?: string;
  to?: string;
  kind?: 'VENUE_SESSION' | 'EQUIPMENT_BORROW';
  outcome?: string;
  sportCategoryId?: number;
  actorUserId?: string;
  limit?: number;
  offset?: number;
}

export async function listHistory(filter: HistoryFilter = {}): Promise<{ history: HistoryRow[]; total: number }> {
  const params = new URLSearchParams();
  if (filter.from) params.set('from', filter.from);
  if (filter.to) params.set('to', filter.to);
  if (filter.kind) params.set('kind', filter.kind);
  if (filter.outcome) params.set('outcome', filter.outcome);
  if (filter.sportCategoryId != null) params.set('sportCategoryId', String(filter.sportCategoryId));
  if (filter.actorUserId) params.set('actorUserId', filter.actorUserId);
  if (filter.limit != null) params.set('limit', String(filter.limit));
  if (filter.offset != null) params.set('offset', String(filter.offset));
  const qs = params.toString();
  return api<{ history: HistoryRow[]; total: number }>(`/api/history${qs ? `?${qs}` : ''}`);
}

export async function completeSession(sessionId: string): Promise<void> {
  await api(`/api/venue/sessions/${sessionId}/complete`, { method: 'POST' });
}

export async function cancelSession(sessionId: string, reason: string): Promise<void> {
  await api(`/api/venue/sessions/${sessionId}/cancel`, { method: 'POST', body: { reason } });
}
