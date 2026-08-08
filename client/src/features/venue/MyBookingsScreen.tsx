/**
 * Student — Book a Venue (VENUE-01..14, multi-session VENUE-06/35/36).
 *
 * Two booking types:
 *   INTER_UNIVERSITY — BUKC hosts a visiting university.
 *     Requires: visiting team details, BUKC roster (captain + players),
 *     match format, sessions. Generates an official pitch for the Coordinator.
 *   INTERNAL — Intra-campus match or practice between BUKC teams.
 *     Requires: team names + captains, organizing entity, sessions.
 *
 * VENUE-01 threshold check (client-side advisory):
 *   Indoor:  ≥6 participants required for a booking to be justified.
 *   Outdoor: ≥10 participants required.
 *   External participant or official affiliation overrides the threshold.
 *
 * The form is a multi-step wizard:
 *   Step 1 — Booking type + venue + sport + event format
 *   Step 2 — Team & match details (type-specific)
 *   Step 3 — Sessions (date/time slots)
 *   Step 4 — Review & submit
 */
import { useEffect, useState, useCallback } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth.js';
import { PortalShell } from '../auth/PortalShell.js';
import { listVenues, submitBooking, listMyBookings, confirmShortfall, type Venue, type MyBooking } from './api.js';
import { useSessionRows, SessionRowsEditor } from './SessionsBuilder.js';
import { ApiRequestError } from '../../lib/api.js';

function errMsg(e: unknown) { return e instanceof ApiRequestError ? e.body.error : 'Something went wrong.'; }

// ── Types ──
type BookingType = 'INTER_UNIVERSITY' | 'INTERNAL';
type EventFormat = 'SINGLE_MATCH' | 'TOURNAMENT';
type MatchFormat = 'FRIENDLY' | 'LEAGUE' | 'KNOCKOUT' | 'ROUND_ROBIN';

interface BukcPlayer { enrollmentNo: string; fullName: string }

const EVENT_FORMAT_LABEL: Record<EventFormat, string> = {
  SINGLE_MATCH: 'Single Match',
  TOURNAMENT: 'Multi-day Tournament',
};
const MATCH_FORMAT_LABEL: Record<MatchFormat, string> = {
  FRIENDLY: 'Friendly',
  LEAGUE: 'League',
  KNOCKOUT: 'Knockout',
  ROUND_ROBIN: 'Round Robin',
};

// ── Root screen ──
export default function MyBookingsScreen() {
  const { user, loading } = useAuth();
  const [venues, setVenues] = useState<Venue[]>([]);
  const [bookings, setBookings] = useState<MyBooking[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    try {
      const [v, b] = await Promise.all([listVenues(), listMyBookings()]);
      setVenues(v.venues); setBookings(b.bookings);
    } catch (e) { setError(errMsg(e)); }
  }, []);

  useEffect(() => {
    if (loading || !user) return;
    void load();
  }, [loading, user, load]);

  if (loading) return <PortalShell title="Book a Venue"><p /></PortalShell>;
  if (!user) return <Navigate to="/" replace />;
  if (user.role !== 'STUDENT' && user.role !== 'EXTERNAL') return <Navigate to="/home" replace />;

  // Students with an active request can't submit another (VENUE-07)
  const hasActive = bookings.some((b) => ['PENDING', 'FORWARDED', 'SHORTFALL_PENDING'].includes(b.status));

  return (
    <PortalShell title="Book a Venue" tint="sage">
      <div style={wrap}>
        {error && <div style={box.err}>{error}</div>}
        {notice && <div style={box.ok}>{notice}</div>}

        {/* My bookings panel */}
        <Panel title="My Booking Requests" action={
          !hasActive && !showForm
            ? <button style={primaryBtn} onClick={() => setShowForm(true)}>New Booking Request</button>
            : showForm
              ? <button style={ghostBtn} onClick={() => setShowForm(false)}>Cancel</button>
              : null
        }>
          {bookings.length === 0 && !showForm && (
            <div style={emptyState}>
              <div style={emptyIcon}>🏟</div>
              <p style={emptyTitle}>No booking requests yet.</p>
              <p style={emptySubtitle}>Submit a new request to book a venue for your match or tournament.</p>
              <button style={primaryBtn} onClick={() => setShowForm(true)}>New Booking Request</button>
            </div>
          )}

          {bookings.length > 0 && (
            <table style={table}>
              <thead>
                <tr>
                  <th style={th}>Booking</th>
                  <th style={th}>Sessions</th>
                  <th style={th}>Status</th>
                  <th style={th}>Note</th>
                  <th style={th} />
                </tr>
              </thead>
              <tbody>
                {bookings.map((b) => (
                  <tr key={b.booking_id}>
                    <td style={td}>
                      <div style={{ fontWeight: 600 }}>{b.venue_name}</div>
                      <div style={{ fontSize: 12, color: '#5c6773', marginTop: 2 }}>{b.purpose}</div>
                    </td>
                    <td style={td}>
                      {b.sessionCount > 1 ? `${b.sessionCount} sessions · ` : ''}
                      {b.firstStart ? new Date(b.firstStart).toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
                      {b.lastEnd && b.sessionCount > 1 ? ` → ${new Date(b.lastEnd).toLocaleDateString('en-PK', { day: 'numeric', month: 'short' })}` : ''}
                    </td>
                    <td style={td}><StatusBadge status={b.status} /></td>
                    <td style={{ ...td, color: '#8f2323', fontSize: 13 }}>{b.rejection_reason ?? ''}</td>
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

        {/* Active booking notice */}
        {hasActive && !showForm && (
          <div style={infoBox}>
            <strong>One active request at a time.</strong> You have a pending or forwarded booking request.
            Once it's resolved you can submit a new one.
          </div>
        )}

        {/* Booking wizard */}
        {showForm && (
          <BookingWizard
            venues={venues}
            onDone={(m) => { setNotice(m); setShowForm(false); void load(); }}
            onError={(m) => { setError(m); setNotice(null); }}
            onCancel={() => setShowForm(false)}
          />
        )}
      </div>
    </PortalShell>
  );
}

// ── Multi-step booking wizard ──
function BookingWizard({ venues, onDone, onError, onCancel }: {
  venues: Venue[];
  onDone: (m: string) => void;
  onError: (m: string) => void;
  onCancel: () => void;
}) {
  const [step, setStep] = useState(1);
  const TOTAL_STEPS = 4;

  // Step 1 state
  const [bookingType, setBookingType] = useState<BookingType | ''>('');
  const [venueId, setVenueId] = useState(0);
  const [sport, setSport] = useState('');
  const [eventFormat, setEventFormat] = useState<EventFormat>('SINGLE_MATCH');
  const [matchFormat, setMatchFormat] = useState<MatchFormat>('FRIENDLY');
  const [estimatedParticipants, setParticipants] = useState('');
  const [step1Errors, setStep1Errors] = useState<Record<string, string>>({});

  // Step 2 state — Inter-University
  const [visitingUniversity, setVU] = useState('');
  const [visitingCity, setVC] = useState('');
  const [visitingTeamName, setVTN] = useState('');
  const [visitingCaptainName, setVCN] = useState('');
  const [visitingCaptainContact, setVCC] = useState('');
  const [bukcTeamName, setBTN] = useState('');
  const [bukcCaptainEnrollment, setBCE] = useState('');
  const [bukcCaptainContact, setBCC] = useState('');
  const [bukcPlayers, setBukcPlayers] = useState<BukcPlayer[]>([{ enrollmentNo: '', fullName: '' }]);
  const [authorizationRef, setAuthRef] = useState('');

  // Step 2 state — Internal
  const [teamAName, setTAN] = useState('');
  const [teamACaptainEnrollment, setTACE] = useState('');
  const [teamACaptainContact, setTACC] = useState('');
  const [teamBName, setTBN] = useState('');
  const [teamBCaptainEnrollment, setTBCE] = useState('');
  const [organizingEntity, setOE] = useState('');
  const [step2Errors, setStep2Errors] = useState<Record<string, string>>({});

  // Step 3 state — sessions
  const { rows: sessions, addRow, removeRow, updateRow, toSessionInputs } = useSessionRows();

  // Shared
  const [specialRequirements, setSpecialReq] = useState('');
  const [busy, setBusy] = useState(false);

  const selectedVenue = venues.find((v) => v.venue_id === venueId);

  // VENUE-01 threshold advisory
  const pCount = Number(estimatedParticipants);
  const threshold = selectedVenue?.is_indoor ? 6 : 10;
  const belowThreshold = pCount > 0 && pCount < threshold;

  // Sport options from venue
  const sportOptions = selectedVenue?.sports.map((s) => s.sport_name) ?? [];

  function validateStep1(): boolean {
    const errs: Record<string, string> = {};
    if (!bookingType) errs.bookingType = 'Select a booking type.';
    if (!venueId) errs.venueId = 'Select a venue.';
    if (!sport.trim()) errs.sport = 'Specify the sport.';
    if (!estimatedParticipants || isNaN(pCount) || pCount < 1) errs.participants = 'Enter the expected number of participants.';
    setStep1Errors(errs);
    return Object.keys(errs).length === 0;
  }

  function validateStep2(): boolean {
    const errs: Record<string, string> = {};
    if (bookingType === 'INTER_UNIVERSITY') {
      if (!visitingUniversity.trim()) errs.visitingUniversity = 'Required.';
      if (!visitingCity.trim()) errs.visitingCity = 'Required.';
      if (!visitingTeamName.trim()) errs.visitingTeamName = 'Required.';
      if (!visitingCaptainName.trim()) errs.visitingCaptainName = 'Required.';
      if (!visitingCaptainContact.trim()) errs.visitingCaptainContact = 'Required.';
      if (!bukcTeamName.trim()) errs.bukcTeamName = 'Required.';
      if (!bukcCaptainEnrollment.trim()) errs.bukcCaptainEnrollment = 'Required.';
      if (!bukcCaptainContact.trim()) errs.bukcCaptainContact = 'Required.';
      const validPlayers = bukcPlayers.filter((p) => p.enrollmentNo.trim() && p.fullName.trim());
      if (validPlayers.length === 0) errs.bukcPlayers = 'Add at least one BUKC player.';
    } else {
      if (!teamAName.trim()) errs.teamAName = 'Required.';
      if (!teamACaptainEnrollment.trim()) errs.teamACaptainEnrollment = 'Required.';
      if (!teamACaptainContact.trim()) errs.teamACaptainContact = 'Required.';
      if (!organizingEntity.trim()) errs.organizingEntity = 'Required.';
    }
    setStep2Errors(errs);
    return Object.keys(errs).length === 0;
  }

  function nextStep() {
    if (step === 1 && !validateStep1()) return;
    if (step === 2 && !validateStep2()) return;
    setStep((s) => Math.min(s + 1, TOTAL_STEPS));
  }

  async function submit() {
    setBusy(true);
    try {
      const sessionInputs = toSessionInputs();
      const validPlayers = bukcPlayers.filter((p) => p.enrollmentNo.trim() && p.fullName.trim());

      const metadata = bookingType === 'INTER_UNIVERSITY' ? {
        bookingType: 'INTER_UNIVERSITY' as const,
        sport, eventFormat, matchFormat,
        visitingUniversity, visitingCity, visitingTeamName,
        visitingCaptainName, visitingCaptainContact,
        bukcTeamName, bukcCaptainEnrollment, bukcCaptainContact,
        bukcPlayers: validPlayers,
        authorizationRef: authorizationRef.trim() || undefined,
        specialRequirements: specialRequirements.trim() || undefined,
      } : {
        bookingType: 'INTERNAL' as const,
        sport, eventFormat, matchFormat,
        teamAName, teamACaptainEnrollment, teamACaptainContact,
        teamBName: teamBName.trim() || undefined,
        teamBCaptainEnrollment: teamBCaptainEnrollment.trim() || undefined,
        organizingEntity,
        specialRequirements: specialRequirements.trim() || undefined,
      };

      await submitBooking({
        venueId,
        estimatedParticipants: pCount,
        sessions: sessionInputs,
        metadata,
      });
      onDone('Booking request submitted. You will be notified once the Coordinator reviews it.');
    } catch (e) { onError(errMsg(e)); }
    finally { setBusy(false); }
  }

  const fieldInp = (hasErr: boolean): React.CSSProperties => ({
    ...inp,
    ...(hasErr ? { borderColor: '#c0392b', background: '#fff8f8' } : {}),
  });

  return (
    <Panel title="New Booking Request">
      {/* Progress bar */}
      <div style={progressBar}>
        {['Basics', 'Teams', 'Sessions', 'Review'].map((label, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, flex: i < 3 ? 1 : 0 }}>
            <div style={{
              width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
              font: '600 13px var(--font-body)',
              background: step > i + 1 ? '#1f8a4c' : step === i + 1 ? '#26485f' : '#e5e5e5',
              color: step >= i + 1 ? '#fff' : '#888',
              flexShrink: 0,
            }}>
              {step > i + 1 ? '✓' : i + 1}
            </div>
            <span style={{ fontSize: 12, color: step === i + 1 ? '#26485f' : '#888', fontWeight: step === i + 1 ? 600 : 400 }}>{label}</span>
            {i < 3 && <div style={{ flex: 1, height: 2, background: step > i + 1 ? '#1f8a4c' : '#e5e5e5', margin: '0 4px' }} />}
          </div>
        ))}
      </div>

      {/* ── STEP 1: Basics ── */}
      {step === 1 && (
        <div style={stepBody}>
          <h3 style={stepTitle}>Step 1 — Booking Basics</h3>

          {/* Booking type cards */}
          <div style={{ marginBottom: 18 }}>
            <span style={lbl}>Booking type *</span>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 8 }}>
              {([
                { type: 'INTER_UNIVERSITY' as BookingType, icon: '🏆', title: 'Inter-University Competition', desc: 'BUKC hosts a visiting university team for an official match or tournament.' },
                { type: 'INTERNAL' as BookingType, icon: '🎯', title: 'Internal / Practice', desc: 'Intra-campus match, inter-department competition, or team practice session.' },
              ] as const).map(({ type, icon, title, desc }) => (
                <button key={type} type="button"
                  style={{
                    ...typeCard,
                    ...(bookingType === type ? typeCardActive : {}),
                    ...(step1Errors.bookingType ? { borderColor: '#c0392b' } : {}),
                  }}
                  onClick={() => { setBookingType(type); setStep1Errors((p) => ({ ...p, bookingType: '' })); }}>
                  <div style={{ fontSize: 26, marginBottom: 6 }}>{icon}</div>
                  <div style={{ font: '600 14px var(--font-body)', color: '#26485f', marginBottom: 4 }}>{title}</div>
                  <div style={{ fontSize: 12, color: '#5c6773', lineHeight: 1.4 }}>{desc}</div>
                </button>
              ))}
            </div>
            {step1Errors.bookingType && <span style={fieldErr}>{step1Errors.bookingType}</span>}
          </div>

          <div style={formGrid}>
            {/* Venue */}
            <L label="Venue *">
              <select style={fieldInp(!!step1Errors.venueId)} value={venueId}
                onChange={(e) => { setVenueId(Number(e.target.value)); setSport(''); setStep1Errors((p) => ({ ...p, venueId: '' })); }}>
                <option value={0}>Select a venue…</option>
                {venues.filter((v) => v.availability_status === 'AVAILABLE').map((v) => (
                  <option key={v.venue_id} value={v.venue_id}>
                    {v.name}{v.location ? ` · ${v.location}` : ''} (cap. {v.capacity})
                  </option>
                ))}
              </select>
              {step1Errors.venueId && <span style={fieldErr}>{step1Errors.venueId}</span>}
            </L>

            {/* Sport */}
            <L label="Sport *">
              {selectedVenue && sportOptions.length > 0 ? (
                <select style={fieldInp(!!step1Errors.sport)} value={sport}
                  onChange={(e) => { setSport(e.target.value); setStep1Errors((p) => ({ ...p, sport: '' })); }}>
                  <option value="">Select sport…</option>
                  {sportOptions.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              ) : (
                <input style={fieldInp(!!step1Errors.sport)} value={sport}
                  onChange={(e) => { setSport(e.target.value); setStep1Errors((p) => ({ ...p, sport: '' })); }}
                  placeholder="e.g. Football, Cricket…" />
              )}
              {step1Errors.sport && <span style={fieldErr}>{step1Errors.sport}</span>}
            </L>

            {/* Estimated participants */}
            <L label="Total participants (both teams) *">
              <input type="number" min={1} style={fieldInp(!!step1Errors.participants)}
                value={estimatedParticipants}
                onChange={(e) => { setParticipants(e.target.value); setStep1Errors((p) => ({ ...p, participants: '' })); }}
                placeholder={selectedVenue?.is_indoor ? 'Min. 6 for indoor' : 'Min. 10 for outdoor'} />
              {step1Errors.participants && <span style={fieldErr}>{step1Errors.participants}</span>}
              {belowThreshold && (
                <div style={warningBox}>
                  ⚠ VENUE-01: {selectedVenue?.is_indoor ? 'Indoor' : 'Outdoor'} venues require{' '}
                  {selectedVenue?.is_indoor ? '6+' : '10+'} participants. Your request may be questioned.
                  It will still be reviewed, but ensure you have a valid justification.
                </div>
              )}
            </L>

            {/* Event format */}
            <L label="Event format *">
              <select style={inp} value={eventFormat} onChange={(e) => setEventFormat(e.target.value as EventFormat)}>
                {(Object.entries(EVENT_FORMAT_LABEL) as [EventFormat, string][]).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </L>

            {/* Match format */}
            <L label="Match format *">
              <select style={inp} value={matchFormat} onChange={(e) => setMatchFormat(e.target.value as MatchFormat)}>
                {(Object.entries(MATCH_FORMAT_LABEL) as [MatchFormat, string][]).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </L>

            {/* Venue info box */}
            {selectedVenue && (
              <div style={{ gridColumn: '1 / -1', ...venueInfoBox }}>
                <strong>{selectedVenue.name}</strong>
                {selectedVenue.location && <> · {selectedVenue.location}</>}
                {' · '} Capacity {selectedVenue.capacity}
                {' · '} {selectedVenue.is_indoor ? 'Indoor' : 'Outdoor'}
                {selectedVenue.surface_type && <> · {selectedVenue.surface_type}</>}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── STEP 2: Team Details ── */}
      {step === 2 && bookingType === 'INTER_UNIVERSITY' && (
        <div style={stepBody}>
          <h3 style={stepTitle}>Step 2 — Team Details: Inter-University</h3>

          <SectionHeading>Visiting Team</SectionHeading>
          <div style={formGrid}>
            <L label="Visiting university *">
              <input style={fieldInp(!!step2Errors.visitingUniversity)} value={visitingUniversity}
                onChange={(e) => { setVU(e.target.value); setStep2Errors((p) => ({ ...p, visitingUniversity: '' })); }}
                placeholder="e.g. FAST NUCES" />
              {step2Errors.visitingUniversity && <span style={fieldErr}>{step2Errors.visitingUniversity}</span>}
            </L>
            <L label="City *">
              <input style={fieldInp(!!step2Errors.visitingCity)} value={visitingCity}
                onChange={(e) => { setVC(e.target.value); setStep2Errors((p) => ({ ...p, visitingCity: '' })); }}
                placeholder="e.g. Karachi" />
              {step2Errors.visitingCity && <span style={fieldErr}>{step2Errors.visitingCity}</span>}
            </L>
            <L label="Team name *">
              <input style={fieldInp(!!step2Errors.visitingTeamName)} value={visitingTeamName}
                onChange={(e) => { setVTN(e.target.value); setStep2Errors((p) => ({ ...p, visitingTeamName: '' })); }}
                placeholder="e.g. FAST Lions" />
              {step2Errors.visitingTeamName && <span style={fieldErr}>{step2Errors.visitingTeamName}</span>}
            </L>
            <L label="Captain name *">
              <input style={fieldInp(!!step2Errors.visitingCaptainName)} value={visitingCaptainName}
                onChange={(e) => { setVCN(e.target.value); setStep2Errors((p) => ({ ...p, visitingCaptainName: '' })); }}
                placeholder="Full name" />
              {step2Errors.visitingCaptainName && <span style={fieldErr}>{step2Errors.visitingCaptainName}</span>}
            </L>
            <L label="Captain contact *">
              <input style={fieldInp(!!step2Errors.visitingCaptainContact)} value={visitingCaptainContact}
                onChange={(e) => { setVCC(e.target.value); setStep2Errors((p) => ({ ...p, visitingCaptainContact: '' })); }}
                placeholder="e.g. 0312-3456789" />
              {step2Errors.visitingCaptainContact && <span style={fieldErr}>{step2Errors.visitingCaptainContact}</span>}
            </L>
          </div>

          <SectionHeading>BUKC Team</SectionHeading>
          <div style={formGrid}>
            <L label="BUKC team name *">
              <input style={fieldInp(!!step2Errors.bukcTeamName)} value={bukcTeamName}
                onChange={(e) => { setBTN(e.target.value); setStep2Errors((p) => ({ ...p, bukcTeamName: '' })); }}
                placeholder="e.g. BUKC Warriors" />
              {step2Errors.bukcTeamName && <span style={fieldErr}>{step2Errors.bukcTeamName}</span>}
            </L>
            <L label="Captain enrollment no. *">
              <input style={fieldInp(!!step2Errors.bukcCaptainEnrollment)} value={bukcCaptainEnrollment}
                onChange={(e) => { setBCE(e.target.value); setStep2Errors((p) => ({ ...p, bukcCaptainEnrollment: '' })); }}
                placeholder="e.g. 84-024000-321" />
              {step2Errors.bukcCaptainEnrollment && <span style={fieldErr}>{step2Errors.bukcCaptainEnrollment}</span>}
            </L>
            <L label="Captain contact *">
              <input style={fieldInp(!!step2Errors.bukcCaptainContact)} value={bukcCaptainContact}
                onChange={(e) => { setBCC(e.target.value); setStep2Errors((p) => ({ ...p, bukcCaptainContact: '' })); }}
                placeholder="e.g. 0311-2345678" />
              {step2Errors.bukcCaptainContact && <span style={fieldErr}>{step2Errors.bukcCaptainContact}</span>}
            </L>
            <L label="Authorization / letter reference">
              <input style={inp} value={authorizationRef} onChange={(e) => setAuthRef(e.target.value)}
                placeholder="e.g. Sports Dept. approval ref. #SD-2026-014" />
            </L>
          </div>

          {/* BUKC Player roster */}
          <div style={{ marginTop: 18 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <span style={{ ...lbl, margin: 0 }}>BUKC Player Roster *</span>
              <button type="button" style={addRowBtn}
                onClick={() => setBukcPlayers((p) => [...p, { enrollmentNo: '', fullName: '' }])}>
                + Add player
              </button>
            </div>
            {step2Errors.bukcPlayers && <span style={{ ...fieldErr, display: 'block', marginBottom: 8 }}>{step2Errors.bukcPlayers}</span>}
            <div style={{ display: 'grid', gap: 8 }}>
              {bukcPlayers.map((player, i) => (
                <div key={i} style={playerRow}>
                  <span style={{ fontSize: 12, color: '#8a949f', width: 24, flexShrink: 0, alignSelf: 'center' }}>#{i + 1}</span>
                  <input style={{ ...inp, flex: 1 }} placeholder="Enrollment no." value={player.enrollmentNo}
                    onChange={(e) => setBukcPlayers((prev) => prev.map((p, j) => j === i ? { ...p, enrollmentNo: e.target.value } : p))} />
                  <input style={{ ...inp, flex: 2 }} placeholder="Full name" value={player.fullName}
                    onChange={(e) => setBukcPlayers((prev) => prev.map((p, j) => j === i ? { ...p, fullName: e.target.value } : p))} />
                  {bukcPlayers.length > 1 && (
                    <button type="button" style={removeRowBtn}
                      onClick={() => setBukcPlayers((prev) => prev.filter((_, j) => j !== i))}>×</button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {step === 2 && bookingType === 'INTERNAL' && (
        <div style={stepBody}>
          <h3 style={stepTitle}>Step 2 — Team Details: Internal</h3>

          <SectionHeading>Team A (Your Team)</SectionHeading>
          <div style={formGrid}>
            <L label="Team name *">
              <input style={fieldInp(!!step2Errors.teamAName)} value={teamAName}
                onChange={(e) => { setTAN(e.target.value); setStep2Errors((p) => ({ ...p, teamAName: '' })); }}
                placeholder="e.g. CS Department XI" />
              {step2Errors.teamAName && <span style={fieldErr}>{step2Errors.teamAName}</span>}
            </L>
            <L label="Captain enrollment no. *">
              <input style={fieldInp(!!step2Errors.teamACaptainEnrollment)} value={teamACaptainEnrollment}
                onChange={(e) => { setTACE(e.target.value); setStep2Errors((p) => ({ ...p, teamACaptainEnrollment: '' })); }}
                placeholder="e.g. 84-024000-321" />
              {step2Errors.teamACaptainEnrollment && <span style={fieldErr}>{step2Errors.teamACaptainEnrollment}</span>}
            </L>
            <L label="Captain contact *">
              <input style={fieldInp(!!step2Errors.teamACaptainContact)} value={teamACaptainContact}
                onChange={(e) => { setTACC(e.target.value); setStep2Errors((p) => ({ ...p, teamACaptainContact: '' })); }}
                placeholder="e.g. 0311-2345678" />
              {step2Errors.teamACaptainContact && <span style={fieldErr}>{step2Errors.teamACaptainContact}</span>}
            </L>
            <L label="Organizing department / society *">
              <input style={fieldInp(!!step2Errors.organizingEntity)} value={organizingEntity}
                onChange={(e) => { setOE(e.target.value); setStep2Errors((p) => ({ ...p, organizingEntity: '' })); }}
                placeholder="e.g. CS Department, Sports Society" />
              {step2Errors.organizingEntity && <span style={fieldErr}>{step2Errors.organizingEntity}</span>}
            </L>
          </div>

          <SectionHeading>Team B (Opponent — optional for practice)</SectionHeading>
          <div style={formGrid}>
            <L label="Team name">
              <input style={inp} value={teamBName} onChange={(e) => setTBN(e.target.value)}
                placeholder="e.g. EE Department XI (leave blank for solo practice)" />
            </L>
            <L label="Captain enrollment no.">
              <input style={inp} value={teamBCaptainEnrollment} onChange={(e) => setTBCE(e.target.value)}
                placeholder="e.g. 83-019000-111" />
            </L>
          </div>
        </div>
      )}

      {/* ── STEP 3: Sessions ── */}
      {step === 3 && (
        <div style={stepBody}>
          <h3 style={stepTitle}>
            Step 3 — {eventFormat === 'SINGLE_MATCH' ? 'Match Date & Time' : 'Tournament Schedule'}
          </h3>
          {eventFormat === 'TOURNAMENT' && (
            <p style={stepHint}>
              Add one session per match day. Up to 30 sessions for a full tournament bracket.
            </p>
          )}
          <div style={{ maxWidth: 700 }}>
            <div style={{ display: 'grid' }}>
              <SessionRowsEditor rows={sessions} onAdd={addRow} onRemove={removeRow} onUpdate={updateRow} />
            </div>
          </div>
          <div style={{ marginTop: 16 }}>
            <L label="Special requirements / notes (optional)">
              <textarea style={{ ...inp, minHeight: 72, resize: 'vertical' }} value={specialRequirements}
                onChange={(e) => setSpecialReq(e.target.value)}
                placeholder="e.g. Will need scoreboard access, spectator seating for 50, referee required…" maxLength={500} />
              <span style={{ fontSize: 11, color: '#8a949f' }}>{specialRequirements.length}/500</span>
            </L>
          </div>
        </div>
      )}

      {/* ── STEP 4: Review ── */}
      {step === 4 && (
        <div style={stepBody}>
          <h3 style={stepTitle}>Step 4 — Review Your Request</h3>
          <p style={stepHint}>Please verify everything below before submitting. Once submitted, you cannot edit the request.</p>

          <ReviewSection title="Event Details">
            <ReviewRow label="Type" value={bookingType === 'INTER_UNIVERSITY' ? 'Inter-University Competition' : 'Internal / Practice'} />
            <ReviewRow label="Venue" value={selectedVenue?.name ?? '—'} />
            <ReviewRow label="Sport" value={sport} />
            <ReviewRow label="Format" value={`${EVENT_FORMAT_LABEL[eventFormat]} · ${MATCH_FORMAT_LABEL[matchFormat]}`} />
            <ReviewRow label="Participants" value={`${estimatedParticipants} total`} />
          </ReviewSection>

          {bookingType === 'INTER_UNIVERSITY' && (
            <>
              <ReviewSection title="Visiting Team">
                <ReviewRow label="University" value={`${visitingUniversity}, ${visitingCity}`} />
                <ReviewRow label="Team" value={visitingTeamName} />
                <ReviewRow label="Captain" value={`${visitingCaptainName} · ${visitingCaptainContact}`} />
              </ReviewSection>
              <ReviewSection title="BUKC Team">
                <ReviewRow label="Team name" value={bukcTeamName} />
                <ReviewRow label="Captain" value={`${bukcCaptainEnrollment} · ${bukcCaptainContact}`} />
                <ReviewRow label="Roster" value={`${bukcPlayers.filter((p) => p.enrollmentNo.trim()).length} player(s) listed`} />
                {authorizationRef && <ReviewRow label="Auth. ref." value={authorizationRef} />}
              </ReviewSection>
            </>
          )}

          {bookingType === 'INTERNAL' && (
            <ReviewSection title="Teams">
              <ReviewRow label="Team A" value={`${teamAName} (captain: ${teamACaptainEnrollment})`} />
              {teamBName && <ReviewRow label="Team B" value={`${teamBName}${teamBCaptainEnrollment ? ` (captain: ${teamBCaptainEnrollment})` : ''}`} />}
              <ReviewRow label="Organizer" value={organizingEntity} />
            </ReviewSection>
          )}

          <ReviewSection title={`Sessions (${sessions.length})`}>
            {sessions.map((s) => (
              <ReviewRow key={s.sessionNo}
                label={`Session ${s.sessionNo}`}
                value={`${s.date} · ${s.startTime} – ${s.endTime}${s.teamName ? ` · ${s.teamName}` : ''}`} />
            ))}
          </ReviewSection>

          {specialRequirements && (
            <ReviewSection title="Special Requirements">
              <p style={{ margin: 0, fontSize: 14, color: '#444', lineHeight: 1.5 }}>{specialRequirements}</p>
            </ReviewSection>
          )}

          <div style={{ marginTop: 16, padding: '12px 14px', background: '#f0f4f8', borderRadius: 6, fontSize: 13, color: '#5c6773', lineHeight: 1.6 }}>
            By submitting, you confirm that all information is accurate and that this event complies with BUKC Sports Department policies.
            Your request will be reviewed by the Sports Coordinator and, if forwarded, by the Super Admin before any slot is confirmed.
          </div>
        </div>
      )}

      {/* ── Navigation ── */}
      <div style={wizardFooter}>
        <div style={{ display: 'flex', gap: 10 }}>
          {step > 1 && <button type="button" style={ghostBtn} onClick={() => setStep((s) => s - 1)}>← Back</button>}
          {step < TOTAL_STEPS && (
            <button type="button" style={primaryBtn} onClick={nextStep}>
              Continue →
            </button>
          )}
          {step === TOTAL_STEPS && (
            <button type="button" style={submitBtn} disabled={busy} onClick={submit}>
              {busy ? 'Submitting…' : 'Submit Booking Request'}
            </button>
          )}
        </div>
        <button type="button" style={{ ...ghostBtn, color: '#c0392b', borderColor: '#c0392b' }} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </Panel>
  );
}

// ── Small components ──
function SectionHeading({ children }: { children: React.ReactNode }) {
  return <div style={{ font: '600 13px var(--font-body)', color: '#26485f', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '20px 0 10px', paddingBottom: 6, borderBottom: '2px solid #e7edf4' }}>{children}</div>;
}
function ReviewSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16, border: '1px solid #e5e5e5', borderRadius: 6, overflow: 'hidden' }}>
      <div style={{ padding: '8px 14px', background: '#f7f9fb', borderBottom: '1px solid #e5e5e5', font: '600 12px var(--font-body)', color: '#26485f', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{title}</div>
      <div style={{ padding: '8px 0' }}>{children}</div>
    </div>
  );
}
function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', padding: '6px 14px', borderBottom: '1px solid #f4f4f4', fontSize: 13.5 }}>
      <span style={{ color: '#8a949f', fontWeight: 600 }}>{label}</span>
      <span style={{ color: '#333' }}>{value}</span>
    </div>
  );
}
function StatusBadge({ status }: { status: string }) {
  const style = ['APPROVED', 'COMPLETED'].includes(status) ? badge.ok
    : ['REJECTED', 'CANCELLED'].includes(status) ? badge.danger
    : badge.warn;
  const label = status === 'SHORTFALL_PENDING' ? 'Awaiting your response' : status;
  return <span style={{ ...badgeBase, ...style }}>{label}</span>;
}
function ShortfallActions({ bookingId, onDone, onError }: { bookingId: string; onDone: (m: string) => void; onError: (m: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [showDecline, setShowDecline] = useState(false);
  async function respond(confirm: boolean) {
    setBusy(true);
    try {
      await confirmShortfall(bookingId, confirm);
      onDone(confirm ? "Confirmed — booking returned to the Coordinator." : "Declined — booking rejected.");
    } catch (e) { onError(e instanceof ApiRequestError ? e.body.error : 'Something went wrong.'); }
    finally { setBusy(false); }
  }
  if (showDecline) return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
      <span style={{ fontSize: 12.5, color: '#5c6773' }}>Sure?</span>
      <button style={smallDanger} disabled={busy} onClick={() => respond(false)}>Yes, decline</button>
      <button style={smallGhost} onClick={() => setShowDecline(false)}>Cancel</button>
    </span>
  );
  return (
    <span style={{ display: 'inline-flex', gap: 6 }}>
      <button style={smallAccept} disabled={busy} onClick={() => respond(true)}>I'll supply it</button>
      <button style={smallGhost} onClick={() => setShowDecline(true)}>Decline</button>
    </span>
  );
}
function Panel({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return <section style={panel}><div style={panelHead}><span>{title}</span>{action}</div><div style={panelBody}>{children}</div></section>;
}
function L({ label, children }: { label: string; children: React.ReactNode }) {
  return <label style={{ display: 'block' }}><span style={lbl}>{label}</span>{children}</label>;
}

// ── Styles ──
const wrap: React.CSSProperties = { maxWidth: 880, margin: '0 auto' };
const panel: React.CSSProperties = { background: '#fff', border: '1px solid #ddd', borderRadius: 8, marginBottom: 18, boxShadow: '0 1px 3px rgba(0,0,0,0.07)' };
const panelHead: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 20px', borderBottom: '1px solid #e5e5e5', font: '600 16px var(--font-body)', color: '#26485f', background: 'linear-gradient(#fff,#f7f9fb)', borderRadius: '8px 8px 0 0' };
const panelBody: React.CSSProperties = { padding: '20px 24px' };
const table: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 14 };
const th: React.CSSProperties = { textAlign: 'left', font: '600 11px var(--font-body)', color: '#888', textTransform: 'uppercase', letterSpacing: '0.04em', padding: '0 8px 10px', borderBottom: '1px solid #e5e5e5' };
const td: React.CSSProperties = { padding: '11px 8px', borderBottom: '1px solid #eee', color: '#333', verticalAlign: 'top' };
const lbl: React.CSSProperties = { display: 'block', font: '500 12px var(--font-body)', color: '#26485f', marginBottom: 5, marginTop: 2 };
const inp: React.CSSProperties = { width: '100%', font: '14px var(--font-body)', padding: '9px 11px', border: '1px solid #ccc', borderRadius: 6, boxSizing: 'border-box' };
const formGrid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 };
const fieldErr: React.CSSProperties = { display: 'block', fontSize: 12, color: '#c0392b', marginTop: 4 };
const warningBox: React.CSSProperties = { marginTop: 8, padding: '8px 12px', background: '#fdf1e3', border: '1px solid #f0c060', borderRadius: 6, fontSize: 12.5, color: '#9a6412', lineHeight: 1.5 };
const infoBox: React.CSSProperties = { padding: '10px 14px', background: '#e3f2ff', border: '1px solid #90caf9', borderRadius: 6, fontSize: 13.5, color: '#1565c0', marginBottom: 18 };
const badgeBase: React.CSSProperties = { font: '600 11px var(--font-mono)', padding: '2px 8px', borderRadius: 4 };
const badge = {
  ok: { background: '#e6f4ec', color: '#1f7a45' } as React.CSSProperties,
  warn: { background: '#fdf1e3', color: '#9a6412' } as React.CSSProperties,
  danger: { background: '#fbe9e7', color: '#b3352b' } as React.CSSProperties,
};
const primaryBtn: React.CSSProperties = { background: '#26485f', color: '#fff', border: 'none', borderRadius: 6, padding: '9px 20px', fontSize: 14, cursor: 'pointer', fontWeight: 600 };
const submitBtn: React.CSSProperties = { background: '#1f8a4c', color: '#fff', border: 'none', borderRadius: 6, padding: '10px 24px', fontSize: 15, cursor: 'pointer', fontWeight: 700 };
const ghostBtn: React.CSSProperties = { background: '#fff', color: '#555', border: '1px solid #ccc', borderRadius: 6, padding: '9px 18px', fontSize: 14, cursor: 'pointer' };
const smallAccept: React.CSSProperties = { background: '#1f8a4c', color: '#fff', border: 'none', borderRadius: 4, padding: '5px 10px', fontSize: 12.5, cursor: 'pointer' };
const smallDanger: React.CSSProperties = { background: '#c0392b', color: '#fff', border: 'none', borderRadius: 4, padding: '5px 10px', fontSize: 12.5, cursor: 'pointer' };
const smallGhost: React.CSSProperties = { background: '#fff', color: '#555', border: '1px solid #ccc', borderRadius: 4, padding: '5px 10px', fontSize: 12.5, cursor: 'pointer' };
const progressBar: React.CSSProperties = { display: 'flex', alignItems: 'center', marginBottom: 28, padding: '0 4px' };
const stepBody: React.CSSProperties = { paddingBottom: 8 };
const stepTitle: React.CSSProperties = { margin: '0 0 18px', font: '700 18px var(--font-body)', color: '#26485f' };
const stepHint: React.CSSProperties = { margin: '-8px 0 18px', font: '14px var(--font-body)', color: '#5c6773', lineHeight: 1.5 };
const wizardFooter: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 20, marginTop: 20, borderTop: '1px solid #e5e5e5' };
const typeCard: React.CSSProperties = { background: '#f8f9fa', border: '2px solid #e5e5e5', borderRadius: 10, padding: '16px 18px', cursor: 'pointer', textAlign: 'center', transition: 'all 0.15s' };
const typeCardActive: React.CSSProperties = { borderColor: '#26485f', background: '#f0f4f8' };
const venueInfoBox: React.CSSProperties = { padding: '10px 14px', background: '#f0f4f8', borderRadius: 6, fontSize: 13, color: '#26485f' };
const addRowBtn: React.CSSProperties = { background: 'none', border: 'none', color: '#0a6ebd', font: '600 13px var(--font-body)', cursor: 'pointer', padding: '4px 8px' };
const removeRowBtn: React.CSSProperties = { background: 'none', border: 'none', color: '#c0392b', font: '600 16px var(--font-body)', cursor: 'pointer', padding: '0 4px', lineHeight: 1, alignSelf: 'center' };
const playerRow: React.CSSProperties = { display: 'flex', gap: 8, alignItems: 'flex-start', background: '#f8f9fa', padding: '8px 10px', borderRadius: 6, border: '1px solid #e5e5e5' };
const emptyState: React.CSSProperties = { textAlign: 'center', padding: '40px 24px' };
const emptyIcon: React.CSSProperties = { fontSize: 44, marginBottom: 12 };
const emptyTitle: React.CSSProperties = { margin: '0 0 6px', font: '600 16px var(--font-body)', color: '#333' };
const emptySubtitle: React.CSSProperties = { margin: '0 0 20px', font: '14px var(--font-body)', color: '#5c6773' };
const box = {
  err: { background: '#fdecec', color: '#8f2323', border: '1px solid #f3caca', borderRadius: 6, padding: '10px 14px', marginBottom: 16, fontSize: 14 } as React.CSSProperties,
  ok: { background: '#eaf6ee', color: '#1e6b3a', border: '1px solid #c2e6cd', borderRadius: 6, padding: '10px 14px', marginBottom: 16, fontSize: 14 } as React.CSSProperties,
};
