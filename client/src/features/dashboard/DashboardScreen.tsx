/**
 * Admin Dashboard — redesigned (SUPER_ADMIN only, as before).
 *
 * Same navy + glass language as Inventory / Messages. Every number is live:
 *   • GET /api/dashboard           (original, unchanged)  → operations strip
 *   • GET /api/dashboard-insights  (new, read-only)       → KPIs, charts, lists
 * The live equipment-availability stream (SSE) refreshes the numbers quietly,
 * so the dashboard stays up to date without a reload (DASH-06).
 *
 * No navigation links: the sidebar already covers every page. The only actions
 * are the in-place period filter and refresh. Pending requests are shown read-only
 * (borrow approvals are coordinator-only by business rule).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth.js';
import { ApiRequestError } from '../../lib/api.js';
import { HideInAppShell } from '../../components/AppShellContext.js';
import { getDashboard, type DashboardResponse } from './api.js';
import { getInsights, type DashboardInsights, type RangeDays } from './insightsApi.js';
import { subscribeAvailability } from '../availability/api.js';

/* ---------- theme (same values as the other navy pages) ---------- */
const P = {
  navy900: '#0F172B', navy800: '#132357', accent: '#1C398E', accentMid: '#2F55C4', accentSoft: '#DBEAFE',
  slate600: '#45556C', slate500: '#62748E', slate400: '#90A1B9', slate300: '#CAD5E2', slate200: '#E2E8F0',
  slate100: '#EEF2F8', slate50: '#F8FAFC', white: '#FFFFFF',
};
/** Data colours — one per metric, used consistently across cards and charts. */
const C = {
  blue: '#2F6BFF', violet: '#7C5CFC', teal: '#0EA5A4', amber: '#F59E0B', green: '#16A34A', rose: '#E5484D',
  orange: '#F97316', sky: '#0EA5E9', pink: '#DB2777',
};
const SPORT_COLORS = [C.blue, C.violet, C.teal, C.amber, C.pink];

const RANGES: Array<{ days: RangeDays; label: string }> = [
  { days: 7, label: '7 days' }, { days: 30, label: '30 days' }, { days: 90, label: '90 days' },
];

function errMsg(e: unknown) {
  return e instanceof ApiRequestError ? e.body.error : 'Something went wrong.';
}
function pctChange(cur: number, prev: number): { text: string; dir: 'up' | 'down' | 'flat' } {
  if (prev === 0 && cur === 0) return { text: 'No change', dir: 'flat' };
  if (prev === 0) return { text: 'New', dir: 'up' };
  const p = Math.round(((cur - prev) / prev) * 100);
  if (p === 0) return { text: '0%', dir: 'flat' };
  return { text: `${p > 0 ? '+' : ''}${p}%`, dir: p > 0 ? 'up' : 'down' };
}
function timeAgo(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}
function initials(name: string) {
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] ?? '') + (p.length > 1 ? p[p.length - 1]![0] : '')).toUpperCase();
}

export default function DashboardScreen() {
  const { user, loading: authLoading } = useAuth();
  const [days, setDays] = useState<RangeDays>(30);
  const [ins, setIns] = useState<DashboardInsights | null>(null);
  const [base, setBase] = useState<DashboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const load = useCallback(async (d: RangeDays, quiet = false) => {
    if (!quiet) setRefreshing(true);
    try {
      const [i, b] = await Promise.all([getInsights(d), getDashboard()]);
      setIns(i); setBase(b); setError(null); setUpdatedAt(new Date());
    } catch (e) {
      if (!quiet) setError(errMsg(e));
    } finally {
      if (!quiet) setRefreshing(false);
    }
  }, []);

  useEffect(() => { if (user?.role === 'SUPER_ADMIN') void load(days); }, [load, days, user?.role]);

  // Live: when equipment availability changes, quietly refresh (debounced).
  const daysRef = useRef(days);
  daysRef.current = days;
  useEffect(() => {
    if (user?.role !== 'SUPER_ADMIN') return;
    let first = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsub = subscribeAvailability(() => {
      if (first) { first = false; return; }
      clearTimeout(timer);
      timer = setTimeout(() => void load(daysRef.current, true), 2500);
    });
    return () => { clearTimeout(timer); unsub(); };
  }, [load, user?.role]);

  if (authLoading) return <div className="adb-page"><Styles /></div>;
  if (!user) return <Navigate to="/" replace />;
  if (user.role !== 'SUPER_ADMIN') return <Navigate to="/home" replace />;

  const firstName = user.fullName.trim().split(/\s+/)[0] ?? user.fullName;

  return (
    <div className="adb-page">
      <Styles />
      <div className="adb-blobs" aria-hidden><div className="adb-blob adb-blob-a" /><div className="adb-blob adb-blob-b" /></div>

      <HideInAppShell>
        <header className="adb-topbar">
          <div className="adb-brand">
            <img src="/landing/bu_logo.png" alt="Bahria University" />
            <div><strong>Bahria University</strong><span>Sports Management Portal</span></div>
          </div>
          <div className="adb-user">
            <span className="adb-avatar" aria-hidden>{initials(user.fullName)}</span>
            <div><strong>{user.fullName}</strong><span>Administration Staff</span></div>
          </div>
        </header>
      </HideInAppShell>

      <main className="adb-wrap">
        <div className="adb-glass">
          {/* ── hero ── */}
          <div className="adb-hero">
            <div>
              <span className="adb-eyebrow"><GridIcon /> Admin Dashboard</span>
              <h1>Welcome back, {firstName}!</h1>
              <p>Here's what's happening across the sports management system.</p>
            </div>
            <div className="adb-controls">
              <div className="adb-seg" role="radiogroup" aria-label="Time range">
                {RANGES.map((r) => (
                  <button key={r.days} type="button" role="radio" aria-checked={days === r.days}
                    className={days === r.days ? 'is-on' : ''} onClick={() => setDays(r.days)}>
                    {r.label}
                  </button>
                ))}
              </div>
              <button type="button" className="adb-refresh" onClick={() => void load(days)} disabled={refreshing}
                aria-label="Refresh dashboard" title="Refresh">
                <RefreshIcon spinning={refreshing} />
              </button>
              {updatedAt && <span className="adb-updated">Live · updated {fmtTime(updatedAt.toISOString())}</span>}
            </div>
          </div>

          {error && <div className="adb-alert">{error}</div>}

          {!ins || !base ? <Skeleton /> : (
            <>
              <KpiRow ins={ins} />
              <div className="adb-row adb-row-2">
                <AnalyticsCard ins={ins} />
                <HealthCard ins={ins} />
                <ActivityCard ins={ins} />
              </div>
              <div className="adb-row adb-row-3">
                <SportsCard ins={ins} />
                <PendingCard ins={ins} />
                <UpcomingCard ins={ins} />
              </div>
              <OperationsStrip base={base} />
            </>
          )}
        </div>
      </main>
    </div>
  );
}

/* ═══════════════════════ KPI cards ═══════════════════════ */
function KpiRow({ ins }: { ins: DashboardInsights }) {
  const k = ins.kpis;
  const span = `vs previous ${ins.range.days} days`;
  const pend = k.pending;
  const pendParts = [
    pend.borrow ? `${pend.borrow} borrow` : '', pend.venue ? `${pend.venue} venue` : '',
    pend.forwarded ? `${pend.forwarded} forwarded` : '', pend.accounts ? `${pend.accounts} accounts` : '',
  ].filter(Boolean);
  return (
    <div className="adb-kpis">
      <Kpi color={C.blue} icon={<ClipboardIcon />} value={k.borrowRequests.current} label="Borrow Requests"
        change={pctChange(k.borrowRequests.current, k.borrowRequests.previous)} foot={span} daily={k.borrowRequests.daily} />
      <Kpi color={C.violet} icon={<BuildingIcon />} value={k.venueBookings.current} label="Venue Bookings"
        change={pctChange(k.venueBookings.current, k.venueBookings.previous)} foot={span} daily={k.venueBookings.daily} />
      <Kpi color={C.teal} icon={<CubeIcon />} value={k.equipmentItems.total} label="Equipment Items"
        change={{ text: `${k.equipmentItems.available} available`, dir: 'flat' }}
        foot={`${k.equipmentItems.addedCurrent} added in ${ins.range.days} days`} daily={k.equipmentUsage.daily}
        sparkLabel="Daily borrows" />
      <Kpi color={C.amber} icon={<HourglassIcon />} value={pend.total} label="Pending Approvals"
        change={{ text: pend.total === 0 ? 'All clear' : 'Needs action', dir: pend.total === 0 ? 'up' : 'down' }}
        foot={pendParts.join(' · ') || 'Nothing waiting'} daily={pend.daily} sparkLabel="New requests per day" />
    </div>
  );
}

function Kpi({ color, icon, value, label, change, foot, daily, sparkLabel }: {
  color: string; icon: ReactNode; value: number; label: string;
  change: { text: string; dir: 'up' | 'down' | 'flat' }; foot: string; daily: number[]; sparkLabel?: string;
}) {
  return (
    <section className="adb-card adb-kpi" style={{ ['--c' as string]: color }}>
      <div className="adb-kpi-top">
        <span className="adb-kpi-icon">{icon}</span>
        <Sparkline values={daily} color={color} label={sparkLabel ?? `Daily ${label.toLowerCase()}`} />
      </div>
      <div className="adb-kpi-value">{value.toLocaleString()}</div>
      <div className="adb-kpi-label">{label}</div>
      <div className="adb-kpi-foot">
        <span className={`adb-delta is-${change.dir}`}>
          {change.dir === 'up' ? <ArrowUp /> : change.dir === 'down' ? <ArrowDown /> : null}{change.text}
        </span>
        <span className="adb-kpi-span">{foot}</span>
      </div>
    </section>
  );
}

function Sparkline({ values, color, label }: { values: number[]; color: string; label: string }) {
  const W = 120, H = 44;
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? W / (values.length - 1) : W;
  const pts = values.map((v, i) => [i * step, H - 4 - (v / max) * (H - 10)] as const);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const id = useMemo(() => `sp${Math.random().toString(36).slice(2, 8)}`, []);
  return (
    <svg className="adb-spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img"
      aria-label={`${label}: ${values.reduce((a, b) => a + b, 0)} in total`}>
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity=".28" /><stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {values.length > 1 && <path d={`${line} L${W},${H} L0,${H} Z`} fill={`url(#${id})`} />}
      <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/* ═══════════════════════ Overview analytics ═══════════════════════ */
type SeriesKey = 'borrowRequests' | 'venueBookings' | 'equipmentUsage';
const SERIES_TABS: Array<{ key: SeriesKey; label: string; color: string }> = [
  { key: 'borrowRequests', label: 'Borrow Requests', color: C.blue },
  { key: 'venueBookings', label: 'Venue Bookings', color: C.violet },
  { key: 'equipmentUsage', label: 'Equipment Usage', color: C.teal },
];

function AnalyticsCard({ ins }: { ins: DashboardInsights }) {
  const [tab, setTab] = useState<SeriesKey>('borrowRequests');
  const t = SERIES_TABS.find((x) => x.key === tab)!;
  const data = ins.analytics[tab];
  const total = data.current.reduce((a, b) => a + b, 0);
  const bucketWord = ins.range.bucketDays === 1 ? 'day' : `${ins.range.bucketDays}-day period`;
  return (
    <section className="adb-card adb-analytics">
      <CardHead icon={<ChartIcon />} color={C.blue} title="Overview Analytics"
        right={<span className="adb-muted">{total} in last {ins.range.days} days</span>} />
      <div className="adb-tabs" role="tablist">
        {SERIES_TABS.map((s) => (
          <button key={s.key} type="button" role="tab" aria-selected={tab === s.key}
            className={tab === s.key ? 'is-on' : ''} style={{ ['--c' as string]: s.color }} onClick={() => setTab(s.key)}>
            {s.label}
          </button>
        ))}
      </div>
      <div className="adb-legend">
        <span><i style={{ background: t.color }} /> This period</span>
        <span><i style={{ background: P.slate300 }} /> Previous period</span>
        <span className="adb-muted">Each point = one {bucketWord}</span>
      </div>
      <div className="adb-an-body">
        <LineChart labels={ins.analytics.labels} current={data.current} previous={data.previous} color={t.color} />
        <AnalyticsSummary current={data.current} previous={data.previous} labels={ins.analytics.labels} color={t.color} />
      </div>
    </section>
  );
}

function AnalyticsSummary({ current, previous, labels, color }: { current: number[]; previous: number[]; labels: string[]; color: string }) {
  const cur = current.reduce((a, b) => a + b, 0);
  const prev = previous.reduce((a, b) => a + b, 0);
  const ch = pctChange(cur, prev);
  const peak = Math.max(0, ...current);
  const peakAt = current.indexOf(peak);
  const avg = current.length ? cur / current.length : 0;
  return (
    <div className="adb-sum" style={{ ['--c' as string]: color }}>
      <div><span>This period</span><strong>{cur}</strong></div>
      <div><span>Previous</span><strong>{prev}</strong></div>
      <div><span>Change</span><strong className={`is-${ch.dir}`}>{ch.text}</strong></div>
      <div><span>Busiest</span><strong>{peak > 0 ? labels[peakAt] : '—'}</strong></div>
      <div><span>Avg. per point</span><strong>{avg.toFixed(1)}</strong></div>
    </div>
  );
}

function LineChart({ labels, current, previous, color }: { labels: string[]; current: number[]; previous: number[]; color: string }) {
  // Draw at the container's real pixel width so text never shrinks.
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(520);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => { if (e) setW(Math.max(240, Math.round(e.contentRect.width))); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const H = 250, L = 34, R = 14, T = 12, B = 28;
  const raw = Math.max(1, ...current, ...previous);
  const stepY = raw <= 5 ? 1 : Math.ceil(raw / 4 / 5) * 5;
  const max = stepY * Math.ceil(raw / stepY);
  const n = Math.max(current.length, 1);
  const x = (i: number) => L + (n > 1 ? (i * (W - L - R)) / (n - 1) : (W - L - R) / 2);
  const y = (v: number) => T + (H - T - B) * (1 - v / max);
  const path = (arr: number[]) => arr.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const ticks: number[] = [];
  for (let v = 0; v <= max; v += stepY) ticks.push(v);
  const every = Math.ceil(labels.length / Math.max(2, Math.floor(W / 80)));
  const empty = current.every((v) => v === 0) && previous.every((v) => v === 0);
  return (
    <div className="adb-chart" ref={box}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Line chart comparing this period with the previous period">
        <defs>
          <linearGradient id="adb-area" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity=".22" /><stop offset="1" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke={P.slate200} strokeDasharray={v === 0 ? '' : '3 4'} />
            <text x={L - 8} y={y(v) + 4} textAnchor="end" className="adb-axis">{v}</text>
          </g>
        ))}
        {labels.map((l, i) => (i % every === 0 || i === labels.length - 1) && (
          <text key={i} x={x(i)} y={H - 8} textAnchor={i === labels.length - 1 && i > 0 ? 'end' : i === 0 ? 'start' : 'middle'} className="adb-axis">{l}</text>
        ))}
        <path d={path(previous)} fill="none" stroke={P.slate300} strokeWidth="2" strokeDasharray="5 4" strokeLinecap="round" />
        <path d={`${path(current)} L${x(current.length - 1)},${y(0)} L${x(0)},${y(0)} Z`} fill="url(#adb-area)" />
        <path d={path(current)} fill="none" stroke={color} strokeWidth="2.6" strokeLinejoin="round" strokeLinecap="round" />
        {current.map((v, i) => (
          <g key={i} className="adb-pt">
            <circle cx={x(i)} cy={y(v)} r="4" fill="#fff" stroke={color} strokeWidth="2.2" />
            <title>{`${labels[i] ?? ''}: ${v} (previous: ${previous[i] ?? 0})`}</title>
          </g>
        ))}
      </svg>
      {empty && <div className="adb-chart-empty">No activity in this period yet</div>}
    </div>
  );
}

/* ═══════════════════════ Equipment health ═══════════════════════ */
function HealthCard({ ins }: { ins: DashboardInsights }) {
  const h = ins.health;
  const total = h.good + h.worn + h.damaged;
  const parts = [
    { label: 'Good', n: h.good, color: C.green },
    { label: 'Worn', n: h.worn, color: C.amber },
    { label: 'Damaged', n: h.damaged, color: C.rose },
  ];
  const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0);
  const R = 62, CIRC = 2 * Math.PI * R;
  let offset = 0;
  const attention = h.damaged + h.openFlags;
  const cvTotal = Object.values(h.cvScansInPeriod).reduce((a, b) => a + (b ?? 0), 0);
  return (
    <section className="adb-card adb-health">
      <CardHead icon={<HeartIcon />} color={C.green} title="Equipment Health" />
      <div className="adb-donut-wrap">
        <svg viewBox="0 0 160 160" className="adb-donut" role="img"
          aria-label={`Good ${pct(h.good)}%, worn ${pct(h.worn)}%, damaged ${pct(h.damaged)}%`}>
          <circle cx="80" cy="80" r={R} fill="none" stroke={P.slate200} strokeWidth="16" />
          {total > 0 && parts.map((p) => {
            const len = (p.n / total) * CIRC;
            const el = p.n > 0 ? (
              <circle key={p.label} cx="80" cy="80" r={R} fill="none" stroke={p.color} strokeWidth="16"
                strokeDasharray={`${Math.max(len - 2, 0.01)} ${CIRC}`} strokeDashoffset={-offset} transform="rotate(-90 80 80)" />
            ) : null;
            offset += len;
            return el;
          })}
        </svg>
        <div className="adb-donut-center" title="Average of each item's most recent health score: the entry score given when it was added, or its latest manual / photo health check">
          <strong>{h.averageScore !== null ? `${h.averageScore}%` : `${pct(h.good)}%`}</strong>
          <span>{h.averageScore !== null ? 'Avg. latest score' : 'In good condition'}</span>
        </div>
      </div>
      <ul className="adb-health-legend">
        {parts.map((p) => (
          <li key={p.label}><i style={{ background: p.color }} />{p.label}<b>{p.n}</b><em>{pct(p.n)}%</em></li>
        ))}
      </ul>
      <div className={`adb-note ${attention ? 'is-warn' : 'is-ok'}`}>
        {attention ? <AlertIcon /> : <CheckIcon />}
        <div>
          <strong>{attention ? `${h.damaged} damaged · ${h.openFlags} open damage flag${h.openFlags === 1 ? '' : 's'}` : 'All equipment is in usable condition'}</strong>
          <span>{h.scannedArticles} of {total} items have a health score{cvTotal ? ` · ${cvTotal} photo health checks in ${ins.range.days} days` : ''}</span>
        </div>
      </div>
    </section>
  );
}

/* ═══════════════════════ Recent activity ═══════════════════════ */
function activityStyle(kind: string): { color: string; icon: ReactNode } {
  if (kind === 'BORROW_REQUEST') return { color: C.blue, icon: <ClipboardIcon /> };
  if (kind === 'VENUE_BOOKING') return { color: C.violet, icon: <BuildingIcon /> };
  if (kind === 'DAMAGE_FLAG') return { color: C.rose, icon: <AlertIcon /> };
  if (kind === 'RETURN') return { color: C.teal, icon: <ReturnIcon /> };
  if (kind === 'DECISION_APPROVE') return { color: C.green, icon: <CheckIcon /> };
  if (kind === 'DECISION_REJECT' || kind === 'DECISION_CANCEL') return { color: C.orange, icon: <CrossIcon /> };
  return { color: C.sky, icon: <ForwardIcon /> };
}

function ActivityCard({ ins }: { ins: DashboardInsights }) {
  return (
    <section className="adb-card adb-activity">
      <CardHead icon={<ClockIcon />} color={C.sky} title="Recent Activity" />
      {ins.activity.length === 0 ? <Empty text="No activity yet" /> : (
        <ul className="adb-feed">
          {ins.activity.map((a, i) => {
            const st = activityStyle(a.kind);
            return (
              <li key={i}>
                <span className="adb-feed-icon" style={{ color: st.color, background: `${st.color}1a` }}>{st.icon}</span>
                <div><strong>{a.title}</strong><span>{a.detail}</span></div>
                <time dateTime={a.at}>{timeAgo(a.at)}</time>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/* ═══════════════════════ Top sports ═══════════════════════ */
function SportsCard({ ins }: { ins: DashboardInsights }) {
  const rows = ins.topSports;
  const max = Math.max(1, ...rows.map((r) => r.borrows + r.sessions));
  return (
    <section className="adb-card adb-sports">
      <CardHead icon={<TrophyIcon />} color={C.amber} title="Top Sports by Activity"
        right={<span className="adb-muted">last {ins.range.days} days</span>} />
      {rows.length === 0 ? <Empty text="No borrows or venue sessions in this period" /> : (
        <>
          <div className="adb-bars" style={{ gridTemplateColumns: `repeat(${rows.length}, minmax(0, 1fr))` }}>
            {rows.map((r, i) => {
              const t = r.borrows + r.sessions;
              const color = SPORT_COLORS[i % SPORT_COLORS.length]!;
              return (
                <div key={r.sport} className="adb-bar-col" title={`${r.sport}: ${r.borrows} equipment borrows, ${r.sessions} venue sessions`}>
                  <span className="adb-bar-val">{t}</span>
                  <div className="adb-bar-track">
                    <div className="adb-bar" style={{ height: `${(t / max) * 100}%`, background: `linear-gradient(180deg, ${color}, ${color}cc)` }} />
                  </div>
                </div>
              );
            })}
          </div>
          <div className="adb-bar-labels" style={{ gridTemplateColumns: `repeat(${rows.length}, minmax(0, 1fr))` }}>
            {rows.map((r) => <span key={r.sport} title={r.sport}>{r.sport}</span>)}
          </div>
          <ul className="adb-sport-split">
            {rows.map((r, i) => (
              <li key={r.sport}><i style={{ background: SPORT_COLORS[i % SPORT_COLORS.length] }} />{r.sport}
                <span>{r.borrows} borrow{r.borrows === 1 ? '' : 's'} · {r.sessions} session{r.sessions === 1 ? '' : 's'}</span></li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/* ═══════════════════════ Pending requests ═══════════════════════ */
const TYPE_STYLE: Record<string, { label: string; color: string }> = {
  EQUIPMENT: { label: 'Equipment', color: C.blue },
  VENUE: { label: 'Venue', color: C.violet },
  ACCOUNT: { label: 'Account', color: C.teal },
};

function PendingCard({ ins }: { ins: DashboardInsights }) {
  // Read-only: borrow approvals are coordinator-only (Borrow Queue), venue and
  // account decisions have their own pages in the sidebar.
  const statusText = (p: DashboardInsights['pending'][number]) =>
    p.status === 'FORWARDED' ? 'Forwarded to you' : p.type === 'ACCOUNT' ? 'To verify' : 'With coordinator';
  return (
    <section className="adb-card adb-pending">
      <CardHead icon={<HourglassIcon />} color={C.amber} title="Pending Requests"
        right={ins.kpis.pending.total > 0 ? <span className="adb-count">{ins.kpis.pending.total}</span> : undefined} />
      {ins.pending.length === 0 ? <Empty text="Nothing is waiting for a decision" good /> : (
        <div className="adb-table-wrap">
          <table className="adb-table">
            <thead><tr><th>Type</th><th>Requested by</th><th>Item</th><th>Date</th><th>Status</th></tr></thead>
            <tbody>
              {ins.pending.map((p) => {
                const t = TYPE_STYLE[p.type] ?? { label: p.type, color: C.sky };
                return (
                  <tr key={`${p.type}-${p.id}`}>
                    <td><span className="adb-type" style={{ color: t.color, background: `${t.color}1a` }}>{t.label}</span></td>
                    <td className="adb-strong">{p.requestedBy}</td>
                    <td>{p.item}</td>
                    <td className="adb-nowrap">{new Date(p.at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}</td>
                    <td><span className={`adb-status ${p.status === 'FORWARDED' ? 'is-fwd' : p.type === 'ACCOUNT' ? 'is-acc' : ''}`}>{statusText(p)}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <PendingSplit ins={ins} />
    </section>
  );
}

/** Small coloured breakdown of everything waiting (live counts). */
function PendingSplit({ ins }: { ins: DashboardInsights }) {
  const k = ins.kpis.pending;
  const parts = [
    { label: 'Borrow requests', n: k.borrow, color: C.blue },
    { label: 'Venue (coordinator)', n: k.venue, color: C.violet },
    { label: 'Forwarded to admin', n: k.forwarded, color: C.orange },
    ...(k.accounts !== null ? [{ label: 'Accounts to verify', n: k.accounts, color: C.teal }] : []),
  ];
  const total = parts.reduce((a, b) => a + b.n, 0);
  return (
    <div className="adb-split">
      <div className="adb-split-bar" aria-hidden>
        {total > 0 && parts.map((p) => p.n > 0 && <span key={p.label} style={{ flex: p.n, background: p.color }} />)}
      </div>
      <ul>
        {parts.map((p) => <li key={p.label}><i style={{ background: p.color }} />{p.label}<b>{p.n}</b></li>)}
      </ul>
    </div>
  );
}

/* ═══════════════════════ Upcoming events ═══════════════════════ */
function UpcomingCard({ ins }: { ins: DashboardInsights }) {
  const colors = [C.blue, C.violet, C.teal, C.amber];
  return (
    <section className="adb-card adb-upcoming">
      <CardHead icon={<CalendarIcon />} color={C.violet} title="Upcoming Events" />
      {ins.upcoming.length === 0 ? <Empty text="No approved sessions coming up" /> : (
        <ul className="adb-events">
          {ins.upcoming.map((e, i) => {
            const d = new Date(e.start);
            const color = colors[i % colors.length]!;
            return (
              <li key={i}>
                <div className="adb-date" style={{ color, background: `${color}14`, borderColor: `${color}33` }}>
                  <strong>{d.toLocaleDateString('en-US', { day: '2-digit' })}</strong>
                  <span>{d.toLocaleDateString('en-US', { month: 'short' })}</span>
                </div>
                <div className="adb-event-body" style={{ borderColor: color }}>
                  <strong title={e.title}>{e.title}</strong>
                  <span>{e.venue} · {fmtTime(e.start)} – {fmtTime(e.end)}</span>
                  {e.bookingType && <em>{e.bookingType === 'EXTERNAL_EVENT' ? 'External' : e.bookingType === 'INTER_UNIVERSITY' ? 'Inter-university' : 'Internal'}</em>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/* ═══════════════════════ Operations strip (original /api/dashboard) ═══════════════════════ */
function OperationsStrip({ base }: { base: DashboardResponse }) {
  const d = base.dashboard;
  const items: Array<{ label: string; value: number; color: string }> = [
    { label: 'Active borrows', value: d.activeBorrows.active, color: C.blue },
    { label: 'Overdue', value: d.activeBorrows.overdue, color: C.rose },
    { label: 'Due within 24h', value: d.activeBorrows.dueSoonCount, color: C.amber },
    { label: 'Items on loan', value: d.inventory.articlesOnLoan, color: C.teal },
    { label: 'Low-stock types', value: d.inventory.lowStockTypes, color: C.orange },
  ];
  if (base.role === 'SUPER_ADMIN') {
    const u = base.dashboard.userManagement;
    items.push(
      { label: 'Active students', value: u.activeStudents, color: C.violet },
      { label: 'Coordinators', value: u.activeCoordinators, color: C.sky },
    );
  }
  return (
    <section className="adb-ops" aria-label="Operations at a glance">
      {items.map((it) => (
        <div key={it.label} className="adb-op" style={{ ['--c' as string]: it.color }}>
          <span className="adb-op-dot" />
          <strong>{it.value.toLocaleString()}</strong>
          <span>{it.label}</span>
        </div>
      ))}
    </section>
  );
}

/* ═══════════════════════ shared bits ═══════════════════════ */
function CardHead({ icon, color, title, right }: { icon: ReactNode; color: string; title: string; right?: ReactNode }) {
  return (
    <div className="adb-card-head">
      <span className="adb-head-icon" style={{ color, background: `${color}1a` }}>{icon}</span>
      <h2>{title}</h2>
      {right && <div className="adb-head-right">{right}</div>}
    </div>
  );
}
function Empty({ text, good }: { text: string; good?: boolean }) {
  return <div className={`adb-empty ${good ? 'is-good' : ''}`}>{good ? <CheckIcon /> : <InfoIcon />}<span>{text}</span></div>;
}
function Skeleton() {
  return (
    <>
      <div className="adb-kpis">{[0, 1, 2, 3].map((i) => <div key={i} className="adb-card adb-skel" style={{ height: 150 }} />)}</div>
      <div className="adb-row adb-row-2">{[0, 1, 2].map((i) => <div key={i} className="adb-card adb-skel" style={{ height: 360 }} />)}</div>
    </>
  );
}

/* ═══════════════════════ styles ═══════════════════════ */
function Styles() {
  const css = useMemo(() => `
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
    .adb-page { position: relative; min-height: 100%; display: flex; flex-direction: column; font-family: 'Inter', system-ui, sans-serif; color: ${P.navy900};
      background: radial-gradient(1100px 700px at 15% 0%, ${P.navy800}aa 0%, transparent 60%),
                  radial-gradient(900px 600px at 100% 100%, ${P.accent}22 0%, transparent 55%), ${P.navy900}; }
    .adb-page *, .adb-page *::before, .adb-page *::after { box-sizing: border-box; }
    .adb-blobs { position: absolute; inset: 0; overflow: hidden; pointer-events: none; }
    .adb-blob { position: absolute; border-radius: 50%; filter: blur(30px); }
    .adb-blob-a { width: 420px; height: 420px; top: -160px; left: -140px; background: ${P.accent}1a; }
    .adb-blob-b { width: 380px; height: 380px; bottom: -160px; right: -120px; background: ${P.navy800}22; }
    .adb-wrap { position: relative; z-index: 1; flex: 1; width: 100%; max-width: 1480px; margin: 0 auto; padding: 20px 24px 48px; }
    .adb-glass { background: rgba(255,255,255,0.07); backdrop-filter: blur(22px) saturate(160%); -webkit-backdrop-filter: blur(22px) saturate(160%);
      border: 1px solid rgba(255,255,255,0.16); border-radius: 24px; padding: 26px 26px 30px;
      box-shadow: 0 24px 60px -32px rgba(3,22,54,0.75), inset 0 1px 0 rgba(255,255,255,0.10); }

    .adb-topbar { position: relative; z-index: 1; display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 18px 32px; flex-wrap: wrap; }
    .adb-brand, .adb-user { display: flex; align-items: center; gap: 12px; }
    .adb-brand img { width: 40px; height: 40px; border-radius: 10px; object-fit: contain; background: ${P.slate50}; padding: 4px; border: 1px solid ${P.slate300}; }
    .adb-brand strong, .adb-user strong { display: block; font-size: 16px; font-weight: 700; color: #fff; }
    .adb-brand span, .adb-user span { display: block; font-size: 12px; color: ${P.slate400}; margin-top: 1px; }
    .adb-avatar { width: 40px; height: 40px; border-radius: 50%; display: inline-flex !important; align-items: center; justify-content: center;
      background: linear-gradient(135deg, ${P.accent}, ${P.accentMid}); color: #fff !important; font: 700 14px Inter, sans-serif; margin: 0 !important; }

    .adb-hero { display: flex; justify-content: space-between; align-items: flex-end; gap: 18px; flex-wrap: wrap; margin-bottom: 22px; }
    .adb-eyebrow { display: inline-flex; align-items: center; gap: 7px; font-size: 12px; font-weight: 700; letter-spacing: .5px; text-transform: uppercase;
      padding: 6px 14px; border-radius: 999px; margin-bottom: 12px; color: ${P.slate100}; background: ${P.navy800}88; border: 1px solid ${P.slate400}55; }
    .adb-hero h1 { margin: 0 0 6px; font-size: 30px; font-weight: 800; letter-spacing: -.5px; color: #fff; }
    .adb-hero p { margin: 0; font-size: 14.5px; color: ${P.slate300}; }
    .adb-controls { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .adb-seg { display: inline-flex; gap: 3px; padding: 4px; border-radius: 12px; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.16); }
    .adb-seg button { border: none; background: none; color: ${P.slate300}; font: 600 13px Inter, sans-serif; padding: 8px 13px; border-radius: 9px; cursor: pointer; transition: background-color .15s, color .15s; }
    .adb-seg button:hover { color: #fff; }
    .adb-seg button.is-on { background: #fff; color: ${P.accent}; box-shadow: 0 6px 14px -8px rgba(0,0,0,.5); }
    .adb-refresh { width: 40px; height: 40px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.2); background: rgba(255,255,255,0.08); color: ${P.slate100};
      display: inline-flex; align-items: center; justify-content: center; cursor: pointer; transition: background-color .15s; }
    .adb-refresh:hover:not(:disabled) { background: rgba(255,255,255,0.16); }
    .adb-updated { display: inline-flex; align-items: center; gap: 7px; font-size: 12.5px; color: ${P.slate300}; }
    .adb-updated::before { content: ''; width: 8px; height: 8px; border-radius: 50%; background: #34D399; box-shadow: 0 0 0 3px #34D39933; }
    .adb-alert { margin-bottom: 16px; padding: 11px 14px; border-radius: 12px; background: #FDECEC; color: #8F2323; border: 1px solid #F3CACA; font-size: 14px; }

    .adb-card { position: relative; min-width: 0; background: linear-gradient(145deg, #F8FAFF 0%, #EAF0FC 100%); border: 1px solid ${P.slate300}e6;
      border-radius: 18px; padding: 18px 20px 20px; box-shadow: 0 12px 30px -22px rgba(3,22,54,.85); }
    .adb-card-head { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
    .adb-card-head h2 { margin: 0; font-size: 16.5px; font-weight: 700; color: ${P.navy900}; }
    .adb-head-icon { width: 34px; height: 34px; border-radius: 10px; display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; }
    .adb-head-right { margin-left: auto; }
    .adb-muted { font-size: 12.5px; color: ${P.slate500}; }
    .adb-count { font: 700 12px Inter, sans-serif; color: #fff; background: ${C.amber}; border-radius: 999px; padding: 3px 10px; }

    .adb-kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; margin-bottom: 16px; }
    .adb-kpi { overflow: hidden; padding: 18px 18px 16px; }
    .adb-kpi::before { content: ''; position: absolute; inset: 0 auto 0 0; width: 4px; background: var(--c); }
    .adb-kpi-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; }
    .adb-kpi-icon { width: 46px; height: 46px; border-radius: 14px; display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto;
      color: var(--c); background: color-mix(in srgb, var(--c) 14%, white); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--c) 22%, transparent); }
    .adb-spark { width: 54%; max-width: 150px; height: 46px; }
    .adb-kpi-value { margin-top: 10px; font-size: 32px; font-weight: 800; line-height: 1; color: ${P.navy900}; letter-spacing: -.5px; font-variant-numeric: tabular-nums; }
    .adb-kpi-label { margin-top: 5px; font-size: 14px; font-weight: 600; color: ${P.slate600}; }
    .adb-kpi-foot { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 12px; font-size: 12px; }
    .adb-delta { display: inline-flex; align-items: center; gap: 3px; font-weight: 700; padding: 3px 8px; border-radius: 999px; }
    .adb-delta.is-up { color: #15803D; background: #DCFCE7; }
    .adb-delta.is-down { color: #B91C1C; background: #FEE2E2; }
    .adb-delta.is-flat { color: ${P.slate600}; background: ${P.slate100}; }
    .adb-kpi-span { color: ${P.slate500}; }

    .adb-row { display: grid; gap: 16px; margin-bottom: 16px; }
    .adb-row-2 { grid-template-columns: minmax(0, 1.55fr) minmax(0, 1fr) minmax(0, 1.1fr); }
    .adb-row-3 { grid-template-columns: minmax(0, 1fr) minmax(0, 1.6fr) minmax(0, 1.05fr); }

    .adb-tabs { display: flex; gap: 18px; border-bottom: 1px solid ${P.slate200}; margin-bottom: 12px; overflow-x: auto; }
    .adb-tabs button { border: none; background: none; padding: 8px 2px 10px; font: 600 13.5px Inter, sans-serif; color: ${P.slate500}; cursor: pointer;
      border-bottom: 2.5px solid transparent; margin-bottom: -1px; white-space: nowrap; }
    .adb-tabs button.is-on { color: var(--c); border-bottom-color: var(--c); }
    .adb-legend { display: flex; gap: 16px; flex-wrap: wrap; align-items: center; font-size: 12.5px; color: ${P.slate600}; margin-bottom: 6px; }
    .adb-legend i { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 6px; vertical-align: -1px; }
    .adb-legend .adb-muted { margin-left: auto; }
    .adb-chart { position: relative; }
    /* chart on the left, summary as a column on the right */
    .adb-analytics { container-type: inline-size; }
    .adb-an-body { display: grid; grid-template-columns: minmax(0, 1fr) 148px; gap: 14px; align-items: start; }
    .adb-sum { display: flex; flex-direction: column; gap: 8px; }
    .adb-sum > div { display: flex; flex-direction: column; gap: 2px; padding: 9px 12px; border-radius: 12px;
      background: rgba(255,255,255,.75); border: 1px solid ${P.slate200}; min-width: 0; }
    .adb-sum > div:first-child { background: color-mix(in srgb, var(--c) 10%, white); border-color: color-mix(in srgb, var(--c) 28%, white); }
    .adb-sum span { font-size: 11.5px; font-weight: 600; color: ${P.slate500}; }
    .adb-sum strong { font-size: 17px; font-weight: 800; color: ${P.navy900}; line-height: 1.2; overflow-wrap: anywhere; }
    @container (max-width: 560px) {
      .adb-an-body { grid-template-columns: 1fr; }
      .adb-sum { gap: 0; border: 1px solid ${P.slate200}; border-radius: 12px; overflow: hidden; background: rgba(255,255,255,.75); }
      .adb-sum > div { flex-direction: row; justify-content: space-between; align-items: center; border: none; border-radius: 0;
        border-bottom: 1px solid ${P.slate200}; background: transparent; padding: 9px 12px; }
      .adb-sum > div:last-child { border-bottom: none; }
      .adb-sum strong { font-size: 15px; }
    }
    .adb-sum strong.is-up { color: #15803D; } .adb-sum strong.is-down { color: #B91C1C; }
    .adb-chart { min-width: 0; }
    .adb-chart svg { display: block; max-width: 100%; }
    .adb-axis { font: 500 11px Inter, sans-serif; fill: ${P.slate500}; }
    .adb-pt circle { transition: r .12s; } .adb-pt:hover circle { r: 6; }
    .adb-chart-empty { position: absolute; inset: 0 0 28px 34px; display: grid; place-items: center; font-size: 13px; color: ${P.slate500}; }

    .adb-donut-wrap { position: relative; width: 170px; margin: 2px auto 10px; }
    .adb-donut { width: 170px; height: 170px; display: block; }
    .adb-donut circle { transition: stroke-dasharray .6s ease; }
    .adb-donut-center { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
    .adb-donut-center strong { font-size: 30px; font-weight: 800; color: ${P.navy900}; line-height: 1; }
    .adb-donut-center span { font-size: 11.5px; color: ${P.slate500}; margin-top: 5px; max-width: 90px; }
    .adb-health-legend { list-style: none; margin: 0 0 12px; padding: 0; display: grid; gap: 7px; }
    .adb-health-legend li { display: grid; grid-template-columns: 12px 1fr auto 44px; align-items: center; gap: 9px; font-size: 13.5px; color: ${P.slate600}; }
    .adb-health-legend i { width: 10px; height: 10px; border-radius: 50%; }
    .adb-health-legend b { color: ${P.navy900}; font-variant-numeric: tabular-nums; }
    .adb-health-legend em { font-style: normal; text-align: right; font-weight: 700; color: ${P.navy900}; }
    .adb-note { display: flex; gap: 10px; align-items: flex-start; padding: 11px 12px; border-radius: 12px; font-size: 12.5px; }
    .adb-note strong { display: block; font-size: 13px; margin-bottom: 2px; }
    .adb-note span { color: ${P.slate500}; }
    .adb-note.is-warn { background: #FEF2F2; border: 1px solid #FBD5D5; color: #B91C1C; }
    .adb-note.is-ok { background: #ECFDF3; border: 1px solid #C6F0D6; color: #15803D; }
    .adb-note svg { flex: 0 0 auto; margin-top: 1px; }

    .adb-feed { list-style: none; margin: 0; padding: 0; display: grid; }
    .adb-feed li { display: grid; grid-template-columns: 36px minmax(0, 1fr) auto; gap: 11px; align-items: center; padding: 9px 0; border-bottom: 1px solid ${P.slate200}; }
    .adb-feed li:last-child { border-bottom: none; }
    .adb-feed-icon { width: 36px; height: 36px; border-radius: 11px; display: inline-flex; align-items: center; justify-content: center; }
    .adb-feed strong { display: block; font-size: 13.5px; color: ${P.navy900}; }
    .adb-feed div span { display: block; font-size: 12.5px; color: ${P.slate500}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .adb-feed time { font-size: 11.5px; color: ${P.slate500}; white-space: nowrap; align-self: start; padding-top: 2px; }

    .adb-bars { display: grid; align-items: end; gap: 12px; height: 170px; padding: 4px 6px 0; border-bottom: 1px solid ${P.slate200}; }
    .adb-bar-col { min-width: 0; height: 100%; display: flex; flex-direction: column; align-items: center; gap: 6px; }
    .adb-bar-val { font-size: 14px; font-weight: 800; color: ${P.navy900}; }
    .adb-bar-track { flex: 1; width: 100%; max-width: 54px; display: flex; align-items: flex-end; }
    .adb-bar { width: 100%; min-height: 4px; border-radius: 10px 10px 4px 4px; transition: height .6s ease; box-shadow: 0 8px 16px -10px rgba(3,22,54,.6); }
    .adb-bar-labels { display: grid; gap: 12px; padding: 7px 6px 0; }
    .adb-bar-labels span { min-width: 0; font-size: 11.5px; font-weight: 600; color: ${P.slate600}; text-align: center; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .adb-sport-split { list-style: none; margin: 14px 0 0; padding: 0; display: grid; gap: 6px; }
    .adb-sport-split li { display: grid; grid-template-columns: 10px 1fr auto; align-items: center; gap: 8px; font-size: 12.5px; font-weight: 600; color: ${P.navy900}; }
    .adb-sport-split i { width: 10px; height: 10px; border-radius: 3px; }
    .adb-sport-split span { font-weight: 500; color: ${P.slate500}; }

    .adb-table-wrap { overflow-x: auto; margin: 0 -4px; padding-right: 4px; }
    .adb-nowrap { white-space: nowrap; }
    .adb-table { width: 100%; min-width: 460px; border-collapse: collapse; font-size: 13.5px; }
    .adb-table th { text-align: left; font-size: 11.5px; font-weight: 700; letter-spacing: .4px; text-transform: uppercase; color: ${P.slate500};
      padding: 9px 8px; background: rgba(255,255,255,.7); border-bottom: 1px solid ${P.slate200}; white-space: nowrap; }
    .adb-table td { padding: 10px 8px; border-bottom: 1px solid ${P.slate200}; color: ${P.slate600}; vertical-align: middle; }
    .adb-table tr:last-child td { border-bottom: none; }
    .adb-strong { color: ${P.navy900} !important; font-weight: 600; }
    .adb-type { display: inline-block; font: 700 11.5px Inter, sans-serif; padding: 4px 9px; border-radius: 999px; }
    .adb-status { display: inline-block; font: 600 12px Inter, sans-serif; color: ${P.slate600}; background: ${P.slate100}; padding: 4px 9px; border-radius: 999px; white-space: nowrap; }
    .adb-status.is-fwd { color: #9A3412; background: #FFEDD5; }
    .adb-status.is-acc { color: #0F766E; background: #CCFBF1; }
    .adb-split { margin-top: 14px; padding-top: 14px; border-top: 1px solid ${P.slate200}; }
    .adb-split-bar { display: flex; gap: 3px; height: 10px; border-radius: 999px; overflow: hidden; background: ${P.slate200}; }
    .adb-split-bar span { min-width: 6px; }
    .adb-split ul { list-style: none; margin: 10px 0 0; padding: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px 14px; }
    .adb-split li { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: ${P.slate600}; }
    .adb-split li i { width: 9px; height: 9px; border-radius: 3px; flex: 0 0 auto; }
    .adb-split li b { margin-left: auto; color: ${P.navy900}; }

    .adb-events { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
    .adb-events li { display: grid; grid-template-columns: 54px minmax(0, 1fr); gap: 12px; align-items: stretch; padding: 10px; border-radius: 14px; background: rgba(255,255,255,.75); border: 1px solid ${P.slate200}; }
    .adb-date { display: flex; flex-direction: column; align-items: center; justify-content: center; border-radius: 11px; border: 1px solid; padding: 6px 0; }
    .adb-date strong { font-size: 19px; font-weight: 800; line-height: 1; }
    .adb-date span { font-size: 11.5px; font-weight: 700; text-transform: uppercase; margin-top: 3px; }
    .adb-event-body { border-left: 3px solid; padding-left: 11px; min-width: 0; display: flex; flex-direction: column; justify-content: center; }
    .adb-event-body strong { font-size: 13.5px; color: ${P.navy900}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .adb-event-body span { font-size: 12px; color: ${P.slate500}; margin-top: 2px; }
    .adb-event-body em { font-style: normal; font-size: 11px; font-weight: 700; color: ${P.slate600}; margin-top: 4px; }

    .adb-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; min-height: 160px; text-align: center; color: ${P.slate500}; font-size: 13.5px; }
    .adb-empty svg { width: 28px; height: 28px; color: ${P.slate400}; }
    .adb-empty.is-good svg { color: ${C.green}; }

    .adb-ops { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; }
    .adb-op { display: flex; align-items: center; gap: 10px; padding: 12px 14px; border-radius: 14px; background: rgba(255,255,255,0.07); border: 1px solid rgba(255,255,255,0.14); }
    .adb-op-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--c); box-shadow: 0 0 0 4px color-mix(in srgb, var(--c) 25%, transparent); flex: 0 0 auto; }
    .adb-op strong { font-size: 20px; font-weight: 800; color: #fff; font-variant-numeric: tabular-nums; }
    .adb-op span { font-size: 12.5px; color: ${P.slate300}; line-height: 1.25; }

    .adb-skel { animation: adbPulse 1.4s ease-in-out infinite; }
    @keyframes adbPulse { 50% { opacity: .55; } }
    .adb-spin { animation: adbSpin .8s linear infinite; transform-origin: center; }
    @keyframes adbSpin { to { transform: rotate(360deg); } }
    .adb-seg button:focus-visible, .adb-refresh:focus-visible, .adb-tabs button:focus-visible { outline: 2px solid ${C.blue}; outline-offset: 2px; }

    @media (max-width: 1320px) {
      .adb-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .adb-row-2 { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
      .adb-row-2 .adb-analytics { grid-column: 1 / -1; }
      .adb-row-3 { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
      .adb-row-3 .adb-pending { grid-column: 1 / -1; order: -1; }
    }
    @media (max-width: 760px) {
      .adb-wrap { padding: 12px 12px 32px; }
      .adb-glass { padding: 18px 12px 22px; border-radius: 18px; }
      .adb-topbar { padding: 12px 16px; }
      .adb-hero h1 { font-size: 24px; }
      .adb-kpis, .adb-row-2, .adb-row-3 { grid-template-columns: 1fr; }
      .adb-legend .adb-muted { margin-left: 0; }
    }
    @media (prefers-reduced-motion: reduce) { .adb-page * { animation: none !important; transition: none !important; } }
  `, []);
  return <style>{css}</style>;
}

/* ═══════════════════════ icons (stroke = currentColor) ═══════════════════════ */
const sv = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
function GridIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" {...sv} strokeWidth={2.2} aria-hidden><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.5" /></svg>; }
function RefreshIcon({ spinning }: { spinning: boolean }) { return <svg width="18" height="18" viewBox="0 0 24 24" {...sv} strokeWidth={2} aria-hidden className={spinning ? 'adb-spin' : ''}><path d="M20 11a8 8 0 0 0-14.6-4.5L4 8" /><path d="M4 3.5V8h4.5" /><path d="M4 13a8 8 0 0 0 14.6 4.5L20 16" /><path d="M20 20.5V16h-4.5" /></svg>; }
function ClipboardIcon() { return <svg width="22" height="22" viewBox="0 0 24 24" {...sv} aria-hidden><rect x="5" y="4.5" width="14" height="16.5" rx="2.5" /><path d="M9 4.5V3.8A1.3 1.3 0 0 1 10.3 2.5h3.4A1.3 1.3 0 0 1 15 3.8v.7" /><path d="M8.5 11h7M8.5 15h4.5" /></svg>; }
function BuildingIcon() { return <svg width="22" height="22" viewBox="0 0 24 24" {...sv} aria-hidden><path d="M3.5 9.5 12 4l8.5 5.5" /><path d="M5.5 10v9M10 10v9M14 10v9M18.5 10v9" /><path d="M3.5 20.5h17" /></svg>; }
function CubeIcon() { return <svg width="22" height="22" viewBox="0 0 24 24" {...sv} aria-hidden><path d="m12 2.8 8 4.5v9.4l-8 4.5-8-4.5V7.3l8-4.5z" /><path d="m4 7.3 8 4.5 8-4.5M12 11.8v9.4" /></svg>; }
function HourglassIcon() { return <svg width="22" height="22" viewBox="0 0 24 24" {...sv} aria-hidden><path d="M6.5 3h11M6.5 21h11" /><path d="M7.5 3v3.2a4.5 4.5 0 0 0 2 3.7L12 12l2.5-2.1a4.5 4.5 0 0 0 2-3.7V3" /><path d="M7.5 21v-3.2a4.5 4.5 0 0 1 2-3.7L12 12l2.5 2.1a4.5 4.5 0 0 1 2 3.7V21" /></svg>; }
function ChartIcon() { return <svg width="18" height="18" viewBox="0 0 24 24" {...sv} strokeWidth={2} aria-hidden><path d="M4 20V10M10 20V4M16 20v-7M21 20H3" /></svg>; }
function HeartIcon() { return <svg width="18" height="18" viewBox="0 0 24 24" {...sv} strokeWidth={2} aria-hidden><path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.3 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z" /><path d="M6.5 12.5h3l1.3-2.3 2 4.3 1.4-2h3.3" /></svg>; }
function ClockIcon() { return <svg width="18" height="18" viewBox="0 0 24 24" {...sv} strokeWidth={2} aria-hidden><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></svg>; }
function TrophyIcon() { return <svg width="18" height="18" viewBox="0 0 24 24" {...sv} strokeWidth={2} aria-hidden><path d="M7.5 4h9v5a4.5 4.5 0 0 1-9 0V4z" /><path d="M7.5 6H4.5a3 3 0 0 0 3 4M16.5 6h3a3 3 0 0 1-3 4M12 13.5V17M8.5 20.5h7M9.5 17h5v3.5h-5z" /></svg>; }
function CalendarIcon() { return <svg width="18" height="18" viewBox="0 0 24 24" {...sv} strokeWidth={2} aria-hidden><rect x="3.5" y="5" width="17" height="15.5" rx="2.5" /><path d="M3.5 10h17M8 3v4M16 3v4" /></svg>; }
function AlertIcon() { return <svg width="17" height="17" viewBox="0 0 24 24" {...sv} strokeWidth={2} aria-hidden><path d="M12 3.5 21.5 20h-19L12 3.5z" /><path d="M12 10v4.5M12 17.4v.1" /></svg>; }
function CheckIcon() { return <svg width="17" height="17" viewBox="0 0 24 24" {...sv} strokeWidth={2.4} aria-hidden><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>; }
function CrossIcon() { return <svg width="17" height="17" viewBox="0 0 24 24" {...sv} strokeWidth={2.4} aria-hidden><path d="M6.5 6.5l11 11M17.5 6.5l-11 11" /></svg>; }
function ForwardIcon() { return <svg width="17" height="17" viewBox="0 0 24 24" {...sv} strokeWidth={2} aria-hidden><path d="M4 12h15M13 6l6 6-6 6" /></svg>; }
function ReturnIcon() { return <svg width="17" height="17" viewBox="0 0 24 24" {...sv} strokeWidth={2} aria-hidden><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></svg>; }
function InfoIcon() { return <svg width="17" height="17" viewBox="0 0 24 24" {...sv} strokeWidth={2} aria-hidden><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5M12 7.8v.1" /></svg>; }
function ArrowUp() { return <svg width="12" height="12" viewBox="0 0 24 24" {...sv} strokeWidth={2.6} aria-hidden><path d="M12 19V5M6 11l6-6 6 6" /></svg>; }
function ArrowDown() { return <svg width="12" height="12" viewBox="0 0 24 24" {...sv} strokeWidth={2.6} aria-hidden><path d="M12 5v14M6 13l6 6 6-6" /></svg>; }
