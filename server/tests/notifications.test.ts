/**
 * Feature 8 groundwork — notification inbox (read side) + AUTH-20 write-side
 * verification. The write side for Borrow/Venue notifications is exercised
 * indirectly by their own test suites; this focuses on the inbox API itself
 * and the account-lifecycle notifications (verify/deactivate/reactivate).
 */
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { seedCreds } from './setup.js';
import { db } from '../src/db/index.js';

const app = createApp();

async function superAdminAgent() {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send(seedCreds);
  const bearer = { Authorization: `Bearer ${res.body.accessToken}` };
  return { get: (u: string) => agent.get(u).set(bearer), post: (u: string) => agent.post(u).set(bearer) };
}

let counter = 0;
function uniqueEmail(prefix = 'notif') {
  counter += 1;
  return `${prefix}.${Date.now()}.${counter}@bukc.edu.pk`;
}

async function activeStudent() {
  const superAgent = await superAdminAgent();
  const email = uniqueEmail();
  const password = 'StudentPass1';
  const enrollmentNo = `84-${String(100000 + counter).padStart(6, '0')}-${String(counter).padStart(3, '0')}`;
  const reg = await request(app).post('/api/auth/register/student').send({
    fullName: 'Notif Test', email, contactNumber: '03001112222', password,
    enrollmentNo, department: 'Computer Science', programTitle: 'BS Computer Science',
  });
  const userId = reg.body.user.userId;
  await superAgent.post('/api/auth/admin/verify').send({ userId });
  const login = await request(app).post('/api/auth/login').send({ email, password });
  const bearer = { Authorization: `Bearer ${login.body.accessToken}` };
  return {
    userId, email, password, superAgent,
    get: (u: string) => request(app).get(u).set(bearer),
    post: (u: string) => request(app).post(u).set(bearer),
  };
}

describe('Notification inbox (AUTH-20 + Feature 8 groundwork)', () => {
  it('T-N01 AUTH-20: verifying an account writes an in-app ACCOUNT_VERIFIED notification', async () => {
    const s = await activeStudent(); // verification already happened inside the helper
    const list = await s.get('/api/notifications');
    expect(list.status).toBe(200);
    expect(list.body.notifications.some((n: { type: string }) => n.type === 'ACCOUNT_VERIFIED')).toBe(true);
  });

  it('T-N02: deactivating and reactivating an account each write their own notification', async () => {
    const s = await activeStudent();
    await s.superAgent.post('/api/auth/admin/deactivate').send({ userId: s.userId });
    await s.superAgent.post('/api/auth/admin/reactivate').send({ userId: s.userId });

    const rows = await db.selectFrom('notification').select('type')
      .where('recipient_id', '=', s.userId).execute();
    const types = rows.map((r) => r.type);
    expect(types).toContain('ACCOUNT_DEACTIVATED');
    expect(types).toContain('ACCOUNT_REACTIVATED');
  });

  it('T-N03: unread count reflects new notifications and drops after marking read', async () => {
    const s = await activeStudent();
    const before = await s.get('/api/notifications/unread-count');
    expect(before.body.count).toBeGreaterThanOrEqual(1); // the verify notification

    const list = await s.get('/api/notifications');
    const id = list.body.notifications[0].notificationId;
    const mark = await s.post(`/api/notifications/${id}/read`);
    expect(mark.status).toBe(200);

    const after = await s.get('/api/notifications/unread-count');
    expect(after.body.count).toBe(before.body.count - 1);
  });

  it('T-N04: mark-all-read clears the unread count entirely', async () => {
    const s = await activeStudent();
    await s.superAgent.post('/api/auth/admin/deactivate').send({ userId: s.userId });
    await s.superAgent.post('/api/auth/admin/reactivate').send({ userId: s.userId });

    const res = await s.post('/api/notifications/read-all');
    expect(res.status).toBe(200);
    const count = await s.get('/api/notifications/unread-count');
    expect(count.body.count).toBe(0);
  });

  it('T-N05: a user cannot mark someone else\'s notification as read', async () => {
    const a = await activeStudent();
    const b = await activeStudent();
    const listA = await a.get('/api/notifications');
    const idA = listA.body.notifications[0].notificationId;

    const res = await b.post(`/api/notifications/${idA}/read`);
    expect(res.status).toBe(404); // not theirs — treated as not found, no existence leak

    // and it's genuinely still unread for A
    const stillUnread = await db.selectFrom('notification').select('read_at')
      .where('notification_id', '=', idA).executeTakeFirst();
    expect(stillUnread?.read_at).toBeNull();
  });

  it('T-N06: unauthenticated requests to any notification route are rejected', async () => {
    const list = await request(app).get('/api/notifications');
    expect(list.status).toBe(401);
    const count = await request(app).get('/api/notifications/unread-count');
    expect(count.status).toBe(401);
    const readAll = await request(app).post('/api/notifications/read-all');
    expect(readAll.status).toBe(401);
  });

  it('T-N07: notifications are listed most-recent-first', async () => {
    const s = await activeStudent();
    await s.superAgent.post('/api/auth/admin/deactivate').send({ userId: s.userId });
    await s.superAgent.post('/api/auth/admin/reactivate').send({ userId: s.userId });

    const list = await s.get('/api/notifications');
    const timestamps = list.body.notifications.map((n: { createdAt: string }) => new Date(n.createdAt).getTime());
    const sorted = [...timestamps].sort((a, b) => b - a);
    expect(timestamps).toEqual(sorted);
  });
});
