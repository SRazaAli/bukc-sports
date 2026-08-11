/**
 * Coordinator — Venue Queue (VENUE-09..17, 28/29). Redesigned with AppShell.
 * Backend unchanged: listQueue, forwardBooking, rejectBooking, getBooking, listVenues, initiateAcademicEvent, planAllocation.
 */
import { useEffect, useState, useCallback, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth.js';
import AppShell, { PageHeader, Card, Btn, Badge, EmptyState, ErrorBox, SuccessBox, Th, Td, TableWrapper } from '../../components/AppShell.js';
import { listQueue, forwardBooking, rejectBooking, getBooking, listVenues, initiateAcademicEvent, type QueueBooking, type BookingDetail, type Venue, type SessionInput } from './api.js';
import { ApiRequestError } from '../../lib/api.js';

function errMsg(e: unknown) { return e instanceof ApiRequestError ? e.body.error : 'Something went wrong.'; }

export default function VenueQueueScreen() {
  const { user, loading } = useAuth();
  const [queue,    setQueue]    = useState<QueueBooking[] | null>(null);
  const [selected, setSelected] = useState<QueueBooking | null>(null);
  const [venues,   setVenues]   = useState<Venue[]>([]);
  const [showAcad, setShowAcad] = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const [notice,   setNotice]   = useState<string | null>(null);

  const load = useCallback(async () => {
    try { const [q, v] = await Promise.all([listQueue(), listVenues()]); setQueue(q.queue); setVenues(v.venues); }
    catch (e) { setError(errMsg(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (loading) return <AppShell title="Venue Queue"><p /></AppShell>;
  if (!user) return <Navigate to="/" replace />;
  if (user.role !== 'COORDINATOR') return <Navigate to="/home" replace />;

  const flash = { ok: (m: string) => { setNotice(m); setError(null); setSelected(null); void load(); }, err: (m: string) => { setError(m); setNotice(null); } };

  return (
    <AppShell title="Venue Queue">
      <PageHeader title="Venue Queue" subtitle="Review and forward booking requests to the administrator">
        <Btn variant="secondary" onClick={() => setShowAcad((v) => !v)}>{showAcad ? 'Close' : 'Initiate Academic Event'}</Btn>
      </PageHeader>
      {error  && <ErrorBox message={error} />}
      {notice && <SuccessBox message={notice} />}

      {showAcad && (
        <Card style={{ padding: 'var(--sp-5)', marginBottom: 'var(--sp-4)' }}>
          <div style={secTitle}>Initiate Academic Event</div>
          <AcademicForm venues={venues} onDone={flash.ok} onError={flash.err} onClose={() => setShowAcad(false)} />
        </Card>
      )}

      {selected ? (
        <ReviewPanel item={selected} onBack={() => setSelected(null)} onDone={flash.ok} onError={flash.err} />
      ) : (
        <Card style={{ padding: 'var(--sp-5)' }}>
          <div style={{ ...secTitle, marginBottom: 'var(--sp-4)' }}>
            Pending Requests
            {queue && queue.length > 0 && <span style={{ marginLeft: 8, background: 'var(--teal)', color: '#fff', font: '600 10px var(--font-mono)', padding: '2px 6px', borderRadius: 10 }}>{queue.length}</span>}
          </div>
          {queue === null ? <p style={{ color: 'var(--ink-muted)' }}>Loading…</p>
          : queue.length === 0 ? <EmptyState title="No pending requests" body="New bookings appear here for review." />
          : (
            <TableWrapper>
              <thead><tr><th style={Th}>Requester</th><th style={Th}>Venue</th><th style={Th}>Sessions</th><th style={Th}>Participants</th><th style={Th}>Submitted</th><th style={Th} /></tr></thead>
              <tbody>{queue.map((q) => (
                <tr key={q.booking_id}>
                  <td style={Td}>{q.requester_name ?? 'BUKC Sports Dept.'}<br /><span style={{ font: '11px var(--font-mono)', color: 'var(--ink-faint)' }}>{q.origin}</span></td>
                  <td style={Td}>{q.venue_name}</td>
                  <td style={Td}>{q.sessionCount}{q.firstStart ? ` · from ${new Date(q.firstStart).toLocaleDateString('en-GB', { day:'2-digit', month:'short' })}` : ''}</td>
                  <td style={Td}>{q.estimated_participants}</td>
                  <td style={{ ...Td, fontSize: 13 }}>{new Date(q.submitted_at).toLocaleDateString('en-GB', { day:'2-digit', month:'short' })}</td>
                  <td style={{ ...Td, textAlign: 'right' }}><Btn size="sm" onClick={() => setSelected(q)}>Review</Btn></td>
                </tr>
              ))}</tbody>
            </TableWrapper>
          )}
        </Card>
      )}
    </AppShell>
  );
}

function ReviewPanel({ item, onBack, onDone, onError }: { item: QueueBooking; onBack: () => void; onDone: (m: string) => void; onError: (m: string) => void }) {
  const [detail,    setDetail]    = useState<BookingDetail | null>(null);
  const [note,      setNote]      = useState('');
  const [reason,    setReason]    = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [busy,      setBusy]      = useState(false);

  useEffect(() => {
    getBooking(item.booking_id).then(setDetail).catch((e) => onError(errMsg(e)));
  }, [item.booking_id]);

  async function forward() {
    setBusy(true);
    try { await forwardBooking(item.booking_id, note); onDone('Booking forwarded to the administrator.'); }
    catch (e) { onError(errMsg(e)); } finally { setBusy(false); }
  }
  async function reject() {
    if (!reason.trim()) return;
    setBusy(true);
    try { await rejectBooking(item.booking_id, reason); onDone('Booking rejected. Requester notified.'); }
    catch (e) { onError(errMsg(e)); } finally { setBusy(false); }
  }

  return (
    <Card style={{ padding: 'var(--sp-5)', maxWidth: 680 }}>
      <button onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--teal)', font: '13px var(--font-body)', padding: 0, marginBottom: 'var(--sp-4)' }}>← Back to queue</button>
      <div style={secTitle}>Review Booking</div>
      {!detail ? <p style={{ color: 'var(--ink-muted)' }}>Loading details…</p> : (
        <>
          {[['Venue', detail.venue_name], ['Purpose', detail.purpose], ['Participants', String(detail.estimated_participants)], ['Sessions', String(detail.sessions.length)], ['Origin', detail.origin]].map(([k, v]) => (
            <div key={k} style={{ display: 'grid', gridTemplateColumns: '140px 1fr', padding: '9px 0', borderBottom: '1px solid var(--line-light)' }}>
              <span style={{ font: '500 13px var(--font-body)', color: 'var(--ink-muted)' }}>{k}</span>
              <span style={{ font: '14px var(--font-body)', color: 'var(--ink)' }}>{v}</span>
            </div>
          ))}
          <div style={{ marginTop: 'var(--sp-4)', marginBottom: 'var(--sp-4)' }}>
            <label style={lbl}>Feasibility note (optional)</label>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Notes for the administrator…" style={{ width: '100%', font: '14px var(--font-body)', padding: '9px 12px', border: '1px solid var(--line)', borderRadius: 'var(--radius)', resize: 'vertical', outline: 'none' }} />
          </div>
          {rejecting ? (
            <>
              <label style={lbl}>Rejection reason (emailed to requester)</label>
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="e.g. Venue is unavailable during these dates." style={{ width: '100%', font: '14px var(--font-body)', padding: '9px 12px', border: '1px solid var(--line)', borderRadius: 'var(--radius)', resize: 'vertical', outline: 'none', marginBottom: 'var(--sp-3)' }} />
              <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
                <Btn variant="danger" disabled={!reason.trim()} onClick={reject} loading={busy}>Confirm Rejection</Btn>
                <Btn variant="secondary" onClick={() => setRejecting(false)}>Cancel</Btn>
              </div>
            </>
          ) : (
            <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
              <Btn onClick={forward} loading={busy}>Forward to Admin</Btn>
              <Btn variant="danger" onClick={() => setRejecting(true)}>Reject…</Btn>
              <Btn variant="secondary" onClick={onBack}>Back</Btn>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

function AcademicForm({ venues, onDone, onError, onClose }: { venues: Venue[]; onDone: (m: string) => void; onError: (m: string) => void; onClose: () => void }) {
  const [venueId,  setVenueId]  = useState(0);
  const [purpose,  setPurpose]  = useState('');
  const [parts,    setParts]    = useState(20);
  const [startAt,  setStartAt]  = useState('');
  const [endAt,    setEndAt]    = useState('');
  const [teamName, setTeamName] = useState('');
  const [busy,     setBusy]     = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!venueId) { onError('Select a venue.'); return; }
    setBusy(true);
    try {
      const session: SessionInput = { sessionNo: 1, requestedStartAt: startAt, requestedEndAt: endAt, teamName };
      await initiateAcademicEvent({ venueId, purpose, estimatedParticipants: parts, sessions: [session] });
      onDone('Academic event initiated and added to the queue.');
      onClose();
    } catch (e) { onError(errMsg(e)); } finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} noValidate style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px,1fr))', gap: 'var(--sp-3)' }}>
      <div><label style={lbl}>Venue</label><select style={inp} value={venueId} onChange={(e) => setVenueId(Number(e.target.value))} required><option value={0}>Select…</option>{venues.filter((v) => v.is_active).map((v) => <option key={v.venue_id} value={v.venue_id}>{v.name}</option>)}</select></div>
      <div><label style={lbl}>Purpose</label><input style={inp} value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="e.g. Annual Sports Day" required /></div>
      <div><label style={lbl}>Team / Group</label><input style={inp} value={teamName} onChange={(e) => setTeamName(e.target.value)} placeholder="BUKC Sports" required /></div>
      <div><label style={lbl}>Participants</label><input style={inp} type="number" min={1} value={parts} onChange={(e) => setParts(Number(e.target.value))} required /></div>
      <div><label style={lbl}>Start</label><input style={inp} type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} required /></div>
      <div><label style={lbl}>End</label><input style={inp} type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} required /></div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
        <Btn type="submit" loading={busy}>Initiate Event</Btn>
        <Btn variant="secondary" type="button" onClick={onClose}>Cancel</Btn>
      </div>
    </form>
  );
}

const secTitle: React.CSSProperties = { font: '600 14px var(--font-display)', color: 'var(--navy)', marginBottom: 'var(--sp-2)' };
const lbl: React.CSSProperties = { display: 'block', font: '500 12.5px var(--font-body)', color: 'var(--ink-muted)', marginBottom: 5 };
const inp: React.CSSProperties = { width: '100%', font: '13.5px var(--font-body)', padding: '8px 11px', border: '1px solid var(--line)', borderRadius: 'var(--radius)', outline: 'none', background: 'var(--white)', color: 'var(--ink)' };
