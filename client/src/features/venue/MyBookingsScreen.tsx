/**
 * Student/External — My Bookings + Book a Venue. Redesigned with AppShell.
 * Backend unchanged: listVenues, submitBooking, listMyBookings, confirmShortfall.
 */
import { useEffect, useState, useCallback, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth.js';
import AppShell, { PageHeader, Card, Btn, Badge, EmptyState, ErrorBox, SuccessBox, Th, Td, TableWrapper } from '../../components/AppShell.js';
import { listVenues, submitBooking, listMyBookings, confirmShortfall, type Venue, type MyBooking, type SessionInput } from './api.js';
import { ApiRequestError } from '../../lib/api.js';

function errMsg(e: unknown) { return e instanceof ApiRequestError ? e.body.error : 'Something went wrong.'; }

export default function MyBookingsScreen() {
  const { user, loading } = useAuth();
  const [venues,   setVenues]   = useState<Venue[]>([]);
  const [bookings, setBookings] = useState<MyBooking[]>([]);
  const [error,    setError]    = useState<string | null>(null);
  const [notice,   setNotice]   = useState<string | null>(null);

  const load = useCallback(async () => {
    try { const [v, b] = await Promise.all([listVenues(), listMyBookings()]); setVenues(v.venues); setBookings(b.bookings); }
    catch (e) { setError(errMsg(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (loading) return <AppShell title="Book a Venue"><p /></AppShell>;
  if (!user) return <Navigate to="/" replace />;
  if (user.role !== 'STUDENT' && user.role !== 'EXTERNAL') return <Navigate to="/home" replace />;

  const flash = { ok: (m: string) => { setNotice(m); setError(null); void load(); }, err: (m: string) => { setError(m); setNotice(null); } };

  return (
    <AppShell title="Venue Booking">
      <PageHeader title="Venue Booking" subtitle="Request a venue and track your booking status" />
      {error  && <ErrorBox message={error} />}
      {notice && <SuccessBox message={notice} />}
      <div style={{ display: 'grid', gap: 'var(--sp-4)' }}>
        <Card style={{ padding: 'var(--sp-5)' }}>
          <div style={secTitle}>Book a Venue</div>
          <BookForm venues={venues} onDone={flash.ok} onError={flash.err} />
        </Card>
        <Card style={{ padding: 'var(--sp-5)' }}>
          <div style={secTitle}>My Bookings</div>
          {bookings.length === 0 ? <EmptyState title="No bookings yet" body="Use the form above to request a venue." /> : (
            <TableWrapper>
              <thead><tr><th style={Th}>Venue</th><th style={Th}>Sessions</th><th style={Th}>Status</th><th style={Th}>Note</th><th style={Th} /></tr></thead>
              <tbody>{bookings.map((b) => (
                <tr key={b.booking_id}>
                  <td style={Td}>{b.venue_name}</td>
                  <td style={{ ...Td, fontSize: 13 }}>
                    {b.sessionCount} session{b.sessionCount > 1 ? 's' : ''}
                    {b.firstStart ? ` · from ${new Date(b.firstStart).toLocaleDateString('en-GB', { day:'2-digit', month:'short' })}` : ''}
                  </td>
                  <td style={Td}><Badge status={b.status} /></td>
                  <td style={{ ...Td, color: 'var(--danger)', fontSize: 13 }}>{b.rejection_reason ?? ''}</td>
                  <td style={{ ...Td, textAlign: 'right' }}>
                    {b.status === 'SHORTFALL_PENDING' && (
                      <ShortfallActions bookingId={b.booking_id} onDone={flash.ok} onError={flash.err} />
                    )}
                  </td>
                </tr>
              ))}</tbody>
            </TableWrapper>
          )}
        </Card>
      </div>
    </AppShell>
  );
}

function BookForm({ venues, onDone, onError }: { venues: Venue[]; onDone: (m: string) => void; onError: (m: string) => void }) {
  const [venueId,     setVenueId]     = useState(0);
  const [purpose,     setPurpose]     = useState('');
  const [participants,setParticipants]= useState(10);
  const [startAt,     setStartAt]     = useState('');
  const [endAt,       setEndAt]       = useState('');
  const [teamName,    setTeamName]    = useState('');
  const [busy,        setBusy]        = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!venueId) { onError('Select a venue.'); return; }
    setBusy(true);
    try {
      const session: SessionInput = { sessionNo: 1, requestedStartAt: startAt, requestedEndAt: endAt, teamName };
      await submitBooking({ venueId, purpose, estimatedParticipants: participants, sessions: [session] });
      onDone('Booking submitted — the coordinator will review it shortly.');
      setVenueId(0); setPurpose(''); setStartAt(''); setEndAt(''); setTeamName('');
    } catch (e) { onError(e instanceof ApiRequestError ? e.body.error : 'Could not submit.'); }
    finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} noValidate style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px,1fr))', gap: 'var(--sp-3)' }}>
      <div>
        <label style={lbl}>Venue</label>
        <select style={inp} value={venueId} onChange={(e) => setVenueId(Number(e.target.value))} required>
          <option value={0}>Select venue…</option>
          {venues.filter((v) => v.is_active).map((v) => <option key={v.venue_id} value={v.venue_id}>{v.name} (cap. {v.capacity})</option>)}
        </select>
      </div>
      <div>
        <label style={lbl}>Purpose</label>
        <input style={inp} value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="e.g. Cricket practice" required />
      </div>
      <div>
        <label style={lbl}>Team / Group Name</label>
        <input style={inp} value={teamName} onChange={(e) => setTeamName(e.target.value)} placeholder="e.g. CS-A Cricket XI" required />
      </div>
      <div>
        <label style={lbl}>Est. Participants</label>
        <input style={inp} type="number" min={1} value={participants} onChange={(e) => setParticipants(Number(e.target.value))} required />
      </div>
      <div>
        <label style={lbl}>Start</label>
        <input style={inp} type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} required />
      </div>
      <div>
        <label style={lbl}>End</label>
        <input style={inp} type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} required />
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end' }}>
        <Btn type="submit" loading={busy} style={{ width: '100%' }}>Submit Booking</Btn>
      </div>
    </form>
  );
}

function ShortfallActions({ bookingId, onDone, onError }: { bookingId: string; onDone: (m: string) => void; onError: (m: string) => void }) {
  const [busy, setBusy] = useState(false);
  async function respond(confirm: boolean) {
    setBusy(true);
    try {
      await confirmShortfall(bookingId, confirm);
      onDone(confirm ? "Confirmed — booking returned to coordinator." : "Declined — booking has been cancelled.");
    } catch (e) { onError(e instanceof ApiRequestError ? e.body.error : 'Could not respond.'); }
    finally { setBusy(false); }
  }
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      <Btn size="sm" onClick={() => respond(true)} loading={busy}>I'll supply it</Btn>
      <Btn size="sm" variant="danger" onClick={() => respond(false)} loading={busy}>Decline</Btn>
    </div>
  );
}

const secTitle: React.CSSProperties = { font: '600 14px var(--font-display)', color: 'var(--navy)', marginBottom: 'var(--sp-4)' };
const lbl: React.CSSProperties = { display: 'block', font: '500 12.5px var(--font-body)', color: 'var(--ink-muted)', marginBottom: 5 };
const inp: React.CSSProperties = { width: '100%', font: '13.5px var(--font-body)', padding: '8px 11px', border: '1px solid var(--line)', borderRadius: 'var(--radius)', outline: 'none', background: 'var(--white)', color: 'var(--ink)' };
