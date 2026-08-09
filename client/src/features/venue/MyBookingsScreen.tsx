/**
 * Student — Book a Venue (VENUE-01..14, multi-session VENUE-06/35/36).
 *
 * Four-step wizard:
 *   Step 1 — Booking type, venue, sport, participant counts per team,
 *             event format, match format, equipment support decision
 *   Step 2 — Team & match details (type-specific)
 *             Inter-University: visiting team + BUKC team with captain name
 *             Internal: Team A + optional Team B
 *   Step 3 — Sessions with pre-submit conflict checks:
 *             · past date → error
 *             · weekend → error (matches only on weekdays per policy)
 *             · time window overlaps an already-approved session at same
 *               venue → error (client-side pre-check via /api/venue/calendar)
 *             · end time ≤ start time → error
 *   Step 4 — Review & submit
 *
 * Participant counts:
 *   Two fields in Step 1: BUKC team count + visiting/opponent team count.
 *   BUKC player roster in Step 2 auto-expands to match BUKC team count.
 *   Roster cannot exceed the stated BUKC count.
 *
 * Equipment:
 *   Radio in Step 1: "Both teams supply own equipment" vs
 *   "University support needed". Stored in booking metadata.
 *   Detailed equipment planning is done by the Coordinator after approval.
 */
import { useEffect, useState, useCallback } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth.js';
import { PortalShell } from '../auth/PortalShell.js';
import {
  listVenues, submitBooking, listMyBookings, confirmShortfall, listCalendar,
  type Venue, type MyBooking, type CalendarSession,
} from './api.js';
import { useSessionRows, SessionRowsEditor } from './SessionsBuilder.js';
import { ApiRequestError } from '../../lib/api.js';

function errMsg(e: unknown) {
  return e instanceof ApiRequestError ? e.body.error : 'Something went wrong.';
}

type BookingType = 'INTER_UNIVERSITY' | 'INTERNAL';
type EventFormat = 'SINGLE_MATCH' | 'TOURNAMENT';
type MatchFormat = 'FRIENDLY' | 'LEAGUE' | 'KNOCKOUT' | 'ROUND_ROBIN';
type EquipmentSupport = 'SELF' | 'UNIVERSITY';

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

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

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
      setVenues(v.venues);
      setBookings(b.bookings);
    } catch (e) { setError(errMsg(e)); }
  }, []);

  useEffect(() => {
    if (loading || !user) return;
    void load();
  }, [loading, user, load]);

  if (loading) return <PortalShell title="Book a Venue"><p /></PortalShell>;
  if (!user) return <Navigate to="/" replace />;
  if (user.role !== 'STUDENT' && user.role !== 'EXTERNAL') return <Navigate to="/home" replace />;

  const hasActive = bookings.some((b) =>
    ['PENDING', 'FORWARDED', 'SHORTFALL_PENDING'].includes(b.status),
  );

  return (
    <PortalShell title="Book a Venue" tint="sage">
      <div style={wrap}>
        {error && <div style={box.err}>{error}</div>}
        {notice && <div style={box.ok}>{notice}</div>}

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
              <p style={emptySubtitle}>Submit a request to book a venue for your match or tournament.</p>
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
                      {b.firstStart
                        ? new Date(b.firstStart).toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' })
                        : '—'}
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

        {hasActive && !showForm && (
          <div style={infoBox}>
            <strong>One active request at a time.</strong> You have a pending or forwarded booking.
            Once it's resolved you can submit a new one.
          </div>
        )}

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

// ── Booking wizard ──
function BookingWizard({ venues, onDone, onError, onCancel }: {
  venues: Venue[];
  onDone: (m: string) => void;
  onError: (m: string) => void;
  onCancel: () => void;
}) {
  const [step, setStep] = useState(1);
  const TOTAL = 4;

  // ── Step 1 state ──
  const [bookingType, setBookingType] = useState<BookingType | ''>('');
  const [venueId, setVenueId] = useState(0);
  const [sport, setSport] = useState('');
  const [eventFormat, setEventFormat] = useState<EventFormat>('SINGLE_MATCH');
  const [matchFormat, setMatchFormat] = useState<MatchFormat>('FRIENDLY');
  const [bukcCount, setBukcCount] = useState('');        // BUKC team participant count
  const [opponentCount, setOpponentCount] = useState(''); // Opposing team count
  const [equipmentSupport, setEquipmentSupport] = useState<EquipmentSupport>('SELF');
  const [step1Err, setStep1Err] = useState<Record<string, string>>({});

  // ── Step 2 state — Inter-University ──
  const [visitingUniversity, setVU] = useState('');
  const [visitingCity, setVC] = useState('');
  const [visitingTeamName, setVTN] = useState('');
  const [visitingCaptainName, setVCN] = useState('');
  const [visitingCaptainContact, setVCC] = useState('');
  const [bukcTeamName, setBTN] = useState('');
  const [bukcCaptainName, setBCN] = useState('');
  const [bukcCaptainEnrollment, setBCE] = useState('');
  const [bukcCaptainContact, setBCC] = useState('');
  const [bukcPlayers, setBukcPlayers] = useState<BukcPlayer[]>([{ enrollmentNo: '', fullName: '' }]);

  // ── Step 2 state — Internal ──
  const [teamAName, setTAN] = useState('');
  const [teamACaptainName, setTACN] = useState('');
  const [teamACaptainEnrollment, setTACE] = useState('');
  const [teamACaptainContact, setTACC] = useState('');
  const [teamBName, setTBN] = useState('');
  const [teamBCaptainEnrollment, setTBCE] = useState('');
  const [organizingEntity, setOE] = useState('');
  const [step2Err, setStep2Err] = useState<Record<string, string>>({});

  // ── Step 3 state ──
  const { rows: sessions, addRow, removeRow, updateRow, toSessionInputs } = useSessionRows();
  const [sessionErrors, setSessionErrors] = useState<Record<number, string>>({});
  const [specialRequirements, setSpecialReq] = useState('');
  const [checkingConflicts, setCheckingConflicts] = useState(false);
  const [approvedSessions, setApprovedSessions] = useState<CalendarSession[]>([]);

  const [busy, setBusy] = useState(false);

  const selectedVenue = venues.find((v) => v.venue_id === venueId);
  const sportOptions = selectedVenue?.sports.map((s) => s.sport_name) ?? [];

  const bukcCountNum = parseInt(bukcCount, 10) || 0;
  const opponentCountNum = parseInt(opponentCount, 10) || 0;
  const totalParticipants = bukcCountNum + opponentCountNum;
  const threshold = selectedVenue?.is_indoor ? 6 : 10;
  const belowThreshold = totalParticipants > 0 && totalParticipants < threshold;

  // When BUKC count changes, expand/trim roster to match
  useEffect(() => {
    if (bukcCountNum < 1) return;
    setBukcPlayers((prev) => {
      if (prev.length === bukcCountNum) return prev;
      if (prev.length < bukcCountNum) {
        return [...prev, ...Array(bukcCountNum - prev.length).fill(null).map(() => ({ enrollmentNo: '', fullName: '' }))];
      }
      return prev.slice(0, bukcCountNum);
    });
  }, [bukcCountNum]);

  // Fetch approved sessions for this venue when we reach step 3
  useEffect(() => {
    if (step !== 3 || !venueId) return;
    setCheckingConflicts(true);
    listCalendar({ venueId })
      .then((r) => setApprovedSessions(r.sessions))
      .catch(() => setApprovedSessions([]))
      .finally(() => setCheckingConflicts(false));
  }, [step, venueId]);

  // ── Validation ──
  function validateStep1(): boolean {
    const e: Record<string, string> = {};
    if (!bookingType) e.bookingType = 'Select a booking type.';
    if (!venueId) e.venueId = 'Select a venue.';
    if (!sport.trim()) e.sport = 'Specify the sport.';
    if (!bukcCount || bukcCountNum < 1) e.bukcCount = 'Enter BUKC team participant count.';
    if (!opponentCount || opponentCountNum < 1) e.opponentCount = 'Enter opposing team participant count.';
    setStep1Err(e);
    return Object.keys(e).length === 0;
  }

  function validateStep2(): boolean {
    const e: Record<string, string> = {};
    if (bookingType === 'INTER_UNIVERSITY') {
      if (!visitingUniversity.trim()) e.visitingUniversity = 'Required.';
      if (!visitingCity.trim()) e.visitingCity = 'Required.';
      if (!visitingTeamName.trim()) e.visitingTeamName = 'Required.';
      if (!visitingCaptainName.trim()) e.visitingCaptainName = 'Required.';
      if (!visitingCaptainContact.trim()) e.visitingCaptainContact = 'Required.';
      if (!bukcTeamName.trim()) e.bukcTeamName = 'Required.';
      if (!bukcCaptainName.trim()) e.bukcCaptainName = 'Required.';
      if (!bukcCaptainEnrollment.trim()) e.bukcCaptainEnrollment = 'Required.';
      if (!bukcCaptainContact.trim()) e.bukcCaptainContact = 'Required.';
      const valid = bukcPlayers.filter((p) => p.enrollmentNo.trim() && p.fullName.trim());
      if (valid.length < bukcCountNum) {
        e.bukcPlayers = `Fill in all ${bukcCountNum} player entries (enrollment no. + name required for each).`;
      }
    } else {
      if (!teamAName.trim()) e.teamAName = 'Required.';
      if (!teamACaptainName.trim()) e.teamACaptainName = 'Required.';
      if (!teamACaptainEnrollment.trim()) e.teamACaptainEnrollment = 'Required.';
      if (!teamACaptainContact.trim()) e.teamACaptainContact = 'Required.';
      if (!organizingEntity.trim()) e.organizingEntity = 'Required.';
    }
    setStep2Err(e);
    return Object.keys(e).length === 0;
  }

  async function validateStep3(): Promise<boolean> {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const errs: Record<number, string> = {};

    for (const row of sessions) {
      // 1. Past date check
      if (row.date < today) {
        errs[row.sessionNo] = `Date ${row.date} is in the past. Please select a future date.`;
        continue;
      }

      // 2. Weekend check
      const dow = new Date(row.date + 'T12:00:00').getDay(); // noon to avoid TZ issues
      if (dow === 0 || dow === 6) {
        errs[row.sessionNo] = `${DAYS[dow]}s are not permitted for matches. Please select a weekday (Mon–Fri).`;
        continue;
      }

      // 3. End time must be after start time
      if (row.endTime <= row.startTime) {
        errs[row.sessionNo] = `End time must be after start time.`;
        continue;
      }

      // 4. Duplicate session date within same request
      const sameDateCount = sessions.filter((s) => s.date === row.date && s.sessionNo !== row.sessionNo).length;
      if (sameDateCount > 0) {
        errs[row.sessionNo] = `Duplicate date — another session in this request is already on ${row.date}.`;
        continue;
      }

      // 5. Conflict with existing approved sessions at this venue
      const reqStart = new Date(`${row.date}T${row.startTime}:00`);
      const reqEnd = new Date(`${row.date}T${row.endTime}:00`);
      const conflicting = approvedSessions.find((s) => {
        const sStart = new Date(s.starts_at);
        const sEnd = new Date(s.ends_at);
        return reqStart < sEnd && reqEnd > sStart;
      });
      if (conflicting) {
        const cs = new Date(conflicting.starts_at).toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' });
        const ce = new Date(conflicting.ends_at).toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' });
        errs[row.sessionNo] = `This venue is already booked on ${row.date} from ${cs}–${ce}. Please choose a different time or date.`;
      }
    }

    setSessionErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function nextStep() {
    if (step === 1 && !validateStep1()) return;
    if (step === 2 && !validateStep2()) return;
    if (step === 3) {
      const ok = await validateStep3();
      if (!ok) return;
    }
    setStep((s) => Math.min(s + 1, TOTAL));
  }

  async function submit() {
    // Re-run step 3 validation right before submit in case calendar changed
    const ok = await validateStep3();
    if (!ok) { setStep(3); return; }

    setBusy(true);
    try {
      const validPlayers = bukcPlayers.filter((p) => p.enrollmentNo.trim() && p.fullName.trim());
      const meta = bookingType === 'INTER_UNIVERSITY' ? {
        bookingType: 'INTER_UNIVERSITY' as const,
        sport, eventFormat, matchFormat,
        visitingUniversity, visitingCity, visitingTeamName,
        visitingCaptainName, visitingCaptainContact,
        bukcTeamName, bukcCaptainName, bukcCaptainEnrollment, bukcCaptainContact,
        bukcPlayers: validPlayers,
        equipmentSupport,
        specialRequirements: specialRequirements.trim() || undefined,
      } : {
        bookingType: 'INTERNAL' as const,
        sport, eventFormat, matchFormat,
        teamAName, teamACaptainName, teamACaptainEnrollment, teamACaptainContact,
        teamBName: teamBName.trim() || undefined,
        teamBCaptainEnrollment: teamBCaptainEnrollment.trim() || undefined,
        organizingEntity,
        equipmentSupport,
        specialRequirements: specialRequirements.trim() || undefined,
      };

      await submitBooking({
        venueId,
        estimatedParticipants: totalParticipants,
        sessions: toSessionInputs(),
        metadata: meta as Parameters<typeof submitBooking>[0]['metadata'],
      });
      onDone('Booking request submitted. The Coordinator will review it and you will be notified.');
    } catch (e) { onError(errMsg(e)); }
    finally { setBusy(false); }
  }

  const fi = (hasErr: boolean): React.CSSProperties => ({
    ...inp,
    ...(hasErr ? { borderColor: '#c0392b', background: '#fff8f8' } : {}),
  });

  return (
    <Panel title="New Booking Request">
      {/* Progress bar */}
      <div style={progressBar}>
        {(['Basics', 'Teams', 'Sessions', 'Review'] as const).map((label, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, flex: i < 3 ? 1 : 0 }}>
            <div style={{
              width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center',
              justifyContent: 'center', font: '600 13px var(--font-body)', flexShrink: 0,
              background: step > i + 1 ? '#1f8a4c' : step === i + 1 ? '#26485f' : '#e5e5e5',
              color: step >= i + 1 ? '#fff' : '#888',
            }}>
              {step > i + 1 ? '✓' : i + 1}
            </div>
            <span style={{ fontSize: 12, color: step === i + 1 ? '#26485f' : '#888', fontWeight: step === i + 1 ? 600 : 400 }}>
              {label}
            </span>
            {i < 3 && <div style={{ flex: 1, height: 2, background: step > i + 1 ? '#1f8a4c' : '#e5e5e5', margin: '0 4px' }} />}
          </div>
        ))}
      </div>

      {/* ── STEP 1 ── */}
      {step === 1 && (
        <div style={stepBody}>
          <h3 style={stepTitle}>Step 1 — Booking Basics</h3>

          {/* Booking type picker */}
          <div style={{ marginBottom: 18 }}>
            <span style={{ ...lbl, ...(step1Err.bookingType ? { color: '#c0392b' } : {}) }}>
              Booking type *
            </span>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 8 }}>
              {([
                { type: 'INTER_UNIVERSITY' as BookingType, icon: '🏆', title: 'Inter-University Competition', desc: 'BUKC hosts a visiting university team for an official match or tournament.' },
                { type: 'INTERNAL' as BookingType, icon: '🎯', title: 'Internal / Practice', desc: 'Intra-campus match, inter-department competition, or team practice session.' },
              ] as const).map(({ type, icon, title, desc }) => (
                <button key={type} type="button"
                  style={{ ...typeCard, ...(bookingType === type ? typeCardActive : {}), ...(step1Err.bookingType ? { borderColor: '#c0392b' } : {}) }}
                  onClick={() => { setBookingType(type); setStep1Err((p) => ({ ...p, bookingType: '' })); }}>
                  <div style={{ fontSize: 26, marginBottom: 6 }}>{icon}</div>
                  <div style={{ font: '600 14px var(--font-body)', color: '#26485f', marginBottom: 4 }}>{title}</div>
                  <div style={{ fontSize: 12, color: '#5c6773', lineHeight: 1.4 }}>{desc}</div>
                </button>
              ))}
            </div>
            {step1Err.bookingType && <span style={fieldErr}>{step1Err.bookingType}</span>}
          </div>

          <div style={formGrid}>
            {/* Venue */}
            <L label="Venue *">
              <select style={fi(!!step1Err.venueId)} value={venueId}
                onChange={(e) => { setVenueId(Number(e.target.value)); setSport(''); setStep1Err((p) => ({ ...p, venueId: '' })); }}>
                <option value={0}>Select a venue…</option>
                {venues.filter((v) => v.availability_status === 'AVAILABLE').map((v) => (
                  <option key={v.venue_id} value={v.venue_id}>
                    {v.name}{v.location ? ` · ${v.location}` : ''} (cap. {v.capacity})
                  </option>
                ))}
              </select>
              {step1Err.venueId && <span style={fieldErr}>{step1Err.venueId}</span>}
            </L>

            {/* Sport */}
            <L label="Sport *">
              {selectedVenue && sportOptions.length > 0 ? (
                <select style={fi(!!step1Err.sport)} value={sport}
                  onChange={(e) => { setSport(e.target.value); setStep1Err((p) => ({ ...p, sport: '' })); }}>
                  <option value="">Select sport…</option>
                  {sportOptions.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              ) : (
                <input style={fi(!!step1Err.sport)} value={sport}
                  onChange={(e) => { setSport(e.target.value); setStep1Err((p) => ({ ...p, sport: '' })); }}
                  placeholder="e.g. Football, Cricket…" />
              )}
              {step1Err.sport && <span style={fieldErr}>{step1Err.sport}</span>}
            </L>

            {/* BUKC participant count */}
            <L label="BUKC team — no. of participants *">
              <input type="number" min={1} style={fi(!!step1Err.bukcCount)}
                value={bukcCount}
                onChange={(e) => { setBukcCount(e.target.value); setStep1Err((p) => ({ ...p, bukcCount: '' })); }}
                placeholder="e.g. 11" />
              {step1Err.bukcCount && <span style={fieldErr}>{step1Err.bukcCount}</span>}
              {bukcCountNum > 0 && (
                <span style={{ fontSize: 12, color: '#5c6773', marginTop: 3 }}>
                  Roster in Step 2 will have {bukcCountNum} player slot{bukcCountNum !== 1 ? 's' : ''}.
                </span>
              )}
            </L>

            {/* Opponent participant count */}
            <L label={bookingType === 'INTER_UNIVERSITY' ? 'Visiting team — no. of participants *' : 'Opponent team — no. of participants *'}>
              <input type="number" min={1} style={fi(!!step1Err.opponentCount)}
                value={opponentCount}
                onChange={(e) => { setOpponentCount(e.target.value); setStep1Err((p) => ({ ...p, opponentCount: '' })); }}
                placeholder="e.g. 11" />
              {step1Err.opponentCount && <span style={fieldErr}>{step1Err.opponentCount}</span>}
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

            {/* VENUE-01 threshold advisory */}
            {belowThreshold && (
              <div style={{ gridColumn: '1 / -1', ...warningBox }}>
                ⚠ VENUE-01: {selectedVenue?.is_indoor ? 'Indoor' : 'Outdoor'} venues require{' '}
                {selectedVenue?.is_indoor ? '6+' : '10+'} total participants. Your request may be questioned
                by the Coordinator. Ensure you have a valid justification ready.
              </div>
            )}

            {/* Venue info */}
            {selectedVenue && (
              <div style={{ gridColumn: '1 / -1', ...venueInfoBox }}>
                <strong>{selectedVenue.name}</strong>
                {selectedVenue.location && <> · {selectedVenue.location}</>}
                {' · '}Capacity {selectedVenue.capacity}
                {' · '}{selectedVenue.is_indoor ? 'Indoor' : 'Outdoor'}
                {selectedVenue.surface_type && <> · {selectedVenue.surface_type}</>}
              </div>
            )}

            {/* Equipment support */}
            <div style={{ gridColumn: '1 / -1' }}>
              <span style={lbl}>Equipment *</span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 6 }}>
                {([
                  { value: 'SELF', label: 'Both teams will supply their own equipment', desc: 'Each team is responsible for bringing the equipment needed for the match.' },
                  { value: 'UNIVERSITY', label: 'University support required', desc: 'We need the university to provide equipment for this match. The Coordinator will check inventory and plan allocation after approval.' },
                ] as const).map(({ value, label, desc }) => (
                  <label key={value} style={{
                    display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer',
                    padding: '10px 14px', border: `2px solid ${equipmentSupport === value ? '#26485f' : '#e5e5e5'}`,
                    borderRadius: 8, background: equipmentSupport === value ? '#f0f4f8' : '#fafafa',
                    transition: 'all 0.15s',
                  }}>
                    <input type="radio" name="equipmentSupport" value={value}
                      checked={equipmentSupport === value}
                      onChange={() => setEquipmentSupport(value)}
                      style={{ marginTop: 3 }} />
                    <div>
                      <div style={{ font: '600 14px var(--font-body)', color: '#26485f' }}>{label}</div>
                      <div style={{ font: '12px var(--font-body)', color: '#5c6773', marginTop: 2 }}>{desc}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── STEP 2: Inter-University ── */}
      {step === 2 && bookingType === 'INTER_UNIVERSITY' && (
        <div style={stepBody}>
          <h3 style={stepTitle}>Step 2 — Team Details: Inter-University</h3>

          <SectionHeading>Visiting Team ({opponentCountNum} participant{opponentCountNum !== 1 ? 's' : ''})</SectionHeading>
          <div style={formGrid}>
            <L label="University name *"><input style={fi(!!step2Err.visitingUniversity)} value={visitingUniversity} onChange={(e) => { setVU(e.target.value); setStep2Err((p) => ({ ...p, visitingUniversity: '' })); }} placeholder="e.g. FAST NUCES" />{step2Err.visitingUniversity && <span style={fieldErr}>{step2Err.visitingUniversity}</span>}</L>
            <L label="City *"><input style={fi(!!step2Err.visitingCity)} value={visitingCity} onChange={(e) => { setVC(e.target.value); setStep2Err((p) => ({ ...p, visitingCity: '' })); }} placeholder="e.g. Karachi" />{step2Err.visitingCity && <span style={fieldErr}>{step2Err.visitingCity}</span>}</L>
            <L label="Team name *"><input style={fi(!!step2Err.visitingTeamName)} value={visitingTeamName} onChange={(e) => { setVTN(e.target.value); setStep2Err((p) => ({ ...p, visitingTeamName: '' })); }} placeholder="e.g. FAST Lions" />{step2Err.visitingTeamName && <span style={fieldErr}>{step2Err.visitingTeamName}</span>}</L>
            <L label="Captain name *"><input style={fi(!!step2Err.visitingCaptainName)} value={visitingCaptainName} onChange={(e) => { setVCN(e.target.value); setStep2Err((p) => ({ ...p, visitingCaptainName: '' })); }} placeholder="Full name" />{step2Err.visitingCaptainName && <span style={fieldErr}>{step2Err.visitingCaptainName}</span>}</L>
            <L label="Captain contact *"><input style={fi(!!step2Err.visitingCaptainContact)} value={visitingCaptainContact} onChange={(e) => { setVCC(e.target.value); setStep2Err((p) => ({ ...p, visitingCaptainContact: '' })); }} placeholder="e.g. 0312-3456789" />{step2Err.visitingCaptainContact && <span style={fieldErr}>{step2Err.visitingCaptainContact}</span>}</L>
          </div>

          <SectionHeading>BUKC Team ({bukcCountNum} participant{bukcCountNum !== 1 ? 's' : ''})</SectionHeading>
          <div style={formGrid}>
            <L label="Team name *"><input style={fi(!!step2Err.bukcTeamName)} value={bukcTeamName} onChange={(e) => { setBTN(e.target.value); setStep2Err((p) => ({ ...p, bukcTeamName: '' })); }} placeholder="e.g. BUKC Warriors" />{step2Err.bukcTeamName && <span style={fieldErr}>{step2Err.bukcTeamName}</span>}</L>
            <L label="Captain name *"><input style={fi(!!step2Err.bukcCaptainName)} value={bukcCaptainName} onChange={(e) => { setBCN(e.target.value); setStep2Err((p) => ({ ...p, bukcCaptainName: '' })); }} placeholder="Full name" />{step2Err.bukcCaptainName && <span style={fieldErr}>{step2Err.bukcCaptainName}</span>}</L>
            <L label="Captain enrollment no. *"><input style={fi(!!step2Err.bukcCaptainEnrollment)} value={bukcCaptainEnrollment} onChange={(e) => { setBCE(e.target.value); setStep2Err((p) => ({ ...p, bukcCaptainEnrollment: '' })); }} placeholder="e.g. 84-024000-321" />{step2Err.bukcCaptainEnrollment && <span style={fieldErr}>{step2Err.bukcCaptainEnrollment}</span>}</L>
            <L label="Captain contact *"><input style={fi(!!step2Err.bukcCaptainContact)} value={bukcCaptainContact} onChange={(e) => { setBCC(e.target.value); setStep2Err((p) => ({ ...p, bukcCaptainContact: '' })); }} placeholder="e.g. 0311-2345678" />{step2Err.bukcCaptainContact && <span style={fieldErr}>{step2Err.bukcCaptainContact}</span>}</L>
          </div>

          {/* BUKC Player roster — fixed to bukcCountNum entries */}
          <div style={{ marginTop: 18 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={lbl}>BUKC Player Roster * ({bukcCountNum} player{bukcCountNum !== 1 ? 's' : ''} — matches count entered in Step 1)</span>
            </div>
            {step2Err.bukcPlayers && <span style={{ ...fieldErr, display: 'block', marginBottom: 8 }}>{step2Err.bukcPlayers}</span>}
            <div style={{ display: 'grid', gap: 8 }}>
              {bukcPlayers.map((player, i) => (
                <div key={i} style={playerRow}>
                  <span style={{ fontSize: 12, color: '#8a949f', width: 24, flexShrink: 0, alignSelf: 'center' }}>#{i + 1}</span>
                  <input style={{ ...inp, flex: 1 }} placeholder="Enrollment no." value={player.enrollmentNo}
                    onChange={(e) => setBukcPlayers((prev) => prev.map((p, j) => j === i ? { ...p, enrollmentNo: e.target.value } : p))} />
                  <input style={{ ...inp, flex: 2 }} placeholder="Full name" value={player.fullName}
                    onChange={(e) => setBukcPlayers((prev) => prev.map((p, j) => j === i ? { ...p, fullName: e.target.value } : p))} />
                </div>
              ))}
            </div>
            <p style={{ margin: '8px 0 0', fontSize: 12, color: '#5c6773' }}>
              To change the roster size, go back to Step 1 and update the BUKC participant count.
            </p>
          </div>
        </div>
      )}

      {/* ── STEP 2: Internal ── */}
      {step === 2 && bookingType === 'INTERNAL' && (
        <div style={stepBody}>
          <h3 style={stepTitle}>Step 2 — Team Details: Internal</h3>

          <SectionHeading>Team A — Your Team ({bukcCountNum} participant{bukcCountNum !== 1 ? 's' : ''})</SectionHeading>
          <div style={formGrid}>
            <L label="Team name *"><input style={fi(!!step2Err.teamAName)} value={teamAName} onChange={(e) => { setTAN(e.target.value); setStep2Err((p) => ({ ...p, teamAName: '' })); }} placeholder="e.g. CS Department XI" />{step2Err.teamAName && <span style={fieldErr}>{step2Err.teamAName}</span>}</L>
            <L label="Captain name *"><input style={fi(!!step2Err.teamACaptainName)} value={teamACaptainName} onChange={(e) => { setTACN(e.target.value); setStep2Err((p) => ({ ...p, teamACaptainName: '' })); }} placeholder="Full name" />{step2Err.teamACaptainName && <span style={fieldErr}>{step2Err.teamACaptainName}</span>}</L>
            <L label="Captain enrollment no. *"><input style={fi(!!step2Err.teamACaptainEnrollment)} value={teamACaptainEnrollment} onChange={(e) => { setTACE(e.target.value); setStep2Err((p) => ({ ...p, teamACaptainEnrollment: '' })); }} placeholder="e.g. 84-024000-321" />{step2Err.teamACaptainEnrollment && <span style={fieldErr}>{step2Err.teamACaptainEnrollment}</span>}</L>
            <L label="Captain contact *"><input style={fi(!!step2Err.teamACaptainContact)} value={teamACaptainContact} onChange={(e) => { setTACC(e.target.value); setStep2Err((p) => ({ ...p, teamACaptainContact: '' })); }} placeholder="e.g. 0311-2345678" />{step2Err.teamACaptainContact && <span style={fieldErr}>{step2Err.teamACaptainContact}</span>}</L>
            <L label="Organizing department / society *"><input style={fi(!!step2Err.organizingEntity)} value={organizingEntity} onChange={(e) => { setOE(e.target.value); setStep2Err((p) => ({ ...p, organizingEntity: '' })); }} placeholder="e.g. CS Department, Sports Society" />{step2Err.organizingEntity && <span style={fieldErr}>{step2Err.organizingEntity}</span>}</L>
          </div>

          <SectionHeading>Team B — Opponent ({opponentCountNum} participant{opponentCountNum !== 1 ? 's' : ''}) — optional for solo practice</SectionHeading>
          <div style={formGrid}>
            <L label="Team name"><input style={inp} value={teamBName} onChange={(e) => setTBN(e.target.value)} placeholder="e.g. EE Department XI" /></L>
            <L label="Captain enrollment no."><input style={inp} value={teamBCaptainEnrollment} onChange={(e) => setTBCE(e.target.value)} placeholder="e.g. 83-019000-111" /></L>
          </div>
        </div>
      )}

      {/* ── STEP 3: Sessions ── */}
      {step === 3 && (
        <div style={stepBody}>
          <h3 style={stepTitle}>
            Step 3 — {eventFormat === 'SINGLE_MATCH' ? 'Match Date & Time' : 'Tournament Schedule'}
          </h3>

          {checkingConflicts && (
            <div style={{ ...infoBox, marginBottom: 14 }}>
              Checking venue availability… please wait before adding sessions.
            </div>
          )}

          <div style={{ background: '#f0f4f8', borderRadius: 6, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: '#26485f' }}>
            <strong>Date rules:</strong> Weekdays only (Mon–Fri) · Future dates only · No overlap with existing approved sessions at this venue
          </div>

          {eventFormat === 'TOURNAMENT' && (
            <p style={stepHint}>Add one session per match day. Sessions on the same date are not allowed.</p>
          )}

          <SessionRowsEditor rows={sessions} onAdd={addRow} onRemove={removeRow} onUpdate={updateRow} errors={sessionErrors} />

          <div style={{ marginTop: 20 }}>
            <L label="Special requirements / notes (optional)">
              <textarea style={{ ...inp, minHeight: 72, resize: 'vertical', width: '100%', boxSizing: 'border-box' }}
                value={specialRequirements} onChange={(e) => setSpecialReq(e.target.value)}
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
          <p style={stepHint}>Verify everything below before submitting. You cannot edit after submission.</p>

          <ReviewSection title="Event Details">
            <ReviewRow label="Type" value={bookingType === 'INTER_UNIVERSITY' ? 'Inter-University Competition' : 'Internal / Practice'} />
            <ReviewRow label="Venue" value={selectedVenue?.name ?? '—'} />
            <ReviewRow label="Sport" value={sport} />
            <ReviewRow label="Format" value={`${EVENT_FORMAT_LABEL[eventFormat]} · ${MATCH_FORMAT_LABEL[matchFormat]}`} />
            <ReviewRow label="Total participants" value={`${totalParticipants} (BUKC: ${bukcCountNum} · ${bookingType === 'INTER_UNIVERSITY' ? 'Visiting' : 'Opponent'}: ${opponentCountNum})`} />
            <ReviewRow label="Equipment" value={equipmentSupport === 'SELF' ? 'Teams supply own equipment' : 'University support required'} />
          </ReviewSection>

          {bookingType === 'INTER_UNIVERSITY' && (
            <>
              <ReviewSection title="Visiting Team">
                <ReviewRow label="University" value={`${visitingUniversity}, ${visitingCity}`} />
                <ReviewRow label="Team" value={visitingTeamName} />
                <ReviewRow label="Captain" value={`${visitingCaptainName} · ${visitingCaptainContact}`} />
              </ReviewSection>
              <ReviewSection title="BUKC Team">
                <ReviewRow label="Team" value={bukcTeamName} />
                <ReviewRow label="Captain" value={`${bukcCaptainName} · ${bukcCaptainEnrollment} · ${bukcCaptainContact}`} />
                <ReviewRow label="Roster" value={`${bukcPlayers.filter((p) => p.enrollmentNo.trim()).length}/${bukcCountNum} players listed`} />
              </ReviewSection>
            </>
          )}

          {bookingType === 'INTERNAL' && (
            <ReviewSection title="Teams">
              <ReviewRow label="Team A" value={`${teamAName} — ${teamACaptainName} (${teamACaptainEnrollment})`} />
              {teamBName && <ReviewRow label="Team B" value={`${teamBName}${teamBCaptainEnrollment ? ` (${teamBCaptainEnrollment})` : ''}`} />}
              <ReviewRow label="Organizer" value={organizingEntity} />
            </ReviewSection>
          )}

          <ReviewSection title={`Sessions (${sessions.length})`}>
            {sessions.map((s) => (
              <ReviewRow key={s.sessionNo}
                label={`Session ${s.sessionNo}`}
                value={`${s.date} (${DAYS[new Date(s.date + 'T12:00:00').getDay()]}) · ${s.startTime}–${s.endTime}`} />
            ))}
          </ReviewSection>

          {specialRequirements && (
            <ReviewSection title="Special Requirements">
              <p style={{ margin: 0, padding: '6px 14px', fontSize: 13.5, color: '#444', lineHeight: 1.5 }}>
                {specialRequirements}
              </p>
            </ReviewSection>
          )}

          <div style={{ marginTop: 16, padding: '12px 14px', background: '#f0f4f8', borderRadius: 6, fontSize: 13, color: '#5c6773', lineHeight: 1.6 }}>
            By submitting, you confirm all information is accurate and this event complies with BUKC Sports Department policies.
            Your request will be reviewed by the Sports Coordinator before any slot is confirmed.
          </div>
        </div>
      )}

      {/* Navigation footer */}
      <div style={wizardFooter}>
        <div style={{ display: 'flex', gap: 10 }}>
          {step > 1 && <button type="button" style={ghostBtn} onClick={() => setStep((s) => s - 1)}>← Back</button>}
          {step < TOTAL && (
            <button type="button" style={primaryBtn} onClick={nextStep}>Continue →</button>
          )}
          {step === TOTAL && (
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

// ── Small shared components ──
function SectionHeading({ children }: { children: React.ReactNode }) {
  return <div style={{ font: '600 13px var(--font-body)', color: '#26485f', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '20px 0 10px', paddingBottom: 6, borderBottom: '2px solid #e7edf4' }}>{children}</div>;
}
function ReviewSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14, border: '1px solid #e5e5e5', borderRadius: 6, overflow: 'hidden' }}>
      <div style={{ padding: '8px 14px', background: '#f7f9fb', borderBottom: '1px solid #e5e5e5', font: '600 12px var(--font-body)', color: '#26485f', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{title}</div>
      <div style={{ padding: '4px 0' }}>{children}</div>
    </div>
  );
}
function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', padding: '6px 14px', borderBottom: '1px solid #f4f4f4', fontSize: 13.5 }}>
      <span style={{ color: '#8a949f', fontWeight: 600 }}>{label}</span>
      <span style={{ color: '#333' }}>{value}</span>
    </div>
  );
}
function StatusBadge({ status }: { status: string }) {
  const s = ['APPROVED', 'COMPLETED'].includes(status) ? badge.ok
    : ['REJECTED', 'CANCELLED'].includes(status) ? badge.danger
    : badge.warn;
  const label = status === 'SHORTFALL_PENDING' ? 'Awaiting your response' : status;
  return <span style={{ ...badgeBase, ...s }}>{label}</span>;
}
function ShortfallActions({ bookingId, onDone, onError }: { bookingId: string; onDone: (m: string) => void; onError: (m: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  async function respond(yes: boolean) {
    setBusy(true);
    try { await confirmShortfall(bookingId, yes); onDone(yes ? 'Confirmed.' : 'Declined.'); }
    catch (e) { onError(errMsg(e)); } finally { setBusy(false); }
  }
  if (confirm) return (
    <span style={{ display: 'inline-flex', gap: 6 }}>
      <button style={smallDanger} disabled={busy} onClick={() => respond(false)}>Yes, decline</button>
      <button style={smallGhost} onClick={() => setConfirm(false)}>Cancel</button>
    </span>
  );
  return (
    <span style={{ display: 'inline-flex', gap: 6 }}>
      <button style={smallAccept} disabled={busy} onClick={() => respond(true)}>I'll supply it</button>
      <button style={smallGhost} onClick={() => setConfirm(true)}>Decline</button>
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
const warningBox: React.CSSProperties = { padding: '8px 12px', background: '#fdf1e3', border: '1px solid #f0c060', borderRadius: 6, fontSize: 12.5, color: '#9a6412', lineHeight: 1.5 };
const infoBox: React.CSSProperties = { padding: '10px 14px', background: '#e3f2ff', border: '1px solid #90caf9', borderRadius: 6, fontSize: 13.5, color: '#1565c0', marginBottom: 18 };
const venueInfoBox: React.CSSProperties = { padding: '10px 14px', background: '#f0f4f8', borderRadius: 6, fontSize: 13, color: '#26485f' };
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
const playerRow: React.CSSProperties = { display: 'flex', gap: 8, alignItems: 'flex-start', background: '#f8f9fa', padding: '8px 10px', borderRadius: 6, border: '1px solid #e5e5e5' };
const emptyState: React.CSSProperties = { textAlign: 'center', padding: '40px 24px' };
const emptyIcon: React.CSSProperties = { fontSize: 44, marginBottom: 12 };
const emptyTitle: React.CSSProperties = { margin: '0 0 6px', font: '600 16px var(--font-body)', color: '#333' };
const emptySubtitle: React.CSSProperties = { margin: '0 0 20px', font: '14px var(--font-body)', color: '#5c6773' };
const box = {
  err: { background: '#fdecec', color: '#8f2323', border: '1px solid #f3caca', borderRadius: 6, padding: '10px 14px', marginBottom: 16, fontSize: 14 } as React.CSSProperties,
  ok: { background: '#eaf6ee', color: '#1e6b3a', border: '1px solid #c2e6cd', borderRadius: 6, padding: '10px 14px', marginBottom: 16, fontSize: 14 } as React.CSSProperties,
};
