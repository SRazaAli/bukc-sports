/**
 * Usage History (Feature 10 — HIST-01..16) + Article Lifecycle (INV-27).
 *
 * Visual redesign only, same as Calendar/Home: on-brand card layout with
 * role-tinted accents, animated tab switching, and interactive rows/cards,
 * instead of the old plain grey-panel table. Every field, filter, column,
 * and role behaviour from the original screen is preserved exactly:
 *
 *   Transaction History — borrow and venue session records, filterable by
 *     date range, type (hidden for External), outcome. Staff additionally
 *     get an actor/equipment name search and a User column.
 *   Article Lifecycle (staff-only tab) — search any article by barcode or
 *     equipment name, browse the paginated article list, then inspect its
 *     full history: audit log, health scans, damage flags, pair history.
 *
 * Role behaviour (unchanged):
 *  - SUPER_ADMIN / COORDINATOR: full transaction history, all users, User
 *    column, name/equipment search, Article Lifecycle tab.
 *  - STUDENT: own history only — all kinds, Type filter shown.
 *  - EXTERNAL: own history only — Type filter hidden, no Article Lifecycle.
 *
 * Frontend-only: same listHistory / listArticles / getArticleLifecycle
 * calls, same params, same Fuse.js client-side search, same pagination.
 * No longer uses PortalShell (still used by Profile/AdminAccounts/
 * AcceptInvite, untouched) — same self-contained shell pattern as
 * CalendarScreen/HomeScreen, with Back + Sign out top right.
 */
import { useEffect, useState, useCallback, useMemo, type ReactNode } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import Fuse from 'fuse.js';
import { useAuth } from '../../lib/auth.js';
import { palette, ROLE_THEME, type PortalKey } from '../auth/AuthUI.js';
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
const ROLE_PORTAL: Record<string, PortalKey> = {
  STUDENT: 'student', EXTERNAL: 'external', COORDINATOR: 'coordinator', SUPER_ADMIN: 'admin',
};
function roleLabel(role: string) {
  return role === 'SUPER_ADMIN' ? 'Administration Staff' : role === 'COORDINATOR' ? 'Coordinator' : role === 'EXTERNAL' ? 'External' : 'Student';
}

// ─────────────────────────────────────────────────────────────────────────────
// Root screen
// ─────────────────────────────────────────────────────────────────────────────
export default function UsageHistoryScreen() {
  const { user, loading, logout } = useAuth();
  const navigate = useNavigate();
  const isStaff = user?.role === 'SUPER_ADMIN' || user?.role === 'COORDINATOR';
  const [tab, setTab] = useState<'transactions' | 'lifecycle'>('transactions');

  if (loading) {
    return <div className="auth-ui" style={{ minHeight: '100%', background: palette.mint50 }} />;
  }
  if (!user) return <Navigate to="/" replace />;

  const theme = ROLE_THEME[ROLE_PORTAL[user.role] ?? 'admin'];

  return (
    <div className="auth-ui" style={s.page}>
      <HistStyles />
      <div style={s.heroBlobA} aria-hidden />
      <div style={s.heroBlobB} aria-hidden />

      <header style={s.topbar}>
        <div style={s.brand}>
          <span style={{ ...s.logoMark, background: theme.solid }}>BU</span>
          <span style={s.wordmark}>Bahria University</span>
        </div>
        <div style={s.topbarRight}>
          <Link to="/home" className="hist-topbtn" style={s.topBtn}><BackIcon /> Back</Link>
          <button type="button" className="hist-topbtn hist-signout" style={s.topBtn} onClick={() => { void logout(); navigate('/'); }}>
            <SignOutIcon /> Sign out
          </button>
        </div>
      </header>

      <main style={s.main}>
        <div style={s.headRow}>
          <span style={{ ...s.eyebrow, color: theme.solid, background: theme.soft }}>{roleLabel(user.role)} Portal</span>
          <h1 style={s.title}>Usage History</h1>
        </div>

        <div style={s.tabRow} role="tablist">
          <button
            role="tab" aria-selected={tab === 'transactions'} className="hist-tab"
            style={{ ...s.tabBtn, ...(tab === 'transactions' ? { background: theme.solid, color: '#fff' } : {}) }}
            onClick={() => setTab('transactions')}
          >
            Transaction History
          </button>
          {isStaff && (
            <button
              role="tab" aria-selected={tab === 'lifecycle'} className="hist-tab"
              style={{ ...s.tabBtn, ...(tab === 'lifecycle' ? { background: theme.solid, color: '#fff' } : {}) }}
              onClick={() => setTab('lifecycle')}
            >
              Article Lifecycle
            </button>
          )}
        </div>

        <div key={tab} className="hist-tabpanel">
          {tab === 'transactions' && <TransactionHistoryTab isStaff={isStaff} userRole={user.role} theme={theme} />}
          {tab === 'lifecycle' && isStaff && <ArticleLifecycleTab theme={theme} />}
        </div>
      </main>

      <footer style={s.footer}>
        2026 © <a href="/" style={s.footerLink}>Bahria University</a> — Sports Management Portal
      </footer>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab 1: Transaction History
// ─────────────────────────────────────────────────────────────────────────────
const OUTCOMES: Record<string, { label: string; color: string; bg: string }> = {
  COMPLETED: { label: 'Completed', color: '#1F7A45', bg: '#E6F4EC' },
  COMPLETED_LATE: { label: 'Completed — Late', color: '#9A6412', bg: '#FDF1E3' },
  COMPLETED_DAMAGED: { label: 'Completed — Damaged', color: '#8F2323', bg: '#FDECEC' },
  CANCELLED: { label: 'Cancelled', color: '#4A5A66', bg: '#ECEFF2' },
};
function OutcomeBadge({ outcome }: { outcome: string }) {
  const cfg = OUTCOMES[outcome] ?? { label: outcome, color: palette.muted, bg: '#EEF2F1' };
  return <span style={{ ...s.badge, color: cfg.color, background: cfg.bg }}>{cfg.label}</span>;
}
function KindBadge({ kind }: { kind: 'VENUE_SESSION' | 'EQUIPMENT_BORROW' }) {
  const isEquip = kind === 'EQUIPMENT_BORROW';
  return (
    <span style={{ ...s.badge, display: 'inline-flex', alignItems: 'center', gap: 4, color: isEquip ? '#1565C0' : '#6B21A8', background: isEquip ? '#E3F2FF' : '#F3E8FF' }}>
      {isEquip ? <EquipIcon /> : <VenueIcon />} {isEquip ? 'Equipment' : 'Venue'}
    </span>
  );
}

function TransactionHistoryTab({ isStaff, userRole, theme }: { isStaff: boolean; userRole: string; theme: (typeof ROLE_THEME)['student'] }) {
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
      const res = await listHistory(filter);
      setRows(res.history);
      setTotal(res.total);
      setError(null);
    } catch (e) { setError(errMsg(e)); }
    finally { setFetching(false); }
  }, [from, to, kind, outcome]);

  useEffect(() => { void load(page); }, [load, page]);

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
      {error && <div style={s.errBanner}>{error}</div>}

      <div style={s.filterCard}>
        <div style={s.filterGrid}>
          <FilterField label="From" icon={<CalIcon />}>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={s.input} />
          </FilterField>
          <FilterField label="To" icon={<CalIcon />}>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={s.input} />
          </FilterField>
          {userRole !== 'EXTERNAL' && (
            <FilterField label="Type" icon={<TagIcon />}>
              <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} style={s.input}>
                <option value="">All</option>
                <option value="EQUIPMENT_BORROW">Equipment</option>
                <option value="VENUE_SESSION">Venue</option>
              </select>
            </FilterField>
          )}
          <FilterField label="Outcome" icon={<FlagIcon />}>
            <select value={outcome} onChange={(e) => setOutcome(e.target.value)} style={s.input}>
              <option value="">All</option>
              <option value="COMPLETED">Completed</option>
              <option value="COMPLETED_LATE">Completed — Late</option>
              <option value="COMPLETED_DAMAGED">Completed — Damaged</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
          </FilterField>
          {isStaff && (
            <div style={{ gridColumn: '1 / -1' }}>
              <FilterField label="Search by name or equipment" icon={<SearchIcon />}>
                <input
                  type="search" placeholder="Filter by borrower, guest, equipment, or venue name…"
                  value={actorSearch} onChange={(e) => setActorSearch(e.target.value)} style={{ ...s.input, paddingLeft: 34 }}
                />
              </FilterField>
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
          <button type="button" className="hist-btn-primary" style={{ ...s.btnPrimary, background: theme.solid }} onClick={applyFilters}>Apply</button>
          <button type="button" className="hist-btn-secondary" style={s.btnSecondary} onClick={clearFilters}>Clear</button>
        </div>
      </div>

      <div style={s.countRow}>{fetching ? 'Loading…' : `${total} record${total !== 1 ? 's' : ''}`}</div>

      {visibleRows.length === 0 && !fetching ? (
        <EmptyState text="No usage history records match the current filters." />
      ) : (
        <div style={s.tableCard}>
          <div style={s.tableScroll}>
          <table style={{ ...s.table, minWidth: isStaff ? 640 : 520 }}>
            <thead>
              <tr>
                <th style={s.th}>Date</th>
                <th style={s.th}>Type</th>
                <th style={s.th}>Subject</th>
                {isStaff && <th style={s.th}>User</th>}
                <th style={s.th}>Outcome</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row, i) => (
                <tr key={row.historyId} className="hist-row" style={{ animationDelay: `${Math.min(i, 12) * 25}ms` }}>
                  <td style={s.td}>{fmtDate(row.occurredOn)}</td>
                  <td style={s.td}><KindBadge kind={row.kind} /></td>
                  <td style={s.td}>
                    <span style={{ fontWeight: 600, color: palette.ink }}>
                      {row.kind === 'EQUIPMENT_BORROW' ? (row.equipmentTypeName ?? '—') : (row.venueName ?? '—')}
                    </span>
                    {row.teamName && <span style={s.subtext}>{row.teamName}</span>}
                    {row.sportCategoryName && <span style={s.subtext}>· {row.sportCategoryName}</span>}
                    {row.enteredViaOfflineFallback && <span style={{ ...s.badge, background: '#F0E9FF', color: '#6B21A8', marginLeft: 8 }}>offline</span>}
                  </td>
                  {isStaff && (
                    <td style={s.td}>{row.borrowerName ?? (row.guestName ? `${row.guestName} (guest)` : '—')}</td>
                  )}
                  <td style={s.td}><OutcomeBadge outcome={row.outcome} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {totalPages > 1 && (
        <Pagination page={page} totalPages={totalPages} onPage={setPage} theme={theme} />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab 2: Article Lifecycle
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
  ARTICLE_ENTERED: '#1F7A45', ARTICLE_DECOMMISSIONED: '#B3352B', DAMAGE_FLAG_RAISED: '#B3352B',
  DAMAGE_FLAG_CLEARED: '#1F7A45', SCAN_RECORDED: '#0A6EBD', CONDITION_OVERRIDDEN: '#9A6412',
  TYPE_EDITED: '#5C6773', PAIR_FORMED: '#1F7A45', PAIR_DISSOLVED: '#9A6412',
};
const ACTION_BG: Record<string, string> = {
  ARTICLE_ENTERED: '#E6F4EC', ARTICLE_DECOMMISSIONED: '#FDECEC', DAMAGE_FLAG_RAISED: '#FDECEC',
  DAMAGE_FLAG_CLEARED: '#E6F4EC', SCAN_RECORDED: '#E3F2FF', CONDITION_OVERRIDDEN: '#FDF1E3',
  TYPE_EDITED: '#F4F5F6', PAIR_FORMED: '#E6F4EC', PAIR_DISSOLVED: '#FDF1E3',
};
const STATE_LABEL: Record<string, string> = {
  AVAILABLE: 'Available', ON_LOAN: 'On Loan', DAMAGED: 'Unavailable', DECOMMISSIONED: 'Decommissioned',
};
const stateBadgeStyle = (st: string) =>
  st === 'AVAILABLE' ? { background: '#E6F4EC', color: '#1F7A45' } :
  st === 'DAMAGED' ? { background: '#FDECEC', color: '#B3352B' } :
  st === 'DECOMMISSIONED' ? { background: '#F4F5F6', color: '#5C6773' } :
  { background: '#E3F2FF', color: '#1565C0' };
const condBadgeStyle = (c: string) =>
  c === 'GOOD' ? { background: '#E6F4EC', color: '#1F7A45' } :
  c === 'WORN' ? { background: '#FDF1E3', color: '#9A6412' } :
  { background: '#FDECEC', color: '#B3352B' };

function ArticleLifecycleTab({ theme }: { theme: (typeof ROLE_THEME)['student'] }) {
  const [allArticles, setAllArticles] = useState<Article[]>([]);
  const [articlesLoading, setArticlesLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [lifecycle, setLifecycle] = useState<ArticleLifecycle | null>(null);
  const [lifecycleLoading, setLifecycleLoading] = useState(false);
  const [lifecycleError, setLifecycleError] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<'timeline' | 'scans' | 'flags' | 'pairs'>('timeline');

  const LIST_PAGE = 20;
  const [listPage, setListPage] = useState(0);

  useEffect(() => {
    listArticles().then((r) => setAllArticles(r.articles)).catch(() => setAllArticles([])).finally(() => setArticlesLoading(false));
  }, []);

  const fuse = useMemo(() => new Fuse(allArticles, { keys: ['barcode', 'equipment_type_name'], threshold: 0.3, ignoreLocation: true }), [allArticles]);
  const dropdownResults = search.trim().length >= 1 ? fuse.search(search.trim()).slice(0, 10).map((r) => r.item) : [];
  const listResults = useMemo(
    () => (search.trim() && !selectedId ? fuse.search(search.trim()).map((r) => r.item) : allArticles),
    [search, selectedId, allArticles, fuse],
  );
  useEffect(() => { setListPage(0); }, [search]);
  const listTotalPages = Math.ceil(listResults.length / LIST_PAGE);
  const listPageItems = listResults.slice(listPage * LIST_PAGE, (listPage + 1) * LIST_PAGE);

  useEffect(() => {
    if (!selectedId) { setLifecycle(null); return; }
    setLifecycleLoading(true);
    setLifecycleError(null);
    setDetailTab('timeline');
    getArticleLifecycle(selectedId).then(setLifecycle).catch((e) => setLifecycleError(errMsg(e))).finally(() => setLifecycleLoading(false));
  }, [selectedId]);

  function selectArticle(a: Article) { setSelectedId(a.article_id); setSearch(`${a.barcode} — ${a.equipment_type_name}`); }
  function clearSelection() { setSearch(''); setSelectedId(null); setLifecycle(null); }

  const showDropdown = search.trim().length >= 1 && !selectedId && dropdownResults.length > 0;

  return (
    <div>
      <div style={s.filterCard}>
        <FilterField label="Search by barcode or equipment name" icon={<SearchIcon />}>
          <div style={{ position: 'relative' }}>
            <input
              type="search" style={{ ...s.input, paddingLeft: 34, fontSize: 14.5 }} placeholder="Type a barcode or equipment name…"
              value={search} onChange={(e) => { setSearch(e.target.value); setSelectedId(null); setLifecycle(null); }}
            />
            {selectedId && (
              <button type="button" onClick={clearSelection} style={s.clearX} aria-label="Clear selection"><CloseIcon /></button>
            )}
            {showDropdown && (
              <div style={s.dropdown}>
                {dropdownResults.map((a) => (
                  <button key={a.article_id} type="button" className="hist-dropitem" style={s.dropItemBtn} onClick={() => selectArticle(a)}>
                    <span style={s.mono}>{a.barcode}</span>
                    <span style={{ color: palette.muted, marginLeft: 8, fontSize: 13 }}>{a.equipment_type_name}</span>
                    <span style={{ ...s.badge, ...stateBadgeStyle(a.state), marginLeft: 'auto', fontSize: 11 }}>{STATE_LABEL[a.state] ?? a.state}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </FilterField>
        {!articlesLoading && !selectedId && (
          <p style={s.hint}>
            {search.trim()
              ? `${listResults.length} article${listResults.length !== 1 ? 's' : ''} matching "${search.trim()}" — click any row to view history.`
              : `${allArticles.length} active article${allArticles.length !== 1 ? 's' : ''} — click any row to view full lifecycle history, or search above.`}
          </p>
        )}
      </div>

      {lifecycleLoading && (
        <div style={s.tableCard}><div style={{ padding: '36px 24px', textAlign: 'center' }}><p style={s.muted}>Loading article history…</p></div></div>
      )}
      {lifecycleError && <div style={s.errBanner}>{lifecycleError}</div>}

      {lifecycle && !lifecycleLoading && (
        <div className="hist-card-anim" style={s.lifecycleCard}>
          <div style={{ ...s.lifecycleHeader, background: `linear-gradient(135deg, ${theme.from}, ${theme.to})` }}>
            <div style={{ flex: '1 1 220px' }}>
              <div style={{ ...s.mono, fontSize: 19, fontWeight: 700, color: '#fff', letterSpacing: '0.04em' }}>{lifecycle.article.barcode}</div>
              <div style={{ fontSize: 15.5, fontWeight: 600, color: '#fff', marginTop: 3 }}>{lifecycle.article.equipment_type_name}</div>
              <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                <span style={{ ...s.badge, ...stateBadgeStyle(lifecycle.article.state) }}>{STATE_LABEL[lifecycle.article.state] ?? lifecycle.article.state}</span>
                <span style={{ ...s.badge, ...condBadgeStyle(lifecycle.article.current_condition_label) }}>{lifecycle.article.current_condition_label}</span>
                <span style={{ ...s.badge, background: 'rgba(255,255,255,0.22)', color: '#fff' }}>{lifecycle.article.lending_unit === 'PAIR' ? 'Pair-lending' : 'Single'}</span>
              </div>
            </div>
            <div style={{ flex: '1 1 200px', display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end', color: 'rgba(255,255,255,0.9)' }}>
              <MetaLine label="Added" value={fmtDateTime(lifecycle.article.entered_at as unknown as string)} light />
              <MetaLine label="By" value={lifecycle.article.entered_by_name} light />
              {lifecycle.article.decommissioned_at && <>
                <MetaLine label="Decommissioned" value={fmtDateTime(lifecycle.article.decommissioned_at as unknown as string)} light danger />
                {lifecycle.article.decommissioned_by_name && <MetaLine label="By" value={lifecycle.article.decommissioned_by_name} light danger />}
              </>}
            </div>
          </div>

          <div style={s.statsRow}>
            {[
              { label: 'Audit Entries', value: lifecycle.auditLog.length, color: theme.solid, icon: <ListIconSvg /> },
              { label: 'Health Scans', value: lifecycle.scans.length, color: '#1565C0', icon: <ScanIcon /> },
              { label: 'Damage Flags', value: lifecycle.flags.length, color: lifecycle.flags.some((f) => !f.cleared_at) ? '#B3352B' : '#1F7A45', icon: <FlagIcon /> },
              { label: 'Pair Records', value: lifecycle.pairs.length, color: '#6B21A8', icon: <PairIcon /> },
            ].map((st) => (
              <div key={st.label} style={s.statCard}>
                <div style={{ ...s.statIcon, color: st.color, background: `${st.color}18` }}>{st.icon}</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: st.color, fontFamily: 'Poppins, sans-serif' }}>{st.value}</div>
                <div style={{ fontSize: 11, color: palette.muted, textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 700, marginTop: 2 }}>{st.label}</div>
              </div>
            ))}
          </div>

          <div style={s.detailTabRow}>
            {(['timeline', 'scans', 'flags', 'pairs'] as const).map((t) => (
              <button
                key={t} type="button" className="hist-detailtab"
                style={{ ...s.detailTabBtn, ...(detailTab === t ? { color: theme.solid, borderBottomColor: theme.solid } : {}) }}
                onClick={() => setDetailTab(t)}
              >
                {t === 'timeline' ? 'Audit Log' : t === 'scans' ? 'Health Scans' : t === 'flags' ? 'Damage Flags' : 'Pair History'}
              </button>
            ))}
          </div>

          <div key={detailTab} className="hist-tabpanel" style={s.detailBody}>
            {detailTab === 'timeline' && (
              lifecycle.auditLog.length === 0 ? <EmptyState text="No audit entries recorded yet." compact /> :
                lifecycle.auditLog.map((entry, i) => (
                  <div key={entry.log_id} style={{ display: 'flex', gap: 14, paddingBottom: 16, marginBottom: i < lifecycle.auditLog.length - 1 ? 16 : 0, borderBottom: i < lifecycle.auditLog.length - 1 ? `1px solid ${palette.line}` : 'none' }}>
                    <div style={{ flexShrink: 0, width: 34, height: 34, borderRadius: 10, background: ACTION_BG[entry.action] ?? '#F4F5F6', display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 2 }}>
                      <div style={{ width: 10, height: 10, borderRadius: '50%', background: ACTION_COLOR[entry.action] ?? '#5C6773' }} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 700, fontSize: 14, color: ACTION_COLOR[entry.action] ?? palette.ink }}>{ACTION_LABEL[entry.action] ?? entry.action}</span>
                        <span style={{ fontSize: 12, color: palette.muted, whiteSpace: 'nowrap' }}>{fmtDateTime(entry.occurred_at as unknown as string)}</span>
                      </div>
                      <div style={{ fontSize: 13, color: palette.muted, marginTop: 3 }}>
                        {entry.actor_name} · <span style={{ textTransform: 'capitalize' }}>{entry.actor_role.replace('_', ' ').toLowerCase()}</span>
                      </div>
                    </div>
                  </div>
                ))
            )}

            {detailTab === 'scans' && (
              lifecycle.scans.length === 0 ? <EmptyState text="No health scans recorded." compact /> : (
                <table style={{ ...s.table, minWidth: 560 }}>
                  <thead><tr><th style={s.th}>Date &amp; Time</th><th style={s.th}>Kind</th><th style={s.th}>Score</th><th style={s.th}>Condition</th><th style={s.th}>Performed By</th></tr></thead>
                  <tbody>
                    {lifecycle.scans.map((sc) => (
                      <tr key={sc.scan_id} className="hist-row">
                        <td style={s.td}>{fmtDateTime(sc.scanned_at as unknown as string)}</td>
                        <td style={s.td}>
                          <span style={{ ...s.badge, background: sc.kind === 'ENTRY' ? '#E3F2FF' : sc.kind === 'SCHEDULED' ? '#F3E8FF' : '#F4F5F6', color: sc.kind === 'ENTRY' ? '#1565C0' : sc.kind === 'SCHEDULED' ? '#6B21A8' : '#5C6773' }}>
                            {sc.kind === 'ENTRY' ? 'Entry' : sc.kind === 'SCHEDULED' ? 'Scheduled' : 'Ad-hoc'}
                          </span>
                        </td>
                        <td style={s.td}><span style={{ ...s.mono, fontWeight: 700, fontSize: 15 }}>{Number(sc.health_score).toFixed(0)}</span><span style={{ color: palette.muted, fontSize: 12 }}>/100</span></td>
                        <td style={s.td}><span style={{ ...s.badge, ...condBadgeStyle(sc.resulting_label) }}>{sc.resulting_label}</span></td>
                        <td style={s.td}>{sc.scanned_by_name}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            )}

            {detailTab === 'flags' && (
              lifecycle.flags.length === 0 ? <EmptyState text="No damage flags on record." compact /> : (
                <table style={{ ...s.table, minWidth: 560 }}>
                  <thead><tr><th style={s.th}>Raised</th><th style={s.th}>Raised By</th><th style={s.th}>Status</th><th style={s.th}>Cleared</th><th style={s.th}>Cleared By</th><th style={s.th}>Final Condition</th></tr></thead>
                  <tbody>
                    {lifecycle.flags.map((f) => (
                      <tr key={f.flag_id} className="hist-row">
                        <td style={s.td}>{fmtDateTime(f.raised_at as unknown as string)}</td>
                        <td style={s.td}>{f.raised_by_system ? <span style={{ color: palette.muted }}>System (auto)</span> : (f.raised_by_name ?? '—')}</td>
                        <td style={s.td}>{f.cleared_at ? <span style={{ ...s.badge, background: '#E6F4EC', color: '#1F7A45' }}>Cleared</span> : <span style={{ ...s.badge, background: '#FDECEC', color: '#B3352B' }}>Open</span>}</td>
                        <td style={s.td}>{f.cleared_at ? fmtDateTime(f.cleared_at as unknown as string) : '—'}</td>
                        <td style={s.td}>{f.cleared_by_name ?? '—'}</td>
                        <td style={s.td}>{f.cleared_with_label ? <span style={{ ...s.badge, ...condBadgeStyle(f.cleared_with_label) }}>{f.cleared_with_label}</span> : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            )}

            {detailTab === 'pairs' && (
              lifecycle.pairs.length === 0 ? <EmptyState text="No pair history for this article." compact /> : (
                <table style={{ ...s.table, minWidth: 620 }}>
                  <thead><tr><th style={s.th}>Partner</th><th style={s.th}>Paired On</th><th style={s.th}>Paired By</th><th style={s.th}>Status</th><th style={s.th}>Dissolved</th><th style={s.th}>Reason</th></tr></thead>
                  <tbody>
                    {lifecycle.pairs.map((p) => {
                      const partnerId = p.article_a_id === lifecycle.article.article_id ? p.article_b_id : p.article_a_id;
                      return (
                        <tr key={p.pair_id} className="hist-row">
                          <td style={{ ...s.td, ...s.mono, fontSize: 13 }}>{partnerId.slice(0, 8)}…</td>
                          <td style={s.td}>{fmtDateTime(p.formed_at as unknown as string)}</td>
                          <td style={s.td}>{p.formed_by_name ?? '—'}</td>
                          <td style={s.td}>{!p.dissolved_at ? <span style={{ ...s.badge, background: '#E6F4EC', color: '#1F7A45' }}>Active</span> : <span style={{ ...s.badge, background: '#F4F5F6', color: '#5C6773' }}>Dissolved</span>}</td>
                          <td style={s.td}>{p.dissolved_at ? fmtDateTime(p.dissolved_at as unknown as string) : '—'}</td>
                          <td style={s.td}>{p.dissolution_reason ?? '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )
            )}
          </div>
        </div>
      )}

      {!selectedId && (
        <div>
          {!articlesLoading && listResults.length > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <span style={s.countRow}>{search.trim() ? `${listResults.length} result${listResults.length !== 1 ? 's' : ''}` : `${allArticles.length} article${allArticles.length !== 1 ? 's' : ''}`}</span>
              {listTotalPages > 1 && <Pagination page={listPage} totalPages={listTotalPages} onPage={setListPage} theme={theme} compact />}
            </div>
          )}

          {articlesLoading && <EmptyState text="Loading articles…" compact />}
          {!articlesLoading && listResults.length === 0 && search.trim() && <EmptyState text={`No articles match "${search.trim()}".`} />}

          {!articlesLoading && listPageItems.length > 0 && (
            <div style={s.tableCard}>
              <div style={s.tableScroll}>
              <table style={{ ...s.table, minWidth: 640 }}>
                <thead>
                  <tr><th style={s.th}>Barcode</th><th style={s.th}>Equipment Type</th><th style={s.th}>Unit</th><th style={s.th}>Condition</th><th style={s.th}>State</th><th style={s.th}>Added</th></tr>
                </thead>
                <tbody>
                  {listPageItems.map((a, i) => (
                    <tr key={a.article_id} className="hist-row hist-row-click" style={{ animationDelay: `${Math.min(i, 12) * 20}ms` }} onClick={() => selectArticle(a)} title="Click to view full history">
                      <td style={{ ...s.td, ...s.mono, fontWeight: 700, letterSpacing: '0.03em' }}>{a.barcode}</td>
                      <td style={s.td}>{a.equipment_type_name}</td>
                      <td style={s.td}><span style={{ ...s.badge, background: '#F4F5F6', color: '#5C6773' }}>{a.lending_unit === 'PAIR' ? 'Pair' : 'Single'}</span></td>
                      <td style={s.td}><span style={{ ...s.badge, ...condBadgeStyle(a.current_condition_label) }}>{a.current_condition_label}</span></td>
                      <td style={s.td}><span style={{ ...s.badge, ...stateBadgeStyle(a.state) }}>{STATE_LABEL[a.state] ?? a.state}</span></td>
                      <td style={{ ...s.td, color: palette.muted, fontSize: 13 }}>{fmtDate(a.entered_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </div>
          )}

          {!articlesLoading && listTotalPages > 1 && (
            <div style={{ marginTop: 14 }}><Pagination page={listPage} totalPages={listTotalPages} onPage={setListPage} theme={theme} /></div>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------- small shared pieces ---------- */
function FilterField({ label, icon, children }: { label: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <label style={s.fieldLabel}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>{icon}{label}</span>
      {children}
    </label>
  );
}
function MetaLine({ label, value, light, danger }: { label: string; value: string; light?: boolean; danger?: boolean }) {
  return (
    <div style={{ fontSize: 13, display: 'flex', gap: 6, alignItems: 'baseline', color: danger ? '#FFD9D9' : light ? 'rgba(255,255,255,0.9)' : palette.muted }}>
      <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 700, opacity: 0.85 }}>{label}</span>{value}
    </div>
  );
}
function EmptyState({ text, compact }: { text: string; compact?: boolean }) {
  return (
    <div style={{ ...s.emptyState, padding: compact ? '18px 4px' : '36px 24px' }}>
      <div style={s.emptyIcon}><InboxIcon /></div>
      <p style={s.muted}>{text}</p>
    </div>
  );
}
function Pagination({ page, totalPages, onPage, theme, compact }: { page: number; totalPages: number; onPage: (p: number) => void; theme: (typeof ROLE_THEME)['student']; compact?: boolean }) {
  return (
    <div style={{ ...s.pagination, ...(compact ? { justifyContent: 'flex-end', marginTop: 0 } : {}) }}>
      <button type="button" className="hist-navbtn" style={s.navBtn} disabled={page === 0} onClick={() => onPage(page - 1)}><ChevronLeftIcon /></button>
      <span style={{ fontSize: 13, fontWeight: 700, color: palette.ink }}>Page {page + 1} of {totalPages}</span>
      <button type="button" className="hist-navbtn" style={s.navBtn} disabled={page >= totalPages - 1} onClick={() => onPage(page + 1)}><ChevronRightIcon /></button>
    </div>
  );
}

/* ---------- styles injected for animation/hover/responsive (can't be done with inline styles) ---------- */
function HistStyles() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@600;700;800&family=Inter:wght@400;500;600;700&display=swap');
      .auth-ui { font-family: 'Inter', 'Segoe UI', system-ui, sans-serif; }
      .hist-topbtn { transition: background-color .15s ease, border-color .15s ease, color .15s ease; text-decoration: none; }
      .hist-topbtn:hover { background: #F1F5F3; }
      .hist-signout:hover { background: #FDECEC; border-color: #F3CACA; color: #8F2323; }
      .hist-tab { transition: background-color .15s ease, color .15s ease; }
      .hist-tabpanel { animation: histFade .25s ease both; }
      @keyframes histFade { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
      .hist-card-anim { animation: histCardIn .35s ease both; }
      @keyframes histCardIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
      .hist-row { animation: histRowIn .3s ease both; transition: background-color .12s ease; }
      @keyframes histRowIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
      .hist-row:hover { background: ${palette.mint50}; }
      .hist-row-click { cursor: pointer; }
      .hist-btn-primary { transition: filter .15s ease, transform .15s ease; }
      .hist-btn-primary:hover { filter: brightness(1.08); transform: translateY(-1px); }
      .hist-btn-secondary { transition: background-color .15s ease, border-color .15s ease; }
      .hist-btn-secondary:hover { background: #F1F5F3; }
      .hist-navbtn { transition: background-color .15s ease, opacity .15s ease; }
      .hist-navbtn:hover:not(:disabled) { background: #F1F5F3; }
      .hist-navbtn:disabled { opacity: 0.4; cursor: not-allowed; }
      .hist-detailtab { transition: color .15s ease, border-color .15s ease; }
      .hist-detailtab:hover { color: ${palette.navy}; }
      .hist-dropitem { transition: background-color .12s ease; }
      .hist-dropitem:hover { background: ${palette.mint50}; }
      input[type="date"]::-webkit-calendar-picker-indicator { opacity: 0.6; cursor: pointer; }
      @media (max-width: 720px) {
        .hist-filtergrid-mq { grid-template-columns: 1fr !important; }
      }
      @media (prefers-reduced-motion: reduce) {
        .hist-tabpanel, .hist-card-anim, .hist-row { animation: none !important; opacity: 1 !important; }
      }
    `}</style>
  );
}

/* ---------- icons ---------- */
function BackIcon() { return <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M9.5 3 4 8l5.5 5M4.5 8H14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>; }
function SignOutIcon() { return <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M6.5 2H3.5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><path d="M10.5 5 14 8l-3.5 3M14 8H6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>; }
function ChevronLeftIcon() { return <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M10 3 5.5 8l4.5 5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>; }
function ChevronRightIcon() { return <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M6 3l4.5 5L6 13" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>; }
function CloseIcon() { return <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 3l10 10M13 3 3 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>; }
function SearchIcon() { return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>; }
function CalIcon() { return <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><rect x="4" y="5.5" width="16" height="14.5" rx="1.8" stroke="currentColor" strokeWidth="1.8"/><path d="M4 9.5h16M8 3.5v4M16 3.5v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>; }
function TagIcon() { return <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M3.5 12.5 12 4h7.5v7.5L11 20.5a1.5 1.5 0 0 1-2.1 0l-5.4-5.4a1.5 1.5 0 0 1 0-2.1z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/><circle cx="16" cy="8" r="1.4" fill="currentColor"/></svg>; }
function FlagIcon() { return <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M5 3v18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/><path d="M5 4.5h11l-2.5 4L16 12.5H5V4.5z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/></svg>; }
function EquipIcon() { return <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M14.7 6.3a3.6 3.6 0 0 1-4.9 4.4L4.5 16l1.9 1.9 5.4-5.3a3.6 3.6 0 0 1 4.4-4.9l-1.9 1.9-1.6-1.6 1.9-1.9z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/></svg>; }
function VenueIcon() { return <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M12 21s7-6.4 7-11.5a7 7 0 1 0-14 0C5 14.6 12 21 12 21z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/><circle cx="12" cy="9.3" r="2.2" stroke="currentColor" strokeWidth="1.6"/></svg>; }
function InboxIcon() { return <svg width="26" height="26" viewBox="0 0 24 24" fill="none"><path d="M4 12h4l1.5 3h5L16 12h4" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/><path d="M4 12V7a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v5M4 12v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/></svg>; }
function ListIconSvg() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M4 6.5h16M4 12h16M4 17.5h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>; }
function ScanIcon() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/><path d="M4 12h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>; }
function PairIcon() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="8.5" cy="12" r="4" stroke="currentColor" strokeWidth="1.7"/><circle cx="15.5" cy="12" r="4" stroke="currentColor" strokeWidth="1.7"/></svg>; }

/* ---------- style objects ---------- */
const s = {
  page: {
    minHeight: '100%', display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden',
    background: `radial-gradient(1200px 600px at 10% -10%, ${palette.sky100} 0%, transparent 55%),
                 radial-gradient(1000px 600px at 100% 0%, ${palette.mint100} 0%, transparent 55%),
                 ${palette.mint50}`,
  } as const,
  heroBlobA: { position: 'absolute', width: 340, height: 340, borderRadius: '50%', background: `${palette.teal}22`, top: -120, left: -100, filter: 'blur(10px)', pointerEvents: 'none' } as const,
  heroBlobB: { position: 'absolute', width: 300, height: 300, borderRadius: '50%', background: `${palette.navy}18`, bottom: -140, right: -80, filter: 'blur(10px)', pointerEvents: 'none' } as const,
  topbar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 32px', borderBottom: `1px solid ${palette.line}` } as const,
  brand: { display: 'flex', alignItems: 'center', gap: 10 } as const,
  logoMark: { width: 30, height: 30, borderRadius: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontFamily: 'Poppins, sans-serif', fontWeight: 800, fontSize: 12 } as const,
  wordmark: { fontFamily: 'Poppins, serif', fontSize: 16.5, fontWeight: 600, color: palette.navy } as const,
  topbarRight: { display: 'flex', gap: 8 } as const,
  topBtn: { display: 'inline-flex', alignItems: 'center', gap: 6, background: '#fff', color: palette.muted, border: `1.5px solid ${palette.line}`, borderRadius: 999, padding: '7px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'none' } as const,
  main: { flex: 1, padding: '28px 28px 40px', maxWidth: 1040, width: '100%', margin: '0 auto' } as const,
  headRow: { marginBottom: 18 } as const,
  eyebrow: { display: 'inline-block', fontSize: 11.5, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', padding: '5px 12px', borderRadius: 999, marginBottom: 10 } as const,
  title: { fontFamily: 'Poppins, sans-serif', fontSize: 26, fontWeight: 700, color: palette.navy, margin: 0 } as const,
  tabRow: { display: 'flex', gap: 4, padding: 4, background: '#fff', border: `1.5px solid ${palette.line}`, borderRadius: 12, marginBottom: 20, width: 'fit-content' } as const,
  tabBtn: { fontSize: 13.5, fontWeight: 700, padding: '9px 18px', border: 'none', background: 'transparent', color: palette.muted, borderRadius: 9, cursor: 'pointer', fontFamily: 'inherit' } as const,
  errBanner: { background: '#FDECEC', color: '#8F2323', border: '1px solid #F3CACA', borderRadius: 12, padding: '11px 14px', fontSize: 13.5, marginBottom: 16 } as const,
  filterCard: { background: '#fff', border: `1px solid ${palette.line}`, borderRadius: 16, padding: '18px 20px', marginBottom: 18, boxShadow: '0 14px 32px -26px rgba(11,55,84,0.35)' } as const,
  filterGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '14px 16px' } as const,
  fieldLabel: { display: 'flex', flexDirection: 'column', gap: 6, fontSize: 11.5, fontWeight: 700, color: palette.muted, textTransform: 'uppercase', letterSpacing: '0.04em' } as const,
  input: { fontSize: 14, padding: '9px 12px', borderRadius: 10, border: `1.5px solid ${palette.line}`, background: palette.mint50, color: palette.ink, width: '100%', boxSizing: 'border-box', fontFamily: 'inherit' } as const,
  clearX: { position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: palette.muted, display: 'flex' } as const,
  btnPrimary: { fontSize: 13.5, fontWeight: 700, padding: '9px 22px', color: '#fff', border: 'none', borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit' } as const,
  btnSecondary: { fontSize: 13.5, fontWeight: 700, padding: '9px 16px', background: '#fff', color: palette.muted, border: `1.5px solid ${palette.line}`, borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit' } as const,
  countRow: { fontSize: 13, color: palette.muted, marginBottom: 10, fontWeight: 600 } as const,
  tableCard: { background: '#fff', border: `1px solid ${palette.line}`, borderRadius: 16, overflow: 'hidden', boxShadow: '0 14px 32px -26px rgba(11,55,84,0.35)' } as const,
  tableScroll: { overflowX: 'auto' } as const,
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13.5 } as const,
  th: { textAlign: 'left', font: '700 11px Inter, sans-serif', color: palette.muted, textTransform: 'uppercase', letterSpacing: '0.04em', padding: '12px 16px', borderBottom: `1px solid ${palette.line}`, background: palette.mint50 } as const,
  td: { padding: '11px 16px', borderBottom: `1px solid #EEF2F1`, color: palette.ink, verticalAlign: 'middle' } as const,
  subtext: { color: palette.muted, fontSize: 12, marginLeft: 6 } as const,
  badge: { display: 'inline-block', fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999 } as const,
  mono: { fontFamily: "'JetBrains Mono', ui-monospace, monospace" } as const,
  muted: { color: palette.muted, fontSize: 14, margin: 0 } as const,
  hint: { color: palette.muted, fontSize: 12.5, marginTop: 8, marginBottom: 0 } as const,
  pagination: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, marginTop: 18 } as const,
  navBtn: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, borderRadius: 9, border: `1.5px solid ${palette.line}`, background: '#fff', color: palette.navy, cursor: 'pointer' } as const,
  dropdown: { position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0, zIndex: 200, background: '#fff', border: `1px solid ${palette.line}`, borderRadius: 12, boxShadow: '0 18px 40px -20px rgba(11,55,84,0.4)', maxHeight: 280, overflowY: 'auto' } as const,
  dropItemBtn: { width: '100%', display: 'flex', alignItems: 'center', gap: 4, padding: '10px 14px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', borderBottom: `1px solid ${palette.mint50}`, fontSize: 14, color: palette.ink, fontFamily: 'inherit' } as const,
  emptyState: { display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 8 } as const,
  emptyIcon: { color: palette.muted, opacity: 0.6 } as const,
  lifecycleCard: { background: '#fff', border: `1px solid ${palette.line}`, borderRadius: 18, overflow: 'hidden', boxShadow: '0 18px 40px -28px rgba(11,55,84,0.4)', marginBottom: 20 } as const,
  lifecycleHeader: { display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16, padding: '22px 26px' } as const,
  statsRow: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', borderBottom: `1px solid ${palette.line}` } as const,
  statCard: { padding: '18px 12px', textAlign: 'center', borderRight: `1px solid #EEF2F1`, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 } as const,
  statIcon: { width: 34, height: 34, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' } as const,
  detailTabRow: { display: 'flex', borderBottom: `1px solid ${palette.line}`, background: palette.mint50, overflowX: 'auto' } as const,
  detailTabBtn: { flex: 1, fontSize: 13, fontWeight: 700, padding: '12px 8px', border: 'none', borderBottom: '2px solid transparent', background: 'transparent', color: palette.muted, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' } as const,
  detailBody: { padding: '20px 24px', overflowX: 'auto' } as const,
  footer: { textAlign: 'center', padding: '20px 24px', fontSize: 12.5, color: palette.muted, borderTop: `1px solid ${palette.line}` } as const,
  footerLink: { color: palette.navy, textDecoration: 'none', fontWeight: 600 } as const,
};
