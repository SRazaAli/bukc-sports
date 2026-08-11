/**
 * Admin Dashboard (Feature 12 — DASH-01..14).
 *
 * RESKIN ONLY — Navy (#0d1f2d) + Sage Green (#52796f) palette.
 * Zero functional changes from the original:
 *  - Same imports, same API calls, same data shapes
 *  - Same PortalShell wrapper
 *  - Same inline reject-reason input (no window.prompt)
 *  - Same CalendarOverviewPanel self-fetching via listCalendar
 *  - Same LiveAvailabilityPanel self-managing SSE
 *  - Same role guard (SUPER_ADMIN only)
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

// ─── Palette ─────────────────────────────────────────────────────────────────
const C = {
  navy:       '#0d1f2d',
  navyMid:    '#1a3548',
  sage:       '#52796f',
  sageTint:   '#dfeadf',   // from WhatsApp reference image
  sageText:   '#2d5a3d',
  blueTint:   '#dde4ec',   // from WhatsApp reference image
  blueText:   '#1a2e44',
  amberTint:  '#fef0d8',
  amberText:  '#7c4f00',
  redTint:    '#fde8e8',
  redText:    '#8b1c1c',
  greenTint:  '#e2f5e2',
  greenText:  '#1a5c2a',
  card:       '#ffffff',
  cardHead:   '#fafbfc',
  border:     '#e4e8ec',
  text:       '#0d1f2d',
  muted:      '#64748b',
  light:      '#94a3b8',
} as const;

function errMsg(e: unknown) {
  return e instanceof ApiRequestError ? e.body.error : 'Something went wrong.';
}

// ─── Shared panel chrome ──────────────────────────────────────────────────────

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
  const badgeStyle = {
    neutral: { background: C.blueTint,  color: C.blueText  },
    ok:      { background: C.greenTint, color: C.greenText  },
    warn:    { background: C.amberTint, color: C.amberText  },
    danger:  { background: C.redTint,   color: C.redText    },
  }[badgeKind];

  return (
    <section style={s.panel}>
      <div style={s.panelHead}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={s.panelTitle}>{title}</span>
          {badge !== undefined && (
            <span style={{ ...s.badge, ...badgeStyle }}>{badge}</span>
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

// ─── Stat building blocks ─────────────────────────────────────────────────────

type Tint = 'sage' | 'blue' | 'amber' | 'red' | 'green' | 'neutral';

const TINT: Record<Tint, { bg: string; color: string; border: string }> = {
  sage:    { bg: C.sageTint,  color: C.sageText,  border: 'rgba(82,121,111,.18)' },
  blue:    { bg: C.blueTint,  color: C.blueText,  border: 'rgba(26,46,68,.12)'   },
  amber:   { bg: C.amberTint, color: C.amberText, border: 'rgba(217,119,6,.18)'  },
  red:     { bg: C.redTint,   color: C.redText,   border: 'rgba(139,28,28,.18)'  },
  green:   { bg: C.greenTint, color: C.greenText, border: 'rgba(26,92,42,.18)'   },
  neutral: { bg: '#f8f9fa',   color: C.navyMid,   border: C.border               },
};

function Stat({
  label, value, sub, tint = 'neutral',
}: {
  label: string;
  value: number | string;
  sub?: string;
  tint?: Tint;
}) {
  const t = TINT[tint];
  return (
    <div style={{ ...s.stat, background: t.bg, border: `1px solid ${t.border}` }}>
      <div style={{ ...s.statValue, color: t.color }}>{value}</div>
      <div style={{ ...s.statLabel, color: t.color, opacity: 0.75 }}>{label}</div>
      {sub && <div style={{ ...s.statSub, color: t.color }}>{sub}</div>}
    </div>
  );
}

function StatGrid({ children }: { children: React.ReactNode }) {
  return <div style={s.statGrid}>{children}</div>;
}

function SubHeading({ children }: { children: React.ReactNode }) {
  return <div style={s.subHeading}>{children}</div>;
}

function StatusPill({ kind, label }: { kind: 'ok' | 'warn' | 'danger' | 'neutral'; label: string }) {
  const styles = {
    ok:      { background: C.greenTint, color: C.greenText },
    warn:    { background: C.amberTint, color: C.amberText },
    danger:  { background: C.redTint,   color: C.redText   },
    neutral: { background: C.blueTint,  color: C.blueText  },
  }[kind];
  return <span style={{ ...s.pill, ...styles }}>{label}</span>;
}

// ─── User Management (SUPER_ADMIN only) ──────────────────────────────────────

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
        <Stat label="Pending Verification" value={um.pendingVerification} tint={um.pendingVerification > 0 ? 'amber' : 'neutral'} />
        <Stat label="Active Students"      value={um.activeStudents}      tint="sage"    />
        <Stat label="Active External"      value={um.activeExternal}      tint="blue"    />
        <Stat label="Coordinators"         value={um.activeCoordinators}  tint="blue"    />
      </StatGrid>
    </Panel>
  );
}

// ─── Approval Queue ───────────────────────────────────────────────────────────

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
      await approveRequest(id);
      setNotice(`Request approved for ${studentName}. Collect equipment from the queue.`);
      setLocalError(null);
    } catch (e) {
      setLocalError(errMsg(e));
    } finally { setBusy(null); }
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
    } finally { setBusy(null); }
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
      {notice    && <div style={s.alertOk}>{notice}</div>}

      <StatGrid>
        <Stat label="Pending Borrows"        value={approvalQueue.pendingBorrowRequests}  tint={approvalQueue.pendingBorrowRequests  > 0 ? 'amber' : 'neutral'} />
        <Stat label="Pending Venue Bookings" value={approvalQueue.pendingVenueBookings}   tint="blue"    />
        <Stat label="Forwarded to Admin"     value={approvalQueue.forwardedVenueBookings} tint="sage"    />
      </StatGrid>

      {pendingBorrowPreviews.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <SubHeading>Oldest Pending Borrow Requests</SubHeading>
          <div style={s.tblWrap}>
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
                  <tr key={req.borrowRequestId} style={s.tr}>
                    <td style={s.td}>
                      <div style={s.personCell}>
                        <div style={s.avatar}>{req.studentName[0]?.toUpperCase()}</div>
                        <div>
                          <div style={s.personName}>{req.studentName}</div>
                          <div style={s.personEmail}>{req.studentEmail}</div>
                        </div>
                      </div>
                    </td>
                    <td style={s.td}>
                      <span style={s.eqBadge}>{req.equipmentTypeName}</span>
                    </td>
                    <td style={s.td}>
                      <span style={s.windowTxt}>
                        {new Date(req.requestedStartAt).toLocaleDateString()}{' '}
                        {new Date(req.requestedStartAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        {' → '}
                        {new Date(req.requestedReturnAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </td>
                    <td style={{ ...s.td, textAlign: 'right', whiteSpace: 'nowrap' } as React.CSSProperties}>
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
        </div>
      )}
    </Panel>
  );
}

// ─── Inventory Overview ───────────────────────────────────────────────────────

function InventoryPanel({ data }: {
  data: { totalActiveTypes: number; totalArticles: number; articlesOnLoan: number; articlesDamaged: number; openDamageFlags: number; lowStockTypes: number };
}) {
  return (
    <Panel
      title="Inventory Overview"
      linkLabel="Manage Inventory"
      linkTo="/inventory"
      badge={data.lowStockTypes > 0 ? `${data.lowStockTypes} low stock` : undefined}
      badgeKind="warn"
    >
      <StatGrid>
        <Stat label="Equipment Types"  value={data.totalActiveTypes}  tint="blue"    />
        <Stat label="Total Articles"   value={data.totalArticles}     tint="sage"    />
        <Stat label="Currently On Loan" value={data.articlesOnLoan}  tint={data.articlesOnLoan  > 0 ? 'amber' : 'neutral'} />
        <Stat label="Damaged Articles" value={data.articlesDamaged}   tint={data.articlesDamaged > 0 ? 'red'   : 'neutral'} />
        <Stat label="Open Damage Flags" value={data.openDamageFlags}  tint={data.openDamageFlags > 0 ? 'red'   : 'neutral'}
          sub={data.openDamageFlags > 0 ? 'Action required' : undefined} />
        <Stat label="Low Stock Types"  value={data.lowStockTypes}     tint={data.lowStockTypes   > 0 ? 'amber' : 'neutral'} />
      </StatGrid>
    </Panel>
  );
}

// ─── Equipment Health ─────────────────────────────────────────────────────────

function EquipmentHealthPanel({ data }: {
  data: { goodCondition: number; wornCondition: number; damagedCondition: number; openDamageFlags: number };
}) {
  const total = data.goodCondition + data.wornCondition + data.damagedCondition;
  const goodPct    = total > 0 ? Math.round((data.goodCondition    / total) * 100) : 0;
  const wornPct    = total > 0 ? Math.round((data.wornCondition    / total) * 100) : 0;
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
        <Stat label="Good Condition" value={data.goodCondition}    sub={`${goodPct}%`}    tint="green"   />
        <Stat label="Worn Condition" value={data.wornCondition}    sub={`${wornPct}%`}    tint={data.wornCondition    > 0 ? 'amber' : 'neutral'} />
        <Stat label="Damaged"        value={data.damagedCondition} sub={`${damagedPct}%`} tint={data.damagedCondition > 0 ? 'red'   : 'neutral'} />
        <Stat label="Open Flags"     value={data.openDamageFlags}                         tint={data.openDamageFlags  > 0 ? 'red'   : 'neutral'} />
      </StatGrid>

      {total > 0 && (
        <div style={s.healthBar}>
          <div style={{ ...s.healthSeg, background: C.sage,      width: `${goodPct}%`    }} title={`Good: ${goodPct}%`}    />
          <div style={{ ...s.healthSeg, background: C.amberText, width: `${wornPct}%`    }} title={`Worn: ${wornPct}%`}    />
          <div style={{ ...s.healthSeg, background: C.redText,   width: `${damagedPct}%` }} title={`Damaged: ${damagedPct}%`} />
        </div>
      )}
    </Panel>
  );
}

// ─── Active Borrows ───────────────────────────────────────────────────────────

function ActiveBorrowsPanel({ data }: {
  data: { active: number; overdue: number; incomplete: number; dueSoonCount: number };
}) {
  return (
    <Panel
      title="Active Borrows"
      linkLabel="View Active Borrows"
      linkTo="/active-borrows"
      badge={data.overdue > 0 ? `${data.overdue} overdue` : undefined}
      badgeKind="danger"
    >
      <StatGrid>
        <Stat label="Currently Active"    value={data.active}       tint="sage"    />
        <Stat label="Overdue"             value={data.overdue}      tint={data.overdue      > 0 ? 'red'   : 'neutral'} />
        <Stat label="Incomplete Returns"  value={data.incomplete}   tint={data.incomplete   > 0 ? 'amber' : 'neutral'} />
        <Stat label="Due Within 24h"      value={data.dueSoonCount} tint={data.dueSoonCount > 0 ? 'amber' : 'neutral'} />
      </StatGrid>
    </Panel>
  );
}

// ─── Live Equipment Availability (DASH-06 — SSE from Feature 2) ───────────────

function LiveAvailabilityPanel() {
  const { user } = useAuth();
  const [rows, setRows] = useState<AvailabilityRow[] | null>(null);
  const [live, setLive] = useState(false);

  useEffect(() => {
    if (!user) return;
    const close = subscribeAvailability((snapshot) => { setRows(snapshot); setLive(true); });
    return close;
  }, [user]);

  const lowStock   = rows?.filter((r) => r.statusBadge === 'LOW_STOCK')   ?? [];
  const checkedOut = rows?.filter((r) => r.statusBadge === 'CHECKED_OUT') ?? [];

  return (
    <Panel title="Equipment Availability" linkLabel="Full View" linkTo="/availability">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          background: live ? C.greenTint : C.blueTint,
          color: live ? C.greenText : C.blueText,
          border: `1px solid ${live ? 'rgba(26,92,42,.2)' : 'rgba(26,46,68,.12)'}`,
          borderRadius: 20, padding: '2px 9px', fontSize: 10, fontWeight: 600,
          letterSpacing: '.04em', textTransform: 'uppercase',
        } as React.CSSProperties}>
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'currentColor', display: 'inline-block' }} />
          {live ? 'Live' : 'Connecting…'}
        </span>
      </div>

      {rows === null ? (
        <p style={s.muted}>Connecting to live stream…</p>
      ) : (
        <>
          <StatGrid>
            <Stat label="Total Types"  value={rows.length}                                               tint="blue"    />
            <Stat label="Low Stock"    value={lowStock.length}   tint={lowStock.length   > 0 ? 'amber' : 'neutral'} />
            <Stat label="Checked Out"  value={checkedOut.length} tint={checkedOut.length > 0 ? 'red'   : 'neutral'} />
            <Stat label="Available"    value={rows.filter((r) => r.statusBadge === 'AVAILABLE').length}  tint="sage"    />
          </StatGrid>

          {(lowStock.length > 0 || checkedOut.length > 0) && (
            <div style={{ marginTop: 14 }}>
              <SubHeading>Items Needing Attention</SubHeading>
              <div style={s.tblWrap}>
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
                      <tr key={r.equipmentTypeId} style={s.tr}>
                        <td style={s.td}><strong style={{ color: C.text }}>{r.name}</strong></td>
                        <td style={s.td}><span style={s.sportChip}>{r.sportCategoryName}</span></td>
                        <td style={s.td}>{r.availableUnits}</td>
                        <td style={s.td}>
                          <StatusPill
                            kind={r.statusBadge === 'CHECKED_OUT' ? 'danger' : 'warn'}
                            label={r.statusBadge === 'CHECKED_OUT' ? 'Checked Out' : 'Low Stock'}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </Panel>
  );
}

// ─── Calendar Overview (reads Feature 6 endpoint) ────────────────────────────

function CalendarOverviewPanel() {
  const [sessions, setSessions] = useState<CalendarSession[] | null>(null);

  useEffect(() => {
    const from = new Date().toISOString();
    const to   = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
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
            <Stat label="Upcoming Sessions" value={upcoming.length}                                           tint="sage"    />
            <Stat label="In Progress"       value={sessions.filter((s) => s.status === 'IN_PROGRESS').length} tint={sessions.filter((s) => s.status === 'IN_PROGRESS').length > 0 ? 'amber' : 'neutral'} />
          </StatGrid>
          <div style={{ marginTop: 14 }}>
            <SubHeading>Next Sessions</SubHeading>
            <div style={s.tblWrap}>
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
                    <tr key={sess.session_id} style={s.tr}>
                      <td style={s.td}><strong style={{ color: C.text }}>{sess.venue_name}</strong></td>
                      <td style={s.td}>
                        <span style={s.windowTxt}>
                          {new Date(sess.starts_at).toLocaleDateString()}{' '}
                          {new Date(sess.starts_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </td>
                      <td style={s.td}>
                        <StatusPill
                          kind={sess.status === 'IN_PROGRESS' ? 'warn' : 'ok'}
                          label={sess.status === 'IN_PROGRESS' ? 'In Progress' : 'Scheduled'}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </Panel>
  );
}

// ─── Usage History ────────────────────────────────────────────────────────────

function UsageHistoryPanel({ data }: {
  data: { totalRecords: number; equipmentBorrows: number; venueSessions: number; last30Days: number };
}) {
  return (
    <Panel title="Usage History" linkLabel="Browse History" linkTo="/usage-history">
      <StatGrid>
        <Stat label="Total Records"     value={data.totalRecords}     tint="blue" />
        <Stat label="Equipment Borrows" value={data.equipmentBorrows} tint="sage" />
        <Stat label="Venue Sessions"    value={data.venueSessions}    tint="blue" />
        <Stat label="Last 30 Days"      value={data.last30Days}       tint="sage" />
      </StatGrid>
    </Panel>
  );
}

// ─── Delegation Controls stub (SUPER_ADMIN only) ──────────────────────────────

function DelegationPanel() {
  return (
    <Panel title="Delegation Controls">
      <div style={s.delegMsg}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.sage} strokeWidth="2" style={{ flexShrink: 0, marginTop: 1 }}>
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
        </svg>
        <p style={{ margin: 0, color: C.muted, fontSize: 14 }}>
          Coordinator approval-delegation settings will appear here in a future release.
        </p>
      </div>
    </Panel>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function DashboardScreen() {
  const { user, loading } = useAuth();
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

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
  if (!user) return <Navigate to="/" replace />;
  if (user.role !== 'SUPER_ADMIN') return <Navigate to="/home" replace />;

  return (
    <PortalShell title="Admin Dashboard" tint="navy">
      <div style={s.wrap}>
        {/* Toolbar */}
        <div style={s.toolbar}>
          <span style={s.roleChip}>Super Admin — Full View</span>
          <button style={s.refreshBtn} disabled={refreshing} onClick={() => void load()}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              style={refreshing ? { animation: 'spin 0.8s linear infinite', display: 'inline', marginRight: 5 } : { display: 'inline', marginRight: 5 }}>
              <path d="M1 4v6h6M23 20v-6h-6"/><path d="M20.49 9A9 9 0 005.64 5.64L1 10M23 14l-4.64 4.36A9 9 0 013.51 15"/>
            </svg>
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>

        {error && <div style={s.alertErr}>{error}</div>}
        {data === null && !error && <p style={s.muted}>Loading dashboard…</p>}

        {data !== null && (
          <>
            {data.role === 'SUPER_ADMIN' && <UserManagementPanel data={data} />}

            <ApprovalQueuePanel
              approvalQueue={data.dashboard.approvalQueue}
              pendingBorrowPreviews={data.dashboard.pendingBorrowPreviews}
            />

            <div style={s.twoCol}>
              <InventoryPanel data={data.dashboard.inventory} />
              <EquipmentHealthPanel data={data.dashboard.equipmentHealth} />
            </div>

            <ActiveBorrowsPanel data={data.dashboard.activeBorrows} />

            <div style={s.twoCol}>
              <LiveAvailabilityPanel />
              <CalendarOverviewPanel />
            </div>

            <UsageHistoryPanel data={data.dashboard.usageHistory} />

            {data.role === 'SUPER_ADMIN' && <DelegationPanel />}
          </>
        )}

        <footer style={s.footer}>2026 © Bahria University Sports Platform</footer>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </PortalShell>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  wrap:    { maxWidth: 1100, margin: '0 auto' },
  toolbar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },

  roleChip: {
    fontSize: 12, fontWeight: 700, color: C.sageText,
    background: C.sageTint, borderRadius: 20, padding: '4px 12px',
    border: `1px solid rgba(82,121,111,.25)`,
    letterSpacing: '.03em', textTransform: 'uppercase',
  } as React.CSSProperties,

  refreshBtn: {
    display: 'flex', alignItems: 'center',
    background: C.card, border: `1px solid ${C.border}`, borderRadius: 6,
    padding: '6px 14px', fontSize: 12, cursor: 'pointer', color: C.navyMid,
    fontFamily: 'inherit', fontWeight: 600,
  },

  // Panel chrome
  panel: {
    background: C.card, border: `1px solid ${C.border}`, borderRadius: 10,
    marginBottom: 16, overflow: 'hidden',
  },
  panelHead: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '12px 18px', borderBottom: `1px solid ${C.border}`,
    background: C.cardHead,
  },
  panelTitle: { fontSize: 13, fontWeight: 700, color: C.navy },
  panelBody:  { padding: '16px 18px' },

  badge: {
    display: 'inline-block', borderRadius: 20, padding: '2px 8px',
    fontSize: 10, fontWeight: 700, lineHeight: 1.4, letterSpacing: '.03em',
  },

  linkBtn: {
    background: 'none', border: 'none', color: C.sage,
    fontSize: 12, cursor: 'pointer', padding: 0, fontWeight: 600, fontFamily: 'inherit',
  },

  // Stat cards
  statGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 10 },
  stat:     { borderRadius: 8, padding: '11px 13px' },
  statValue: { fontWeight: 800, fontSize: 24, lineHeight: 1, letterSpacing: '-.03em' },
  statLabel: { fontSize: 10, textTransform: 'uppercase', letterSpacing: '.07em', fontWeight: 600, marginTop: 3 } as React.CSSProperties,
  statSub:   { fontSize: 11, fontWeight: 600, marginTop: 2 },

  subHeading: {
    fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase',
    letterSpacing: '.08em', marginBottom: 8,
  } as React.CSSProperties,

  // Tables
  tblWrap: { border: `1px solid ${C.border}`, borderRadius: 7, overflow: 'hidden' },
  table:   { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: {
    background: '#f8f9fa', padding: '7px 12px', textAlign: 'left',
    fontWeight: 700, color: C.muted, fontSize: 10, textTransform: 'uppercase',
    letterSpacing: '.07em', borderBottom: `1px solid ${C.border}`,
  } as React.CSSProperties,
  tr: { borderTop: `1px solid ${C.border}` },
  td: { padding: '9px 12px', color: C.text, verticalAlign: 'middle' },

  // Person cell
  personCell:  { display: 'flex', alignItems: 'center', gap: 8 },
  avatar:      { width: 26, height: 26, borderRadius: '50%', background: C.navy, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0 },
  personName:  { fontWeight: 600, fontSize: 12, color: C.navy },
  personEmail: { fontSize: 10, color: C.muted },
  eqBadge:     { background: C.sageTint, color: C.sageText, border: `1px solid rgba(82,121,111,.22)`, padding: '2px 8px', borderRadius: 5, fontSize: 11, fontWeight: 600 },
  windowTxt:   { fontSize: 11, color: C.muted },
  sportChip:   { background: '#f1f5f9', color: C.muted, padding: '2px 7px', borderRadius: 4, fontSize: 11 },

  pill: {
    display: 'inline-flex', alignItems: 'center', padding: '2px 8px',
    borderRadius: 20, fontSize: 10, fontWeight: 700, letterSpacing: '.03em',
    textTransform: 'uppercase', whiteSpace: 'nowrap',
  } as React.CSSProperties,

  // Health bar
  healthBar: { display: 'flex', height: 7, borderRadius: 4, overflow: 'hidden', marginTop: 14, background: C.border },
  healthSeg: { height: '100%', transition: 'width 0.3s ease' },

  // Two-column layout
  twoCol: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))', gap: 16, marginBottom: 0 },

  // Alerts
  alertErr: { background: C.redTint,   color: C.redText,   border: `1px solid rgba(139,28,28,.2)`,  borderRadius: 6, padding: '10px 14px', marginBottom: 14, fontSize: 13 },
  alertOk:  { background: C.greenTint, color: C.greenText, border: `1px solid rgba(26,92,42,.2)`,   borderRadius: 6, padding: '10px 14px', marginBottom: 14, fontSize: 13 },

  // Inline form elements
  inlineInput: {
    fontSize: 12, padding: '5px 8px', border: `1px solid ${C.border}`,
    borderRadius: 5, width: 140, fontFamily: 'inherit', color: C.text,
    background: C.card,
  },
  btnOk: {
    background: C.sage, color: '#fff', border: 'none',
    borderRadius: 5, padding: '5px 12px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600,
  },
  btnDanger: {
    background: '#c0392b', color: '#fff', border: 'none',
    borderRadius: 5, padding: '5px 12px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600,
  },
  btnGhost: {
    background: C.card, color: C.muted, border: `1px solid ${C.border}`,
    borderRadius: 5, padding: '5px 12px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
  },

  // Misc
  delegMsg: { display: 'flex', alignItems: 'flex-start', gap: 10, background: '#f6f8fb', border: `1px dashed ${C.border}`, borderRadius: 7, padding: '12px 14px' },
  muted:    { color: C.muted, fontSize: 13, margin: 0 },
  footer:   { textAlign: 'center', fontSize: 11, color: C.light, marginTop: 28, paddingTop: 14, borderTop: `1px solid ${C.border}` } as React.CSSProperties,
};
