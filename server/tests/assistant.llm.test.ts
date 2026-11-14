/**
 * Feature 13 — Coach, Step 2: model fallback rules (plan §2/§3).
 * @google/genai is mocked; no real API calls.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

process.env.GEMINI_API_KEY = 'test-key';
process.env.GEMINI_MODEL = 'main-model';
process.env.GEMINI_FALLBACK_MODEL = 'fallback-model';

const genai = vi.hoisted(() => ({ generateContentStream: vi.fn() }));
vi.mock('@google/genai', () => ({
  GoogleGenAI: class { models = { generateContentStream: genai.generateContentStream }; },
}));

const { streamReply, LlmError } = await import('../src/features/assistant/llm.js');

async function* chunks(...texts: string[]) { for (const text of texts) yield { text }; }
async function* failAfter(text: string) { yield { text }; throw Object.assign(new Error('boom'), { status: 500 }); }
const quotaError = () => Object.assign(new Error('RESOURCE_EXHAUSTED'), { status: 429 });

function run(signal = new AbortController().signal) {
  const out: string[] = [];
  const p = streamReply({ system: 'sys', history: [{ role: 'user', text: 'hi' }], signal, onText: (t) => out.push(t) });
  return { p, out };
}

beforeEach(() => genai.generateContentStream.mockReset());

describe('Coach model fallback', () => {
  it('T-1320: uses the main model when it works', async () => {
    genai.generateContentStream.mockResolvedValueOnce(chunks('Hi ', 'there'));
    const { p, out } = run();
    await expect(p).resolves.toEqual({ model: 'main-model' });
    expect(out.join('')).toBe('Hi there');
    expect(genai.generateContentStream.mock.calls[0]![0]).toMatchObject({
      model: 'main-model', config: { systemInstruction: 'sys' },
      contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
    });
  });

  it('T-1321: main model over quota (429) before any text → silently answers with the fallback', async () => {
    genai.generateContentStream
      .mockImplementationOnce(async () => { throw quotaError(); })
      .mockResolvedValueOnce(chunks('From fallback'));
    const { p, out } = run();
    await expect(p).resolves.toEqual({ model: 'fallback-model' });
    expect(out.join('')).toBe('From fallback');
  });

  it('T-1322: both models fail → UNAVAILABLE', async () => {
    genai.generateContentStream
      .mockImplementationOnce(async () => { throw quotaError(); })
      .mockImplementationOnce(async () => { throw quotaError(); });
    const { p } = run();
    const e = await p.catch((x: unknown) => x);
    expect(e).toBeInstanceOf(LlmError);
    expect((e as InstanceType<typeof LlmError>).kind).toBe('UNAVAILABLE');
  });

  it('T-1323: failure after text was sent → INTERRUPTED, no fallback (no mixed answers)', async () => {
    genai.generateContentStream.mockResolvedValueOnce(failAfter('Half an'));
    const { p, out } = run();
    await expect(p).rejects.toMatchObject({ kind: 'INTERRUPTED' });
    expect(out).toEqual(['Half an']);
    expect(genai.generateContentStream).toHaveBeenCalledTimes(1);
  });

  it('T-1324: timeout (aborted) → TIMEOUT', async () => {
    const ctl = new AbortController();
    genai.generateContentStream.mockImplementationOnce(async () => { ctl.abort(); throw new Error('aborted'); });
    const { p } = run(ctl.signal);
    await expect(p).rejects.toMatchObject({ kind: 'TIMEOUT' });
  });
});
