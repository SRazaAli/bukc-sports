/**
 * Notifications — the read side of the in-app notification inbox. The
 * `notification` table and its write side already exist and are actively
 * used by Borrow (BORROW_APPROVED, BORROW_REJECTED, ...) and Venue
 * (BOOKING_APPROVED, EQUIPMENT_SHORTFALL, ...) — this is the part that was
 * still missing: nothing ever read them back, and Auth never wrote to it at
 * all despite AUTH-20 requiring an in-system notification alongside the
 * email on account verification. Every authenticated role can read/manage
 * only their own notifications (recipient_id = the caller).
 */
import { db } from '../../db/index.js';
import type { NotificationType } from '../../db/index.js';
import { notFound } from '../../middleware/errors.js';
import { sql } from 'kysely';

export interface NotificationRow {
  notificationId: string;
  type: NotificationType;
  title: string;
  body: string;
  createdAt: string;
  readAt: string | null;
}

export async function listMyNotifications(userId: string, limit: number): Promise<NotificationRow[]> {
  const rows = await db.selectFrom('notification')
    .select(['notification_id', 'type', 'title', 'body', 'created_at', 'read_at'])
    .where('recipient_id', '=', userId)
    .orderBy('created_at', 'desc')
    .limit(limit)
    .execute();

  return rows.map((r) => ({
    notificationId: r.notification_id,
    type: r.type,
    title: r.title,
    body: r.body,
    createdAt: new Date(r.created_at as unknown as string).toISOString(),
    readAt: r.read_at ? new Date(r.read_at as unknown as string).toISOString() : null,
  }));
}

export async function unreadCount(userId: string): Promise<number> {
  const row = await db.selectFrom('notification')
    .select(db.fn.countAll().as('n'))
    .where('recipient_id', '=', userId)
    .where('read_at', 'is', null)
    .executeTakeFirst();
  return Number(row?.n ?? 0);
}

export async function markRead(notificationId: string, userId: string): Promise<void> {
  const res = await db.updateTable('notification')
    .set({ read_at: sql<Date>`now()` })
    .where('notification_id', '=', notificationId)
    .where('recipient_id', '=', userId) // can only mark your own — no id-guessing into someone else's inbox
    .where('read_at', 'is', null)
    .executeTakeFirst();
  if (!res.numUpdatedRows) {
    // either not found, not theirs, or already read — the last case isn't an
    // error worth surfacing, so only 404 when the row genuinely isn't theirs
    const exists = await db.selectFrom('notification').select('notification_id')
      .where('notification_id', '=', notificationId).where('recipient_id', '=', userId).executeTakeFirst();
    if (!exists) throw notFound('Notification not found.');
  }
}

export async function markAllRead(userId: string): Promise<void> {
  await db.updateTable('notification')
    .set({ read_at: sql<Date>`now()` })
    .where('recipient_id', '=', userId)
    .where('read_at', 'is', null)
    .execute();
}

// AUTH-20 and general use: write an in-app notification alongside an email.
// Kept here (not duplicated per-feature) so every caller shares one insert
// shape; Borrow/Venue's existing direct inserts are untouched.
export async function notify(input: {
  recipientId: string; type: NotificationType; title: string; body: string;
}): Promise<void> {
  await db.insertInto('notification').values({
    recipient_id: input.recipientId, type: input.type, title: input.title, body: input.body,
  }).execute();
}
