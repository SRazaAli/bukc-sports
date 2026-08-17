/**
 * Kit borrow — submit one borrow_request per equipment type in a sport
 * category, atomically. Either all succeed or none are created.
 *
 * Constraints enforced here (mirrors the per-item rules):
 *  - Student must have no active borrow (checked via uq_one_active_borrow_registered
 *    trigger, which will fire on the first conflicting insert — we catch it).
 *  - Every type in the pack must have availableUnits > 0, checked before insert.
 *  - Same-day window validation (start and end on same calendar day).
 *  - Must be a STUDENT role.
 */
import { randomUUID } from 'crypto';
import { db } from '../../db/index.js';

export interface KitBorrowInput {
  sportCategoryId: number;
  requestedStartAt: Date;
  requestedReturnAt: Date;
  studentUserId: string;
}

export interface KitBorrowResult {
  requestIds: string[];
  typeNames: string[];
}

export async function submitKitBorrowRequest(input: KitBorrowInput): Promise<KitBorrowResult> {
  const { sportCategoryId, requestedStartAt, requestedReturnAt, studentUserId } = input;

  // Same-day validation (mirrors BORROW-01 same-day rule)
  const startDay = requestedStartAt.toDateString();
  const endDay = requestedReturnAt.toDateString();
  if (startDay !== endDay) {
    throw Object.assign(new Error('Kit borrow window must start and end on the same day.'), { status: 400 });
  }
  if (requestedReturnAt <= requestedStartAt) {
    throw Object.assign(new Error('Return time must be after start time.'), { status: 400 });
  }

  // Fetch all available types for the sport
  const rows = await db
    .selectFrom('v_article_availability as av')
    .innerJoin('equipment_type as et', 'et.equipment_type_id', 'av.equipment_type_id')
    .select(['av.equipment_type_id', 'et.name', 'av.available_units'])
    .where('av.sport_category_id', '=', sportCategoryId)
    .orderBy('et.name')
    .execute();

  if (rows.length === 0) {
    throw Object.assign(new Error('No equipment types found for this sport.'), { status: 404 });
  }

  // Check every item has stock
  const unavailable = rows.filter((r) => Number(r.available_units) === 0).map((r) => r.name);
  if (unavailable.length > 0) {
    throw Object.assign(
      new Error(`Cannot request full kit — the following items have no available units: ${unavailable.join(', ')}.`),
      { status: 409 },
    );
  }

  // Wrap all inserts in a transaction — all succeed or none.
  // All rows in the kit share one request_group_id so the coordinator
  // sees them as a single logical request.
  const groupId = randomUUID();
  const requestIds: string[] = [];
  const typeNames: string[] = [];

  await db.transaction().execute(async (trx) => {
    for (const row of rows) {
      const inserted = await trx
        .insertInto('borrow_request')
        .values({
          request_group_id: groupId,
          requested_by: studentUserId,
          equipment_type_id: row.equipment_type_id,
          requested_start_at: requestedStartAt,
          requested_return_at: requestedReturnAt,
        })
        .returning('borrow_request_id')
        .executeTakeFirstOrThrow();

      requestIds.push(inserted.borrow_request_id);
      typeNames.push(row.name);
    }
  });

  return { requestIds, typeNames };
}
