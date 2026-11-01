/**
 * Messages routes (/api/messages).
 *
 *   Party (student / external / Super Admin) — their single chat with the desk:
 *     GET  /mine            conversation + messages
 *     POST /mine            send a message to the Coordinators
 *     POST /mine/read       mark the desk's messages as read
 *   Coordinator — inbox + chat:
 *     GET  /inbox                    every conversation, with who sent it + unread
 *     GET  /conversations/:id        one conversation
 *     POST /conversations/:id        reply
 *     POST /conversations/:id/read   mark as read
 *     GET  /admins                   Super Admins they can message
 *     POST /admins/:id/open          open / reuse the chat with that Super Admin
 *   Everyone:
 *     GET  /unread-count             sidebar badge number
 */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/async.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { badRequest } from '../../middleware/errors.js';
import * as svc from './service.js';

export const messagesRouter = Router();

const party = [requireAuth, requireRole('STUDENT', 'EXTERNAL', 'SUPER_ADMIN')] as const;
const coordinatorOnly = [requireAuth, requireRole('COORDINATOR')] as const;
const sendSchema = z.object({ body: z.string().max(4000) });

function reqId(req: { params: Record<string, string | undefined> }): string {
  const id = req.params.id;
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) throw badRequest('Invalid id');
  return id;
}
function body(req: { body: unknown }) {
  const r = sendSchema.safeParse(req.body);
  if (!r.success) throw badRequest('Type a message first.', 'EMPTY_MESSAGE');
  return r.data.body;
}

messagesRouter.get('/unread-count', requireAuth, asyncHandler(async (req, res) => {
  res.json({ count: await svc.unreadCount(req.user!.userId, req.user!.role) });
}));

// ── party ──
messagesRouter.get('/mine', ...party, asyncHandler(async (req, res) => {
  res.json(await svc.getMyConversation(req.user!.userId));
}));
messagesRouter.post('/mine', ...party, asyncHandler(async (req, res) => {
  res.status(201).json({ message: await svc.sendAsParty(req.user!.userId, body(req)) });
}));
messagesRouter.post('/mine/read', ...party, asyncHandler(async (req, res) => {
  await svc.markMineRead(req.user!.userId);
  res.json({ ok: true });
}));

// ── coordinator ──
messagesRouter.get('/inbox', ...coordinatorOnly, asyncHandler(async (req, res) => {
  res.json({ conversations: await svc.listInbox(req.user!.userId) });
}));
messagesRouter.get('/admins', ...coordinatorOnly, asyncHandler(async (_req, res) => {
  res.json({ admins: await svc.listAdmins() });
}));
messagesRouter.post('/admins/:id/open', ...coordinatorOnly, asyncHandler(async (req, res) => {
  res.json(await svc.openWithAdmin(reqId(req)));
}));
messagesRouter.get('/conversations/:id', ...coordinatorOnly, asyncHandler(async (req, res) => {
  res.json(await svc.getConversation(reqId(req)));
}));
messagesRouter.post('/conversations/:id', ...coordinatorOnly, asyncHandler(async (req, res) => {
  res.status(201).json({ message: await svc.sendAsCoordinator(req.user!.userId, reqId(req), body(req)) });
}));
messagesRouter.post('/conversations/:id/read', ...coordinatorOnly, asyncHandler(async (req, res) => {
  await svc.markConversationRead(req.user!.userId, reqId(req));
  res.json({ ok: true });
}));
