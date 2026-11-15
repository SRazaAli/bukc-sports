/**
 * Feature 13 — Coach. Thin wrapper around the Gemini API (@google/genai).
 *
 * This is the only file that knows which AI provider we use; swapping provider
 * means rewriting this file only.
 *
 * Fallback rule (plan §2/§3): try GEMINI_MODEL; if it fails BEFORE any text was
 * streamed (quota 429, 5xx, network), silently retry on GEMINI_FALLBACK_MODEL.
 * If it fails AFTER text was streamed, the answer is reported as interrupted.
 */
import { GoogleGenAI } from '@google/genai';
import { config, assistantConfigured } from '../../config/index.js';

export interface ChatTurn {
  role: 'user' | 'model';
  text: string;
}

export type LlmFailure = 'UNAVAILABLE' | 'INTERRUPTED' | 'TIMEOUT';

export class LlmError extends Error {
  constructor(public kind: LlmFailure, message: string) {
    super(message);
    this.name = 'LlmError';
  }
}

export function isAssistantConfigured(): boolean {
  return assistantConfigured;
}

let client: GoogleGenAI | null = null;
function getClient(): GoogleGenAI {
  if (!client) client = new GoogleGenAI({ apiKey: config.GEMINI_API_KEY });
  return client;
}

function modelsToTry(): string[] {
  return [...new Set([config.GEMINI_MODEL, config.GEMINI_FALLBACK_MODEL].filter(Boolean))];
}

/**
 * Streams one reply. Calls onText for every text chunk.
 * Resolves with the model that answered; throws LlmError otherwise.
 */
export async function streamReply(opts: {
  system: string;
  history: ChatTurn[];
  signal: AbortSignal;
  onText: (chunk: string) => void;
}): Promise<{ model: string }> {
  const contents = opts.history.map((t) => ({ role: t.role, parts: [{ text: t.text }] }));
  const models = modelsToTry();
  let sentAny = false;

  for (let i = 0; i < models.length; i++) {
    const model = models[i]!;
    try {
      const stream = await getClient().models.generateContentStream({
        model,
        contents,
        config: {
          systemInstruction: opts.system,
          temperature: 0.3,
          maxOutputTokens: 1024,
          abortSignal: opts.signal,
        },
      });
      for await (const chunk of stream) {
        const text = chunk.text;
        if (text) {
          sentAny = true;
          opts.onText(text);
        }
      }
      return { model };
    } catch (err) {
      if (opts.signal.aborted) throw new LlmError('TIMEOUT', 'The assistant took too long to reply.');
      if (sentAny) throw new LlmError('INTERRUPTED', 'The answer was interrupted.');
      const status = (err as { status?: number }).status;
      console.warn(`[assistant] model ${model} failed${status ? ` (HTTP ${status})` : ''}${i < models.length - 1 ? ' — trying fallback' : ''}`);
      // otherwise fall through to the next model
    }
  }
  throw new LlmError('UNAVAILABLE', 'The assistant is unavailable right now.');
}
