/**
 * Equipment availability routes (Feature 2). EQUIP-AVAIL-01: open to every
 * authenticated role (Student, External, Coordinator, Super Admin) — read-only,
 * no borrow action lives here (that's Feature 3).
 */
import { Router } from 'express';
import { asyncHandler } from '../../middleware/async.js';
import { requireAuth, requireAuthSSE } from '../../middleware/auth.js';
import { badRequest } from '../../middleware/errors.js';
import { addSseClient, removeSseClient } from '../../lib/sse.js';
import * as svc from './service.js';
import { availabilityFilterSchema } from './validators.js';

export const availabilityRouter = Router();

// EQUIP-AVAIL-08: filterable by sport category, equipment type, indoor/outdoor.
availabilityRouter.get('/status', requireAuth, asyncHandler(async (req, res) => {
  const parsed = availabilityFilterSchema.safeParse(req.query);
  if (!parsed.success) throw badRequest('Invalid filter parameters.');
  const rows = await svc.listAvailability(parsed.data, req.user!.role);
  res.json({ status: rows });
}));

// EQUIP-AVAIL-07: SSE stream. Token via query param (see requireAuthSSE) since
// native EventSource cannot set an Authorization header.
availabilityRouter.get('/stream', requireAuthSSE, asyncHandler(async (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no', // disable proxy buffering if fronted by nginx
  });
  res.flushHeaders();

  // Register BEFORE writing anything. If addSseClient ran after res.write(),
  // a client could theoretically observe the first byte before the server
  // finished registering it in the broadcast map — a race between "client
  // saw data" and "server thinks it's subscribed". Registering first makes
  // that ordering impossible by construction.
  addSseClient(res, req.user!.role);

  // Initial snapshot immediately on connect, role-shaped.
  const initial = await svc.listAvailability({}, req.user!.role);
  res.write(`event: snapshot\ndata: ${JSON.stringify(initial)}\n\n`);

  // Heartbeat comment every 20s keeps the connection alive through proxies.
  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 20000);

  req.on('close', () => {
    clearInterval(heartbeat);
    removeSseClient(res);
  });
}));
