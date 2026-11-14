/**
 * Feature 13 — Coach, the student AI assistant (plan §7).
 *
 * A floating bubble (bottom-right of every student page) that opens a chat
 * panel. Mounted once in AppLayout, so the conversation survives moving
 * between pages; it is also mirrored to sessionStorage so a refresh keeps it.
 * Cleared on sign-out (clearCoachChat) and when the tab closes.
 *
 * Replies stream in word by word. Formatting is limited to bold, bullet lists
 * and numbered lists, rendered as React elements (never raw HTML).
 */
import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { getCoachConfig, streamCoachReply, CoachError, type CoachAction, type CoachConfig, type CoachTurn } from './api.js';

const MAX_CHARS = 1000; // plan §6
const HISTORY_TURNS = 12; // plan §6
const STORE_PREFIX = 'bukc:coach:';
const EXPANDED_KEY = STORE_PREFIX + 'expanded'; // cleared with the chat on sign-out
const MESSAGES_ACTION: CoachAction = { label: 'Open Messages', href: '/messages' };

interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  error?: boolean;
  actions?: CoachAction[];
}

/** Removes every saved Coach conversation in this tab (call on sign-out). */
export function clearCoachChat() {
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const k = sessionStorage.key(i);
      if (k?.startsWith(STORE_PREFIX)) sessionStorage.removeItem(k);
    }
  } catch { /* storage unavailable — nothing to clear */ }
}

function loadChat(userId: string): ChatMessage[] {
  try {
    const raw = sessionStorage.getItem(STORE_PREFIX + userId);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}
function saveChat(userId: string, messages: ChatMessage[]) {
  try { sessionStorage.setItem(STORE_PREFIX + userId, JSON.stringify(messages)); } catch { /* fine — in-memory still works */ }
}
const newId = () => Math.random().toString(36).slice(2, 10);
function loadExpanded(): boolean {
  try { return sessionStorage.getItem(EXPANDED_KEY) === '1'; } catch { return false; }
}

export function CoachAssistant({ userId, pathname }: { userId: string; pathname: string }) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(loadExpanded); // full-screen mode, remembered for this tab
  const [config, setConfig] = useState<CoachConfig | null>(null);
  const [configFailed, setConfigFailed] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadChat(userId));
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [announce, setAnnounce] = useState('');

  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bubbleRef = useRef<HTMLButtonElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => { saveChat(userId, messages); }, [userId, messages]);
  useEffect(() => {
    try { sessionStorage.setItem(EXPANDED_KEY, expanded ? '1' : '0'); } catch { /* fine */ }
  }, [expanded]);
  const toggleExpanded = () => { setExpanded((v) => !v); setTimeout(() => inputRef.current?.focus(), 30); };
  useEffect(() => () => abortRef.current?.abort(), []);

  // Load config the first time the panel opens.
  useEffect(() => {
    if (!open || config) return;
    let cancelled = false;
    setConfigFailed(false);
    getCoachConfig().then((c) => { if (!cancelled) setConfig(c); }).catch(() => { if (!cancelled) setConfigFailed(true); });
    return () => { cancelled = true; };
  }, [open, config]);

  // Focus the input when opening; Esc closes and returns focus to the bubble.
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 30);
  }, [open]);
  const close = useCallback(() => { setOpen(false); setTimeout(() => bubbleRef.current?.focus(), 0); }, []);

  // Keep the newest message in view.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, status, open, expanded]);

  const available = !!config?.configured;

  async function send(text: string) {
    const question = text.trim();
    if (!question || busy || !available) return;
    if (question.length > MAX_CHARS) return;

    const userMsg: ChatMessage = { id: newId(), role: 'user', text: question };
    const replyId = newId();
    const base = [...messages, userMsg];
    setMessages([...base, { id: replyId, role: 'model', text: '' }]);
    setInput('');
    setBusy(true);
    setStatus('Coach is typing…');

    // Only real turns go to the server: no welcome, no error notes, no empty replies.
    const history: CoachTurn[] = base
      .filter((m) => !m.error && m.text.trim())
      .map((m) => ({ role: m.role, text: m.text }))
      .slice(-HISTORY_TURNS);
    while (history.length > 1 && history[0]!.role !== 'user') history.shift();

    const controller = new AbortController();
    abortRef.current = controller;
    const patch = (fn: (m: ChatMessage) => ChatMessage) =>
      setMessages((all) => all.map((m) => (m.id === replyId ? fn(m) : m)));

    let finalText = '';
    try {
      await streamCoachReply(history, {
        onStatus: (s) => setStatus(s),
        onDelta: (chunk) => { finalText += chunk; setStatus(null); patch((m) => ({ ...m, text: m.text + chunk })); },
        onActions: (actions) => patch((m) => ({ ...m, actions })),
      }, controller.signal);
      setAnnounce(finalText);
    } catch (e) {
      if (controller.signal.aborted) return;
      const err = e instanceof CoachError ? e : new CoachError('UNAVAILABLE', 'Coach is unavailable right now. You can still reach the Coordinator in Messages.');
      const showMessagesButton = err.code !== 'INVALID_MESSAGE' && err.code !== 'NETWORK';
      patch((m) => (m.text
        // Partial answer already shown — keep it, add the error as its own note.
        ? m
        : { ...m, text: err.message, error: true, actions: showMessagesButton ? [MESSAGES_ACTION] : undefined }));
      if (finalText) {
        setMessages((all) => [...all, { id: newId(), role: 'model', text: err.message, error: true }]);
      }
      setAnnounce(err.message);
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setBusy(false);
      setStatus(null);
    }
  }

  function clearChat() {
    abortRef.current?.abort();
    setMessages([]);
    setBusy(false);
    setStatus(null);
    inputRef.current?.focus();
  }

  function onInputKey(e: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send(input);
    }
  }

  // Esc closes; Tab stays inside the open panel (focus trap).
  function onPanelKey(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      if (expanded) setExpanded(false); else close();
      return;
    }
    if (e.key !== 'Tab' || !panelRef.current) return;
    const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ));
    if (focusable.length === 0) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  const raised = pathname.startsWith('/messages'); // keep clear of the Messages send box
  const hasUserMessages = messages.some((m) => m.role === 'user');
  const remaining = MAX_CHARS - input.length;

  return (
    <div className={`coach${raised ? ' is-raised' : ''}${open ? ' is-open' : ''}${open && expanded ? ' is-expanded' : ''}`}>
      <CoachStyles />

      {open && expanded && <div className="coach-backdrop" onClick={() => setExpanded(false)} aria-hidden />}

      {open && (
        <div ref={panelRef} className="coach-panel" role="dialog" aria-modal={expanded || undefined} aria-label="Coach, BUKC Sports assistant" onKeyDown={onPanelKey}>
          <header className="coach-head">
            <span className="coach-head-avatar" aria-hidden><WhistleIcon /></span>
            <span className="coach-head-text">
              <span className="coach-head-name">Coach</span>
              <span className="coach-head-sub">BUKC Sports Assistant</span>
            </span>
            <button type="button" className="coach-icon-btn coach-expand-btn" onClick={toggleExpanded}
              title={expanded ? 'Exit full screen' : 'Full screen'} aria-label={expanded ? 'Exit full screen' : 'Open Coach in full screen'}
              aria-pressed={expanded}>
              {expanded ? <CollapseIcon /> : <ExpandIcon />}
            </button>
            <button type="button" className="coach-icon-btn" onClick={clearChat} disabled={messages.length === 0 && !busy}
              title="Clear chat" aria-label="Clear chat"><ResetIcon /></button>
            <button type="button" className="coach-icon-btn" onClick={close} title="Close" aria-label="Close Coach"><CloseIcon /></button>
          </header>

          <div ref={listRef} className="coach-list">
            {!config && !configFailed && <p className="coach-loading">Loading…</p>}

            {configFailed && (
              <CoachBubble role="model" error actions={[MESSAGES_ACTION]} onAction={close}>
                <p>Couldn&apos;t load Coach right now. You can still reach the Coordinator in Messages.</p>
              </CoachBubble>
            )}

            {config && !config.configured && (
              <CoachBubble role="model" actions={[MESSAGES_ACTION]} onAction={close}>
                <p>{config.notSetUpMessage}</p>
              </CoachBubble>
            )}

            {config?.configured && (
              <>
                <CoachBubble role="model"><p>{config.welcome}</p></CoachBubble>
                {!hasUserMessages && (
                  <div className="coach-chips" aria-label="Suggested questions">
                    {config.starterChips.map((chip) => (
                      <button key={chip} type="button" className="coach-chip" onClick={() => void send(chip)} disabled={busy}>{chip}</button>
                    ))}
                  </div>
                )}
                {messages.map((m) => (m.role === 'model' && !m.text ? null : (
                  <CoachBubble key={m.id} role={m.role} error={m.error} actions={m.actions} onAction={close}>
                    {m.role === 'user' ? <p>{m.text}</p> : <RichText text={m.text} />}
                  </CoachBubble>
                )))}
                {status && (
                  <div className="coach-status" aria-hidden>
                    <span className="coach-dots"><i /><i /><i /></span>{status}
                  </div>
                )}
              </>
            )}
          </div>

          <div className="coach-sr" aria-live="polite">{announce}</div>

          <form className="coach-compose" onSubmit={(e) => { e.preventDefault(); void send(input); }}>
            <textarea
              ref={inputRef}
              className="coach-input"
              rows={1}
              value={input}
              maxLength={MAX_CHARS}
              placeholder={available ? 'Ask Coach about equipment, borrowing or venues…' : 'Coach is not available'}
              disabled={!available}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onInputKey}
              aria-label="Message Coach"
            />
            <button type="submit" className="coach-send" disabled={!available || busy || !input.trim()} aria-label="Send">
              <SendIcon />
            </button>
          </form>
          {available && remaining <= 100 && <div className="coach-count">{remaining} characters left</div>}
        </div>
      )}

      <button
        ref={bubbleRef}
        type="button"
        className="coach-bubble"
        onClick={() => (open ? close() : setOpen(true))}
        aria-expanded={open}
        aria-label={open ? 'Close Coach' : 'Open Coach, the BUKC Sports assistant'}
        title={open ? 'Close Coach' : 'Ask Coach'}
      >
        {open ? <CloseIcon /> : <ChatIcon />}
      </button>
    </div>
  );
}

function CoachBubble({ role, error, actions, onAction, children }: {
  role: 'user' | 'model'; error?: boolean; actions?: CoachAction[]; onAction?: () => void; children: ReactNode;
}) {
  return (
    <div className={`coach-row is-${role}`}>
      <div className={`coach-msg is-${role}${error ? ' is-error' : ''}`}>
        {children}
        {actions && actions.length > 0 && (
          <div className="coach-actions">
            {actions.map((a) => (
              <Link key={a.href + a.label} to={a.href} className="coach-action" onClick={onAction}>{a.label}</Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Bold, bullet lists and numbered lists only — built as React elements, never HTML. */
function RichText({ text }: { text: string }) {
  const lines = text.replace(/\r/g, '').split('\n');
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const items = list.items.map((it, i) => <li key={i}>{inline(it)}</li>);
    blocks.push(list.ordered ? <ol key={blocks.length}>{items}</ol> : <ul key={blocks.length}>{items}</ul>);
    list = null;
  };
  for (const line of lines) {
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      const ordered = !!numbered;
      const item = (bullet ?? numbered)![1]!;
      if (!list || list.ordered !== ordered) { flush(); list = { ordered, items: [] }; }
      list.items.push(item);
    } else if (line.trim() === '') {
      flush();
    } else {
      flush();
      blocks.push(<p key={blocks.length}>{inline(line.replace(/^#+\s*/, ''))}</p>);
    }
  }
  flush();
  return <>{blocks}</>;
}
function inline(s: string): ReactNode[] {
  return s.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') && part.length > 4
      ? <strong key={i}>{part.slice(2, -2)}</strong>
      : <span key={i}>{part}</span>);
}

/* ---------- styles (matches AppLayout's navy palette) ---------- */
function CoachStyles() {
  return (
    <style>{`
      .coach { position: fixed; right: 24px; bottom: 24px; z-index: 190; font-family: 'Inter', system-ui, sans-serif; }
      .coach.is-raised { bottom: 112px; }
      .coach-bubble {
        width: 58px; height: 58px; border-radius: 50%; border: 1px solid rgba(157,187,255,0.35); cursor: pointer;
        display: grid; place-items: center; color: #fff; background: linear-gradient(135deg, #3B63D8, #1C398E);
        box-shadow: 0 10px 28px rgba(15,23,43,0.35); transition: transform .15s ease, box-shadow .15s ease;
      }
      .coach-bubble:hover { transform: translateY(-2px); box-shadow: 0 14px 32px rgba(15,23,43,0.42); }
      .coach-bubble:focus-visible { outline: 3px solid #9DBBFF; outline-offset: 3px; }

      .coach-panel {
        position: absolute; right: 0; bottom: 72px; width: 380px; height: 560px; max-height: calc(100vh - 120px);
        display: flex; flex-direction: column; background: #fff; border-radius: 18px; overflow: hidden;
        border: 1px solid #DCE3EE; box-shadow: 0 24px 60px rgba(15,23,43,0.35);
      }
      .coach.is-raised .coach-panel { max-height: calc(100vh - 208px); }

      .coach-head { display: flex; align-items: center; gap: 10px; padding: 12px 10px 12px 14px; background: #0F172B; color: #fff; }
      .coach-head-avatar { width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center;
        background: linear-gradient(135deg, #3B63D8, #1C398E); border: 1px solid rgba(157,187,255,0.35); flex: 0 0 auto; }
      .coach-head-text { display: flex; flex-direction: column; flex: 1; min-width: 0; }
      .coach-head-name { font-weight: 700; font-size: 15px; }
      .coach-head-sub { font-size: 11.5px; color: #9DBBFF; font-weight: 600; }
      .coach-icon-btn { width: 32px; height: 32px; border-radius: 8px; border: 0; background: transparent; color: #CAD5E2; cursor: pointer; display: grid; place-items: center; }
      .coach-icon-btn:hover:not(:disabled) { background: rgba(255,255,255,0.08); color: #fff; }
      .coach-icon-btn:disabled { opacity: .35; cursor: default; }
      .coach-icon-btn:focus-visible { outline: 2px solid #9DBBFF; }

      .coach-list { flex: 1; overflow-y: auto; padding: 14px 12px; background: #F4F7FB; display: flex; flex-direction: column; gap: 10px; }
      .coach-loading { color: #62748E; font-size: 13px; text-align: center; margin: 24px 0; }
      .coach-row { display: flex; }
      .coach-row.is-user { justify-content: flex-end; }
      .coach-msg { max-width: 86%; padding: 9px 12px; border-radius: 14px; font-size: 13.5px; line-height: 1.5; color: #1A2033; overflow-wrap: anywhere; }
      .coach-msg.is-model { background: #fff; border: 1px solid #E2E8F0; border-bottom-left-radius: 4px; }
      .coach-msg.is-user { background: #1C398E; color: #fff; border-bottom-right-radius: 4px; white-space: pre-wrap; }
      .coach-msg.is-error { background: #FFF5F5; border-color: #FBD5D5; color: #9B1C1C; }
      .coach-msg p { margin: 0 0 6px; } .coach-msg p:last-child { margin-bottom: 0; }
      .coach-msg ul, .coach-msg ol { margin: 4px 0 6px; padding-left: 20px; } .coach-msg li { margin: 2px 0; }
      .coach-msg strong { font-weight: 700; }
      .coach-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
      .coach-action { display: inline-block; padding: 6px 11px; border-radius: 999px; background: #E8EEFB; color: #1C398E;
        font-weight: 700; font-size: 12.5px; text-decoration: none; border: 1px solid #C9D6F5; }
      .coach-action:hover { background: #DCE6FA; }

      .coach-chips { display: flex; flex-wrap: wrap; gap: 6px; padding-left: 2px; }
      .coach-chip { padding: 7px 11px; border-radius: 999px; border: 1px solid #C9D6F5; background: #fff; color: #1C398E;
        font: 600 12.5px Inter, system-ui, sans-serif; cursor: pointer; }
      .coach-chip:hover:not(:disabled) { background: #E8EEFB; }
      .coach-chip:disabled { opacity: .5; cursor: default; }

      .coach-status { display: flex; align-items: center; gap: 8px; color: #62748E; font-size: 12.5px; padding-left: 4px; }
      .coach-dots { display: inline-flex; gap: 3px; }
      .coach-dots i { width: 5px; height: 5px; border-radius: 50%; background: #90A1B9; animation: coachDot 1s infinite ease-in-out; }
      .coach-dots i:nth-child(2) { animation-delay: .15s; } .coach-dots i:nth-child(3) { animation-delay: .3s; }
      @keyframes coachDot { 0%, 80%, 100% { opacity: .3; transform: translateY(0); } 40% { opacity: 1; transform: translateY(-2px); } }

      .coach-compose { display: flex; align-items: flex-end; gap: 8px; padding: 10px; border-top: 1px solid #E2E8F0; background: #fff; }
      .coach-input { flex: 1; resize: none; max-height: 110px; min-height: 40px; padding: 10px 12px; border-radius: 12px;
        border: 1px solid #CBD5E1; font: 400 13.5px/1.4 Inter, system-ui, sans-serif; color: #1A2033; field-sizing: content; }
      .coach-input:focus { outline: none; border-color: #3B63D8; box-shadow: 0 0 0 3px rgba(59,99,216,0.15); }
      .coach-input:disabled { background: #F1F5F9; }
      .coach-send { width: 40px; height: 40px; border-radius: 12px; border: 0; background: #1C398E; color: #fff; cursor: pointer; display: grid; place-items: center; flex: 0 0 auto; }
      .coach-send:disabled { background: #A9B6D3; cursor: default; }
      .coach-send:focus-visible { outline: 3px solid #9DBBFF; outline-offset: 2px; }
      .coach-count { font-size: 11.5px; color: #62748E; text-align: right; padding: 0 12px 8px; background: #fff; }
      /* Full-screen mode */
      .coach-backdrop { position: fixed; inset: 0; background: rgba(10,18,41,0.6); backdrop-filter: blur(2px); }
      .coach.is-expanded .coach-bubble { display: none; }
      .coach.is-expanded .coach-panel {
        position: fixed; inset: 20px; width: auto; height: auto; max-height: none; border-radius: 20px;
      }
      .coach.is-expanded .coach-head { padding: 14px 16px 14px 20px; }
      .coach.is-expanded .coach-head-name { font-size: 16.5px; }
      .coach.is-expanded .coach-list { padding: 28px max(20px, calc((100% - 860px) / 2)); gap: 12px; }
      .coach.is-expanded .coach-msg { max-width: 78%; font-size: 14.5px; padding: 11px 15px; }
      .coach.is-expanded .coach-chip { font-size: 13.5px; padding: 8px 13px; }
      .coach.is-expanded .coach-compose { padding: 14px max(20px, calc((100% - 860px) / 2)) 18px; }
      .coach.is-expanded .coach-input { font-size: 14.5px; min-height: 46px; max-height: 180px; }
      .coach.is-expanded .coach-send { width: 46px; height: 46px; }
      .coach.is-expanded .coach-count { padding: 0 max(20px, calc((100% - 860px) / 2)) 10px; }

      .coach-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

      @media (max-width: 520px) {
        .coach { right: 16px; bottom: 16px; }
        .coach.is-raised { bottom: 96px; }
        .coach.is-open .coach-bubble { display: none; }
        .coach-panel { position: fixed; inset: 0; width: auto; height: auto; max-height: none; border-radius: 0; border: 0; }
        .coach.is-raised .coach-panel { max-height: none; }
        .coach-expand-btn { display: none !important; } /* already full screen on phones */
        .coach.is-expanded .coach-panel { inset: 0; border-radius: 0; }
        .coach-backdrop { display: none; }
      }
    `}</style>
  );
}

/* ---------- icons ---------- */
function ChatIcon() {
  return <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.2 3.6c-.5.4-1.3.1-1.3-.6V16A2.5 2.5 0 0 1 4 13.5v-8Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/><circle cx="8.5" cy="9.5" r="1.1" fill="currentColor"/><circle cx="12" cy="9.5" r="1.1" fill="currentColor"/><circle cx="15.5" cy="9.5" r="1.1" fill="currentColor"/></svg>;
}
function WhistleIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden><circle cx="9" cy="14" r="5" stroke="currentColor" strokeWidth="1.7"/><path d="M12.5 10.5 20 7v4l-5.5 1.5M4 6l2 2M8 4v2.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}
function CloseIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>;
}
function ExpandIcon() {
  return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden><path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}
function CollapseIcon() {
  return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden><path d="M20 10h-6V4M4 14h6v6M14 10l7-7M10 14l-7 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}
function ResetIcon() {
  return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden><path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4.5h4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}
function SendIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden><path d="M4.5 12 20 4.5l-4.5 15.5-3.3-6.2L4.5 12Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/><path d="m12.2 13.8 3.3-3.3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>;
}
