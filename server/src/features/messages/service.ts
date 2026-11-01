/**
 * Messages — chat with the Coordinator desk (migration 029).
 *
 *   STUDENT / EXTERNAL / SUPER_ADMIN ("party"): one conversation each, with
 *     the Coordinators. They can't message each other, and students/externals
 *     can't reach the Super Admin.
 *   COORDINATOR: sees every conversation (the desk is shared) and replies.
 *     Can also open a conversation with a Super Admin. Can't start chats with
 *     students/externals — they reply to whoever messaged.
 *
 * Unread counts (sidebar badge):
 *   party       → number of desk messages they haven't read yet
 *   coordinator → number of conversations with party messages they haven't read
 */
import { sql } from 'kysely';
import { db, isPgError } from '../../db/index.js';
import { AppError, badRequest, notFound } from '../../middleware/errors.js';

export type PartyRole = 'STUDENT' | 'EXTERNAL' | 'SUPER_ADMIN';
const MAX_MESSAGES = 300;

function mapDbError(e: unknown): AppError {
  if (isPgError(e)) {
    if (e.code === 'P0001') return new AppError(403, e.message.replace(/^ERROR:\s*/i, '').replace(/^MSG-\d+:\s*/, ''), 'RULE');
    if (e.code === '23514') return badRequest('A message must be between 1 and 2000 characters.', 'BAD_MESSAGE');
  }
  if (e instanceof AppError) return e;
  console.error('Messages operation failed:', e);
  return new AppError(500, 'Messages operation failed');
}

function cleanBody(body: string) {
  const b = body.replace(/\r\n/g, '\n').trim();
  if (!b) throw badRequest('Type a message first.', 'EMPTY_MESSAGE');
  if (b.length > 2000) throw badRequest('A message can be at most 2000 characters.', 'MESSAGE_TOO_LONG');
  return b;
}

async function conversationOf(partyId: string) {
  return db.selectFrom('conversation').select(['conversation_id']).where('party_user_id', '=', partyId).executeTakeFirst();
}
async function ensureConversation(partyId: string): Promise<string> {
  await db.insertInto('conversation').values({ party_user_id: partyId })
    .onConflict((oc) => oc.column('party_user_id').doNothing()).execute();
  return (await conversationOf(partyId))!.conversation_id;
}
async function markRead(conversationId: string, userId: string) {
  await db.insertInto('conversation_read')
    .values({ conversation_id: conversationId, user_id: userId, last_read_at: sql`clock_timestamp()` })
    .onConflict((oc) => oc.columns(['conversation_id', 'user_id']).doUpdateSet({ last_read_at: sql`clock_timestamp()` }))
    .execute();
}

async function listMessages(conversationId: string) {
  const rows = await db.selectFrom('message as m')
    .innerJoin('app_user as u', 'u.user_id', 'm.sender_id')
    .select(['m.message_id', 'm.body', 'm.created_at', 'm.sender_id', 'u.full_name as sender_name', 'u.role as sender_role'])
    .where('m.conversation_id', '=', conversationId)
    .orderBy('m.created_at', 'desc').limit(MAX_MESSAGES).execute();
  return rows.reverse();
}

/** When the other side last read the conversation (for ✓✓ "read" ticks). */
async function lastReadBy(conversationId: string, side: 'party' | 'desk', partyId: string) {
  const q = db.selectFrom('conversation_read as r')
    .innerJoin('app_user as u', 'u.user_id', 'r.user_id')
    .select((eb) => eb.fn.max('r.last_read_at').as('at'))
    .where('r.conversation_id', '=', conversationId);
  const row = side === 'party'
    ? await q.where('r.user_id', '=', partyId).executeTakeFirst()
    : await q.where('u.role', '=', 'COORDINATOR').executeTakeFirst();
  return (row?.at as Date | null | undefined) ?? null;
}

/* ───────────────────────── party side ───────────────────────── */

export async function getMyConversation(partyId: string) {
  const conv = await conversationOf(partyId);
  if (!conv) return { conversationId: null, messages: [], deskLastReadAt: null };
  return {
    conversationId: conv.conversation_id,
    messages: await listMessages(conv.conversation_id),
    deskLastReadAt: await lastReadBy(conv.conversation_id, 'desk', partyId),
  };
}

export async function sendAsParty(partyId: string, body: string) {
  const text = cleanBody(body);
  try {
    const conversationId = await ensureConversation(partyId);
    const msg = await db.insertInto('message').values({ conversation_id: conversationId, sender_id: partyId, body: text })
      .returning(['message_id', 'created_at']).executeTakeFirstOrThrow();
    await markRead(conversationId, partyId);
    return { conversationId, ...msg };
  } catch (e) { throw mapDbError(e); }
}

export async function markMineRead(partyId: string) {
  const conv = await conversationOf(partyId);
  if (conv) await markRead(conv.conversation_id, partyId);
}

/* ───────────────────────── coordinator side ───────────────────────── */

const partyColumns = [
  'c.conversation_id', 'c.last_message_at', 'c.created_at',
  'u.user_id as party_id', 'u.full_name as party_name', 'u.role as party_role', 'u.email as party_email',
  'sp.enrollment_no', 'sp.department', 'ep.institution_name', 'ep.designation',
] as const;

export async function listInbox(coordinatorId: string) {
  const rows = await db.selectFrom('conversation as c')
    .innerJoin('app_user as u', 'u.user_id', 'c.party_user_id')
    .leftJoin('student_profile as sp', 'sp.user_id', 'u.user_id')
    .leftJoin('external_profile as ep', 'ep.user_id', 'u.user_id')
    .leftJoin('conversation_read as r', (j) => j.onRef('r.conversation_id', '=', 'c.conversation_id').on('r.user_id', '=', coordinatorId))
    .select([
      ...partyColumns,
      sql<number>`(SELECT count(*) FROM message m WHERE m.conversation_id = c.conversation_id
                    AND m.sender_id = c.party_user_id
                    AND (r.last_read_at IS NULL OR m.created_at > r.last_read_at))`.as('unread'),
      sql<string | null>`(SELECT m.body FROM message m WHERE m.conversation_id = c.conversation_id ORDER BY m.created_at DESC LIMIT 1)`.as('last_body'),
      sql<string | null>`(SELECT m.sender_id FROM message m WHERE m.conversation_id = c.conversation_id ORDER BY m.created_at DESC LIMIT 1)`.as('last_sender_id'),
    ])
    .orderBy(sql`coalesce(c.last_message_at, c.created_at)`, 'desc')
    .execute();
  return rows.map((r) => ({
    ...r,
    unread: Number(r.unread),
    last_from_party: r.last_sender_id ? r.last_sender_id === r.party_id : null,
  }));
}

async function conversationParty(conversationId: string) {
  const row = await db.selectFrom('conversation as c')
    .innerJoin('app_user as u', 'u.user_id', 'c.party_user_id')
    .leftJoin('student_profile as sp', 'sp.user_id', 'u.user_id')
    .leftJoin('external_profile as ep', 'ep.user_id', 'u.user_id')
    .select([...partyColumns])
    .where('c.conversation_id', '=', conversationId)
    .executeTakeFirst();
  if (!row) throw notFound('Conversation not found.');
  return row;
}

export async function getConversation(conversationId: string) {
  const party = await conversationParty(conversationId);
  return {
    party,
    messages: await listMessages(conversationId),
    partyLastReadAt: await lastReadBy(conversationId, 'party', party.party_id),
  };
}

export async function sendAsCoordinator(coordinatorId: string, conversationId: string, body: string) {
  const text = cleanBody(body);
  await conversationParty(conversationId); // 404 if missing
  try {
    const msg = await db.insertInto('message').values({ conversation_id: conversationId, sender_id: coordinatorId, body: text })
      .returning(['message_id', 'created_at']).executeTakeFirstOrThrow();
    await markRead(conversationId, coordinatorId);
    return msg;
  } catch (e) { throw mapDbError(e); }
}

export async function markConversationRead(coordinatorId: string, conversationId: string) {
  await conversationParty(conversationId);
  await markRead(conversationId, coordinatorId);
}

/** Super Admins a Coordinator can start a chat with. */
export async function listAdmins() {
  return db.selectFrom('app_user as u')
    .leftJoin('conversation as c', 'c.party_user_id', 'u.user_id')
    .select(['u.user_id', 'u.full_name', 'u.email', 'c.conversation_id'])
    .where('u.role', '=', 'SUPER_ADMIN').where('u.status', '=', 'ACTIVE')
    .orderBy('u.full_name').execute();
}

/** Coordinator opens (or reuses) the conversation with a Super Admin. */
export async function openWithAdmin(adminId: string) {
  const u = await db.selectFrom('app_user').select(['role', 'status']).where('user_id', '=', adminId).executeTakeFirst();
  if (!u) throw notFound('User not found.');
  if (u.role !== 'SUPER_ADMIN') {
    throw new AppError(403, 'Coordinators can start a chat only with the Administration Staff. Students and externals message you first.', 'NOT_ADMIN');
  }
  try { return { conversationId: await ensureConversation(adminId) }; } catch (e) { throw mapDbError(e); }
}

/* ───────────────────────── badge ───────────────────────── */

export async function unreadCount(userId: string, role: string): Promise<number> {
  if (role === 'COORDINATOR') {
    const row = await sql<{ n: string }>`
      SELECT count(*) AS n FROM conversation c
       LEFT JOIN conversation_read r ON r.conversation_id = c.conversation_id AND r.user_id = ${userId}
       WHERE EXISTS (SELECT 1 FROM message m WHERE m.conversation_id = c.conversation_id
                       AND m.sender_id = c.party_user_id
                       AND (r.last_read_at IS NULL OR m.created_at > r.last_read_at))`.execute(db);
    return Number(row.rows[0]?.n ?? 0);
  }
  const row = await sql<{ n: string }>`
    SELECT count(*) AS n FROM conversation c
      JOIN message m ON m.conversation_id = c.conversation_id AND m.sender_id <> c.party_user_id
      LEFT JOIN conversation_read r ON r.conversation_id = c.conversation_id AND r.user_id = ${userId}
     WHERE c.party_user_id = ${userId}
       AND (r.last_read_at IS NULL OR m.created_at > r.last_read_at)`.execute(db);
  return Number(row.rows[0]?.n ?? 0);
}
