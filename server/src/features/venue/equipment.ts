/**
 * Event equipment allocation (VENUE-13/15/16/17, EQUIP-AVAIL-11..21).
 *
 * Pre-approval planning lives in booking_session_request_equipment (mirrors
 * booking_session_request); materialized into real event_equipment_allocation
 * rows at approval, in the same transaction as the sessions themselves.
 *
 * Shortfall (VENUE-15/16/17): per explicit product decision, no new booking
 * is created for the round trip. The same booking_id moves through
 * SHORTFALL_PENDING while the client confirms or declines self-managing the
 * short items, then returns to PENDING (confirmed) or REJECTED (declined).
 */
import { sql } from 'kysely';
import { db, isPgError, type ConditionLabel } from '../../db/index.js';
import { AppError, badRequest, notFound, conflict } from '../../middleware/errors.js';
import { sendEmail } from '../../lib/email.js';

function mapDbError(e: unknown): AppError {
  if (isPgError(e)) {
    if (e.code === 'P0001') return new AppError(422, e.message.replace(/^ERROR:\s*/i, ''), 'RULE');
    if (e.code === '23505') return conflict('That already exists.', 'DUPLICATE');
    if (e.code === '23503') return badRequest('Referenced item does not exist.', 'FK');
  }
  if (e instanceof AppError) return e;
  console.error("Equipment allocation operation failed:", e);
  return new AppError(500, 'Equipment allocation operation failed');
}

async function notifyStaffRole(role: 'COORDINATOR' | 'SUPER_ADMIN', type: import('../../db/index.js').NotificationType, title: string, body: string, refs: { bookingId?: string; articleId?: string } = {}) {
  const staff = await db.selectFrom('app_user').select('user_id').where('role', '=', role).where('status', '=', 'ACTIVE').execute();
  if (staff.length === 0) return;
  await db.insertInto('notification').values(
    staff.map((s) => ({ recipient_id: s.user_id, type, title, body, booking_id: refs.bookingId ?? null, article_id: refs.articleId ?? null })),
  ).execute();
}
async function notifyRequester(type: import('../../db/index.js').NotificationType, userId: string, title: string, body: string, bookingId: string) {
  const user = await db.selectFrom('app_user').select(['email']).where('user_id', '=', userId).executeTakeFirst();
  await db.insertInto('notification').values({ recipient_id: userId, type, title, body, booking_id: bookingId }).execute();
  if (user) sendEmail({ to: user.email, subject: title, html: `<p>${body}</p>`, text: body }).catch((e) => console.error('notifyRequester email failed:', e));
}

// ── planning (VENUE-13) ──
export interface AllocationInput { requestSessionId: string; equipmentTypeId: number; quantity: number }

export async function planAllocation(bookingId: string, coordinatorId: string, allocations: AllocationInput[]) {
  const b = await db.selectFrom('booking').select(['status', 'requested_by']).where('booking_id', '=', bookingId).executeTakeFirst();
  if (!b) throw notFound('Booking not found.');
  if (b.status !== 'PENDING') throw conflict(`Booking is ${b.status} — equipment can only be planned while PENDING.`);

  try {
    const shortfalls: Array<{ equipmentTypeId: number; requested: number; available: number }> = [];

    await db.transaction().execute(async (trx) => {
      for (const a of allocations) {
        const avail = await trx.selectFrom('v_article_availability').select('available_units')
          .where('equipment_type_id', '=', a.equipmentTypeId).executeTakeFirst();
        const availableUnits = avail ? Number(avail.available_units) : 0;
        const isShort = a.quantity > availableUnits;
        if (isShort) shortfalls.push({ equipmentTypeId: a.equipmentTypeId, requested: a.quantity, available: availableUnits });

        await trx.insertInto('booking_session_request_equipment')
          .values({
            request_session_id: a.requestSessionId, equipment_type_id: a.equipmentTypeId,
            quantity: a.quantity, allocated_by: coordinatorId, needs_shortfall_confirmation: isShort,
          })
          .onConflict((oc) => oc.columns(['request_session_id', 'equipment_type_id']).doUpdateSet({
            quantity: a.quantity, needs_shortfall_confirmation: isShort, is_self_managed: false,
          }))
          .execute();
      }

      if (shortfalls.length > 0) {
        await trx.updateTable('booking').set({ status: 'SHORTFALL_PENDING' }).where('booking_id', '=', bookingId).execute();
      }
    });

    if (shortfalls.length > 0 && b.requested_by) {
      const types = await db.selectFrom('equipment_type').select(['equipment_type_id', 'name'])
        .where('equipment_type_id', 'in', shortfalls.map((s) => s.equipmentTypeId)).execute();
      const nameFor = (id: number) => types.find((t) => t.equipment_type_id === id)?.name ?? `type #${id}`;
      const lines = shortfalls.map((s) => `${nameFor(s.equipmentTypeId)}: requested ${s.requested}, only ${s.available} available`).join('; ');
      await notifyRequester('EQUIPMENT_SHORTFALL', b.requested_by, 'Equipment shortfall on your venue booking',
        `We can't fully supply: ${lines}. Please confirm whether you can arrange this equipment yourself, or your booking cannot proceed as requested.`,
        bookingId);
    }

    return { shortfalls };
  } catch (e) { throw mapDbError(e); }
}

export async function getAllocationPlan(bookingId: string) {
  return db.selectFrom('booking_session_request_equipment as bsre')
    .innerJoin('booking_session_request as bsr', 'bsr.request_session_id', 'bsre.request_session_id')
    .innerJoin('equipment_type as et', 'et.equipment_type_id', 'bsre.equipment_type_id')
    .select(['bsre.allocation_request_id', 'bsre.request_session_id', 'bsr.session_no', 'bsre.equipment_type_id',
      'et.name as equipment_type_name', 'bsre.quantity', 'bsre.is_self_managed', 'bsre.needs_shortfall_confirmation'])
    .where('bsr.booking_id', '=', bookingId)
    .orderBy('bsr.session_no', 'asc').execute();
}

// ── shortfall confirmation (VENUE-16, client-facing) ──
export async function confirmShortfall(bookingId: string, clientId: string, confirm: boolean) {
  const b = await db.selectFrom('booking').select(['status', 'requested_by']).where('booking_id', '=', bookingId).executeTakeFirst();
  if (!b) throw notFound('Booking not found.');
  if (b.status !== 'SHORTFALL_PENDING') throw conflict('This booking has no shortfall awaiting confirmation.');
  if (b.requested_by !== clientId) throw new AppError(403, 'This is not your booking.', 'FORBIDDEN');

  try {
    if (confirm) {
      await db.transaction().execute(async (trx) => {
        await trx.updateTable('booking_session_request_equipment')
          .set({ is_self_managed: true, needs_shortfall_confirmation: false })
          .where('needs_shortfall_confirmation', '=', true)
          .where('request_session_id', 'in', db.selectFrom('booking_session_request')
            .select('request_session_id').where('booking_id', '=', bookingId))
          .execute();
        await trx.updateTable('booking').set({ status: 'PENDING' }).where('booking_id', '=', bookingId).execute();
      });
      await notifyStaffRole('COORDINATOR', 'QUEUE_NEW_ITEM', 'Shortfall confirmed — booking ready for review',
        'The requester confirmed they will self-manage the equipment shortfall. The booking is back in your queue.', { bookingId });
      return { status: 'PENDING' as const };
    } else {
      await db.updateTable('booking').set({
        status: 'REJECTED',
        rejection_reason: 'The requester could not confirm coverage of the equipment shortfall.',
      }).where('booking_id', '=', bookingId).execute();
      // APPR-06 reserves the REJECT verb's actor for staff — this rejection is
      // a system consequence of the requester's own decline, not a staff
      // review action, so it's attributed to no actor (fn_approval_actor_guard
      // exempts NULL actor_id rows from the role check).
      await db.insertInto('approval_action').values({
        subject: 'VENUE_BOOKING', verb: 'REJECT', booking_id: bookingId, actor_id: null,
        note: `Requester (${clientId}) declined to self-manage the equipment shortfall.`,
      }).execute();
      await notifyStaffRole('COORDINATOR', 'BOOKING_REJECTED', 'Booking auto-rejected: shortfall declined',
        'The requester declined to self-manage the equipment shortfall; the booking was rejected.', { bookingId });
      return { status: 'REJECTED' as const };
    }
  } catch (e) { throw mapDbError(e); }
}

// Called from approveBooking (venue service) inside the same transaction as
// the session inserts — materializes every planned line into a real,
// post-approval event_equipment_allocation row.
export async function materializeAllocations(
  trx: import('kysely').Transaction<import('../../db/index.js').DB>,
  requestSessionId: string, realSessionId: string, actorId: string,
) {
  const lines = await trx.selectFrom('booking_session_request_equipment')
    .select(['equipment_type_id', 'quantity', 'is_self_managed'])
    .where('request_session_id', '=', requestSessionId).execute();
  for (const line of lines) {
    await trx.insertInto('event_equipment_allocation').values({
      session_id: realSessionId, equipment_type_id: line.equipment_type_id,
      quantity: line.quantity, allocated_by: actorId, is_self_managed: line.is_self_managed,
    }).execute();
  }
}

// ── T-24hr lock (EQUIP-AVAIL-11/12/13/19) ──
export async function checkEquipmentLocks(): Promise<number> {
  const due = await db.selectFrom('event_equipment_allocation as ea')
    .innerJoin('booking_session as bs', 'bs.session_id', 'ea.session_id')
    .select(['ea.allocation_id', 'ea.equipment_type_id', 'ea.quantity', 'bs.session_id'])
    .where('ea.locked_at', 'is', null)
    .where('ea.is_self_managed', '=', false)
    .where('bs.status', 'in', ['SCHEDULED', 'IN_PROGRESS'])
    .where(sql<boolean>`bs.equipment_lock_at <= now()`)
    .execute();

  for (const row of due) {
    // EQUIP-AVAIL-13: check BEFORE this lock is applied — it hasn't yet
    // subtracted from the pool, so the current available_units is exactly
    // what would remain if we DIDN'T have this allocation.
    const avail = await db.selectFrom('v_article_availability').select('available_units')
      .where('equipment_type_id', '=', row.equipment_type_id).executeTakeFirst();
    const availableUnits = avail ? Number(avail.available_units) : 0;
    const short = availableUnits < row.quantity;

    await db.updateTable('event_equipment_allocation').set({ locked_at: new Date() })
      .where('allocation_id', '=', row.allocation_id).execute();

    // EQUIP-AVAIL-19: silence is confirmation — only alert when short.
    if (short) {
      await notifyStaffRole('COORDINATOR', 'T24_LOCK_ALERT', 'Equipment lock alert: insufficient stock',
        `An event's equipment lock has triggered but only ${availableUnits} of the ${row.quantity} required units are currently available. A swap or shortfall resolution is needed.`,
        {});
    }
  }
  return due.length;
}

// ── swaps (EQUIP-AVAIL-14/15/21) — reuses the tested article_swap constraints ──
export async function performSwap(allocationId: string, coordinatorId: string, input: {
  outgoingArticleId: string; incomingArticleId: string; reason?: string;
}) {
  try {
    await db.insertInto('article_swap').values({
      allocation_id: allocationId, outgoing_article_id: input.outgoingArticleId,
      incoming_article_id: input.incomingArticleId, performed_by: coordinatorId, reason: input.reason ?? null,
    }).execute();
    // EQUIP-AVAIL-15: Super Admin gets an automatic notification of the swap.
    await notifyStaffRole('SUPER_ADMIN', 'SWAP_NOTICE_SUPERADMIN', 'Article swap performed',
      'A Coordinator swapped an article on an event equipment allocation.', {});
  } catch (e) { throw mapDbError(e); }
}

export async function listAlertingAllocations() {
  // Allocations locked within the last cycle whose type is currently short —
  // a live view for the Coordinator's "needs attention" list.
  const locked = await db.selectFrom('event_equipment_allocation as ea')
    .innerJoin('equipment_type as et', 'et.equipment_type_id', 'ea.equipment_type_id')
    .innerJoin('booking_session as bs', 'bs.session_id', 'ea.session_id')
    .innerJoin('venue as v', 'v.venue_id', 'bs.venue_id')
    .select(['ea.allocation_id', 'ea.equipment_type_id', 'et.name as equipment_type_name', 'ea.quantity',
      'bs.session_id', 'v.name as venue_name', 'bs.slot'])
    .where('ea.locked_at', 'is not', null)
    .where('ea.released_at', 'is', null)
    .where('ea.is_self_managed', '=', false)
    .execute();

  const results = [];
  for (const row of locked) {
    const avail = await db.selectFrom('v_article_availability').select('available_units')
      .where('equipment_type_id', '=', row.equipment_type_id).executeTakeFirst();
    const availableUnits = avail ? Number(avail.available_units) : 0;
    if (availableUnits < row.quantity) {
      results.push({ ...row, availableUnits });
    }
  }
  return results;
}

// ── post-event release (EQUIP-AVAIL-18/20, VENUE-32/33) ──
export async function checkPostEventRelease(): Promise<number> {
  const ended = await db.selectFrom('booking_session')
    .select(['session_id', 'booking_id'])
    .where('status', 'in', ['SCHEDULED', 'IN_PROGRESS'])
    .where(sql<boolean>`upper(slot) <= now()`)
    .execute();

  for (const s of ended) {
    await db.updateTable('booking_session').set({ status: 'COMPLETED' }).where('session_id', '=', s.session_id).execute();
    await db.updateTable('event_equipment_allocation').set({ released_at: new Date() })
      .where('session_id', '=', s.session_id).where('released_at', 'is', null).execute();

    const hasAllocations = await db.selectFrom('event_equipment_allocation').select('allocation_id')
      .where('session_id', '=', s.session_id).executeTakeFirst();
    if (hasAllocations) {
      await notifyStaffRole('COORDINATOR', 'POST_EVENT_REVIEW', 'Post-event equipment review',
        'A session concluded and its equipment was released. Review condition via Inventory (scan, mark damaged, or dismiss).', { bookingId: s.booking_id });
    }

    // VENUE-33: the parent booking completes only once every session has.
    const remaining = await db.selectFrom('booking_session').select('session_id')
      .where('booking_id', '=', s.booking_id).where('status', '!=', 'COMPLETED').where('status', '!=', 'CANCELLED').executeTakeFirst();
    if (!remaining) {
      await db.updateTable('booking').set({ status: 'COMPLETED' }).where('booking_id', '=', s.booking_id).where('status', '=', 'APPROVED').execute();
    }
  }
  return ended.length;
}
