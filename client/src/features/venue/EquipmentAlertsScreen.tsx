/**
 * Coordinator — Equipment Alerts (EQUIP-AVAIL-13/14/15/21).
 *
 * Event equipment is locked 24 hours before an event. This page lists the
 * locked lines that can't be fully supplied, and lets the coordinator fix
 * each one on the spot:
 *   • Swap article   — a picked article was lent out / damaged → replace it
 *                      with a ready one of the same type.
 *   • Reduce quantity — supply only what is ready (reason required).
 *   • Organiser brings own — release the reservation (reason required).
 * The organiser and the Super Admin are notified of every fix.
 *
 * Opening the page also runs the 24-hour lock check and post-event release
 * on the server, so the list is never stale. Navy + glass theme, like the
 * other coordinator pages.
 */
import { useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth.js';
import { ApiRequestError } from '../../lib/api.js';
import { HideInAppShell } from '../../components/AppShellContext.js';
import { listArticles, type Article } from '../inventory/api.js';
import { notifyBorrowBadgesChanged } from '../borrow/deskApi.js';
import {
  listAllocationAlerts, performSwap, reduceAllocation, markAllocationSelfManaged,
  type AllocationAlert, type AlertFix,
} from './api.js';

const P = {
  navy900: '#0F172B', navy800: '#132357', accent: '#1C398E', slate600: '#45556C', slate500: '#62748E',
  slate400: '#90A1B9', slate300: '#CAD5E2', slate200: '#E2E8F0', slate100: '#EEF2F8', slate50: '#F8FAFC',
  red: '#DC2626', redDark: '#B91C1C', amber: '#D97706', green: '#1F7A45',
};

function errMsg(e: unknown) { return e instanceof ApiRequestError ? e.body.error : 'Something went wrong.'; }
const fmtDay = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
const fmtStamp = (iso: string | null) => (iso ? `${fmtDay(iso)}, ${fmtTime(iso)}` : '');
function startsIn(iso: string, now: number) {
  const ms = new Date(iso).getTime() - now;
  if (ms <= 0) return 'In progress';
  const h = Math.floor(ms / 3_600_000), m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `Starts in ${h}h ${String(m).padStart(2, '0')}m` : `Starts in ${m}m`;
}
const STATE_LABEL: Record<string, string> = { ON_LOAN: 'Lent out', DAMAGED: 'Damaged', DECOMMISSIONED: 'Retired', MISSING: 'Missing' };

type Action = 'swap' | 'reduce' | 'self' | null;

export default function EquipmentAlertsScreen() {
  const { user, loading } = useAuth();
  const [alerts, setAlerts] = useState<AllocationAlert[] | null>(null);
  const [recent, setRecent] = useState<AlertFix[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [open, setOpen] = useState<{ id: string; action: Action } | null>(null);
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async () => {
    try {
      const r = await listAllocationAlerts();
      setAlerts(r.alerts); setRecent(r.recent); setError(null);
    } catch (e) { setError(errMsg(e)); }
  }, []);
  useEffect(() => {
    void load();
    const poll = window.setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 60_000);
    const clock = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => { window.clearInterval(poll); window.clearInterval(clock); };
  }, [load]);

  if (loading) return <Shell><p /></Shell>;
  if (!user) return <Navigate to="/" replace />;
  if (user.role !== 'COORDINATOR') return <Navigate to="/home" replace />;

  const done = (m: string) => { setNotice(m); setError(null); setOpen(null); void load(); notifyBorrowBadgesChanged(); };
  const list = alerts ?? [];
  const shortUnits = list.reduce((n, a) => n + a.short, 0);
  const problemCount = list.reduce((n, a) => n + a.problems.length, 0);
  const next = list.length ? list.reduce((a, b) => (new Date(a.start_at) < new Date(b.start_at) ? a : b)) : null;

  return (
    <Shell>
      {error && <div style={box.err}>{error}</div>}
      {notice && <div style={box.ok}>{notice}</div>}

      <div className="eqa-summary">
        <Stat color={P.red} value={list.length} label={list.length === 1 ? 'Line needs attention' : 'Lines need attention'} />
        <Stat color={P.amber} value={shortUnits} label="Units short" />
        <Stat color="#7C5CFC" value={problemCount} label="Picked articles not ready" />
        <Stat color="#2F6BFF" value={next ? startsIn(next.start_at, now).replace('Starts in ', '') : '—'} label="Until the next affected event" />
      </div>

      <Card title={`Needs attention${list.length ? ` (${list.length})` : ''}`}>
        {alerts === null ? <p style={muted}>Loading…</p> : list.length === 0 ? (
          <div style={emptyOk}>
            <span style={okIcon} aria-hidden>✓</span>
            <div>
              <strong style={{ display: 'block', color: P.navy900 }}>All locked event equipment is covered.</strong>
              <span style={{ color: P.slate500, fontSize: 13.5 }}>Equipment locks 24 hours before each event. Anything that can't be supplied will appear here.</span>
            </div>
          </div>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 14 }}>
            {list.map((a) => (
              <AlertCard
                key={a.allocation_id} a={a} now={now}
                action={open?.id === a.allocation_id ? open.action : null}
                setAction={(action) => setOpen(action ? { id: a.allocation_id, action } : null)}
                onDone={done} onError={(m) => { setError(m); setNotice(null); }}
              />
            ))}
          </ul>
        )}
      </Card>

      <Card title="Recent fixes (last 30 days)">
        {recent.length === 0 ? <p style={muted}>No swaps or self-managed changes yet.</p> : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {recent.map((f) => (
              <li key={`${f.kind}-${f.id}`} style={fixRow}>
                <span style={{ ...fixTag, ...(f.kind === 'SWAP' ? { background: '#E0E7FF', color: '#3730A3' } : { background: '#FEF3C7', color: '#92400E' }) }}>
                  {f.kind === 'SWAP' ? 'Swap' : 'Self-managed'}
                </span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontWeight: 600, color: P.navy900, fontSize: 14 }}>
                    {f.kind === 'SWAP'
                      ? <>{f.equipment_type_name}: <code style={code}>{f.outgoing_barcode}</code> → <code style={code}>{f.incoming_barcode}</code></>
                      : <>{f.quantity} × {f.equipment_type_name} — organiser brings own</>}
                  </div>
                  <div style={{ fontSize: 12.5, color: P.slate500, marginTop: 2 }}>
                    {f.purpose} · {f.venue_name} · {fmtDay(f.start_at)} {fmtTime(f.start_at)}
                    {f.performed_by ? ` · by ${f.performed_by}` : ''}{f.reason ? ` · “${f.reason}”` : ''}
                  </div>
                </div>
                <span style={{ fontSize: 12, color: P.slate500, whiteSpace: 'nowrap' }}>{fmtStamp(f.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </Shell>
  );
}

// ─── One alert ────────────────────────────────────────────────────────────────

function AlertCard({ a, now, action, setAction, onDone, onError }: {
  a: AllocationAlert; now: number; action: Action; setAction: (x: Action) => void;
  onDone: (m: string) => void; onError: (m: string) => void;
}) {
  const severe = a.short > 0;
  const color = severe ? P.red : P.amber;
  const pct = Math.round((a.covered / a.quantity) * 100);
  const unit = a.lending_unit === 'PAIR' ? (a.quantity === 1 ? 'pair' : 'pairs') : '';

  return (
    <li style={{ ...alertCard, borderColor: severe ? '#F5B5B5' : '#F6D9A8' }}>
      <span style={{ ...stripe, background: color }} aria-hidden />
      <div style={cardTop}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 800, color: P.navy900 }}>
            {a.equipment_type_name} <span style={{ color: P.slate500, fontWeight: 600 }}>× {a.quantity}{unit ? ` ${unit}` : ''}</span>
          </div>
          <div style={{ fontSize: 13.5, color: P.slate600, marginTop: 3 }}>
            <b style={{ color: P.navy900 }}>{a.purpose}</b>{a.session_no > 1 ? ` · Session ${a.session_no}` : ''} · {a.organiser}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {a.short > 0 && <span style={{ ...pill, background: '#FEE2E2', color: P.redDark }}>Short by {a.short}</span>}
          {a.problems.length > 0 && <span style={{ ...pill, background: '#FEF3C7', color: '#92400E' }}>{a.problems.length} picked article{a.problems.length > 1 ? 's' : ''} not ready</span>}
        </div>
      </div>

      <div className="eqa-meta">
        <Meta label="Venue" value={a.venue_name} />
        <Meta label="When" value={`${fmtDay(a.start_at)} · ${fmtTime(a.start_at)} – ${fmtTime(a.end_at)}`} />
        <Meta label="Countdown" value={startsIn(a.start_at, now)} strong={color} />
        <Meta label="Ready for this event" value={`${a.covered} of ${a.quantity}`} />
      </div>

      <div style={barTrack} aria-label={`${a.covered} of ${a.quantity} ready`}>
        <span style={{ ...barFill, width: `${pct}%`, background: pct >= 100 ? P.green : pct >= 50 ? P.amber : P.red }} />
      </div>

      {a.problems.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <span style={metaLabel}>Picked articles that are not ready</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
            {a.problems.map((p) => (
              <span key={p.article_id} style={chip}><code style={code}>{p.barcode}</code> {STATE_LABEL[p.state] ?? p.state}</span>
            ))}
          </div>
        </div>
      )}

      {action === null ? (
        <div style={actionRow}>
          {a.problems.length > 0 && <button style={btn.primary} onClick={() => setAction('swap')}>Swap article</button>}
          {a.quantity > 1 && <button style={btn.secondary} onClick={() => setAction('reduce')}>Reduce quantity</button>}
          <button style={btn.ghost} onClick={() => setAction('self')}>Organiser brings own</button>
          {a.short > 0 && a.problems.length === 0 && (
            <span style={hint}>Not enough {a.equipment_type_name} are ready. Get overdue items returned or repaired, or use one of these options.</span>
          )}
        </div>
      ) : action === 'swap' ? (
        <SwapForm a={a} onCancel={() => setAction(null)} onDone={onDone} onError={onError} />
      ) : action === 'reduce' ? (
        <ReduceForm a={a} onCancel={() => setAction(null)} onDone={onDone} onError={onError} />
      ) : (
        <SelfForm a={a} onCancel={() => setAction(null)} onDone={onDone} onError={onError} />
      )}
    </li>
  );
}

function SwapForm({ a, onCancel, onDone, onError }: { a: AllocationAlert; onCancel: () => void; onDone: (m: string) => void; onError: (m: string) => void }) {
  const [ready, setReady] = useState<Article[] | null>(null);
  const [outgoing, setOutgoing] = useState(a.problems[0]?.article_id ?? '');
  const [incoming, setIncoming] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    listArticles({ equipmentTypeId: a.equipment_type_id, state: 'AVAILABLE' })
      .then((r) => setReady(r.articles.filter((x) => !a.picked_ids.includes(x.article_id))))
      .catch((e) => { setReady([]); onError(errMsg(e)); });
  }, [a, onError]);

  async function submit() {
    setBusy(true);
    try { const r = await performSwap(a.allocation_id, { outgoingArticleId: outgoing, incomingArticleId: incoming, reason: reason.trim() || undefined }); onDone(r.message); }
    catch (e) { onError(errMsg(e)); } finally { setBusy(false); }
  }

  return (
    <div style={formBox}>
      <div className="eqa-form-grid">
        <Field label="Replace this article">
          <select style={inp} value={outgoing} onChange={(e) => setOutgoing(e.target.value)}>
            {a.problems.map((p) => <option key={p.article_id} value={p.article_id}>{p.barcode} · {STATE_LABEL[p.state] ?? p.state}</option>)}
          </select>
        </Field>
        <Field label={`With a ready ${a.equipment_type_name}`}>
          <select style={inp} value={incoming} onChange={(e) => setIncoming(e.target.value)} disabled={!ready || ready.length === 0}>
            <option value="">{ready === null ? 'Loading…' : ready.length === 0 ? 'No ready articles' : 'Select'}</option>
            {(ready ?? []).map((x) => <option key={x.article_id} value={x.article_id}>{x.barcode} · {x.current_condition_label}</option>)}
          </select>
        </Field>
        <div style={{ gridColumn: '1 / -1' }}>
          <Field label="Reason (optional)"><input style={inp} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Ball was not returned on time" /></Field>
        </div>
      </div>
      {ready !== null && ready.length === 0 && <p style={{ ...hint, color: P.redDark, marginTop: 8 }}>No other {a.equipment_type_name} is ready right now. Reduce the quantity or ask the organiser to bring their own.</p>}
      <div style={actionRow}>
        <button style={!outgoing || !incoming || busy ? { ...btn.primary, opacity: 0.5, cursor: 'not-allowed' } : btn.primary} disabled={!outgoing || !incoming || busy} onClick={submit}>{busy ? 'Saving…' : 'Confirm swap'}</button>
        <button style={btn.ghost} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function ReduceForm({ a, onCancel, onDone, onError }: { a: AllocationAlert; onCancel: () => void; onDone: (m: string) => void; onError: (m: string) => void }) {
  const [qty, setQty] = useState(Math.max(1, Math.min(a.quantity - 1, a.covered || 1)));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const ok = qty >= 1 && qty < a.quantity && reason.trim().length >= 3;

  async function submit() {
    setBusy(true);
    try { const r = await reduceAllocation(a.allocation_id, { quantity: qty, reason: reason.trim() }); onDone(r.message); }
    catch (e) { onError(errMsg(e)); } finally { setBusy(false); }
  }

  return (
    <div style={formBox}>
      <div className="eqa-form-grid">
        <Field label={`New quantity (currently ${a.quantity}, ${a.covered} ready)`}>
          <input style={inp} type="number" min={1} max={a.quantity - 1} value={qty} onChange={(e) => setQty(Number(e.target.value))} />
        </Field>
        <Field label="Reason (sent to the organiser)">
          <input style={inp} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Two balls are under repair" />
        </Field>
      </div>
      <div style={actionRow}>
        <button style={!ok || busy ? { ...btn.primary, opacity: 0.5, cursor: 'not-allowed' } : btn.primary} disabled={!ok || busy} onClick={submit}>{busy ? 'Saving…' : 'Reduce quantity'}</button>
        <button style={btn.ghost} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function SelfForm({ a, onCancel, onDone, onError }: { a: AllocationAlert; onCancel: () => void; onDone: (m: string) => void; onError: (m: string) => void }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const ok = reason.trim().length >= 3;

  async function submit() {
    setBusy(true);
    try { const r = await markAllocationSelfManaged(a.allocation_id, { reason: reason.trim() }); onDone(r.message); }
    catch (e) { onError(errMsg(e)); } finally { setBusy(false); }
  }

  return (
    <div style={formBox}>
      <p style={{ ...hint, margin: '0 0 10px' }}>
        The sports office will not supply these {a.quantity} {a.equipment_type_name}. The reservation is released and the organiser is asked to bring their own.
      </p>
      <Field label="Reason (sent to the organiser)">
        <input style={inp} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Not enough stock on the event day" />
      </Field>
      <div style={actionRow}>
        <button style={!ok || busy ? { ...btn.danger, opacity: 0.5, cursor: 'not-allowed' } : btn.danger} disabled={!ok || busy} onClick={submit}>{busy ? 'Saving…' : 'Confirm — organiser brings own'}</button>
        <button style={btn.ghost} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

// ─── Small pieces ─────────────────────────────────────────────────────────────

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="eqa-ui" style={page}>
      <style>{CSS}</style>
      <div style={blobA} aria-hidden /><div style={blobB} aria-hidden />
      <HideInAppShell>
        <header style={topbar}>
          <img src="/landing/bu_logo.png" alt="Bahria University" style={logo} />
          <div><div style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>Bahria University</div><div style={{ fontSize: 12, color: P.slate400 }}>Sports Management Portal</div></div>
        </header>
      </HideInAppShell>
      <main className="eqa-main" style={main}>
        <div className="eqa-glass" style={glass}>
          <div style={{ marginBottom: 20 }}>
            <span style={eyebrow}>Coordinator Portal</span>
            <h1 style={{ fontSize: 28, fontWeight: 800, color: '#fff', margin: 0, letterSpacing: '-0.5px' }}>Equipment Alerts</h1>
            <p style={{ fontSize: 14, color: P.slate300, margin: '6px 0 0', maxWidth: 680 }}>
              Event equipment is locked 24 hours before each event. These events can't be fully supplied yet — fix each one before it starts.
            </p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>{children}</div>
        </div>
      </main>
    </div>
  );
}
function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={card}>
      <div style={cardHead}>{title}</div>
      <div style={{ padding: '18px 20px' }}>{children}</div>
    </section>
  );
}
function Stat({ color, value, label }: { color: string; value: number | string; label: string }) {
  return (
    <div style={stat}>
      <i style={{ width: 10, height: 10, borderRadius: '50%', background: color, boxShadow: `0 0 0 4px ${color}33`, flex: '0 0 auto' }} />
      <div style={{ minWidth: 0 }}>
        <strong style={{ display: 'block', fontSize: 20, fontWeight: 800, color: '#fff', lineHeight: 1.1 }}>{value}</strong>
        <span style={{ fontSize: 12.5, color: P.slate300 }}>{label}</span>
      </div>
    </div>
  );
}
function Meta({ label, value, strong }: { label: string; value: string; strong?: string }) {
  return <div><span style={metaLabel}>{label}</span><span style={{ display: 'block', marginTop: 2, fontSize: 13.5, fontWeight: strong ? 700 : 500, color: strong ?? P.navy900 }}>{value}</span></div>;
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label style={{ display: 'block' }}><span style={{ ...metaLabel, marginBottom: 5, display: 'block' }}>{label}</span>{children}</label>;
}

const CSS = `
  .eqa-ui { font-family: 'Inter', system-ui, sans-serif; }
  .eqa-ui * { box-sizing: border-box; }
  .eqa-ui button { font-family: inherit; }
  .eqa-ui input:focus, .eqa-ui select:focus { outline: none; border-color: ${P.accent}; box-shadow: 0 0 0 3px #DBEAFE; }
  .eqa-summary { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
  .eqa-meta { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px 18px; margin-top: 14px; }
  .eqa-form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
  @media (max-width: 860px) { .eqa-summary, .eqa-meta { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  @media (max-width: 620px) {
    .eqa-glass { padding: 20px 12px 24px !important; border-radius: 18px !important; }
    .eqa-main { padding: 12px 10px 32px !important; }
    .eqa-form-grid { grid-template-columns: 1fr; }
  }
`;

const page: React.CSSProperties = {
  minHeight: '100%', display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden',
  background: `radial-gradient(1100px 700px at 15% 0%, ${P.navy800}aa 0%, transparent 60%), radial-gradient(900px 600px at 100% 100%, ${P.accent}22 0%, transparent 55%), ${P.navy900}`,
};
const blobA: React.CSSProperties = { position: 'absolute', width: 420, height: 420, borderRadius: '50%', background: `${P.accent}1a`, top: -160, left: -140, filter: 'blur(30px)', pointerEvents: 'none' };
const blobB: React.CSSProperties = { position: 'absolute', width: 380, height: 380, borderRadius: '50%', background: `${P.navy800}22`, bottom: -160, right: -120, filter: 'blur(30px)', pointerEvents: 'none' };
const topbar: React.CSSProperties = { position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', gap: 12, padding: '18px 32px' };
const logo: React.CSSProperties = { width: 40, height: 40, borderRadius: 10, objectFit: 'contain', background: P.slate50, padding: 4, border: `1px solid ${P.slate300}` };
const main: React.CSSProperties = { position: 'relative', zIndex: 1, flex: 1, padding: '20px 24px 56px', width: '100%', maxWidth: 1040, margin: '0 auto' };
const glass: React.CSSProperties = {
  background: 'rgba(255,255,255,0.07)', backdropFilter: 'blur(22px) saturate(160%)', WebkitBackdropFilter: 'blur(22px) saturate(160%)',
  border: '1px solid rgba(255,255,255,0.16)', borderRadius: 24, padding: '28px 24px 32px',
  boxShadow: '0 24px 60px -32px rgba(3,22,54,0.75), inset 0 1px 0 rgba(255,255,255,0.10)',
};
const eyebrow: React.CSSProperties = { display: 'inline-block', fontSize: 11.5, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', padding: '6px 14px', borderRadius: 999, marginBottom: 10, color: P.slate100, background: `${P.navy800}88`, border: `1px solid ${P.slate400}55` };
const stat: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderRadius: 14, background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.14)', minWidth: 0 };
const CARD_BG = 'linear-gradient(145deg, #F8FAFF 0%, #EAF0FC 100%)';
const card: React.CSSProperties = { border: `1px solid ${P.slate300}e6`, borderRadius: 16, overflow: 'hidden', background: CARD_BG, boxShadow: '0 12px 30px -22px rgba(3,22,54,.85)' };
const cardHead: React.CSSProperties = { padding: '14px 20px', background: '#fff', borderBottom: `1px solid ${P.slate300}`, fontWeight: 700, fontSize: 15, color: P.navy900 };
const alertCard: React.CSSProperties = { position: 'relative', overflow: 'hidden', background: '#fff', border: '1px solid', borderRadius: 14, padding: '16px 18px 16px 22px' };
const stripe: React.CSSProperties = { position: 'absolute', inset: '0 auto 0 0', width: 5 };
const cardTop: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' };
const pill: React.CSSProperties = { font: '700 12px Inter, sans-serif', padding: '5px 11px', borderRadius: 999, whiteSpace: 'nowrap' };
const metaLabel: React.CSSProperties = { fontSize: 11.5, fontWeight: 600, color: P.slate500, textTransform: 'uppercase', letterSpacing: 0.3 };
const barTrack: React.CSSProperties = { height: 6, borderRadius: 6, background: P.slate100, marginTop: 14, overflow: 'hidden' };
const barFill: React.CSSProperties = { display: 'block', height: '100%', borderRadius: 6 };
const chip: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 8, background: '#FFF7ED', border: '1px solid #FED7AA', fontSize: 12.5, color: '#9A3412', fontWeight: 600 };
const code: React.CSSProperties = { fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 12, color: P.navy900 };
const actionRow: React.CSSProperties = { display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap', alignItems: 'center' };
const hint: React.CSSProperties = { fontSize: 12.5, color: P.slate500, lineHeight: 1.45 };
const formBox: React.CSSProperties = { marginTop: 14, padding: 14, borderRadius: 12, background: P.slate50, border: `1px solid ${P.slate200}` };
const inp: React.CSSProperties = { width: '100%', font: '14px Inter, sans-serif', padding: '9px 11px', border: `1px solid ${P.slate300}`, borderRadius: 8, background: '#fff', color: P.navy900 };
const muted: React.CSSProperties = { color: P.slate500, fontSize: 14, margin: 0 };
const emptyOk: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 14, padding: '6px 2px' };
const okIcon: React.CSSProperties = { width: 38, height: 38, borderRadius: 12, display: 'grid', placeItems: 'center', background: '#DCFCE7', color: P.green, fontWeight: 800, fontSize: 18, flex: '0 0 auto' };
const fixRow: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: `1px solid ${P.slate200}` };
const fixTag: React.CSSProperties = { font: '700 11px Inter, sans-serif', padding: '4px 9px', borderRadius: 999, whiteSpace: 'nowrap' };
const btnBase: React.CSSProperties = { border: 'none', borderRadius: 9, padding: '9px 16px', fontSize: 13.5, fontWeight: 700, cursor: 'pointer' };
const btn = {
  primary: { ...btnBase, background: P.accent, color: '#fff' } as React.CSSProperties,
  secondary: { ...btnBase, background: '#E0E7FF', color: P.accent } as React.CSSProperties,
  ghost: { ...btnBase, background: '#fff', color: P.slate600, border: `1px solid ${P.slate300}` } as React.CSSProperties,
  danger: { ...btnBase, background: P.redDark, color: '#fff' } as React.CSSProperties,
};
const box = {
  err: { background: '#FDECEC', color: '#8F2323', border: '1px solid #F3CACA', borderRadius: 12, padding: '10px 14px', fontSize: 14 } as React.CSSProperties,
  ok: { background: '#E6F4EC', color: '#1F7A45', border: '1px solid #BFE3CC', borderRadius: 12, padding: '10px 14px', fontSize: 14 } as React.CSSProperties,
};
