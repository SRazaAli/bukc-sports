/**
 * Coordinator — Venue Queue (VENUE-09..17).
 *
 * ReviewPanel now includes:
 *   1. Full booking metadata (team details, equipment requests from student pitch)
 *   2. Conflict check — runs queryConflicts for the booking's venue/session window,
 *      shows a visual timeline of occupied vs free slots, lists conflicts by session
 *   3. Propose alternative schedule — if conflicts found, coordinator edits session
 *      dates and times and includes them in the send-back
 *   4. Equipment section — pre-populated from student's booking_metadata.equipmentItems,
 *      shows requested qty → coordinator runs inventory check to see availability
 *      (available now, locked on session date, net available) → edits final quantities
 *   5. Send Back to [student] — fires sendBackToRequester with note + optional schedule
 *   6. Forward to Super Admin — standard forward after satisfying review
 */
import { useEffect, useState, useCallback } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth.js';
import { PortalShell } from '../auth/PortalShell.js';
import {
  listQueue, forwardBooking, rejectBooking, getBookingFull, listVenues,
  initiateAcademicEvent, planAllocation, sendBackToRequester, checkEquipmentForSessions,
  queryConflicts,
  type QueueBooking, type BookingDetailFull, type Venue, type ApprovedSession, type EquipmentAvailRow,
} from './api.js';
import { listTypes, type EquipmentType } from '../inventory/api.js';
import { useSessionRows, SessionRowsEditor } from './SessionsBuilder.js';
import { ApiRequestError } from '../../lib/api.js';

function errMsg(e: unknown) { return e instanceof ApiRequestError ? e.body.error : 'Something went wrong.'; }
function fmtDT(d: string) { return new Date(d).toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' }); }
function fmtTime(d: string) { return new Date(d).toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' }); }

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
  if (!user) return <Navigate to="/home" replace />;
  if (user.role !== 'COORDINATOR') return <Navigate to="/home" replace />;

  const flash = {
    ok: (m: string) => { setNotice(m); setError(null); },
    err: (m: string) => { setError(m); setNotice(null); },
  };

  return (
    <PortalShell title="Venue Queue" tint="slate">
      <div style={wrap}>
        {error && <div style={box.err}>{error}</div>}
        {notice && <div style={box.ok}>{notice}</div>}

        {selected ? (
          <ReviewPanel
            item={selected}
            onBack={() => setSelected(null)}
            onDone={(m) => { flash.ok(m); setSelected(null); void load(); }}
            onError={flash.err}
          />
        ) : (
          <>
            <Panel title="Pending Booking Requests">
              {queue === null ? <p style={muted}>Loading…</p> : queue.length === 0 ? (
                <p style={muted}>No pending venue requests.</p>
              ) : (
                <table style={tbl}>
                  <thead>
                    <tr>
                      <th style={th}>Requester</th><th style={th}>Venue</th>
                      <th style={th}>Sessions</th><th style={th}>Participants</th><th style={th} />
                    </tr>
                  </thead>
                  <tbody>
                    {queue.map((q) => (
                      <tr key={q.booking_id}>
                        <td style={td}>
                          <div style={{ fontWeight: 600 }}>{q.requester_name ?? 'BUKC Sports Dept.'}</div>
                          <div style={{ color: '#8a949f', fontSize: 12 }}>{q.origin}</div>
                        </td>
                        <td style={td}>{q.venue_name}</td>
                        <td style={td}>{q.sessionCount}{q.firstStart ? ` · from ${new Date(q.firstStart).toLocaleDateString()}` : ''}</td>
                        <td style={td}>{q.estimated_participants}</td>
                        <td style={{ ...td, textAlign: 'right' }}>
                          <button style={reviewBtn} onClick={() => setSelected(q)}>Review</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Panel>

            <Panel title="Academic Calendar Events"
              action={<button style={ghostBtn} onClick={() => setShowAcademic((v) => !v)}>{showAcademic ? 'Close' : 'Initiate Event'}</button>}>
              {showAcademic
                ? <AcademicEventForm venues={venues}
                    onDone={(m) => { flash.ok(m); setShowAcademic(false); void load(); }}
                    onError={flash.err} />
                : <p style={muted}>Recurring annual events — same review pipeline, no student requester.</p>}
            </Panel>
          </>
        )}
      </div>
    </PortalShell>
  );
}

// ── Review Panel ─────────────────────────────────────────────────────────────
type ReviewTab = 'details' | 'conflicts' | 'equipment' | 'forward';

function ReviewPanel({ item, onBack, onDone, onError }: {
  item: QueueBooking;
  onBack: () => void;
  onDone: (m: string) => void;
  onError: (m: string) => void;
}) {
  const [detail, setDetail] = useState<BookingDetailFull | null>(null);
  const [tab, setTab] = useState<ReviewTab>('details');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getBookingFull(item.booking_id)
      .then(setDetail)
      .catch((e) => onError(errMsg(e)))
      .finally(() => setLoading(false));
  }, [item.booking_id]); // eslint-disable-line

  if (loading || !detail) return <Panel title={`Review — ${item.requester_name ?? 'BUKC Sports Dept.'}`}><p style={muted}>Loading…</p></Panel>;

  const meta = detail.booking_metadata as Record<string, unknown> | null;
  const requestedEquipment = (meta?.equipmentItems as Array<{ name: string; equipmentTypeId: number; quantity: number }> | undefined) ?? [];
  const equipmentSupport = meta?.equipmentSupport as string ?? 'SELF';

  const tabBtn = (t: ReviewTab) => ({
    ...tabBtnBase,
    ...(tab === t ? tabBtnActive : {}),
  });

  return (
    <Panel title={`Review — ${item.requester_name ?? 'BUKC Sports Dept.'}`}>
      {/* Tab navigation */}
      <div style={tabRow}>
        <button style={tabBtn('details')} onClick={() => setTab('details')}>📋 Booking Details</button>
        <button style={tabBtn('conflicts')} onClick={() => setTab('conflicts')}>🗓 Conflict Check</button>
        <button style={tabBtn('equipment')} onClick={() => setTab('equipment')}>📦 Equipment</button>
        <button style={tabBtn('forward')} onClick={() => setTab('forward')}>✅ Decision</button>
      </div>

      {/* ── TAB: Booking Details ── */}
      {tab === 'details' && (
        <div>
          <Row label="Venue" value={detail.venue_name} />
          <Row label="Purpose" value={detail.purpose} />
          <Row label="Participants" value={String(detail.estimated_participants)} />
          {detail.requester_email && <Row label="Requester email" value={detail.requester_email} />}

          {/* Sessions */}
          <div style={{ marginTop: 16 }}>
            <span style={lbl}>Sessions ({detail.sessions.length})</span>
            <table style={{ ...tbl, marginTop: 6 }}>
              <thead><tr><th style={th}>#</th><th style={th}>Date</th><th style={th}>Time window</th></tr></thead>
              <tbody>
                {detail.sessions.map((s) => (
                  <tr key={s.request_session_id}>
                    <td style={td}>{s.session_no}</td>
                    <td style={td}>{new Date(s.requested_start_at).toLocaleDateString('en-PK', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</td>
                    <td style={td}>{fmtTime(s.requested_start_at)} – {fmtTime(s.requested_end_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Booking metadata — team details */}
          {meta && (
            <div style={{ marginTop: 16 }}>
              <span style={lbl}>Pitch Details</span>
              <div style={{ background: '#f7f9fb', border: '1px solid #e5e7eb', borderRadius: 6, padding: 14, marginTop: 6 }}>
                {renderMeta(meta)}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── TAB: Conflict Check ── */}
      {tab === 'conflicts' && (
        <ConflictCheckPanel
          bookingId={detail.booking_id}
          venueId={detail.venue_id}
          venueName={detail.venue_name}
          sessions={detail.sessions}
          requesterName={detail.requester_name ?? 'the requester'}
          onSentBack={(m) => onDone(m)}
          onError={onError}
        />
      )}

      {/* ── TAB: Equipment ── */}
      {tab === 'equipment' && (
        <EquipmentReviewPanel
          bookingId={detail.booking_id}
          sessions={detail.sessions}
          requestedEquipment={requestedEquipment}
          equipmentSupport={equipmentSupport}
          onError={onError}
        />
      )}

      {/* ── TAB: Decision ── */}
      {tab === 'forward' && (
        <DecisionPanel
          item={item}
          detail={detail}
          onDone={onDone}
          onError={onError}
          onBack={onBack}
        />
      )}
    </Panel>
  );
}

// ── Conflict Check Panel ──────────────────────────────────────────────────────
function ConflictCheckPanel({ bookingId, venueId, venueName, sessions, requesterName, onSentBack, onError }: {
  bookingId: string;
  venueId: number;
  venueName: string;
  sessions: BookingDetailFull['sessions'];
  requesterName: string;
  onSentBack: (m: string) => void;
  onError: (m: string) => void;
}) {
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState(false);
  const [conflicts, setConflicts] = useState<ApprovedSession[]>([]);
  const [sessionConflicts, setSessionConflicts] = useState<Record<string, ApprovedSession[]>>({});

  // Propose alternative schedule
  const { rows: proposed, addRow, removeRow, updateRow, toSessionInputs } = useSessionRows();
  const [showPropose, setShowPropose] = useState(false);
  const [sendBackNote, setSendBackNote] = useState('');
  const [sendingBack, setSendingBack] = useState(false);

  async function runConflictCheck() {
    setChecking(true);
    try {
      // Query approved sessions at this venue around the booking's session dates
      const earliestStart = sessions.reduce((min, s) => s.requested_start_at < min ? s.requested_start_at : min, sessions[0]!.requested_start_at);
      const latestEnd = sessions.reduce((max, s) => s.requested_end_at > max ? s.requested_end_at : max, sessions[0]!.requested_end_at);

      const res = await queryConflicts({
        venueId,
        from: earliestStart,
        to: latestEnd,
      });

      // Map conflicts per proposed session
      const perSession: Record<string, ApprovedSession[]> = {};
      for (const s of sessions) {
        const sStart = new Date(s.requested_start_at);
        const sEnd = new Date(s.requested_end_at);
        perSession[s.request_session_id] = res.sessions.filter((approved) => {
          const aStart = new Date(approved.starts_at);
          const aEnd = new Date(approved.ends_at);
          return sStart < aEnd && sEnd > aStart;
        });
      }

      setSessionConflicts(perSession);
      setConflicts(res.sessions);
      setChecked(true);
    } catch (e) { onError(errMsg(e)); }
    finally { setChecking(false); }
  }

  const conflictingSessionCount = Object.values(sessionConflicts).filter((c) => c.length > 0).length;
  const hasConflicts = conflictingSessionCount > 0;

  async function doSendBack() {
    if (!sendBackNote.trim()) { onError('Please write a note for the requester.'); return; }
    setSendingBack(true);
    try {
      const proposedSessionsToSend = showPropose
        ? toSessionInputs().map((s) => ({ sessionNo: s.sessionNo, startAt: s.requestedStartAt, endAt: s.requestedEndAt }))
        : undefined;
      await sendBackToRequester(bookingId, { note: sendBackNote, proposedSessions: proposedSessionsToSend });
      onSentBack(`Booking sent back to ${requesterName}.`);
    } catch (e) { onError(errMsg(e)); }
    finally { setSendingBack(false); }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div>
          <p style={{ margin: 0, fontSize: 14, color: '#5c6773' }}>
            Checks all approved sessions at <strong>{venueName}</strong> for overlaps with the proposed session window(s).
          </p>
        </div>
        <button style={primaryBtn} disabled={checking} onClick={runConflictCheck}>
          {checking ? 'Checking…' : checked ? 'Re-check' : '🔍 Run Conflict Check'}
        </button>
      </div>

      {checked && (
        <div>
          {/* Result banner */}
          {!hasConflicts ? (
            <div style={{ ...box.ok, display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 18 }}>✅</span>
              <span>No conflicts detected. All {sessions.length} session{sessions.length !== 1 ? 's' : ''} are clear on the calendar.</span>
            </div>
          ) : (
            <div style={{ ...box.err, marginBottom: 14 }}>
              ⚠ {conflictingSessionCount} of {sessions.length} session{sessions.length !== 1 ? 's' : ''} conflict{conflictingSessionCount === 1 ? 's' : ''} with existing approved bookings.
            </div>
          )}

          {/* Per-session conflict detail */}
          {sessions.map((s) => {
            const cs = sessionConflicts[s.request_session_id] ?? [];
            const sDate = new Date(s.requested_start_at).toLocaleDateString('en-PK', { weekday: 'long', day: 'numeric', month: 'long' });
            return (
              <div key={s.request_session_id} style={{ marginBottom: 12, border: `1px solid ${cs.length > 0 ? '#f3caca' : '#c2e6cd'}`, borderRadius: 8, overflow: 'hidden' }}>
                <div style={{ padding: '8px 14px', background: cs.length > 0 ? '#fdecec' : '#eaf6ee', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ font: '600 13px var(--font-body)', color: cs.length > 0 ? '#8f2323' : '#1e6b3a' }}>
                    {cs.length > 0 ? `⚠ Session ${s.session_no} — CONFLICT` : `✓ Session ${s.session_no} — Clear`}
                  </span>
                  <span style={{ fontSize: 13, color: '#555' }}>
                    {sDate} · {fmtTime(s.requested_start_at)}–{fmtTime(s.requested_end_at)}
                  </span>
                </div>
                {cs.length > 0 && (
                  <div style={{ padding: '10px 14px' }}>
                    {cs.map((c) => (
                      <div key={c.session_id} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '6px 0', borderBottom: '1px solid #f4f4f4', fontSize: 13.5 }}>
                        <span style={{ ...badge.danger, flexShrink: 0 }}>Occupied</span>
                        <div>
                          <div style={{ fontWeight: 600, color: '#333' }}>{c.purpose}</div>
                          <div style={{ color: '#5c6773', marginTop: 2 }}>
                            {fmtTime(c.starts_at)}–{fmtTime(c.ends_at)} · {c.requester_name ?? c.internal_client_ref ?? 'Internal event'}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {/* Suggest alternative + send back */}
          {hasConflicts && (
            <div style={{ marginTop: 20, padding: 16, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fafafa' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <span style={{ font: '600 14px var(--font-body)', color: '#26485f' }}>Send back to {requesterName}</span>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13.5 }}>
                  <input type="checkbox" checked={showPropose} onChange={(e) => setShowPropose(e.target.checked)} />
                  Include a proposed alternative schedule
                </label>
              </div>

              {showPropose && (
                <div style={{ marginBottom: 14, padding: 14, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6 }}>
                  <p style={{ margin: '0 0 10px', fontSize: 13, color: '#5c6773' }}>
                    Propose conflict-free dates and times. The requester will see these alongside your note.
                  </p>
                  <SessionRowsEditor
                    rows={proposed}
                    onAdd={addRow}
                    onRemove={removeRow}
                    onUpdate={updateRow}
                    allowMultiple={sessions.length > 1}
                  />
                </div>
              )}

              <div style={{ marginBottom: 10 }}>
                <label style={lbl}>Note to {requesterName} *</label>
                <textarea
                  style={{ ...textarea, width: '100%', minHeight: 100 }}
                  placeholder={`e.g. "Session 1 conflicts with an approved booking on 14 Aug from 10am–12pm. ${showPropose ? 'We have proposed alternative slots above.' : 'Please resubmit with a different date.'}"`}
                  value={sendBackNote}
                  onChange={(e) => setSendBackNote(e.target.value)}
                />
              </div>
              <button style={warnBtn} disabled={sendingBack || !sendBackNote.trim()} onClick={doSendBack}>
                {sendingBack ? 'Sending…' : `↩ Send Back to ${requesterName}`}
              </button>
            </div>
          )}
        </div>
      )}

      {!checked && (
        <div style={{ padding: '32px 24px', textAlign: 'center', color: '#8a949f' }}>
          <div style={{ fontSize: 36, marginBottom: 10 }}>🗓</div>
          <p style={{ margin: 0, fontSize: 14 }}>Click "Run Conflict Check" to compare these session slots against the approved calendar for {venueName}.</p>
        </div>
      )}
    </div>
  );
}

// ── Equipment Review Panel ────────────────────────────────────────────────────
function EquipmentReviewPanel({ bookingId, sessions, requestedEquipment, equipmentSupport, onError }: {
  bookingId: string;
  sessions: BookingDetailFull['sessions'];
  requestedEquipment: Array<{ name: string; equipmentTypeId: number; quantity: number }>;
  equipmentSupport: string;
  onError: (m: string) => void;
}) {
  const [allTypes, setAllTypes] = useState<EquipmentType[]>([]);
  const [availability, setAvailability] = useState<EquipmentAvailRow[]>([]);
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState(false);

  // Coordinator's planned quantities (editable, initialized from student request)
  const [planned, setPlanned] = useState<Record<number, number>>(
    Object.fromEntries(requestedEquipment.map((e) => [e.equipmentTypeId, e.quantity])),
  );

  // Equipment allocation lines (for existing planner)
  const [lines, setLines] = useState<Record<string, string>>({});
  const [addType, setAddType] = useState(0);
  const [activeSessionId, setActiveSessionId] = useState(sessions[0]?.request_session_id ?? '');
  const [savingPlan, setSavingPlan] = useState(false);
  const [planNotice, setPlanNotice] = useState<string | null>(null);

  useEffect(() => {
    listTypes().then((r) => setAllTypes(r.types)).catch(() => {});
  }, []);

  async function runInventoryCheck() {
    setChecking(true);
    try {
      const typeIds = requestedEquipment.map((e) => e.equipmentTypeId);
      if (typeIds.length === 0) { onError('No equipment was requested by the student.'); setChecking(false); return; }
      const sessionWindows = sessions.map((s) => ({ startAt: s.requested_start_at, endAt: s.requested_end_at }));
      const res = await checkEquipmentForSessions(bookingId, { equipmentTypeIds: typeIds, sessionWindows });
      setAvailability(res.availability);
      setChecked(true);
    } catch (e) { onError(errMsg(e)); }
    finally { setChecking(false); }
  }

  function key(sessionId: string, typeId: number) { return `${sessionId}:${typeId}`; }
  function addLine() {
    if (!addType || !activeSessionId) return;
    setLines((cur) => ({ ...cur, [key(activeSessionId, addType)]: cur[key(activeSessionId, addType)] ?? '1' }));
    setAddType(0);
  }
  function removeLine(k: string) { setLines((cur) => { const n = { ...cur }; delete n[k]; return n; }); }

  async function saveEquipmentPlan() {
    const allocations = Object.entries(lines)
      .filter(([, qty]) => qty !== '' && Number(qty) > 0)
      .map(([k, qty]) => {
        const [requestSessionId, equipmentTypeId] = k.split(':');
        return { requestSessionId: requestSessionId!, equipmentTypeId: Number(equipmentTypeId), quantity: Number(qty) };
      });
    if (allocations.length === 0) { onError('Add at least one equipment line.'); return; }
    setSavingPlan(true); setPlanNotice(null);
    try {
      const res = await planAllocation(bookingId, allocations);
      setPlanNotice(res.message + (res.shortfalls.length > 0
        ? ` Shortfalls: ${res.shortfalls.map((s) => `type #${s.equipmentTypeId}: requested ${s.requested}, ${s.available} available`).join('; ')}`
        : ''));
    } catch (e) { onError(errMsg(e)); } finally { setSavingPlan(false); }
  }

  const availMap = Object.fromEntries(availability.map((a) => [a.equipment_type_id, a]));

  return (
    <div>
      {/* Student's equipment request summary */}
      <div style={{ marginBottom: 16 }}>
        <span style={lbl}>Student's equipment request</span>
        {equipmentSupport === 'SELF' ? (
          <div style={{ ...box.ok, marginTop: 6 }}>Both teams will supply their own equipment — no university equipment needed.</div>
        ) : requestedEquipment.length === 0 ? (
          <div style={{ color: '#8a949f', fontSize: 14, marginTop: 6 }}>University support requested but no specific items listed.</div>
        ) : (
          <table style={{ ...tbl, marginTop: 8 }}>
            <thead>
              <tr>
                <th style={th}>Equipment type</th>
                <th style={th}>Requested qty</th>
                {checked && <th style={th}>Available now</th>}
                {checked && <th style={th}>Locked on date</th>}
                {checked && <th style={th}>Net available</th>}
                <th style={th}>Coordinator qty</th>
              </tr>
            </thead>
            <tbody>
              {requestedEquipment.map((item) => {
                const avail = availMap[item.equipmentTypeId];
                const netOk = !avail || avail.net_available >= (planned[item.equipmentTypeId] ?? item.quantity);
                return (
                  <tr key={item.equipmentTypeId} style={{ background: checked && !netOk ? '#fff8f8' : undefined }}>
                    <td style={td}>{item.name}</td>
                    <td style={{ ...td, color: '#5c6773' }}>{item.quantity}</td>
                    {checked && <td style={td}>{avail?.available_now ?? '—'}</td>}
                    {checked && <td style={td}>{avail?.locked_on_date ?? '—'}</td>}
                    {checked && (
                      <td style={td}>
                        <span style={avail && avail.net_available < item.quantity ? { color: '#b3352b', fontWeight: 700 } : { color: '#1f7a45', fontWeight: 700 }}>
                          {avail?.net_available ?? '—'}
                        </span>
                      </td>
                    )}
                    <td style={td}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <button type="button" style={qtyBtn} onClick={() => setPlanned((p) => ({ ...p, [item.equipmentTypeId]: Math.max(0, (p[item.equipmentTypeId] ?? item.quantity) - 1) }))}>−</button>
                        <span style={{ font: '600 15px var(--font-body)', minWidth: 24, textAlign: 'center' }}>{planned[item.equipmentTypeId] ?? item.quantity}</span>
                        <button type="button" style={qtyBtn} onClick={() => setPlanned((p) => ({ ...p, [item.equipmentTypeId]: (p[item.equipmentTypeId] ?? item.quantity) + 1 }))}>+</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {equipmentSupport !== 'SELF' && (
        <button style={primaryBtn} disabled={checking} onClick={runInventoryCheck}>
          {checking ? 'Checking inventory…' : checked ? '🔄 Re-check inventory' : '📦 Check Inventory Availability'}
        </button>
      )}

      {checked && availability.some((a) => a.net_available < (planned[a.equipment_type_id] ?? 0)) && (
        <div style={{ ...box.err, marginTop: 12 }}>
          ⚠ Some equipment types have insufficient net availability on the session date(s). Adjust the coordinator quantities above or send back to the student explaining the shortfall.
        </div>
      )}

      {/* Equipment allocation planner (existing per-session allocator) */}
      <div style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid #eee' }}>
        <span style={lbl}>Equipment allocation plan (per session)</span>
        <p style={{ margin: '4px 0 12px', fontSize: 13, color: '#5c6773' }}>
          Set exact equipment per session. This gets sent to the Super Admin with the forward and locks into the T-24h system on approval.
        </p>
        {planNotice && <div style={{ ...box.ok, marginBottom: 10 }}>{planNotice}</div>}
        <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
          <select style={inp2} value={activeSessionId} onChange={(e) => setActiveSessionId(e.target.value)}>
            {sessions.map((s) => <option key={s.request_session_id} value={s.request_session_id}>Session {s.session_no}</option>)}
          </select>
          <select style={inp2} value={addType} onChange={(e) => setAddType(Number(e.target.value))}>
            <option value={0}>Add equipment type…</option>
            {allTypes.map((t) => <option key={t.equipment_type_id} value={t.equipment_type_id}>{t.name}{t.lending_unit === 'PAIR' ? ' (pair)' : ''}</option>)}
          </select>
          <button type="button" style={ghostBtn} onClick={addLine}>Add</button>
        </div>
        {Object.keys(lines).length > 0 && (
          <table style={{ ...tbl, marginBottom: 10 }}>
            <thead><tr><th style={th}>Session</th><th style={th}>Equipment</th><th style={th}>Qty</th><th style={th} /></tr></thead>
            <tbody>
              {Object.entries(lines).map(([k, qty]) => {
                const [sessionId, typeIdStr] = k.split(':');
                const s = sessions.find((x) => x.request_session_id === sessionId);
                const t = allTypes.find((x) => x.equipment_type_id === Number(typeIdStr));
                return (
                  <tr key={k}>
                    <td style={td}>Session {s?.session_no}</td>
                    <td style={td}>{t?.name ?? '—'}{t?.lending_unit === 'PAIR' ? <span style={{ fontSize: 11, color: '#5c6773', marginLeft: 4 }}>(pair)</span> : null}</td>
                    <td style={td}><input type="number" min={1} style={{ ...inp2, width: 70 }} value={qty} onChange={(e) => setLines((cur) => ({ ...cur, [k]: e.target.value }))} /></td>
                    <td style={{ ...td, textAlign: 'right' }}><button type="button" style={{ ...ghostBtn, padding: '4px 10px', fontSize: 12 }} onClick={() => removeLine(k)}>Remove</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <button type="button" style={acceptBtn} disabled={savingPlan} onClick={saveEquipmentPlan}>
          {savingPlan ? 'Saving…' : 'Save Equipment Plan'}
        </button>
      </div>
    </div>
  );
}

// ── Decision Panel ────────────────────────────────────────────────────────────
function DecisionPanel({ item, detail, onDone, onError, onBack }: {
  item: QueueBooking;
  detail: BookingDetailFull;
  onDone: (m: string) => void;
  onError: (m: string) => void;
  onBack: () => void;
}) {
  const [note, setNote] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  async function forward() {
    setBusy(true);
    try { await forwardBooking(item.booking_id, note || undefined); onDone('Forwarded to Super Admin.'); }
    catch (e) { onError(errMsg(e)); } finally { setBusy(false); }
  }
  async function reject() {
    if (!reason.trim()) { onError('A reason is required.'); return; }
    setBusy(true);
    try { await rejectBooking(item.booking_id, reason); onDone(`Request rejected.`); }
    catch (e) { onError(errMsg(e)); } finally { setBusy(false); }
  }

  return (
    <div>
      <div style={{ background: '#f0f4f8', border: '1px solid #e5e7eb', borderRadius: 8, padding: '14px 18px', marginBottom: 18, fontSize: 13.5, color: '#26485f', lineHeight: 1.6 }}>
        <strong>Before forwarding:</strong> confirm that the conflict check is clear (Conflict Check tab) and the equipment plan is saved (Equipment tab). The Super Admin will see your feasibility note and the equipment allocation you've set.
      </div>

      {!rejecting ? (
        <div>
          <label style={lbl}>Feasibility note (sent to Super Admin with forward — optional)</label>
          <textarea style={{ ...textarea, width: '100%', maxWidth: '100%' }} rows={3} value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Conflict check clear. Equipment allocated. Recommend approval." />
          <div style={actionRow}>
            <button style={acceptBtn} disabled={busy} onClick={forward}>Forward to Super Admin</button>
            <button style={rejectBtn} onClick={() => setRejecting(true)}>Reject…</button>
            <button style={ghostBtn} onClick={onBack}>Back to queue</button>
          </div>
        </div>
      ) : (
        <div>
          <label style={lbl}>Rejection reason (sent to the requester)</label>
          <textarea style={{ ...textarea, width: '100%', maxWidth: '100%' }} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          <div style={actionRow}>
            <button style={rejectBtn} disabled={!reason.trim() || busy} onClick={reject}>Confirm rejection</button>
            <button style={ghostBtn} onClick={() => setRejecting(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Metadata renderer ─────────────────────────────────────────────────────────
function renderMeta(meta: Record<string, unknown>): React.ReactNode {
  const type = meta.bookingType as string;
  const rows: Array<[string, string]> = [
    ['Booking type', type === 'INTER_UNIVERSITY' ? 'Inter-University Competition' : 'Internal Competition'],
    ['Sport', String(meta.sport ?? '—')],
    ['Event format', `${meta.eventFormat ?? '—'} · ${meta.matchFormat ?? '—'}`],
  ];

  if (type === 'INTER_UNIVERSITY') {
    rows.push(
      ['BUKC team', String(meta.bukcTeamName ?? '—')],
      ['Visiting team', `${meta.visitingTeamName ?? '—'} (${meta.visitingUniversity ?? '—'}, ${meta.visitingCity ?? '—'})`],
    );
    if (meta.bukcHasCaptain) rows.push(['BUKC Captain', `${meta.bukcCaptainName ?? '—'} · ${meta.bukcCaptainEnrollment ?? ''} · ${meta.bukcCaptainContact ?? ''}`]);
    if (meta.visitingHasCaptain) rows.push(['Visiting Captain', `${meta.visitingCaptainName ?? '—'} · ${meta.visitingCaptainContact ?? ''}`]);
    const players = meta.bukcPlayers as Array<{ fullName: string; enrollmentNo: string }> | undefined;
    if (players) rows.push(['BUKC roster', players.map((p) => `${p.fullName} (${p.enrollmentNo})`).join(', ')]);
  } else {
    rows.push(
      ['Team A', String(meta.teamAName ?? '—')],
      ['Team B', String(meta.teamBName ?? '—')],
      ['Organizer', String(meta.organizingEntity ?? '—')],
    );
    if (meta.teamAHasCaptain) rows.push(['Team A Captain', `${meta.teamACaptainName ?? '—'} · ${meta.teamACaptainEnrollment ?? ''}`]);
    if (meta.teamBHasCaptain) rows.push(['Team B Captain', `${meta.teamBCaptainName ?? '—'}`]);
    const aPlayers = meta.teamAPlayers as Array<{ fullName: string; enrollmentNo?: string }> | undefined;
    if (aPlayers) rows.push(['Team A roster', aPlayers.map((p) => `${p.fullName}${p.enrollmentNo ? ` (${p.enrollmentNo})` : ''}`).join(', ')]);
    const bPlayers = meta.teamBPlayers as Array<{ fullName: string }> | undefined;
    if (bPlayers) rows.push(['Team B roster', bPlayers.map((p) => p.fullName).join(', ')]);
  }

  const eq = meta.equipmentItems as Array<{ name: string; quantity: number }> | undefined;
  rows.push(['Equipment support', meta.equipmentSupport === 'UNIVERSITY' ? 'University support required' : 'Teams supply own']);
  if (eq && eq.length > 0) {
    rows.push(['Requested equipment', eq.map((e) => `${e.name} ×${e.quantity}`).join(', ')]);
  }
  if (meta.specialRequirements) rows.push(['Special requirements', String(meta.specialRequirements)]);

  return (
    <div style={{ display: 'grid', gap: 6 }}>
      {rows.map(([label, value]) => (
        <div key={label} style={{ display: 'grid', gridTemplateColumns: '180px 1fr', fontSize: 13.5 }}>
          <span style={{ font: '600 12px var(--font-body)', color: '#5c6773', textTransform: 'uppercase', letterSpacing: '0.03em', alignSelf: 'start', paddingTop: 2 }}>{label}</span>
          <span style={{ color: '#333', lineHeight: 1.5 }}>{value}</span>
        </div>
      ))}
    </div>
  );
}

// ── Academic Event Form ───────────────────────────────────────────────────────
function AcademicEventForm({ venues, onDone, onError }: { venues: Venue[]; onDone: (m: string) => void; onError: (m: string) => void }) {
  const [venueId, setVenue] = useState(0);
  const [purpose, setPurpose] = useState('');
  const [estimatedParticipants, setParticipants] = useState(50);
  const [busy, setBusy] = useState(false);
  const { rows, addRow, removeRow, updateRow, toSessionInputs } = useSessionRows();

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
    <form onSubmit={submit} style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, maxWidth: 620 }}>
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

// ── Shared components ─────────────────────────────────────────────────────────
function Row({ label, value }: { label: string; value: string }) {
  return <div style={detailRow}><div style={detailLabel}>{label}</div><div style={{ fontSize: 14.5, color: '#333' }}>{value}</div></div>;
}
function Panel({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return <section style={panel}><div style={panelHead}><span>{title}</span>{action}</div><div style={panelBody}>{children}</div></section>;
}
function L({ label, children }: { label: string; children: React.ReactNode }) {
  return <label style={{ display: 'block' }}><span style={lbl}>{label}</span>{children}</label>;
}

// ── Styles ────────────────────────────────────────────────────────────────────
const wrap: React.CSSProperties = { maxWidth: 920, margin: '0 auto' };
const panel: React.CSSProperties = { background: '#fff', border: '1px solid #ddd', borderRadius: 8, marginBottom: 18, boxShadow: '0 1px 3px rgba(0,0,0,0.07)' };
const panelHead: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 20px', borderBottom: '1px solid #e5e5e5', font: '600 16px var(--font-body)', color: '#26485f', background: 'linear-gradient(#fff,#f7f9fb)', borderRadius: '8px 8px 0 0' };
const panelBody: React.CSSProperties = { padding: '20px 24px' };
const tbl: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 14 };
const th: React.CSSProperties = { textAlign: 'left', font: '600 11px var(--font-body)', color: '#888', textTransform: 'uppercase', letterSpacing: '0.04em', padding: '0 8px 8px', borderBottom: '1px solid #e5e5e5' };
const td: React.CSSProperties = { padding: '10px 8px', borderBottom: '1px solid #eee', color: '#333', verticalAlign: 'top' };
const muted: React.CSSProperties = { color: '#5c6773', fontSize: 14, margin: 0 };
const lbl: React.CSSProperties = { display: 'block', font: '500 12px var(--font-body)', color: '#26485f', marginBottom: 5 };
const inp: React.CSSProperties = { width: '100%', font: '14px var(--font-body)', padding: '8px 10px', border: '1px solid #ccc', borderRadius: 6, boxSizing: 'border-box' as const };
const inp2: React.CSSProperties = { font: '13.5px var(--font-body)', padding: '7px 9px', border: '1px solid #ccc', borderRadius: 4 };
const textarea: React.CSSProperties = { font: '14px var(--font-body)', padding: '8px 10px', border: '1px solid #ccc', borderRadius: 6, resize: 'vertical' as const, boxSizing: 'border-box' as const };
const reviewBtn: React.CSSProperties = { background: '#0a6ebd', color: '#fff', border: 'none', borderRadius: 6, padding: '7px 16px', fontSize: 14, cursor: 'pointer' };
const primaryBtn: React.CSSProperties = { background: '#26485f', color: '#fff', border: 'none', borderRadius: 6, padding: '9px 18px', fontSize: 14, cursor: 'pointer', fontWeight: 600 };
const ghostBtn: React.CSSProperties = { background: '#fff', color: '#555', border: '1px solid #ccc', borderRadius: 6, padding: '9px 18px', fontSize: 14, cursor: 'pointer' };
const acceptBtn: React.CSSProperties = { background: '#1f8a4c', color: '#fff', border: 'none', borderRadius: 6, padding: '9px 18px', fontSize: 14.5, cursor: 'pointer' };
const rejectBtn: React.CSSProperties = { background: '#c0392b', color: '#fff', border: 'none', borderRadius: 6, padding: '9px 18px', fontSize: 14.5, cursor: 'pointer' };
const warnBtn: React.CSSProperties = { background: '#9a6412', color: '#fff', border: 'none', borderRadius: 6, padding: '9px 18px', fontSize: 14, cursor: 'pointer', fontWeight: 600 };
const actionRow: React.CSSProperties = { display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' };
const detailRow: React.CSSProperties = { display: 'grid', gridTemplateColumns: '160px 1fr', padding: '8px 0', borderBottom: '1px solid #f0f0f0' };
const detailLabel: React.CSSProperties = { font: '600 13px var(--font-body)', color: '#555' };
const tabRow: React.CSSProperties = { display: 'flex', gap: 2, background: '#f0f4f8', borderRadius: 8, padding: 4, marginBottom: 20 };
const tabBtnBase: React.CSSProperties = { flex: 1, font: '500 13px var(--font-body)', padding: '9px 8px', border: 'none', background: 'transparent', color: '#5c6773', borderRadius: 6, cursor: 'pointer', textAlign: 'center' };
const tabBtnActive: React.CSSProperties = { background: '#fff', color: '#26485f', fontWeight: 700, boxShadow: '0 1px 3px rgba(0,0,0,0.1)' };
const badge = {
  danger: { background: '#fdecec', color: '#8f2323', font: '600 11px var(--font-mono)', padding: '2px 8px', borderRadius: 4, display: 'inline-block' } as React.CSSProperties,
};
const qtyBtn: React.CSSProperties = { width: 26, height: 26, borderRadius: 5, border: '1px solid #ccc', background: '#fff', cursor: 'pointer', font: '600 14px var(--font-body)', display: 'flex', alignItems: 'center', justifyContent: 'center' };
const box = {
  err: { background: '#fdecec', color: '#8f2323', border: '1px solid #f3caca', borderRadius: 6, padding: '10px 14px', marginBottom: 12, fontSize: 14 } as React.CSSProperties,
  ok: { background: '#eaf6ee', color: '#1e6b3a', border: '1px solid #c2e6cd', borderRadius: 6, padding: '10px 14px', marginBottom: 12, fontSize: 14 } as React.CSSProperties,
};
