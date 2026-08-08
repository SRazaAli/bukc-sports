import { api } from '../../lib/api.js';

export interface KitItem {
  equipmentTypeId: number;
  name: string;
  lendingUnit: 'SINGLE' | 'PAIR';
  availableUnits: number;
  statusBadge: 'AVAILABLE' | 'LOW_STOCK' | 'CHECKED_OUT';
  imageUrl: string | null;
}

export interface KitPack {
  sportCategoryId: number;
  sportCategoryName: string;
  items: KitItem[];
  kitStatusBadge: 'AVAILABLE' | 'PARTIAL' | 'UNAVAILABLE';
  canRequestAll: boolean;
}

export const getKitPack = (sportCategoryId: number) =>
  api<{ kitPack: KitPack }>(`/api/availability/kit-pack/${sportCategoryId}`);

export const submitKitBorrowRequest = (input: {
  sportCategoryId: number;
  requestedStartAt: string;
  requestedReturnAt: string;
}) =>
  api<{ message: string; requestIds: string[] }>('/api/borrow/requests/kit', {
    method: 'POST',
    body: input,
  });
