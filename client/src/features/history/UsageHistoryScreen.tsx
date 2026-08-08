/**
 * Usage History (Feature 10 — HIST-01..16).
 *
 * Role behaviour:
 *  - SUPER_ADMIN / COORDINATOR: full history, all users. Can filter by a
 *    specific user (HIST-13).
 *  - STUDENT: own history only — all kinds (HIST-08).
 *  - EXTERNAL: own history only — VENUE_SESSION only (HIST-09).
 *
 * Defaults to reverse-chronological (HIST-14). Filterable by date range,
 * kind, outcome, and sport category (HIST-12).
 */
import { useEffect, useState, useCallback } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth.js';
import { PortalShell } from '../auth/PortalShell.js';
import { listHistory, type HistoryRow, type HistoryFilter } from './api.js';
import { ApiRequestError } from '../../lib/api.js';

function errMsg(e: unknown) {
  return e instanceof ApiRequestError ? e.body.error : 'Something went wrong.';
}

const PAGE_SIZE = 30;

const OUTCOMES: Record<string, { label: string; style: React.CSSProperties }> = {
  COMPLETED: { label: 'Completed', style: { background: '#e6f4ec', color: '#1f7a45' } },
  COMPLETED_LATE: { label: 'Completed — Late', style: { background: '#fdf1e3', color: '#9a6412' } },
  COMPLETED_DAMAGED: { label: 'Completed — Damaged', style: { background: '#fdecec', color: '#8f2323' } },
  CANCELLED: { label: 'Cancelled', style: { background: '#eceff2', color: '#566' } },
};

function OutcomeBadge({ outcome }: { outcome: string }) {
  const cfg = OUTCOMES[outcome];
  return (
    <span style={{ ...badgeBase, ...(cfg?.style ?? { background: '#eceff2', color: '#566' }) }}>
      {cfg?.label ?? outcome}
    </span>
  );
}

function KindBadge({ kind }: { kind: 'VENUE_SESSION' | 'EQUIPMENT_BORROW' }) {
  return (
    <span style={{ ...badgeBase, ...(kind === 'EQUIPMENT_BORROW' ? kindBadge.borrow : kindBadge.venue) }}>
      {kind === 'EQUIPMENT_BORROW' ? 'Equipment' : 'Venue'}
    </span>
  );
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function actorLabel(row: HistoryRow) {
  if (row.borrowerName) return row.borrowerName;
  if (row.guestName) return `${row.guestName} (guest)`;
  return '—';
}

function subjectLabel(row: HistoryRow) {
  if (row.kind === 'EQUIPMENT_BORROW') return row.equipmentTypeName ?? '—';
  return row.venueName ?? '—';
}

export default function UsageHistoryScreen() {
  const { user, loading } = useAuth();
  const isStaff = user?.role === 'SUPER_ADMIN' || user?.role === 'COORDINATOR';

  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [fetching, setFetching] = useState(false);

  // filters
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [kind, setKind] = useState<'' | 'VENUE_SESSION' | 'EQUIPMENT_BORROW'>('');
  const [outcome, setOutcome] = useState('');
  const [actorUserId, setActorUserId] = useState('');

  const load = useCallback(async (pg: number) => {
    setFetching(true);
    try {
      const filter: HistoryFilter = {
        limit: PAGE_SIZE,
        offset: pg * PAGE_SIZE,
      };
      if (from) filter.from = from;
      if (to) filter.to = to;
      if (kind) filter.kind = kind;
      if (outcome) filter.outcome = outcome;
      if (isStaff && actorUserId.trim()) filter.actorUserId = actorUserId.trim();

      const res = await listHistory(filter);
      setRows(res.history);
      setTotal(res.total);
      setError(null);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setFetching(false);
    }
  }, [from, to, kind, outcome, actorUserId, isStaff]);

  useEffect(() => {
    if (!loading && user) { void load(page); }
  }, [load, loading, user, page]);

  if (loading) return <PortalShell title="Usage History"><p /></PortalShell>;
  if (!user) return <Navigate to="/" replace />;

  const totalPages = Math.ceil(total / PAGE_SIZE);

  function applyFilters() {
    setPage(0);
    void load(0);
  }

  function clearFilters() {
    setFrom(''); setTo(''); setKind(''); setOutcome(''); setActorUserId('');
    setPage(0);
  }

  const tint = isStaff ? 'navy' as const : user.role === 'EXTERNAL' ? 'blue' as const : 'sage' as const;

  return (
    <PortalShell title="Usage History" tint={tint}>
      <div style={wrap}>
        {error && <div style={box.err}>{error}</div>}

        {/* ── Filters ── */}
        <div style={filterPanel}>
          <div style={filterGrid}>
            <label style={label}>From
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={input} />
            </label>
            <label style={label}>To
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={input} />
            </label>
            {/* External only sees VENUE_SESSION; hide kind filter for them */}
            {user.role !== 'EXTERNAL' && (
              <label style={label}>Type
                <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} style={input}>
                  <option value="">All</option>
                  <option value="EQUIPMENT_BORROW">Equipment</option>
                  <option value="VENUE_SESSION">Venue</option>
                </select>
              </label>
            )}
            <label style={label}>Outcome
              <select value={outcome} onChange={(e) => setOutcome(e.target.value)} style={input}>
                <option value="">All</option>
                <option value="COMPLETED">Completed</option>
                <option value="COMPLETED_LATE">Completed — Late</option>
                <option value="COMPLETED_DAMAGED">Completed — Damaged</option>
                <option value="CANCELLED">Cancelled</option>
              </select>
            </label>
            {/* HIST-13: staff can filter by specific user ID */}
            {isStaff && (
              <label style={{ ...label, gridColumn: '1 / -1' }}>User ID (staff filter)
                <input
                  type="text"
                  placeholder="Paste a user UUID to scope results"
                  value={actorUserId}
                  onChange={(e) => setActorUserId(e.target.value)}
                  style={input}
                />
              </label>
            )}
          </div>
          <div style={filterActions}>
            <button style={btnApply} onClick={applyFilters}>Apply</button>
            <button style={btnClear} onClick={clearFilters}>Clear</button>
          </div>
        </div>

        {/* ── Results count ── */}
        <div style={countRow}>
          {fetching ? 'Loading…' : `${total} record${total !== 1 ? 's' : ''}`}
        </div>

        {/* ── Table ── */}
        {rows.length === 0 && !fetching ? (
          <p style={muted}>No usage history records match the current filters.</p>
        ) : (
          <table style={table}>
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
              {rows.map((row) => (
                <tr key={row.historyId} style={trStyle}>
                  <td style={td}>{fmtDate(row.occurredOn)}</td>
                  <td style={td}><KindBadge kind={row.kind} /></td>
                  <td style={td}>
                    <span style={{ fontWeight: 500 }}>{subjectLabel(row)}</span>
                    {row.teamName && <span style={{ color: '#8a949f', fontSize: 12, marginLeft: 6 }}>{row.teamName}</span>}
                    {row.sportCategoryName && <span style={{ color: '#8a949f', fontSize: 12, marginLeft: 6 }}>· {row.sportCategoryName}</span>}
                    {row.enteredViaOfflineFallback && <span style={{ ...badgeBase, background: '#f0e9ff', color: '#6b21a8', marginLeft: 8 }}>offline</span>}
                  </td>
                  {isStaff && <td style={td}>{actorLabel(row)}</td>}
                  <td style={td}><OutcomeBadge outcome={row.outcome} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* ── Pagination ── */}
        {totalPages > 1 && (
          <div style={paginationRow}>
            <button style={btnPage} disabled={page === 0} onClick={() => setPage((p) => p - 1)}>← Prev</button>
            <span style={pageLabel}>Page {page + 1} of {totalPages}</span>
            <button style={btnPage} disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)}>Next →</button>
          </div>
        )}
      </div>
    </PortalShell>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const wrap: React.CSSProperties = { maxWidth: 960, margin: '0 auto' };

const filterPanel: React.CSSProperties = {
  background: '#f8f9fa',
  border: '1px solid #e5e7eb',
  borderRadius: 6,
  padding: '16px 18px',
  marginBottom: 18,
};
const filterGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
  gap: '12px 16px',
  marginBottom: 12,
};
const filterActions: React.CSSProperties = { display: 'flex', gap: 8 };

const label: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 4,
  font: '600 12px var(--font-body)', color: '#555', textTransform: 'uppercase', letterSpacing: '0.04em',
};
const input: React.CSSProperties = {
  font: '14px var(--font-body)', padding: '7px 10px',
  border: '1px solid #ccc', borderRadius: 4, background: '#fff',
};
const btnApply: React.CSSProperties = {
  font: '600 13px var(--font-body)', padding: '7px 18px',
  background: '#26485f', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer',
};
const btnClear: React.CSSProperties = {
  font: '600 13px var(--font-body)', padding: '7px 14px',
  background: '#fff', color: '#666', border: '1px solid #ccc', borderRadius: 4, cursor: 'pointer',
};

const countRow: React.CSSProperties = {
  font: '13px var(--font-body)', color: '#8a949f', marginBottom: 10,
};

const table: React.CSSProperties = {
  width: '100%', borderCollapse: 'collapse', fontSize: 14,
  background: '#fff', border: '1px solid #ddd', borderRadius: 4,
};
const th: React.CSSProperties = {
  textAlign: 'left', font: '600 11px var(--font-body)', color: '#888',
  textTransform: 'uppercase', letterSpacing: '0.04em',
  padding: '10px 12px', borderBottom: '1px solid #e5e5e5',
};
const td: React.CSSProperties = { padding: '10px 12px', borderBottom: '1px solid #eee', color: '#333' };
const trStyle: React.CSSProperties = { verticalAlign: 'middle' };

const muted: React.CSSProperties = { color: '#5c6773', fontSize: 14.5 };

const badgeBase: React.CSSProperties = {
  display: 'inline-block',
  font: '600 11px var(--font-mono)', padding: '2px 7px', borderRadius: 4,
};
const kindBadge = {
  borrow: { background: '#e3f2ff', color: '#1565c0' } as React.CSSProperties,
  venue: { background: '#f3e8ff', color: '#6b21a8' } as React.CSSProperties,
};

const paginationRow: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  gap: 16, marginTop: 18,
};
const btnPage: React.CSSProperties = {
  font: '13px var(--font-body)', padding: '6px 14px',
  background: '#fff', border: '1px solid #ccc', borderRadius: 4,
  cursor: 'pointer', color: '#333',
};
const pageLabel: React.CSSProperties = { font: '13px var(--font-body)', color: '#666' };

const box = {
  err: {
    background: '#fdecec', color: '#8f2323',
    border: '1px solid #f3caca', borderRadius: 4,
    padding: '10px 14px', marginBottom: 16, fontSize: 14,
  } as React.CSSProperties,
};
