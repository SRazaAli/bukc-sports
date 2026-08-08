/**
 * Real-time availability hub (EQUIP-AVAIL-07).
 *
 * A single dedicated `pg` Client (NOT from the Kysely pool — pooled connections
 * get recycled and would drop a LISTEN silently) holds `LISTEN
 * equipment_availability` for the process lifetime. Every article/allocation
 * change fires a Postgres NOTIFY (migration 006); on each one we re-fetch a
 * full status snapshot and push it to every open SSE connection. Re-querying
 * the whole (small) equipment-type list is simpler and more robust than
 * diffing, and cheap at this data size.
 *
 * Resilience: a LISTEN connection can go silently dead (network blip, DB
 * restart, connection pooler recycling it) without ever emitting a Node
 * 'error' event. Relying only on 'error' to trigger reconnect leaves a gap
 * where the hub looks alive but stops receiving notifications. We close that
 * gap two ways: reconnect on 'end' as well as 'error', and an active
 * keepalive probe (SELECT 1 every 30s) that reconnects if the probe itself
 * fails — catching a dead socket proactively rather than waiting on it.
 */
import { Client } from 'pg';
import type { Response } from 'express';
import { config } from '../config/index.js';
import { listAvailability } from '../features/availability/service.js';
import type { UserRole } from '../db/index.js';

const clients = new Map<Response, UserRole>();

export function addSseClient(res: Response, role: UserRole) {
  clients.set(res, role);
}
export function removeSseClient(res: Response) {
  clients.delete(res);
}

async function broadcastSnapshot() {
  if (clients.size === 0) return;
  // EQUIP-AVAIL-05: total stock is staff-only. Compute each shape once and
  // send the right one per connection rather than re-querying per client.
  const [staffSnapshot, clientSnapshot] = await Promise.all([
    listAvailability({}, 'SUPER_ADMIN'),
    listAvailability({}, 'STUDENT'),
  ]);
  const staffPayload = `event: snapshot\ndata: ${JSON.stringify(staffSnapshot)}\n\n`;
  const clientPayload = `event: snapshot\ndata: ${JSON.stringify(clientSnapshot)}\n\n`;
  for (const [res, role] of clients) {
    const staff = role === 'SUPER_ADMIN' || role === 'COORDINATOR';
    res.write(staff ? staffPayload : clientPayload);
  }
}

let listener: Client | null = null;
let keepaliveTimer: ReturnType<typeof setInterval> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let stopping = false;

function scheduleReconnect(reason: string) {
  if (stopping || reconnectTimer) return; // don't stack reconnects
  console.error(`Availability LISTEN connection lost (${reason}), reconnecting in 2s...`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void startAvailabilityListener();
  }, 2000);
}

export async function startAvailabilityListener() {
  stopping = false;
  if (keepaliveTimer) clearInterval(keepaliveTimer);

  listener = new Client({
    connectionString: config.DATABASE_URL,
    ssl: config.DATABASE_URL.includes('neon.tech') ? { rejectUnauthorized: false } : undefined,
  });

  listener.on('notification', () => {
    
    void broadcastSnapshot();
  });
  listener.on('error', (err) => scheduleReconnect(err.message));
  listener.on('end', () => scheduleReconnect('connection ended'));

  await listener.connect();
  await listener.query('LISTEN equipment_availability');
  console.log('Availability SSE hub: listening for equipment_availability notifications.');

  // Active keepalive: a dead socket that never surfaces 'error'/'end' would
  // otherwise leave the hub silently deaf. A failed probe forces a reconnect.
  keepaliveTimer = setInterval(() => {
    listener?.query('SELECT 1').catch((err: Error) => scheduleReconnect(`keepalive failed: ${err.message}`));
  }, 15000);
}

/**
 * Force an immediate round-trip on the LISTEN connection. Exported for tests
 * that need a deterministic "the connection is definitely fresh" point, and
 * usable as a manual health check. The periodic keepalive above does the same
 * thing automatically every 15s in normal operation.
 */
export async function pingListener(): Promise<void> {
  await listener?.query('SELECT 1');
}

export async function stopAvailabilityListener() {
  stopping = true;
  if (keepaliveTimer) { clearInterval(keepaliveTimer); keepaliveTimer = null; }
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  for (const [res] of clients) res.end();
  clients.clear();
  await listener?.end().catch(() => { /* already closed */ });
}
