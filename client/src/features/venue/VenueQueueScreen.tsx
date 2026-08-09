/**
 * Coordinator — Venue Queue (VENUE-09..17).
 *
 * ReviewPanel is a locked linear stepper:
 *   Step 1 — Booking Details (unified view: basic info + full pitch metadata)
 *   Step 2 — Conflict Check (run check → visual timeline → propose alternative if needed)
 *   Step 3 — Equipment (single allocation for the event; inventory check with locked-on-date)
 *   Step 4 — Decision (forward / reject / send back to student)
 *
 * Rules:
 *  - Next button only activates after required action on current step
 *  - Step 2: must run conflict check before proceeding
 *  - Step 3: must run inventory check before proceeding (if university support requested)
 *  - Send Back is always available from step 4 regardless of conflict/equipment state
 *  - Proposed schedule from conflict check flows into equipment check (uses new dates)
 */
import { useEffect, useState, useCallback } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth.js';
import { PortalShell } from '../auth/PortalShell.js';
import {
  listQueue, forwardBooking, rejectBooking, getBookingFull, listVenues,
  initiateAcademicEvent, planAllocation, sendBackToRequester, checkEquipmentForSessions,
  queryConflicts, listCalendar,
  type QueueBooking, type BookingDetailFull, type Venue, type ApprovedSession,
  type EquipmentAvailRow, type CalendarSession,
} from './api.js';
import { listTypes, type EquipmentType } from '../inventory/api.js';
import { useSessionRows, SessionRowsEditor } from './SessionsBuilder.js';
import { ApiRequestError } from '../../lib/api.js';

function errMsg(e: unknown) { return e instanceof ApiRequestError ? e.body.error : 'Something went wrong.'; }
function fmtTime(d: string | Date) { return new Date(d).toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit', hour12: true }); }
function fmtDate(d: string) { return new Date(d).toLocaleDateString('en-PK', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }); }

// ── Root screen ──────────────────────────────────────────────────────────────
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
              action={<button style={ghostBtn} onClick={() => setShowAcademic(v => !v)}>{showAcademic ? 'Close' : 'Initiate Event'}</button>}>
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

// ── ReviewPanel: locked linear stepper ───────────────────────────────────────
type Step = 1 | 2 | 3 | 4;

function ReviewPanel({ item, onBack, onDone, onError }: {
  item: QueueBooking; onBack: () => void; onDone: (m: string) => void; onError: (m: string) => void;
}) {
  const [step, setStep] = useState<Step>(1);
  const [detail, setDetail] = useState<BookingDetailFull | null>(null);
  const [loading, setLoading] = useState(true);

  // Cross-step shared state
  // Proposed sessions from conflict check (null = use originals)
  const [proposedSessions, setProposedSessions] = useState<Array<{ sessionNo: number; startAt: string; endAt: string }> | null>(null);
  // Equipment availability result from step 3
  const [equipAvail, setEquipAvail] = useState<EquipmentAvailRow[]>([]);
  // Equipment quantities coordinator will allocate
  const [equipQty, setEquipQty] = useState<Record<number, number>>({});

  // Step completion gates
  const [conflictChecked, setConflictChecked] = useState(false);
  const [equipChecked, setEquipChecked] = useState(false);

  useEffect(() => {
    setLoading(true);
    getBookingFull(item.booking_id)
      .then((d) => {
        setDetail(d);
        // Initialize equipment quantities from student's request
        const meta = d.booking_metadata as Record<string, unknown> | null;
        const items = (meta?.equipmentItems as Array<{ equipmentTypeId: number; quantity: number }> | undefined) ?? [];
        setEquipQty(Object.fromEntries(items.map((e) => [e.equipmentTypeId, e.quantity])));
      })
      .catch((e) => onError(errMsg(e)))
      .finally(() => setLoading(false));
  }, [item.booking_id]); // eslint-disable-line

  if (loading || !detail) {
    return <Panel title={`Review — ${item.requester_name ?? 'BUKC Sports Dept.'}`}><p style={muted}>Loading…</p></Panel>;
  }

  const meta = detail.booking_metadata as Record<string, unknown> | null;
  const requestedEquipment = (meta?.equipmentItems as Array<{ name: string; equipmentTypeId: number; quantity: number }> | undefined) ?? [];
  const equipmentSupport = (meta?.equipmentSupport as string) ?? 'SELF';
  const requesterName = detail.requester_name ?? 'the requester';

  // Effective sessions (proposed overrides original if set)
  const effectiveSessions = proposedSessions
    ? proposedSessions.map((p) => ({
        request_session_id: `proposed-${p.sessionNo}`,
        session_no: p.sessionNo,
        requested_start_at: p.startAt,
        requested_end_at: p.endAt,
        team_name: '',
        participant_details: null,
      }))
    : detail.sessions;

  const STEPS = [
    { n: 1, label: 'Booking Details', canProceed: true },
    { n: 2, label: 'Conflict Check', canProceed: conflictChecked },
    { n: 3, label: 'Equipment', canProceed: equipChecked || equipmentSupport === 'SELF' },
    { n: 4, label: 'Decision', canProceed: true },
  ];

  return (
    <Panel title={`Review — ${requesterName}`}>
      {/* Stepper header */}
      <div style={stepperWrap}>
        {STEPS.map((s, i) => (
          <div key={s.n} style={{ display: 'flex', alignItems: 'center', flex: i < STEPS.length - 1 ? 1 : 0 }}>
            <div
              style={{
                width: 30, height: 30, borderRadius: '50%', display: 'flex', alignItems: 'center',
                justifyContent: 'center', font: '700 13px var(--font-body)', flexShrink: 0,
                background: step > s.n ? '#1f8a4c' : step === s.n ? '#26485f' : '#e5e7eb',
                color: step >= s.n ? '#fff' : '#8a949f',
                cursor: step > s.n ? 'pointer' : 'default',
              }}
              onClick={() => { if (step > s.n) setStep(s.n as Step); }}
            >
              {step > s.n ? '✓' : s.n}
            </div>
            <span style={{ fontSize: 12, marginLeft: 6, color: step === s.n ? '#26485f' : '#8a949f', fontWeight: step === s.n ? 700 : 400, whiteSpace: 'nowrap', flexShrink: 0 }}>
              {s.label}
            </span>
            {i < STEPS.length - 1 && <div style={{ flex: 1, height: 2, background: step > s.n ? '#1f8a4c' : '#e5e7eb', margin: '0 8px' }} />}
          </div>
        ))}
      </div>

      {/* ── STEP 1: Unified Booking Details ── */}
      {step === 1 && (
        <Step1Details detail={detail} meta={meta} />
      )}

      {/* ── STEP 2: Conflict Check ── */}
      {step === 2 && (
        <Step2ConflictCheck
          detail={detail}
          effectiveSessions={effectiveSessions}
          proposedSessions={proposedSessions}
          onConflictChecked={() => setConflictChecked(true)}
          onProposedSessionsChange={setProposedSessions}
          requesterName={requesterName}
          onSentBack={onDone}
          onError={onError}
        />
      )}

      {/* ── STEP 3: Equipment ── */}
      {step === 3 && (
        <Step3Equipment
          bookingId={detail.booking_id}
          effectiveSessions={effectiveSessions}
          requestedEquipment={requestedEquipment}
          equipmentSupport={equipmentSupport}
          equipQty={equipQty}
          equipAvail={equipAvail}
          onEquipQtyChange={setEquipQty}
          onEquipAvailChange={setEquipAvail}
          onChecked={() => setEquipChecked(true)}
          onError={onError}
        />
      )}

      {/* ── STEP 4: Decision ── */}
      {step === 4 && (
        <Step4Decision
          item={item}
          detail={detail}
          proposedSessions={proposedSessions}
          equipQty={equipQty}
          requestedEquipment={requestedEquipment}
          requesterName={requesterName}
          onDone={onDone}
          onError={onError}
          onBack={onBack}
        />
      )}

      {/* Navigation */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 24, paddingTop: 16, borderTop: '1px solid #e5e7eb' }}>
        <button style={ghostBtn} onClick={step === 1 ? onBack : () => setStep((s) => (s - 1) as Step)}>
          {step === 1 ? '← Back to queue' : '← Previous'}
        </button>
        {step < 4 && (
          <button
            style={{ ...primaryBtn, opacity: STEPS[step - 1]?.canProceed ? 1 : 0.4, cursor: STEPS[step - 1]?.canProceed ? 'pointer' : 'not-allowed' }}
            disabled={!STEPS[step - 1]?.canProceed}
            onClick={() => setStep((s) => (s + 1) as Step)}
          >
            Next →
          </button>
        )}
      </div>
    </Panel>
  );
}

// ── Step 1: Unified Booking Details ──────────────────────────────────────────
function Step1Details({ detail, meta }: { detail: BookingDetailFull; meta: Record<string, unknown> | null }) {
  const type = meta?.bookingType as string | undefined;

  const infoRows: Array<[string, string]> = [
    ['Venue', detail.venue_name],
    ['Purpose', detail.purpose],
    ['Total participants', String(detail.estimated_participants)],
    ...(detail.requester_email ? [['Requester email', detail.requester_email] as [string, string]] : []),
    ...(detail.requester_name ? [['Requester', detail.requester_name] as [string, string]] : []),
  ];

  if (meta) {
    infoRows.push(['Booking type', type === 'INTER_UNIVERSITY' ? 'Inter-University Competition' : 'Internal Competition']);
    infoRows.push(['Sport', String(meta.sport ?? '—')]);
    infoRows.push(['Event format', `${meta.eventFormat ?? '—'} · ${meta.matchFormat ?? '—'}`]);

    if (type === 'INTER_UNIVERSITY') {
      infoRows.push(['BUKC team', String(meta.bukcTeamName ?? '—')]);
      if (meta.bukcHasCaptain) infoRows.push(['BUKC captain', `${meta.bukcCaptainName ?? '—'} · ${meta.bukcCaptainEnrollment ?? ''} · ${meta.bukcCaptainContact ?? ''}`]);
      const bp = meta.bukcPlayers as Array<{ fullName: string; enrollmentNo: string }> | undefined;
      if (bp?.length) infoRows.push(['BUKC roster', bp.map((p) => `${p.fullName} (${p.enrollmentNo})`).join(', ')]);
      infoRows.push(['Visiting team', `${meta.visitingTeamName ?? '—'} — ${meta.visitingUniversity ?? '—'}, ${meta.visitingCity ?? '—'}`]);
      if (meta.visitingHasCaptain) infoRows.push(['Visiting captain', `${meta.visitingCaptainName ?? '—'} · ${meta.visitingCaptainContact ?? ''}`]);
    } else {
      infoRows.push(['Team A', String(meta.teamAName ?? '—')]);
      if (meta.teamAHasCaptain) infoRows.push(['Team A captain', `${meta.teamACaptainName ?? '—'} · ${meta.teamACaptainEnrollment ?? ''} · ${meta.teamACaptainContact ?? ''}`]);
      const ap = meta.teamAPlayers as Array<{ fullName: string; enrollmentNo?: string }> | undefined;
      if (ap?.length) infoRows.push(['Team A roster', ap.map((p) => `${p.fullName}${p.enrollmentNo ? ` (${p.enrollmentNo})` : ''}`).join(', ')]);
      infoRows.push(['Team B', String(meta.teamBName ?? '—')]);
      if (meta.teamBHasCaptain) infoRows.push(['Team B captain', String(meta.teamBCaptainName ?? '—')]);
      const bp2 = meta.teamBPlayers as Array<{ fullName: string }> | undefined;
      if (bp2?.length) infoRows.push(['Team B roster', bp2.map((p) => p.fullName).join(', ')]);
      infoRows.push(['Organizer', String(meta.organizingEntity ?? '—')]);
    }

    infoRows.push(['Equipment support', meta.equipmentSupport === 'UNIVERSITY' ? 'University support required' : 'Teams supply own equipment']);
    const eq = meta.equipmentItems as Array<{ name: string; quantity: number }> | undefined;
    if (eq?.length) infoRows.push(['Requested equipment', eq.map((e) => `${e.name} ×${e.quantity}`).join(', ')]);
    if (meta.specialRequirements) infoRows.push(['Special requirements', String(meta.specialRequirements)]);
  }

  return (
    <div>
      <h3 style={stepTitle}>Step 1 — Booking Details</h3>

      {/* All info in one unified table */}
      <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden', marginBottom: 20 }}>
        {infoRows.map(([label, value], i) => (
          <div key={label} style={{ display: 'grid', gridTemplateColumns: '200px 1fr', padding: '9px 16px', borderBottom: i < infoRows.length - 1 ? '1px solid #f0f0f0' : 'none', background: i % 2 === 0 ? '#fff' : '#fafbfc', fontSize: 14 }}>
            <span style={{ font: '600 12px var(--font-body)', color: '#5c6773', textTransform: 'uppercase', letterSpacing: '0.04em', alignSelf: 'start', paddingTop: 2 }}>{label}</span>
            <span style={{ color: '#333', lineHeight: 1.6 }}>{value}</span>
          </div>
        ))}
      </div>

      {/* Sessions */}
      <div style={{ marginBottom: 8 }}>
        <span style={sectionLabel}>Sessions ({detail.sessions.length})</span>
        <table style={{ ...tbl, marginTop: 8 }}>
          <thead><tr><th style={th}>#</th><th style={th}>Date</th><th style={th}>Time window</th></tr></thead>
          <tbody>
            {detail.sessions.map((s) => (
              <tr key={s.request_session_id}>
                <td style={td}>{s.session_no}</td>
                <td style={td}>{fmtDate(s.requested_start_at)}</td>
                <td style={td}>{fmtTime(s.requested_start_at)} – {fmtTime(s.requested_end_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Step 2: Conflict Check ────────────────────────────────────────────────────
function Step2ConflictCheck({ detail, effectiveSessions, proposedSessions, onConflictChecked, onProposedSessionsChange, requesterName, onSentBack, onError }: {
  detail: BookingDetailFull;
  effectiveSessions: BookingDetailFull['sessions'];
  proposedSessions: Array<{ sessionNo: number; startAt: string; endAt: string }> | null;
  onConflictChecked: () => void;
  onProposedSessionsChange: (s: Array<{ sessionNo: number; startAt: string; endAt: string }> | null) => void;
  requesterName: string;
  onSentBack: (m: string) => void;
  onError: (m: string) => void;
}) {
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState(false);
  const [sessionConflicts, setSessionConflicts] = useState<Record<string, ApprovedSession[]>>({});
  const [calendarSessions, setCalendarSessions] = useState<CalendarSession[]>([]);
  const hasConflicts = Object.values(sessionConflicts).some((c) => c.length > 0);

  // Propose alternative schedule
  const { rows: proposalRows, addRow, removeRow, updateRow, toSessionInputs, setRows } = useSessionRows();
  const [showProposalEditor, setShowProposalEditor] = useState(false);

  // Send-back state (always available)
  const [sendBackNote, setSendBackNote] = useState('');
  const [sendingBack, setSendingBack] = useState(false);
  const [showSendBack, setShowSendBack] = useState(false);

  // Init proposal rows from effective sessions
  useEffect(() => {
    if (effectiveSessions.length > 0) {
      setRows(effectiveSessions.map((s, i) => ({
        sessionNo: i + 1,
        date: s.requested_start_at.slice(0, 10),
        startTime: s.requested_start_at.slice(11, 16),
        endTime: s.requested_end_at.slice(11, 16),
        participantDetails: '',
      })));
    }
  }, []); // eslint-disable-line

  async function runCheck() {
    setChecking(true);
    try {
      const earliest = effectiveSessions.reduce((m, s) => s.requested_start_at < m ? s.requested_start_at : m, effectiveSessions[0]!.requested_start_at);
      const latest = effectiveSessions.reduce((m, s) => s.requested_end_at > m ? s.requested_end_at : m, effectiveSessions[0]!.requested_end_at);

      // Fetch both conflicts AND calendar sessions for the visual
      const [conflictRes, calRes] = await Promise.all([
        queryConflicts({ venueId: detail.venue_id, from: earliest, to: latest }),
        listCalendar({ venueId: detail.venue_id, from: earliest, to: latest }),
      ]);

      const perSession: Record<string, ApprovedSession[]> = {};
      for (const s of effectiveSessions) {
        const sStart = new Date(s.requested_start_at);
        const sEnd = new Date(s.requested_end_at);
        perSession[s.request_session_id] = conflictRes.sessions.filter((a) =>
          sStart < new Date(a.ends_at) && sEnd > new Date(a.starts_at)
        );
      }

      setSessionConflicts(perSession);
      setCalendarSessions(calRes.sessions);
      setChecked(true);
      onConflictChecked();

      if (conflictRes.sessions.length > 0) setShowProposalEditor(true);
    } catch (e) { onError(errMsg(e)); }
    finally { setChecking(false); }
  }

  function applyProposal() {
    const inputs = toSessionInputs();
    const proposed = inputs.map((s) => ({
      sessionNo: s.sessionNo,
      startAt: s.requestedStartAt,
      endAt: s.requestedEndAt,
    }));
    onProposedSessionsChange(proposed);
  }

  function clearProposal() { onProposedSessionsChange(null); }

  async function doSendBack() {
    if (!sendBackNote.trim()) { onError('Write a note for the requester before sending back.'); return; }
    setSendingBack(true);
    try {
      const proposed = showProposalEditor
        ? toSessionInputs().map((s) => ({ sessionNo: s.sessionNo, startAt: s.requestedStartAt, endAt: s.requestedEndAt }))
        : undefined;
      await sendBackToRequester(detail.booking_id, { note: sendBackNote, proposedSessions: proposed });
      onSentBack(`Sent back to ${requesterName}.`);
    } catch (e) { onError(errMsg(e)); } finally { setSendingBack(false); }
  }

  return (
    <div>
      <h3 style={stepTitle}>Step 2 — Conflict Check</h3>
      <p style={{ margin: '0 0 16px', fontSize: 14, color: '#5c6773' }}>
        Compare the proposed session(s) against all approved bookings at <strong>{detail.venue_name}</strong>.
      </p>

      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <button style={primaryBtn} disabled={checking} onClick={runCheck}>
          {checking ? 'Checking…' : checked ? '🔄 Re-check' : '🔍 Run Conflict Check'}
        </button>
        {checked && (
          <button style={warnBtn} onClick={() => setShowSendBack(!showSendBack)}>
            {showSendBack ? 'Cancel send-back' : `↩ Send Back to ${requesterName}`}
          </button>
        )}
      </div>

      {checked && (
        <>
          {/* Overall result */}
          {!hasConflicts ? (
            <div style={{ ...box.ok, display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16 }}>
              <span style={{ fontSize: 18 }}>✅</span>
              <span>No conflicts. All {effectiveSessions.length} session{effectiveSessions.length > 1 ? 's' : ''} are free on the calendar.</span>
            </div>
          ) : (
            <div style={{ ...box.err, marginBottom: 16 }}>
              ⚠ {Object.values(sessionConflicts).filter((c) => c.length > 0).length} session(s) conflict with existing approved bookings.
            </div>
          )}

          {/* Per-session conflict detail + visual timeline */}
          {effectiveSessions.map((s) => {
            const cs = sessionConflicts[s.request_session_id] ?? [];
            const sessionDate = s.requested_start_at.slice(0, 10);
            const sessionStart = new Date(s.requested_start_at);
            const sessionEnd = new Date(s.requested_end_at);

            // All calendar sessions on this date for the visual
            const dayEvents = calendarSessions.filter((c) => c.starts_at.slice(0, 10) === sessionDate);

            return (
              <div key={s.request_session_id} style={{ marginBottom: 16, border: `1px solid ${cs.length > 0 ? '#fca5a5' : '#86efac'}`, borderRadius: 8, overflow: 'hidden' }}>
                <div style={{ padding: '8px 16px', background: cs.length > 0 ? '#fef2f2' : '#f0fdf4', display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ font: '600 13px var(--font-body)', color: cs.length > 0 ? '#991b1b' : '#166534' }}>
                    {cs.length > 0 ? `⚠ Session ${s.session_no} — CONFLICT` : `✓ Session ${s.session_no} — Clear`}
                  </span>
                  <span style={{ fontSize: 13, color: '#555' }}>
                    {fmtDate(s.requested_start_at)} · {fmtTime(s.requested_start_at)}–{fmtTime(s.requested_end_at)}
                  </span>
                </div>

                {/* Visual timeline for this day */}
                <div style={{ padding: '12px 16px', background: '#fff' }}>
                  <DayTimeline
                    date={sessionDate}
                    proposedStart={sessionStart}
                    proposedEnd={sessionEnd}
                    existingEvents={dayEvents}
                  />

                  {/* Conflicting booking details */}
                  {cs.map((c) => (
                    <div key={c.session_id} style={{ display: 'flex', gap: 10, marginTop: 8, padding: '8px 10px', background: '#fef2f2', borderRadius: 6, fontSize: 13 }}>
                      <span style={bdanger}>Conflict</span>
                      <div>
                        <div style={{ fontWeight: 600 }}>{c.purpose}</div>
                        <div style={{ color: '#5c6773' }}>{fmtTime(c.starts_at)}–{fmtTime(c.ends_at)} · {c.requester_name ?? 'Internal'}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          {/* Propose alternative schedule */}
          {showProposalEditor && (
            <div style={{ marginTop: 16, padding: 16, border: '1px solid #dbeafe', borderRadius: 8, background: '#eff6ff' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <span style={{ font: '600 14px var(--font-body)', color: '#1e40af' }}>📅 Proposed Alternative Schedule</span>
                {proposedSessions && (
                  <button style={{ ...ghostBtn, fontSize: 12, padding: '4px 10px' }} onClick={clearProposal}>Clear proposal</button>
                )}
              </div>
              <p style={{ margin: '0 0 12px', fontSize: 13, color: '#3730a3' }}>
                Edit the dates and times below based on the free slots shown on the timeline above.
                Click "Apply as proposed schedule" to lock these in — they will be sent to the student and used for equipment checking.
              </p>
              <SessionRowsEditor
                rows={proposalRows}
                onAdd={addRow}
                onRemove={removeRow}
                onUpdate={updateRow}
                allowMultiple={effectiveSessions.length > 1}
              />
              <button style={{ ...primaryBtn, marginTop: 12 }} onClick={applyProposal}>
                ✓ Apply as proposed schedule
              </button>
              {proposedSessions && (
                <span style={{ marginLeft: 10, fontSize: 13, color: '#1f8a4c', fontWeight: 600 }}>✓ Proposal applied — equipment step will use these dates</span>
              )}
            </div>
          )}

          {!showProposalEditor && !hasConflicts && (
            <button style={{ ...ghostBtn, marginTop: 8, fontSize: 13 }} onClick={() => setShowProposalEditor(true)}>
              Propose an alternative schedule anyway…
            </button>
          )}
        </>
      )}

      {/* Send back panel — always accessible after conflict check */}
      {showSendBack && (
        <div style={{ marginTop: 20, padding: 16, border: '1px solid #fcd34d', borderRadius: 8, background: '#fffbeb' }}>
          <span style={{ font: '600 14px var(--font-body)', color: '#92400e' }}>↩ Send Back to {requesterName}</span>
          <p style={{ margin: '6px 0 10px', fontSize: 13, color: '#78350f' }}>
            Write your note below. If you applied a proposed schedule above, it will be included.
            The requester can accept (resubmits with your schedule) or decline (booking closed).
          </p>
          <textarea
            style={{ ...textarea, width: '100%', minHeight: 110, marginBottom: 10 }}
            placeholder="Explain the conflict or issue and what you propose. Be specific — include dates, times, and reasons."
            value={sendBackNote}
            onChange={(e) => setSendBackNote(e.target.value)}
          />
          {proposedSessions && (
            <div style={{ ...box.ok, marginBottom: 10, padding: '6px 12px', fontSize: 13 }}>
              ✓ Proposed schedule ({proposedSessions.length} session{proposedSessions.length > 1 ? 's' : ''}) will be included with this send-back.
            </div>
          )}
          <button style={warnBtn} disabled={sendingBack || !sendBackNote.trim()} onClick={doSendBack}>
            {sendingBack ? 'Sending…' : `↩ Send Back to ${requesterName}`}
          </button>
        </div>
      )}

      {!checked && (
        <div style={{ textAlign: 'center', padding: '32px 24px', color: '#8a949f' }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>🗓</div>
          <p style={{ margin: 0, fontSize: 14 }}>Run the conflict check to see what's on the calendar for {detail.venue_name} on the proposed session date(s).</p>
        </div>
      )}
    </div>
  );
}

// ── Day Timeline Visual ───────────────────────────────────────────────────────
function DayTimeline({ date, proposedStart, proposedEnd, existingEvents }: {
  date: string;
  proposedStart: Date;
  proposedEnd: Date;
  existingEvents: CalendarSession[];
}) {
  const HOUR_START = 7; // 7am
  const HOUR_END = 22;  // 10pm
  const TOTAL_HOURS = HOUR_END - HOUR_START;
  const BAR_HEIGHT = 48;

  function toPercent(d: Date) {
    const h = d.getHours() + d.getMinutes() / 60;
    return Math.max(0, Math.min(100, ((h - HOUR_START) / TOTAL_HOURS) * 100));
  }

  const hourLabels = Array.from({ length: TOTAL_HOURS + 1 }, (_, i) => i + HOUR_START);

  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 12, color: '#5c6773', marginBottom: 4 }}>
        Calendar view for {new Date(date + 'T12:00:00').toLocaleDateString('en-PK', { weekday: 'long', day: 'numeric', month: 'long' })}
      </div>
      <div style={{ position: 'relative', height: BAR_HEIGHT, background: '#f0fdf4', borderRadius: 6, border: '1px solid #86efac', overflow: 'hidden' }}>
        {/* Hour grid lines */}
        {hourLabels.map((h) => (
          <div key={h} style={{ position: 'absolute', left: `${((h - HOUR_START) / TOTAL_HOURS) * 100}%`, top: 0, bottom: 0, width: 1, background: '#d1fae5', opacity: 0.6 }} />
        ))}

        {/* Existing events (red) */}
        {existingEvents.map((e) => {
          const s = new Date(e.starts_at); const en = new Date(e.ends_at);
          if (s.toISOString().slice(0, 10) !== date) return null;
          const left = toPercent(s); const right = toPercent(en);
          return (
            <div key={e.session_id} title={`Booked: ${fmtTime(e.starts_at)}–${fmtTime(e.ends_at)}`}
              style={{ position: 'absolute', left: `${left}%`, width: `${right - left}%`, top: 4, bottom: 4, background: '#fca5a5', borderRadius: 3, border: '1px solid #ef4444', opacity: 0.85 }} />
          );
        })}

        {/* Proposed slot (blue) */}
        {proposedStart.toISOString().slice(0, 10) === date && (
          <div title={`Proposed: ${fmtTime(proposedStart)}–${fmtTime(proposedEnd)}`}
            style={{ position: 'absolute', left: `${toPercent(proposedStart)}%`, width: `${toPercent(proposedEnd) - toPercent(proposedStart)}%`, top: 4, bottom: 4, background: '#93c5fd', borderRadius: 3, border: '2px solid #3b82f6' }} />
        )}
      </div>
      {/* Hour labels */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2 }}>
        {hourLabels.filter((_, i) => i % 2 === 0).map((h) => (
          <span key={h} style={{ fontSize: 10, color: '#9ca3af' }}>{h}:00</span>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 12, marginTop: 4, fontSize: 11, color: '#5c6773' }}>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, background: '#93c5fd', border: '1px solid #3b82f6', borderRadius: 2, marginRight: 3 }} />Proposed slot</span>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, background: '#fca5a5', border: '1px solid #ef4444', borderRadius: 2, marginRight: 3 }} />Already booked</span>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 2, marginRight: 3 }} />Free</span>
      </div>
    </div>
  );
}

// ── Step 3: Equipment ─────────────────────────────────────────────────────────
function Step3Equipment({ bookingId, effectiveSessions, requestedEquipment, equipmentSupport, equipQty, equipAvail, onEquipQtyChange, onEquipAvailChange, onChecked, onError }: {
  bookingId: string;
  effectiveSessions: BookingDetailFull['sessions'];
  requestedEquipment: Array<{ name: string; equipmentTypeId: number; quantity: number }>;
  equipmentSupport: string;
  equipQty: Record<number, number>;
  equipAvail: EquipmentAvailRow[];
  onEquipQtyChange: (q: Record<number, number>) => void;
  onEquipAvailChange: (a: EquipmentAvailRow[]) => void;
  onChecked: () => void;
  onError: (m: string) => void;
}) {
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState(equipAvail.length > 0);
  const [savingPlan, setSavingPlan] = useState(false);
  const [planNotice, setPlanNotice] = useState<string | null>(null);
  const [allTypes, setAllTypes] = useState<EquipmentType[]>([]);

  useEffect(() => { listTypes().then((r) => setAllTypes(r.types)).catch(() => {}); }, []);

  const availMap = Object.fromEntries(equipAvail.map((a) => [a.equipment_type_id, a]));

  async function runInventoryCheck() {
    if (requestedEquipment.length === 0) { onError('No equipment was requested — nothing to check.'); return; }
    setChecking(true);
    try {
      const typeIds = requestedEquipment.map((e) => e.equipmentTypeId);
      const windows = effectiveSessions.map((s) => ({ startAt: s.requested_start_at, endAt: s.requested_end_at }));
      const res = await checkEquipmentForSessions(bookingId, { equipmentTypeIds: typeIds, sessionWindows: windows });
      onEquipAvailChange(res.availability);
      setChecked(true);
      onChecked();
    } catch (e) { onError(errMsg(e)); } finally { setChecking(false); }
  }

  // Save equipment plan — same quantities applied across all sessions
  async function saveEquipmentPlan() {
    const allocations: Array<{ requestSessionId: string; equipmentTypeId: number; quantity: number }> = [];
    for (const s of effectiveSessions) {
      for (const item of requestedEquipment) {
        const qty = equipQty[item.equipmentTypeId] ?? item.quantity;
        if (qty > 0) allocations.push({ requestSessionId: s.request_session_id, equipmentTypeId: item.equipmentTypeId, quantity: qty });
      }
    }
    if (allocations.length === 0) { onError('No equipment quantities set.'); return; }
    setSavingPlan(true); setPlanNotice(null);
    try {
      const res = await planAllocation(bookingId, allocations);
      setPlanNotice(res.shortfalls.length > 0
        ? `Plan saved with shortfalls: ${res.shortfalls.map((s) => `${s.equipmentTypeId}: need ${s.requested}, have ${s.available}`).join('; ')}`
        : 'Equipment plan saved successfully.');
    } catch (e) { onError(errMsg(e)); } finally { setSavingPlan(false); }
  }

  if (equipmentSupport === 'SELF') {
    return (
      <div>
        <h3 style={stepTitle}>Step 3 — Equipment</h3>
        <div style={{ ...box.ok }}>Both teams will supply their own equipment — no university allocation needed. Proceed to the next step.</div>
      </div>
    );
  }

  const hasShortfall = requestedEquipment.some((item) => {
    const a = availMap[item.equipmentTypeId];
    return a && a.net_available < (equipQty[item.equipmentTypeId] ?? item.quantity);
  });

  const sessionDates = [...new Set(effectiveSessions.map((s) => s.requested_start_at.slice(0, 10)))];

  return (
    <div>
      <h3 style={stepTitle}>Step 3 — Equipment Allocation</h3>

      {/* Session dates context */}
      <div style={{ ...infoBox, marginBottom: 16 }}>
        <strong>Session date{sessionDates.length > 1 ? 's' : ''}:</strong> {sessionDates.map((d) => fmtDate(d + 'T00:00:00')).join(', ')}.
        Equipment will be locked 24h before each session. The inventory check accounts for units already locked in other approved events on these dates.
        {effectiveSessions.length > 1 && ' The same equipment counts apply across all sessions.'}
      </div>

      {/* Equipment table */}
      <table style={{ ...tbl, marginBottom: 16 }}>
        <thead>
          <tr>
            <th style={th}>Equipment</th>
            <th style={th}>Student requested</th>
            {checked && <th style={th}>Available now</th>}
            {checked && <th style={{ ...th, color: '#9a6412' }}>Locked on date(s)</th>}
            {checked && <th style={{ ...th, color: '#26485f' }}>Net available</th>}
            <th style={th}>Coordinator qty</th>
          </tr>
        </thead>
        <tbody>
          {requestedEquipment.map((item) => {
            const avail = availMap[item.equipmentTypeId];
            const coordQty = equipQty[item.equipmentTypeId] ?? item.quantity;
            const isShort = avail && avail.net_available < coordQty;
            return (
              <tr key={item.equipmentTypeId} style={{ background: isShort ? '#fff8f8' : undefined }}>
                <td style={td}>{item.name}</td>
                <td style={{ ...td, color: '#5c6773' }}>{item.quantity}</td>
                {checked && <td style={td}>{avail?.available_now ?? '—'}</td>}
                {checked && (
                  <td style={td}>
                    <span style={{ color: (avail?.locked_on_date ?? 0) > 0 ? '#9a6412' : '#5c6773', fontWeight: (avail?.locked_on_date ?? 0) > 0 ? 700 : 400 }}>
                      {avail?.locked_on_date ?? '—'}
                    </span>
                  </td>
                )}
                {checked && (
                  <td style={td}>
                    <span style={{ color: isShort ? '#b3352b' : '#1f7a45', fontWeight: 700 }}>
                      {avail?.net_available ?? '—'}
                    </span>
                  </td>
                )}
                <td style={td}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <button style={qtyBtn} type="button" onClick={() => onEquipQtyChange({ ...equipQty, [item.equipmentTypeId]: Math.max(0, coordQty - 1) })}>−</button>
                    <span style={{ font: '600 15px var(--font-body)', minWidth: 24, textAlign: 'center' }}>{coordQty}</span>
                    <button style={qtyBtn} type="button" onClick={() => onEquipQtyChange({ ...equipQty, [item.equipmentTypeId]: coordQty + 1 })}>+</button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <button style={primaryBtn} disabled={checking} onClick={runInventoryCheck}>
          {checking ? 'Checking…' : checked ? '🔄 Re-check inventory' : '📦 Check Inventory Availability'}
        </button>
        {checked && (
          <button style={acceptBtn} disabled={savingPlan} onClick={saveEquipmentPlan}>
            {savingPlan ? 'Saving…' : '💾 Save Equipment Plan'}
          </button>
        )}
      </div>

      {planNotice && <div style={planNotice.includes('shortfall') ? box.err : box.ok}>{planNotice}</div>}

      {checked && hasShortfall && (
        <div style={{ ...box.err, marginTop: 8 }}>
          ⚠ Some equipment types have insufficient availability after accounting for existing locks. Reduce coordinator quantities or send back to the student from the Decision step.
        </div>
      )}

      {!checked && <p style={{ fontSize: 13, color: '#8a949f', marginTop: 4 }}>Run the inventory check to proceed to the Decision step.</p>}
    </div>
  );
}

// ── Step 4: Decision ──────────────────────────────────────────────────────────
function Step4Decision({ item, detail, proposedSessions, equipQty, requestedEquipment, requesterName, onDone, onError, onBack }: {
  item: QueueBooking;
  detail: BookingDetailFull;
  proposedSessions: Array<{ sessionNo: number; startAt: string; endAt: string }> | null;
  equipQty: Record<number, number>;
  requestedEquipment: Array<{ name: string; equipmentTypeId: number; quantity: number }>;
  requesterName: string;
  onDone: (m: string) => void;
  onError: (m: string) => void;
  onBack: () => void;
}) {
  const [mode, setMode] = useState<'none' | 'reject' | 'sendback'>('none');
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [sendBackNote, setSendBackNote] = useState('');
  const [busy, setBusy] = useState(false);

  async function forward() {
    setBusy(true);
    try { await forwardBooking(item.booking_id, note || undefined); onDone('Forwarded to Super Admin.'); }
    catch (e) { onError(errMsg(e)); } finally { setBusy(false); }
  }
  async function reject() {
    if (!reason.trim()) { onError('Rejection reason is required.'); return; }
    setBusy(true);
    try { await rejectBooking(item.booking_id, reason); onDone('Request rejected.'); }
    catch (e) { onError(errMsg(e)); } finally { setBusy(false); }
  }
  async function doSendBack() {
    if (!sendBackNote.trim()) { onError('Write a note for the requester.'); return; }
    setBusy(true);
    try {
      await sendBackToRequester(detail.booking_id, { note: sendBackNote, proposedSessions: proposedSessions ?? undefined });
      onDone(`Sent back to ${requesterName}.`);
    } catch (e) { onError(errMsg(e)); } finally { setBusy(false); }
  }

  // Summary of what's been set
  const equippedItems = requestedEquipment.filter((e) => (equipQty[e.equipmentTypeId] ?? e.quantity) > 0);

  return (
    <div>
      <h3 style={stepTitle}>Step 4 — Decision</h3>

      {/* Review summary */}
      <div style={{ background: '#f7f9fb', border: '1px solid #e5e7eb', borderRadius: 8, padding: '14px 18px', marginBottom: 20 }}>
        <div style={{ font: '600 13px var(--font-body)', color: '#26485f', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Review Summary</div>
        <div style={{ display: 'grid', gap: 6, fontSize: 13.5 }}>
          <div>📅 <strong>Sessions:</strong> {proposedSessions ? `${proposedSessions.length} proposed alternative session(s)` : `${detail.sessions.length} original session(s)`}</div>
          {equippedItems.length > 0 && (
            <div>📦 <strong>Equipment:</strong> {equippedItems.map((e) => `${e.name} ×${equipQty[e.equipmentTypeId] ?? e.quantity}`).join(', ')}</div>
          )}
          {proposedSessions && (
            <div style={{ color: '#1e40af' }}>ℹ Proposed schedule will be included if you send back or forward.</div>
          )}
        </div>
      </div>

      {mode === 'none' && (
        <div>
          <div style={{ marginBottom: 16 }}>
            <label style={lbl}>Feasibility note for Super Admin (optional)</label>
            <textarea style={{ ...textarea, width: '100%' }} rows={3} value={note} onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Conflict check clear. Equipment plan saved. Recommend approval." />
          </div>
          <div style={actionRow}>
            <button style={acceptBtn} disabled={busy} onClick={forward}>Forward to Super Admin</button>
            <button style={rejectBtn} onClick={() => setMode('reject')}>Reject…</button>
            <button style={warnBtn} onClick={() => setMode('sendback')}>↩ Send Back to {requesterName}…</button>
            <button style={ghostBtn} onClick={onBack}>← Back to queue</button>
          </div>
        </div>
      )}

      {mode === 'reject' && (
        <div>
          <label style={lbl}>Rejection reason (sent to {requesterName})</label>
          <textarea style={{ ...textarea, width: '100%' }} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          <div style={actionRow}>
            <button style={rejectBtn} disabled={!reason.trim() || busy} onClick={reject}>Confirm rejection</button>
            <button style={ghostBtn} onClick={() => setMode('none')}>Cancel</button>
          </div>
        </div>
      )}

      {mode === 'sendback' && (
        <div>
          <label style={lbl}>Note to {requesterName} *</label>
          <textarea style={{ ...textarea, width: '100%', minHeight: 100 }} value={sendBackNote} onChange={(e) => setSendBackNote(e.target.value)}
            placeholder="Explain the conflict or equipment issue and what changes you're proposing." />
          {proposedSessions && (
            <div style={{ ...box.ok, margin: '8px 0', padding: '6px 12px', fontSize: 13 }}>
              ✓ Proposed schedule ({proposedSessions.length} session{proposedSessions.length > 1 ? 's' : ''}) will be included.
            </div>
          )}
          <div style={actionRow}>
            <button style={warnBtn} disabled={!sendBackNote.trim() || busy} onClick={doSendBack}>
              {busy ? 'Sending…' : `↩ Send Back to ${requesterName}`}
            </button>
            <button style={ghostBtn} onClick={() => setMode('none')}>Cancel</button>
          </div>
        </div>
      )}
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

// ── Shared UI ─────────────────────────────────────────────────────────────────
function Panel({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return <section style={panel}><div style={panelHead}><span>{title}</span>{action}</div><div style={panelBody}>{children}</div></section>;
}
function L({ label, children }: { label: string; children: React.ReactNode }) {
  return <label style={{ display: 'block' }}><span style={lbl}>{label}</span>{children}</label>;
}

// ── Styles ────────────────────────────────────────────────────────────────────
const wrap: React.CSSProperties = { maxWidth: 940, margin: '0 auto' };
const panel: React.CSSProperties = { background: '#fff', border: '1px solid #ddd', borderRadius: 8, marginBottom: 18, boxShadow: '0 1px 3px rgba(0,0,0,0.07)' };
const panelHead: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 20px', borderBottom: '1px solid #e5e5e5', font: '600 16px var(--font-body)', color: '#26485f', background: 'linear-gradient(#fff,#f7f9fb)', borderRadius: '8px 8px 0 0' };
const panelBody: React.CSSProperties = { padding: '20px 24px' };
const stepperWrap: React.CSSProperties = { display: 'flex', alignItems: 'center', marginBottom: 28, padding: '0 2px' };
const stepTitle: React.CSSProperties = { margin: '0 0 18px', font: '700 18px var(--font-body)', color: '#26485f' };
const sectionLabel: React.CSSProperties = { font: '600 12px var(--font-body)', color: '#26485f', textTransform: 'uppercase', letterSpacing: '0.04em' };
const tbl: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 14 };
const th: React.CSSProperties = { textAlign: 'left', font: '600 11px var(--font-body)', color: '#888', textTransform: 'uppercase', letterSpacing: '0.04em', padding: '0 8px 8px', borderBottom: '1px solid #e5e5e5' };
const td: React.CSSProperties = { padding: '10px 8px', borderBottom: '1px solid #eee', color: '#333', verticalAlign: 'top' };
const muted: React.CSSProperties = { color: '#5c6773', fontSize: 14, margin: 0 };
const lbl: React.CSSProperties = { display: 'block', font: '500 12px var(--font-body)', color: '#26485f', marginBottom: 5 };
const inp: React.CSSProperties = { width: '100%', font: '14px var(--font-body)', padding: '8px 10px', border: '1px solid #ccc', borderRadius: 6, boxSizing: 'border-box' as const };
const textarea: React.CSSProperties = { font: '14px var(--font-body)', padding: '9px 11px', border: '1px solid #ccc', borderRadius: 6, resize: 'vertical' as const, boxSizing: 'border-box' as const };
const infoBox: React.CSSProperties = { padding: '10px 14px', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 6, fontSize: 13.5, color: '#1e40af', lineHeight: 1.6 };
const reviewBtn: React.CSSProperties = { background: '#0a6ebd', color: '#fff', border: 'none', borderRadius: 6, padding: '7px 16px', fontSize: 14, cursor: 'pointer' };
const primaryBtn: React.CSSProperties = { background: '#26485f', color: '#fff', border: 'none', borderRadius: 6, padding: '9px 18px', fontSize: 14, cursor: 'pointer', fontWeight: 600 };
const ghostBtn: React.CSSProperties = { background: '#fff', color: '#555', border: '1px solid #ccc', borderRadius: 6, padding: '9px 18px', fontSize: 14, cursor: 'pointer' };
const acceptBtn: React.CSSProperties = { background: '#1f8a4c', color: '#fff', border: 'none', borderRadius: 6, padding: '9px 18px', fontSize: 14.5, cursor: 'pointer' };
const rejectBtn: React.CSSProperties = { background: '#c0392b', color: '#fff', border: 'none', borderRadius: 6, padding: '9px 18px', fontSize: 14.5, cursor: 'pointer' };
const warnBtn: React.CSSProperties = { background: '#9a6412', color: '#fff', border: 'none', borderRadius: 6, padding: '9px 18px', fontSize: 14, cursor: 'pointer', fontWeight: 600 };
const actionRow: React.CSSProperties = { display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' };
const qtyBtn: React.CSSProperties = { width: 26, height: 26, borderRadius: 5, border: '1px solid #ccc', background: '#fff', cursor: 'pointer', font: '600 14px var(--font-body)' };
const bdanger: React.CSSProperties = { background: '#fef2f2', color: '#991b1b', font: '600 11px var(--font-mono)', padding: '2px 7px', borderRadius: 4, flexShrink: 0 };
const box = {
  err: { background: '#fdecec', color: '#8f2323', border: '1px solid #f3caca', borderRadius: 6, padding: '10px 14px', marginBottom: 12, fontSize: 14 } as React.CSSProperties,
  ok: { background: '#eaf6ee', color: '#1e6b3a', border: '1px solid #c2e6cd', borderRadius: 6, padding: '10px 14px', marginBottom: 12, fontSize: 14 } as React.CSSProperties,
};
