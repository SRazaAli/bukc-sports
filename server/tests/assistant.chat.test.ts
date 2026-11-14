/**
 * Feature 13 — Coach, Step 2: chat endpoint (streaming, rulebook only).
 *
 * The Gemini call is mocked — these tests never use a real key or quota.
 * Covered: role guard, not-set-up state, validation, streaming SSE format,
 * fallback/unavailable/interrupted errors, history trimming, rate limit,
 * and that the system prompt carries the rulebook + the student's first name.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';

const mocks = vi.hoisted(() => ({
  configured: true,
  streamReply: vi.fn(),
}));

vi.mock('../src/features/assistant/llm.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/features/assistant/llm.js')>();
  return {
    ...actual,
    isAssistantConfigured: () => mocks.configured,
    streamReply: mocks.streamReply,
  };
});

import { createApp } from '../src/app.js';
import { seedCreds } from './setup.js';
import { LlmError } from '../src/features/assistant/llm.js';
import { resetRateLimits, RATE_LIMIT, trimHistory } from '../src/features/assistant/service.js';

const app = createApp();

async function staffAgent() {
  const res = await request(app).post('/api/auth/login').send(seedCreds);
  const bearer = { Authorization: `Bearer ${res.body.accessToken}` };
  return {
    get: (u: string) => request(app).get(u).set(bearer),
    post: (u: string) => request(app).post(u).set(bearer),
  };
}

let n = 0;
async function studentAgent(staff: Awaited<ReturnType<typeof staffAgent>>) {
  n += 1;
  const enrollmentNo = `85-200${n.toString().padStart(3, '0')}-100`;
  const reg = await request(app).post('/api/auth/register/student').send({
    fullName: 'Hamza Khan', email: `coach.stu${n}@bukc.edu.pk`, contactNumber: '03001112222',
    password: 'Passw0rd!', enrollmentNo, department: 'Computer Science', programTitle: 'BS Computer Science',
  });
  await staff.post('/api/auth/admin/verify').send({ userId: reg.body.user.userId });
  const login = await request(app).post('/api/auth/login/student').send({ enrollmentNo, password: 'Passw0rd!' });
  const bearer = { Authorization: `Bearer ${login.body.accessToken}` };
  return {
    get: (u: string) => request(app).get(u).set(bearer),
    post: (u: string) => request(app).post(u).set(bearer),
  };
}

/** Parses an SSE body into [{event, data}] */
function parseSse(body: string) {
  return body.trim().split('\n\n').filter(Boolean).map((block) => {
    const event = /^event: (.*)$/m.exec(block)?.[1];
    const data = JSON.parse(/^data: (.*)$/m.exec(block)?.[1] ?? 'null');
    return { event, data };
  });
}

const ask = (text: string) => ({ messages: [{ role: 'user', text }] });

beforeEach(() => {
  mocks.configured = true;
  mocks.streamReply.mockReset();
  resetRateLimits();
});

describe('Coach chat — access (plan §1)', () => {
  it('T-1301: no token → 401', async () => {
    const res = await request(app).post('/api/assistant/chat').send(ask('hi'));
    expect(res.status).toBe(401);
  });

  it('T-1302: Super Admin is refused (students only) → 403', async () => {
    const staff = await staffAgent();
    const res = await staff.post('/api/assistant/chat').send(ask('hi'));
    expect(res.status).toBe(403);
    expect(mocks.streamReply).not.toHaveBeenCalled();
  });

  it('T-1303: GET /config returns welcome with first name only + starter chips', async () => {
    const stu = await studentAgent(await staffAgent());
    const res = await stu.get('/api/assistant/config');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ configured: true, name: 'Coach' });
    expect(res.body.welcome).toMatch(/^Hi Hamza! I'm Coach/);
    expect(res.body.starterChips).toHaveLength(4);
  });
});

describe('Coach chat — not set up (plan §3)', () => {
  it('T-1304: no key → 503 with the agreed message; config says configured=false', async () => {
    mocks.configured = false;
    const stu = await studentAgent(await staffAgent());
    const res = await stu.post('/api/assistant/chat').send(ask('hi'));
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ code: 'ASSISTANT_NOT_CONFIGURED' });
    expect(res.body.error).toMatch(/isn't set up yet.*Messages/);
    const cfg = await stu.get('/api/assistant/config');
    expect(cfg.body.configured).toBe(false);
  });
});

describe('Coach chat — validation (plan §6)', () => {
  it('T-1305: rejects an empty, too-long, or non-student-last message', async () => {
    const stu = await studentAgent(await staffAgent());
    expect((await stu.post('/api/assistant/chat').send(ask('   '))).status).toBe(400);
    expect((await stu.post('/api/assistant/chat').send(ask('x'.repeat(1001)))).status).toBe(400);
    const lastIsModel = await stu.post('/api/assistant/chat').send({
      messages: [{ role: 'user', text: 'hi' }, { role: 'model', text: 'hello' }],
    });
    expect(lastIsModel.status).toBe(400);
    expect(mocks.streamReply).not.toHaveBeenCalled();
  });

  it('T-1306: history is trimmed to the last 12 turns and starts with the student', () => {
    const turns = Array.from({ length: 20 }, (_, i) => ({ role: (i % 2 === 0 ? 'user' : 'model') as 'user' | 'model', text: `t${i}` }));
    turns.push({ role: 'user', text: 'last' });
    const trimmed = trimHistory(turns);
    expect(trimmed.length).toBeLessThanOrEqual(12);
    expect(trimmed[0]!.role).toBe('user');
    expect(trimmed[trimmed.length - 1]!.text).toBe('last');
  });
});

describe('Coach chat — streaming (plan §3)', () => {
  it('T-1307: streams delta events then done; prompt has rulebook + first name', async () => {
    mocks.streamReply.mockImplementation(async (opts: { onText: (t: string) => void }) => {
      opts.onText('Hello ');
      opts.onText('Hamza!');
      return { model: 'mock-model' };
    });
    const stu = await studentAgent(await staffAgent());
    const res = await stu.post('/api/assistant/chat').send(ask('hi'));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/event-stream/);
    const events = parseSse(res.text);
    expect(events.map((e) => e.event)).toEqual(['delta', 'delta', 'done']);
    expect(events.filter((e) => e.event === 'delta').map((e) => e.data.text).join('')).toBe('Hello Hamza!');

    const call = mocks.streamReply.mock.calls[0]![0] as { system: string; history: unknown[] };
    expect(call.system).toContain('STUDENT named Hamza.');
    expect(call.system).toContain('Rulebook for Coach (students)');
    expect(call.history).toEqual([{ role: 'user', text: 'hi' }]);
  });

  it('T-1308: both models unavailable → error event with the agreed message', async () => {
    mocks.streamReply.mockRejectedValue(new LlmError('UNAVAILABLE', 'x'));
    const stu = await studentAgent(await staffAgent());
    const events = parseSse((await stu.post('/api/assistant/chat').send(ask('hi'))).text);
    expect(events[0]).toMatchObject({ event: 'error', data: { code: 'UNAVAILABLE' } });
    expect(events[0]!.data.message).toMatch(/unavailable right now.*Messages/);
    expect(events[1]!.event).toBe('done');
  });

  it('T-1309: failure mid-answer → text so far, then INTERRUPTED error', async () => {
    mocks.streamReply.mockImplementation(async (opts: { onText: (t: string) => void }) => {
      opts.onText('Partial');
      throw new LlmError('INTERRUPTED', 'x');
    });
    const stu = await studentAgent(await staffAgent());
    const events = parseSse((await stu.post('/api/assistant/chat').send(ask('hi'))).text);
    expect(events.map((e) => e.event)).toEqual(['delta', 'error', 'done']);
    expect(events[1]!.data.code).toBe('INTERRUPTED');
  });
});

describe('Coach chat — rate limit (plan §6)', () => {
  it('T-1310: the 21st message within 10 minutes is refused with a wait time', async () => {
    mocks.streamReply.mockResolvedValue({ model: 'mock-model' });
    const stu = await studentAgent(await staffAgent());
    for (let i = 0; i < RATE_LIMIT.max; i++) {
      expect((await stu.post('/api/assistant/chat').send(ask(`q${i}`))).status).toBe(200);
    }
    const res = await stu.post('/api/assistant/chat').send(ask('one more'));
    expect(res.status).toBe(429);
    expect(res.body.code).toBe('RATE_LIMITED');
    expect(res.body.error).toMatch(/Please wait \d+ minutes?, or reach the Coordinator in Messages\./);
  });
});
