/**
 * Redesigned Admin Dashboard — trend data (GET /api/dashboard-insights).
 * Read-only; complements the original GET /api/dashboard (./api.ts), which is unchanged.
 */
import { api } from '../../lib/api.js';

export type RangeDays = 7 | 30 | 90;

export interface PeriodKpi { current: number; previous: number; daily: number[] }

export interface DashboardInsights {
  range: { days: RangeDays; bucketDays: number; from: string; to: string; previousFrom: string; previousTo: string };
  kpis: {
    borrowRequests: PeriodKpi;
    venueBookings: PeriodKpi;
    equipmentUsage: PeriodKpi;
    equipmentItems: { total: number; available: number; addedCurrent: number; addedPrevious: number; daily: number[] };
    pending: { total: number; borrow: number; venue: number; forwarded: number; accounts: number | null; daily: number[] };
  };
  analytics: {
    labels: string[];
    borrowRequests: { current: number[]; previous: number[] };
    venueBookings: { current: number[]; previous: number[] };
    equipmentUsage: { current: number[]; previous: number[] };
  };
  health: {
    good: number; worn: number; damaged: number;
    averageScore: number | null; scannedArticles: number; openFlags: number;
    cvScansInPeriod: Partial<Record<'GOOD' | 'FAIR' | 'POOR' | 'REPLACE', number>>;
  };
  activity: Array<{ kind: string; title: string; detail: string; at: string }>;
  topSports: Array<{ sport: string; borrows: number; sessions: number }>;
  pending: Array<{ id: string; type: 'EQUIPMENT' | 'VENUE' | 'ACCOUNT'; requestedBy: string; item: string; status: string; at: string }>;
  upcoming: Array<{ start: string; end: string; title: string; venue: string; sport: string | null; bookingType: string | null }>;
}

export const getInsights = (days: RangeDays) => api<DashboardInsights>(`/api/dashboard-insights?days=${days}`);
