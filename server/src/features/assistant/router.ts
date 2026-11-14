/**
 * Feature 13 — Coach, the student AI assistant.
 *
 *   GET  /api/assistant/config   → is Coach set up? + welcome text + starter chips
 *   POST /api/assistant/chat     → streams Coach's reply (Server-Sent Events)
 *
 * Students only (plan §1). Coordinators / Super Admin / externals get 403.
 */
import { Router } from 'express';
import { asyncHandler } from '../../middleware/async.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { AppError, badRequest } from '../../middleware/errors.js';
import { db } from '../../db/index.js';
import { chatBodySchema } from './validators.js';
import { isAssistantConfigured } from './llm.js';
import { streamStudentChat, takeRateLimitSlot } from './service.js';
import { ASSISTANT_NAME, STARTER_CHIPS, safeFirstName, welcomeText } from './prompt.js';

export const assistantRouter = Router();
const studentOnly = [requireAuth, requireRole('STUDENT')] as const;

export const NOT_SET_UP_MESSAGE = "Coach isn't set up yet. You can reach the Coordinator in Messages.";

assistantRouter.get('/config', ...studentOnly, asyncHandler(async (req, res) => {
  const user = await db.selectFrom('app_user').select('full_name').where('user_id', '=', req.user!.userId).executeTakeFirst();
  res.json({
    configured: isAssistantConfigured(),
    name: ASSISTANT_NAME,
    welcome: welcomeText(safeFirstName(user?.full_name)),
    notSetUpMessage: NOT_SET_UP_MESSAGE,
    starterChips: STARTER_CHIPS,
  });
}));

assistantRouter.post('/chat', ...studentOnly, asyncHandler(async (req, res) => {
  if (!isAssistantConfigured()) {
    throw new AppError(503, NOT_SET_UP_MESSAGE, 'ASSISTANT_NOT_CONFIGURED');
  }
  const parsed = chatBodySchema.safeParse(req.body);
  if (!parsed.success) {
    throw badRequest(parsed.error.issues[0]?.message ?? 'Invalid message.', 'INVALID_MESSAGE');
  }
  const waitMinutes = takeRateLimitSlot(req.user!.userId);
  if (waitMinutes > 0) {
    throw new AppError(
      429,
      `You've sent a lot of messages in a short time. Please wait ${waitMinutes} minute${waitMinutes === 1 ? '' : 's'}, or reach the Coordinator in Messages.`,
      'RATE_LIMITED',
    );
  }
  await streamStudentChat(req.user!.userId, parsed.data.messages, res, (cb) => {
    res.on('close', () => { if (!res.writableEnded) cb(); });
  });
}));
