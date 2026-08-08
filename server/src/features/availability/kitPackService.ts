/**
 * Kit Pack service — returns a virtual "kit pack" for a sport category.
 *
 * A kit pack is purely derived: it is the set of all equipment types for
 * a sport category that have at least one article and are not fully
 * decommissioned. No new DB table is required — the bundle lives in the
 * existing sport_category → equipment_type → v_article_availability chain.
 *
 * Kit availability is AVAILABLE only when every item in the pack has
 * at least one available unit. Otherwise the overall status reflects the
 * worst item.
 */
import { db } from '../../db/index.js';
import { badgeFor } from './service.js';
import type { StatusBadge } from './service.js';

export interface KitItem {
  equipmentTypeId: number;
  name: string;
  lendingUnit: 'SINGLE' | 'PAIR';
  availableUnits: number;
  statusBadge: StatusBadge;
  imageUrl: string | null;
}

export interface KitPack {
  sportCategoryId: number;
  sportCategoryName: string;
  items: KitItem[];
  /** Overall kit status: AVAILABLE only when every item has ≥1 unit. */
  kitStatusBadge: 'AVAILABLE' | 'PARTIAL' | 'UNAVAILABLE';
  /** True when kitStatusBadge === 'AVAILABLE' */
  canRequestAll: boolean;
}

export async function getKitPack(sportCategoryId: number): Promise<KitPack | null> {
  // 1. Verify sport category exists
  const cat = await db
    .selectFrom('sport_category as sc')
    .select(['sc.sport_category_id', 'sc.name'])
    .where('sc.sport_category_id', '=', sportCategoryId)
    .executeTakeFirst();

  if (!cat) return null;

  // 2. Pull all types for this sport that have at least one non-decommissioned article
  const rows = await db
    .selectFrom('v_article_availability as av')
    .innerJoin('equipment_type as et', 'et.equipment_type_id', 'av.equipment_type_id')
    .select([
      'av.equipment_type_id',
      'et.name',
      'et.lending_unit',
      'et.low_stock_threshold',
      'et.image_url',
      'av.available_units',
    ])
    .where('av.sport_category_id', '=', sportCategoryId)
    .orderBy('et.name')
    .execute();

  if (rows.length === 0) return null;

  const items: KitItem[] = rows.map((r) => {
    const available = Number(r.available_units);
    return {
      equipmentTypeId: r.equipment_type_id,
      name: r.name,
      lendingUnit: r.lending_unit,
      availableUnits: available,
      statusBadge: badgeFor(available, r.low_stock_threshold),
      imageUrl: r.image_url,
    };
  });

  // Overall status logic
  const allAvailable = items.every((i) => i.availableUnits > 0);
  const noneAvailable = items.every((i) => i.availableUnits === 0);
  const kitStatusBadge = allAvailable ? 'AVAILABLE' : noneAvailable ? 'UNAVAILABLE' : 'PARTIAL';

  return {
    sportCategoryId: cat.sport_category_id,
    sportCategoryName: cat.name,
    items,
    kitStatusBadge,
    canRequestAll: allAvailable,
  };
}
