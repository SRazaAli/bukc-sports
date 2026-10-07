/**
 * Coordinator — Active Borrows (BORROW-15..24). Lists ACTIVE / OVERDUE /
 * INCOMPLETE transactions; processing a return offers the three modes
 * (scan / manual / dismiss) matching BORROW-22.
 *
 * Re-themed to match the site's actual current visual language (Landing /
 * Home / Register / Profile / Usage History / Accounts / Offline Fallback /
 * Conflict Detection / Venue Calendar / Equipment Availability / Kit Borrow /
 * Book a Venue): dark navy page with two soft glow blobs, the same header
 * (logo, wordmark, ghost Back/Sign out) as Accounts, everything wrapped in
 * one frosted glass panel, white/soft-gradient cards, and a single accent
 * blue for interactive elements. No backend calls, state, or validation
 * were touched — only the wrapper and styling.
 */
import { useEffect, useState, useCallback } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth.js';
import { listActive, getTransaction, returnArticles, type ActiveBorrow, type TxnDetail } from './api.js';
import { ApiRequestError } from '../../lib/api.js';
import { HideInAppShell } from '../../components/AppShellContext.js';
import { useBackStep } from '../../components/backStack.js';

/* ---------- theme (identical values used across the app) ---------- */
const palette = {
  navy900: '#0F172B',
  navy800: '#132357',
  navyDeep: '#031636',
  slate600: '#132357',
  slate500: '#62748E',
  slate400: '#90A1B9',
  slate300: '#CAD5E2',
  slate100: '#E2E8F0',
  slate50: '#F8FAFC',
  white: '#FFFFFF',
  accent: '#1C398E',
  accentSoft: '#DBEAFE',
  accentWash: '#1C398E14',
};

function errMsg(e: unknown) { return e instanceof ApiRequestError ? e.body.error : 'Something went wrong.'; }

export default function ActiveBorrowsScreen() {
  const { user, loading, logout } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState<ActiveBorrow[] | null>(null);
  const [detail, setDetail] = useState<TxnDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { const r = await listActive(); setRows(r.transactions); } catch (e) { setError(errMsg(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  // Go back (top right) closes the return panel opened from the list.
  useBackStep(!!detail, () => setDetail(null));

  async function open(txnId: string) {
    try { setDetail(await getTransaction(txnId)); setError(null); } catch (e) { setError(errMsg(e)); }
  }

  if (loading) return <div className="abw-ui" style={{ minHeight: '100%', background: palette.navy900 }} />;
  if (!user) return <Navigate to="/" replace />;
  if (user.role !== 'COORDINATOR' && user.role !== 'SUPER_ADMIN') return <Navigate to="/home" replace />;

  const stateBadge = (s: string) => s === 'OVERDUE' ? badge.danger : s === 'INCOMPLETE' ? badge.warn : badge.ok;

  return (
    <div className="abw-ui" style={s.page}>
      <AbwStyles />
      <div style={s.blobA} aria-hidden />
      <div style={s.blobB} aria-hidden />

      <HideInAppShell>
        <header style={s.topbar}>
          <div style={s.brand}>
            <img src="/landing/bu_logo.png" alt="Bahria University" style={s.logoImg} />
            <div>
              <div style={s.wordmark}>Bahria University</div>
              <div style={s.wordmarkSub}>Sports Management Portal</div>
            </div>
          </div>
          <div style={s.topbarRight}>
            <button type="button" className="hist-topbtn" style={s.topBtn} onClick={() => navigate('/home')}><BackIcon /> Back</button>
            <button type="button" className="hist-topbtn hist-signout" style={s.topBtn} onClick={() => { void logout(); navigate('/'); }}>
              <SignOutIcon /> Sign out
            </button>
          </div>
        </header>
      </HideInAppShell>

      <main style={s.main}>
        {/* Frosted glassmorphism shell around everything below the header —
            same treatment as Accounts, Usage History, Offline Fallback,
            Conflict Detection, Venue Calendar, Kit Borrow, and Book a
            Venue. */}
        <div className="abw-glass" style={s.glassPanel}>
          <div style={s.headRow}>
            <span style={s.eyebrow}>{user.role === 'SUPER_ADMIN' ? 'Administration Staff' : 'Coordinator'} Portal</span>
            <h1 style={s.title}>Active Borrows</h1>
            <p style={s.subtitle}>Equipment currently checked out — process a return when it comes back.</p>
          </div>

          <div style={wrap}>
            {error && <div style={box.err}>{error}</div>}
            {notice && <div style={box.ok}>{notice}</div>}

            {detail ? (
              <ReturnPanel txn={detail} onBack={() => setDetail(null)}
                onDone={(m) => { setNotice(m); setError(null); setDetail(null); void load(); }} onError={setError} />
            ) : (
              <Panel title="Currently Out">
                {rows === null ? <p style={muted}>Loading…</p> : rows.length === 0 ? (
                  <p style={muted}>Nothing is currently borrowed.</p>
                ) : (
                  <table style={table}>
                    <thead><tr><th style={th}>Borrower</th><th style={th}>Equipment</th><th style={th}>Due</th><th style={th}>Status</th><th style={th} /></tr></thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.borrow_txn_id} className="abw-row">
                          <td style={td}>{r.borrower_name ?? r.guest_name ?? '—'}</td>
                          <td style={td}>{r.equipment_type_name}</td>
                          <td style={td}>{new Date(r.agreed_return_at).toLocaleString()}</td>
                          <td style={td}><span style={{ ...badgeBase, ...stateBadge(r.status) }}>{r.status}</span></td>
                          <td style={{ ...td, textAlign: 'right' }}>
                            <button className="abw-btn-primary" style={reviewBtn} onClick={() => open(r.borrow_txn_id)}>Process Return</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Panel>
            )}
          </div>
        </div>
      </main>

      <HideInAppShell>
        <footer style={s.footer}>
          2026 © <a href="/" style={s.footerLink}>Bahria University</a> — Sports Management Portal
        </footer>
      </HideInAppShell>
    </div>
  );
}

function ReturnPanel({ txn, onBack, onDone, onError }: {
  txn: TxnDetail; onBack: () => void; onDone: (m: string) => void; onError: (m: string) => void;
}) {
  const outstanding = txn.articles.filter((a) => !a.returned_at);
  const [selectedIds, setSelectedIds] = useState<string[]>(outstanding.map((a) => a.article_id));
  const [mode, setMode] = useState<'scan' | 'manual' | 'dismiss'>('scan');
  const [score, setScore] = useState(90);
  const [label, setLabel] = useState<'GOOD' | 'WORN' | 'DAMAGED'>('GOOD');
  const [busy, setBusy] = useState(false);

  function toggle(id: string) {
    setSelectedIds((cur) => cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
  }

  async function submit() {
    if (selectedIds.length === 0) { onError('Select at least one article being returned.'); return; }
    setBusy(true);
    try {
      const res = await returnArticles(txn.borrow_txn_id, {
        articleIds: selectedIds, mode,
        score: mode === 'scan' ? score : undefined,
        label: mode === 'manual' ? label : undefined,
      });
      onDone(`Return processed — ${res.status.replace('_', ' ').toLowerCase()}.`);
    } catch (e) { onError(errMsg(e)); } finally { setBusy(false); }
  }

  return (
    <Panel title={`Return — ${txn.borrower_name ?? txn.guest_name ?? 'Borrower'}`}>
      <p style={{ ...muted, marginTop: 0 }}>{txn.equipment_type_name} · agreed return {new Date(txn.agreed_return_at).toLocaleString()}</p>

      <div style={{ marginBottom: 16 }}>
        <span style={lbl}>Articles being returned</span>
        <div style={{ display: 'grid', gap: 6 }}>
          {outstanding.map((a) => (
            <label key={a.article_id} style={checkRow}>
              <input type="checkbox" checked={selectedIds.includes(a.article_id)} onChange={() => toggle(a.article_id)} />
              <span style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}>{a.barcode}</span>
            </label>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <span style={lbl}>Condition check</span>
        <div style={{ display: 'flex', gap: 16, marginTop: 4, flexWrap: 'wrap' }}>
          {(['scan', 'manual', 'dismiss'] as const).map((m) => (
            <label key={m} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, color: palette.navy900 }}>
              <input type="radio" name="mode" checked={mode === m} onChange={() => setMode(m)} />
              {m === 'scan' ? 'Health scan' : m === 'manual' ? 'Manual condition' : 'Dismiss (skip check)'}
            </label>
          ))}
        </div>
      </div>

      {mode === 'scan' && (
        <L label="Health score (0–100)"><input className="abw-input" type="number" style={inp} value={score} onChange={(e) => setScore(Number(e.target.value))} /></L>
      )}
      {mode === 'manual' && (
        <L label="Condition"><select className="abw-input" style={inp} value={label} onChange={(e) => setLabel(e.target.value as 'GOOD' | 'WORN' | 'DAMAGED')}>
          <option value="GOOD">Good</option><option value="WORN">Worn</option><option value="DAMAGED">Damaged</option>
        </select></L>
      )}
      {mode === 'dismiss' && (
        <div style={box.warn}>Skipping the check leaves this article's condition unverified. A warning stays in the notification center until reviewed.</div>
      )}

      <div style={actionRow}>
        <button className="abw-btn-primary" style={acceptBtn} disabled={busy} onClick={submit}>{busy ? 'Processing…' : 'Confirm Return'}</button>
        <button className="abw-btn-ghost" style={ghostBtn} onClick={onBack}>Back</button>
      </div>
    </Panel>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return <section style={panel}><div style={panelHead}>{title}</div><div style={panelBody}>{children}</div></section>;
}
function L({ label, children }: { label: string; children: React.ReactNode }) {
  return <label style={{ display: 'block', maxWidth: 260 }}><span style={lbl}>{label}</span>{children}</label>;
}

function BackIcon() { return <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M9.5 3 4 8l5.5 5M4.5 8H14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>; }
function SignOutIcon() { return <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M6.5 2H3.5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><path d="M10.5 5 14 8l-3.5 3M14 8H6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>; }

function AbwStyles() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
      .abw-ui { font-family: 'Inter', system-ui, sans-serif; }
      .abw-ui * { box-sizing: border-box; }
      .hist-topbtn { transition: background-color .18s ease, border-color .18s ease, color .18s ease; text-decoration: none; }
      .hist-topbtn:hover { background-color: rgba(255,255,255,0.08); border-color: ${palette.slate100}; }
      .hist-signout:hover { background-color: ${palette.accent} !important; border-color: ${palette.accent} !important; color: #fff !important; }
      .abw-row { transition: background-color .12s ease; }
      .abw-row:hover { background: ${palette.slate50}; }
      .abw-btn-primary { transition: filter .15s ease, transform .15s ease; }
      .abw-btn-primary:hover:not(:disabled) { filter: brightness(1.08); transform: translateY(-1px); }
      .abw-btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }
      .abw-btn-ghost { transition: background-color .15s ease, border-color .15s ease; }
      .abw-btn-ghost:hover { background: ${palette.slate50}; }
      .abw-input:focus { outline: none; border-color: ${palette.accent} !important; box-shadow: 0 0 0 3px ${palette.accentSoft}; }
      @media (max-width: 620px) {
        .abw-glass { padding: 20px 14px 26px !important; border-radius: 18px !important; }
      }
    `}</style>
  );
}

/* ---------- Shell-level styles (page/header/glass/footer — same tokens as
   Accounts, Usage History, Offline Fallback, Conflict Detection, Venue
   Calendar, Kit Borrow, and Book a Venue) ---------- */
const s = {
  page: {
    minHeight: '100%', display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden',
    background: `radial-gradient(1100px 700px at 15% 0%, ${palette.navy800}aa 0%, transparent 60%),
                 radial-gradient(900px 600px at 100% 100%, ${palette.accent}22 0%, transparent 55%),
                 ${palette.navy900}`,
  } as const,
  blobA: { position: 'absolute', width: 420, height: 420, borderRadius: '50%', background: `${palette.accent}1a`, top: -160, left: -140, filter: 'blur(30px)', pointerEvents: 'none' } as const,
  blobB: { position: 'absolute', width: 380, height: 380, borderRadius: '50%', background: `${palette.slate600}22`, bottom: -160, right: -120, filter: 'blur(30px)', pointerEvents: 'none' } as const,

  topbar: { position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 32px', flexWrap: 'wrap', gap: 12 } as const,
  brand: { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' } as const,
  logoImg: { width: 40, height: 40, borderRadius: 10, objectFit: 'contain', background: palette.slate50, padding: 4, border: `1px solid ${palette.slate300}` } as const,
  wordmark: { fontSize: 16, fontWeight: 700, color: palette.white, lineHeight: 1.2 } as const,
  wordmarkSub: { fontSize: 12, color: palette.slate400, marginTop: 1 } as const,
  topbarRight: { display: 'flex', gap: 10 } as const,
  topBtn: {
    display: 'inline-flex', alignItems: 'center', gap: 7, background: 'transparent', color: palette.slate100,
    border: `1.5px solid ${palette.slate400}`, borderRadius: 999, padding: '9px 16px', fontSize: 13.5, fontWeight: 700,
    cursor: 'pointer', fontFamily: 'inherit',
  } as const,

  main: { position: 'relative', zIndex: 1, flex: 1, padding: '20px 24px 56px', width: '100%', maxWidth: 1040, margin: '0 auto', boxSizing: 'border-box' } as const,
  glassPanel: {
    position: 'relative', background: 'rgba(255,255,255,0.07)',
    backdropFilter: 'blur(22px) saturate(160%)', WebkitBackdropFilter: 'blur(22px) saturate(160%)',
    border: '1px solid rgba(255,255,255,0.16)', borderRadius: 24,
    padding: '28px 24px 32px',
    boxShadow: '0 24px 60px -32px rgba(3,22,54,0.75), inset 0 1px 0 rgba(255,255,255,0.10)',
  } as const,

  headRow: { marginBottom: 20 } as const,
  eyebrow: {
    display: 'inline-block', fontSize: 11.5, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase',
    padding: '6px 14px', borderRadius: 999, marginBottom: 10,
    color: palette.slate100, background: `${palette.navy800}88`, border: `1px solid ${palette.slate400}55`,
  } as const,
  title: { fontSize: 28, fontWeight: 800, color: palette.white, margin: 0, letterSpacing: '-0.5px' } as const,
  subtitle: { fontSize: 14, color: palette.slate300, margin: '6px 0 0' } as const,

  footer: { position: 'relative', zIndex: 1, textAlign: 'center', padding: '20px 24px', fontSize: 12.5, color: palette.slate400, borderTop: `1px solid ${palette.slate600}55` } as const,
  footerLink: { color: palette.accentSoft, textDecoration: 'none', fontWeight: 600 } as const,
};

const CARD_BG = 'linear-gradient(145deg, #F8FAFF 0%, #EAF0FC 100%)';
const CARD_SHADOW = '0 12px 30px -22px rgba(3,22,54,.85)';

const wrap: React.CSSProperties = { width: '100%' };
const panel: React.CSSProperties = { background: CARD_BG, border: `1px solid ${palette.slate300}e6`, borderRadius: 16, marginBottom: 18, boxShadow: CARD_SHADOW, overflow: 'hidden' };
const panelHead: React.CSSProperties = { padding: '14px 20px', borderBottom: `1px solid ${palette.slate300}`, font: '700 15px Inter, sans-serif', color: palette.navy900, background: palette.white };
const panelBody: React.CSSProperties = { padding: '20px 22px' };
const table: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 14 };
const th: React.CSSProperties = { textAlign: 'left', font: '700 11px Inter, sans-serif', color: palette.slate500, textTransform: 'uppercase', letterSpacing: '0.04em', padding: '0 10px 10px', borderBottom: `1px solid ${palette.slate300}` };
const td: React.CSSProperties = { padding: '11px 10px', borderBottom: `1px solid ${palette.slate100}`, color: palette.navy900 };
const muted: React.CSSProperties = { color: palette.slate500, fontSize: 14.5, margin: 0 };
const lbl: React.CSSProperties = { display: 'block', font: '700 12px Inter, sans-serif', color: palette.navy900, marginBottom: 6 };
const inp: React.CSSProperties = { width: '100%', font: '14px Inter, sans-serif', padding: '9px 11px', border: `1.5px solid ${palette.slate300}`, borderRadius: 9, background: palette.slate50, color: palette.navy900 };
const reviewBtn: React.CSSProperties = { background: palette.accent, color: '#fff', border: 'none', borderRadius: 9, padding: '7px 16px', fontSize: 13.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' };
const ghostBtn: React.CSSProperties = { background: palette.white, color: palette.slate500, border: `1.5px solid ${palette.slate300}`, borderRadius: 9, padding: '9px 18px', fontSize: 14.5, cursor: 'pointer', fontFamily: 'inherit' };
const acceptBtn: React.CSSProperties = { background: '#1F7A45', color: '#fff', border: 'none', borderRadius: 9, padding: '9px 18px', fontSize: 14.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' };
const actionRow: React.CSSProperties = { display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' };
const checkRow: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: palette.navy900 };
const badgeBase: React.CSSProperties = { font: '700 11px "JetBrains Mono", ui-monospace, monospace', padding: '2px 8px', borderRadius: 999 };
const badge = {
  ok: { background: '#E6F4EC', color: '#1F7A45' } as React.CSSProperties,
  warn: { background: '#FDF1E3', color: '#9A6412' } as React.CSSProperties,
  danger: { background: '#FDECEC', color: '#B3352B' } as React.CSSProperties,
};
const box = {
  err: { background: '#FDECEC', color: '#8F2323', border: '1px solid #F3CACA', borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: 14 } as React.CSSProperties,
  ok: { background: '#E6F4EC', color: '#1F7A45', border: '1px solid #1F7A4555', borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: 14 } as React.CSSProperties,
  warn: { background: '#FDF1E3', color: '#9A6412', border: '1px solid #F0C888', borderRadius: 10, padding: '10px 14px', fontSize: 13.5, marginBottom: 12 } as React.CSSProperties,
};
