/**
 * Student-only "Late submission" pop-up. Shown on every page while one of the
 * student's loans is past its return time; it reminds again 30 minutes after
 * being dismissed, and disappears once the equipment is returned.
 */
import { useCallback, useEffect, useState } from 'react';
import { formatDuration, getMyLateLoans, type LateLoan } from '../features/borrow/deskApi.js';

const POLL_MS = 60_000;
const SNOOZE_MS = 30 * 60_000;
const KEY = 'bukc-late-alert-snooze';

function readSnooze(): Record<string, number> {
  try { return JSON.parse(sessionStorage.getItem(KEY) ?? '{}') as Record<string, number>; } catch { return {}; }
}
function writeSnooze(v: Record<string, number>) {
  try { sessionStorage.setItem(KEY, JSON.stringify(v)); } catch { /* private mode etc. */ }
}

export function LateReturnAlert({ enabled, pathname }: { enabled: boolean; pathname: string }) {
  const [late, setLate] = useState<LateLoan[]>([]);
  const [snooze, setSnooze] = useState<Record<string, number>>(readSnooze);
  const [, tick] = useState(0);

  const refresh = useCallback(() => {
    if (!enabled) return;
    getMyLateLoans().then((r) => setLate(r.late)).catch(() => { /* keep last */ });
  }, [enabled]);

  useEffect(() => { refresh(); }, [refresh, pathname]);
  useEffect(() => {
    if (!enabled) { setLate([]); return; }
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, POLL_MS);
    const clock = window.setInterval(() => tick((n) => n + 1), 30_000); // keeps "late by" current
    return () => { window.clearInterval(t); window.clearInterval(clock); };
  }, [enabled, refresh]);

  const now = Date.now();
  const visible = late.filter((l) => !(snooze[l.borrow_txn_id] && snooze[l.borrow_txn_id]! > now));
  if (!enabled || visible.length === 0) return null;

  function dismiss() {
    const next = { ...snooze };
    for (const l of visible) next[l.borrow_txn_id] = Date.now() + SNOOZE_MS;
    setSnooze(next); writeSnooze(next);
  }

  return (
    <div className="lra" role="alert" aria-live="assertive">
      <style>{CSS}</style>
      <div className="lra-icon" aria-hidden>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="13" r="8" /><path d="M12 9v4l2.5 1.5M9 2.5h6" />
        </svg>
      </div>
      <div className="lra-body">
        <strong>Late submission</strong>
        {visible.map((l) => (
          <p key={l.borrow_txn_id}>
            Your <b>{l.equipment_type_name}</b>{l.barcodes ? ` (${l.barcodes})` : ''} was due back at{' '}
            {new Date(l.agreed_return_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
            {' '}— late by <b>{formatDuration(now - new Date(l.agreed_return_at).getTime())}</b>.
          </p>
        ))}
        <span className="lra-hint">Please return it to the sports office now to collect your university card.</span>
      </div>
      <button type="button" className="lra-close" onClick={dismiss} aria-label="Dismiss for 30 minutes">×</button>
    </div>
  );
}

const CSS = `
  .lra { position: fixed; z-index: 200; right: 20px; bottom: 20px; width: min(420px, calc(100vw - 32px));
    display: grid; grid-template-columns: 40px 1fr 28px; gap: 12px; align-items: start; padding: 16px 14px 16px 16px;
    border-radius: 16px; background: linear-gradient(145deg, #FFF5F5 0%, #FDE8E8 100%); border: 1px solid #F5B5B5;
    box-shadow: 0 24px 48px -20px rgba(3,22,54,.7); font-family: 'Inter', system-ui, sans-serif; color: #0F172B;
    animation: lraIn .35s ease-out; }
  @keyframes lraIn { from { transform: translateY(16px); opacity: 0; } to { transform: none; opacity: 1; } }
  .lra-icon { width: 40px; height: 40px; border-radius: 12px; display: grid; place-items: center; color: #fff; background: #DC2626;
    box-shadow: 0 0 0 4px #DC262622; }
  .lra-body strong { display: block; font-size: 15.5px; font-weight: 800; color: #B91C1C; margin-bottom: 4px; }
  .lra-body p { margin: 0 0 4px; font-size: 13.5px; line-height: 1.45; color: #45556C; }
  .lra-body b { color: #0F172B; }
  .lra-hint { display: block; margin-top: 4px; font-size: 12.5px; font-weight: 600; color: #B91C1C; }
  .lra-close { width: 28px; height: 28px; border-radius: 8px; border: none; background: transparent; color: #62748E;
    font-size: 20px; line-height: 1; cursor: pointer; }
  .lra-close:hover { background: #F8D4D4; color: #0F172B; }
  @media (max-width: 520px) { .lra { right: 16px; left: 16px; bottom: 16px; width: auto; } }
  @media (prefers-reduced-motion: reduce) { .lra { animation: none; } }
`;
