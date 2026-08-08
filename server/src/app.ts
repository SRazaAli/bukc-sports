/**
 * Express app assembly. Feature routers mount here as they're built.
 * Kept separate from server.ts so tests can import the app without opening a port.
 */
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { allowedOrigins } from './config/index.js';
import { errorHandler } from './middleware/errors.js';
import { db } from './db/index.js';
import { sql } from 'kysely';
import { authRouter } from './features/auth/router.js';
import { inventoryRouter } from './features/inventory/router.js';
import { availabilityRouter } from './features/availability/router.js';
import { borrowRouter } from './features/borrow/router.js';
import { venueRouter } from './features/venue/router.js';
import { notificationsRouter } from './features/notifications/router.js';
import { historyRouter } from './features/history/router.js';
import { offlineRouter } from './features/offline/router.js';
import { dashboardRouter } from './features/dashboard/router.js';

export function createApp() {
  const app = express();

  app.use(
    cors({
      origin: allowedOrigins,
      credentials: true, // refresh-token cookie
    }),
  );
  app.use(express.json());
  app.use(cookieParser());

  // Liveness + DB reachability
  app.get('/health', async (_req, res) => {
    try {
      await sql`SELECT 1`.execute(db);
      res.json({ status: 'ok', db: 'up' });
    } catch {
      res.status(503).json({ status: 'degraded', db: 'down' });
    }
  });

  // ── Feature routers ──
  app.use('/api/auth', authRouter); // Feature 1
  app.use('/api/inventory', inventoryRouter); // Feature 4
  app.use('/api/availability', availabilityRouter); // Feature 2
  app.use('/api/borrow', borrowRouter); // Feature 3
  app.use('/api/venue', venueRouter); // Feature 5
  app.use('/api/notifications', notificationsRouter);
  app.use('/api/history', historyRouter);   // Feature 10
  app.use('/api/offline', offlineRouter);   // Feature 11
  app.use('/api/dashboard', dashboardRouter); // Feature 12
  // ...

  // Error handler must be last
  app.use(errorHandler);

  return app;
}
