/**
 * Super Admin — Venue Approvals + Venue Management. Redesigned with AppShell.
 * Backend unchanged: listAdminQueue, approveBooking, returnForReeval, rejectBooking, createVenue, listVenues.
 */
import { useEffect, useState, useCallback, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth.js';
import AppShell, { PageHeader, Card, Btn, Badge, EmptyState, ErrorBox, SuccessBox, Th, Td, TableWrapper } from '../../components/AppShell.js';
import { listAdminQueue, approveBooking, returnForReeval, rejectBooking, getBooking, createVenue, listVenues, type AdminQueueBooking, type BookingDetail, type Venue } from './api.js';
import { ApiRequestError } from '../../lib/api.js';

function errMsg(e: unknown) { return e instanceof ApiRequestError ? e.body.error : 'Something went wrong.'; }

export default function VenueApprovalScreen() {
  const { user, loading } = useAuth();
  const [queue,    setQueue]    = useState<AdminQueueBooking[] | null>(null);
  const [venues,   setVenues]   = useState<Venue[]>([]);
  const [selected, setSelected] = useState<AdminQueueBooking | null>(null);
  const [showAdd,  setShowAdd]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const [notice,   setNotice]   = useState<string | null>(null);

  const load = useCallback(async () => {
    try { const [q, v] = await Promise.all([listAdminQueue(), listVenues()]); setQueue(q.queue); setVenues(v.venues); }
    catch (e) { setError(errMsg(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (loading) return <AppShell title="Venue Approvals"><p /></AppShell>;
  if (!user) return <Navigate to="/" replace />;
  if (user.role !== 'SUPER_ADMIN') return <Navigate to="/home" replace />;

  const flash = { ok: (m: string) => { setNotice(m); setError(null); setSelected(null); void load(); }, err: (m: string) => { setError(m); setNotice(null); } };

  return (
    <AppShell title="Venue Approvals">
      <PageHeader title="Venue Approvals" subtitle="Final approval for forwarded booking requests">
        <Btn variant="secondary" onClick={() => setShowAdd((v) => !v)}>{showAdd ? 'Close' : 'Add Venue'}</Btn>
      </PageHeader>
      {error  && <ErrorBox message={error} />}
      {notice && <SuccessBox message={notice} />}

      {showAdd && (
        <Card style={{ padding: 'var(--sp-5)', marginBottom: 'var(--sp-4)' }}>
          <div style={secTitle}>Add New Venue</div>
          <AddVenueForm onDone={(m) => { flash.ok(m); setShowAdd(false); }} onError={flash.err} />
        </Card>
      )}

      {selected ? (
        <ApprovalPanel item={selected} onBack={() => setSelected(null)} onDone={flash.ok} onError={flash.err} />
      ) : (
        <div style={{ display: 'grid', gap: 'var(--sp-4)' }}>
          <Card style={{ padding: 'var(--sp-5)' }}>
            <div style={{ ...secTitle, marginBottom: 'var(--sp-4)' }}>
              Forwarded Bookings
              {queue && queue.length > 0 && <span style={{ marginLeft: 8, background: 'var(--teal)', color: '#fff', font: '600 10px var(--font-mono)', padding: '2px 6px', borderRadius: 10 }}>{queue.length}</span>}
            </div>
            {queue === null ? <p style={{ color: 'var(--ink-muted)' }}>Loading…</p>
            : queue.length === 0 ? <EmptyState title="No bookings awaiting approval" body="Forwarded bookings from coordinators appear here." />
            : (
              <TableWrapper>
                <thead><tr><th style={Th}>Requester</th><th style={Th}>Venue</th><th style={Th}>Sessions</th><th style={Th}>Forwarded by</th><th style={Th} /></tr></thead>
                <tbody>{queue.map((q) => (
                  <tr key={q.booking_id}>
                    <td style={Td}>{q.requester_name ?? 'BUKC Dept.'}</td>
                    <td style={Td}>{q.venue_name}</td>
                    <td style={Td}>{q.sessionCount}</td>
                    <td style={{ ...Td, fontSize: 13 }}>{new Date(q.forwarded_at).toLocaleDateString('en-GB', { day:'2-digit', month:'short' })}</td>
                    <td style={{ ...Td, textAlign: 'right' }}><Btn size="sm" onClick={() => setSelected(q)}>Review</Btn></td>
                  </tr>
                ))}</tbody>
              </TableWrapper>
            )}
          </Card>

          <Card style={{ padding: 'var(--sp-5)' }}>
            <div style={{ ...secTitle, marginBottom: 'var(--sp-4)' }}>Venues ({venues.length})</div>
            {venues.length === 0 ? <EmptyState title="No venues yet" body="Add a venue to get started." /> : (
              <TableWrapper>
                <thead><tr><th style={Th}>Name</th><th style={Th}>Capacity</th><th style={Th}>Type</th><th style={Th}>Status</th></tr></thead>
                <tbody>{venues.map((v) => (
                  <tr key={v.venue_id}>
                    <td style={Td}>{v.name}</td>
                    <td style={Td}>{v.capacity}</td>
                    <td style={Td}>{v.is_indoor ? 'Indoor' : 'Outdoor'}</td>
                    <td style={Td}><Badge status={v.is_active ? 'AVAILABLE' : 'CANCELLED'} /></td>
                  </tr>
                ))}</tbody>
              </TableWrapper>
            )}
          </Card>
        </div>
      )}
    </AppShell>
  );
}

function ApprovalPanel({ item, onBack, onDone, onError }: { item: AdminQueueBooking; onBack: () => void; onDone: (m: string) => void; onError: (m: string) => void }) {
  const [detail,    setDetail]    = useState<BookingDetail | null>(null);
  const [reevalNote,setReevalNote]= useState('');
  const [rejReason, setRejReason] = useState('');
  const [mode,      setMode]      = useState<null|'reeval'|'reject'>(null);
  const [busy,      setBusy]      = useState(false);

  useEffect(() => { getBooking(item.booking_id).then(setDetail).catch((e) => onError(errMsg(e))); }, [item.booking_id]);

  async function approve() {
    setBusy(true);
    try { await approveBooking(item.booking_id); onDone('Booking approved. Sessions are now on the calendar.'); }
    catch (e) { onError(errMsg(e)); } finally { setBusy(false); }
  }
  async function reeval() {
    if (!reevalNote.trim()) return;
    setBusy(true);
    try { await returnForReeval(item.booking_id, reevalNote); onDone('Returned to coordinator for re-evaluation.'); }
    catch (e) { onError(errMsg(e)); } finally { setBusy(false); }
  }
  async function reject() {
    if (!rejReason.trim()) return;
    setBusy(true);
    try { await rejectBooking(item.booking_id, rejReason); onDone('Booking rejected.'); }
    catch (e) { onError(errMsg(e)); } finally { setBusy(false); }
  }

  return (
    <Card style={{ padding: 'var(--sp-5)', maxWidth: 680 }}>
      <button onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--teal)', font: '13px var(--font-body)', padding: 0, marginBottom: 'var(--sp-4)' }}>← Back</button>
      <div style={secTitle}>Final Approval</div>
      {!detail ? <p style={{ color: 'var(--ink-muted)' }}>Loading…</p> : (
        <>
          {[['Venue', detail.venue_name], ['Purpose', detail.purpose], ['Participants', String(detail.estimated_participants)], ['Sessions', String(detail.sessions.length)], ['Coordinator Note', detail.feasibility_note ?? '—']].map(([k, v]) => (
            <div key={k} style={{ display: 'grid', gridTemplateColumns: '160px 1fr', padding: '9px 0', borderBottom: '1px solid var(--line-light)' }}>
              <span style={{ font: '500 13px var(--font-body)', color: 'var(--ink-muted)' }}>{k}</span>
              <span style={{ font: '14px var(--font-body)', color: 'var(--ink)' }}>{v}</span>
            </div>
          ))}
          <div style={{ marginTop: 'var(--sp-4)' }}>
            {mode === null && (
              <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
                <Btn onClick={approve} loading={busy}>Approve Booking</Btn>
                <Btn variant="secondary" onClick={() => setMode('reeval')}>Return for Re-evaluation</Btn>
                <Btn variant="danger" onClick={() => setMode('reject')}>Reject</Btn>
                <Btn variant="ghost" onClick={onBack}>Cancel</Btn>
              </div>
            )}
            {mode === 'reeval' && (
              <>
                <label style={lbl}>Re-evaluation note (sent to coordinator)</label>
                <textarea value={reevalNote} onChange={(e) => setReevalNote(e.target.value)} rows={2} style={ta} placeholder="What needs to be reconsidered?" />
                <div style={{ display: 'flex', gap: 8, marginTop: 'var(--sp-2)' }}>
                  <Btn onClick={reeval} disabled={!reevalNote.trim()} loading={busy}>Send Back</Btn>
                  <Btn variant="secondary" onClick={() => setMode(null)}>Cancel</Btn>
                </div>
              </>
            )}
            {mode === 'reject' && (
              <>
                <label style={lbl}>Rejection reason (emailed to requester)</label>
                <textarea value={rejReason} onChange={(e) => setRejReason(e.target.value)} rows={2} style={ta} placeholder="e.g. Venue already reserved for this period." />
                <div style={{ display: 'flex', gap: 8, marginTop: 'var(--sp-2)' }}>
                  <Btn variant="danger" onClick={reject} disabled={!rejReason.trim()} loading={busy}>Confirm Rejection</Btn>
                  <Btn variant="secondary" onClick={() => setMode(null)}>Cancel</Btn>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </Card>
  );
}

function AddVenueForm({ onDone, onError }: { onDone: (m: string) => void; onError: (m: string) => void }) {
  const [name,     setName]     = useState('');
  const [capacity, setCapacity] = useState(50);
  const [isIndoor, setIsIndoor] = useState(false);
  const [busy,     setBusy]     = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true);
    try { await createVenue({ name, capacity, isIndoor }); onDone(`Venue "${name}" created.`); setName(''); setCapacity(50); }
    catch (e) { onError(errMsg(e)); } finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} noValidate style={{ display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap', alignItems: 'flex-end' }}>
      <div><label style={lbl}>Venue Name</label><input style={inp} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Main Cricket Ground" required /></div>
      <div><label style={lbl}>Capacity</label><input style={{ ...inp, width: 100 }} type="number" min={1} value={capacity} onChange={(e) => setCapacity(Number(e.target.value))} required /></div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingBottom: 2 }}>
        <input type="checkbox" id="isIndoor" checked={isIndoor} onChange={(e) => setIsIndoor(e.target.checked)} />
        <label htmlFor="isIndoor" style={{ font: '13.5px var(--font-body)', color: 'var(--ink)', cursor: 'pointer' }}>Indoor</label>
      </div>
      <Btn type="submit" loading={busy}>Add Venue</Btn>
    </form>
  );
}

const secTitle: React.CSSProperties = { font: '600 14px var(--font-display)', color: 'var(--navy)', marginBottom: 4 };
const lbl: React.CSSProperties = { display: 'block', font: '500 12.5px var(--font-body)', color: 'var(--ink-muted)', marginBottom: 5 };
const inp: React.CSSProperties = { font: '13.5px var(--font-body)', padding: '8px 11px', border: '1px solid var(--line)', borderRadius: 'var(--radius)', outline: 'none', background: 'var(--white)', color: 'var(--ink)' };
const ta: React.CSSProperties = { width: '100%', font: '14px var(--font-body)', padding: '9px 12px', border: '1px solid var(--line)', borderRadius: 'var(--radius)', resize: 'vertical', outline: 'none' };
