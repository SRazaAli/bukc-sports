/**
 * Typed wrappers over the CV Equipment Health Check endpoints (/api/health-check).
 */
import { api } from '../../lib/api.js';

export type EquipmentKind = 'BASKETBALL' | 'FOOTBALL' | 'VOLLEYBALL';
export type CvLabel = 'GOOD' | 'FAIR' | 'POOR' | 'REPLACE';

export interface CandidateArticle {
  articleId: string;
  barcode: string;
  state: string;
  conditionLabel: 'GOOD' | 'WORN' | 'DAMAGED';
  equipmentTypeName: string;
  lastScore: number | null;
  lastCvLabel: CvLabel | null;
  lastScannedAt: string | null;
}

export interface ScanSummary {
  scanId: string;
  scannedAt: string;
  scanKind: 'AD_HOC' | 'SCHEDULED' | 'ENTRY';
  scannedByName: string;
  articleId: string;
  barcode: string;
  equipmentTypeName: string;
  equipmentKind: EquipmentKind;
  healthScore: number;
  cvLabel: CvLabel;
  anomalyPercent: number;
  severity: number;
  viewsCount: number;
  conditionLabel: 'GOOD' | 'WORN' | 'DAMAGED';
  modelVersion: string;
  confidence: number | null;
  processingMs: number | null;
}

export interface ScanDetail extends ScanSummary {
  heatmapImage: string;
  processedImage: string | null;
  perView: Array<{ index: number; health_score: number; anomaly_percent: number; severity: number; heatmap_image: string }>;
  warnings: string[];
}

export interface CvStatus {
  online: boolean;
  equipment_types?: Record<string, { ready: boolean }>;
}

export const getCvStatus = () => api<CvStatus>('/api/health-check/status');

export const listCandidateArticles = (kind: EquipmentKind) =>
  api<{ articles: CandidateArticle[] }>(`/api/health-check/articles?kind=${kind}`);

export const createScan = (body: {
  equipmentKind: EquipmentKind; articleId: string; scanKind: 'AD_HOC' | 'SCHEDULED'; images: string[];
}) => api<{ scan: ScanDetail }>('/api/health-check/scans', { method: 'POST', body });

export const listScans = (limit = 4, offset = 0) =>
  api<{ scans: ScanSummary[]; total: number }>(`/api/health-check/scans?limit=${limit}&offset=${offset}`);

export const getScan = (scanId: string) => api<{ scan: ScanDetail }>(`/api/health-check/scans/${scanId}`);

/**
 * Shrink a photo in the browser before upload (longest side ≤ 1600 px, JPEG 92%).
 * The CV service works at 1024 px anyway, so no useful detail is lost — and a
 * 6 MB phone photo becomes ~400 KB, which uploads quickly on campus Wi-Fi.
 */
export async function photoToDataUrl(file: Blob, maxSide = 1600): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('This file is not a readable JPG or PNG image.'));
      i.src = url;
    });
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not process the photo in this browser.');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.92);
  } finally {
    URL.revokeObjectURL(url);
  }
}
