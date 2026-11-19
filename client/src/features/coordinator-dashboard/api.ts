/**
 * Coordinator Dashboard API (/api/coordinator-dashboard) — equipment health
 * scans and inventory levels, plus the two CSV exports.
 */
import { api } from '../../lib/api.js';

export type StockLevel = 'LOW' | 'HIGH';
export type ScanStatus = 'UP_TO_DATE' | 'DUE' | 'NEVER';
export type Condition = 'GOOD' | 'WORN' | 'DAMAGED';

export interface StockRow {
  equipmentTypeId: number; name: string; sport: string; lendingUnit: 'SINGLE' | 'PAIR';
  totalArticles: number; stockUnits: number; availableUnits: number; onLoanUnits: number; damagedArticles: number;
  minimumStock: number; level: StockLevel; needed: number;
  good: number; worn: number; damaged: number;
}

export interface CoordinatorDashboard {
  generatedAt: string;
  scanFreshDays: number;
  kpis: {
    equipmentTypes: number; totalArticles: number; lowStockTypes: number; unitsNeeded: number;
    averageScore: number | null; scannedThisWeek: number; needsAttention: number; openFlags: number;
  };
  stock: StockRow[];
  condition: { good: number; worn: number; damaged: number };
  scanStatus: { upToDate: number; due: number; never: number };
  scoreBuckets: Array<{ label: string; from: number; to: number; count: number }>;
  scansPerDay: Array<{ day: string; manual: number; photo: number }>;
  weeklySession: { alertSentAt: string; totalDue: number; scanned: number; overdue: boolean; completedAt: string | null } | null;
  attention: Array<{
    articleId: string; barcode: string; equipmentName: string; currentCondition: Condition;
    lastScore: number | null; lastScanAt: string | null; scanStatus: ScanStatus; daysSinceScan: number | null; openFlag: boolean;
  }>;
}

export const getCoordinatorDashboard = () => api<CoordinatorDashboard>('/api/coordinator-dashboard');

type CsvFile = { filename: string; csv: string; rows: number };
export const exportInventoryCsv = () => api<CsvFile>('/api/coordinator-dashboard/export/inventory');
export const exportHealthScanCsv = () => api<CsvFile>('/api/coordinator-dashboard/export/health-scans');

/** Saves CSV text as a file the browser downloads (opens in Excel). */
export function saveCsv(file: CsvFile) {
  const blob = new Blob([file.csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = file.filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
