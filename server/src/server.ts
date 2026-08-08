/**
 * HTTP bootstrap. Starts the Express app and the availability SSE hub's
 * dedicated Postgres LISTEN connection (Feature 2).
 */
import { createApp } from './app.js';
import { config } from './config/index.js';
import { pool } from './db/index.js';
import { startAvailabilityListener, stopAvailabilityListener } from './lib/sse.js';
import { checkOverdueBorrows } from './features/borrow/service.js';
import { checkEquipmentLocks, checkPostEventRelease } from './features/venue/equipment.js';

const app = createApp();

const server = app.listen(config.PORT, () => {
  console.log(`BUKC Sports API listening on :${config.PORT} (${config.NODE_ENV})`);
});

startAvailabilityListener().catch((err) => {
  console.error('Failed to start availability SSE hub:', err);
});

// BORROW-18: poll for transactions past their agreed return time and flip
// them to OVERDUE + notify Coordinators. Also runs opportunistically when the
// queue/active-borrows endpoints are read, so this interval only needs to
// catch cases nobody happens to be viewing.
const overdueInterval = setInterval(() => {
  checkOverdueBorrows().catch((err) => console.error('checkOverdueBorrows failed:', err));
}, 5 * 60_000);

// EQUIP-AVAIL-11/12: poll for sessions crossing their T-24hr equipment lock
// boundary and lock the allocation (alerting the Coordinator only if short —
// EQUIP-AVAIL-19, silence is confirmation).
const lockInterval = setInterval(() => {
  checkEquipmentLocks().catch((err) => console.error('checkEquipmentLocks failed:', err));
}, 5 * 60_000);

// EQUIP-AVAIL-18/20, VENUE-32/33: poll for sessions whose end time has
// passed, release their locked equipment, and complete the parent booking
// once every one of its sessions has concluded.
const releaseInterval = setInterval(() => {
  checkPostEventRelease().catch((err) => console.error('checkPostEventRelease failed:', err));
}, 5 * 60_000);

// Graceful shutdown so the DB pool and LISTEN connection close cleanly.
async function shutdown(signal: string) {
  console.log(`\n${signal} received, shutting down...`);
  clearInterval(overdueInterval);
  clearInterval(lockInterval);
  clearInterval(releaseInterval);
  server.close(async () => {
    await stopAvailabilityListener();
    await pool.end();
    process.exit(0);
  });
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
