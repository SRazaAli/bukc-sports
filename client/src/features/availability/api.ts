/**
 * Availability API client. `subscribeAvailability` opens the real SSE stream;
 * the access token travels as a query param since native EventSource can't
 * set an Authorization header (see server requireAuthSSE for the matching side).
 */
import { api, getAccessToken } from '../../lib/api.js';

export type StatusBadge = 'AVAILABLE' | 'LOW_STOCK' | 'CHECKED_OUT';

export interface AvailabilityRow {
  equipmentTypeId: number;
  name: string;
  sportCategoryId: number;
  sportCategoryName: string;
  isIndoor: boolean;
  imageUrl: string | null;
  lendingUnit: 'SINGLE' | 'PAIR';
  availableUnits: number;
  statusBadge: StatusBadge;
  totalStock?: number; // present for SUPER_ADMIN / COORDINATOR only
}

export interface AvailabilityFilter {
  sportCategoryId?: number;
  equipmentTypeId?: number;
  isIndoor?: boolean;
}

export function listAvailability(filter: AvailabilityFilter = {}) {
  const q = new URLSearchParams();
  if (filter.sportCategoryId) q.set('sportCategoryId', String(filter.sportCategoryId));
  if (filter.equipmentTypeId) q.set('equipmentTypeId', String(filter.equipmentTypeId));
  if (filter.isIndoor !== undefined) q.set('isIndoor', String(filter.isIndoor));
  const qs = q.toString();
  return api<{ status: AvailabilityRow[] }>(`/api/availability/status${qs ? `?${qs}` : ''}`);
}

/**
 * Opens the SSE stream and calls `onSnapshot` every time the server pushes an
 * updated status list (on connect, and again whenever equipment changes).
 * Returns a cleanup function to close the connection.
 */
export function subscribeAvailability(onSnapshot: (rows: AvailabilityRow[]) => void): () => void {
  const token = getAccessToken();
  if (!token) return () => {};

  const base = import.meta.env.VITE_API_BASE ?? '';
  const source = new EventSource(`${base}/api/availability/stream?token=${encodeURIComponent(token)}`);

  source.addEventListener('snapshot', (e) => {
    try {
      onSnapshot(JSON.parse((e as MessageEvent).data));
    } catch {
      /* ignore malformed frame */
    }
  });

  // EventSource auto-reconnects on its own after a transient drop; nothing
  // extra to do here beyond closing it when the component unmounts.
  return () => source.close();
}
