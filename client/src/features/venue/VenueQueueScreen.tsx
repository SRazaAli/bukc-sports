/**
 * Coordinator — Venue Queue (VENUE-09..17). Review pending bookings (single-
 * or multi-session), forward feasible ones, or reject with a reason. Also
 * initiates academic calendar events (VENUE-28/29), which enter the SAME
 * queue and pipeline.
 */
import { useEffect, useState, useCallback } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth.js';
import { PortalShell } from '../auth/PortalShell.js';
import { listQueue, forwardBooking, rejectBooking, getBooking, listVenues, initiateAcademicEvent, planAllocation, type QueueBooking, type BookingDetail, type Venue } from './api.js';
import { listTypes, type EquipmentType } from '../inventory/api.js';
import { useSessionRows, SessionRowsEditor } from './SessionsBuilder.js';
import { ApiRequestError } from '../../lib/api.js';

function errMsg(e: unknown) { return e instanceof ApiRequestError ? e.body.error : 'Something went wrong.'; }

export default function VenueQueueScreen() {
  const { user, loading } = useAuth();
  const [queue, setQueue] = useState<QueueBooking[] | null>(null);
  const [selected, setSelected] = useState<QueueBooking | null>(null);
  const [showAcademic, setShowAcademic] = useState(false);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [q, v] = await Promise.all([listQueue(), listVenues()]);
      setQueue(q.queue); setVenues(v.venues);
    } catch (e) { setError(errMsg(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (loading) return <PortalShell title="Venue Queue"><p /></PortalShell>;
  if (!user) return <Navigate to="/" replace />;
  if (user.role !== 'COORDINATOR') return <Navigate to="/home" replace />;

  const flash = { ok: (m: string) => { setNotice(m); setError(null); }, err: (m: string) => { setError(m); setNotice(null); } };

  return (
    <PortalShell title="Venue Queue" tint="slate">
      <div style={wrap}>
        {error && <div style={box.err}>{error}</div>}
        {notice && <div style={box.ok}>{notice}</div>}

        {selected ? (
          <ReviewPanel item={selected} onBack={() => setSelected(null)}
            onDone={(m) => { flash.ok(m); setSelected(null); void load(); }} onError={flash.err} />
        ) : (
          <>
            <Panel title="Pending Booking Requests">
              {queue === null ? <p style={muted}>Loading…</p> : queue.length === 0 ? (
                <p style={muted}>No pending venue requests.</p>
              ) : (
                <table style={table}>
                  <thead><tr><th style={th}>Requester</th><th style={th}>Venue</th><th style={th}>Sessions</th><th style={th}>Participants</th><th style={th} /></tr></thead>
                  <tbody>
                    {queue.map((q) => (
                      <tr key={q.booking_id}>
                        <td style={td}>{q.requester_name ?? 'BUKC Sports Department'}<br /><span style={{ color: '#8a949f', fontSize: 12 }}>{q.origin}</span></td>
                        <td style={td}>{q.venue_name}</td>
                        <td style={td}>{q.sessionCount}{q.firstStart ? ` · from ${new Date(q.firstStart).toLocaleDateString()}` : ''}</td>
                        <td style={td}>{q.estimated_participants}</td>
                        <td style={{ ...td, textAlign: 'right' }}><button style={reviewBtn} onClick={() => setSelected(q)}>Review</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Panel>

            <Panel title="Academic Calendar Events" action={<button style={ghostBtn} onClick={() => setShowAcademic((v) => !v)}>{showAcademic ? 'Close' : 'Initiate Event'}</button>}>
              {showAcademic
                ? <AcademicEventForm venues={venues} onDone={(m) => { flash.ok(m); setShowAcademic(false); void load(); }} onError={flash.err} />
                : <p style={muted}>Recurring annual events (Sports Day, tournaments) — same review pipeline, no student requester.</p>}
            </Panel>
          </>
        )}
      </div>
    </PortalShell>
  );
}

function ReviewPanel({ item, onBack, onDone, onError }: {
  item: QueueBooking; onBack: () => void; onDone: (m: string) => void; onError: (m: string) => void;
}) {
  const [detail, setDetail] = useState<BookingDetail | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { getBooking(item.booking_id).then(setDetail).catch((e) => onError(errMsg(e))); }, [item.booking_id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function forward() {
    setBusy(true);
    try { await forwardBooking(item.booking_id, note || undefined); onDone(`Forwarded to Super Admin.`); }
    catch (e) { onError(errMsg(e)); } finally { setBusy(false); }
  }
  async function reject() {
    setBusy(true);
    try { await rejectBooking(item.booking_id, reason); onDone(`Request rejected for ${item.requester_name ?? 'the requester'}.`); }
    catch (e) { onError(errMsg(e)); } finally { setBusy(false); }
  }

  return (
    <Panel title={`Review — ${item.requester_name ?? 'BUKC Sports Department'}`}>
      <Row label="Venue" value={item.venue_name} />
      <Row label="Purpose" value={item.purpose} />
      <Row label="Participants" value={String(item.estimated_participants)} />
      {item.requester_email && <Row label="Requester email" value={item.requester_email} />}

      <div style={{ marginTop: 14 }}>
        <span style={lbl}>Sessions ({detail?.sessions.length ?? '…'})</span>
        {detail ? (
          <table style={{ ...table, marginTop: 6 }}>
            <thead><tr><th style={th}>#</th><th style={th}>When</th><th style={th}>Team</th></tr></thead>
            <tbody>
              {detail.sessions.map((s) => (
                <tr key={s.request_session_id}>
                  <td style={td}>{s.session_no}</td>
                  <td style={td}>{new Date(s.requested_start_at).toLocaleString()} → {new Date(s.requested_end_at).toLocaleTimeString()}</td>
                  <td style={td}>{s.team_name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p style={muted}>Loading sessions…</p>}
      </div>

      {detail && <EquipmentPlanner bookingId={item.booking_id} sessions={detail.sessions} onError={onError} />}

      {!rejecting ? (
        <div style={{ marginTop: 16 }}>
          <label style={lbl}>Feasibility note (sent with forward, optional)</label>
          <textarea style={textarea} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          <div style={actionRow}>
            <button style={acceptBtn} disabled={busy} onClick={forward}>Forward to Super Admin</button>
            <button style={rejectBtn} onClick={() => setRejecting(true)}>Reject…</button>
            <button style={ghostBtn} onClick={onBack}>Back</button>
          </div>
        </div>
      ) : (
        <div style={{ marginTop: 16 }}>
          <label style={lbl}>Reason (sent to the requester)</label>
          <textarea style={textarea} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          <div style={actionRow}>
            <button style={rejectBtn} disabled={!reason.trim() || busy} onClick={reject}>Confirm rejection</button>
            <button style={ghostBtn} onClick={() => setRejecting(false)}>Cancel</button>
          </div>
        </div>
      )}
    </Panel>
  );
}

function EquipmentPlanner({ bookingId, sessions, onError }: {
  bookingId: string; sessions: BookingDetail['sessions']; onError: (m: string) => void;
}) {
  const [types, setTypes] = useState<EquipmentType[]>([]);
  // lines keyed by `${requestSessionId}:${equipmentTypeId}` -> quantity string (so the field can be freely cleared)
  const [lines, setLines] = useState<Record<string, string>>({});
  const [activeSessionId, setActiveSessionId] = useState(sessions[0]?.request_session_id ?? '');
  const [addType, setAddType] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => { listTypes().then((r) => setTypes(r.types)).catch(() => {}); }, []);

  function key(sessionId: string, typeId: number) { return `${sessionId}:${typeId}`; }
  function addLine() {
    if (!addType || !activeSessionId) return;
    setLines((cur) => ({ ...cur, [key(activeSessionId, addType)]: cur[key(activeSessionId, addType)] ?? '1' }));
    setAddType(0);
  }
  function removeLine(k: string) {
    setLines((cur) => { const next = { ...cur }; delete next[k]; return next; });
  }

  async function submit() {
    const allocations = Object.entries(lines)
      .filter(([, qty]) => qty !== '' && Number(qty) > 0)
      .map(([k, qty]) => {
        const [requestSessionId, equipmentTypeId] = k.split(':');
        return { requestSessionId: requestSessionId!, equipmentTypeId: Number(equipmentTypeId), quantity: Number(qty) };
      });
    if (allocations.length === 0) { onError('Add at least one equipment line.'); return; }
    setBusy(true); setNotice(null);
    try {
      const res = await planAllocation(bookingId, allocations);
      setNotice(res.message + (res.shortfalls.length > 0
        ? ` (${res.shortfalls.map((s) => `type #${s.equipmentTypeId}: requested ${s.requested}, ${s.available} available`).join('; ')})`
        : ''));
    } catch (e) { onError(errMsg(e)); } finally { setBusy(false); }
  }

  return (
    <div style={{ marginTop: 16, borderTop: '1px solid #eee', paddingTop: 14 }}>
      <span style={lbl}>Equipment allocation</span>
      {notice && <div style={{ ...box.ok, marginTop: 8, marginBottom: 0 }}>{notice}</div>}

      <div style={{ display: 'flex', gap: 8, marginTop: 10, marginBottom: 10, flexWrap: 'wrap' }}>
        <select style={inp2} value={activeSessionId} onChange={(e) => setActiveSessionId(e.target.value)}>
          {sessions.map((s) => <option key={s.request_session_id} value={s.request_session_id}>Session {s.session_no}</option>)}
        </select>
        <select style={inp2} value={addType} onChange={(e) => setAddType(Number(e.target.value))}>
          <option value={0}>Add equipment type…</option>
          {types.map((t) => <option key={t.equipment_type_id} value={t.equipment_type_id}>{t.name}</option>)}
        </select>
        <button type="button" style={ghostBtn} onClick={addLine}>Add</button>
      </div>

      {Object.keys(lines).length > 0 && (
        <table style={{ ...table, marginBottom: 10 }}>
          <thead><tr><th style={th}>Session</th><th style={th}>Equipment</th><th style={th}>Quantity</th><th style={th} /></tr></thead>
          <tbody>
            {Object.entries(lines).map(([k, qty]) => {
              const [sessionId, typeIdStr] = k.split(':');
              const s = sessions.find((x) => x.request_session_id === sessionId);
              const t = types.find((x) => x.equipment_type_id === Number(typeIdStr));
              return (
                <tr key={k}>
                  <td style={td}>Session {s?.session_no}</td>
                  <td style={td}>{t?.name ?? '—'}</td>
                  <td style={td}><input type="number" min={1} style={{ ...inp2, width: 70 }} value={qty}
                    onChange={(e) => setLines((cur) => ({ ...cur, [k]: e.target.value }))} /></td>
                  <td style={{ ...td, textAlign: 'right' }}><button type="button" style={{ ...ghostBtn, padding: '4px 10px' }} onClick={() => removeLine(k)}>Remove</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <button type="button" style={acceptBtn} disabled={busy} onClick={submit}>{busy ? 'Saving…' : 'Save Equipment Plan'}</button>
    </div>
  );
}


function AcademicEventForm({ venues, onDone, onError }: { venues: Venue[]; onDone: (m: string) => void; onError: (m: string) => void }) {
  const [venueId, setVenue] = useState(0);
  const [purpose, setPurpose] = useState('');
  const [estimatedParticipants, setParticipants] = useState(50);
  const [busy, setBusy] = useState(false);
  const { rows, addRow, removeRow, updateRow, toSessionInputs } = useSessionRows('BUKC Sports Department');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!venueId) { onError('Choose a venue.'); return; }
    setBusy(true);
    try {
      await initiateAcademicEvent({ venueId, purpose, estimatedParticipants, sessions: toSessionInputs() });
      onDone('Academic event created and added to the pending queue.');
    } catch (e) { onError(errMsg(e)); } finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} style={formGrid}>
      <L label="Venue"><select style={inp} value={venueId} onChange={(e) => setVenue(Number(e.target.value))} required>
        <option value={0}>Select</option>
        {venues.map((v) => <option key={v.venue_id} value={v.venue_id}>{v.name}</option>)}
      </select></L>
      <L label="Estimated participants"><input type="number" min={1} style={inp} value={estimatedParticipants} onChange={(e) => setParticipants(Number(e.target.value))} required /></L>
      <div style={{ gridColumn: '1 / -1' }}>
        <L label="Event name"><input style={inp} value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="e.g. Annual Sports Day" required /></L>
      </div>
      <SessionRowsEditor rows={rows} onAdd={addRow} onRemove={removeRow} onUpdate={updateRow} />
      <div style={{ gridColumn: '1 / -1' }}><button style={acceptBtn} disabled={busy}>{busy ? 'Creating…' : 'Create Event'}</button></div>
    </form>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return <div style={detailRow}><div style={detailLabel}>{label}</div><div>{value}</div></div>;
}
function Panel({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return <section style={panel}><div style={panelHead}><span>{title}</span>{action}</div><div style={panelBody}>{children}</div></section>;
}
function L({ label, children }: { label: string; children: React.ReactNode }) {
  return <label style={{ display: 'block' }}><span style={lbl}>{label}</span>{children}</label>;
}

const wrap: React.CSSProperties = { maxWidth: 860, margin: '0 auto' };
const panel: React.CSSProperties = { background: '#fff', border: '1px solid #ddd', borderRadius: 4, marginBottom: 18, boxShadow: '0 1px 2px rgba(0,0,0,0.05)' };
const panelHead: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 18px', borderBottom: '1px solid #e5e5e5', font: '600 15px var(--font-body)', color: '#333', background: 'linear-gradient(#fff,#f7f7f7)' };
const panelBody: React.CSSProperties = { padding: 18 };
const table: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 14 };
const th: React.CSSProperties = { textAlign: 'left', font: '600 11px var(--font-body)', color: '#888', textTransform: 'uppercase', letterSpacing: '0.04em', padding: '0 8px 8px', borderBottom: '1px solid #e5e5e5' };
const td: React.CSSProperties = { padding: '10px 8px', borderBottom: '1px solid #eee', color: '#333' };
const muted: React.CSSProperties = { color: '#5c6773', fontSize: 14.5, margin: 0 };
const lbl: React.CSSProperties = { display: 'block', font: '500 12px var(--font-body)', color: '#26485f', marginBottom: 5 };
const inp: React.CSSProperties = { width: '100%', font: '14px var(--font-body)', padding: '8px 10px', border: '1px solid #ccc', borderRadius: 4 };
const inp2: React.CSSProperties = { font: '13.5px var(--font-body)', padding: '7px 9px', border: '1px solid #ccc', borderRadius: 4 };
const textarea: React.CSSProperties = { width: '100%', font: '14px var(--font-body)', padding: '8px 10px', border: '1px solid #ccc', borderRadius: 4, resize: 'vertical', maxWidth: 480 };
const formGrid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, maxWidth: 620 };
const reviewBtn: React.CSSProperties = { background: '#0a6ebd', color: '#fff', border: 'none', borderRadius: 4, padding: '7px 16px', fontSize: 14, cursor: 'pointer' };
const ghostBtn: React.CSSProperties = { background: '#fff', color: '#555', border: '1px solid #ccc', borderRadius: 4, padding: '9px 18px', fontSize: 14.5, cursor: 'pointer' };
const acceptBtn: React.CSSProperties = { background: '#1f8a4c', color: '#fff', border: 'none', borderRadius: 4, padding: '9px 18px', fontSize: 14.5, cursor: 'pointer' };
const rejectBtn: React.CSSProperties = { background: '#c0392b', color: '#fff', border: 'none', borderRadius: 4, padding: '9px 18px', fontSize: 14.5, cursor: 'pointer' };
const actionRow: React.CSSProperties = { display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' };
const detailRow: React.CSSProperties = { display: 'grid', gridTemplateColumns: '160px 1fr', padding: '8px 0', borderBottom: '1px solid #f0f0f0', fontSize: 14.5 };
const detailLabel: React.CSSProperties = { font: '600 13px var(--font-body)', color: '#555' };
const box = {
  err: { background: '#fdecec', color: '#8f2323', border: '1px solid #f3caca', borderRadius: 4, padding: '10px 14px', marginBottom: 16, fontSize: 14 } as React.CSSProperties,
  ok: { background: '#eaf6ee', color: '#1e6b3a', border: '1px solid #c2e6cd', borderRadius: 4, padding: '10px 14px', marginBottom: 16, fontSize: 14 } as React.CSSProperties,
};
