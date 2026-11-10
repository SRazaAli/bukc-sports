/**
 * Profile — every authenticated role gets this screen (AUTH-17: change your
 * own password from your profile; AUTH-20: notifications visible in the
 * profile notification inbox). Personal details and change-password are
 * universal; the activity/stats section is role-specific — Student sees
 * borrow reputation + recent requests, External sees recent venue bookings,
 * Coordinator/Super Admin get the lighter base profile only (see the chat
 * writeup for why).
 *
 * Visuals live in ProfileUI.tsx (a dedicated kit, same pattern as AuthUI.tsx)
 * so this redesign never touches PortalShell or any other screen. All data
 * fetching / handlers below are unchanged from the previous version.
 */
import { useEffect, useState, useCallback, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth.js';
import { getMyProfile, requestChangePasswordOtp, confirmChangePassword, type ManagedAccount } from './api.js';
import { listNotifications, unreadNotificationCount, markNotificationRead, markAllNotificationsRead, type AppNotification } from '../notifications/api.js';
import { listMyBookings, type MyBooking } from '../venue/api.js';
import { ApiRequestError } from '../../lib/api.js';
import { useBackStep } from '../../components/backStack.js';
import {
  ProfilePage, ProfileTopBar, ProfileMain, ProfileGrid, ProfileFooter,
  IdentityCard, Panel, LinkBtn, DetailRow, Banner, NotifItem, CountPill,
  StatusPill, ActivityRow, Muted,
  PfField, PfInput, PfPasswordInput, PfButton, palette,
  roleToPortalKey,
  BellIcon, IdCardIcon, KeyIcon, CalendarIcon,
} from './ProfileUI.js';

function errMsg(e: unknown) { return e instanceof ApiRequestError ? e.body.error : 'Something went wrong.'; }

export default function ProfileScreen() {
  const { user, loading: authLoading, logout } = useAuth();
  const navigate = useNavigate();
  const [account, setAccount] = useState<ManagedAccount | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await getMyProfile();
      setAccount(res.account);
    } catch (e) { setError(errMsg(e)); }
  }, []);
  useEffect(() => {
    if (authLoading || !user) return;
    void load();
  }, [authLoading, user, load]);

  async function onSignOut() {
    await logout();
    navigate('/');
  }

  if (authLoading || !user) {
    return (
      <ProfilePage>
        <ProfileTopBar onBack={() => navigate(-1)} onSignOut={onSignOut} />
        <ProfileMain><p /></ProfileMain>
      </ProfilePage>
    );
  }

  const portal = roleToPortalKey(user.role);

  return (
    <ProfilePage>
      <ProfileTopBar onBack={() => navigate(-1)} onSignOut={onSignOut} />
      <ProfileMain>
        {error && <Banner kind="error">{error}</Banner>}
        {notice && <Banner kind="ok">{notice}</Banner>}

        <ProfileGrid
          sidebar={
            <>
              <IdentityCard
                portal={portal}
                name={account?.fullName ?? user.fullName}
                email={account?.email ?? user.email}
                roleLabel={user.role.replace('_', ' ')}
                deactivated={account?.status === 'DEACTIVATED'}
              />
              {account && <PersonalDetails account={account} />}
            </>
          }
        >
          <NotificationInbox onError={setError} />

          <ChangePasswordCard onDone={(m) => { setNotice(m); setError(null); }} onError={(m) => { setError(m); setNotice(null); }} />

          {user.role === 'EXTERNAL' && <ExternalActivity onError={setError} />}
        </ProfileGrid>
      </ProfileMain>
      <ProfileFooter />
    </ProfilePage>
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
    <Panel
      icon={<BellIcon />}
      title="Notifications"
      action={
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {unread > 0 && <CountPill>{unread} unread</CountPill>}
          {unread > 0 && <LinkBtn onClick={onMarkAll}>Mark all read</LinkBtn>}
        </div>
      }
    >
      {items === null ? (
        <Muted>Loading…</Muted>
      ) : items.length === 0 ? (
        <Muted>No notifications yet. Account and activity updates will appear here.</Muted>
      ) : (
        <div style={{ maxHeight: 420, overflowY: 'auto', paddingRight: 4 }}>
          {items.map((n) => (
            <NotifItem
              key={n.notificationId}
              title={n.title}
              body={n.body}
              time={new Date(n.createdAt).toLocaleString()}
              unread={!n.readAt}
              onClick={n.readAt ? undefined : () => onMarkRead(n.notificationId)}
            />
          ))}
        </div>
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
    <Panel icon={<IdCardIcon />} title="Personal Details">
      {rows.map(([label, value]) => <DetailRow key={label} label={label} value={value} />)}
      <p style={{ fontSize: 12, color: palette.slate500, marginTop: 12, marginBottom: 0, lineHeight: 1.5 }}>
        Need to correct any of this? Contact the sports office — these fields aren't self-editable to keep enrollment/institution records reliable.
      </p>
    </Panel>
  );
}

// ── Quick links (role-based shortcuts) ──
// Fills out the sidebar with real navigation instead of leaving it as just
// two short cards — the sidebar is otherwise much shorter than the activity
// column, which is what left that empty gap on the left as you scrolled.
function ChangePasswordCard({ onDone, onError }: { onDone: (m: string) => void; onError: (m: string) => void }) {
  const [step, setStep] = useState<'form' | 'code'>('form');
  // Go back (top right) from the code step returns to the password form (same as its Back link).
  useBackStep(step === 'code', () => setStep('form'));
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
    <Panel icon={<KeyIcon />} title="Change Password">
      {step === 'form' ? (
        <form onSubmit={onSubmitForm} noValidate style={{ maxWidth: 400 }}>
          <PfField label="Current password:">
            <PfPasswordInput value={current} onChange={(e) => setCurrent(e.target.value)} required />
          </PfField>
          <PfField label="New password:">
            <PfPasswordInput value={next} onChange={(e) => setNext(e.target.value)} required />
          </PfField>
          <PfField label="Confirm new password:">
            <PfPasswordInput value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
          </PfField>
          <PfButton type="submit" disabled={loading}>{loading ? 'Sending code…' : 'Send Confirmation Code'}</PfButton>
        </form>
      ) : (
        <form onSubmit={onSubmitCode} noValidate style={{ maxWidth: 400 }}>
          <Muted>We emailed an 8-digit code to confirm this change. It expires in 15 minutes.</Muted>
          <div style={{ height: 12 }} />
          <PfField label="Confirmation code:">
            <PfInput placeholder="XXXXXXXX" inputMode="numeric" maxLength={8} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} required />
          </PfField>
          <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
            <PfButton type="submit" disabled={loading}>{loading ? 'Confirming…' : 'Confirm Change'}</PfButton>
            <LinkBtn type="button" onClick={() => setStep('form')}>Back</LinkBtn>
          </div>
        </form>
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
    <Panel icon={<CalendarIcon />} title="Venue Booking Activity" accent
      action={<LinkBtn onClick={() => navigate('/book-venue')}>Go to Bookings →</LinkBtn>}>
      {bookings === null ? (
        <Muted>Loading…</Muted>
      ) : bookings.length === 0 ? (
        <Muted>No venue bookings yet.</Muted>
      ) : (
        <div>
          {bookings.map((b) => (
            <ActivityRow key={b.booking_id}>
              <span>{b.venue_name} · {b.sessionCount} session{b.sessionCount === 1 ? '' : 's'}</span>
              <StatusPill status={b.status} />
            </ActivityRow>
          ))}
        </div>
      )}
    </Panel>
  );
}
