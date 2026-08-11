/**
 * HomeScreen — role-aware dashboard.
 * Super Admin gets animated SVG charts (donut + bar) from real API data.
 * All other roles get stat cards + tables.
 * Zero backend changes — same API calls as before.
 */
import { useEffect, useState, useCallback, useRef } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth.js';
import AppShell, {
  PageHeader, StatCard, Card, Btn, Badge,
  EmptyState, ErrorBox, Th, Td, TableWrapper, Skeleton,
} from '../../components/AppShell.js';
import { listAvailability, type AvailabilityRow } from '../availability/api.js';
import { listMyRequests, listActive, type MyRequest, type ActiveBorrow } from '../borrow/api.js';
import { listMyBookings, listQueue, listAdminQueue, type MyBooking, type QueueBooking, type AdminQueueBooking } from '../venue/api.js';
import { listPending, type PendingAccount } from './api.js';
import { ApiRequestError } from '../../lib/api.js';

function errMsg(e: unknown) { return e instanceof ApiRequestError ? e.body.error : 'Could not load data.'; }

const IcEquip  = () => <svg width="20" height="20" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="9" r="7.5"/><circle cx="9" cy="9" r="3"/></svg>;
const IcBorrow = () => <svg width="20" height="20" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9h12M11 5l4 4-4 4"/><rect x="1" y="1" width="6" height="16" rx="1"/></svg>;
const IcVenue  = () => <svg width="20" height="20" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M9 1L1 5v1h16V5L9 1z"/><rect x="3" y="7" width="2" height="8"/><rect x="8" y="7" width="2" height="8"/><rect x="13" y="7" width="2" height="8"/><line x1="1" y1="15" x2="17" y2="15"/></svg>;
const IcAlert  = () => <svg width="20" height="20" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M9 1L1 15h16L9 1z"/><line x1="9" y1="7" x2="9" y2="11"/><circle cx="9" cy="13.5" r=".5" fill="currentColor" stroke="none"/></svg>;
const IcUsers  = () => <svg width="20" height="20" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="7" cy="6" r="3"/><path d="M1 16c0-3 2.7-5 6-5s6 2 6 5"/><path d="M13 4a3 3 0 0 1 0 6"/><path d="M16 16c0-2.5-1.5-4-3-4.5"/></svg>;

function fmt(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

// ── Animated donut chart ───────────────────────────────────────────────────

function DonutChart({ slices, size = 130, thickness = 20 }: {
  slices: { label: string; value: number; color: string }[];
  size?: number; thickness?: number;
}) {
  const [progress, setProgress] = useState(0);
  const raf = useRef<number>(0);
  const t0  = useRef<number>(0);
  const dur = 900;

  useEffect(() => {
    t0.current = performance.now();
    const tick = (now: number) => {
      const p = Math.min((now - t0.current) / dur, 1);
      setProgress(1 - Math.pow(1 - p, 3));
      if (p < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [slices.map((s) => s.value).join(',')]);

  const total = slices.reduce((s, x) => s + x.value, 0) || 1;
  const r = (size - thickness) / 2;
  const cx = size / 2;
  const C = 2 * Math.PI * r;
  let offset = 0;
  const paths = slices.map((s) => {
    const frac = (s.value / total) * progress;
    const dash = frac * C;
    const off  = offset * C;
    offset += s.value / total;
    return { ...s, dash, off };
  });

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }}>
      <circle cx={cx} cy={cx} r={r} fill="none" stroke="var(--line-light)" strokeWidth={thickness} />
      {paths.map((p, i) => (
        <circle key={i} cx={cx} cy={cx} r={r} fill="none"
          stroke={p.color} strokeWidth={thickness}
          strokeDasharray={`${p.dash} ${C}`}
          strokeDashoffset={-p.off}
          style={{ transform: 'rotate(-90deg)', transformOrigin: '50% 50%' }}
        />
      ))}
      <text x={cx} y={cx - 5} textAnchor="middle"
        style={{ font: `700 ${Math.round(size * 0.18)}px var(--font-display)`, fill: 'var(--navy)' }}>
        {total}
      </text>
      <text x={cx} y={cx + Math.round(size * 0.13)} textAnchor="middle"
        style={{ font: `11px var(--font-body)`, fill: 'var(--ink-muted)' }}>
        total
      </text>
    </svg>
  );
}

// ── Animated bar chart ─────────────────────────────────────────────────────

function BarChart({ bars }: { bars: { label: string; value: number; color: string }[] }) {
  const [progress, setProgress] = useState(0);
  const raf = useRef<number>(0);
  const t0  = useRef<number>(0);
  const dur = 800;

  useEffect(() => {
    t0.current = performance.now();
    const tick = (now: number) => {
      const p = Math.min((now - t0.current) / dur, 1);
      setProgress(1 - Math.pow(1 - p, 3));
      if (p < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [bars.map((b) => b.value).join(',')]);

  const max = Math.max(...bars.map((b) => b.value), 1);
  return (
    <div style={{ width: '100%' }}>
      {bars.map((b, i) => (
        <div key={i} style={{ marginBottom: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ font: '12.5px var(--font-body)', color: 'var(--ink-muted)' }}>{b.label}</span>
            <span style={{ font: '600 12px var(--font-mono)', color: 'var(--navy)' }}>{b.value}</span>
          </div>
          <div style={{ height: 10, background: 'var(--line-light)', borderRadius: 5, overflow: 'hidden' }}>
            <div style={{
              height: '100%',
              width: `${(b.value / max) * progress * 100}%`,
              background: b.color,
              borderRadius: 5,
              transition: 'none',
            }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function Legend({ items }: { items: { label: string; color: string; value: number }[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {items.map((item) => (
        <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: item.color, flexShrink: 0 }} />
          <span style={{ font: '12.5px var(--font-body)', color: 'var(--ink-muted)', flex: 1 }}>{item.label}</span>
          <span style={{ font: '600 12.5px var(--font-mono)', color: 'var(--navy)' }}>{item.value}</span>
        </div>
      ))}
    </div>
  );
}

// ── Shared sub-components ─────────────────────────────────────────────────

function SectionHead({ title, count, action }: { title: string; count?: number; action?: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--sp-3)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ font: '600 14px var(--font-display)', color: 'var(--navy)' }}>{title}</span>
        {count !== undefined && count > 0 && (
          <span style={{ background: 'var(--teal)', color: '#fff', font: '600 10px var(--font-mono)', padding: '2px 6px', borderRadius: 10 }}>{count}</span>
        )}
      </div>
      {action && <button onClick={action} style={{ background: 'none', border: 'none', cursor: 'pointer', font: '12.5px var(--font-body)', color: 'var(--teal)', padding: 0 }}>View all →</button>}
    </div>
  );
}

function SkeletonRows() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {[1,2,3].map((i) => (
        <div key={i} style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 2, height: 13, background: 'var(--line-light)', borderRadius: 3, animation: 'pulse 1.4s ease infinite' }} />
          <div style={{ flex: 1, height: 13, background: 'var(--line-light)', borderRadius: 3, animation: 'pulse 1.4s ease infinite', opacity: 0.7 }} />
          <div style={{ flex: 1, height: 13, background: 'var(--line-light)', borderRadius: 3, animation: 'pulse 1.4s ease infinite', opacity: 0.5 }} />
        </div>
      ))}
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}`}</style>
    </div>
  );
}

const trH: React.CSSProperties = { cursor: 'pointer' };
const trunc: React.CSSProperties = { display: 'block', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
const qaLabel: React.CSSProperties = { font: '600 11px var(--font-body)', color: 'var(--navy)', marginBottom: 'var(--sp-3)', textTransform: 'uppercase', letterSpacing: '0.05em' };

// ── SUPER ADMIN ────────────────────────────────────────────────────────────

function AdminDashboard() {
  const navigate = useNavigate();
  const [availability, setAvailability] = useState<AvailabilityRow[] | null>(null);
  const [active, setActive]             = useState<ActiveBorrow[] | null>(null);
  const [adminQueue, setAdminQueue]     = useState<AdminQueueBooking[] | null>(null);
  const [pending, setPending]           = useState<PendingAccount[] | null>(null);
  const [error, setError]               = useState<string | null>(null);
  const [loading, setLoading]           = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [av, ac, aq, pe] = await Promise.allSettled([
      listAvailability(), listActive(), listAdminQueue(), listPending(),
    ]);
    if (av.status === 'fulfilled') setAvailability(av.value.status);
    if (ac.status === 'fulfilled') setActive(ac.value.transactions);
    if (aq.status === 'fulfilled') setAdminQueue(aq.value.queue);
    if (pe.status === 'fulfilled') setPending(pe.value.accounts);
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const availCount      = availability?.filter((r) => r.statusBadge === 'AVAILABLE').length   ?? 0;
  const lowCount        = availability?.filter((r) => r.statusBadge === 'LOW_STOCK').length   ?? 0;
  const outCount        = availability?.filter((r) => r.statusBadge === 'CHECKED_OUT').length ?? 0;
  const totalEquip      = availability?.length ?? 0;
  const activeCount     = active?.filter((b) => b.status === 'ACTIVE').length    ?? 0;
  const overdueCount    = active?.filter((b) => b.status === 'OVERDUE').length   ?? 0;
  const pendingApproval = adminQueue?.length ?? 0;
  const pendingAccounts = pending?.length    ?? 0;

  const equipSlices = [
    { label: 'Available',   value: availCount, color: '#498473' },
    { label: 'Low Stock',   value: lowCount,   color: '#f59e0b' },
    { label: 'Checked Out', value: outCount,   color: '#b83232' },
  ];
  const borrowSlices = [
    { label: 'Active',  value: activeCount,  color: '#498473' },
    { label: 'Overdue', value: overdueCount, color: '#b83232' },
  ];
  const activityBars = [
    { label: 'Available Equipment',  value: availCount,      color: '#498473' },
    { label: 'Active Borrows',       value: activeCount,     color: '#0B3754' },
    { label: 'Overdue Returns',      value: overdueCount,    color: '#b83232' },
    { label: 'Pending Approvals',    value: pendingApproval, color: '#6366f1' },
    { label: 'Pending Accounts',     value: pendingAccounts, color: '#f59e0b' },
  ];

  return (
    <>
      {error && <ErrorBox message={error} />}
      <PageHeader title="Admin Dashboard" subtitle="BUKC Sports Platform — full system overview" />

      {/* Stat row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 'var(--sp-3)', marginBottom: 'var(--sp-4)' }}>
        <StatCard label="Equipment Types" value={loading ? '…' : totalEquip}      icon={<IcEquip />}  color="#498473"  loading={loading} />
        <StatCard label="Available Now"   value={loading ? '…' : availCount}      icon={<IcEquip />}  color="#1f7a45"  loading={loading} />
        <StatCard label="Active Borrows"  value={loading ? '…' : activeCount}     icon={<IcBorrow />} color="#0B3754"  loading={loading} />
        <StatCard label="Overdue"         value={loading ? '…' : overdueCount}    icon={<IcAlert />}  color="#b83232"  loading={loading} />
        <StatCard label="Venue Queue"     value={loading ? '…' : pendingApproval} icon={<IcVenue />}  color="#6366f1"  loading={loading} />
        <StatCard label="New Accounts"    value={loading ? '…' : pendingAccounts} icon={<IcUsers />}  color="#f59e0b"  loading={loading} />
      </div>

      {/* Charts row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', gap: 'var(--sp-4)', marginBottom: 'var(--sp-4)' }}>

        <Card style={{ padding: 'var(--sp-5)' }}>
          <SectionHead title="Equipment Status" action={() => navigate('/availability')} />
          {loading
            ? <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}><Skeleton w={130} h={130} /></div>
            : <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-5)', flexWrap: 'wrap' }}>
                <DonutChart slices={equipSlices} />
                <Legend items={equipSlices} />
              </div>
          }
        </Card>

        <Card style={{ padding: 'var(--sp-5)' }}>
          <SectionHead title="Borrow Status" action={() => navigate('/active-borrows')} />
          {loading
            ? <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}><Skeleton w={130} h={130} /></div>
            : <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-5)', flexWrap: 'wrap' }}>
                <DonutChart slices={borrowSlices} />
                <Legend items={borrowSlices} />
              </div>
          }
        </Card>

        <Card style={{ padding: 'var(--sp-5)' }}>
          <SectionHead title="Platform Activity" />
          {loading ? <SkeletonRows /> : <BarChart bars={activityBars} />}
        </Card>
      </div>

      {/* Tables row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 'var(--sp-4)', marginBottom: 'var(--sp-4)' }}>

        <Card style={{ padding: 'var(--sp-5)' }}>
          <SectionHead title="Venue Approvals" count={pendingApproval} action={() => navigate('/venue-approvals')} />
          {loading ? <SkeletonRows /> : !adminQueue?.length
            ? <EmptyState title="No pending approvals" />
            : <TableWrapper>
                <thead><tr><th style={Th}>Venue</th><th style={Th}>Purpose</th><th style={Th}>Sessions</th></tr></thead>
                <tbody>{adminQueue.slice(0,5).map((q) => (
                  <tr key={q.booking_id} style={trH} onClick={() => navigate('/venue-approvals')}>
                    <td style={Td}>{q.venue_name}</td>
                    <td style={Td}><span style={trunc}>{q.purpose}</span></td>
                    <td style={Td}>{q.sessionCount}</td>
                  </tr>
                ))}</tbody>
              </TableWrapper>
          }
        </Card>

        <Card style={{ padding: 'var(--sp-5)' }}>
          <SectionHead title="Active Borrows" count={active?.length} action={() => navigate('/active-borrows')} />
          {loading ? <SkeletonRows /> : !active?.length
            ? <EmptyState title="Nothing currently out" />
            : <TableWrapper>
                <thead><tr><th style={Th}>Borrower</th><th style={Th}>Equipment</th><th style={Th}>Status</th></tr></thead>
                <tbody>{active.slice(0,5).map((b) => (
                  <tr key={b.borrow_txn_id} style={trH} onClick={() => navigate('/active-borrows')}>
                    <td style={Td}>{b.borrower_name ?? b.guest_name ?? '—'}</td>
                    <td style={Td}>{b.equipment_type_name}</td>
                    <td style={Td}><Badge status={b.status} /></td>
                  </tr>
                ))}</tbody>
              </TableWrapper>
          }
        </Card>

        {pendingAccounts > 0 && (
          <Card style={{ padding: 'var(--sp-5)' }}>
            <SectionHead title="Pending Accounts" count={pendingAccounts} action={() => navigate('/admin/accounts')} />
            <TableWrapper>
              <thead><tr><th style={Th}>Name</th><th style={Th}>Role</th><th style={Th}>Joined</th></tr></thead>
              <tbody>{pending!.slice(0,5).map((p) => (
                <tr key={p.userId} style={trH} onClick={() => navigate('/admin/accounts')}>
                  <td style={Td}>{p.fullName}</td>
                  <td style={Td}><Badge status={p.role} /></td>
                  <td style={Td}>{fmt(p.createdAt)}</td>
                </tr>
              ))}</tbody>
            </TableWrapper>
          </Card>
        )}
      </div>

      {/* Quick actions */}
      <Card style={{ padding: 'var(--sp-5)' }}>
        <div style={qaLabel}>Quick Actions</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-2)' }}>
          <Btn onClick={() => navigate('/admin/accounts')}>Manage Accounts</Btn>
          <Btn variant="secondary" onClick={() => navigate('/inventory')}>Inventory</Btn>
          <Btn variant="secondary" onClick={() => navigate('/venue-approvals')}>Venue Approvals</Btn>
          <Btn variant="secondary" onClick={() => navigate('/active-borrows')}>Active Borrows</Btn>
          <Btn variant="secondary" onClick={() => navigate('/availability')}>Equipment</Btn>
          <Btn variant="secondary" onClick={() => navigate('/calendar')}>Calendar</Btn>
          <Btn variant="secondary" onClick={() => navigate('/history')}>Usage History</Btn>
        </div>
      </Card>
    </>
  );
}

// ── COORDINATOR ────────────────────────────────────────────────────────────

function CoordinatorDashboard() {
  const navigate = useNavigate();
  const [availability, setAvailability] = useState<AvailabilityRow[] | null>(null);
  const [active, setActive]             = useState<ActiveBorrow[] | null>(null);
  const [venueQueue, setVenueQueue]     = useState<QueueBooking[] | null>(null);
  const [loading, setLoading]           = useState(true);

  useEffect(() => {
    (async () => {
      const [av, ac, vq] = await Promise.allSettled([listAvailability(), listActive(), listQueue()]);
      if (av.status === 'fulfilled') setAvailability(av.value.status);
      if (ac.status === 'fulfilled') setActive(ac.value.transactions);
      if (vq.status === 'fulfilled') setVenueQueue(vq.value.queue);
      setLoading(false);
    })();
  }, []);

  const availCount   = availability?.filter((r) => r.statusBadge === 'AVAILABLE').length   ?? 0;
  const lowCount     = availability?.filter((r) => r.statusBadge === 'LOW_STOCK').length   ?? 0;
  const outCount     = availability?.filter((r) => r.statusBadge === 'CHECKED_OUT').length ?? 0;
  const overdueCount = active?.filter((b) => b.status === 'OVERDUE').length ?? 0;

  return (
    <>
      <PageHeader title="Coordinator Dashboard" subtitle="Manage equipment and venue requests" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px,1fr))', gap: 'var(--sp-3)', marginBottom: 'var(--sp-4)' }}>
        <StatCard label="Available"   value={loading ? '…' : availCount}          icon={<IcEquip />}  color="#498473"  loading={loading} />
        <StatCard label="Venue Queue" value={loading ? '…' : venueQueue?.length ?? 0} icon={<IcVenue />}  color="#6366f1"  loading={loading} />
        <StatCard label="Overdue"     value={loading ? '…' : overdueCount}        icon={<IcAlert />}  color="#b83232"  loading={loading} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px,1fr))', gap: 'var(--sp-4)', marginBottom: 'var(--sp-4)' }}>
        <Card style={{ padding: 'var(--sp-5)' }}>
          <SectionHead title="Equipment Status" action={() => navigate('/availability')} />
          {loading ? <SkeletonRows /> : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-5)', flexWrap: 'wrap' }}>
              <DonutChart slices={[
                { label: 'Available', value: availCount, color: '#498473' },
                { label: 'Low Stock', value: lowCount,   color: '#f59e0b' },
                { label: 'Out',       value: outCount,   color: '#b83232' },
              ]} />
              <Legend items={[
                { label: 'Available', value: availCount, color: '#498473' },
                { label: 'Low Stock', value: lowCount,   color: '#f59e0b' },
                { label: 'Out',       value: outCount,   color: '#b83232' },
              ]} />
            </div>
          )}
        </Card>
        <Card style={{ padding: 'var(--sp-5)' }}>
          <SectionHead title="Venue Queue" count={venueQueue?.length} action={() => navigate('/venue-queue')} />
          {loading ? <SkeletonRows /> : !venueQueue?.length ? <EmptyState title="No pending venues" /> : (
            <TableWrapper>
              <thead><tr><th style={Th}>Requester</th><th style={Th}>Venue</th><th style={Th}>Sessions</th></tr></thead>
              <tbody>{venueQueue.slice(0,5).map((q) => (
                <tr key={q.booking_id} style={trH} onClick={() => navigate('/venue-queue')}>
                  <td style={Td}>{q.requester_name ?? '—'}</td>
                  <td style={Td}>{q.venue_name}</td>
                  <td style={Td}>{q.sessionCount}</td>
                </tr>
              ))}</tbody>
            </TableWrapper>
          )}
        </Card>
        <Card style={{ padding: 'var(--sp-5)' }}>
          <SectionHead title="Active Borrows" count={active?.length} action={() => navigate('/active-borrows')} />
          {loading ? <SkeletonRows /> : !active?.length ? <EmptyState title="Nothing out" /> : (
            <TableWrapper>
              <thead><tr><th style={Th}>Borrower</th><th style={Th}>Equipment</th><th style={Th}>Status</th></tr></thead>
              <tbody>{active.slice(0,5).map((b) => (
                <tr key={b.borrow_txn_id} style={trH} onClick={() => navigate('/active-borrows')}>
                  <td style={Td}>{b.borrower_name ?? b.guest_name ?? '—'}</td>
                  <td style={Td}>{b.equipment_type_name}</td>
                  <td style={Td}><Badge status={b.status} /></td>
                </tr>
              ))}</tbody>
            </TableWrapper>
          )}
        </Card>
      </div>
      <Card style={{ padding: 'var(--sp-5)' }}>
        <div style={qaLabel}>Quick Actions</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-2)' }}>
          <Btn onClick={() => navigate('/borrow-queue')}>Borrow Queue</Btn>
          <Btn variant="secondary" onClick={() => navigate('/venue-queue')}>Venue Queue</Btn>
          <Btn variant="secondary" onClick={() => navigate('/active-borrows')}>Active Borrows</Btn>
          <Btn variant="secondary" onClick={() => navigate('/inventory')}>Inventory</Btn>
          <Btn variant="secondary" onClick={() => navigate('/equipment-alerts')}>Equip. Alerts</Btn>
          <Btn variant="secondary" onClick={() => navigate('/calendar')}>Calendar</Btn>
        </div>
      </Card>
    </>
  );
}

// ── STUDENT ────────────────────────────────────────────────────────────────

function StudentDashboard() {
  const navigate = useNavigate();
  const [myRequests, setMyRequests] = useState<MyRequest[] | null>(null);
  const [myBookings, setMyBookings] = useState<MyBooking[] | null>(null);
  const [loading, setLoading]       = useState(true);
  useEffect(() => {
    (async () => {
      const [req, bk] = await Promise.allSettled([listMyRequests(), listMyBookings()]);
      if (req.status === 'fulfilled') setMyRequests(req.value.requests);
      if (bk.status === 'fulfilled') setMyBookings(bk.value.bookings);
      setLoading(false);
    })();
  }, []);
  const activeReq = myRequests?.filter((r) => ['PENDING','APPROVED','ACTIVE'].includes(r.status)).length ?? 0;
  const activeBk  = myBookings?.filter((b) => ['PENDING','FORWARDED','APPROVED'].includes(b.status)).length ?? 0;
  return (
    <>
      <PageHeader title="My Dashboard" subtitle="Track your borrows and venue bookings" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px,1fr))', gap: 'var(--sp-3)', marginBottom: 'var(--sp-4)' }}>
        <StatCard label="Active Borrows"  value={loading ? '…' : activeReq}                  icon={<IcBorrow />} color="#498473" loading={loading} />
        <StatCard label="Active Bookings" value={loading ? '…' : activeBk}                   icon={<IcVenue />}  color="#0B3754" loading={loading} />
        <StatCard label="Total Borrows"   value={loading ? '…' : myRequests?.length ?? 0}    icon={<IcEquip />}  color="var(--ink-muted)" loading={loading} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px,1fr))', gap: 'var(--sp-4)', marginBottom: 'var(--sp-4)' }}>
        <Card style={{ padding: 'var(--sp-5)' }}>
          <SectionHead title="My Borrow Requests" action={() => navigate('/my-borrows')} />
          {loading ? <SkeletonRows /> : !myRequests?.length ? <EmptyState title="No requests yet" body="Browse equipment to get started." /> : (
            <TableWrapper>
              <thead><tr><th style={Th}>Equipment</th><th style={Th}>Date</th><th style={Th}>Status</th></tr></thead>
              <tbody>{myRequests.slice(0,5).map((r) => (
                <tr key={r.borrow_request_id}>
                  <td style={Td}>{r.equipment_type_name}</td>
                  <td style={Td}>{fmt(r.requested_start_at)}</td>
                  <td style={Td}><Badge status={r.status} /></td>
                </tr>
              ))}</tbody>
            </TableWrapper>
          )}
        </Card>
        <Card style={{ padding: 'var(--sp-5)' }}>
          <SectionHead title="My Venue Bookings" action={() => navigate('/my-bookings')} />
          {loading ? <SkeletonRows /> : !myBookings?.length ? <EmptyState title="No bookings yet" body="Book a venue for your team." /> : (
            <TableWrapper>
              <thead><tr><th style={Th}>Venue</th><th style={Th}>Sessions</th><th style={Th}>Status</th></tr></thead>
              <tbody>{myBookings.slice(0,5).map((b) => (
                <tr key={b.booking_id}>
                  <td style={Td}>{b.venue_name}</td>
                  <td style={Td}>{b.sessionCount}</td>
                  <td style={Td}><Badge status={b.status} /></td>
                </tr>
              ))}</tbody>
            </TableWrapper>
          )}
        </Card>
      </div>
      <Card style={{ padding: 'var(--sp-5)' }}>
        <div style={qaLabel}>Quick Actions</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-2)' }}>
          <Btn onClick={() => navigate('/availability')}>Browse Equipment</Btn>
          <Btn variant="secondary" onClick={() => navigate('/my-borrows')}>My Borrows</Btn>
          <Btn variant="secondary" onClick={() => navigate('/my-bookings')}>Book a Venue</Btn>
          <Btn variant="secondary" onClick={() => navigate('/calendar')}>Calendar</Btn>
          <Btn variant="secondary" onClick={() => navigate('/history')}>Usage History</Btn>
        </div>
      </Card>
    </>
  );
}

// ── EXTERNAL ────────────────────────────────────────────────────────────────

function ExternalDashboard() {
  const navigate = useNavigate();
  const [myBookings, setMyBookings] = useState<MyBooking[] | null>(null);
  const [loading, setLoading]       = useState(true);
  useEffect(() => {
    listMyBookings().then((r) => { setMyBookings(r.bookings); setLoading(false); }).catch(() => setLoading(false));
  }, []);
  const activeBk = myBookings?.filter((b) => ['PENDING','FORWARDED','APPROVED'].includes(b.status)).length ?? 0;
  return (
    <>
      <PageHeader title="My Dashboard" subtitle="Track your venue bookings at BUKC" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px,1fr))', gap: 'var(--sp-3)', marginBottom: 'var(--sp-4)' }}>
        <StatCard label="Active Bookings" value={loading ? '…' : activeBk}               icon={<IcVenue />} color="#498473" loading={loading} />
        <StatCard label="Total Bookings"  value={loading ? '…' : myBookings?.length ?? 0} icon={<IcVenue />} color="#0B3754" loading={loading} />
      </div>
      <Card style={{ padding: 'var(--sp-5)', marginBottom: 'var(--sp-4)' }}>
        <SectionHead title="My Venue Bookings" action={() => navigate('/my-bookings')} />
        {loading ? <SkeletonRows /> : !myBookings?.length ? <EmptyState title="No bookings yet" body="Submit a venue booking to get started." /> : (
          <TableWrapper>
            <thead><tr><th style={Th}>Venue</th><th style={Th}>Purpose</th><th style={Th}>Sessions</th><th style={Th}>Status</th></tr></thead>
            <tbody>{myBookings.slice(0,8).map((b) => (
              <tr key={b.booking_id}>
                <td style={Td}>{b.venue_name}</td>
                <td style={Td}><span style={trunc}>{b.purpose}</span></td>
                <td style={Td}>{b.sessionCount}</td>
                <td style={Td}><Badge status={b.status} /></td>
              </tr>
            ))}</tbody>
          </TableWrapper>
        )}
      </Card>
      <Card style={{ padding: 'var(--sp-5)' }}>
        <div style={qaLabel}>Quick Actions</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-2)' }}>
          <Btn onClick={() => navigate('/my-bookings')}>Book a Venue</Btn>
          <Btn variant="secondary" onClick={() => navigate('/calendar')}>Calendar</Btn>
          <Btn variant="secondary" onClick={() => navigate('/history')}>Usage History</Btn>
        </div>
      </Card>
    </>
  );
}

// ── Root ───────────────────────────────────────────────────────────────────

const ROLE_TITLE: Record<string, string> = {
  STUDENT: 'Student', EXTERNAL: 'External',
  COORDINATOR: 'Coordinator', SUPER_ADMIN: 'Administration Staff',
};

export default function HomeScreen() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <AppShell title="Dashboard">
        <div style={{ display: 'grid', gap: 'var(--sp-4)', gridTemplateColumns: 'repeat(auto-fill,minmax(180px,1fr))' }}>
          {[1,2,3,4,5,6].map((i) => (
            <div key={i} style={{ height: 90, background: 'var(--white)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--line-light)', animation: 'pulse 1.4s ease infinite' }} />
          ))}
          <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}`}</style>
        </div>
      </AppShell>
    );
  }
  if (!user) return <Navigate to="/" replace />;
  const body: Record<string, React.ReactNode> = {
    SUPER_ADMIN: <AdminDashboard />,
    COORDINATOR: <CoordinatorDashboard />,
    STUDENT:     <StudentDashboard />,
    EXTERNAL:    <ExternalDashboard />,
  };
  return (
    <AppShell title={`${ROLE_TITLE[user.role] ?? ''} Dashboard`}>
      {body[user.role] ?? <Navigate to="/" replace />}
    </AppShell>
  );
}
