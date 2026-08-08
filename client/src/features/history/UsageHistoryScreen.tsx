/**
 * Usage History (Feature 10 — HIST-01..16) + Article Lifecycle (INV-27).
 *
 * Two tabs, staff-only for the second:
 *   Transaction History — borrow and venue session records, filterable by
 *     date range, type, outcome. Staff can also filter by actor name search.
 *   Article Lifecycle — select any article by barcode or equipment name, then
 *     inspect its full history: audit log, health scans, damage flags, pairs.
 *
 * Role behaviour:
 *  - SUPER_ADMIN / COORDINATOR: full transaction history, all users. Article
 *    Lifecycle tab visible.
 *  - STUDENT: own history only — all kinds.
 *  - EXTERNAL: own history only — VENUE_SESSION only. No Article Lifecycle tab.
 */
import { useEffect, useState, useCallback, useMemo } from 'react';
import { Navigate } from 'react-router-dom';
import Fuse from 'fuse.js';
import { useAuth } from '../../lib/auth.js';
import { PortalShell } from '../auth/PortalShell.js';
import { listHistory, type HistoryRow, type HistoryFilter } from './api.js';
import { listArticles, getArticleLifecycle, type Article, type ArticleLifecycle } from '../inventory/api.js';
import { ApiRequestError } from '../../lib/api.js';

function errMsg(e: unknown) {
  return e instanceof ApiRequestError ? e.body.error : 'Something went wrong.';
}

function fmtDateTime(d: string) {
  return new Date(d).toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' });
}
function fmtDate(d: string) {
  return new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

const PAGE_SIZE = 30;

// ─────────────────────────────────────────────────────────────────────────────
// Root screen
// ─────────────────────────────────────────────────────────────────────────────
export default function UsageHistoryScreen() {
  const { user, loading } = useAuth();
  const isStaff = user?.role === 'SUPER_ADMIN' || user?.role === 'COORDINATOR';
  const [tab, setTab] = useState<'transactions' | 'lifecycle'>('transactions');

  if (loading) return <PortalShell title="Usage History"><p /></PortalShell>;
  if (!user) return <Navigate to="/" replace />;

  const tint = isStaff ? 'navy' as const : user.role === 'EXTERNAL' ? 'blue' as const : 'sage' as const;

  return (
    <PortalShell title="Usage History" tint={tint}>
      <div style={wrap}>
        {/* Tab row — Article Lifecycle tab only shown to staff */}
        <div style={tabRow} role="tablist">
          <button role="tab" aria-selected={tab === 'transactions'} style={{ ...tabBtn, ...(tab === 'transactions' ? tabActive : {}) }}
            onClick={() => setTab('transactions')}>
            Transaction History
          </button>
          {isStaff && (
            <button role="tab" aria-selected={tab === 'lifecycle'} style={{ ...tabBtn, ...(tab === 'lifecycle' ? tabActive : {}) }}
              onClick={() => setTab('lifecycle')}>
              Article Lifecycle
            </button>
          )}
        </div>

        {tab === 'transactions' && <TransactionHistoryTab isStaff={isStaff} userRole={user.role} />}
        {tab === 'lifecycle' && isStaff && <ArticleLifecycleTab />}
      </div>
    </PortalShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab 1: Transaction History (existing feature)
// ─────────────────────────────────────────────────────────────────────────────
const OUTCOMES: Record<string, { label: string; style: React.CSSProperties }> = {
  COMPLETED: { label: 'Completed', style: { background: '#e6f4ec', color: '#1f7a45' } },
  COMPLETED_LATE: { label: 'Completed — Late', style: { background: '#fdf1e3', color: '#9a6412' } },
  COMPLETED_DAMAGED: { label: 'Completed — Damaged', style: { background: '#fdecec', color: '#8f2323' } },
  CANCELLED: { label: 'Cancelled', style: { background: '#eceff2', color: '#566' } },
};

function OutcomeBadge({ outcome }: { outcome: string }) {
  const cfg = OUTCOMES[outcome];
  return <span style={{ ...badge, ...(cfg?.style ?? { background: '#eceff2', color: '#566' }) }}>{cfg?.label ?? outcome}</span>;
}
function KindBadge({ kind }: { kind: 'VENUE_SESSION' | 'EQUIPMENT_BORROW' }) {
  return <span style={{ ...badge, ...(kind === 'EQUIPMENT_BORROW' ? { background: '#e3f2ff', color: '#1565c0' } : { background: '#f3e8ff', color: '#6b21a8' }) }}>
    {kind === 'EQUIPMENT_BORROW' ? 'Equipment' : 'Venue'}
  </span>;
}

function TransactionHistoryTab({ isStaff, userRole }: { isStaff: boolean; userRole: string }) {
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [fetching, setFetching] = useState(false);

  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [kind, setKind] = useState<'' | 'VENUE_SESSION' | 'EQUIPMENT_BORROW'>('');
  const [outcome, setOutcome] = useState('');
  const [actorSearch, setActorSearch] = useState('');

  const load = useCallback(async (pg: number) => {
    setFetching(true);
    try {
      const filter: HistoryFilter = { limit: PAGE_SIZE, offset: pg * PAGE_SIZE };
      if (from) filter.from = from;
      if (to) filter.to = to;
      if (kind) filter.kind = kind;
      if (outcome) filter.outcome = outcome;
      // actorSearch is name-based — passed as actorUserId field for backend compatibility
      // (backend already supports UUID; name search is client-side fuse below)
      const res = await listHistory(filter);
      setRows(res.history);
      setTotal(res.total);
      setError(null);
    } catch (e) { setError(errMsg(e)); }
    finally { setFetching(false); }
  }, [from, to, kind, outcome]);

  useEffect(() => { void load(page); }, [load, page]);

  // Client-side name search (fuse) on top of server pagination
  const fuse = useMemo(() => new Fuse(rows, {
    keys: ['borrowerName', 'guestName', 'equipmentTypeName', 'venueName'],
    threshold: 0.35, ignoreLocation: true,
  }), [rows]);
  const visibleRows = actorSearch.trim() ? fuse.search(actorSearch.trim()).map((r) => r.item) : rows;

  function applyFilters() { setPage(0); void load(0); }
  function clearFilters() { setFrom(''); setTo(''); setKind(''); setOutcome(''); setActorSearch(''); setPage(0); }

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div>
      {error && <div style={errBox}>{error}</div>}

      {/* Filter bar */}
      <div style={filterPanel}>
        <div style={filterGrid}>
          <label style={lbl}>From
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={inp} />
          </label>
          <label style={lbl}>To
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={inp} />
          </label>
          {userRole !== 'EXTERNAL' && (
            <label style={lbl}>Type
              <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} style={inp}>
                <option value="">All</option>
                <option value="EQUIPMENT_BORROW">Equipment</option>
                <option value="VENUE_SESSION">Venue</option>
              </select>
            </label>
          )}
          <label style={lbl}>Outcome
            <select value={outcome} onChange={(e) => setOutcome(e.target.value)} style={inp}>
              <option value="">All</option>
              <option value="COMPLETED">Completed</option>
              <option value="COMPLETED_LATE">Completed — Late</option>
              <option value="COMPLETED_DAMAGED">Completed — Damaged</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
          </label>
          {isStaff && (
            <label style={{ ...lbl, gridColumn: '1 / -1' }}>Search by name or equipment
              <input type="search" placeholder="Filter by borrower, guest, equipment, or venue name…"
                value={actorSearch} onChange={(e) => setActorSearch(e.target.value)} style={inp} />
            </label>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button style={btnPrimary} onClick={applyFilters}>Apply</button>
          <button style={btnSecondary} onClick={clearFilters}>Clear</button>
        </div>
      </div>

      <div style={countRow}>{fetching ? 'Loading…' : `${total} record${total !== 1 ? 's' : ''}`}</div>

      {visibleRows.length === 0 && !fetching ? (
        <p style={muted}>No usage history records match the current filters.</p>
      ) : (
        <table style={tbl}>
          <thead>
            <tr>
              <th style={th}>Date</th>
              <th style={th}>Type</th>
              <th style={th}>Subject</th>
              {isStaff && <th style={th}>User</th>}
              <th style={th}>Outcome</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => (
              <tr key={row.historyId}>
                <td style={td}>{fmtDate(row.occurredOn)}</td>
                <td style={td}><KindBadge kind={row.kind} /></td>
                <td style={td}>
                  <span style={{ fontWeight: 500 }}>
                    {row.kind === 'EQUIPMENT_BORROW' ? (row.equipmentTypeName ?? '—') : (row.venueName ?? '—')}
                  </span>
                  {row.teamName && <span style={subtext}>{row.teamName}</span>}
                  {row.sportCategoryName && <span style={subtext}>· {row.sportCategoryName}</span>}
                  {row.enteredViaOfflineFallback && <span style={{ ...badge, background: '#f0e9ff', color: '#6b21a8', marginLeft: 8 }}>offline</span>}
                </td>
                {isStaff && (
                  <td style={td}>
                    {row.borrowerName ?? (row.guestName ? `${row.guestName} (guest)` : '—')}
                  </td>
                )}
                <td style={td}><OutcomeBadge outcome={row.outcome} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {totalPages > 1 && (
        <div style={pagination}>
          <button style={btnSecondary} disabled={page === 0} onClick={() => setPage((p) => p - 1)}>← Prev</button>
          <span style={{ font: '13px var(--font-body)', color: '#666' }}>Page {page + 1} of {totalPages}</span>
          <button style={btnSecondary} disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)}>Next →</button>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab 2: Article Lifecycle (INV-27)
// ─────────────────────────────────────────────────────────────────────────────
const ACTION_LABEL: Record<string, string> = {
  ARTICLE_ENTERED: 'Article Added',
  ARTICLE_DECOMMISSIONED: 'Decommissioned',
  TYPE_EDITED: 'Equipment Type Edited',
  SCAN_RECORDED: 'Health Check Scan',
  DAMAGE_FLAG_RAISED: 'Damage Flag Raised',
  DAMAGE_FLAG_CLEARED: 'Damage Flag Cleared',
  CONDITION_OVERRIDDEN: 'Condition Override',
  PAIR_FORMED: 'Pair Formed',
  PAIR_DISSOLVED: 'Pair Dissolved',
};
const ACTION_COLOR: Record<string, string> = {
  ARTICLE_ENTERED: '#1f7a45',
  ARTICLE_DECOMMISSIONED: '#b3352b',
  DAMAGE_FLAG_RAISED: '#b3352b',
  DAMAGE_FLAG_CLEARED: '#1f7a45',
  SCAN_RECORDED: '#0a6ebd',
  CONDITION_OVERRIDDEN: '#9a6412',
  TYPE_EDITED: '#5c6773',
  PAIR_FORMED: '#1f7a45',
  PAIR_DISSOLVED: '#9a6412',
};
const ACTION_BG: Record<string, string> = {
  ARTICLE_ENTERED: '#e6f4ec',
  ARTICLE_DECOMMISSIONED: '#fdecec',
  DAMAGE_FLAG_RAISED: '#fdecec',
  DAMAGE_FLAG_CLEARED: '#e6f4ec',
  SCAN_RECORDED: '#e3f2ff',
  CONDITION_OVERRIDDEN: '#fdf1e3',
  TYPE_EDITED: '#f4f5f6',
  PAIR_FORMED: '#e6f4ec',
  PAIR_DISSOLVED: '#fdf1e3',
};

const STATE_LABEL: Record<string, string> = {
  AVAILABLE: 'Available', ON_LOAN: 'On Loan',
  DAMAGED: 'Unavailable', DECOMMISSIONED: 'Decommissioned',
};

function ArticleLifecycleTab() {
  const [allArticles, setAllArticles] = useState<Article[]>([]);
  const [articlesLoading, setArticlesLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [lifecycle, setLifecycle] = useState<ArticleLifecycle | null>(null);
  const [lifecycleLoading, setLifecycleLoading] = useState(false);
  const [lifecycleError, setLifecycleError] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<'timeline' | 'scans' | 'flags' | 'pairs'>('timeline');

  // Browsable list pagination
  const LIST_PAGE = 20;
  const [listPage, setListPage] = useState(0);

  // Load all active articles once
  useEffect(() => {
    listArticles()
      .then((r) => setAllArticles(r.articles))
      .catch(() => setAllArticles([]))
      .finally(() => setArticlesLoading(false));
  }, []);

  // Fuse for both dropdown and filtered list
  const fuse = useMemo(() => new Fuse(allArticles, {
    keys: ['barcode', 'equipment_type_name'],
    threshold: 0.3, ignoreLocation: true,
  }), [allArticles]);

  // Dropdown: quick picks while typing
  const dropdownResults = search.trim().length >= 1
    ? fuse.search(search.trim()).slice(0, 10).map((r) => r.item)
    : [];

  // List: full filtered set (or all when search empty)
  const listResults = useMemo(() =>
    search.trim() && !selectedId
      ? fuse.search(search.trim()).map((r) => r.item)
      : allArticles,
  [search, selectedId, allArticles, fuse]);

  // Reset list page on search change
  useEffect(() => { setListPage(0); }, [search]);

  const listTotalPages = Math.ceil(listResults.length / LIST_PAGE);
  const listPageItems = listResults.slice(listPage * LIST_PAGE, (listPage + 1) * LIST_PAGE);

  // Load lifecycle when an article is selected
  useEffect(() => {
    if (!selectedId) { setLifecycle(null); return; }
    setLifecycleLoading(true);
    setLifecycleError(null);
    setDetailTab('timeline');
    getArticleLifecycle(selectedId)
      .then(setLifecycle)
      .catch((e) => setLifecycleError(errMsg(e)))
      .finally(() => setLifecycleLoading(false));
  }, [selectedId]);

  function selectArticle(a: Article) {
    setSelectedId(a.article_id);
    setSearch(`${a.barcode} — ${a.equipment_type_name}`);
  }
  function clearSelection() { setSearch(''); setSelectedId(null); setLifecycle(null); }

  const showDropdown = search.trim().length >= 1 && !selectedId && dropdownResults.length > 0;

  const stateBadgeStyle = (s: string): React.CSSProperties =>
    s === 'AVAILABLE'      ? { background: '#e6f4ec', color: '#1f7a45' } :
    s === 'DAMAGED'        ? { background: '#fdecec', color: '#b3352b' } :
    s === 'DECOMMISSIONED' ? { background: '#f4f5f6', color: '#5c6773' } :
                             { background: '#e3f2ff', color: '#1565c0' };

  const condBadgeStyle = (c: string): React.CSSProperties =>
    c === 'GOOD' ? { background: '#e6f4ec', color: '#1f7a45' } :
    c === 'WORN' ? { background: '#fdf1e3', color: '#9a6412' } :
                   { background: '#fdecec', color: '#b3352b' };

  return (
    <div>
      {/* ── Search bar ── */}
      <div style={filterPanel}>
        <label style={lbl}>Search by barcode or equipment name</label>
        <div style={{ position: 'relative', marginTop: 6 }}>
          <input
            type="search"
            style={{ ...inp, paddingLeft: 36, fontSize: 15 }}
            placeholder="Type a barcode or equipment name…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setSelectedId(null); setLifecycle(null); }}
          />
          <svg style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}
            width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8a949f" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          {selectedId && (
            <button onClick={clearSelection}
              style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#8a949f', fontSize: 18, lineHeight: 1 }}>
              ×
            </button>
          )}
          {/* Dropdown — quick picks while typing (collapses when article selected) */}
          {showDropdown && (
            <div style={dropdown}>
              {dropdownResults.map((a) => (
                <button key={a.article_id} style={dropItemBtn} onClick={() => selectArticle(a)}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>{a.barcode}</span>
                  <span style={{ color: '#5c6773', marginLeft: 8, fontSize: 13 }}>{a.equipment_type_name}</span>
                  <span style={{ ...badge, ...stateBadgeStyle(a.state), marginLeft: 'auto', fontSize: 11 }}>
                    {STATE_LABEL[a.state] ?? a.state}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
        {!articlesLoading && !selectedId && (
          <p style={{ ...muted, marginTop: 8 }}>
            {search.trim()
              ? `${listResults.length} article${listResults.length !== 1 ? 's' : ''} matching "${search.trim()}" — click any row to view history.`
              : `${allArticles.length} active article${allArticles.length !== 1 ? 's' : ''} — click any row to view full lifecycle history, or search above.`}
          </p>
        )}
      </div>

      {/* ── Lifecycle detail (replaces list when an article is selected) ── */}
      {lifecycleLoading && (
        <div style={detailCard}>
          <div style={{ padding: '32px 24px' }}><p style={muted}>Loading article history…</p></div>
        </div>
      )}
      {lifecycleError && <div style={errBox}>{lifecycleError}</div>}

      {lifecycle && !lifecycleLoading && (
        <div style={detailCard}>
          {/* Article header */}
          <div style={articleHeader}>
            <div style={articleHeaderLeft}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 18, fontWeight: 700, color: '#26485f', letterSpacing: '0.04em' }}>
                {lifecycle.article.barcode}
              </div>
              <div style={{ font: '600 15px var(--font-body)', color: '#333', marginTop: 2 }}>
                {lifecycle.article.equipment_type_name}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                <span style={{ ...badge, ...stateBadgeStyle(lifecycle.article.state) }}>
                  {STATE_LABEL[lifecycle.article.state] ?? lifecycle.article.state}
                </span>
                <span style={{ ...badge, ...condBadgeStyle(lifecycle.article.current_condition_label) }}>
                  {lifecycle.article.current_condition_label}
                </span>
                <span style={{ ...badge, background: '#f4f5f6', color: '#5c6773' }}>
                  {lifecycle.article.lending_unit === 'PAIR' ? 'Pair-lending' : 'Single'}
                </span>
              </div>
            </div>
            <div style={articleHeaderRight}>
              <div style={metaLine}><span style={metaKey}>Added</span>{fmtDateTime(lifecycle.article.entered_at as unknown as string)}</div>
              <div style={metaLine}><span style={metaKey}>By</span>{lifecycle.article.entered_by_name}</div>
              {lifecycle.article.decommissioned_at && <>
                <div style={{ ...metaLine, color: '#b3352b', marginTop: 4 }}><span style={metaKey}>Decommissioned</span>{fmtDateTime(lifecycle.article.decommissioned_at as unknown as string)}</div>
                {lifecycle.article.decommissioned_by_name && <div style={{ ...metaLine, color: '#b3352b' }}><span style={metaKey}>By</span>{lifecycle.article.decommissioned_by_name}</div>}
              </>}
            </div>
          </div>

          {/* Stats row */}
          <div style={statsRow}>
            {[
              { label: 'Audit Entries', value: lifecycle.auditLog.length, color: '#26485f' },
              { label: 'Health Scans',  value: lifecycle.scans.length,    color: '#1565c0' },
              { label: 'Damage Flags',  value: lifecycle.flags.length,    color: lifecycle.flags.some((f) => !f.cleared_at) ? '#b3352b' : '#1f7a45' },
              { label: 'Pair Records',  value: lifecycle.pairs.length,    color: '#6b21a8' },
            ].map((s) => (
              <div key={s.label} style={statCard}>
                <div style={{ font: '700 24px var(--font-body)', color: s.color }}>{s.value}</div>
                <div style={{ font: '11px var(--font-body)', color: '#8a949f', textTransform: 'uppercase', letterSpacing: '0.04em', marginTop: 2 }}>{s.label}</div>
              </div>
            ))}
          </div>

          {/* Detail tab strip */}
          <div style={detailTabRow}>
            {(['timeline', 'scans', 'flags', 'pairs'] as const).map((t) => (
              <button key={t} style={{ ...detailTabBtn, ...(detailTab === t ? detailTabActive : {}) }} onClick={() => setDetailTab(t)}>
                {t === 'timeline' ? 'Audit Log' : t === 'scans' ? 'Health Scans' : t === 'flags' ? 'Damage Flags' : 'Pair History'}
              </button>
            ))}
          </div>

          {/* Audit log timeline */}
          {detailTab === 'timeline' && (
            <div style={detailBody}>
              {lifecycle.auditLog.length === 0 ? <p style={muted}>No audit entries recorded yet.</p>
                : lifecycle.auditLog.map((entry, i) => (
                  <div key={entry.log_id} style={{ display: 'flex', gap: 14, paddingBottom: 16, marginBottom: i < lifecycle.auditLog.length - 1 ? 16 : 0, borderBottom: i < lifecycle.auditLog.length - 1 ? '1px solid #f0f0f0' : 'none' }}>
                    <div style={{ flexShrink: 0, width: 32, height: 32, borderRadius: 8, background: ACTION_BG[entry.action] ?? '#f4f5f6', display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 2 }}>
                      <div style={{ width: 10, height: 10, borderRadius: '50%', background: ACTION_COLOR[entry.action] ?? '#5c6773' }} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                        <span style={{ font: '600 14px var(--font-body)', color: ACTION_COLOR[entry.action] ?? '#333' }}>
                          {ACTION_LABEL[entry.action] ?? entry.action}
                        </span>
                        <span style={{ font: '12px var(--font-body)', color: '#8a949f', whiteSpace: 'nowrap' }}>
                          {fmtDateTime(entry.occurred_at as unknown as string)}
                        </span>
                      </div>
                      <div style={{ font: '13px var(--font-body)', color: '#5c6773', marginTop: 3 }}>
                        {entry.actor_name} · <span style={{ textTransform: 'capitalize' }}>{entry.actor_role.replace('_', ' ').toLowerCase()}</span>
                      </div>
                    </div>
                  </div>
                ))
              }
            </div>
          )}

          {/* Health scans */}
          {detailTab === 'scans' && (
            <div style={detailBody}>
              {lifecycle.scans.length === 0 ? <p style={muted}>No health scans recorded.</p> : (
                <table style={tbl}>
                  <thead><tr><th style={th}>Date & Time</th><th style={th}>Kind</th><th style={th}>Score</th><th style={th}>Condition</th><th style={th}>Performed By</th></tr></thead>
                  <tbody>
                    {lifecycle.scans.map((s) => (
                      <tr key={s.scan_id}>
                        <td style={td}>{fmtDateTime(s.scanned_at as unknown as string)}</td>
                        <td style={td}>
                          <span style={{ ...badge, background: s.kind === 'ENTRY' ? '#e3f2ff' : s.kind === 'SCHEDULED' ? '#f3e8ff' : '#f4f5f6', color: s.kind === 'ENTRY' ? '#1565c0' : s.kind === 'SCHEDULED' ? '#6b21a8' : '#5c6773' }}>
                            {s.kind === 'ENTRY' ? 'Entry' : s.kind === 'SCHEDULED' ? 'Scheduled' : 'Ad-hoc'}
                          </span>
                        </td>
                        <td style={td}>
                          <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 15 }}>{Number(s.health_score).toFixed(0)}</span>
                          <span style={{ color: '#8a949f', fontSize: 12 }}>/100</span>
                        </td>
                        <td style={td}><span style={{ ...badge, ...condBadgeStyle(s.resulting_label) }}>{s.resulting_label}</span></td>
                        <td style={td}>{s.scanned_by_name}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* Damage flags */}
          {detailTab === 'flags' && (
            <div style={detailBody}>
              {lifecycle.flags.length === 0 ? <p style={muted}>No damage flags on record.</p> : (
                <table style={tbl}>
                  <thead><tr><th style={th}>Raised</th><th style={th}>Raised By</th><th style={th}>Status</th><th style={th}>Cleared</th><th style={th}>Cleared By</th><th style={th}>Final Condition</th></tr></thead>
                  <tbody>
                    {lifecycle.flags.map((f) => (
                      <tr key={f.flag_id}>
                        <td style={td}>{fmtDateTime(f.raised_at as unknown as string)}</td>
                        <td style={td}>{f.raised_by_system ? <span style={{ color: '#5c6773' }}>System (auto)</span> : (f.raised_by_name ?? '—')}</td>
                        <td style={td}>
                          {f.cleared_at
                            ? <span style={{ ...badge, background: '#e6f4ec', color: '#1f7a45' }}>Cleared</span>
                            : <span style={{ ...badge, background: '#fdecec', color: '#b3352b' }}>Open</span>}
                        </td>
                        <td style={td}>{f.cleared_at ? fmtDateTime(f.cleared_at as unknown as string) : '—'}</td>
                        <td style={td}>{f.cleared_by_name ?? '—'}</td>
                        <td style={td}>{f.cleared_with_label ? <span style={{ ...badge, ...condBadgeStyle(f.cleared_with_label) }}>{f.cleared_with_label}</span> : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* Pair history */}
          {detailTab === 'pairs' && (
            <div style={detailBody}>
              {lifecycle.pairs.length === 0 ? <p style={muted}>No pair history for this article.</p> : (
                <table style={tbl}>
                  <thead><tr><th style={th}>Partner</th><th style={th}>Paired On</th><th style={th}>Paired By</th><th style={th}>Status</th><th style={th}>Dissolved</th><th style={th}>Reason</th></tr></thead>
                  <tbody>
                    {lifecycle.pairs.map((p) => {
                      const partnerId = p.article_a_id === lifecycle.article.article_id ? p.article_b_id : p.article_a_id;
                      return (
                        <tr key={p.pair_id}>
                          <td style={{ ...td, fontFamily: 'var(--font-mono)', fontSize: 13 }}>{partnerId.slice(0, 8)}…</td>
                          <td style={td}>{fmtDateTime(p.formed_at as unknown as string)}</td>
                          <td style={td}>{p.formed_by_name ?? '—'}</td>
                          <td style={td}>
                            {!p.dissolved_at
                              ? <span style={{ ...badge, background: '#e6f4ec', color: '#1f7a45' }}>Active</span>
                              : <span style={{ ...badge, background: '#f4f5f6', color: '#5c6773' }}>Dissolved</span>}
                          </td>
                          <td style={td}>{p.dissolved_at ? fmtDateTime(p.dissolved_at as unknown as string) : '—'}</td>
                          <td style={td}>{p.dissolution_reason ?? '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Browsable article list (shown whenever no article is selected) ── */}
      {!selectedId && (
        <div>
          {/* Count + top pagination */}
          {!articlesLoading && listResults.length > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <span style={countRow}>
                {search.trim()
                  ? `${listResults.length} result${listResults.length !== 1 ? 's' : ''}`
                  : `${allArticles.length} article${allArticles.length !== 1 ? 's' : ''}`}
              </span>
              {listTotalPages > 1 && (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <button style={{ ...btnSecondary, padding: '5px 12px', fontSize: 12 }} disabled={listPage === 0} onClick={() => setListPage((p) => p - 1)}>← Prev</button>
                  <span style={{ font: '12px var(--font-body)', color: '#666' }}>{listPage + 1} / {listTotalPages}</span>
                  <button style={{ ...btnSecondary, padding: '5px 12px', fontSize: 12 }} disabled={listPage >= listTotalPages - 1} onClick={() => setListPage((p) => p + 1)}>Next →</button>
                </div>
              )}
            </div>
          )}

          {articlesLoading && <p style={muted}>Loading articles…</p>}

          {!articlesLoading && listResults.length === 0 && search.trim() && (
            <p style={muted}>No articles match "{search.trim()}".</p>
          )}

          {!articlesLoading && listPageItems.length > 0 && (
            <table style={tbl}>
              <thead>
                <tr>
                  <th style={th}>Barcode</th>
                  <th style={th}>Equipment Type</th>
                  <th style={th}>Unit</th>
                  <th style={th}>Condition</th>
                  <th style={th}>State</th>
                  <th style={th}>Added</th>
                </tr>
              </thead>
              <tbody>
                {listPageItems.map((a) => (
                  <tr key={a.article_id} style={articleListRow} onClick={() => selectArticle(a)} title="Click to view full history">
                    <td style={{ ...td, fontFamily: 'var(--font-mono)', fontWeight: 600, letterSpacing: '0.03em' }}>{a.barcode}</td>
                    <td style={td}>{a.equipment_type_name}</td>
                    <td style={td}>
                      <span style={{ ...badge, background: '#f4f5f6', color: '#5c6773' }}>
                        {a.lending_unit === 'PAIR' ? 'Pair' : 'Single'}
                      </span>
                    </td>
                    <td style={td}><span style={{ ...badge, ...condBadgeStyle(a.current_condition_label) }}>{a.current_condition_label}</span></td>
                    <td style={td}><span style={{ ...badge, ...stateBadgeStyle(a.state) }}>{STATE_LABEL[a.state] ?? a.state}</span></td>
                    <td style={{ ...td, color: '#8a949f', fontSize: 13 }}>{fmtDate(a.entered_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* Bottom pagination */}
          {!articlesLoading && listTotalPages > 1 && (
            <div style={{ ...pagination, marginTop: 14 }}>
              <button style={btnSecondary} disabled={listPage === 0} onClick={() => setListPage((p) => p - 1)}>← Prev</button>
              <span style={{ font: '13px var(--font-body)', color: '#666' }}>Page {listPage + 1} of {listTotalPages}</span>
              <button style={btnSecondary} disabled={listPage >= listTotalPages - 1} onClick={() => setListPage((p) => p + 1)}>Next →</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}


// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────
const wrap: React.CSSProperties = { maxWidth: 980, margin: '0 auto' };

const tabRow: React.CSSProperties = { display: 'flex', gap: 4, padding: 4, background: '#e7edf4', borderRadius: 10, marginBottom: 22 };
const tabBtn: React.CSSProperties = { flex: 1, font: '500 14px var(--font-body)', padding: '9px 10px', border: 'none', background: 'transparent', color: '#5c6773', borderRadius: 7, cursor: 'pointer' };
const tabActive: React.CSSProperties = { background: '#fff', color: '#26485f', boxShadow: '0 1px 2px rgba(15,27,45,0.1)' };

const filterPanel: React.CSSProperties = { background: '#f8f9fa', border: '1px solid #e5e7eb', borderRadius: 8, padding: '16px 18px', marginBottom: 18 };
const filterGrid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '12px 16px' };

const lbl: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, font: '600 11px var(--font-body)', color: '#555', textTransform: 'uppercase', letterSpacing: '0.04em' };
const inp: React.CSSProperties = { font: '14px var(--font-body)', padding: '8px 10px', border: '1px solid #ccc', borderRadius: 6, background: '#fff', width: '100%', boxSizing: 'border-box' };

const btnPrimary: React.CSSProperties = { font: '600 13px var(--font-body)', padding: '8px 20px', background: '#26485f', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' };
const btnSecondary: React.CSSProperties = { font: '600 13px var(--font-body)', padding: '8px 14px', background: '#fff', color: '#666', border: '1px solid #ccc', borderRadius: 6, cursor: 'pointer' };

const countRow: React.CSSProperties = { font: '13px var(--font-body)', color: '#8a949f', marginBottom: 10 };
const pagination: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, marginTop: 18 };

const tbl: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 14, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6 };
const th: React.CSSProperties = { textAlign: 'left', font: '600 11px var(--font-body)', color: '#888', textTransform: 'uppercase', letterSpacing: '0.04em', padding: '10px 14px', borderBottom: '1px solid #e5e5e5', background: '#fafafa' };
const td: React.CSSProperties = { padding: '11px 14px', borderBottom: '1px solid #f0f0f0', color: '#333', verticalAlign: 'middle' };

const badge: React.CSSProperties = { display: 'inline-block', font: '600 11px var(--font-mono)', padding: '2px 8px', borderRadius: 4 };
const muted: React.CSSProperties = { color: '#8a949f', fontSize: 14, margin: 0 };
const subtext: React.CSSProperties = { color: '#8a949f', fontSize: 12, marginLeft: 6 };

const errBox: React.CSSProperties = { background: '#fdecec', color: '#8f2323', border: '1px solid #f3caca', borderRadius: 6, padding: '10px 14px', marginBottom: 16, fontSize: 14 };

// Dropdown
const dropdown: React.CSSProperties = {
  position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 200,
  background: '#fff', border: '1px solid #ddd', borderRadius: 8,
  boxShadow: '0 4px 16px rgba(0,0,0,0.1)', maxHeight: 280, overflowY: 'auto',
};
const dropItem: React.CSSProperties = { padding: '10px 14px', color: '#8a949f', fontSize: 13 };
const dropItemBtn: React.CSSProperties = {
  width: '100%', display: 'flex', alignItems: 'center', gap: 4,
  padding: '10px 14px', background: 'none', border: 'none', cursor: 'pointer',
  textAlign: 'left', borderBottom: '1px solid #f4f4f4',
  font: '14px var(--font-body)', color: '#333',
  transition: 'background 0.1s',
};

// Article lifecycle detail card
const detailCard: React.CSSProperties = {
  background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10,
  overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
};
const articleHeader: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16,
  padding: '20px 24px', background: 'linear-gradient(135deg, #f0f4f8 0%, #e7edf4 100%)',
  borderBottom: '1px solid #e5e7eb',
};
const articleHeaderLeft: React.CSSProperties = { flex: '1 1 220px' };
const articleHeaderRight: React.CSSProperties = { flex: '1 1 220px', display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' };
const metaLine: React.CSSProperties = { font: '13px var(--font-body)', color: '#5c6773', display: 'flex', gap: 6, alignItems: 'baseline' };
const metaKey: React.CSSProperties = { font: '600 11px var(--font-body)', color: '#8a949f', textTransform: 'uppercase', letterSpacing: '0.04em', minWidth: 80, textAlign: 'right' };

const statsRow: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', borderBottom: '1px solid #e5e7eb' };
const statCard: React.CSSProperties = { padding: '16px 20px', textAlign: 'center', borderRight: '1px solid #f0f0f0' };

const detailTabRow: React.CSSProperties = { display: 'flex', borderBottom: '1px solid #e5e7eb', background: '#fafafa' };
const detailTabBtn: React.CSSProperties = {
  flex: 1, font: '500 13px var(--font-body)', padding: '12px 8px',
  border: 'none', borderBottom: '2px solid transparent', background: 'transparent',
  color: '#5c6773', cursor: 'pointer', transition: 'color 0.15s',
};
const detailTabActive: React.CSSProperties = { color: '#26485f', borderBottomColor: '#26485f', fontWeight: 600, background: '#fff' };
const detailBody: React.CSSProperties = { padding: '20px 24px' };

const articleListRow: React.CSSProperties = {
  cursor: 'pointer',
  transition: 'background 0.1s',
};
