/**
 * Student — My Borrow Requests: the full borrow history in one place.
 *
 * Every request the student ever made, newest first, with one clear stage:
 * Pending → Approved (ready to collect) → On loan → Returned, or Rejected /
 * Expired / Late. Loans show a live "out for" timer and turn red when late.
 * Opening this page clears the sidebar badge for newly approved requests.
 *
 * Same navy + glass theme as the other pages. Data: GET /api/borrow-desk/mine/history.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth.js';
import { ApiRequestError } from '../../lib/api.js';
import { HideInAppShell } from '../../components/AppShellContext.js';
import {
  formatDuration, getMyHistory, markApprovalsSeen, notifyBorrowBadgesChanged,
  type HistoryRow, type HistoryStage,
} from './deskApi.js';

const P = {
  navy900: '#0F172B', navy800: '#132357', accent: '#1C398E', slate600: '#45556C', slate500: '#62748E',
  slate400: '#90A1B9', slate300: '#CAD5E2', slate200: '#E2E8F0', slate100: '#EEF2F8', slate50: '#F8FAFC',
};

const STAGE: Record<HistoryStage, { label: string; fg: string; bg: string; group: 'active' | 'history' }> = {
  PENDING: { label: 'Pending review', fg: '#92400E', bg: '#FEF3C7', group: 'active' },
  READY_TO_COLLECT: { label: 'Approved — ready to collect', fg: '#15803D', bg: '#DCFCE7', group: 'active' },
  ON_LOAN: { label: 'On loan', fg: '#1D4ED8', bg: '#DBEAFE', group: 'active' },
  OVERDUE: { label: 'Late — return now', fg: '#B91C1C', bg: '#FEE2E2', group: 'active' },
  PARTLY_RETURNED: { label: 'Partly returned', fg: '#9A3412', bg: '#FFEDD5', group: 'active' },
  RETURNED: { label: 'Returned', fg: '#334155', bg: '#DCE3EE', group: 'history' },
  RETURNED_LATE: { label: 'Returned late', fg: '#9A3412', bg: '#FFEDD5', group: 'history' },
  NOT_COLLECTED: { label: 'Not collected', fg: '#475569', bg: '#DCE3EE', group: 'history' },
  REJECTED: { label: 'Rejected', fg: '#B91C1C', bg: '#FEE2E2', group: 'history' },
  CANCELLED: { label: 'Cancelled', fg: '#475569', bg: '#DCE3EE', group: 'history' },
  EXPIRED: { label: 'Expired', fg: '#475569', bg: '#DCE3EE', group: 'history' },
};
const URGENCY: HistoryStage[] = ['OVERDUE', 'PARTLY_RETURNED', 'ON_LOAN', 'READY_TO_COLLECT', 'PENDING', 'RETURNED_LATE', 'RETURNED', 'NOT_COLLECTED', 'REJECTED', 'EXPIRED', 'CANCELLED'];

type Filter = 'all' | 'active' | 'history';

const dateFmt = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const timeFmt = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
const stamp = (iso: string) => `${new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}, ${timeFmt(iso)}`;

interface Group { id: string; items: HistoryRow[]; stage: HistoryStage; start: string; end: string; submitted: string }

export default function MyBorrowRequestsScreen() {
  const { user, loading } = useAuth();
  const [rows, setRows] = useState<HistoryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async () => {
    try { const r = await getMyHistory(); setRows(r.requests); setError(null); }
    catch (e) { setError(e instanceof ApiRequestError ? e.body.error : 'Could not load your borrow requests.'); }
  }, []);

  useEffect(() => {
    if (user?.role !== 'STUDENT') return;
    void load();
    // Seeing this page clears the "approved" badge in the sidebar.
    markApprovalsSeen().then(notifyBorrowBadgesChanged).catch(() => {});
    const poll = window.setInterval(() => void load(), 60_000);
    const clock = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => { window.clearInterval(poll); window.clearInterval(clock); };
  }, [load, user?.role]);

  const groups = useMemo<Group[]>(() => {
    const m = new Map<string, HistoryRow[]>();
    for (const r of rows ?? []) m.set(r.request_group_id, [...(m.get(r.request_group_id) ?? []), r]);
    return [...m.entries()].map(([id, items]) => ({
      id, items,
      stage: [...items].sort((a, b) => URGENCY.indexOf(a.stage) - URGENCY.indexOf(b.stage))[0]!.stage,
      start: items[0]!.requested_start_at, end: items[0]!.requested_return_at, submitted: items[0]!.submitted_at,
    })).sort((a, b) => new Date(b.submitted).getTime() - new Date(a.submitted).getTime());
  }, [rows]);

  if (loading) return <div className="mbr-page"><Styles /></div>;
  if (!user) return <Navigate to="/" replace />;
  if (user.role !== 'STUDENT') return <Navigate to="/home" replace />;

  const count = (s: HistoryStage[]) => groups.filter((g) => s.includes(g.stage)).length;
  const shown = groups.filter((g) => filter === 'all' || STAGE[g.stage].group === filter);
  const summary = [
    { label: 'Pending', n: count(['PENDING']), color: '#F59E0B' },
    { label: 'Ready to collect', n: count(['READY_TO_COLLECT']), color: '#16A34A' },
    { label: 'On loan', n: count(['ON_LOAN', 'PARTLY_RETURNED']), color: '#2F6BFF' },
    { label: 'Late', n: count(['OVERDUE']), color: '#E5484D' },
    { label: 'Completed', n: count(['RETURNED', 'RETURNED_LATE']), color: '#7C5CFC' },
  ];

  return (
    <div className="mbr-page">
      <Styles />
      <div className="mbr-blobs" aria-hidden><div className="mbr-blob a" /><div className="mbr-blob b" /></div>
      <HideInAppShell>
        <header className="mbr-topbar">
          <img src="/landing/bu_logo.png" alt="Bahria University" />
          <div><strong>Bahria University</strong><span>Sports Management Portal</span></div>
        </header>
      </HideInAppShell>

      <main className="mbr-wrap">
        <div className="mbr-glass">
          <div className="mbr-hero">
            <span className="mbr-eyebrow">Student</span>
            <h1>My Borrow Requests</h1>
            <p>Every equipment request you have made — from submission to return.</p>
          </div>

          {error && <div className="mbr-alert">{error}</div>}

          <div className="mbr-summary">
            {summary.map((s) => (
              <div key={s.label} style={{ ['--c' as string]: s.color }}>
                <i /><strong>{s.n}</strong><span>{s.label}</span>
              </div>
            ))}
          </div>

          <div className="mbr-filter" role="radiogroup" aria-label="Show">
            {([['all', 'All'], ['active', 'Active'], ['history', 'History']] as const).map(([k, l]) => (
              <button key={k} type="button" role="radio" aria-checked={filter === k} className={filter === k ? 'is-on' : ''} onClick={() => setFilter(k)}>{l}</button>
            ))}
          </div>

          {rows === null ? <div className="mbr-empty">Loading…</div> : shown.length === 0 ? (
            <div className="mbr-empty">{groups.length === 0 ? 'You have not made any borrow requests yet.' : 'Nothing to show here.'}</div>
          ) : (
            <ul className="mbr-list">
              {shown.map((g) => <RequestCard key={g.id} g={g} now={now} />)}
            </ul>
          )}
        </div>
      </main>
    </div>
  );
}

function RequestCard({ g, now }: { g: Group; now: number }) {
  const st = STAGE[g.stage];
  const lead = g.items[0]!;
  const loan = g.items.find((i) => i.actual_start_at && !i.actual_return_at);
  let hint: React.ReactNode = null;
  if (g.stage === 'PENDING') hint = 'Waiting for the coordinator to review your request.';
  if (g.stage === 'READY_TO_COLLECT') hint = <>Bring your <b>university card</b> to the sports office on <b>{dateFmt(g.start)}</b> between <b>{timeFmt(g.start)} – {timeFmt(g.end)}</b> to collect it.</>;
  if (g.stage === 'ON_LOAN' && loan?.agreed_return_at) hint = <>Out for <b>{formatDuration(now - new Date(loan.actual_start_at!).getTime())}</b> · return by <b>{timeFmt(loan.agreed_return_at)}</b>.</>;
  if (g.stage === 'OVERDUE' && loan?.agreed_return_at) hint = <>Late by <b>{formatDuration(now - new Date(loan.agreed_return_at).getTime())}</b> — please return it to the sports office now.</>;
  if (g.stage === 'REJECTED' && lead.rejection_reason) hint = <>Reason: {lead.rejection_reason}</>;
  if (g.stage === 'EXPIRED') hint = 'It was not reviewed before the start time. You can submit a new request.';
  if (g.stage === 'NOT_COLLECTED') hint = 'The borrow window passed before the equipment was collected.';

  return (
    <li className={`mbr-card is-${g.stage.toLowerCase()}`} style={{ ['--c' as string]: st.fg }}>
      <div className="mbr-card-top">
        <div className="mbr-items">
          {g.items.map((i) => (
            <span key={i.borrow_request_id} className="mbr-item">
              {i.equipment_type_name}
              {g.items.length > 1 && i.stage !== g.stage && <em style={{ color: STAGE[i.stage].fg }}> · {STAGE[i.stage].label}</em>}
            </span>
          ))}
        </div>
        <span className="mbr-pill" style={{ color: st.fg, background: st.bg }}>{st.label}</span>
      </div>
      <dl className="mbr-meta">
        <div><dt>Borrow window</dt><dd>{dateFmt(g.start)} · {timeFmt(g.start)} – {timeFmt(g.end)}</dd></div>
        <div><dt>Submitted</dt><dd>{stamp(g.submitted)}</dd></div>
        {lead.decided_at && <div><dt>{g.stage === 'REJECTED' ? 'Rejected' : 'Approved'}</dt><dd>{stamp(lead.decided_at)}</dd></div>}
        {lead.actual_start_at && <div><dt>Collected</dt><dd>{stamp(lead.actual_start_at)}</dd></div>}
        {lead.actual_return_at && <div><dt>Returned</dt><dd>{stamp(lead.actual_return_at)}</dd></div>}
        {lead.barcodes && <div><dt>Item barcode</dt><dd>{g.items.map((i) => i.barcodes).filter(Boolean).join(', ')}</dd></div>}
      </dl>
      {hint && <p className="mbr-hint">{hint}</p>}
    </li>
  );
}

function Styles() {
  return <style>{`
    .mbr-page { position: relative; min-height: 100%; display: flex; flex-direction: column; font-family: 'Inter', system-ui, sans-serif; color: ${P.navy900};
      background: radial-gradient(1100px 700px at 15% 0%, ${P.navy800}aa 0%, transparent 60%), radial-gradient(900px 600px at 100% 100%, ${P.accent}22 0%, transparent 55%), ${P.navy900}; }
    .mbr-page *, .mbr-page *::before, .mbr-page *::after { box-sizing: border-box; }
    .mbr-blobs { position: absolute; inset: 0; overflow: hidden; pointer-events: none; }
    .mbr-blob { position: absolute; border-radius: 50%; filter: blur(30px); }
    .mbr-blob.a { width: 420px; height: 420px; top: -160px; left: -140px; background: ${P.accent}1a; }
    .mbr-blob.b { width: 380px; height: 380px; bottom: -160px; right: -120px; background: ${P.navy800}22; }
    .mbr-topbar { position: relative; z-index: 1; display: flex; align-items: center; gap: 12px; padding: 18px 32px; }
    .mbr-topbar img { width: 40px; height: 40px; border-radius: 10px; background: ${P.slate50}; padding: 4px; border: 1px solid ${P.slate300}; }
    .mbr-topbar strong { display: block; color: #fff; font-size: 16px; } .mbr-topbar span { display: block; color: ${P.slate400}; font-size: 12px; }
    .mbr-wrap { position: relative; z-index: 1; flex: 1; width: 100%; max-width: 1100px; margin: 0 auto; padding: 20px 24px 48px; }
    .mbr-glass { background: rgba(255,255,255,0.07); backdrop-filter: blur(22px) saturate(160%); -webkit-backdrop-filter: blur(22px) saturate(160%);
      border: 1px solid rgba(255,255,255,0.16); border-radius: 24px; padding: 26px 26px 30px;
      box-shadow: 0 24px 60px -32px rgba(3,22,54,0.75), inset 0 1px 0 rgba(255,255,255,0.10); }
    .mbr-hero { text-align: center; max-width: 640px; margin: 4px auto 22px; }
    .mbr-eyebrow { display: inline-block; font-size: 12px; font-weight: 700; letter-spacing: .5px; text-transform: uppercase; padding: 6px 14px;
      border-radius: 999px; margin-bottom: 14px; color: ${P.slate100}; background: ${P.navy800}88; border: 1px solid ${P.slate400}55; }
    .mbr-hero h1 { margin: 0 0 8px; font-size: 32px; font-weight: 800; letter-spacing: -.5px; color: #fff; }
    .mbr-hero p { margin: 0; font-size: 14.5px; color: ${P.slate300}; }
    .mbr-alert { margin-bottom: 14px; padding: 10px 14px; border-radius: 12px; background: #FDECEC; color: #8F2323; font-size: 14px; }
    .mbr-summary { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 10px; margin-bottom: 18px; }
    .mbr-summary > div { display: flex; align-items: center; gap: 9px; padding: 12px 14px; border-radius: 14px; background: rgba(255,255,255,0.07); border: 1px solid rgba(255,255,255,0.14); min-width: 0; }
    .mbr-summary i { width: 10px; height: 10px; border-radius: 50%; background: var(--c); box-shadow: 0 0 0 4px color-mix(in srgb, var(--c) 25%, transparent); flex: 0 0 auto; }
    .mbr-summary strong { font-size: 20px; font-weight: 800; color: #fff; }
    .mbr-summary span { font-size: 12.5px; color: ${P.slate300}; line-height: 1.2; }
    .mbr-filter { display: inline-flex; gap: 3px; padding: 4px; border-radius: 12px; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.16); margin-bottom: 16px; }
    .mbr-filter button { border: none; background: none; color: ${P.slate300}; font: 600 13px Inter, sans-serif; padding: 8px 16px; border-radius: 9px; cursor: pointer; }
    .mbr-filter button.is-on { background: #fff; color: ${P.accent}; }
    .mbr-empty { padding: 40px 16px; text-align: center; color: ${P.slate300}; font-size: 14px; border: 1px dashed rgba(255,255,255,0.2); border-radius: 16px; }
    .mbr-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; }
    .mbr-card { position: relative; overflow: hidden; padding: 16px 18px 16px 22px; border-radius: 16px; background: linear-gradient(145deg, #F8FAFF 0%, #EAF0FC 100%);
      border: 1px solid ${P.slate300}e6; box-shadow: 0 12px 30px -22px rgba(3,22,54,.85); }
    .mbr-card::before { content: ''; position: absolute; inset: 0 auto 0 0; width: 5px; background: var(--c); }
    .mbr-card.is-overdue { border-color: #F5B5B5; background: linear-gradient(145deg, #FFF7F7 0%, #FDECEC 100%); }
    .mbr-card-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; flex-wrap: wrap; }
    .mbr-items { display: flex; flex-wrap: wrap; gap: 6px 14px; }
    .mbr-item { font-size: 16px; font-weight: 700; color: ${P.navy900}; } .mbr-item em { font-style: normal; font-size: 12.5px; font-weight: 600; }
    .mbr-pill { font: 700 12px Inter, sans-serif; padding: 5px 11px; border-radius: 999px; white-space: nowrap; }
    .mbr-meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 8px 18px; margin: 12px 0 0; }
    .mbr-meta dt { font-size: 11.5px; font-weight: 600; color: ${P.slate500}; text-transform: uppercase; letter-spacing: .3px; }
    .mbr-meta dd { margin: 2px 0 0; font-size: 13.5px; font-weight: 500; color: ${P.navy900}; }
    .mbr-hint { margin: 12px 0 0; padding: 9px 12px; border-radius: 10px; font-size: 13px; color: ${P.slate600}; background: rgba(255,255,255,.75); border: 1px solid ${P.slate200}; }
    .mbr-hint b { color: ${P.navy900}; }
    .is-overdue .mbr-hint { color: #B91C1C; background: #FEE2E2; border-color: #FBD5D5; }
    .is-ready_to_collect .mbr-hint { background: #ECFDF3; border-color: #C6F0D6; }
    @media (max-width: 760px) {
      .mbr-wrap { padding: 12px 12px 32px; } .mbr-glass { padding: 18px 12px 22px; border-radius: 18px; }
      .mbr-hero h1 { font-size: 26px; } .mbr-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
  `}</style>;
}
