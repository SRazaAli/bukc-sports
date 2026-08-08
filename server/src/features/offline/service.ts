/**
 * Offline Fallback Entry service (Feature 11).
 *
 * Three transaction types per OFFL-04:
 *   BOOKING — a venue booking agreed on paper during downtime.
 *   BORROW  — an equipment borrow that occurred during downtime.
 *   RETURN  — an equipment return that occurred during downtime.
 *
 * Every entry:
 *   - is validated with the same conflict/inventory rules as a live transaction
 *     (OFFL-06/07).
 *   - is written immediately to the DB — no queue or batch delay (OFFL-09).
 *   - carries entered_via_offline_fallback = true on the transaction row (OFFL-04).
 *   - writes an offline_fallback_audit row: who entered it + wall-clock
 *     submission timestamp, separate from the transaction's own event time
 *     (OFFL-15).
 *   - does NOT trigger the approval workflow or client-facing notifications
 *     (OFFL-11). The act of entry is treated as submission + approval in one step.
 *   - notifies Super Admin when entered by a Coordinator (OFFL-16).
 *   - participates fully in downstream features once synced (OFFL-10).
 *
 * Booking path:
 *   Inserted directly as COMPLETED (bypassing PENDING→FORWARDED→APPROVED
 *   per OFFL-11 — the event already occurred). forwarded_by / decided_by are
 *   left NULL to avoid triggering fn_booking_authority_guard. A booking_session
 *   is materialized immediately as COMPLETED and a usage_history row is written
 *   in the same transaction.
 *
 * Borrow path:
 *   Validated against current inventory state (OFFL-07). Inserted as WALK_IN
 *   (no borrow_request). Registered students use borrower_user_id; guests use
 *   a fresh guest_borrower row. Migration 019 relaxes ck_path_walkin and
 *   ck_txn_sameday to allow these patterns.
 *
 * Return path:
 *   Closes an existing ACTIVE/OVERDUE/INCOMPLETE borrow transaction. Uses the
 *   paper-logged return time, not the current time (OFFL-05). Writes
 *   usage_history only on full completion (all articles returned).
 */
import { sql } from 'kysely';
import { db, isPgError, type ConditionLabel } from '../../db/index.js';
import { AppError, badRequest, notFound, conflict } from '../../middleware/errors.js';
import type { FallbackBookingInput, FallbackBorrowInput, FallbackReturnInput } from './validators.js';

function mapDbError(e: unknown): AppError {
  if (isPgError(e)) {
    if (e.code === '23P01') return conflict('That venue slot conflicts with an existing approved booking (OFFL-06). Resolve manually before re-submitting.', 'SLOT_CONFLICT');
    if (e.code === 'P0001') return new AppError(422, e.message.replace(/^ERROR:\s*/i, ''), 'RULE');
    if (e.code === '23505') return conflict('That conflicts with an existing record.', 'DUPLICATE');
    if (e.code === '23503') return badRequest('Referenced item does not exist.', 'FK');
  }
  if (e instanceof AppError) return e;
  console.error('Offline fallback operation failed:', e);
  return new AppError(500, 'Offline fallback operation failed');
}

// ── OFFL-16: notify Super Admins when a Coordinator enters a fallback entry ──
async function notifySuperAdmins(
  enteredByRole: string,
  enteredByName: string,
  kind: 'BOOKING' | 'BORROW' | 'RETURN',
  refs: { bookingId?: string; borrowTxnId?: string },
): Promise<void> {
  // Only notify when the actor is a Coordinator — Super Admin entries are
  // self-visible; the rule mirrors the INV-01/22/23 audit notification pattern.
  if (enteredByRole !== 'COORDINATOR') return;

  const superAdmins = await db
    .selectFrom('app_user')
    .select('user_id')
    .where('role', '=', 'SUPER_ADMIN')
    .where('status', '=', 'ACTIVE')
    .execute();

  if (superAdmins.length === 0) return;

  const kindLabel = kind === 'BOOKING' ? 'venue booking' : kind === 'BORROW' ? 'equipment borrow' : 'equipment return';
  const title = `Offline fallback entry: ${kindLabel}`;
  const body  = `Coordinator ${enteredByName} entered a paper-logged ${kindLabel} via the Offline Fallback Entry Form.`;

  await db.insertInto('notification').values(
    superAdmins.map((sa) => ({
      recipient_id:   sa.user_id,
      type:           'FALLBACK_ENTRY_MADE' as const,
      title,
      body,
      booking_id:     refs.bookingId    ?? null,
      borrow_txn_id:  refs.borrowTxnId  ?? null,
    })),
  ).execute();
}

// ── OFFL-06: venue conflict check — same logic as live booking (CONF-02/05) ──
async function checkVenueConflict(venueId: number, startAt: string, endAt: string): Promise<boolean> {
  const row = await db
    .selectFrom('booking_session')
    .select('session_id')
    .where('venue_id', '=', venueId)
    .where('status', 'in', ['SCHEDULED', 'IN_PROGRESS', 'COMPLETED'])
    .where(sql<boolean>`slot && tstzrange(${startAt}::timestamptz, ${endAt}::timestamptz, '[)')`)
    .executeTakeFirst();
  return !!row;
}

// ── Fallback booking (OFFL-04..06, OFFL-09..11, OFFL-15..16) ──
export async function enterFallbackBooking(
  input: FallbackBookingInput,
  staffId: string,
): Promise<{ bookingId: string; sessionId: string }> {
  // OFFL-06: apply the same conflict detection as a live submission.
  const hasConflict = await checkVenueConflict(input.venueId, input.sessionStartAt, input.sessionEndAt);
  if (hasConflict) {
    throw conflict(
      'That venue slot conflicts with an existing approved booking. Two paper-logged commitments collided — resolve manually before re-submitting (OFFL-06).',
      'SLOT_CONFLICT',
    );
  }

  const venue = await db
    .selectFrom('venue')
    .select(['venue_id', 'sport_category_id', 'is_active'])
    .where('venue_id', '=', input.venueId)
    .executeTakeFirst();
  if (!venue) throw notFound('Venue not found.');
  if (!venue.is_active) throw conflict('That venue is no longer active.', 'INACTIVE_VENUE');

  const actor = await db
    .selectFrom('app_user').select(['full_name', 'role'])
    .where('user_id', '=', staffId).executeTakeFirstOrThrow();

  try {
    const result = await db.transaction().execute(async (trx) => {
      // OFFL-11: insert directly as COMPLETED — no PENDING→FORWARDED→APPROVED pipeline.
      // forwarded_by and decided_by are intentionally left NULL to avoid triggering
      // fn_booking_authority_guard (which requires forwarded_by=COORDINATOR and
      // decided_by=SUPER_ADMIN — a single actor cannot satisfy both).
      // ck_bk_forwarded only fires for status IN ('FORWARDED','APPROVED'), not COMPLETED.
      // fn_session_parent_guard allows sessions when parent is APPROVED or COMPLETED.
      const bookingRow = await trx
        .insertInto('booking')
        .values({
          venue_id:               input.venueId,
          origin:                 'ACADEMIC',
          requested_by:           null,
          internal_client_ref:    'BUKC SPORTS DEPARTMENT',
          purpose:                input.purpose,
          estimated_participants: input.estimatedParticipants,
          status:                 'COMPLETED',
          entered_via_offline_fallback: true,   // OFFL-04
        })
        .returning('booking_id')
        .executeTakeFirstOrThrow();

      // Materialize session. CONF-08 exclusion constraint is the authoritative
      // gate and will throw 23P01 if the slot is taken by a SCHEDULED/IN_PROGRESS
      // session (we already checked above; this is the final atomic guard).
      const sessionRow = await trx
        .insertInto('booking_session')
        .values({
          booking_id: bookingRow.booking_id,
          session_no: 1,
          venue_id:   input.venueId,
          slot:       sql`tstzrange(${input.sessionStartAt}::timestamptz, ${input.sessionEndAt}::timestamptz, '[)')`,
          status:     'COMPLETED',
        })
        .returning('session_id')
        .executeTakeFirstOrThrow();

      await trx.insertInto('session_participant').values({
        session_id:    sessionRow.session_id,
        team_name:     input.teamName,
        member_name:   input.participantDetails ?? 'See fallback entry',
        is_team_contact: true,
      }).execute();

      // HIST-02 / OFFL-10: write usage_history so the entry appears in all
      // downstream features (calendar, usage history filter, analytics).
      // tg_hist_terminal_guard requires the session to already be COMPLETED —
      // the UPDATE above runs first within this transaction.
      // tg_hist_coherence validates venue_id and outcome match.
      await trx.insertInto('usage_history').values({
        kind:           'VENUE_SESSION',
        occurred_on:    sql`(${input.sessionStartAt}::timestamptz AT TIME ZONE 'Asia/Karachi')::date`,
        session_id:     sessionRow.session_id,
        actor_user_id:  null,
        venue_id:       input.venueId,
        sport_category_id: venue.sport_category_id ?? null,
        outcome:        'COMPLETED',
        entered_via_offline_fallback: true,   // OFFL-04/10
        snapshot:       JSON.stringify({ enteredBy: staffId, note: input.note ?? null, fallback: true }),
      }).execute();

      // OFFL-15: audit record — who entered it + wall-clock submission time.
      await trx.insertInto('offline_fallback_audit').values({
        entered_by:       staffId,
        transaction_kind: 'BOOKING',
        booking_id:       bookingRow.booking_id,
        note:             input.note ?? null,
      }).execute();

      return { bookingId: bookingRow.booking_id, sessionId: sessionRow.session_id };
    });

    // OFFL-16: notify Super Admins (non-critical; outside the transaction).
    await notifySuperAdmins(actor.role, actor.full_name, 'BOOKING', { bookingId: result.bookingId });

    return result;
  } catch (e) { throw mapDbError(e); }
}

// ── Fallback borrow (OFFL-04/05/07/09..11/15/16) ──
export async function enterFallbackBorrow(
  input: FallbackBorrowInput,
  staffId: string,
): Promise<{ borrowTxnId: string }> {
  // OFFL-07: validate against current inventory state at the moment of entry —
  // not at the time the borrow actually occurred.
  const articles = await db
    .selectFrom('article')
    .select(['article_id', 'state', 'equipment_type_id'])
    .where('article_id', 'in', input.articleIds)
    .execute();

  if (articles.length !== input.articleIds.length) {
    throw notFound('One or more article IDs not found.');
  }

  const unavailable = articles.filter((a) => a.state !== 'AVAILABLE');
  if (unavailable.length > 0) {
    throw conflict(
      `Article(s) are not currently AVAILABLE (OFFL-07). Their state at entry time is ${unavailable.map((a) => a.state).join(', ')}. Select a substitute article of the same type or log a discrepancy for Super Admin review.`,
      'ARTICLE_UNAVAILABLE',
    );
  }

  const typeIds = new Set(articles.map((a) => a.equipment_type_id));
  if (typeIds.size > 1) throw badRequest('All articles must be of the same equipment type.');

  const resolvedTypeId = articles[0]!.equipment_type_id;
  if (resolvedTypeId !== input.equipmentTypeId) {
    throw badRequest('Article equipment type does not match the specified equipment type.');
  }

  // Verify equipment type is active.
  const eqType = await db
    .selectFrom('equipment_type').select('is_active')
    .where('equipment_type_id', '=', input.equipmentTypeId).executeTakeFirst();
  if (!eqType) throw notFound('Equipment type not found.');
  if (!eqType.is_active) throw conflict('This equipment type is no longer active.', 'ARCHIVED');

  // Resolve registered student.
  let borrowerUserId: string | null = null;

  if (input.borrowerKind === 'REGISTERED') {
    const student = await db
      .selectFrom('student_profile as sp')
      .innerJoin('app_user as u', 'u.user_id', 'sp.user_id')
      .select(['sp.user_id', 'u.status'])
      .where('sp.enrollment_no', '=', input.enrollmentNo)
      .executeTakeFirst();

    if (!student) throw notFound(`No student found with enrollment number "${input.enrollmentNo}".`);
    borrowerUserId = student.user_id;

    // Check uq_one_active_borrow_registered: student cannot have two active borrows.
    const alreadyActive = await db
      .selectFrom('borrow_transaction')
      .select('borrow_txn_id')
      .where('borrower_user_id', '=', borrowerUserId)
      .where('status', 'in', ['ACTIVE', 'OVERDUE', 'INCOMPLETE'])
      .executeTakeFirst();
    if (alreadyActive) {
      throw conflict(
        'This student already has an active borrow. Close the existing transaction before entering a new one.',
        'ALREADY_ACTIVE',
      );
    }
  }

  const actor = await db
    .selectFrom('app_user').select(['full_name', 'role'])
    .where('user_id', '=', staffId).executeTakeFirstOrThrow();

  try {
    const result = await db.transaction().execute(async (trx) => {
      let guestBorrowerId: string | null = null;

      if (input.borrowerKind === 'GUEST') {
        const guest = await trx
          .insertInto('guest_borrower')
          .values({
            full_name:      input.guestFullName,
            id_number:      input.guestIdNumber,
            contact_number: input.guestContactNumber,
            is_faculty:     false,
          })
          .returning('guest_borrower_id')
          .executeTakeFirstOrThrow();
        guestBorrowerId = guest.guest_borrower_id;
      }

      // OFFL-11: WALK_IN path — no borrow_request, no approval step.
      // Migration 019 relaxes ck_path_walkin to allow borrower_user_id IS NOT NULL
      // on WALK_IN (registered student fallback borrows).
      // Migration 019 relaxes ck_txn_sameday to skip the same-day check when
      // entered_via_offline_fallback = true.
      // Migration 019 updates fn_lent_by_guard to allow SUPER_ADMIN on fallback entries.
      const txn = await trx
        .insertInto('borrow_transaction')
        .values({
          path:              'WALK_IN',
          borrow_request_id: null,
          borrower_user_id:  borrowerUserId,
          guest_borrower_id: guestBorrowerId,
          equipment_type_id: input.equipmentTypeId,
          agreed_start_at:   input.agreedStartAt,
          agreed_return_at:  input.agreedReturnAt,
          actual_start_at:   sql`${input.agreedStartAt}::timestamptz`,   // OFFL-05: actual event time
          lent_by:           staffId,
          status:            'ACTIVE',
          entered_via_offline_fallback: true,        // OFFL-04
        })
        .returning('borrow_txn_id')
        .executeTakeFirstOrThrow();

      for (const articleId of input.articleIds) {
        await trx.insertInto('borrow_transaction_article').values({
          borrow_txn_id:    txn.borrow_txn_id,
          article_id:       articleId,
          selection_method: 'MANUAL_SELECT',
        }).execute();
      }

      // Mark articles ON_LOAN.
      await trx.updateTable('article').set({ state: 'ON_LOAN' })
        .where('article_id', 'in', input.articleIds).execute();

      // OFFL-15: audit record.
      await trx.insertInto('offline_fallback_audit').values({
        entered_by:       staffId,
        transaction_kind: 'BORROW',
        borrow_txn_id:    txn.borrow_txn_id,
        note:             input.note ?? null,
      }).execute();

      return { borrowTxnId: txn.borrow_txn_id };
    });

    // OFFL-16: notify Super Admins.
    await notifySuperAdmins(actor.role, actor.full_name, 'BORROW', { borrowTxnId: result.borrowTxnId });

    return result;
  } catch (e) { throw mapDbError(e); }
}

// ── Fallback return (OFFL-04/05/09..11/15/16) ──
export async function enterFallbackReturn(
  input: FallbackReturnInput,
  staffId: string,
): Promise<{ borrowTxnId: string; status: string }> {
  const txn = await db
    .selectFrom('borrow_transaction')
    .select([
      'borrow_txn_id', 'status', 'agreed_return_at',
      'equipment_type_id', 'borrower_user_id', 'guest_borrower_id',
    ])
    .where('borrow_txn_id', '=', input.borrowTxnId)
    .executeTakeFirst();

  if (!txn) throw notFound('Borrow transaction not found.');
  if (!['ACTIVE', 'OVERDUE', 'INCOMPLETE'].includes(txn.status)) {
    throw conflict(`Transaction is already ${txn.status} and cannot receive a return entry.`, 'WRONG_STATE');
  }

  // Verify the specified articles belong to this transaction and are unreturned.
  const txnArticles = await db
    .selectFrom('borrow_transaction_article')
    .select('article_id')
    .where('borrow_txn_id', '=', input.borrowTxnId)
    .where('returned_at', 'is', null)
    .execute();

  const txnArticleSet = new Set(txnArticles.map((a) => a.article_id));
  const invalid = input.articleIds.filter((id) => !txnArticleSet.has(id));
  if (invalid.length > 0) {
    throw badRequest(`Article(s) ${invalid.join(', ')} are not part of this transaction or are already returned.`);
  }

  const label = input.condition as ConditionLabel;
  // OFFL-05: use the paper-logged return time, not now().
  const returnedAt   = new Date(input.returnedAt);
  const isLate       = returnedAt > new Date(txn.agreed_return_at);

  const actor = await db
    .selectFrom('app_user').select(['full_name', 'role'])
    .where('user_id', '=', staffId).executeTakeFirstOrThrow();

  try {
    const result = await db.transaction().execute(async (trx) => {
      // Mark the specified articles as returned with paper-logged condition.
      for (const articleId of input.articleIds) {
        await trx
          .updateTable('borrow_transaction_article')
          .set({ returned_at: returnedAt, return_condition: label })
          .where('borrow_txn_id', '=', input.borrowTxnId)
          .where('article_id', '=', articleId)
          .execute();
      }

      // Update article state.
      if (label === 'DAMAGED') {
        await trx.updateTable('article')
          .set({ state: 'DAMAGED', current_condition_label: 'DAMAGED' })
          .where('article_id', 'in', input.articleIds)
          .execute();
        for (const articleId of input.articleIds) {
          await trx.insertInto('damage_flag').values({
            article_id: articleId, raised_by_system: true,
          }).execute();
        }
      } else {
        await trx.updateTable('article')
          .set({ state: 'AVAILABLE', current_condition_label: label })
          .where('article_id', 'in', input.articleIds)
          .execute();
      }

      // Check for remaining unreturned articles.
      const remaining = await trx
        .selectFrom('borrow_transaction_article')
        .select('article_id')
        .where('borrow_txn_id', '=', input.borrowTxnId)
        .where('returned_at', 'is', null)
        .execute();

      let finalStatus: string;

      if (remaining.length > 0) {
        finalStatus = 'INCOMPLETE';
        await trx.updateTable('borrow_transaction')
          .set({ status: 'INCOMPLETE', entered_via_offline_fallback: true })
          .where('borrow_txn_id', '=', input.borrowTxnId)
          .execute();
      } else {
        finalStatus = label === 'DAMAGED' ? 'COMPLETED_DAMAGED'
          : isLate ? 'COMPLETED_LATE' : 'COMPLETED';

        // ck_completed_ret requires actual_return_at IS NOT NULL when status LIKE 'COMPLETED%'.
        await trx.updateTable('borrow_transaction')
          .set({
            status:                       finalStatus as any,
            actual_return_at:             returnedAt,
            id_card_returned_at:          returnedAt,
            entered_via_offline_fallback: true,    // OFFL-04
          })
          .where('borrow_txn_id', '=', input.borrowTxnId)
          .execute();

        // HIST-02 / OFFL-10: write usage_history on terminal state.
        // tg_hist_terminal_guard verifies the transaction is COMPLETED* before allowing
        // the history insert — the UPDATE above must run first (it does, in this txn).
        // Only registered students produce history rows (HIST-08/09 scopes to registered users).
        if (txn.borrower_user_id) {
          await trx.insertInto('usage_history').values({
            kind:             'EQUIPMENT_BORROW',
            occurred_on:      sql`(${input.returnedAt}::timestamptz AT TIME ZONE 'Asia/Karachi')::date`,
            borrow_txn_id:    input.borrowTxnId,
            actor_user_id:    txn.borrower_user_id,
            equipment_type_id: txn.equipment_type_id,
            outcome:          finalStatus,
            entered_via_offline_fallback: true,    // OFFL-04/10
            snapshot:         JSON.stringify({
              enteredBy: staffId, note: input.note ?? null, fallback: true,
              articleIds: input.articleIds, condition: label,
            }),
          }).execute();
        }
      }

      // OFFL-15: audit record.
      await trx.insertInto('offline_fallback_audit').values({
        entered_by:       staffId,
        transaction_kind: 'RETURN',
        borrow_txn_id:    input.borrowTxnId,
        note:             input.note ?? null,
      }).execute();

      return { borrowTxnId: input.borrowTxnId, status: finalStatus };
    });

    // OFFL-16: notify Super Admins.
    await notifySuperAdmins(actor.role, actor.full_name, 'RETURN', { borrowTxnId: result.borrowTxnId });

    return result;
  } catch (e) { throw mapDbError(e); }
}

// ── OFFL-17: list fallback audit entries ──
export async function listFallbackAudit(filter: { from?: string; to?: string }) {
  let q = db
    .selectFrom('offline_fallback_audit as ofa')
    .innerJoin('app_user as u', 'u.user_id', 'ofa.entered_by')
    .select([
      'ofa.audit_id',
      'ofa.entered_at',
      'ofa.transaction_kind',
      'ofa.booking_id',
      'ofa.borrow_txn_id',
      'ofa.note',
      'u.full_name as entered_by_name',
      'u.role as entered_by_role',
    ])
    .orderBy('ofa.entered_at', 'desc');

  if (filter.from) q = q.where(sql<boolean>`ofa.entered_at >= ${filter.from}::timestamptz`);
  if (filter.to)   q = q.where(sql<boolean>`ofa.entered_at <= ${filter.to}::timestamptz`);

  return q.execute();
}
