/**
 * Coordinator — Venue Queue.
 *
 * ReviewPanel is a 4-step locked linear stepper. ALL step state is lifted
 * into ReviewPanel so navigating back/forward preserves everything.
 *
 * Step 1 — Booking Details: unified single table, all info from DB.
 * Step 2 — Conflict Check: run check → visual timeline → propose alt schedule.
 *           No send-back here — just planning. State preserved on back.
 * Step 3 — Equipment: article-level picker per type. Qty capped at student
 *           request. Warning when below. ON_LOAN articles show return date.
 *           Locked-elsewhere articles shown as unavailable.
 * Step 4 — Decision: final send-back panel shows compiled summary (proposed
 *           schedule + equipment changes + rich-text note) before sending.
 *           Also: Forward or Reject.
 */
import { useEffect, useState, useCallback } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth.js';
import { PortalShell } from '../auth/PortalShell.js';
import {
  listQueue, forwardBooking, rejectBooking, getBookingFull, listVenues,
  initiateAcademicEvent, planAllocation, sendBackToRequester,
  checkEquipmentForSessions, queryConflicts, listCalendar, getArticleAvailability,
  type QueueBooking, type BookingDetailFull, type Venue, type CalendarSession,
  type ApprovedSession, type EquipmentAvailRow, type ArticleAvailGroup, type ArticleAvailEntry,
} from './api.js';
import { useSessionRows, SessionRowsEditor, type SessionRow } from './SessionsBuilder.js';
import { ApiRequestError } from '../../lib/api.js';

function errMsg(e: unknown) { return e instanceof ApiRequestError ? e.body.error : 'Something went wrong.'; }
function fmtDate(iso: string) { return new Date(iso).toLocaleDateString('en-PK', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }); }
function fmtTime(iso: string) { return new Date(iso).toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' }); }
function fmtDT(iso: string) { return new Date(iso).toLocaleString('en-PK', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); }

type ProposedSession = { sessionNo: number; startAt: string; endAt: string };

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

  return (
    <PortalShell title="Venue Queue" tint="slate">
      <div style={wrap}>
        {error && <div style={box.err}>{error}</div>}
        {notice && <div style={box.ok}>{notice}</div>}

        {selected ? (
          <ReviewPanel item={selected}
            onBack={() => setSelected(null)}
            onDone={(m) => { setNotice(m); setError(null); setSelected(null); void load(); }}
            onError={(m) => { setError(m); setNotice(null); }} />
        ) : (
          <>
            <Panel title="Pending Booking Requests">
              {queue === null ? <p style={muted}>Loading…</p>
                : queue.length === 0 ? <p style={muted}>No pending venue requests.</p>
                : (
                  <table style={tbl}>
                    <thead><tr><th style={th}>Requester</th><th style={th}>Venue</th><th style={th}>Sessions</th><th style={th}>Participants</th><th style={th} /></tr></thead>
                    <tbody>
                      {queue.map((q) => (
                        <tr key={q.booking_id}>
                          <td style={td}><div style={{ fontWeight: 600 }}>{q.requester_name ?? 'BUKC Sports Dept.'}</div><div style={{ color: '#8a949f', fontSize: 12 }}>{q.origin}</div></td>
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

            <Panel title="Academic Calendar Events"
              action={<button style={ghostBtn} onClick={() => setShowAcademic((v) => !v)}>{showAcademic ? 'Close' : 'Initiate Event'}</button>}>
              {showAcademic
                ? <AcademicEventForm venues={venues}
                    onDone={(m) => { setNotice(m); setNotice(m); setShowAcademic(false); void load(); }}
                    onError={(m) => setError(m)} />
                : <p style={muted}>Recurring annual events — same review pipeline, no student requester.</p>}
            </Panel>
          </>
        )}
      </div>
    </PortalShell>
  );
}

// ── ReviewPanel: all state lifted here ───────────────────────────────────────
type StepN = 1 | 2 | 3 | 4;

function ReviewPanel({ item, onBack, onDone, onError }: {
  item: QueueBooking; onBack: () => void; onDone: (m: string) => void; onError: (m: string) => void;
}) {
  const [step, setStep] = useState<StepN>(1);
  const [detail, setDetail] = useState<BookingDetailFull | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(true);

  // ── Step 2 persistent state ──
  const [conflictChecked, setConflictChecked] = useState(false);
  const [sessionConflicts, setSessionConflicts] = useState<Record<string, ApprovedSession[]>>({});
  const [calendarSessions, setCalendarSessions] = useState<CalendarSession[]>([]);
  const [proposedSessions, setProposedSessions] = useState<ProposedSession[] | null>(null);
  // Proposal rows stored so they survive step navigation
  const [proposalRows, setProposalRows] = useState<SessionRow[]>([]);
  const [showProposalEditor, setShowProposalEditor] = useState(false);

  // ── Step 3 persistent state ──
  const [equipChecked, setEquipChecked] = useState(false);
  const [equipAvail, setEquipAvail] = useState<EquipmentAvailRow[]>([]);
  const [articleGroups, setArticleGroups] = useState<ArticleAvailGroup[]>([]);
  // Selected article IDs per equipment type
  const [selectedArticles, setSelectedArticles] = useState<Record<number, string[]>>({});
  // Coordinator final quantities (capped at student request)
  const [equipQty, setEquipQty] = useState<Record<number, number>>({});

  useEffect(() => {
    setLoadingDetail(true);
    getBookingFull(item.booking_id)
      .then((d) => {
        setDetail(d);
        const meta = d.booking_metadata as Record<string, unknown> | null;
        const items = (meta?.equipmentItems as Array<{ equipmentTypeId: number; quantity: number }> | undefined) ?? [];
        // Init coordinator qty from student request
        setEquipQty(Object.fromEntries(items.map((e) => [e.equipmentTypeId, e.quantity])));
        // Init proposal rows from original sessions
        setProposalRows(d.sessions.map((s, i) => ({
          sessionNo: i + 1,
          date: s.requested_start_at.slice(0, 10),
          startTime: s.requested_start_at.slice(11, 16),
          endTime: s.requested_end_at.slice(11, 16),
          participantDetails: '',
        })));
      })
      .catch((e) => onError(errMsg(e)))
      .finally(() => setLoadingDetail(false));
  }, [item.booking_id]); // eslint-disable-line

  if (loadingDetail || !detail) {
    return <Panel title={`Review — ${item.requester_name ?? 'BUKC Sports Dept.'}`}><p style={muted}>Loading…</p></Panel>;
  }

  const meta = detail.booking_metadata as Record<string, unknown> | null;
  const requestedEquipment = (meta?.equipmentItems as Array<{ name: string; equipmentTypeId: number; quantity: number }> | undefined) ?? [];
  const equipmentSupport = (meta?.equipmentSupport as string) ?? 'SELF';
  const requesterName = detail.requester_name ?? 'the requester';

  const effectiveSessions = proposedSessions
    ? proposedSessions.map((p, i) => ({
        request_session_id: `proposed-${i}`,
        session_no: p.sessionNo,
        requested_start_at: p.startAt,
        requested_end_at: p.endAt,
        team_name: '', participant_details: null,
      }))
    : detail.sessions;

  const hasConflicts = Object.values(sessionConflicts).some((c) => c.length > 0);
  const hasSelectionMismatch = equipmentSupport !== 'SELF' && requestedEquipment.some((item) => {
    const coordQty = equipQty[item.equipmentTypeId] ?? item.quantity;
    const selCount = (selectedArticles[item.equipmentTypeId] ?? []).length;
    return coordQty > 0 && selCount !== coordQty;
  });
  const equipStep3Pass = equipmentSupport === 'SELF' || (equipChecked && !hasSelectionMismatch);

  const STEPS = [
    { n: 1, label: 'Booking Details', pass: true },
    { n: 2, label: 'Conflict Check', pass: conflictChecked },
    { n: 3, label: 'Equipment', pass: equipStep3Pass },
    { n: 4, label: 'Decision', pass: true },
  ];

  return (
    <Panel title={`Review — ${requesterName}`}>
      {/* Stepper */}
      <div style={stepperWrap}>
        {STEPS.map((s, i) => (
          <div key={s.n} style={{ display: 'flex', alignItems: 'center', flex: i < STEPS.length - 1 ? 1 : 0 }}>
            <div style={{ width: 30, height: 30, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', font: '700 13px var(--font-body)', flexShrink: 0, background: step > s.n ? '#1f8a4c' : step === s.n ? '#26485f' : '#e5e7eb', color: step >= s.n ? '#fff' : '#8a949f', cursor: step > s.n ? 'pointer' : 'default' }}
              onClick={() => { if (step > s.n) setStep(s.n as StepN); }}>
              {step > s.n ? '✓' : s.n}
            </div>
            <span style={{ fontSize: 12, marginLeft: 6, color: step === s.n ? '#26485f' : '#8a949f', fontWeight: step === s.n ? 700 : 400, whiteSpace: 'nowrap', flexShrink: 0 }}>{s.label}</span>
            {i < STEPS.length - 1 && <div style={{ flex: 1, height: 2, background: step > s.n ? '#1f8a4c' : '#e5e7eb', margin: '0 8px' }} />}
          </div>
        ))}
      </div>

      {step === 1 && <Step1Details detail={detail} meta={meta} />}

      {step === 2 && (
        <Step2ConflictCheck
          detail={detail}
          effectiveSessions={effectiveSessions}
          conflictChecked={conflictChecked}
          sessionConflicts={sessionConflicts}
          calendarSessions={calendarSessions}
          proposedSessions={proposedSessions}
          proposalRows={proposalRows}
          showProposalEditor={showProposalEditor}
          onConflictChecked={(sc, cs) => { setSessionConflicts(sc); setCalendarSessions(cs); setConflictChecked(true); }}
          onProposedSessionsChange={setProposedSessions}
          onProposalRowsChange={setProposalRows}
          onShowProposalEditorChange={setShowProposalEditor}
          onError={onError}
        />
      )}

      {step === 3 && (
        <Step3Equipment
          bookingId={detail.booking_id}
          effectiveSessions={effectiveSessions}
          requestedEquipment={requestedEquipment}
          equipmentSupport={equipmentSupport}
          equipQty={equipQty}
          equipAvail={equipAvail}
          articleGroups={articleGroups}
          selectedArticles={selectedArticles}
          onEquipQtyChange={setEquipQty}
          onEquipAvailChange={(a) => { setEquipAvail(a); setEquipChecked(true); }}
          onArticleGroupsChange={setArticleGroups}
          onSelectedArticlesChange={setSelectedArticles}
          onError={onError}
        />
      )}

      {step === 4 && (
        <Step4Decision
          item={item}
          detail={detail}
          proposedSessions={proposedSessions}
          equipQty={equipQty}
          requestedEquipment={requestedEquipment}
          selectedArticles={selectedArticles}
          articleGroups={articleGroups}
          requesterName={requesterName}
          onDone={onDone}
          onError={onError}
          onBack={onBack}
        />
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 24, paddingTop: 16, borderTop: '1px solid #e5e7eb' }}>
        <button style={ghostBtn} onClick={step === 1 ? onBack : () => setStep((s) => (s - 1) as StepN)}>
          {step === 1 ? '← Back to queue' : '← Previous'}
        </button>
        {step < 4 && (
          <button
            style={{ ...primaryBtn, opacity: STEPS[step - 1]!.pass ? 1 : 0.4, cursor: STEPS[step - 1]!.pass ? 'pointer' : 'not-allowed' }}
            disabled={!STEPS[step - 1]!.pass}
            onClick={async () => {
              // Auto-save equipment plan when leaving step 3
              if (step === 3 && equipmentSupport !== 'SELF' && requestedEquipment.length > 0) {
                const allocations: Array<{ requestSessionId: string; equipmentTypeId: number; quantity: number }> = [];
                for (const s of effectiveSessions) {
                  for (const item of requestedEquipment) {
                    const qty = equipQty[item.equipmentTypeId] ?? 0;
                    if (qty > 0) allocations.push({ requestSessionId: s.request_session_id, equipmentTypeId: item.equipmentTypeId, quantity: qty });
                  }
                }
                try { await planAllocation(detail.booking_id, allocations); } catch { /* non-fatal */ }
              }
              setStep((s) => (s + 1) as StepN);
            }}>
            Next →
          </button>
        )}
      </div>
    </Panel>
  );
}

// ── Step 1: Unified Booking Details ─────────────────────────────────────────
function Step1Details({ detail, meta }: { detail: BookingDetailFull; meta: Record<string, unknown> | null }) {
  const type = meta?.bookingType as string | undefined;
  const rows: Array<[string, string]> = [
    ['Venue', detail.venue_name],
    ['Purpose', detail.purpose],
    ['Total participants', String(detail.estimated_participants)],
    ...(detail.requester_name ? [['Requester', detail.requester_name] as [string, string]] : []),
    ...(detail.requester_email ? [['Email', detail.requester_email] as [string, string]] : []),
  ];

  if (meta) {
    rows.push(['Booking type', type === 'INTER_UNIVERSITY' ? 'Inter-University Competition' : 'Internal Competition']);
    rows.push(['Sport', String(meta.sport ?? '—')]);
    rows.push(['Event format', `${String(meta.eventFormat ?? '—').replace('_', ' ')} · ${String(meta.matchFormat ?? '—').replace('_', ' ')}`]);

    if (type === 'INTER_UNIVERSITY') {
      rows.push(['BUKC team', String(meta.bukcTeamName ?? '—')]);
      if (meta.bukcHasCaptain) rows.push(['BUKC captain', `${meta.bukcCaptainName ?? '—'} · ${meta.bukcCaptainEnrollment ?? ''} · ${meta.bukcCaptainContact ?? ''}`]);
      const bp = meta.bukcPlayers as Array<{ fullName: string; enrollmentNo: string }> | undefined;
      if (bp?.length) rows.push(['BUKC roster', bp.map((p) => `${p.fullName} (${p.enrollmentNo})`).join(', ')]);
      rows.push(['Visiting team', `${meta.visitingTeamName ?? '—'} — ${meta.visitingUniversity ?? '—'}, ${meta.visitingCity ?? '—'}`]);
      if (meta.visitingHasCaptain) rows.push(['Visiting captain', `${meta.visitingCaptainName ?? '—'} · ${meta.visitingCaptainContact ?? ''}`]);
    } else {
      rows.push(['Team A', String(meta.teamAName ?? '—')]);
      if (meta.teamAHasCaptain) rows.push(['Team A captain', `${meta.teamACaptainName ?? '—'} · ${meta.teamACaptainEnrollment ?? ''}`]);
      const ap = meta.teamAPlayers as Array<{ fullName: string; enrollmentNo?: string }> | undefined;
      if (ap?.length) rows.push(['Team A roster', ap.map((p) => `${p.fullName}${p.enrollmentNo ? ` (${p.enrollmentNo})` : ''}`).join(', ')]);
      rows.push(['Team B', String(meta.teamBName ?? '—')]);
      if (meta.teamBHasCaptain) rows.push(['Team B captain', String(meta.teamBCaptainName ?? '—')]);
      const bp2 = meta.teamBPlayers as Array<{ fullName: string }> | undefined;
      if (bp2?.length) rows.push(['Team B roster', bp2.map((p) => p.fullName).join(', ')]);
      rows.push(['Organizer', String(meta.organizingEntity ?? '—')]);
    }

    rows.push(['Equipment support', meta.equipmentSupport === 'UNIVERSITY' ? 'University support required' : 'Teams supply own']);
    const eq = meta.equipmentItems as Array<{ name: string; quantity: number }> | undefined;
    if (eq?.length) rows.push(['Requested equipment', eq.map((e) => `${e.name} ×${e.quantity}`).join(', ')]);
    if (meta.specialRequirements) rows.push(['Special requirements', String(meta.specialRequirements)]);
  }

  return (
    <div>
      <h3 style={stepTitle}>Step 1 — Booking Details</h3>
      <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden', marginBottom: 20 }}>
        {rows.map(([label, value], i) => (
          <div key={label} style={{ display: 'grid', gridTemplateColumns: '200px 1fr', padding: '9px 16px', borderBottom: i < rows.length - 1 ? '1px solid #f0f0f0' : 'none', background: i % 2 === 0 ? '#fff' : '#fafbfc', fontSize: 14 }}>
            <span style={{ font: '600 11px var(--font-body)', color: '#5c6773', textTransform: 'uppercase', letterSpacing: '0.04em', alignSelf: 'start', paddingTop: 2 }}>{label}</span>
            <span style={{ color: '#333', lineHeight: 1.6 }}>{value}</span>
          </div>
        ))}
      </div>
      <span style={sectionLabel}>Sessions ({detail.sessions.length})</span>
      <table style={{ ...tbl, marginTop: 8 }}>
        <thead><tr><th style={th}>#</th><th style={th}>Date</th><th style={th}>Time</th></tr></thead>
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
  );
}

// ── Step 2: Conflict Check (stateless — all state passed from parent) ────────
function Step2ConflictCheck({ detail, effectiveSessions, conflictChecked, sessionConflicts, calendarSessions, proposedSessions, proposalRows, showProposalEditor, onConflictChecked, onProposedSessionsChange, onProposalRowsChange, onShowProposalEditorChange, onError }: {
  detail: BookingDetailFull;
  effectiveSessions: BookingDetailFull['sessions'];
  conflictChecked: boolean;
  sessionConflicts: Record<string, ApprovedSession[]>;
  calendarSessions: CalendarSession[];
  proposedSessions: ProposedSession[] | null;
  proposalRows: SessionRow[];
  showProposalEditor: boolean;
  onConflictChecked: (sc: Record<string, ApprovedSession[]>, cs: CalendarSession[]) => void;
  onProposedSessionsChange: (s: ProposedSession[] | null) => void;
  onProposalRowsChange: (rows: SessionRow[]) => void;
  onShowProposalEditorChange: (v: boolean) => void;
  onError: (m: string) => void;
}) {
  const [checking, setChecking] = useState(false);
  const hasConflicts = Object.values(sessionConflicts).some((c) => c.length > 0);

  // Use a controlled SessionRowsEditor via direct row manipulation
  function addRow() {
    const next = proposalRows.length + 1;
    onProposalRowsChange([...proposalRows, { sessionNo: next, date: '', startTime: '10:00', endTime: '12:00', participantDetails: '' }]);
  }
  function removeRow(no: number) {
    onProposalRowsChange(proposalRows.filter((r) => r.sessionNo !== no).map((r, i) => ({ ...r, sessionNo: i + 1 })));
  }
  function updateRow(no: number, patch: Partial<SessionRow>) {
    onProposalRowsChange(proposalRows.map((r) => r.sessionNo === no ? { ...r, ...patch } : r));
  }

  async function runCheck() {
    setChecking(true);
    try {
      const earliest = effectiveSessions.reduce((m, s) => s.requested_start_at < m ? s.requested_start_at : m, effectiveSessions[0]!.requested_start_at);
      const latest = effectiveSessions.reduce((m, s) => s.requested_end_at > m ? s.requested_end_at : m, effectiveSessions[0]!.requested_end_at);
      const [conflictRes, calRes] = await Promise.all([
        queryConflicts({ venueId: detail.venue_id, from: earliest, to: latest }),
        listCalendar({ venueId: detail.venue_id, from: earliest, to: latest }),
      ]);
      const perSession: Record<string, ApprovedSession[]> = {};
      for (const s of effectiveSessions) {
        const sS = new Date(s.requested_start_at); const sE = new Date(s.requested_end_at);
        perSession[s.request_session_id] = conflictRes.sessions.filter((a) => sS < new Date(a.ends_at) && sE > new Date(a.starts_at));
      }
      onConflictChecked(perSession, calRes.sessions);
      if (conflictRes.sessions.length > 0) onShowProposalEditorChange(true);
    } catch (e) { onError(errMsg(e)); } finally { setChecking(false); }
  }

  function applyProposal() {
    const proposed = proposalRows.map((r) => ({
      sessionNo: r.sessionNo,
      startAt: new Date(`${r.date}T${r.startTime}:00`).toISOString(),
      endAt: new Date(`${r.date}T${r.endTime}:00`).toISOString(),
    }));
    onProposedSessionsChange(proposed);
  }

  return (
    <div>
      <h3 style={stepTitle}>Step 2 — Conflict Check</h3>
      <p style={{ margin: '0 0 16px', fontSize: 14, color: '#5c6773' }}>
        Compare proposed sessions against all approved bookings at <strong>{detail.venue_name}</strong>.
        Run the check to proceed. If conflicts are found, propose an alternative schedule below.
      </p>

      <button style={primaryBtn} disabled={checking} onClick={runCheck}>
        {checking ? 'Checking…' : conflictChecked ? '🔄 Re-check' : '🔍 Run Conflict Check'}
      </button>

      {conflictChecked && (
        <div style={{ marginTop: 16 }}>
          {!hasConflicts ? (
            <div style={{ ...box.ok, display: 'flex', gap: 10, alignItems: 'center' }}>
              <span style={{ fontSize: 18 }}>✅</span>
              <span>No conflicts — all {effectiveSessions.length} session{effectiveSessions.length > 1 ? 's' : ''} are free on the calendar.</span>
            </div>
          ) : (
            <div style={{ ...box.err }}>⚠ {Object.values(sessionConflicts).filter((c) => c.length > 0).length} session(s) conflict with existing approved bookings.</div>
          )}

          {effectiveSessions.map((s) => {
            const cs = sessionConflicts[s.request_session_id] ?? [];
            const date = s.requested_start_at.slice(0, 10);
            const dayEvents = calendarSessions.filter((c) => c.starts_at.slice(0, 10) === date);
            return (
              <div key={s.request_session_id} style={{ marginTop: 12, border: `1px solid ${cs.length > 0 ? '#fca5a5' : '#86efac'}`, borderRadius: 8, overflow: 'hidden' }}>
                <div style={{ padding: '8px 16px', background: cs.length > 0 ? '#fef2f2' : '#f0fdf4', display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ font: '600 13px var(--font-body)', color: cs.length > 0 ? '#991b1b' : '#166534' }}>
                    {cs.length > 0 ? `⚠ Session ${s.session_no} — CONFLICT` : `✓ Session ${s.session_no} — Clear`}
                  </span>
                  <span style={{ fontSize: 13, color: '#555' }}>{fmtDate(s.requested_start_at)} · {fmtTime(s.requested_start_at)}–{fmtTime(s.requested_end_at)}</span>
                </div>
                <div style={{ padding: '12px 16px' }}>
                  <DayTimeline date={date} proposedStart={new Date(s.requested_start_at)} proposedEnd={new Date(s.requested_end_at)} existingEvents={dayEvents} />
                  {cs.map((c) => (
                    <div key={c.session_id} style={{ display: 'flex', gap: 10, marginTop: 8, padding: '8px 10px', background: '#fef2f2', borderRadius: 6, fontSize: 13 }}>
                      <span style={bdanger}>Conflict</span>
                      <div><div style={{ fontWeight: 600 }}>{c.purpose}</div><div style={{ color: '#5c6773' }}>{fmtTime(c.starts_at)}–{fmtTime(c.ends_at)} · {c.requester_name ?? 'Internal'}</div></div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          {/* Propose alternative schedule */}
          <div style={{ marginTop: 16 }}>
            {!showProposalEditor && (
              <button style={{ ...ghostBtn, fontSize: 13 }} onClick={() => onShowProposalEditorChange(true)}>
                📅 {hasConflicts ? 'Propose an alternative schedule' : 'Propose an alternative schedule anyway…'}
              </button>
            )}
            {showProposalEditor && (
              <div style={{ padding: 16, border: '1px solid #bfdbfe', borderRadius: 8, background: '#eff6ff' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <span style={{ font: '600 14px var(--font-body)', color: '#1e40af' }}>📅 Proposed Alternative Schedule</span>
                  <button style={{ ...ghostBtn, fontSize: 12, padding: '4px 10px' }} onClick={() => { onShowProposalEditorChange(false); onProposedSessionsChange(null); }}>Clear</button>
                </div>
                <p style={{ margin: '0 0 12px', fontSize: 13, color: '#3730a3' }}>
                  Edit the dates and times below based on free slots visible in the timeline. Click "Apply" to lock these in — they flow into equipment checking and the final decision.
                </p>
                <SessionRowsEditor
                  rows={proposalRows}
                  onAdd={addRow}
                  onRemove={removeRow}
                  onUpdate={updateRow}
                  allowMultiple={effectiveSessions.length > 1}
                />
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12 }}>
                  <button style={primaryBtn} onClick={applyProposal}>✓ Apply as proposed schedule</button>
                  {proposedSessions && (
                    <span style={{ fontSize: 13, color: '#1f8a4c', fontWeight: 600 }}>✓ Applied — equipment step will use these dates</span>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {!conflictChecked && (
        <div style={{ textAlign: 'center', padding: '32px 24px', color: '#8a949f' }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>🗓</div>
          <p style={{ margin: 0, fontSize: 14 }}>Run the conflict check to see what's on the calendar for {detail.venue_name}.</p>
        </div>
      )}
    </div>
  );
}

// ── Day Timeline ─────────────────────────────────────────────────────────────
function DayTimeline({ date, proposedStart, proposedEnd, existingEvents }: {
  date: string; proposedStart: Date; proposedEnd: Date; existingEvents: CalendarSession[];
}) {
  const H0 = 7; const H1 = 22; const TOT = H1 - H0;
  function pct(d: Date) { return Math.max(0, Math.min(100, ((d.getHours() + d.getMinutes() / 60 - H0) / TOT) * 100)); }
  const labels = Array.from({ length: TOT + 1 }, (_, i) => i + H0);
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 12, color: '#5c6773', marginBottom: 4 }}>Calendar view for {new Date(date + 'T12:00:00').toLocaleDateString('en-PK', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
      <div style={{ position: 'relative', height: 48, background: '#f0fdf4', borderRadius: 6, border: '1px solid #86efac', overflow: 'hidden' }}>
        {labels.map((h) => <div key={h} style={{ position: 'absolute', left: `${((h - H0) / TOT) * 100}%`, top: 0, bottom: 0, width: 1, background: '#d1fae5' }} />)}
        {existingEvents.map((e) => {
          const s = new Date(e.starts_at); const en = new Date(e.ends_at);
          if (s.toISOString().slice(0, 10) !== date) return null;
          return <div key={e.session_id} title={`Booked: ${fmtTime(e.starts_at)}–${fmtTime(e.ends_at)}`} style={{ position: 'absolute', left: `${pct(s)}%`, width: `${pct(en) - pct(s)}%`, top: 4, bottom: 4, background: '#fca5a5', borderRadius: 3, border: '1px solid #ef4444' }} />;
        })}
        {proposedStart.toISOString().slice(0, 10) === date && (
          <div title={`Proposed: ${fmtTime(proposedStart.toISOString())}–${fmtTime(proposedEnd.toISOString())}`} style={{ position: 'absolute', left: `${pct(proposedStart)}%`, width: `${pct(proposedEnd) - pct(proposedStart)}%`, top: 4, bottom: 4, background: '#93c5fd', borderRadius: 3, border: '2px solid #3b82f6' }} />
        )}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2 }}>
        {labels.filter((_, i) => i % 2 === 0).map((h) => <span key={h} style={{ fontSize: 10, color: '#9ca3af' }}>{h}:00</span>)}
      </div>
      <div style={{ display: 'flex', gap: 12, marginTop: 4, fontSize: 11, color: '#5c6773' }}>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, background: '#93c5fd', border: '1px solid #3b82f6', borderRadius: 2, marginRight: 3 }} />Proposed</span>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, background: '#fca5a5', border: '1px solid #ef4444', borderRadius: 2, marginRight: 3 }} />Booked</span>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 2, marginRight: 3 }} />Free</span>
      </div>
    </div>
  );
}

// ── Step 3: Equipment ────────────────────────────────────────────────────────
function Step3Equipment({ bookingId, effectiveSessions, requestedEquipment, equipmentSupport, equipQty, equipAvail, articleGroups, selectedArticles, onEquipQtyChange, onEquipAvailChange, onArticleGroupsChange, onSelectedArticlesChange, onError }: {
  bookingId: string;
  effectiveSessions: BookingDetailFull['sessions'];
  requestedEquipment: Array<{ name: string; equipmentTypeId: number; quantity: number }>;
  equipmentSupport: string;
  equipQty: Record<number, number>;
  equipAvail: EquipmentAvailRow[];
  articleGroups: ArticleAvailGroup[];
  selectedArticles: Record<number, string[]>;
  onEquipQtyChange: (q: Record<number, number>) => void;
  onEquipAvailChange: (a: EquipmentAvailRow[]) => void;
  onArticleGroupsChange: (g: ArticleAvailGroup[]) => void;
  onSelectedArticlesChange: (s: Record<number, string[]>) => void;
  onError: (m: string) => void;
}) {
  const [checking, setChecking] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<number, boolean>>({});
  const isChecked = equipAvail.length > 0 || articleGroups.length > 0;
  const availMap = Object.fromEntries(equipAvail.map((a) => [a.equipment_type_id, a]));

  async function runCheck() {
    if (requestedEquipment.length === 0) { onError('No equipment was requested.'); return; }
    setChecking(true);
    try {
      const typeIds = requestedEquipment.map((e) => e.equipmentTypeId);
      const windows = effectiveSessions.map((s) => ({ startAt: s.requested_start_at, endAt: s.requested_end_at }));
      const [availRes, artRes] = await Promise.all([
        checkEquipmentForSessions(bookingId, { equipmentTypeIds: typeIds, sessionWindows: windows }),
        getArticleAvailability(bookingId, { sessionWindows: windows, equipmentTypeIds: typeIds }),
      ]);
      onEquipAvailChange(availRes.availability);
      onArticleGroupsChange(artRes.groups);
      const initSel: Record<number, string[]> = {};
      typeIds.forEach((id) => { initSel[id] = selectedArticles[id] ?? []; });
      onSelectedArticlesChange(initSel);
    } catch (e) { onError(errMsg(e)); } finally { setChecking(false); }
  }

  function toggleArticle(typeId: number, articleId: string) {
    const cur = selectedArticles[typeId] ?? [];
    const maxQty = equipQty[typeId] ?? 0;
    const next = cur.includes(articleId)
      ? cur.filter((id) => id !== articleId)
      : cur.length >= maxQty ? cur : [...cur, articleId];
    onSelectedArticlesChange({ ...selectedArticles, [typeId]: next });
  }

  function setQty(typeId: number, val: number) {
    const max = requestedEquipment.find((e) => e.equipmentTypeId === typeId)?.quantity ?? 0;
    const capped = Math.min(max, Math.max(0, val));
    const curSel = selectedArticles[typeId] ?? [];
    if (curSel.length > capped) onSelectedArticlesChange({ ...selectedArticles, [typeId]: curSel.slice(0, capped) });
    onEquipQtyChange({ ...equipQty, [typeId]: capped });
  }

  if (equipmentSupport === 'SELF') {
    return (
      <div>
        <h3 style={stepTitle}>Step 3 — Equipment</h3>
        <div style={box.ok}>Both teams supply their own equipment — no university allocation needed.</div>
      </div>
    );
  }

  const sessionDates = [...new Set(effectiveSessions.map((s) => s.requested_start_at.slice(0, 10)))];
  const hasShortfall = requestedEquipment.some((item) => {
    const a = availMap[item.equipmentTypeId];
    return a && a.net_available < (equipQty[item.equipmentTypeId] ?? item.quantity);
  });

  return (
    <div>
      <h3 style={stepTitle}>Step 3 — Equipment Allocation</h3>
      <div style={{ ...infoBox, marginBottom: 16 }}>
        <strong>Session date{sessionDates.length > 1 ? 's' : ''}:</strong>{' '}
        {sessionDates.map((d) => fmtDate(d + 'T00:00:00')).join(', ')}.
        {effectiveSessions.length > 1 && ' Same quantities apply across all sessions.'}
      </div>
      <button style={primaryBtn} disabled={checking} onClick={runCheck}>
        {checking ? 'Checking…' : isChecked ? '🔄 Re-check' : '📦 Check Inventory & Select Articles'}
      </button>

      {isChecked && (
        <div style={{ marginTop: 16 }}>
          {requestedEquipment.map((item) => {
            const avail = availMap[item.equipmentTypeId];
            const coordQty = equipQty[item.equipmentTypeId] ?? item.quantity;
            const studentReq = item.quantity;
            const isShort = avail && avail.net_available < coordQty;
            const isBelowReq = coordQty < studentReq;
            const group = articleGroups.find((g) => g.equipment_type_id === item.equipmentTypeId);
            const selArts = selectedArticles[item.equipmentTypeId] ?? [];
            const selMismatch = coordQty > 0 && selArts.length !== coordQty;
            const isCollapsed = collapsed[item.equipmentTypeId] ?? false;

            return (
              <div key={item.equipmentTypeId} style={{ marginBottom: 12, border: `1px solid ${isShort || selMismatch ? '#fca5a5' : '#e5e7eb'}`, borderRadius: 8, overflow: 'hidden' }}>
                {/* Collapsible header */}
                <div style={{ padding: '10px 14px', background: '#f7f9fb', borderBottom: isCollapsed ? 'none' : '1px solid #e5e7eb', cursor: 'pointer', display: 'grid', gridTemplateColumns: '1fr auto auto', alignItems: 'center', gap: 12 }}
                  onClick={() => setCollapsed((c) => ({ ...c, [item.equipmentTypeId]: !isCollapsed }))}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ font: '600 14px var(--font-body)', color: '#26485f' }}>{item.name}</span>
                    {group && <span style={{ fontSize: 12, color: '#5c6773' }}>({group.lending_unit.toLowerCase()})</span>}
                    <span style={{ fontSize: 12, fontWeight: 600, color: selMismatch ? '#c0392b' : selArts.length === coordQty && coordQty > 0 ? '#1f8a4c' : '#5c6773' }}>
                      {selArts.length}/{coordQty} selected{selMismatch ? ' — must match qty' : ''}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }} onClick={(e) => e.stopPropagation()}>
                    <span style={{ fontSize: 12, color: '#5c6773' }}>Qty (max {studentReq}):</span>
                    <button style={qtyBtn} onClick={() => setQty(item.equipmentTypeId, coordQty - 1)}>−</button>
                    <span style={{ font: '600 15px var(--font-body)', minWidth: 24, textAlign: 'center' }}>{coordQty}</span>
                    <button style={qtyBtn} onClick={() => setQty(item.equipmentTypeId, coordQty + 1)}>+</button>
                  </div>
                  <span style={{ fontSize: 16, color: '#5c6773', userSelect: 'none' }}>{isCollapsed ? '▶' : '▼'}</span>
                </div>

                {!isCollapsed && (
                  <>
                    <div style={{ padding: '8px 14px', display: 'flex', gap: 20, fontSize: 13, borderBottom: '1px solid #f0f0f0' }}>
                      <span>Available now: <strong>{avail?.available_now ?? '—'}</strong></span>
                      <span style={{ color: (avail?.locked_on_date ?? 0) > 0 ? '#9a6412' : '#5c6773' }}>Locked on date(s): <strong>{avail?.locked_on_date ?? '—'}</strong></span>
                      <span style={{ color: isShort ? '#b3352b' : '#1f7a45', fontWeight: 700 }}>Net available: {avail?.net_available ?? '—'}</span>
                    </div>
                    {isBelowReq && <div style={{ padding: '6px 14px', background: '#fdf1e3', borderBottom: '1px solid #f0e4b8', fontSize: 13, color: '#9a6412' }}>⚠ Allocating {coordQty} of {studentReq} requested — shortfall noted in send-back.</div>}
                    {isShort && <div style={{ padding: '6px 14px', background: '#fef2f2', borderBottom: '1px solid #fca5a5', fontSize: 13, color: '#991b1b' }}>⚠ Net available ({avail?.net_available}) &lt; coordinator qty ({coordQty}). Reduce or send back.</div>}
                    {selMismatch && <div style={{ padding: '6px 14px', background: '#fef2f2', borderBottom: '1px solid #fca5a5', fontSize: 13, color: '#991b1b' }}>⚠ Select exactly {coordQty} article{coordQty !== 1 ? 's' : ''} ({selArts.length} currently selected).</div>}
                    {group && (
                      <div style={{ padding: '10px 14px' }}>
                        <div style={{ font: '500 12px var(--font-body)', color: '#26485f', marginBottom: 8 }}>Select articles to allocate ({selArts.length}/{coordQty}):</div>
                        <div style={{ display: 'grid', gap: 6 }}>
                          {group.articles.map((art) => {
                            const isLocked = art.locked_elsewhere;
                            const isSelected = selArts.includes(art.article_id);
                            const canSelect = !isLocked && (isSelected || selArts.length < coordQty);
                            return (
                              <label key={art.article_id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', borderRadius: 6, border: `1px solid ${isSelected ? '#26485f' : '#e5e7eb'}`, background: isLocked ? '#f9fafb' : isSelected ? '#f0f4f8' : '#fff', cursor: isLocked || (!canSelect && !isSelected) ? 'not-allowed' : 'pointer', opacity: isLocked ? 0.55 : 1 }}>
                                <input type="checkbox" checked={isSelected} disabled={isLocked || (!canSelect && !isSelected)} onChange={() => toggleArticle(item.equipmentTypeId, art.article_id)} />
                                <span style={{ font: '500 13px var(--font-mono)', color: '#26485f' }}>{art.barcode}</span>
                                <span style={{ ...stateTag(art.state), fontSize: 11 }}>{art.state === 'ON_LOAN' ? 'On Loan' : 'Available'}</span>
                                {art.state === 'ON_LOAN' && art.expected_return_at && <span style={{ fontSize: 12, color: '#9a6412' }}>returns {fmtDT(art.expected_return_at)}</span>}
                                {isLocked && <span style={{ fontSize: 12, color: '#b3352b' }}>locked by another event</span>}
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
          {hasShortfall && <div style={{ ...box.err, marginTop: 8 }}>⚠ Insufficient availability for some types. Reduce quantities or send back.</div>}
        </div>
      )}
      {!isChecked && <p style={{ fontSize: 13, color: '#8a949f', marginTop: 12 }}>Run the inventory check to see article availability and select which items to allocate.</p>}
    </div>
  );
}

// ── Step 4: Decision ─────────────────────────────────────────────────────────
function Step4Decision({ item, detail, proposedSessions, equipQty, requestedEquipment, selectedArticles, articleGroups, requesterName, onDone, onError, onBack }: {
  item: QueueBooking;
  detail: BookingDetailFull;
  proposedSessions: ProposedSession[] | null;
  equipQty: Record<number, number>;
  requestedEquipment: Array<{ name: string; equipmentTypeId: number; quantity: number }>;
  selectedArticles: Record<number, string[]>;
  articleGroups: ArticleAvailGroup[];
  requesterName: string;
  onDone: (m: string) => void;
  onError: (m: string) => void;
  onBack: () => void;
}) {
  const [mode, setMode] = useState<'none' | 'reject' | 'sendback'>('none');
  const [feasNote, setFeasNote] = useState('');
  const [reason, setReason] = useState('');
  const [sendBackNote, setSendBackNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [noteErr, setNoteErr] = useState('');
  const [rejectErr, setRejectErr] = useState('');

  // Compile equipment changes for summary and send-back
  const equipChanges = requestedEquipment.map((e) => {
    const coordQty = equipQty[e.equipmentTypeId] ?? e.quantity;
    const below = coordQty < e.quantity;
    const group = articleGroups.find((g) => g.equipment_type_id === e.equipmentTypeId);
    const selIds = selectedArticles[e.equipmentTypeId] ?? [];
    const selArticles = group?.articles.filter((a) => selIds.includes(a.article_id)) ?? [];
    return { name: e.name, requested: e.quantity, allocated: coordQty, below, articles: selArticles };
  });
  const hasEquipChanges = equipChanges.some((e) => e.below);

  async function forward() {
    setBusy(true);
    try { await forwardBooking(item.booking_id, feasNote || undefined); onDone('Forwarded to Super Admin.'); }
    catch (e) { onError(errMsg(e)); } finally { setBusy(false); }
  }
  async function reject() {
    if (!reason.trim()) { setRejectErr('Rejection reason is required.'); return; }
    setRejectErr('');
    setBusy(true);
    try { await rejectBooking(item.booking_id, reason); onDone('Request rejected.'); }
    catch (e) { onError(errMsg(e)); } finally { setBusy(false); }
  }
  async function doSendBack() {
    if (!sendBackNote.trim()) { setNoteErr('Please write a note for the requester before sending back.'); return; }
    setNoteErr('');
    setBusy(true);
    try {
      await sendBackToRequester(detail.booking_id, { note: sendBackNote, proposedSessions: proposedSessions ?? undefined });
      onDone(`Sent back to ${requesterName}.`);
    } catch (e) { onError(errMsg(e)); } finally { setBusy(false); }
  }

  return (
    <div>
      <h3 style={stepTitle}>Step 4 — Decision</h3>

      {/* Review summary */}
      <div style={{ background: '#f7f9fb', border: '1px solid #e5e7eb', borderRadius: 8, padding: '14px 18px', marginBottom: 20 }}>
        <div style={{ font: '600 12px var(--font-body)', color: '#26485f', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 10 }}>Review Summary</div>
        <div style={{ display: 'grid', gap: 8, fontSize: 13.5 }}>
          <div>
            📅 <strong>Sessions:</strong>{' '}
            {proposedSessions ? (
              <span style={{ color: '#1e40af' }}>
                {proposedSessions.length} proposed alternative — {proposedSessions.map((s) => `${fmtDate(s.startAt)} ${fmtTime(s.startAt)}–${fmtTime(s.endAt)}`).join('; ')}
              </span>
            ) : (
              `${detail.sessions.length} original session${detail.sessions.length > 1 ? 's' : ''}`
            )}
          </div>
          {requestedEquipment.length > 0 && (
            <div>
              📦 <strong>Equipment:</strong>{' '}
              {equipChanges.map((e) => (
                <span key={e.name} style={{ marginRight: 10 }}>
                  {e.name} ×{e.allocated}{e.below && <span style={{ color: '#c0392b', marginLeft: 4 }}>(requested {e.requested})</span>}
                </span>
              ))}
            </div>
          )}
          {hasEquipChanges && (
            <div style={{ color: '#c0392b' }}>⚠ Equipment shortfall — some items are being allocated below the requested quantity.</div>
          )}
        </div>
      </div>

      {mode === 'none' && (
        <div>
          <div style={{ marginBottom: 16 }}>
            <label style={lbl}>Feasibility note for Super Admin (optional)</label>
            <textarea style={{ ...textarea, width: '100%' }} rows={3} value={feasNote} onChange={(e) => setFeasNote(e.target.value)} placeholder="e.g. Conflict check clear. Equipment plan saved. Recommend approval." />
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
          <label style={lbl}>Rejection reason (shown to {requesterName})</label>
          <textarea style={{ ...textarea, width: '100%', borderColor: rejectErr ? '#c0392b' : undefined }} rows={3} value={reason}
            onChange={(e) => { setReason(e.target.value); if (rejectErr) setRejectErr(''); }} />
          {rejectErr && <div style={{ color: '#c0392b', fontSize: 13, marginTop: 4, fontWeight: 500 }}>⚠ {rejectErr}</div>}
          <div style={actionRow}>
            <button style={rejectBtn} disabled={!reason.trim() || busy} onClick={reject}>Confirm rejection</button>
            <button style={ghostBtn} onClick={() => setMode('none')}>Cancel</button>
          </div>
        </div>
      )}

      {mode === 'sendback' && (
        <div style={{ border: '1px solid #fcd34d', borderRadius: 8, background: '#fffbeb', padding: 20 }}>
          <div style={{ font: '600 15px var(--font-body)', color: '#92400e', marginBottom: 6 }}>↩ Send Back to {requesterName}</div>

          {/* Compiled summary of what's changing */}
          <div style={{ background: '#fff', border: '1px solid #fde68a', borderRadius: 6, padding: '12px 14px', marginBottom: 14 }}>
            <div style={{ font: '600 12px var(--font-body)', color: '#78350f', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>Changes being communicated</div>
            {proposedSessions ? (
              <div style={{ marginBottom: 8 }}>
                <span style={{ font: '600 13px var(--font-body)', color: '#333' }}>📅 Proposed alternative schedule:</span>
                {proposedSessions.map((s) => (
                  <div key={s.sessionNo} style={{ fontSize: 13, color: '#555', marginLeft: 14, marginTop: 2 }}>
                    Session {s.sessionNo}: {fmtDate(s.startAt)} · {fmtTime(s.startAt)}–{fmtTime(s.endAt)}
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: 13, color: '#5c6773', marginBottom: 8 }}>📅 No schedule changes — original sessions remain.</div>
            )}
            {hasEquipChanges ? (
              <div>
                <span style={{ font: '600 13px var(--font-body)', color: '#333' }}>📦 Equipment shortfall:</span>
                {equipChanges.filter((e) => e.below).map((e) => (
                  <div key={e.name} style={{ fontSize: 13, color: '#c0392b', marginLeft: 14, marginTop: 2 }}>
                    {e.name}: university can provide {e.allocated} (you requested {e.requested})
                  </div>
                ))}
              </div>
            ) : requestedEquipment.length > 0 ? (
              <div style={{ fontSize: 13, color: '#1f8a4c' }}>📦 Full equipment quantities can be provided.</div>
            ) : null}
          </div>

          <label style={lbl}>Your note to {requesterName} *</label>
          <textarea
            style={{ ...textarea, width: '100%', minHeight: 120, marginBottom: noteErr ? 6 : 14, borderColor: noteErr ? '#c0392b' : undefined }}
            placeholder="Explain the conflict or issue and what you propose. Be specific — include dates, times, and reasons. If equipment is short, describe what the university can provide."
            value={sendBackNote}
            onChange={(e) => { setSendBackNote(e.target.value); if (noteErr) setNoteErr(''); }}
          />
          {noteErr && <div style={{ color: '#c0392b', fontSize: 13, marginBottom: 10, fontWeight: 500 }}>⚠ {noteErr}</div>}
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
    try { await initiateAcademicEvent({ venueId, purpose, estimatedParticipants, sessions: toSessionInputs() }); onDone('Academic event created.'); }
    catch (e) { onError(errMsg(e)); } finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 12, maxWidth: 620 }}>
      <L label="Venue"><select style={inp} value={venueId} onChange={(e) => setVenue(Number(e.target.value))} required><option value={0}>Select</option>{venues.map((v) => <option key={v.venue_id} value={v.venue_id}>{v.name}</option>)}</select></L>
      <L label="Participants"><input type="number" min={1} style={inp} value={estimatedParticipants} onChange={(e) => setParticipants(Number(e.target.value))} required /></L>
      <div style={{ gridColumn: '1/-1' }}><L label="Event name"><input style={inp} value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="e.g. Annual Sports Day" required /></L></div>
      <SessionRowsEditor rows={rows} onAdd={addRow} onRemove={removeRow} onUpdate={updateRow} />
      <div style={{ gridColumn: '1/-1' }}><button style={acceptBtn} disabled={busy}>{busy ? 'Creating…' : 'Create Event'}</button></div>
    </form>
  );
}

// ── Shared components ─────────────────────────────────────────────────────────
function Panel({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return <section style={panel}><div style={panelHead}><span>{title}</span>{action}</div><div style={panelBody}>{children}</div></section>;
}
function L({ label, children }: { label: string; children: React.ReactNode }) {
  return <label style={{ display: 'block' }}><span style={lbl}>{label}</span>{children}</label>;
}
function stateTag(state: string): React.CSSProperties {
  return state === 'AVAILABLE'
    ? { background: '#e6f4ec', color: '#1f7a45', padding: '1px 7px', borderRadius: 4, fontWeight: 600 }
    : { background: '#fdf1e3', color: '#9a6412', padding: '1px 7px', borderRadius: 4, fontWeight: 600 };
}

// ── Styles ────────────────────────────────────────────────────────────────────
const wrap: React.CSSProperties = { maxWidth: 940, margin: '0 auto' };
const panel: React.CSSProperties = { background: '#fff', border: '1px solid #ddd', borderRadius: 8, marginBottom: 18, boxShadow: '0 1px 3px rgba(0,0,0,0.07)' };
const panelHead: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 20px', borderBottom: '1px solid #e5e5e5', font: '600 16px var(--font-body)', color: '#26485f', background: 'linear-gradient(#fff,#f7f9fb)', borderRadius: '8px 8px 0 0' };
const panelBody: React.CSSProperties = { padding: '20px 24px' };
const stepperWrap: React.CSSProperties = { display: 'flex', alignItems: 'center', marginBottom: 28 };
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
