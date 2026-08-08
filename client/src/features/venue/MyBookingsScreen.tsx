/**
 * Student/External — Book a Venue (VENUE-04..14, multi-session VENUE-06/35).
 * Submit a request (one or more sessions) and track its status.
 */
import { useEffect, useState, useCallback } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth.js';
import { PortalShell, PrimaryButton } from '../auth/PortalShell.js';
import { listVenues, submitBooking, listMyBookings, confirmShortfall, type Venue, type MyBooking } from './api.js';
import { useSessionRows, SessionRowsEditor } from './SessionsBuilder.js';
import { ApiRequestError } from '../../lib/api.js';

function errMsg(e: unknown) { return e instanceof ApiRequestError ? e.body.error : 'Something went wrong.'; }

export default function MyBookingsScreen() {
  const { user, loading } = useAuth();
  const [venues, setVenues] = useState<Venue[]>([]);
  const [bookings, setBookings] = useState<MyBooking[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [v, b] = await Promise.all([listVenues(), listMyBookings()]);
      setVenues(v.venues); setBookings(b.bookings);
    } catch (e) { setError(errMsg(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (loading) return <PortalShell title="Book a Venue"><p /></PortalShell>;
  if (!user) return <Navigate to="/" replace />;
  if (user.role !== 'STUDENT' && user.role !== 'EXTERNAL') return <Navigate to="/home" replace />;

  return (
    <PortalShell title="Book a Venue" tint="sage">
      <div style={wrap}>
        {error && <div style={box.err}>{error}</div>}
        {notice && <div style={box.ok}>{notice}</div>}

        <Panel title="Request a Venue">
          <RequestForm venues={venues} onDone={(m) => { setNotice(m); setError(null); void load(); }} onError={(m) => { setError(m); setNotice(null); }} />
        </Panel>

        <Panel title="My Bookings">
          {bookings.length === 0 ? <p style={muted}>No booking requests yet.</p> : (
            <table style={table}>
              <thead><tr><th style={th}>Venue</th><th style={th}>Sessions</th><th style={th}>Status</th><th style={th}>Note</th><th style={th} /></tr></thead>
              <tbody>
                {bookings.map((b) => (
                  <tr key={b.booking_id}>
                    <td style={td}>{b.venue_name}</td>
                    <td style={td}>
                      {b.sessionCount > 1 ? `${b.sessionCount} sessions · ` : ''}
                      {b.firstStart ? new Date(b.firstStart).toLocaleDateString() : '—'}
                      {b.lastEnd && b.sessionCount > 1 ? ` → ${new Date(b.lastEnd).toLocaleDateString()}` : ''}
                    </td>
                    <td style={td}><span style={{ ...badgeBase, ...statusBadge(b.status) }}>{b.status}</span></td>
                    <td style={{ ...td, color: '#8f2323' }}>{b.rejection_reason ?? ''}</td>
                    <td style={{ ...td, textAlign: 'right' }}>
                      {b.status === 'SHORTFALL_PENDING' && (
                        <ShortfallActions bookingId={b.booking_id}
                          onDone={(m) => { setNotice(m); setError(null); void load(); }}
                          onError={(m) => { setError(m); setNotice(null); }} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      </div>
    </PortalShell>
  );
}

function ShortfallActions({ bookingId, onDone, onError }: { bookingId: string; onDone: (m: string) => void; onError: (m: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [showDecline, setShowDecline] = useState(false);

  async function respond(confirm: boolean) {
    setBusy(true);
    try {
      await confirmShortfall(bookingId, confirm);
      onDone(confirm
        ? 'Confirmed — your booking is back with the Coordinator for forwarding.'
        : 'You declined — the booking has been rejected.');
    } catch (e) { onError(e instanceof ApiRequestError ? e.body.error : 'Something went wrong.'); }
    finally { setBusy(false); }
  }

  if (showDecline) {
    return (
      <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
        <span style={{ fontSize: 12.5, color: '#5c6773' }}>Sure?</span>
        <button style={smallDanger} disabled={busy} onClick={() => respond(false)}>Yes, decline</button>
        <button style={smallGhost} onClick={() => setShowDecline(false)}>Cancel</button>
      </span>
    );
  }
  return (
    <span style={{ display: 'inline-flex', gap: 6 }}>
      <button style={smallAccept} disabled={busy} onClick={() => respond(true)}>I'll supply it</button>
      <button style={smallGhost} onClick={() => setShowDecline(true)}>Decline</button>
    </span>
  );
}

function RequestForm({ venues, onDone, onError }: { venues: Venue[]; onDone: (m: string) => void; onError: (m: string) => void }) {
  const [venueId, setVenue] = useState(0);
  const [purpose, setPurpose] = useState('');
  const [estimatedParticipants, setParticipants] = useState(10);
  const [busy, setBusy] = useState(false);
  const { rows, addRow, removeRow, updateRow, toSessionInputs } = useSessionRows();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!venueId) { onError('Choose a venue.'); return; }
    setBusy(true);
    try {
      await submitBooking({ venueId, purpose, estimatedParticipants, sessions: toSessionInputs() });
      onDone('Booking request submitted. You will be notified once it is reviewed.');
    } catch (e) { onError(errMsg(e)); } finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} style={formGrid}>
      <L label="Venue"><select style={inp} value={venueId} onChange={(e) => setVenue(Number(e.target.value))} required>
        <option value={0}>Select</option>
        {venues.map((v) => <option key={v.venue_id} value={v.venue_id}>{v.name} (cap. {v.capacity})</option>)}
      </select></L>
      <L label="Estimated participants"><input type="number" min={1} style={inp} value={estimatedParticipants} onChange={(e) => setParticipants(Number(e.target.value))} required /></L>
      <div style={{ gridColumn: '1 / -1' }}>
        <L label="Purpose"><input style={inp} value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="e.g. Practice match, or Inter-department tournament" required /></L>
      </div>

      <SessionRowsEditor rows={rows} onAdd={addRow} onRemove={removeRow} onUpdate={updateRow} />

      <div style={{ gridColumn: '1 / -1' }}><PrimaryButton disabled={busy}>{busy ? 'Submitting…' : 'Submit Request'}</PrimaryButton></div>
    </form>
  );
}

function statusBadge(s: string) {
  if (s === 'APPROVED' || s === 'COMPLETED') return badge.ok;
  if (s === 'REJECTED' || s === 'CANCELLED') return badge.danger;
  return badge.warn;
}
function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return <section style={panel}><div style={panelHead}>{title}</div><div style={panelBody}>{children}</div></section>;
}
function L({ label, children }: { label: string; children: React.ReactNode }) {
  return <label style={{ display: 'block' }}><span style={lbl}>{label}</span>{children}</label>;
}

const wrap: React.CSSProperties = { maxWidth: 860, margin: '0 auto' };
const panel: React.CSSProperties = { background: '#fff', border: '1px solid #ddd', borderRadius: 4, marginBottom: 18, boxShadow: '0 1px 2px rgba(0,0,0,0.05)' };
const panelHead: React.CSSProperties = { padding: '12px 18px', borderBottom: '1px solid #e5e5e5', font: '600 15px var(--font-body)', color: '#333', background: 'linear-gradient(#fff,#f7f7f7)' };
const panelBody: React.CSSProperties = { padding: 18 };
const table: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 14 };
const th: React.CSSProperties = { textAlign: 'left', font: '600 11px var(--font-body)', color: '#888', textTransform: 'uppercase', letterSpacing: '0.04em', padding: '0 8px 8px', borderBottom: '1px solid #e5e5e5' };
const td: React.CSSProperties = { padding: '10px 8px', borderBottom: '1px solid #eee', color: '#333' };
const muted: React.CSSProperties = { color: '#5c6773', fontSize: 14.5, margin: 0 };
const formGrid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, maxWidth: 620 };
const lbl: React.CSSProperties = { display: 'block', font: '500 12px var(--font-body)', color: '#26485f', marginBottom: 5 };
const inp: React.CSSProperties = { width: '100%', font: '14px var(--font-body)', padding: '8px 10px', border: '1px solid #ccc', borderRadius: 4 };
const badgeBase: React.CSSProperties = { font: '600 11px var(--font-mono)', padding: '2px 7px', borderRadius: 4 };
const badge = {
  ok: { background: '#e6f4ec', color: '#1f7a45' } as React.CSSProperties,
  warn: { background: '#fdf1e3', color: '#9a6412' } as React.CSSProperties,
  danger: { background: '#fbe9e7', color: '#b3352b' } as React.CSSProperties,
};
const smallAccept: React.CSSProperties = { background: '#1f8a4c', color: '#fff', border: 'none', borderRadius: 4, padding: '5px 10px', fontSize: 12.5, cursor: 'pointer' };
const smallDanger: React.CSSProperties = { background: '#c0392b', color: '#fff', border: 'none', borderRadius: 4, padding: '5px 10px', fontSize: 12.5, cursor: 'pointer' };
const smallGhost: React.CSSProperties = { background: '#fff', color: '#555', border: '1px solid #ccc', borderRadius: 4, padding: '5px 10px', fontSize: 12.5, cursor: 'pointer' };
const box = {
  err: { background: '#fdecec', color: '#8f2323', border: '1px solid #f3caca', borderRadius: 4, padding: '10px 14px', marginBottom: 16, fontSize: 14 } as React.CSSProperties,
  ok: { background: '#eaf6ee', color: '#1e6b3a', border: '1px solid #c2e6cd', borderRadius: 4, padding: '10px 14px', marginBottom: 16, fontSize: 14 } as React.CSSProperties,
};
