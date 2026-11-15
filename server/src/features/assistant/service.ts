/**
 * Feature 13 — Coach. Chat orchestration (Step 2: rulebook only, no tools yet).
 *
 * Flow per message: load the student's name → build the system prompt →
 * stream the model's reply to the browser as Server-Sent Events.
 *
 * SSE events sent on POST /api/assistant/chat:
 *   status  { text }            e.g. "Checking venue slots…" (used from Step 3)
 *   delta   { text }            a chunk of the answer
 *   actions { actions: [...] }  buttons under the answer (used from Step 5)
 *   error   { code, message }   UNAVAILABLE | INTERRUPTED | TIMEOUT
 *   done    { }
 *
 * Never logs message text (plan §6) — only model, duration and outcome.
 */
import type { Response } from 'express';
import { db } from '../../db/index.js';
import { buildStudentSystemPrompt } from './prompt.js';
import { streamReply, LlmError, type ChatTurn } from './llm.js';
import { MAX_HISTORY_TURNS } from './validators.js';

export const REPLY_TIMEOUT_MS = 25_000;

// ── per-student rate limit: 20 messages / 10 minutes (in memory) ──────────────
export const RATE_LIMIT = { max: 20, windowMs: 10 * 60_000 };
const sentAt = new Map<string, number[]>();

/** Records a message; returns minutes to wait if the student is over the limit, else 0. */
export function takeRateLimitSlot(userId: string, now = Date.now()): number {
  const recent = (sentAt.get(userId) ?? []).filter((t) => now - t < RATE_LIMIT.windowMs);
  if (recent.length >= RATE_LIMIT.max) {
    sentAt.set(userId, recent);
    const waitMs = RATE_LIMIT.windowMs - (now - recent[0]!);
    return Math.max(1, Math.ceil(waitMs / 60_000));
  }
  recent.push(now);
  sentAt.set(userId, recent);
  return 0;
}

/** Test helper. */
export function resetRateLimits() {
  sentAt.clear();
}

/** Keep the last N turns and make sure the conversation starts with the student. */
export function trimHistory(messages: ChatTurn[]): ChatTurn[] {
  const tail = messages.slice(-MAX_HISTORY_TURNS);
  while (tail.length > 1 && tail[0]!.role !== 'user') tail.shift();
  return tail;
}

export const ERROR_MESSAGES = {
  UNAVAILABLE: 'Coach is unavailable right now. You can still reach the Coordinator in Messages.',
  INTERRUPTED: 'Sorry, my answer was interrupted. Please ask again.',
  TIMEOUT: 'Sorry, that took too long. Please ask again, or reach the Coordinator in Messages.',
} as const;

function sse(res: Response, event: string, data: unknown) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export async function streamStudentChat(userId: string, messages: ChatTurn[], res: Response, onClientGone: (cb: () => void) => void) {
  const user = await db.selectFrom('app_user').select('full_name').where('user_id', '=', userId).executeTakeFirst();
  const system = buildStudentSystemPrompt({ fullName: user?.full_name });
  const history = trimHistory(messages);

  res.status(200).set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // stop proxies (e.g. Render/nginx) from buffering the stream
  });
  res.flushHeaders();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REPLY_TIMEOUT_MS);
  let clientGone = false;
  onClientGone(() => { clientGone = true; controller.abort(); });

  const started = Date.now();
  try {
    const { model } = await streamReply({
      system,
      history,
      signal: controller.signal,
      onText: (text) => { if (!clientGone) sse(res, 'delta', { text }); },
    });
    console.info(`[assistant] ok model=${model} ms=${Date.now() - started}`);
    if (!clientGone) sse(res, 'done', {});
  } catch (err) {
    const kind = err instanceof LlmError ? err.kind : 'UNAVAILABLE';
    console.warn(`[assistant] fail kind=${clientGone ? 'CLIENT_CLOSED' : kind} ms=${Date.now() - started}`);
    if (!clientGone) {
      sse(res, 'error', { code: kind, message: ERROR_MESSAGES[kind] });
      sse(res, 'done', {});
    }
  } finally {
    clearTimeout(timer);
    res.end();
  }
}
