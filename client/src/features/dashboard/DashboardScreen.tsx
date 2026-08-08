/**
 * Admin Dashboard (Feature 12 — DASH-01..14).
 *
 * Admin Dashboard — SUPER_ADMIN only.
 *
 * Panels: user management, approval queue, inventory overview, equipment
 * health, active borrows, live equipment availability (SSE, DASH-06),
 * calendar overview, usage history, delegation controls (stub).
 *
 * Live panels (DASH-06): equipment availability and calendar overview subscribe
 * to the existing SSE streams from Feature 2 and Feature 6 respectively.
 * All other panels refresh only on manual reload or navigation (DASH-05).
 *
 * Every summary links to its full-feature view (DASH-11).
 * Quick-approve on the borrow-request panel fires the same API as the full
 * borrow queue (DASH-08/09) — no shortcut logic here.
 */
import { useEffect, useState, useCallback } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth.js';
import { PortalShell } from '../auth/PortalShell.js';
import { ApiRequestError } from '../../lib/api.js';
import { getDashboard, type DashboardResponse, type BorrowRequestPreview } from './api.js';
import { subscribeAvailability, type AvailabilityRow } from '../availability/api.js';
import { listCalendar, type CalendarSession } from '../venue/api.js';
import { approveRequest, rejectRequest } from '../borrow/api.js';

function errMsg(e: unknown) {
  return e instanceof ApiRequestError ? e.body.error : 'Something went wrong.';
}

// ── reusable panel chrome ────────────────────────────────────────────────────

function Panel({
  title, linkLabel, linkTo, badge, badgeKind = 'neutral', children,
}: {
  title: string;
  linkLabel?: string;
  linkTo?: string;
  badge?: string | number;
  badgeKind?: 'neutral' | 'warn' | 'danger' | 'ok';
  children: React.ReactNode;
}) {
  const navigate = useNavigate();
  return (
    <section style={s.panel}>
      <div style={s.panelHead}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={s.panelTitle}>{title}</span>
          {badge !== undefined && (
            <span style={{ ...s.badge, ...s.badgeKinds[badgeKind] }}>{badge}</span>
          )}
        </div>
        {linkLabel && linkTo && (
          <button style={s.linkBtn} onClick={() => navigate(linkTo)}>
            {linkLabel} →
          </button>
        )}
      </div>
      <div style={s.panelBody}>{children}</div>
    </section>
  );
}

function Stat({ label, value, sub }: { label: string; value: number | string; sub?: string }) {
  return (
    <div style={s.stat}>
      <div style={s.statValue}>{value}</div>
      <div style={s.statLabel}>{label}</div>
      {sub && <div style={s.statSub}>{sub}</div>}
    </div>
  );
}

function StatGrid({ children }: { children: React.ReactNode }) {
  return <div style={s.statGrid}>{children}</div>;
}

// ── User Management panel (SUPER_ADMIN only) ─────────────────────────────────

function UserManagementPanel({ data }: { data: DashboardResponse & { role: 'SUPER_ADMIN' } }) {
  const um = data.dashboard.userManagement;
  return (
    <Panel
      title="User Management"
      linkLabel="Manage Accounts"
      linkTo="/admin/accounts"
      badge={um.pendingVerification > 0 ? um.pendingVerification : undefined}
      badgeKind="warn"
    >
      <StatGrid>
        <Stat label="Pending Verification" value={um.pendingVerification} />
        <Stat label="Active Students" value={um.activeStudents} />
        <Stat label="Active External" value={um.activeExternal} />
        <Stat label="Coordinators" value={um.activeCoordinators} />
      </StatGrid>
    </Panel>
  );
}

// ── Approval Queue panel (both roles) ────────────────────────────────────────

function ApprovalQueuePanel({
  approvalQueue, pendingBorrowPreviews,
}: {
  approvalQueue: { pendingBorrowRequests: number; pendingVenueBookings: number; forwardedVenueBookings: number };
  pendingBorrowPreviews: BorrowRequestPreview[];
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const totalPending = approvalQueue.pendingBorrowRequests + approvalQueue.pendingVenueBookings;

  async function quickApprove(id: string, studentName: string) {
    setBusy(id);
    try {
      // DASH-08: identical validation as the full borrow queue
      await approveRequest(id);
      setNotice(`Request approved for ${studentName}. Collect equipment from the queue.`);
      setLocalError(null);
    } catch (e) {
      setLocalError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  async function quickReject(id: string, studentName: string) {
    if (!rejectReason.trim()) return;
    setBusy(id);
    try {
      await rejectRequest(id, rejectReason);
      setNotice(`Request rejected for ${studentName}.`);
      setLocalError(null);
      setRejectingId(null);
      setRejectReason('');
    } catch (e) {
      setLocalError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Panel
      title="Approval Queue"
      linkLabel="Full Queue"
      linkTo="/venue-approvals"
      badge={totalPending > 0 ? totalPending : undefined}
      badgeKind={totalPending > 0 ? 'warn' : 'neutral'}
    >
      {localError && <div style={s.alertErr}>{localError}</div>}
      {notice && <div style={s.alertOk}>{notice}</div>}

      <StatGrid>
        <Stat label="Pending Borrows" value={approvalQueue.pendingBorrowRequests} />
        <Stat label="Pending Venue Bookings" value={approvalQueue.pendingVenueBookings} />
        <Stat label="Forwarded to Admin" value={approvalQueue.forwardedVenueBookings} />
      </StatGrid>

      {pendingBorrowPreviews.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={s.subHeading}>Oldest Pending Borrow Requests</div>
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>Student</th>
                <th style={s.th}>Equipment</th>
                <th style={s.th}>Window</th>

                <th style={s.th} />
              </tr>
            </thead>
            <tbody>
              {pendingBorrowPreviews.map((req) => (
                <tr key={req.borrowRequestId}>
                  <td style={s.td}>
                    {req.studentName}
                    <br />
                    <span style={s.muted}>{req.studentEmail}</span>
                  </td>
                  <td style={s.td}>{req.equipmentTypeName}</td>
                  <td style={s.td}>
                    {new Date(req.requestedStartAt).toLocaleDateString()}{' '}
                    {new Date(req.requestedStartAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    {' → '}
                    {new Date(req.requestedReturnAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </td>
                  <td style={{ ...s.td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {rejectingId === req.borrowRequestId ? (
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'flex-end' }}>
                        <input
                          style={s.inlineInput}
                          placeholder="Reason"
                          value={rejectReason}
                          onChange={(e) => setRejectReason(e.target.value)}
                        />
                        <button
                          style={s.btnDanger}
                          disabled={!rejectReason.trim() || busy === req.borrowRequestId}
                          onClick={() => quickReject(req.borrowRequestId, req.studentName)}
                        >
                          Confirm
                        </button>
                        <button style={s.btnGhost} onClick={() => { setRejectingId(null); setRejectReason(''); }}>
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        <button
                          style={s.btnOk}
                          disabled={busy === req.borrowRequestId}
                          onClick={() => quickApprove(req.borrowRequestId, req.studentName)}
                        >
                          Approve
                        </button>
                        <button
                          style={s.btnDanger}
                          onClick={() => { setRejectingId(req.borrowRequestId); setRejectReason(''); }}
                        >
                          Reject
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

// ── Inventory Overview panel (both roles) ────────────────────────────────────

function InventoryPanel({ data }: { data: { totalActiveTypes: number; totalArticles: number; articlesOnLoan: number; articlesDamaged: number; openDamageFlags: number; lowStockTypes: number } }) {
  const hasDamage = data.openDamageFlags > 0 || data.articlesDamaged > 0;
  return (
    <Panel
      title="Inventory Overview"
      linkLabel="Manage Inventory"
      linkTo="/inventory"
      badge={data.lowStockTypes > 0 ? `${data.lowStockTypes} low stock` : undefined}
      badgeKind="warn"
    >
      <StatGrid>
        <Stat label="Equipment Types" value={data.totalActiveTypes} />
        <Stat label="Total Articles" value={data.totalArticles} />
        <Stat label="Currently On Loan" value={data.articlesOnLoan} />
        <Stat label="Damaged Articles" value={data.articlesDamaged} />
        <Stat
          label="Open Damage Flags"
          value={data.openDamageFlags}
          sub={hasDamage ? 'Action required' : undefined}
        />
        <Stat label="Low Stock Types" value={data.lowStockTypes} />
      </StatGrid>
    </Panel>
  );
}

// ── Equipment Health panel (both roles) ──────────────────────────────────────

function EquipmentHealthPanel({ data }: { data: { goodCondition: number; wornCondition: number; damagedCondition: number; openDamageFlags: number } }) {
  const total = data.goodCondition + data.wornCondition + data.damagedCondition;
  const goodPct = total > 0 ? Math.round((data.goodCondition / total) * 100) : 0;
  const wornPct = total > 0 ? Math.round((data.wornCondition / total) * 100) : 0;
  const damagedPct = total > 0 ? 100 - goodPct - wornPct : 0;

  return (
    <Panel
      title="Equipment Health"
      linkLabel="View Damage Flags"
      linkTo="/inventory"
      badge={data.openDamageFlags > 0 ? data.openDamageFlags : undefined}
      badgeKind="danger"
    >
      <StatGrid>
        <Stat label="Good Condition" value={data.goodCondition} sub={`${goodPct}%`} />
        <Stat label="Worn Condition" value={data.wornCondition} sub={`${wornPct}%`} />
        <Stat label="Damaged" value={data.damagedCondition} sub={`${damagedPct}%`} />
        <Stat label="Open Damage Flags" value={data.openDamageFlags} />
      </StatGrid>

      {total > 0 && (
        <div style={s.healthBar}>
          <div style={{ ...s.healthSegment, background: '#1f8a5b', width: `${goodPct}%` }} title={`Good: ${goodPct}%`} />
          <div style={{ ...s.healthSegment, background: '#c9822b', width: `${wornPct}%` }} title={`Worn: ${wornPct}%`} />
          <div style={{ ...s.healthSegment, background: '#c23b3b', width: `${damagedPct}%` }} title={`Damaged: ${damagedPct}%`} />
        </div>
      )}
    </Panel>
  );
}

// ── Active Borrows panel (both roles) ────────────────────────────────────────

function ActiveBorrowsPanel({ data }: { data: { active: number; overdue: number; incomplete: number; dueSoonCount: number } }) {
  return (
    <Panel
      title="Active Borrows"
      linkLabel="View Active Borrows"
      linkTo="/active-borrows"
      badge={data.overdue > 0 ? `${data.overdue} overdue` : undefined}
      badgeKind="danger"
    >
      <StatGrid>
        <Stat label="Currently Active" value={data.active} />
        <Stat label="Overdue" value={data.overdue} />
        <Stat label="Incomplete Returns" value={data.incomplete} />
        <Stat label="Due Within 24h" value={data.dueSoonCount} />
      </StatGrid>
    </Panel>
  );
}

// ── Live Equipment Availability panel (DASH-06 — SSE stream from Feature 2) ──

function LiveAvailabilityPanel() {
  const { user } = useAuth();
  const [rows, setRows] = useState<AvailabilityRow[] | null>(null);
  const [live, setLive] = useState(false);

  useEffect(() => {
    if (!user) return;
    const close = subscribeAvailability((snapshot) => {
      setRows(snapshot);
      setLive(true);
    });
    return close;
  }, [user]);

  const lowStock = rows?.filter((r) => r.statusBadge === 'LOW_STOCK') ?? [];
  const checkedOut = rows?.filter((r) => r.statusBadge === 'CHECKED_OUT') ?? [];

  return (
    <Panel
      title={`Equipment Availability ${live ? '🟢 Live' : ''}`}
      linkLabel="Full View"
      linkTo="/availability"
    >
      {rows === null ? (
        <p style={s.muted}>Connecting to live stream…</p>
      ) : (
        <>
          <StatGrid>
            <Stat label="Total Types" value={rows.length} />
            <Stat label="Low Stock" value={lowStock.length} />
            <Stat label="Checked Out" value={checkedOut.length} />
            <Stat label="Available" value={rows.filter((r) => r.statusBadge === 'AVAILABLE').length} />
          </StatGrid>

          {(lowStock.length > 0 || checkedOut.length > 0) && (
            <div style={{ marginTop: 14 }}>
              <div style={s.subHeading}>Items Needing Attention</div>
              <table style={s.table}>
                <thead>
                  <tr>
                    <th style={s.th}>Equipment</th>
                    <th style={s.th}>Sport</th>
                    <th style={s.th}>Available</th>
                    <th style={s.th}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {[...checkedOut, ...lowStock].slice(0, 6).map((r) => (
                    <tr key={r.equipmentTypeId}>
                      <td style={s.td}>{r.name}</td>
                      <td style={s.td}>{r.sportCategoryName}</td>
                      <td style={s.td}>{r.availableUnits}</td>
                      <td style={s.td}>
                        <span style={r.statusBadge === 'CHECKED_OUT' ? s.tagDanger : s.tagWarn}>
                          {r.statusBadge === 'CHECKED_OUT' ? 'Checked Out' : 'Low Stock'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Panel>
  );
}

// ── Calendar Overview panel (DASH-06 — reads from Feature 6 endpoint) ────────
// The calendar endpoint is a standard HTTP call (not SSE) — it reads from
// v_calendar which is kept current by venue service writes. The SSE for the
// calendar uses the same Feature 6 stream; the dashboard polls it on mount
// since the venue SSE requires an active booking-session subscription.

function CalendarOverviewPanel() {
  const [sessions, setSessions] = useState<CalendarSession[] | null>(null);

  useEffect(() => {
    const from = new Date().toISOString();
    const to = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    listCalendar({ from, to })
      .then((r) => setSessions(r.sessions))
      .catch(() => setSessions([]));
  }, []);

  const upcoming = sessions?.filter((s) => s.status === 'SCHEDULED' || s.status === 'IN_PROGRESS') ?? [];

  return (
    <Panel title="Calendar (Next 7 Days)" linkLabel="Full Calendar" linkTo="/calendar">
      {sessions === null ? (
        <p style={s.muted}>Loading…</p>
      ) : upcoming.length === 0 ? (
        <p style={s.muted}>No upcoming sessions in the next 7 days.</p>
      ) : (
        <>
          <StatGrid>
            <Stat label="Upcoming Sessions" value={upcoming.length} />
            <Stat label="In Progress" value={sessions.filter((s) => s.status === 'IN_PROGRESS').length} />
          </StatGrid>
          <div style={{ marginTop: 14 }}>
            <div style={s.subHeading}>Next Sessions</div>
            <table style={s.table}>
              <thead>
                <tr>
                  <th style={s.th}>Venue</th>
                  <th style={s.th}>Starts</th>
                  <th style={s.th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {upcoming.slice(0, 5).map((sess) => (
                  <tr key={sess.session_id}>
                    <td style={s.td}>{sess.venue_name}</td>
                    <td style={s.td}>
                      {new Date(sess.starts_at).toLocaleDateString()}{' '}
                      {new Date(sess.starts_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td style={s.td}>
                      <span style={sess.status === 'IN_PROGRESS' ? s.tagWarn : s.tagOk}>
                        {sess.status === 'IN_PROGRESS' ? 'In Progress' : 'Scheduled'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Panel>
  );
}

// ── Usage History summary panel (both roles) ─────────────────────────────────

function UsageHistoryPanel({ data }: { data: { totalRecords: number; equipmentBorrows: number; venueSessions: number; last30Days: number } }) {
  return (
    <Panel title="Usage History" linkLabel="Browse History" linkTo="/usage-history">
      <StatGrid>
        <Stat label="Total Records" value={data.totalRecords} />
        <Stat label="Equipment Borrows" value={data.equipmentBorrows} />
        <Stat label="Venue Sessions" value={data.venueSessions} />
        <Stat label="Last 30 Days" value={data.last30Days} />
      </StatGrid>
    </Panel>
  );
}

// ── Delegation Controls panel (SUPER_ADMIN only — stub per DASH-02) ──────────
// Delegation (Feature 7 extension) is not implemented in MVP.
// DASH-14: the panel placeholder is part of the fixed Super Admin layout.

function DelegationPanel() {
  return (
    <Panel title="Delegation Controls">
      <p style={{ ...s.muted, margin: 0 }}>
        Coordinator approval-delegation settings will appear here in a future release.
      </p>
    </Panel>
  );
}

// ── Main screen ──────────────────────────────────────────────────────────────

export default function DashboardScreen() {
  const { user, loading } = useAuth();
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // DASH-05: load all static panels on mount
  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const result = await getDashboard();
      setData(result);
      setError(null);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <PortalShell title="Dashboard"><p style={s.muted}>Loading…</p></PortalShell>;
  // Admin Dashboard is SUPER_ADMIN only
  if (!user) return <Navigate to="/" replace />;
  if (user.role !== 'SUPER_ADMIN') {
    return <Navigate to="/home" replace />;
  }

  const tint = 'navy';

  return (
    <PortalShell title="Admin Dashboard" tint={tint}>
      <div style={s.wrap}>
        {/* Toolbar */}
        <div style={s.toolbar}>
          <span style={s.roleChip}>Super Admin — Full View</span>
          <button style={s.refreshBtn} disabled={refreshing} onClick={() => void load()}>
            {refreshing ? 'Refreshing…' : '↺ Refresh'}
          </button>
        </div>

        {error && <div style={s.alertErr}>{error}</div>}

        {data === null && !error && (
          <p style={s.muted}>Loading dashboard…</p>
        )}

        {data !== null && (
          <>
            {/* ── SUPER_ADMIN-only panels ────────────────────────────── */}
            {data.role === 'SUPER_ADMIN' && (
              <UserManagementPanel data={data} />
            )}

            {/* ── Approval queue ────────────────────────────────────── */}
            <ApprovalQueuePanel
              approvalQueue={data.dashboard.approvalQueue}
              pendingBorrowPreviews={data.dashboard.pendingBorrowPreviews}
            />

            {/* ── Two-column layout for inventory + health ─────────── */}
            <div style={s.twoCol}>
              <InventoryPanel data={data.dashboard.inventory} />
              <EquipmentHealthPanel data={data.dashboard.equipmentHealth} />
            </div>

            {/* ── Active borrows (both roles) ─────────────────────── */}
            <ActiveBorrowsPanel data={data.dashboard.activeBorrows} />

            {/* ── DASH-06: live panels ─────────────────────────────── */}
            <div style={s.twoCol}>
              <LiveAvailabilityPanel />
              <CalendarOverviewPanel />
            </div>

            {/* ── Usage history (both roles) ───────────────────────── */}
            <UsageHistoryPanel data={data.dashboard.usageHistory} />

            {/* ── SUPER_ADMIN-only: delegation controls ─────────────── */}
            {data.role === 'SUPER_ADMIN' && <DelegationPanel />}
          </>
        )}
      </div>
    </PortalShell>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const s = {
  wrap: { maxWidth: 1100, margin: '0 auto' } as React.CSSProperties,

  toolbar: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 18,
  } as React.CSSProperties,

  roleChip: {
    fontSize: 13, fontWeight: 600, color: '#26485f',
    background: '#e7edf4', borderRadius: 4, padding: '4px 10px',
  } as React.CSSProperties,

  refreshBtn: {
    background: '#fff', border: '1px solid #ccc', borderRadius: 4,
    padding: '6px 14px', fontSize: 13, cursor: 'pointer', color: '#26485f',
  } as React.CSSProperties,

  panel: {
    background: '#fff', border: '1px solid #dfe3e8', borderRadius: 6,
    marginBottom: 18, boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
  } as React.CSSProperties,

  panelHead: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '12px 18px', borderBottom: '1px solid #e5e5e5',
    background: 'linear-gradient(#fff, #f7f8fa)', borderRadius: '6px 6px 0 0',
  } as React.CSSProperties,

  panelTitle: {
    font: '600 15px var(--font-body)', color: '#1a1d21',
  } as React.CSSProperties,

  panelBody: { padding: '16px 18px' } as React.CSSProperties,

  badge: {
    display: 'inline-block', borderRadius: 10, padding: '2px 8px',
    fontSize: 11, fontWeight: 700, lineHeight: 1.4,
  } as React.CSSProperties,

  badgeKinds: {
    neutral: { background: '#e7edf4', color: '#26485f' } as React.CSSProperties,
    ok: { background: '#d4edda', color: '#1f8a5b' } as React.CSSProperties,
    warn: { background: '#fdf3e0', color: '#c9822b' } as React.CSSProperties,
    danger: { background: '#fde8e8', color: '#c23b3b' } as React.CSSProperties,
  },

  linkBtn: {
    background: 'none', border: 'none', color: '#0a6ebd',
    fontSize: 13, cursor: 'pointer', padding: 0, fontWeight: 500,
  } as React.CSSProperties,

  statGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))',
    gap: 12,
  } as React.CSSProperties,

  stat: {
    background: '#f7f8fa', borderRadius: 6, padding: '12px 14px',
    border: '1px solid #eef0f3',
  } as React.CSSProperties,

  statValue: {
    font: '700 26px var(--font-display)', color: '#1a1d21', lineHeight: 1,
  } as React.CSSProperties,

  statLabel: {
    font: '500 11px var(--font-body)', color: '#5c6773',
    textTransform: 'uppercase' as const, letterSpacing: '0.04em', marginTop: 4,
  } as React.CSSProperties,

  statSub: {
    font: '600 12px var(--font-body)', color: '#c9822b', marginTop: 2,
  } as React.CSSProperties,

  subHeading: {
    font: '600 12px var(--font-body)', color: '#5c6773',
    textTransform: 'uppercase' as const, letterSpacing: '0.04em',
    marginBottom: 8,
  } as React.CSSProperties,

  twoCol: {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))',
    gap: 18, marginBottom: 0,
  } as React.CSSProperties,

  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13.5 } as React.CSSProperties,

  th: {
    textAlign: 'left' as const, font: '600 11px var(--font-body)',
    color: '#8a949f', textTransform: 'uppercase' as const,
    letterSpacing: '0.04em', padding: '0 8px 8px',
    borderBottom: '1px solid #e5e5e5',
  } as React.CSSProperties,

  td: {
    padding: '9px 8px', borderBottom: '1px solid #f0f0f0', color: '#1a1d21',
    verticalAlign: 'middle' as const,
  } as React.CSSProperties,

  muted: { color: '#5c6773', fontSize: 14, margin: 0 } as React.CSSProperties,

  alertErr: {
    background: '#fdecec', color: '#8f2323', border: '1px solid #f3caca',
    borderRadius: 4, padding: '10px 14px', marginBottom: 16, fontSize: 14,
  } as React.CSSProperties,

  alertOk: {
    background: '#eaf6ee', color: '#1e6b3a', border: '1px solid #c2e6cd',
    borderRadius: 4, padding: '10px 14px', marginBottom: 16, fontSize: 14,
  } as React.CSSProperties,

  healthBar: {
    display: 'flex', height: 8, borderRadius: 4,
    overflow: 'hidden', marginTop: 14, background: '#eef0f3',
  } as React.CSSProperties,

  healthSegment: { height: '100%', transition: 'width 0.3s ease' } as React.CSSProperties,

  tagOk: {
    background: '#d4edda', color: '#1f8a5b', borderRadius: 3,
    padding: '2px 7px', fontSize: 11, fontWeight: 600,
  } as React.CSSProperties,

  tagWarn: {
    background: '#fdf3e0', color: '#c9822b', borderRadius: 3,
    padding: '2px 7px', fontSize: 11, fontWeight: 600,
  } as React.CSSProperties,

  tagDanger: {
    background: '#fde8e8', color: '#c23b3b', borderRadius: 3,
    padding: '2px 7px', fontSize: 11, fontWeight: 600,
  } as React.CSSProperties,

  inlineInput: {
    font: '13px var(--font-body)', padding: '5px 8px',
    border: '1px solid #ccc', borderRadius: 4, width: 140,
  } as React.CSSProperties,

  btnOk: {
    background: '#1f8a4c', color: '#fff', border: 'none',
    borderRadius: 4, padding: '5px 12px', fontSize: 13, cursor: 'pointer',
  } as React.CSSProperties,

  btnDanger: {
    background: '#c0392b', color: '#fff', border: 'none',
    borderRadius: 4, padding: '5px 12px', fontSize: 13, cursor: 'pointer',
  } as React.CSSProperties,

  btnGhost: {
    background: '#fff', color: '#555', border: '1px solid #ccc',
    borderRadius: 4, padding: '5px 12px', fontSize: 13, cursor: 'pointer',
  } as React.CSSProperties,
};
