/**
 * Coordinator Dashboard — equipment health scans and inventory levels.
 *
 * Different from the Admin Dashboard on purpose: no request/booking/activity
 * panels. Everything here is about the equipment the Coordinator looks after:
 *   • KPIs: items, low-stock types (+ units needed), average health score, scans this week
 *   • Stock levels per equipment type vs. its minimum (Low / High)
 *   • Scan status (up to date / due / never scanned)
 *   • Condition by equipment type (Good / Worn / Damaged)
 *   • Health score distribution of each item's latest scan
 *   • Scans recorded over the last 14 days (manual vs photo check)
 *   • Items that need attention + this week's health-check progress
 * Two CSV downloads (open in Excel): Inventory stock, Health scan data.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth.js';
import { ApiRequestError } from '../../lib/api.js';
import {
  getCoordinatorDashboard, exportInventoryCsv, exportHealthScanCsv, saveCsv,
  type CoordinatorDashboard, type StockRow, type ScanStatus, type Condition,
} from './api.js';

/* ---------- theme (same navy values as the other pages) ---------- */
const P = {
  navy900: '#0F172B', navy800: '#132357', accent: '#1C398E', accentMid: '#2F55C4',
  slate600: '#45556C', slate500: '#62748E', slate400: '#90A1B9', slate300: '#CAD5E2', slate200: '#E2E8F0',
  slate100: '#EEF2F8', white: '#FFFFFF',
};
/** Status colours carry state and always come with a text label. */
const S = { good: '#16A34A', warn: '#F59E0B', bad: '#DC2626' };
/** Series colours (validated pair): manual scans vs photo checks. */
const SERIES = { manual: '#2F6BFF', photo: '#0D9488' };
const SEQ = '#2F6BFF';

const COND: Record<Condition, { label: string; color: string }> = {
  GOOD: { label: 'Good', color: S.good }, WORN: { label: 'Worn', color: S.warn }, DAMAGED: { label: 'Damaged', color: S.bad },
};
const SCAN: Record<ScanStatus, { label: string; color: string }> = {
  UP_TO_DATE: { label: 'Up to date', color: S.good }, DUE: { label: 'Due', color: S.warn }, NEVER: { label: 'Never scanned', color: S.bad },
};

function errMsg(e: unknown) { return e instanceof ApiRequestError ? e.body.error : 'Something went wrong.'; }
const fmtDay = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const fmtShortDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const fmtStamp = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

/* ---------- hover tooltip (one per page) ---------- */
type Tip = { x: number; y: number; title: string; lines: Array<[string, string]> } | null;
function useTip() {
  const [tip, setTip] = useState<Tip>(null);
  const bind = (title: string, lines: Array<[string, string]>) => ({
    onMouseMove: (e: React.MouseEvent) => setTip({ x: e.clientX, y: e.clientY, title, lines }),
    onMouseLeave: () => setTip(null),
    onFocus: (e: React.FocusEvent) => { const r = (e.target as Element).getBoundingClientRect(); setTip({ x: r.left + r.width / 2, y: r.top, title, lines }); },
    onBlur: () => setTip(null),
    tabIndex: 0,
    'aria-label': `${title}: ${lines.map(([k, v]) => `${k} ${v}`).join(', ')}`,
  });
  const el = tip ? (
    <div className="cdb-tip" style={{ left: tip.x, top: tip.y }} role="tooltip">
      <strong>{tip.title}</strong>
      {tip.lines.map(([k, v]) => <div key={k}><span>{k}</span><b>{v}</b></div>)}
    </div>
  ) : null;
  return { bind, el };
}

export default function CoordinatorDashboardScreen() {
  const { user, loading: authLoading } = useAuth();
  const [data, setData] = useState<CoordinatorDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [downloading, setDownloading] = useState<'inv' | 'scan' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const tip = useTip();

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setRefreshing(true);
    try { setData(await getCoordinatorDashboard()); setError(null); }
    catch (e) { if (!quiet) setError(errMsg(e)); }
    finally { if (!quiet) setRefreshing(false); }
  }, []);
  useEffect(() => {
    if (user?.role !== 'COORDINATOR') return;
    void load();
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') void load(true); }, 60_000);
    return () => window.clearInterval(t);
  }, [load, user?.role]);

  async function download(kind: 'inv' | 'scan') {
    setDownloading(kind); setNotice(null);
    try {
      const f = kind === 'inv' ? await exportInventoryCsv() : await exportHealthScanCsv();
      saveCsv(f);
      setNotice(`Downloaded ${f.filename} (${f.rows} row${f.rows === 1 ? '' : 's'}).`);
    } catch (e) { setError(errMsg(e)); }
    finally { setDownloading(null); }
  }

  if (authLoading) return <div className="cdb-page"><Styles /></div>;
  if (!user) return <Navigate to="/" replace />;
  if (user.role !== 'COORDINATOR') return <Navigate to="/home" replace />;

  return (
    <div className="cdb-page">
      <Styles />
      <main className="cdb-wrap">
        <div className="cdb-glass">
          <div className="cdb-hero">
            <div>
              <span className="cdb-eyebrow"><GridIcon /> Coordinator Dashboard</span>
              <h1>Equipment Health &amp; Inventory</h1>
              <p>Stock levels, condition and health-check scans for the equipment you look after.</p>
            </div>
            <div className="cdb-controls">
              <button className="cdb-dl" onClick={() => download('inv')} disabled={downloading !== null}>
                <DownloadIcon /> {downloading === 'inv' ? 'Preparing…' : 'Inventory CSV'}
              </button>
              <button className="cdb-dl" onClick={() => download('scan')} disabled={downloading !== null}>
                <DownloadIcon /> {downloading === 'scan' ? 'Preparing…' : 'Health Scan CSV'}
              </button>
              <button className="cdb-refresh" onClick={() => load()} disabled={refreshing} aria-label="Refresh" title="Refresh">
                <RefreshIcon spinning={refreshing} />
              </button>
            </div>
          </div>
          {data && <div className="cdb-updated">Updated {fmtStamp(data.generatedAt)}</div>}

          {error && <div className="cdb-alert is-err">{error}</div>}
          {notice && <div className="cdb-alert is-ok">{notice}</div>}

          {!data ? (
            <div className="cdb-skel">{[0, 1, 2, 3].map((i) => <div key={i} className="cdb-card cdb-skel-card" />)}</div>
          ) : (
            <>
              <Kpis d={data} />
              <div className="cdb-row cdb-row-a">
                <StockCard rows={data.stock} bind={tip.bind} />
                <ScanStatusCard d={data} bind={tip.bind} />
              </div>
              <div className="cdb-row cdb-row-b">
                <ConditionCard rows={data.stock} bind={tip.bind} />
                <ScoreCard d={data} bind={tip.bind} />
                <ScansPerDayCard d={data} bind={tip.bind} />
              </div>
              <div className="cdb-row cdb-row-c">
                <AttentionCard d={data} />
                <WeeklyCard d={data} />
              </div>
            </>
          )}
        </div>
      </main>
      {tip.el}
    </div>
  );
}

type Bind = ReturnType<typeof useTip>['bind'];

/* ═══════════════════════ KPIs ═══════════════════════ */
function Kpis({ d }: { d: CoordinatorDashboard }) {
  const k = d.kpis;
  const coverage = k.totalArticles ? Math.round((k.scannedThisWeek / k.totalArticles) * 100) : 0;
  return (
    <section className="cdb-kpis" aria-label="Key figures">
      <Kpi icon={<BoxIcon />} color={P.accentMid} value={k.totalArticles} label="Equipment items"
        foot={`${k.equipmentTypes} equipment type${k.equipmentTypes === 1 ? '' : 's'}`} />
      <Kpi icon={<StackIcon />} color={k.lowStockTypes ? S.bad : S.good} value={k.lowStockTypes} label="Types low on stock"
        foot={k.lowStockTypes ? `${k.unitsNeeded} unit${k.unitsNeeded === 1 ? '' : 's'} needed to reach minimum` : 'All types at or above minimum'}
        tone={k.lowStockTypes ? 'bad' : 'good'} />
      <Kpi icon={<HeartIcon />} color={SEQ} value={k.averageScore === null ? '—' : `${k.averageScore}%`} label="Average health score"
        foot={`${k.needsAttention} item${k.needsAttention === 1 ? '' : 's'} worn or damaged`} tone={k.needsAttention ? 'warn' : 'good'} />
      <Kpi icon={<ScanIcon />} color={coverage >= 80 ? S.good : S.warn} value={`${coverage}%`} label={`Scanned in last ${d.scanFreshDays} days`}
        foot={`${k.scannedThisWeek} of ${k.totalArticles} items`} tone={coverage >= 80 ? 'good' : 'warn'} />
    </section>
  );
}
function Kpi({ icon, color, value, label, foot, tone }: { icon: ReactNode; color: string; value: ReactNode; label: string; foot: string; tone?: 'good' | 'warn' | 'bad' }) {
  return (
    <div className="cdb-card cdb-kpi" style={{ ['--c' as string]: color }}>
      <span className="cdb-kpi-icon">{icon}</span>
      <div className="cdb-kpi-value">{value}</div>
      <div className="cdb-kpi-label">{label}</div>
      <div className={`cdb-kpi-foot ${tone ? `is-${tone}` : ''}`}>{foot}</div>
    </div>
  );
}

function CardHead({ icon, title, right }: { icon: ReactNode; title: string; right?: ReactNode }) {
  return (
    <div className="cdb-card-head">
      <span className="cdb-head-icon">{icon}</span>
      <h2>{title}</h2>
      {right && <div className="cdb-head-right">{right}</div>}
    </div>
  );
}
function Legend({ items }: { items: Array<{ label: string; color: string; value?: ReactNode }> }) {
  return (
    <ul className="cdb-legend">
      {items.map((i) => <li key={i.label}><i style={{ background: i.color }} />{i.label}{i.value !== undefined && <b>{i.value}</b>}</li>)}
    </ul>
  );
}

/* ═══════════════════════ Stock levels ═══════════════════════ */
function StockCard({ rows, bind }: { rows: StockRow[]; bind: Bind }) {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const [onlyLow, setOnlyLow] = useState(false);
  const shown = useMemo(() => {
    const r = onlyLow ? rows.filter((x) => x.level === 'LOW') : rows;
    // Low first, then by how far below minimum.
    return [...r].sort((a, b) => (a.level === b.level ? b.needed - a.needed || a.name.localeCompare(b.name) : a.level === 'LOW' ? -1 : 1));
  }, [rows, onlyLow]);
  const max = Math.max(1, ...rows.map((r) => Math.max(r.stockUnits, r.minimumStock)));
  return (
    <section className="cdb-card cdb-stock">
      <CardHead icon={<StackIcon />} title="Stock levels vs. minimum"
        right={
          <div className="cdb-seg" role="group" aria-label="Stock view">
            <button className={onlyLow ? 'is-on' : ''} onClick={() => setOnlyLow((v) => !v)} aria-pressed={onlyLow}>Low only</button>
            <button className={view === 'chart' ? 'is-on' : ''} onClick={() => setView('chart')}>Chart</button>
            <button className={view === 'table' ? 'is-on' : ''} onClick={() => setView('table')}>Table</button>
          </div>
        } />
      <Legend items={[{ label: 'High (at or above minimum)', color: S.good }, { label: 'Low (below minimum)', color: S.bad }, { label: 'Minimum stock', color: P.navy900 }]} />
      {shown.length === 0 ? (
        <p className="cdb-empty">{onlyLow ? 'No equipment type is below its minimum stock.' : 'No equipment types yet.'}</p>
      ) : view === 'chart' ? (
        <div className="cdb-hbars cdb-scroll cdb-scroll-stock">
          {shown.map((r) => {
            const w = (r.stockUnits / max) * 100;
            const m = (r.minimumStock / max) * 100;
            const low = r.level === 'LOW';
            return (
              <div key={r.equipmentTypeId} className="cdb-hbar-row"
                {...bind(r.name, [['Sport', r.sport], ['Stock', `${r.stockUnits} ${r.lendingUnit === 'PAIR' ? 'pairs' : 'units'}`], ['Minimum', String(r.minimumStock)],
                  ['Available now', String(r.availableUnits)], ['On loan', String(r.onLoanUnits)], ['Damaged articles', String(r.damagedArticles)],
                  ['Level', low ? `Low — need ${r.needed} more` : 'High']])}>
                <div className="cdb-hbar-name"><strong>{r.name}</strong><span>{r.sport}</span></div>
                <div className="cdb-hbar-track">
                  <div className="cdb-hbar" style={{ width: `${Math.max(w, r.stockUnits ? 1.5 : 0)}%`, background: low ? S.bad : S.good }} />
                  <div className="cdb-hbar-min" style={{ left: `${m}%` }} aria-hidden />
                </div>
                <div className="cdb-hbar-val">
                  <b>{r.stockUnits}</b><span>/ {r.minimumStock}</span>
                  <em className={low ? 'is-bad' : 'is-good'}>{low ? `Low · +${r.needed}` : 'High'}</em>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="cdb-table-wrap cdb-scroll cdb-scroll-stock">
          <table className="cdb-table cdb-sticky">
            <thead><tr><th>Equipment</th><th>Sport</th><th className="num">Stock</th><th className="num">Minimum</th><th className="num">Available</th><th className="num">On loan</th><th>Level</th><th className="num">Needed</th></tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.equipmentTypeId}>
                  <td><strong>{r.name}</strong>{r.lendingUnit === 'PAIR' && <span className="cdb-sub"> (pairs)</span>}</td>
                  <td>{r.sport}</td><td className="num">{r.stockUnits}</td><td className="num">{r.minimumStock}</td>
                  <td className="num">{r.availableUnits}</td><td className="num">{r.onLoanUnits}</td>
                  <td><span className={`cdb-pill ${r.level === 'LOW' ? 'is-bad' : 'is-good'}`}>{r.level === 'LOW' ? 'Low' : 'High'}</span></td>
                  <td className="num">{r.needed || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="cdb-foot">
        {shown.length > 7 && <>{shown.length} types — scroll the list to see all, lowest first. </>}
        Stock counts items that aren't damaged or decommissioned (items on loan count). Pair items count two articles as one unit.
      </p>
    </section>
  );
}

/* ═══════════════════════ Scan status donut ═══════════════════════ */
function ScanStatusCard({ d, bind }: { d: CoordinatorDashboard; bind: Bind }) {
  const parts: Array<{ key: ScanStatus; n: number }> = [
    { key: 'UP_TO_DATE', n: d.scanStatus.upToDate }, { key: 'DUE', n: d.scanStatus.due }, { key: 'NEVER', n: d.scanStatus.never },
  ];
  const total = parts.reduce((a, p) => a + p.n, 0);
  const R = 62; const CIRC = 2 * Math.PI * R;
  let offset = 0;
  const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0);
  return (
    <section className="cdb-card">
      <CardHead icon={<ScanIcon />} title="Scan status" />
      <div className="cdb-body">
      <div className="cdb-donut-wrap">
        <svg viewBox="0 0 160 160" className="cdb-donut" role="img" aria-label={parts.map((p) => `${SCAN[p.key].label} ${p.n}`).join(', ')}>
          <circle cx="80" cy="80" r={R} fill="none" stroke={P.slate200} strokeWidth="18" />
          {total > 0 && parts.map((p) => {
            const len = (p.n / total) * CIRC;
            const el = p.n > 0 ? (
              <circle key={p.key} cx="80" cy="80" r={R} fill="none" stroke={SCAN[p.key].color} strokeWidth="18"
                strokeDasharray={`${Math.max(len - 2, 0.01)} ${CIRC}`} strokeDashoffset={-offset} transform="rotate(-90 80 80)"
                {...bind(SCAN[p.key].label, [['Items', String(p.n)], ['Share', `${pct(p.n)}%`]])} />
            ) : null;
            offset += len;
            return el;
          })}
        </svg>
        <div className="cdb-donut-center"><strong>{pct(d.scanStatus.upToDate)}%</strong><span>scanned in last {d.scanFreshDays} days</span></div>
      </div>
      <ul className="cdb-statlist">
        {parts.map((p) => (
          <li key={p.key}><i style={{ background: SCAN[p.key].color }} />{SCAN[p.key].label}<b>{p.n}</b><em>{pct(p.n)}%</em></li>
        ))}
      </ul>
      </div>
      <p className="cdb-foot">Up to date = scanned in the last {d.scanFreshDays} days. Due = last scan is older.</p>
    </section>
  );
}

/* ═══════════════════════ Condition by equipment ═══════════════════════ */
function ConditionCard({ rows, bind }: { rows: StockRow[]; bind: Bind }) {
  const list = rows.filter((r) => r.good + r.worn + r.damaged > 0)
    .sort((a, b) => (b.damaged + b.worn) / (b.good + b.worn + b.damaged) - (a.damaged + a.worn) / (a.good + a.worn + a.damaged));
  return (
    <section className="cdb-card">
      <CardHead icon={<HeartIcon />} title="Condition by equipment" />
      <Legend items={(['GOOD', 'WORN', 'DAMAGED'] as Condition[]).map((c) => ({ label: COND[c].label, color: COND[c].color }))} />
      {list.length === 0 ? <p className="cdb-empty">No items yet.</p> : (
        <div className="cdb-stacks cdb-scroll cdb-scroll-cond">
          {list.map((r) => {
            const total = r.good + r.worn + r.damaged;
            const segs: Array<[Condition, number]> = [['GOOD', r.good], ['WORN', r.worn], ['DAMAGED', r.damaged]];
            return (
              <div key={r.equipmentTypeId} className="cdb-stack-row"
                {...bind(r.name, [...segs.map(([c, n]) => [COND[c].label, `${n} (${Math.round((n / total) * 100)}%)`] as [string, string]), ['Items', String(total)]])}>
                <span className="cdb-stack-name" title={r.name}>{r.name}</span>
                <div className="cdb-stack">
                  {segs.filter(([, n]) => n > 0).map(([c, n]) => (
                    <div key={c} style={{ flexGrow: n, background: COND[c].color }} />
                  ))}
                </div>
                <span className="cdb-stack-val">{r.worn + r.damaged > 0 ? `${r.worn + r.damaged} need care` : 'All good'}</span>
              </div>
            );
          })}
        </div>
      )}
      {list.length > 7 && <p className="cdb-foot">{list.length} types — scroll to see all. Most worn/damaged first.</p>}
    </section>
  );
}

/* ═══════════════════════ Health score distribution ═══════════════════════ */
function ScoreCard({ d, bind }: { d: CoordinatorDashboard; bind: Bind }) {
  const max = Math.max(1, ...d.scoreBuckets.map((b) => b.count));
  const scored = d.scoreBuckets.reduce((a, b) => a + b.count, 0);
  return (
    <section className="cdb-card">
      <CardHead icon={<ChartIcon />} title="Latest health scores" right={<span className="cdb-muted">{scored} scanned item{scored === 1 ? '' : 's'}</span>} />
      {scored === 0 ? <p className="cdb-empty">No scans recorded yet.</p> : (
        <>
          <div className="cdb-cols cdb-grow" style={{ gridTemplateColumns: `repeat(${d.scoreBuckets.length}, 1fr)` }}>
            {d.scoreBuckets.map((b, i) => (
              <div key={b.label} className="cdb-col" {...bind(`Score ${b.label}%`, [['Items', String(b.count)]])}>
                <div className="cdb-col-track">
                  <span className="cdb-col-val">{b.count}</span>
                  <div className="cdb-col-bar" style={{ height: `${(b.count / max) * 100}%`, background: SEQ, opacity: 0.45 + i * 0.137 }} />
                </div>
              </div>
            ))}
          </div>
          <div className="cdb-col-labels" style={{ gridTemplateColumns: `repeat(${d.scoreBuckets.length}, 1fr)` }}>
            {d.scoreBuckets.map((b) => <span key={b.label}>{b.label}</span>)}
          </div>
          <p className="cdb-foot">Each item's most recent scan score (%). Below 40 is Damaged, 40–69 Worn, 70+ Good by default.</p>
        </>
      )}
    </section>
  );
}

/* ═══════════════════════ Scans per day ═══════════════════════ */
function ScansPerDayCard({ d, bind }: { d: CoordinatorDashboard; bind: Bind }) {
  const max = Math.max(1, ...d.scansPerDay.map((x) => x.manual + x.photo));
  const total = d.scansPerDay.reduce((a, x) => a + x.manual + x.photo, 0);
  return (
    <section className="cdb-card">
      <CardHead icon={<CalendarIcon />} title="Scans · last 14 days" right={<span className="cdb-muted">{total} total</span>} />
      <Legend items={[{ label: 'Manual scan', color: SERIES.manual }, { label: 'Photo Scan', color: SERIES.photo }]} />
      <div className="cdb-cols cdb-cols-days cdb-grow" style={{ gridTemplateColumns: `repeat(${d.scansPerDay.length}, 1fr)` }}>
        {d.scansPerDay.map((x) => {
          const n = x.manual + x.photo;
          return (
            <div key={x.day} className="cdb-col" {...bind(fmtDay(x.day), [['Manual scans', String(x.manual)], ['Photo Scans', String(x.photo)], ['Total', String(n)]])}>
              <div className="cdb-col-track">
                <div className="cdb-col-stack" style={{ height: `${(n / max) * 100}%` }}>
                  {x.photo > 0 && <div style={{ flexGrow: x.photo, background: SERIES.photo }} />}
                  {x.manual > 0 && <div style={{ flexGrow: x.manual, background: SERIES.manual }} />}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="cdb-col-labels cdb-col-labels-days" style={{ gridTemplateColumns: `repeat(${d.scansPerDay.length}, 1fr)` }}>
        {d.scansPerDay.map((x, i) => <span key={x.day}>{i % 3 === 0 || i === d.scansPerDay.length - 1 ? fmtDay(x.day) : ''}</span>)}
      </div>
    </section>
  );
}

/* ═══════════════════════ Needs attention ═══════════════════════ */
function AttentionCard({ d }: { d: CoordinatorDashboard }) {
  return (
    <section className="cdb-card">
      <CardHead icon={<AlertIcon />} title="Items that need attention" right={<span className="cdb-muted">worst first</span>} />
      {d.attention.length === 0 ? <p className="cdb-empty">Everything is in good condition and scanned this week.</p> : (
        <div className="cdb-table-wrap">
          <table className="cdb-table">
            <thead><tr><th>Equipment</th><th>Barcode</th><th>Condition</th><th className="num">Last score</th><th>Last scan</th><th>Scan status</th></tr></thead>
            <tbody>
              {d.attention.map((a) => (
                <tr key={a.articleId}>
                  <td><strong>{a.equipmentName}</strong>{a.openFlag && <span className="cdb-pill is-bad cdb-flag">Damage flag</span>}</td>
                  <td className="mono">{a.barcode}</td>
                  <td><span className={`cdb-pill is-${a.currentCondition === 'GOOD' ? 'good' : a.currentCondition === 'WORN' ? 'warn' : 'bad'}`}>{COND[a.currentCondition].label}</span></td>
                  <td className="num">{a.lastScore === null ? '—' : `${Math.round(a.lastScore)}%`}</td>
                  <td className="nowrap" title={a.lastScanAt ? fmtStamp(a.lastScanAt) : undefined}>
                    {a.lastScanAt ? `${fmtShortDate(a.lastScanAt)} · ${a.daysSinceScan ? `${a.daysSinceScan}d ago` : 'today'}` : 'Never'}
                  </td>
                  <td><span className={`cdb-pill is-${a.scanStatus === 'UP_TO_DATE' ? 'good' : a.scanStatus === 'DUE' ? 'warn' : 'bad'}`}>{SCAN[a.scanStatus].label}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="cdb-foot">Download the Health Scan CSV for every item.</p>
    </section>
  );
}

/* ═══════════════════════ Weekly health check ═══════════════════════ */
function WeeklyCard({ d }: { d: CoordinatorDashboard }) {
  const s = d.weeklySession;
  const done = s ? Math.min(s.scanned, s.totalDue) : 0;
  const pct = s && s.totalDue ? Math.round((done / s.totalDue) * 100) : 0;
  const state = !s ? 'none' : s.completedAt ? 'done' : s.overdue ? 'overdue' : 'open';
  const color = state === 'done' ? S.good : state === 'overdue' ? S.bad : S.warn;
  return (
    <section className="cdb-card">
      <CardHead icon={<ClipboardIcon />} title="Weekly health check" />
      {!s ? <p className="cdb-empty">No weekly health check has been started yet.</p> : (
        <>
          <div className="cdb-body">
          <div className="cdb-week-top">
            <strong>{done} <span>of {s.totalDue} items</span></strong>
            <span className={`cdb-pill is-${state === 'done' ? 'good' : state === 'overdue' ? 'bad' : 'warn'}`}>
              {state === 'done' ? 'Completed' : state === 'overdue' ? 'Overdue' : 'In progress'}
            </span>
          </div>
          <div className="cdb-progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Weekly scans done">
            <div style={{ width: `${pct}%`, background: color }} />
          </div>
          <dl className="cdb-week-meta">
            <div><dt>Started</dt><dd>{fmtStamp(s.alertSentAt)}</dd></div>
            <div><dt>Due within</dt><dd>48 hours of the alert</dd></div>
            {s.completedAt && <div><dt>Completed</dt><dd>{fmtStamp(s.completedAt)}</dd></div>}
          </dl>
          </div>
          <p className="cdb-foot">Counts weekly (scheduled) scans recorded since the alert. Scan items from Inventory or Equipment Health Check.</p>
        </>
      )}
    </section>
  );
}

/* ═══════════════════════ styles ═══════════════════════ */
function Styles() {
  const css = useMemo(() => `
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
    .cdb-page { position: relative; min-height: 100%; font-family: 'Inter', system-ui, sans-serif; color: ${P.navy900};
      background: radial-gradient(1100px 700px at 15% 0%, ${P.navy800}aa 0%, transparent 60%), radial-gradient(900px 600px at 100% 100%, ${P.accent}22 0%, transparent 55%), ${P.navy900}; }
    .cdb-page *, .cdb-page *::before, .cdb-page *::after { box-sizing: border-box; }
    .cdb-wrap { width: 100%; max-width: 1480px; margin: 0 auto; padding: 20px 24px 48px; }
    .cdb-glass { background: rgba(255,255,255,0.07); backdrop-filter: blur(22px) saturate(160%); -webkit-backdrop-filter: blur(22px) saturate(160%);
      border: 1px solid rgba(255,255,255,0.16); border-radius: 24px; padding: 26px 26px 30px; box-shadow: 0 24px 60px -32px rgba(3,22,54,0.75), inset 0 1px 0 rgba(255,255,255,0.10); }
    .cdb-hero { display: flex; justify-content: space-between; align-items: flex-end; gap: 18px; flex-wrap: wrap; margin-bottom: 8px; }
    .cdb-eyebrow { display: inline-flex; align-items: center; gap: 7px; font-size: 12px; font-weight: 700; letter-spacing: .5px; text-transform: uppercase;
      padding: 6px 14px; border-radius: 999px; margin-bottom: 12px; color: ${P.slate100}; background: ${P.navy800}88; border: 1px solid ${P.slate400}55; }
    .cdb-hero h1 { margin: 0 0 6px; font-size: 30px; font-weight: 800; letter-spacing: -.5px; color: #fff; }
    .cdb-hero p { margin: 0; font-size: 14.5px; color: ${P.slate300}; }
    .cdb-controls { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
    .cdb-dl { display: inline-flex; align-items: center; gap: 8px; height: 40px; padding: 0 16px; border-radius: 12px; border: none; cursor: pointer;
      background: #fff; color: ${P.accent}; font: 700 13.5px Inter, sans-serif; box-shadow: 0 8px 18px -10px rgba(0,0,0,.6); }
    .cdb-dl:hover:not(:disabled) { background: ${P.slate100}; }
    .cdb-dl:disabled { opacity: .6; cursor: progress; }
    .cdb-refresh { width: 40px; height: 40px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.2); background: rgba(255,255,255,0.08); color: ${P.slate100};
      display: inline-flex; align-items: center; justify-content: center; cursor: pointer; }
    .cdb-refresh:hover:not(:disabled) { background: rgba(255,255,255,0.16); }
    .cdb-spin { animation: cdbspin .8s linear infinite; } @keyframes cdbspin { to { transform: rotate(360deg); } }
    .cdb-updated { font-size: 12.5px; color: ${P.slate300}; margin: 0 0 16px; }
    .cdb-alert { margin-bottom: 14px; padding: 11px 14px; border-radius: 12px; font-size: 14px; }
    .cdb-alert.is-err { background: #FDECEC; color: #8F2323; border: 1px solid #F3CACA; }
    .cdb-alert.is-ok { background: #E6F4EC; color: #1F7A45; border: 1px solid #C6F0D6; }

    .cdb-card { display: flex; flex-direction: column; position: relative; min-width: 0; background: linear-gradient(145deg, #F8FAFF 0%, #EAF0FC 100%); border: 1px solid ${P.slate300}e6;
      border-radius: 18px; padding: 18px 20px 18px; box-shadow: 0 12px 30px -22px rgba(3,22,54,.85); }
    .cdb-card-head { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; flex-wrap: wrap; }
    .cdb-card-head h2 { margin: 0; font-size: 16.5px; font-weight: 700; color: ${P.navy900}; }
    .cdb-head-icon { width: 34px; height: 34px; border-radius: 10px; display: inline-flex; align-items: center; justify-content: center; color: ${P.accent}; background: #DBEAFE; }
    .cdb-head-right { margin-left: auto; }
    .cdb-muted { font-size: 12.5px; color: ${P.slate500}; }
    .cdb-foot { margin: auto 0 0; padding-top: 12px; font-size: 12px; color: ${P.slate500}; line-height: 1.5; }
    .cdb-empty { margin: 10px 0; font-size: 13.5px; color: ${P.slate500}; }
    .cdb-sub { color: ${P.slate500}; font-size: 12px; }

    .cdb-kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; margin-bottom: 16px; }
    .cdb-kpi { overflow: hidden; padding: 18px; }
    .cdb-kpi::before { content: ''; position: absolute; inset: 0 auto 0 0; width: 4px; background: var(--c); }
    .cdb-kpi-icon { width: 44px; height: 44px; border-radius: 13px; display: inline-flex; align-items: center; justify-content: center;
      color: var(--c); background: color-mix(in srgb, var(--c) 14%, white); }
    .cdb-kpi-value { margin-top: 12px; font-size: 32px; font-weight: 800; line-height: 1; color: ${P.navy900}; font-variant-numeric: tabular-nums; }
    .cdb-kpi-label { margin-top: 5px; font-size: 14px; font-weight: 600; color: ${P.slate600}; }
    .cdb-kpi-foot { margin-top: 10px; font-size: 12.5px; color: ${P.slate500}; }
    .cdb-kpi-foot.is-bad { color: #B91C1C; font-weight: 600; } .cdb-kpi-foot.is-warn { color: #92400E; font-weight: 600; } .cdb-kpi-foot.is-good { color: #15803D; font-weight: 600; }

    .cdb-row { display: grid; gap: 16px; margin-bottom: 16px; align-items: stretch; }
    /* Long lists scroll inside their card so neighbouring cards don't get stretched with empty space. */
    .cdb-scroll { overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; scrollbar-color: ${P.slate300} transparent;
      -webkit-mask-image: linear-gradient(to bottom, #000 calc(100% - 18px), transparent); mask-image: linear-gradient(to bottom, #000 calc(100% - 18px), transparent);
      padding-bottom: 10px; }
    .cdb-scroll::-webkit-scrollbar { width: 6px; } .cdb-scroll::-webkit-scrollbar-thumb { background: ${P.slate300}; border-radius: 3px; }
    .cdb-scroll-stock { max-height: 392px; }
    .cdb-body { flex: 1; display: flex; flex-direction: column; justify-content: center; }
    .cdb-cols.cdb-grow { flex: 1; height: auto; min-height: 168px; }
    .cdb-scroll-cond { max-height: 252px; }
    .cdb-sticky thead th { position: sticky; top: 0; background: #F1F5FD; z-index: 1; }
    .cdb-row-a { grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); }
    .cdb-row-b { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .cdb-row-c { grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); }

    .cdb-seg { display: inline-flex; gap: 3px; padding: 3px; border-radius: 10px; background: ${P.slate100}; border: 1px solid ${P.slate200}; }
    .cdb-seg button { border: none; background: none; color: ${P.slate500}; font: 600 12.5px Inter, sans-serif; padding: 6px 11px; border-radius: 8px; cursor: pointer; }
    .cdb-seg button.is-on { background: #fff; color: ${P.accent}; box-shadow: 0 2px 6px -3px rgba(3,22,54,.4); }
    .cdb-legend { list-style: none; display: flex; gap: 14px; flex-wrap: wrap; margin: 0 0 12px; padding: 0; font-size: 12.5px; color: ${P.slate600}; }
    .cdb-legend li { display: inline-flex; align-items: center; gap: 6px; }
    .cdb-legend i { width: 10px; height: 10px; border-radius: 3px; }
    .cdb-legend b { color: ${P.navy900}; }

    .cdb-hbars { display: grid; gap: 2px; align-content: start; }
    .cdb-hbar-row { display: grid; grid-template-columns: 160px minmax(0, 1fr) 132px; align-items: center; gap: 12px; padding: 5px 8px; border-radius: 10px; outline: none; }
    .cdb-hbar-row:hover, .cdb-hbar-row:focus-visible { background: rgba(28,57,142,.06); }
    .cdb-hbar-name strong { display: block; font-size: 13.5px; color: ${P.navy900}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .cdb-hbar-name span { display: block; font-size: 11.5px; color: ${P.slate500}; }
    .cdb-hbar-track { position: relative; height: 16px; background: ${P.slate200}; border-radius: 4px; }
    .cdb-hbar { height: 100%; border-radius: 0 4px 4px 0; transition: width .5s ease; }
    .cdb-hbar-min { position: absolute; top: -4px; bottom: -4px; width: 2px; background: ${P.navy900}; border-radius: 1px; box-shadow: 0 0 0 2px #F3F6FD; }
    .cdb-hbar-val { display: flex; align-items: baseline; gap: 4px; font-variant-numeric: tabular-nums; }
    .cdb-hbar-val b { font-size: 15px; color: ${P.navy900}; } .cdb-hbar-val span { font-size: 12px; color: ${P.slate500}; }
    .cdb-hbar-val em { margin-left: auto; font-style: normal; font-size: 11.5px; font-weight: 700; padding: 2px 8px; border-radius: 999px; white-space: nowrap; }
    .is-good { } em.is-good, .cdb-pill.is-good { color: #15803D; background: #DCFCE7; }
    em.is-bad, .cdb-pill.is-bad { color: #B91C1C; background: #FEE2E2; }
    .cdb-pill.is-warn { color: #92400E; background: #FEF3C7; }
    .cdb-pill { display: inline-block; font-size: 11.5px; font-weight: 700; padding: 2px 9px; border-radius: 999px; white-space: nowrap; }
    .cdb-flag { margin-left: 6px; }

    .cdb-donut-wrap { position: relative; width: 176px; margin: 6px auto 16px; }
    .cdb-donut { width: 176px; height: 176px; display: block; }
    .cdb-donut circle { outline: none; cursor: default; }
    .cdb-donut-center { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; pointer-events: none; }
    .cdb-donut-center strong { font-size: 30px; font-weight: 800; color: ${P.navy900}; line-height: 1; }
    .cdb-donut-center span { font-size: 11.5px; color: ${P.slate500}; margin-top: 5px; max-width: 96px; }
    .cdb-statlist { list-style: none; margin: 0; padding: 0; display: grid; gap: 7px; }
    .cdb-statlist li { display: grid; grid-template-columns: 12px 1fr auto 44px; align-items: center; gap: 9px; font-size: 13.5px; color: ${P.slate600}; }
    .cdb-statlist i { width: 10px; height: 10px; border-radius: 3px; }
    .cdb-statlist b { color: ${P.navy900}; font-variant-numeric: tabular-nums; }
    .cdb-statlist em { font-style: normal; text-align: right; font-weight: 700; color: ${P.navy900}; }

    .cdb-stacks { display: grid; gap: 2px; align-content: start; }
    .cdb-stack-row { display: grid; grid-template-columns: 128px minmax(0, 1fr) 74px; align-items: center; gap: 10px; padding: 5px 6px; border-radius: 8px; outline: none; }
    .cdb-stack-row:hover, .cdb-stack-row:focus-visible { background: rgba(28,57,142,.06); }
    .cdb-stack-name { font-size: 13px; font-weight: 600; color: ${P.navy900}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .cdb-stack { display: flex; gap: 2px; height: 14px; border-radius: 4px; overflow: hidden; background: ${P.slate200}; }
    .cdb-stack > div { min-width: 3px; }
    .cdb-stack-val { font-size: 11.5px; color: ${P.slate500}; text-align: right; white-space: nowrap; }

    .cdb-cols { display: grid; gap: 8px; height: 168px; align-items: end; border-bottom: 1px solid ${P.slate300}; padding: 0 4px; }
    .cdb-cols-days { gap: 4px; }
    .cdb-col { height: 100%; display: flex; flex-direction: column; align-items: center; gap: 4px; outline: none; border-radius: 6px 6px 0 0; }
    .cdb-col:hover, .cdb-col:focus-visible { background: rgba(28,57,142,.06); }
    .cdb-col-val { font-size: 13px; font-weight: 700; color: ${P.navy900}; }
    .cdb-col-track { flex: 1; width: 100%; max-width: 44px; display: flex; flex-direction: column; justify-content: flex-end; align-items: stretch; }
    .cdb-col-track .cdb-col-val { text-align: center; margin-bottom: 4px; }
    .cdb-col-bar { width: 100%; min-height: 0; border-radius: 4px 4px 0 0; transition: height .5s ease; }
    .cdb-col-stack { width: 100%; display: flex; flex-direction: column; gap: 2px; border-radius: 4px 4px 0 0; overflow: hidden; transition: height .5s ease; }
    .cdb-col-stack > div { min-height: 2px; }
    .cdb-col-labels { display: grid; gap: 8px; padding: 6px 4px 0; }
    .cdb-col-labels-days { gap: 4px; }
    .cdb-col-labels span { font-size: 11px; color: ${P.slate500}; text-align: center; white-space: nowrap; }

    .cdb-table-wrap { overflow-x: auto; }
    .cdb-table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .cdb-table th { text-align: left; font-size: 11px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: ${P.slate500}; padding: 8px 10px; border-bottom: 1px solid ${P.slate300}; white-space: nowrap; }
    .cdb-table td { padding: 9px 10px; border-bottom: 1px solid ${P.slate200}; color: ${P.navy900}; vertical-align: middle; }
    .cdb-table tr:last-child td { border-bottom: none; }
    .cdb-table .num { text-align: right; font-variant-numeric: tabular-nums; }
    .cdb-table .nowrap { white-space: nowrap; }
    .cdb-table .mono { font-family: ui-monospace, 'JetBrains Mono', monospace; font-size: 12.5px; }

    .cdb-week-top { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-bottom: 10px; }
    .cdb-week-top strong { font-size: 26px; font-weight: 800; color: ${P.navy900}; }
    .cdb-week-top strong span { font-size: 13px; font-weight: 600; color: ${P.slate500}; }
    .cdb-progress { height: 12px; border-radius: 999px; background: ${P.slate200}; overflow: hidden; }
    .cdb-progress > div { height: 100%; border-radius: 999px; transition: width .5s ease; }
    .cdb-week-meta { margin: 14px 0 0; display: grid; gap: 6px; }
    .cdb-week-meta div { display: flex; justify-content: space-between; gap: 10px; font-size: 13px; }
    .cdb-week-meta dt { color: ${P.slate500}; } .cdb-week-meta dd { margin: 0; font-weight: 600; color: ${P.navy900}; }

    .cdb-tip { position: fixed; z-index: 1000; transform: translate(-50%, calc(-100% - 12px)); pointer-events: none; min-width: 160px;
      background: ${P.navy900}; color: #fff; border-radius: 10px; padding: 9px 12px; font-size: 12.5px; box-shadow: 0 12px 28px -12px rgba(0,0,0,.6); }
    .cdb-tip strong { display: block; margin-bottom: 5px; font-size: 13px; }
    .cdb-tip div { display: flex; justify-content: space-between; gap: 14px; line-height: 1.6; }
    .cdb-tip span { color: ${P.slate300}; } .cdb-tip b { font-variant-numeric: tabular-nums; }

    .cdb-skel { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }
    .cdb-skel-card { height: 140px; opacity: .6; }

    @media (max-width: 1240px) {
      .cdb-row-b { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .cdb-row-b > :last-child { grid-column: 1 / -1; }
    }
    @media (max-width: 1000px) {
      .cdb-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .cdb-row-a, .cdb-row-c, .cdb-row-b { grid-template-columns: minmax(0, 1fr); }
    }
    @media (max-width: 620px) {
      .cdb-wrap { padding: 12px 10px 32px; } .cdb-glass { padding: 18px 14px 22px; border-radius: 18px; }
      .cdb-kpis { grid-template-columns: minmax(0, 1fr); }
      .cdb-hbar-row { grid-template-columns: 1fr; gap: 6px; }
      .cdb-stack-row { grid-template-columns: 90px minmax(0, 1fr); } .cdb-stack-val { display: none; }
    }
    @media (prefers-reduced-motion: reduce) { .cdb-page * { animation: none !important; transition: none !important; } }
  `, []);
  return <style>{css}</style>;
}

/* ═══════════════════════ icons ═══════════════════════ */
const ic = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true } as const;
const st = { stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
function GridIcon() { return <svg {...ic} width={14} height={14}><rect x="3.5" y="3.5" width="7" height="7" rx="1.4" {...st}/><rect x="13.5" y="3.5" width="7" height="7" rx="1.4" {...st}/><rect x="3.5" y="13.5" width="7" height="7" rx="1.4" {...st}/><rect x="13.5" y="13.5" width="7" height="7" rx="1.4" {...st}/></svg>; }
function DownloadIcon() { return <svg {...ic} width={17} height={17}><path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19.5h14" {...st}/></svg>; }
function RefreshIcon({ spinning }: { spinning: boolean }) { return <svg {...ic} width={18} height={18} className={spinning ? 'cdb-spin' : undefined}><path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5" {...st}/></svg>; }
function BoxIcon() { return <svg {...ic}><path d="M3.5 7.5 12 3.5l8.5 4v9L12 20.5l-8.5-4v-9z" {...st}/><path d="M3.7 7.6 12 11.5l8.3-3.9M12 11.5v9" {...st}/></svg>; }
function StackIcon() { return <svg {...ic}><path d="M12 3.5 20.5 8 12 12.5 3.5 8 12 3.5z" {...st}/><path d="m3.5 12 8.5 4.5 8.5-4.5M3.5 16l8.5 4.5 8.5-4.5" {...st}/></svg>; }
function HeartIcon() { return <svg {...ic}><path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20z" {...st}/></svg>; }
function ScanIcon() { return <svg {...ic}><path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16M4 12h16" {...st}/></svg>; }
function ChartIcon() { return <svg {...ic}><path d="M4 20h16M7 16v-5M12 16V7M17 16v-8" {...st}/></svg>; }
function CalendarIcon() { return <svg {...ic}><rect x="3.5" y="5" width="17" height="15" rx="2" {...st}/><path d="M3.5 9.5h17M8 3v4M16 3v4" {...st}/></svg>; }
function AlertIcon() { return <svg {...ic}><path d="M12 4 21 19.5H3L12 4z" {...st}/><path d="M12 10v4.5M12 17.2v.1" {...st}/></svg>; }
function ClipboardIcon() { return <svg {...ic}><rect x="5" y="4.5" width="14" height="16" rx="2" {...st}/><path d="M9 4.5V3.5h6v1M8.5 11l2.2 2.2L15.5 9" {...st}/></svg>; }
