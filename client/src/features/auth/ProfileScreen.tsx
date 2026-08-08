/**
 * Profile — every authenticated role gets this screen (AUTH-17: change your
 * own password from your profile; AUTH-20: notifications visible in the
 * profile notification inbox). Personal details and change-password are
 * universal; the activity/stats section is role-specific — Student sees
 * borrow reputation + recent requests, External sees recent venue bookings,
 * Coordinator/Super Admin get the lighter base profile only (see the chat
 * writeup for why).
 */
import { useEffect, useState, useCallback, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth.js';
import { PortalShell, LabeledInput, PrimaryButton, LockIcon, type BarTint } from './PortalShell.js';
import { getMyProfile, requestChangePasswordOtp, confirmChangePassword, type ManagedAccount } from './api.js';
import { listNotifications, unreadNotificationCount, markNotificationRead, markAllNotificationsRead, type AppNotification } from '../notifications/api.js';
import { getReputation, listMyRequests, type MyRequest, type Reputation } from '../borrow/api.js';
import { listMyBookings, type MyBooking } from '../venue/api.js';
import { ApiRequestError } from '../../lib/api.js';

function errMsg(e: unknown) { return e instanceof ApiRequestError ? e.body.error : 'Something went wrong.'; }

const TINT_BY_ROLE: Record<string, BarTint> = {
  STUDENT: 'sage', EXTERNAL: 'blue', COORDINATOR: 'slate', SUPER_ADMIN: 'navy',
};

export default function ProfileScreen() {
  const { user, loading: authLoading } = useAuth();
  const [account, setAccount] = useState<ManagedAccount | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await getMyProfile();
      setAccount(res.account);
    } catch (e) { setError(errMsg(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (authLoading || !user) return <PortalShell title="Profile"><p /></PortalShell>;

  return (
    <PortalShell title="My Profile" tint={TINT_BY_ROLE[user.role] ?? 'navy'}>
      <div style={wrap}>
        {error && <div style={box.error}>{error}</div>}
        {notice && <div style={box.ok}>{notice}</div>}

        <ProfileHeader account={account} fallbackName={user.fullName} fallbackEmail={user.email} role={user.role} />

        <NotificationInbox onError={setError} />

        {account && <PersonalDetails account={account} />}

        <ChangePasswordCard onDone={(m) => { setNotice(m); setError(null); }} onError={(m) => { setError(m); setNotice(null); }} />

        {user.role === 'STUDENT' && <StudentActivity userId={user.userId} onError={setError} />}
        {user.role === 'EXTERNAL' && <ExternalActivity onError={setError} />}
      </div>
    </PortalShell>
  );
}

function ProfileHeader({ account, fallbackName, fallbackEmail, role }: {
  account: ManagedAccount | null; fallbackName: string; fallbackEmail: string; role: string;
}) {
  return (
    <div style={headerCard}>
      <div style={{ fontSize: 13, color: '#5c6773' }}>Signed in as</div>
      <div style={{ font: '600 22px var(--font-display)', color: '#26485f', marginTop: 2 }}>
        {account?.fullName ?? fallbackName}
      </div>
      <div style={{ fontSize: 13.5, color: '#5c6773', marginTop: 2 }}>
        {account?.email ?? fallbackEmail} · {role.replace('_', ' ')}
        {account?.status === 'DEACTIVATED' && <span style={{ ...statusPill, marginLeft: 8 }}>Deactivated</span>}
      </div>
    </div>
  );
}

// ── Notification inbox (AUTH-20) ──
function NotificationInbox({ onError }: { onError: (m: string) => void }) {
  const [items, setItems] = useState<AppNotification[] | null>(null);
  const [unread, setUnread] = useState(0);

  const load = useCallback(async () => {
    try {
      const [list, count] = await Promise.all([listNotifications(20), unreadNotificationCount()]);
      setItems(list.notifications);
      setUnread(count.count);
    } catch (e) { onError(errMsg(e)); }
  }, [onError]);
  useEffect(() => { void load(); }, [load]);

  async function onMarkRead(id: string) {
    try { await markNotificationRead(id); void load(); } catch (e) { onError(errMsg(e)); }
  }
  async function onMarkAll() {
    try { await markAllNotificationsRead(); void load(); } catch (e) { onError(errMsg(e)); }
  }

  return (
    <Panel title={`Notifications${unread > 0 ? ` (${unread} unread)` : ''}`}
      action={unread > 0 ? <button style={linkBtn} onClick={onMarkAll}>Mark all read</button> : undefined}>
      {items === null ? (
        <p style={muted}>Loading…</p>
      ) : items.length === 0 ? (
        <p style={muted}>No notifications yet. Account and activity updates will appear here.</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {items.map((n) => (
            <li key={n.notificationId}
              style={{ ...notifRow, ...(n.readAt ? {} : notifRowUnread) }}
              onClick={() => !n.readAt && onMarkRead(n.notificationId)}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                <span style={{ fontWeight: n.readAt ? 500 : 700, color: '#26485f' }}>{n.title}</span>
                <span style={{ fontSize: 11.5, color: '#8a949f', whiteSpace: 'nowrap' }}>{new Date(n.createdAt).toLocaleString()}</span>
              </div>
              <div style={{ fontSize: 13, color: '#5c6773', marginTop: 2 }}>{n.body}</div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

// ── Personal details (read-only) ──
function PersonalDetails({ account: a }: { account: ManagedAccount }) {
  const rows: Array<[string, string | undefined]> = a.role === 'STUDENT'
    ? [
        ['Full Name', a.fullName], ['Email', a.email],
        ['Enrollment', a.enrollmentNo], ['Department', a.department], ['Program', a.programTitle],
      ]
    : a.role === 'EXTERNAL'
    ? [
        ['Full Name', a.fullName], ['Email', a.email],
        ['Institution', a.institutionName], ['Designation', a.designation],
      ]
    : [
        ['Full Name', a.fullName], ['Email', a.email],
      ];

  return (
    <Panel title="Personal Details">
      {rows.map(([label, value]) => (
        <div key={label} style={detailRow}>
          <div style={detailLabel}>{label}</div>
          <div style={detailValue}>{value ?? '—'}</div>
        </div>
      ))}
      <p style={{ ...muted, marginTop: 12, marginBottom: 0 }}>
        Need to correct any of this? Contact the sports office — these fields aren't self-editable to keep enrollment/institution records reliable.
      </p>
    </Panel>
  );
}

// ── Change password (AUTH-17) ──
// AUTH-17, two-step: fill current+new+confirm, submit sends an OTP to your
// email (step-up confirmation, GitHub-"Verify via email"-style); entering
// that code actually applies the change.
function ChangePasswordCard({ onDone, onError }: { onDone: (m: string) => void; onError: (m: string) => void }) {
  const [step, setStep] = useState<'form' | 'code'>('form');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);

  async function onSubmitForm(e: FormEvent) {
    e.preventDefault();
    if (next !== confirm) { onError('New password and confirmation do not match.'); return; }
    setLoading(true);
    try {
      await requestChangePasswordOtp(current);
      setStep('code');
    } catch (err) {
      onError(errMsg(err));
    } finally {
      setLoading(false);
    }
  }

  async function onSubmitCode(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await confirmChangePassword(otp, next);
      onDone('Password changed. You may need to sign in again on other devices.');
      setStep('form'); setCurrent(''); setNext(''); setConfirm(''); setOtp('');
    } catch (err) {
      onError(errMsg(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Panel title="Change Password">
      {step === 'form' ? (
        <form onSubmit={onSubmitForm} noValidate style={{ maxWidth: 380 }}>
          <LabeledInput label="Current password:" icon={<LockIcon />} type="password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
          <LabeledInput label="New password:" icon={<LockIcon />} type="password" value={next} onChange={(e) => setNext(e.target.value)} required />
          <LabeledInput label="Confirm new password:" icon={<LockIcon />} type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
          <PrimaryButton type="submit" disabled={loading}>{loading ? 'Sending code…' : 'Send Confirmation Code'}</PrimaryButton>
        </form>
      ) : (
        <form onSubmit={onSubmitCode} noValidate style={{ maxWidth: 380 }}>
          <p style={{ ...muted, marginTop: 0 }}>We emailed an 8-digit code to confirm this change. It expires in 15 minutes.</p>
          <LabeledInput label="Confirmation code:" icon={<LockIcon />} placeholder="XXXXXXXX"
            inputMode="numeric" maxLength={8} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} required />
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <PrimaryButton type="submit" disabled={loading}>{loading ? 'Confirming…' : 'Confirm Change'}</PrimaryButton>
            <button type="button" style={linkBtn} onClick={() => setStep('form')}>Back</button>
          </div>
        </form>
      )}
    </Panel>
  );
}

// ── Student activity: reputation + recent requests ──
function StudentActivity({ userId, onError }: { userId: string; onError: (m: string) => void }) {
  const navigate = useNavigate();
  const [rep, setRep] = useState<Reputation | null>(null);
  const [requests, setRequests] = useState<MyRequest[] | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [r, req] = await Promise.all([getReputation(userId), listMyRequests()]);
        setRep(r);
        setRequests(req.requests);
      } catch (e) { onError(errMsg(e)); }
    })();
  }, [userId, onError]);

  return (
    <Panel title="Borrowing Activity" action={<button style={linkBtn} onClick={() => navigate('/availability')}>Request Equipment →</button>}>
      {rep && (
        <>
          {rep.isBadSport && (
            <div style={badSportBanner}>⚠ BAD SPORT — You have {rep.lateReturns} late return{rep.lateReturns !== 1 ? 's' : ''}. Repeated late returns affect your borrowing standing.</div>
          )}
          <div style={statsRow}>
            <Stat label="Total borrows" value={rep.totalBorrows} />
            <Stat label="Late returns" value={rep.lateReturns} warn={rep.lateReturns > 0} />
            <Stat label="Damaged returns" value={rep.damagedReturns} warn={rep.damagedReturns > 0} />
          </div>
        </>
      )}
      {requests === null ? (
        <p style={muted}>Loading…</p>
      ) : requests.length === 0 ? (
        <p style={muted}>No borrow requests yet.</p>
      ) : (
        <table style={historyTable}>
          <thead>
            <tr><th style={th}>Equipment</th><th style={th}>Window</th><th style={th}>Status</th><th style={th}>Note</th></tr>
          </thead>
          <tbody>
            {requests.map((r) => (
              <tr key={r.borrow_request_id}>
                <td style={td}>{r.equipment_type_name}</td>
                <td style={td}>{new Date(r.requested_start_at).toLocaleString()} → {new Date(r.requested_return_at).toLocaleTimeString()}</td>
                <td style={td}><span style={{ ...badgePill, ...pillColorForStatus(r.status) }}>{r.status}</span></td>
                <td style={{ ...td, color: '#8f2323' }}>{r.rejection_reason ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}

// ── External activity: recent venue bookings ──
function ExternalActivity({ onError }: { onError: (m: string) => void }) {
  const navigate = useNavigate();
  const [bookings, setBookings] = useState<MyBooking[] | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await listMyBookings();
        setBookings(res.bookings.slice(0, 5));
      } catch (e) { onError(errMsg(e)); }
    })();
  }, [onError]);

  return (
    <Panel title="Venue Booking Activity" action={<button style={linkBtn} onClick={() => navigate('/book-venue')}>Go to Bookings →</button>}>
      {bookings === null ? (
        <p style={muted}>Loading…</p>
      ) : bookings.length === 0 ? (
        <p style={muted}>No venue bookings yet.</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {bookings.map((b) => (
            <li key={b.booking_id} style={activityRow}>
              <span>{b.venue_name} · {b.sessionCount} session{b.sessionCount === 1 ? '' : 's'}</span>
              <span style={{ ...badgePill, ...pillColorForStatus(b.status) }}>{b.status}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function Stat({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div style={statBox}>
      <div style={{ fontSize: 22, fontWeight: 700, color: warn ? '#b3352b' : '#26485f' }}>{value}</div>
      <div style={{ fontSize: 12, color: '#8a949f' }}>{label}</div>
    </div>
  );
}

function pillColorForStatus(status: string): React.CSSProperties {
  if (['APPROVED', 'ACTIVE', 'COMPLETED'].includes(status)) return { background: '#e6f4ec', color: '#1f7a45' };
  if (['REJECTED', 'CANCELLED', 'COMPLETED_LATE', 'COMPLETED_DAMAGED'].includes(status)) return { background: '#fbe9e7', color: '#b3352b' };
  return { background: '#eef2f6', color: '#5c6773' };
}

function Panel({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section style={panel}>
      <div style={panelHead}><span>{title}</span>{action}</div>
      <div style={panelBody}>{children}</div>
    </section>
  );
}

const wrap: React.CSSProperties = { maxWidth: 720, margin: '0 auto' };
const headerCard: React.CSSProperties = { background: '#fff', border: '1px solid #ddd', borderRadius: 4, padding: '18px 20px', marginBottom: 18, boxShadow: '0 1px 2px rgba(0,0,0,0.05)' };
const statusPill: React.CSSProperties = { font: '600 11px var(--font-mono)', padding: '2px 7px', borderRadius: 4, background: '#fbe9e7', color: '#b3352b' };
const panel: React.CSSProperties = { background: '#fff', border: '1px solid #ddd', borderRadius: 4, marginBottom: 18, boxShadow: '0 1px 2px rgba(0,0,0,0.05)' };
const panelHead: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 20px', borderBottom: '1px solid #e5e5e5', font: '600 15px var(--font-body)', color: '#333', background: 'linear-gradient(#fff,#f7f7f7)' };
const panelBody: React.CSSProperties = { padding: 20 };
const muted: React.CSSProperties = { color: '#5c6773', fontSize: 14, margin: 0 };
const detailRow: React.CSSProperties = { display: 'grid', gridTemplateColumns: '140px 1fr', padding: '9px 0', borderBottom: '1px solid #f0f0f0' };
const detailLabel: React.CSSProperties = { font: '600 13px var(--font-body)', color: '#555' };
const detailValue: React.CSSProperties = { fontSize: 14, color: '#222' };
const linkBtn: React.CSSProperties = { background: 'none', border: 'none', font: '500 13px var(--font-body)', color: '#0a6ebd', cursor: 'pointer', padding: 0 };
const notifRow: React.CSSProperties = { padding: '10px 4px', borderBottom: '1px solid #f0f0f0', cursor: 'pointer' };
const notifRowUnread: React.CSSProperties = { background: '#f7fbff' };
const badSportBanner: React.CSSProperties = { background: '#fef0ee', color: '#8f2323', border: '1px solid #f3caca', borderRadius: 4, padding: '10px 14px', marginBottom: 12, fontSize: 13.5, font: '600 13.5px var(--font-body)' };
const statsRow: React.CSSProperties = { display: 'flex', gap: 14, marginBottom: 8 };
const statBox: React.CSSProperties = { flex: 1, textAlign: 'center', padding: '10px 6px', background: '#f7f9fb', borderRadius: 6 };
const activityRow: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 4px', borderBottom: '1px solid #f0f0f0', fontSize: 13.5, color: '#333' };
const historyTable: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 13.5, marginTop: 12 };
const th: React.CSSProperties = { textAlign: 'left', font: '600 11px var(--font-body)', color: '#888', textTransform: 'uppercase', letterSpacing: '0.04em', padding: '0 8px 8px', borderBottom: '1px solid #e5e5e5' };
const td: React.CSSProperties = { padding: '9px 8px', borderBottom: '1px solid #eee', color: '#333' };
const badgePill: React.CSSProperties = { font: '600 10.5px var(--font-mono)', padding: '2px 8px', borderRadius: 4 };
const box = {
  error: { background: '#fdecec', color: '#8f2323', border: '1px solid #f3caca', borderRadius: 4, padding: '10px 14px', marginBottom: 16, fontSize: 14 } as React.CSSProperties,
  ok: { background: '#eaf6ee', color: '#1e6b3a', border: '1px solid #c2e6cd', borderRadius: 4, padding: '10px 14px', marginBottom: 16, fontSize: 14 } as React.CSSProperties,
};
