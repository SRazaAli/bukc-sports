/**
 * Typed wrappers over the inventory endpoints (Feature 4).
 */
import { api } from '../../lib/api.js';

export interface SportCategory { sport_category_id: number; name: string; is_indoor: boolean; is_custom: boolean; image_data: string | null }

export interface ItemPreset {
  preset_id: number; sport_category_id: number; name: string; image_key: string;
  default_lending_unit: 'SINGLE' | 'PAIR';
}

export interface EquipmentType {
  equipment_type_id: number;
  name: string;
  lending_unit: 'SINGLE' | 'PAIR';
  low_stock_threshold: number;
  max_borrow_duration_minutes: number;
  condition_good_min_score: string;
  condition_worn_min_score: string;
  sport_category_id: number;
  sport_category_name: string;
  is_indoor: boolean;
  image_url: string | null;
}

export type ArticleState = 'AVAILABLE' | 'ON_LOAN' | 'DAMAGED' | 'DECOMMISSIONED';
export type ConditionLabel = 'GOOD' | 'WORN' | 'DAMAGED';

// UI-facing label for ArticleState — DAMAGED is shown as "UNAVAILABLE" so it
// never reads alongside an identical DAMAGED condition (redundant/confusing).
export const STATE_LABEL: Record<ArticleState, string> = {
  AVAILABLE: 'Available', ON_LOAN: 'On Loan',
  DAMAGED: 'Unavailable', DECOMMISSIONED: 'Decommissioned',
};

export interface Article {
  article_id: string;
  barcode: string;
  state: ArticleState;
  current_condition_label: ConditionLabel;
  equipment_type_id: number;
  equipment_type_name: string;
  lending_unit: 'SINGLE' | 'PAIR';
  entered_at: string;
  pair_id: string | null;
  article_a_id: string | null;
  article_b_id: string | null;
}

export interface StatusRow {
  equipment_type_id: number;
  name: string;
  sport_category_id: number;
  available_units: number;
  status_badge: 'AVAILABLE' | 'LOW_STOCK' | 'CHECKED_OUT';
}

export interface DamageFlag {
  flag_id: string;
  article_id: string;
  barcode: string;
  equipment_type_name: string;
  raised_by_system: boolean;
  raised_at: string;
}

export const listSportCategories = () =>
  api<{ categories: SportCategory[] }>('/api/inventory/sport-categories');

export const createSportCategory = (input: { name: string; isIndoor: boolean; imageData?: string }) =>
  api<{ category: { sport_category_id: number; name: string } }>('/api/inventory/sport-categories', { method: 'POST', body: input });

export const listItemPresets = (sportCategoryId?: number) => {
  const qs = sportCategoryId ? `?sportCategoryId=${sportCategoryId}` : '';
  return api<{ presets: ItemPreset[] }>(`/api/inventory/item-presets${qs}`);
};

export const listTypes = () => api<{ types: EquipmentType[] }>('/api/inventory/types');

export const createType = (input: {
  sportCategoryId: number; name: string; lendingUnit: 'SINGLE' | 'PAIR';
  lowStockThreshold: number; maxBorrowDurationMinutes: number;
  conditionGoodMinScore: number; conditionWornMinScore: number;
  isIndoor: boolean; imageUrl?: string;
}) => api<{ type: { equipmentTypeId: number; name: string } }>('/api/inventory/types', { method: 'POST', body: input });

export const updateThresholds = (id: number, input: { lowStockThreshold?: number; maxBorrowDurationMinutes?: number }) =>
  api<{ message: string }>(`/api/inventory/types/${id}/thresholds`, { method: 'PATCH', body: input });

// Full edit of an existing type (name, indoor flag, thresholds, condition bands, image).
export const updateType = (id: number, input: {
  name?: string; isIndoor?: boolean; lowStockThreshold?: number;
  maxBorrowDurationMinutes?: number; conditionGoodMinScore?: number;
  conditionWornMinScore?: number; imageUrl?: string;
}) => api<{ message: string }>(`/api/inventory/types/${id}`, { method: 'PATCH', body: input });

export const deleteType = (id: number) =>
  api<{ message: string }>(`/api/inventory/types/${id}`, { method: 'DELETE' });

export const listStatus = () => api<{ status: StatusRow[] }>('/api/inventory/status');

export const listArticles = (params?: { equipmentTypeId?: number; state?: ArticleState; condition?: ConditionLabel }) => {
  const q = new URLSearchParams();
  if (params?.equipmentTypeId) q.set('equipmentTypeId', String(params.equipmentTypeId));
  if (params?.state) q.set('state', params.state);
  if (params?.condition) q.set('condition', params.condition);
  const qs = q.toString();
  return api<{ articles: Article[] }>(`/api/inventory/articles${qs ? `?${qs}` : ''}`);
};

export const addArticle = (input: { equipmentTypeId: number; barcode: string; entryScore: number; imageData?: string }) =>
  api<{ article: { articleId: string; barcode: string; conditionLabel: ConditionLabel; state: ArticleState } }>(
    '/api/inventory/articles', { method: 'POST', body: input });

// Pair-type articles always enter as a pair in one action (both barcodes
// together) regardless of their individual scores.
export const addArticlePair = (input: {
  equipmentTypeId: number; barcodeA: string; barcodeB: string; entryScoreA: number; entryScoreB: number;
  imageDataA?: string; imageDataB?: string;
}) => api<{ pairEntry: {
  articleIdA: string; articleIdB: string; barcodeA: string; barcodeB: string;
  conditionLabelA: ConditionLabel; conditionLabelB: ConditionLabel; state: ArticleState;
} }>('/api/inventory/articles/pair', { method: 'POST', body: input });

export const getArticle = (id: string) => api<{
  article: Article & { decommissioned_at: string | null };
  scans: Array<{ scan_id: string; kind: string; source: string; health_score: string; resulting_label: ConditionLabel; scanned_at: string }>;
  flags: Array<{ flag_id: string; raised_by_system: boolean; raised_at: string; cleared_at: string | null; cleared_with_label: ConditionLabel | null }>;
  pairs: Array<{ pair_id: string; article_a_id: string; article_b_id: string; formed_at: string; dissolved_at: string | null }>;
}>(`/api/inventory/articles/${id}`);

// Decommissioning one half of a pair decommissions both halves.
export const decommissionArticle = (id: string) =>
  api<{ message: string }>(`/api/inventory/articles/${id}/decommission`, { method: 'POST', body: {} });

export const scanArticle = (id: string, input: { kind: 'SCHEDULED' | 'AD_HOC'; score: number; imageData?: string }) =>
  api<{ conditionLabel: ConditionLabel; message: string }>(`/api/inventory/articles/${id}/scan`, { method: 'POST', body: input });

export const overrideCondition = (id: string, label: ConditionLabel) =>
  api<{ message: string }>(`/api/inventory/articles/${id}/condition`, { method: 'POST', body: { label } });

export const listDamageFlags = () => api<{ flags: DamageFlag[] }>('/api/inventory/damage-flags');

// Clearing a flag now takes a fresh health score — the label is derived from
// it via the article's type thresholds, same as any other scan.
export const clearDamageFlag = (id: string, input: { score: number; imageData?: string }) =>
  api<{ conditionLabel: ConditionLabel; message: string }>(`/api/inventory/damage-flags/${id}/clear`, { method: 'POST', body: input });

// ── INV-27: Article lifecycle (full history) ──
export interface AuditLogEntry {
  log_id: string;
  article_id: string | null;
  equipment_type_id: number | null;
  action: string;
  occurred_at: string;
  detail: Record<string, unknown>;
  actor_name: string;
  actor_role: string;
}

export interface ScanEntry {
  scan_id: string;
  kind: string;
  source: string;
  health_score: string;
  resulting_label: ConditionLabel;
  scanned_at: string;
  scanned_by_name: string;
}

export interface FlagEntry {
  flag_id: string;
  raised_by_system: boolean;
  raised_at: string;
  cleared_at: string | null;
  cleared_with_label: ConditionLabel | null;
  raised_by_name: string | null;
  cleared_by_name: string | null;
}

export interface PairHistoryEntry {
  pair_id: string;
  article_a_id: string;
  article_b_id: string;
  formed_at: string;
  dissolved_at: string | null;
  dissolution_reason: string | null;
  formed_by_name: string | null;
  dissolved_by_name: string | null;
}

export interface ArticleLifecycle {
  article: Article & {
    entered_by_name: string;
    decommissioned_at: string | null;
    decommissioned_by_name: string | null;
  };
  scans: ScanEntry[];
  flags: FlagEntry[];
  pairs: PairHistoryEntry[];
  auditLog: AuditLogEntry[];
}

export const getArticleLifecycle = (id: string) =>
  api<ArticleLifecycle>(`/api/inventory/articles/${id}/lifecycle`);
