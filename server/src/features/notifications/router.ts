/**
 * Notification inbox routes. Every endpoint is scoped to the caller's own
 * notifications — there's no admin "view anyone's inbox" here by design,
 * this is personal, not a management surface.
 */
import { Router } from 'express';
import * as svc from './service.js';
import { requireAuth } from '../../middleware/auth.js';
import { asyncHandler } from '../../middleware/async.js';
import { badRequest } from '../../middleware/errors.js';

export const notificationsRouter = Router();

function reqId(req: { params: Record<string, string | undefined> }): string {
  const id = req.params.id;
  if (!id) throw badRequest('Missing id');
  return id;
}

notificationsRouter.get('/', requireAuth, asyncHandler(async (req, res) => {
  const limit = req.query.limit ? Math.min(Number(req.query.limit), 100) : 20;
  res.json({ notifications: await svc.listMyNotifications(req.user!.userId, limit) });
}));

notificationsRouter.get('/unread-count', requireAuth, asyncHandler(async (req, res) => {
  res.json({ count: await svc.unreadCount(req.user!.userId) });
}));

notificationsRouter.post('/:id/read', requireAuth, asyncHandler(async (req, res) => {
  await svc.markRead(reqId(req), req.user!.userId);
  res.json({ message: 'Marked as read.' });
}));

notificationsRouter.post('/read-all', requireAuth, asyncHandler(async (req, res) => {
  await svc.markAllRead(req.user!.userId);
  res.json({ message: 'All notifications marked as read.' });
}));
