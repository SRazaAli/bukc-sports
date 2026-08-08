/**
 * Equipment availability service (Feature 2 — EQUIP-AVAIL-01..10).
 *
 * Reads from v_article_availability (has total_stock — needed for the
 * staff-only figure per EQUIP-AVAIL-05) joined with equipment_type/sport
 * for name, threshold, indoor flag, and image. The status badge is computed
 * in TS mirroring v_equipment_status_badge's exact CASE logic, so both views
 * of the same data (staff Inventory tab vs this checker) never disagree.
 */
import { db } from '../../db/index.js';
import type { UserRole } from '../../db/index.js';

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
  // EQUIP-AVAIL-05: total stock is staff-only. Present only for SUPER_ADMIN/COORDINATOR.
  totalStock?: number;
}

function badgeFor(availableUnits: number, threshold: number): StatusBadge {
  if (availableUnits === 0) return 'CHECKED_OUT';
  if (availableUnits <= threshold) return 'LOW_STOCK';
  return 'AVAILABLE';
}

export async function listAvailability(
  filter: { sportCategoryId?: number; equipmentTypeId?: number; isIndoor?: boolean },
  role?: UserRole,
): Promise<AvailabilityRow[]> {
  let q = db.selectFrom('v_article_availability as av')
    .innerJoin('equipment_type as et', 'et.equipment_type_id', 'av.equipment_type_id')
    .innerJoin('sport_category as sc', 'sc.sport_category_id', 'av.sport_category_id')
    .select([
      'av.equipment_type_id', 'et.name', 'av.sport_category_id', 'sc.name as sport_category_name',
      'et.is_indoor', 'et.image_url', 'et.lending_unit', 'et.low_stock_threshold',
      'av.total_stock', 'av.available_units',
    ]);

  if (filter.sportCategoryId) q = q.where('av.sport_category_id', '=', filter.sportCategoryId);
  if (filter.equipmentTypeId) q = q.where('av.equipment_type_id', '=', filter.equipmentTypeId);
  if (filter.isIndoor !== undefined) q = q.where('et.is_indoor', '=', filter.isIndoor);
  // Archived types are no longer offered for borrowing — this checker's whole
  // purpose is "what can I borrow now", so they're excluded for every role.
  q = q.where('et.is_active', '=', true);

  const rows = await q.orderBy('sc.name').orderBy('et.name').execute();
  const staff = role === 'SUPER_ADMIN' || role === 'COORDINATOR';

  return rows.map((r) => {
    const availableUnits = Number(r.available_units);
    const row: AvailabilityRow = {
      equipmentTypeId: r.equipment_type_id,
      name: r.name,
      sportCategoryId: r.sport_category_id,
      sportCategoryName: r.sport_category_name,
      isIndoor: r.is_indoor,
      imageUrl: r.image_url,
      lendingUnit: r.lending_unit,
      availableUnits,
      statusBadge: badgeFor(availableUnits, r.low_stock_threshold),
    };
    if (staff) row.totalStock = Number(r.total_stock);
    return row;
  });
}
