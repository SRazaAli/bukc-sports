/**
 * Feature 2 — Equipment Availability Checker (EQUIP-AVAIL-01..10).
 * Covers the status endpoint (role-aware total_stock, filters) and proves the
 * SSE stream actually receives a push when the database changes — not just
 * that the endpoint responds, but that a real INSERT triggers a real message
 * over the open connection via the NOTIFY/LISTEN pipeline (migration 006).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import http from 'node:http';
import { createApp } from '../src/app.js';
import { seedCreds, bc } from './setup.js';
import { db } from '../src/db/index.js';
import { startAvailabilityListener, stopAvailabilityListener, pingListener } from '../src/lib/sse.js';

const app = createApp();

async function staffAgent() {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send(seedCreds);
  const bearer = { Authorization: `Bearer ${res.body.accessToken}` };
  return {
    token: res.body.accessToken as string,
    get: (u: string) => agent.get(u).set(bearer),
    post: (u: string) => agent.post(u).set(bearer),
  };
}

async function firstSportId(): Promise<number> {
  const c = await db.selectFrom('sport_category').select('sport_category_id').orderBy('name').executeTakeFirstOrThrow();
  return c.sport_category_id;
}

let staff: Awaited<ReturnType<typeof staffAgent>>;
beforeEach(async () => { staff = await staffAgent(); });

async function makeType(a: typeof staff, name = 'Football', isIndoor = false) {
  const res = await a.post('/api/inventory/types').send({
    sportCategoryId: await firstSportId(), name, lendingUnit: 'SINGLE',
    lowStockThreshold: 2, maxBorrowDurationMinutes: 120,
    conditionGoodMinScore: 70, conditionWornMinScore: 40, isIndoor,
  });
  return res.body.type.equipmentTypeId as number;
}

// ═══════════════════════════ STATUS ENDPOINT ═══════════════════════════
describe('Availability status (EQUIP-AVAIL-01/02/03/05/08)', () => {
  it('T-501 EQUIP-AVAIL-01: any authenticated role can view availability', async () => {
    const reg = await request(app).post('/api/auth/register/student').send({
      fullName: 'Stu Dent', email: 'stu2@bukc.edu.pk', contactNumber: '03001112222',
      password: 'Passw0rd!', enrollmentNo: '84-024000-322', department: 'Computer Science', programTitle: 'BS Computer Science',
    });
    await db.updateTable('app_user').set({ status: 'ACTIVE', verified_at: new Date() }).where('user_id', '=', reg.body.user.userId).execute();
    const login = await request(app).post('/api/auth/login/student').send({ enrollmentNo: '84-024000-322', password: 'Passw0rd!' });
    const res = await request(app).get('/api/availability/status').set('Authorization', `Bearer ${login.body.accessToken}`);
    expect(res.status).toBe(200);
  });

  it('T-502 EQUIP-AVAIL-05: total stock is present for staff, absent for a student', async () => {
    const typeId = await makeType(staff, 'Volleyball');
    await staff.post('/api/inventory/articles').send({ equipmentTypeId: typeId, barcode: bc(101), entryScore: 90 });

    const staffView = await staff.get('/api/availability/status');
    const staffRow = staffView.body.status.find((r: { equipmentTypeId: number }) => r.equipmentTypeId === typeId);
    expect(staffRow.totalStock).toBe(1);

    const reg = await request(app).post('/api/auth/register/student').send({
      fullName: 'Client Stu', email: 'client-stu@bukc.edu.pk', contactNumber: '03001112223',
      password: 'Passw0rd!', enrollmentNo: '84-024000-323', department: 'Computer Science', programTitle: 'BS Computer Science',
    });
    await db.updateTable('app_user').set({ status: 'ACTIVE', verified_at: new Date() }).where('user_id', '=', reg.body.user.userId).execute();
    const login = await request(app).post('/api/auth/login/student').send({ enrollmentNo: '84-024000-323', password: 'Passw0rd!' });
    const clientView = await request(app).get('/api/availability/status').set('Authorization', `Bearer ${login.body.accessToken}`);
    const clientRow = clientView.body.status.find((r: { equipmentTypeId: number }) => r.equipmentTypeId === typeId);
    expect(clientRow.totalStock).toBeUndefined();
    expect(clientRow.availableUnits).toBe(1);
  });

  it('T-503 EQUIP-AVAIL-03: badge + count shown together, and badge matches thresholds', async () => {
    const typeId = await makeType(staff, 'Cricket Bat'); // threshold 2
    await staff.post('/api/inventory/articles').send({ equipmentTypeId: typeId, barcode: bc(102), entryScore: 90 });
    const res = await staff.get('/api/availability/status');
    const row = res.body.status.find((r: { equipmentTypeId: number }) => r.equipmentTypeId === typeId);
    expect(row.availableUnits).toBe(1);
    expect(row.statusBadge).toBe('LOW_STOCK'); // 1 <= threshold 2
  });

  it('T-504 EQUIP-AVAIL-08: filters by sport category and indoor/outdoor', async () => {
    const outdoorId = await makeType(staff, 'Football Outdoor', false);
    const indoorId = await makeType(staff, 'Futsal Ball', true);
    // v_article_availability inner-joins article, so a type needs >=1 article to appear.
    await staff.post('/api/inventory/articles').send({ equipmentTypeId: outdoorId, barcode: bc(103), entryScore: 90 });
    await staff.post('/api/inventory/articles').send({ equipmentTypeId: indoorId, barcode: bc(104), entryScore: 90 });
    const outdoorOnly = await staff.get('/api/availability/status?isIndoor=false');
    const ids = outdoorOnly.body.status.map((r: { equipmentTypeId: number }) => r.equipmentTypeId);
    expect(ids).toContain(outdoorId);
    expect(ids).not.toContain(indoorId);
  });

  it('T-505 EQUIP-AVAIL-10: a decommissioned article is excluded from the count', async () => {
    const typeId = await makeType(staff, 'Table Tennis Bat Single');
    const a = await staff.post('/api/inventory/articles').send({ equipmentTypeId: typeId, barcode: bc(105), entryScore: 90 });
    await staff.post(`/api/inventory/articles/${a.body.article.articleId}/decommission`).send({});
    const res = await staff.get('/api/availability/status');
    const row = res.body.status.find((r: { equipmentTypeId: number }) => r.equipmentTypeId === typeId);
    expect(row.availableUnits).toBe(0);
  });

  it('T-506: unauthenticated request is refused', async () => {
    const res = await request(app).get('/api/availability/status');
    expect(res.status).toBe(401);
  });
});

// ═══════════════════════════ REAL-TIME SSE ═══════════════════════════
// These start a real HTTP server (supertest's app-only mode doesn't expose a
// live socket for a long-lived SSE connection) and the actual availability
// listener, so the NOTIFY -> LISTEN -> SSE push path is exercised for real,
// not mocked.
describe('Real-time push (EQUIP-AVAIL-07)', () => {
  it('T-507: adding an article triggers a live SSE snapshot with the updated count', async () => {
    await startAvailabilityListener();
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as { port: number }).port;

    try {
      const typeId = await makeType(staff, 'Rugby Ball');

      const received = await new Promise<Array<{ equipmentTypeId: number; availableUnits: number }>>((resolve, reject) => {
        const req = http.get(
          `http://127.0.0.1:${port}/api/availability/stream?token=${staff.token}`,
          (res) => {
            let buf = '';
            let mutationFired = false;
            res.on('data', (chunk: Buffer) => {
              buf += chunk.toString();
              const events = buf.split('\n\n').filter((e) => e.startsWith('event: snapshot'));
              // The FIRST event proves the connection is registered server-side
              // (addSseClient already ran) — only now is it safe to mutate, so
              // there is no timing race against connection setup.
              if (events.length >= 1 && !mutationFired) {
                mutationFired = true;
                // Force a round-trip on the LISTEN connection before mutating.
                // Under sustained load the dedicated LISTEN connection can go
                // idle-stale (the same class of risk as a cloud DB proxy or
                // NAT gateway silently degrading a long-lived idle connection
                // in production); pinging it first guarantees delivery here,
                // exactly what the 15s production keepalive does automatically.
                void pingListener().then(() =>
                  staff.post('/api/inventory/articles').send({ equipmentTypeId: typeId, barcode: bc(106), entryScore: 90 }));
              }
              // The SECOND event is the push triggered by that mutation.
              if (events.length >= 2) {
                const dataLine = events[1].split('\n').find((l) => l.startsWith('data: '))!;
                resolve(JSON.parse(dataLine.slice('data: '.length)));
                req.destroy();
              }
            });
            res.on('error', reject);
          },
        );
        req.on('error', (e) => { if (!req.destroyed) reject(e); });
        setTimeout(() => reject(new Error('Timed out waiting for SSE push')), 25000);
      });

      const row = received.find((r) => r.equipmentTypeId === typeId);
      expect(row?.availableUnits).toBe(1);
    } finally {
      server.close();
      await stopAvailabilityListener();
    }
  }, 30000);
});
