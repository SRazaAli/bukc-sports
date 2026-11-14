/**
 * Feature 13 — Coach. Client for /api/assistant.
 *
 * The chat reply is a stream (Server-Sent Events over a POST), so it can't go
 * through api() — that helper reads the whole body as JSON. streamCoachReply()
 * does its own fetch, with the same auth rules: Bearer token from memory, and
 * one transparent refresh-and-retry on 401 (safe here because a 401 arrives
 * before any of the stream is read).
 */
import { api, getAccessToken, setAccessToken, refreshSession } from '../../lib/api.js';

const API_BASE = import.meta.env.VITE_API_BASE ?? '';

export interface CoachConfig {
  configured: boolean;
  name: string;
  welcome: string;
  notSetUpMessage: string;
  starterChips: string[];
}

export function getCoachConfig(): Promise<CoachConfig> {
  return api<CoachConfig>('/api/assistant/config');
}

export interface CoachTurn {
  role: 'user' | 'model';
  text: string;
}

export interface CoachAction {
  label: string;
  href: string;
}

export interface StreamHandlers {
  onStatus?: (text: string) => void;
  onDelta: (text: string) => void;
  onActions?: (actions: CoachAction[]) => void;
}

/** Thrown for anything that ends the reply with a message for the student. */
export class CoachError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = 'CoachError';
  }
}

const GENERIC_ERROR = 'Coach is unavailable right now. You can still reach the Coordinator in Messages.';

async function postChat(messages: CoachTurn[], signal: AbortSignal, isRetry = false): Promise<Response> {
  const token = getAccessToken();
  const res = await fetch(`${API_BASE}/api/assistant/chat`, {
    method: 'POST',
    credentials: 'include',
    signal,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ messages }),
  });
  if (res.status === 401 && !isRetry && token) {
    const refreshed = await refreshSession();
    if (refreshed) {
      setAccessToken(refreshed.accessToken);
      return postChat(messages, signal, true);
    }
  }
  return res;
}

/**
 * Sends the conversation and streams Coach's reply into the handlers.
 * Resolves when the reply is complete; throws CoachError if it ends with an error.
 */
export async function streamCoachReply(messages: CoachTurn[], handlers: StreamHandlers, signal: AbortSignal): Promise<void> {
  let res: Response;
  try {
    res = await postChat(messages, signal);
  } catch (e) {
    if (signal.aborted) throw e;
    throw new CoachError('NETWORK', "Couldn't reach Coach. Check your connection and try again.");
  }

  if (!res.ok || !res.body) {
    let body: { error?: string; code?: string } = {};
    try { body = await res.json(); } catch { /* not JSON */ }
    throw new CoachError(body.code ?? `HTTP_${res.status}`, body.error ?? GENERIC_ERROR);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let failure: CoachError | null = null;

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const event = /^event: (.*)$/m.exec(block)?.[1];
      const raw = /^data: (.*)$/m.exec(block)?.[1];
      if (!event || raw === undefined) continue;
      let data: Record<string, unknown>;
      try { data = JSON.parse(raw); } catch { continue; }
      if (event === 'delta' && typeof data.text === 'string') handlers.onDelta(data.text);
      else if (event === 'status' && typeof data.text === 'string') handlers.onStatus?.(data.text);
      else if (event === 'actions' && Array.isArray(data.actions)) handlers.onActions?.(data.actions as CoachAction[]);
      else if (event === 'error') {
        failure = new CoachError(String(data.code ?? 'UNAVAILABLE'), String(data.message ?? GENERIC_ERROR));
      }
    }
  }
  if (failure) throw failure;
}
