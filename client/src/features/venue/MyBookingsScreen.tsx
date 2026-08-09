/**
 * Student — Book a Venue (VENUE-01..14, VENUE-05/06/35/36).
 *
 * Five-step wizard:
 *   Step 1 — Booking type, venue, sport, participant counts, event/match format
 *   Step 2 — Team rosters (both teams, BRS VENUE-05: participating team(s) and member details)
 *   Step 3 — Equipment (type + quantity per type, scoped to venue's sport)
 *   Step 4 — Sessions (dates + times, with conflict pre-check)
 *   Step 5 — Review & submit
 *
 * BRS rules enforced client-side:
 *   VENUE-01: threshold advisory (6 indoor / 10 outdoor)
 *   VENUE-05: team details + participant count required
 *   VENUE-06: single or multi-session
 *   VENUE-07: one active request at a time (backend also enforces)
 *   VENUE-24/25: session conflict pre-check against approved calendar
 */
import { useEffect, useState, useCallback, Fragment } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth.js';
import { PortalShell } from '../auth/PortalShell.js';
import {
  listVenues, submitBooking, listMyBookings, confirmShortfall, listCalendar,
  acceptSentBack, declineSentBack, getBookingFull,
  type Venue, type MyBooking,
} from './api.js';
import { listTypes, type EquipmentType } from '../inventory/api.js';
import { useSessionRows, SessionRowsEditor } from './SessionsBuilder.js';
import { ApiRequestError } from '../../lib/api.js';

function errMsg(e: unknown) {
  return e instanceof ApiRequestError ? e.body.error : 'Something went wrong.';
}

type BookingType = 'INTER_UNIVERSITY' | 'INTERNAL';
type EventFormat = 'SINGLE_MATCH' | 'TOURNAMENT';
type MatchFormat = 'FRIENDLY' | 'LEAGUE' | 'KNOCKOUT' | 'ROUND_ROBIN';
type EquipmentSupport = 'SELF' | 'UNIVERSITY';

interface Player { enrollmentNo: string; fullName: string }
interface EquipmentItem { equipmentTypeId: number; name: string; quantity: number; lendingUnit: 'SINGLE' | 'PAIR' }

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
            : showForm ? <button style={ghostBtn} onClick={() => setShowForm(false)}>Cancel</button>
            : null
        }>
          {bookings.length === 0 && !showForm && (
            <div style={emptyState}>
              <div style={{ fontSize: 44, marginBottom: 12 }}>🏟</div>
              <p style={{ margin: '0 0 6px', font: '600 16px var(--font-body)', color: '#333' }}>No booking requests yet.</p>
              <p style={{ margin: '0 0 20px', font: '14px var(--font-body)', color: '#5c6773' }}>Submit a request to book a venue for your match or tournament.</p>
              <button style={primaryBtn} onClick={() => setShowForm(true)}>New Booking Request</button>
            </div>
          )}
          {bookings.length > 0 && (
            <table style={tbl}>
              <thead>
                <tr>
                  <th style={th}>Booking</th><th style={th}>Sessions</th>
                  <th style={th}>Status</th><th style={th}>Note</th><th style={th} />
                </tr>
              </thead>
              <tbody>
                {bookings.map((b) => (
                  <Fragment key={b.booking_id}>
                  <tr>
                    <td style={td}><div style={{ fontWeight: 600 }}>{b.venue_name}</div><div style={{ fontSize: 12, color: '#5c6773' }}>{b.purpose}</div></td>
                    <td style={td}>{b.sessionCount > 1 ? `${b.sessionCount} sessions · ` : ''}{b.firstStart ? new Date(b.firstStart).toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}</td>
                    <td style={td}><StatusBadge status={b.status} /></td>
                    <td style={{ ...td, color: '#8f2323', fontSize: 13 }}>{b.rejection_reason ?? ''}</td>
                    <td style={{ ...td, textAlign: 'right' }}>
                      {b.status === 'SHORTFALL_PENDING' && (
                        <ShortfallActions bookingId={b.booking_id}
                          onDone={(m) => { setNotice(m); void load(); }}
                          onError={(m) => setError(m)} />
                      )}
                      {b.status === 'SENT_BACK' && (
                        <SentBackActions booking={b}
                          onDone={(m) => { setNotice(m); void load(); }}
                          onError={(m) => setError(m)} />
                      )}
                    </td>
                  </tr>
                  {/* Sent-back detail row — show coordinator's note and proposed schedule */}
                  {b.status === 'SENT_BACK' && (
                    <tr>
                      <td colSpan={5} style={{ padding: '0 8px 12px', background: '#fffbeb' }}>
                        <SentBackDetail bookingId={b.booking_id} />
                      </td>
                    </tr>
                  )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        {hasActive && !showForm && (
          <div style={infoBox}>
            <strong>One active request at a time.</strong> You have a pending or forwarded booking request. Once resolved you can submit a new one.
          </div>
        )}
        {showForm && (
          <BookingWizard venues={venues}
            onDone={(m) => { setNotice(m); setShowForm(false); void load(); }}
            onError={(m) => setError(m)}
            onCancel={() => setShowForm(false)} />
        )}
      </div>
    </PortalShell>
  );
}

// ── Wizard ──
function BookingWizard({ venues, onDone, onError, onCancel }: {
  venues: Venue[];
  onDone: (m: string) => void;
  onError: (m: string) => void;
  onCancel: () => void;
}) {
  const TOTAL = 5;
  const [step, setStep] = useState(1);

  // Step 1
  const [bookingType, setBookingType] = useState<BookingType | ''>('');
  const [venueId, setVenueId] = useState(0);
  const [sport, setSport] = useState('');
  const [eventFormat, setEventFormat] = useState<EventFormat>('SINGLE_MATCH');
  const [matchFormat, setMatchFormat] = useState<MatchFormat>('FRIENDLY');
  const [bukcCount, setBukcCount] = useState('');
  const [opponentCount, setOpponentCount] = useState('');
  const [s1Err, setS1Err] = useState<Record<string, string>>({});

  // Step 2 — BUKC team
  const [bukcTeamName, setBTN] = useState('');
  const [bukcHasCaptain, setBHC] = useState(true);
  const [bukcCaptainName, setBCN] = useState('');
  const [bukcCaptainEnrollment, setBCE] = useState('');
  const [bukcCaptainContact, setBCC] = useState('');
  const [bukcPlayers, setBukcPlayers] = useState<Player[]>([]);

  // Step 2 — Opponent team (visiting for inter-uni, Team B for internal)
  const [opponentTeamName, setOTN] = useState('');
  const [opponentUniversity, setOU] = useState('');
  const [opponentCity, setOC] = useState('');
  const [opponentHasCaptain, setOHC] = useState(true);
  const [opponentCaptainName, setOCN] = useState('');
  const [opponentCaptainContact, setOCC] = useState('');
  const [opponentPlayers, setOpponentPlayers] = useState<Player[]>([]);
  const [organizingEntity, setOE] = useState('');
  const [s2Err, setS2Err] = useState<Record<string, string>>({});

  // Step 3 — Equipment
  const [equipmentSupport, setEquipmentSupport] = useState<EquipmentSupport>('SELF');
  const [equipmentItems, setEquipmentItems] = useState<EquipmentItem[]>([]);
  const [allTypes, setAllTypes] = useState<EquipmentType[]>([]);
  const [typesLoading, setTypesLoading] = useState(false);

  // Step 4 — Sessions
  const { rows: sessions, addRow, removeRow, updateRow, toSessionInputs, setRows } = useSessionRows();
  const [sessionErrors, setSessionErrors] = useState<Record<number, string>>({});
  const [approvedSessions, setApprovedSessions] = useState<Array<{ starts_at: string; ends_at: string }>>([]);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [specialRequirements, setSpecialReq] = useState('');

  const [busy, setBusy] = useState(false);

  const selectedVenue = venues.find((v) => v.venue_id === venueId);
  const sportOptions = selectedVenue?.sports.map((s) => s.sport_name) ?? [];
  const bukcCountNum = parseInt(bukcCount, 10) || 0;
  const opponentCountNum = parseInt(opponentCount, 10) || 0;
  const totalParticipants = bukcCountNum + opponentCountNum;
  const threshold = selectedVenue?.is_indoor ? 6 : 10;
  const belowThreshold = totalParticipants > 0 && totalParticipants < threshold;

  // Sync player arrays to counts
  useEffect(() => {
    if (bukcCountNum < 1) return;
    setBukcPlayers((p) => {
      if (p.length === bukcCountNum) return p;
      if (p.length < bukcCountNum) return [...p, ...Array(bukcCountNum - p.length).fill(null).map(() => ({ enrollmentNo: '', fullName: '' }))];
      return p.slice(0, bukcCountNum);
    });
  }, [bukcCountNum]);

  useEffect(() => {
    if (opponentCountNum < 1) return;
    setOpponentPlayers((p) => {
      if (p.length === opponentCountNum) return p;
      if (p.length < opponentCountNum) return [...p, ...Array(opponentCountNum - p.length).fill(null).map(() => ({ enrollmentNo: '', fullName: '' }))];
      return p.slice(0, opponentCountNum);
    });
  }, [opponentCountNum]);

  // Load equipment types when reaching step 3
  useEffect(() => {
    if (step !== 3) return;
    setTypesLoading(true);
    listTypes()
      .then((res) => {
        setAllTypes(res.types);
        // Filter to types matching the selected venue's sport categories and chosen sport
        const venueSportNames = (selectedVenue?.sports ?? []).map((s) => s.sport_name.toLowerCase());
        const chosenSport = sport.toLowerCase();
        const relevant = res.types.filter((t) => {
          const typeSport = t.sport_category_name.toLowerCase();
          return typeSport === chosenSport || venueSportNames.includes(typeSport);
        });
        setEquipmentItems(
          relevant.map((t) => ({ equipmentTypeId: t.equipment_type_id, name: t.name, quantity: 0, lendingUnit: t.lending_unit })),
        );
      })
      .catch(() => setAllTypes([]))
      .finally(() => setTypesLoading(false));
  }, [step, selectedVenue, sport]);

  // Load calendar for conflict check on step 4
  useEffect(() => {
    if (step !== 4 || !venueId) return;
    setCalendarLoading(true);
    listCalendar({ venueId })
      .then((r) => setApprovedSessions(r.sessions))
      .catch(() => setApprovedSessions([]))
      .finally(() => setCalendarLoading(false));
  }, [step, venueId]);

  // ── Validators ──
  function validateS1(): boolean {
    const e: Record<string, string> = {};
    if (!bookingType) e.bookingType = 'Select a booking type.';
    if (!venueId) e.venueId = 'Select a venue.';
    if (!sport.trim()) e.sport = 'Specify the sport.';
    if (!bukcCount || bukcCountNum < 1) e.bukcCount = 'Enter BUKC team participant count.';
    if (!opponentCount || opponentCountNum < 1) e.opponentCount = 'Enter opponent team participant count.';
    setS1Err(e);
    return Object.keys(e).length === 0;
  }

  function validateS2(): boolean {
    const e: Record<string, string> = {};
    // BUKC team
    if (!bukcTeamName.trim()) e.bukcTeamName = 'Required.';
    if (bukcHasCaptain) {
      if (!bukcCaptainName.trim()) e.bukcCaptainName = 'Required when captain is specified.';
      if (!bukcCaptainEnrollment.trim()) e.bukcCaptainEnrollment = 'Required when captain is specified.';
      if (!bukcCaptainContact.trim()) e.bukcCaptainContact = 'Required when captain is specified.';
    }
    const validBukc = bukcPlayers.filter((p) => p.enrollmentNo.trim() && p.fullName.trim());
    if (validBukc.length < bukcCountNum) e.bukcPlayers = `Fill in all ${bukcCountNum} BUKC player entries.`;

    // Opponent / visiting team
    if (!opponentTeamName.trim()) e.opponentTeamName = 'Required.';
    if (bookingType === 'INTER_UNIVERSITY') {
      if (!opponentUniversity.trim()) e.opponentUniversity = 'Required for inter-university competition.';
      if (!opponentCity.trim()) e.opponentCity = 'Required.';
    } else {
      if (!organizingEntity.trim()) e.organizingEntity = 'Required.';
    }
    if (opponentHasCaptain) {
      if (!opponentCaptainName.trim()) e.opponentCaptainName = 'Required when captain is specified.';
      if (!opponentCaptainContact.trim()) e.opponentCaptainContact = 'Required when captain is specified.';
    }
    const validOpp = opponentPlayers.filter((p) => p.fullName.trim());
    // Visiting team player roster is not collected for inter-university events
    if (bookingType === 'INTERNAL' && validOpp.length < opponentCountNum) {
      e.opponentPlayers = `Fill in all ${opponentCountNum} opponent player entries.`;
    }

    // Two teams cannot have the same name (case-insensitive, whitespace-stripped)
    if (bukcTeamName.trim() && opponentTeamName.trim() &&
        bukcTeamName.replace(/\s+/g, '').toLowerCase() === opponentTeamName.replace(/\s+/g, '').toLowerCase()) {
      e.opponentTeamName = 'Team names must be different.';
    }
    setS2Err(e);
    return Object.keys(e).length === 0;
  }

  async function validateS4(): Promise<boolean> {
    const today = new Date().toISOString().slice(0, 10);
    const errs: Record<number, string> = {};
    for (const row of sessions) {
      if (row.date < today) { errs[row.sessionNo] = `${row.date} is in the past. Select a future date.`; continue; }
      const dow = new Date(row.date + 'T12:00:00').getDay();
      if (dow === 0 || dow === 6) { errs[row.sessionNo] = `${DAYS[dow]}s are not permitted. Matches must be on weekdays (Mon–Fri).`; continue; }
      if (row.endTime <= row.startTime) { errs[row.sessionNo] = 'End time must be after start time.'; continue; }
      const dup = sessions.filter((s) => s.date === row.date && s.sessionNo !== row.sessionNo).length > 0;
      if (dup) { errs[row.sessionNo] = `Duplicate date — another session in this request is already on ${row.date}.`; continue; }
      const reqStart = new Date(`${row.date}T${row.startTime}:00`);
      const reqEnd = new Date(`${row.date}T${row.endTime}:00`);
      const conflict = approvedSessions.find((s) => reqStart < new Date(s.ends_at) && reqEnd > new Date(s.starts_at));
      if (conflict) {
        const cs = new Date(conflict.starts_at).toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' });
        const ce = new Date(conflict.ends_at).toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' });
        errs[row.sessionNo] = `Venue already booked on ${row.date} from ${cs}–${ce}. Choose a different time or date.`;
      }
    }
    setSessionErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function nextStep() {
    if (step === 1 && !validateS1()) return;
    if (step === 2 && !validateS2()) return;
    if (step === 4 && !(await validateS4())) return;
    setStep((s) => Math.min(s + 1, TOTAL));
  }

  async function submit() {
    const ok = await validateS4();
    if (!ok) { setStep(4); return; }
    setBusy(true);
    try {
      const validBukc = bukcPlayers.filter((p) => p.enrollmentNo.trim() && p.fullName.trim());
      // Visiting team players are not collected for inter-university events (external institution)
      const validOpp = opponentPlayers.filter((p) => p.fullName.trim());
      const usedEquipment = equipmentSupport === 'UNIVERSITY'
        ? equipmentItems.filter((e) => e.quantity > 0).map((e) => ({ equipmentTypeId: e.equipmentTypeId, name: e.name, quantity: e.quantity }))
        : [];

      const meta = bookingType === 'INTER_UNIVERSITY' ? {
        bookingType: 'INTER_UNIVERSITY' as const,
        sport, eventFormat, matchFormat,
        bukcTeamName,
        bukcHasCaptain, bukcCaptainName: bukcHasCaptain ? bukcCaptainName : undefined,
        bukcCaptainEnrollment: bukcHasCaptain ? bukcCaptainEnrollment : undefined,
        bukcCaptainContact: bukcHasCaptain ? bukcCaptainContact : undefined,
        bukcPlayers: validBukc,
        visitingUniversity: opponentUniversity, visitingCity: opponentCity,
        visitingTeamName: opponentTeamName,
        visitingHasCaptain: opponentHasCaptain,
        visitingCaptainName: opponentHasCaptain ? opponentCaptainName : undefined,
        visitingCaptainContact: opponentHasCaptain ? opponentCaptainContact : undefined,
        equipmentSupport,
        equipmentItems: usedEquipment,
        specialRequirements: specialRequirements.trim() || undefined,
      } : {
        bookingType: 'INTERNAL' as const,
        sport, eventFormat, matchFormat,
        teamAName: bukcTeamName,
        teamAHasCaptain: bukcHasCaptain,
        teamACaptainName: bukcHasCaptain ? bukcCaptainName : undefined,
        teamACaptainEnrollment: bukcHasCaptain ? bukcCaptainEnrollment : undefined,
        teamACaptainContact: bukcHasCaptain ? bukcCaptainContact : undefined,
        teamAPlayers: validBukc,
        teamBName: opponentTeamName,
        teamBHasCaptain: opponentHasCaptain,
        teamBCaptainName: opponentHasCaptain ? opponentCaptainName : undefined,
        teamBCaptainContact: opponentHasCaptain ? opponentCaptainContact : undefined,
        teamBPlayers: validOpp,
        organizingEntity,
        equipmentSupport,
        equipmentItems: usedEquipment,
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
    ...inp, ...(hasErr ? { borderColor: '#c0392b', background: '#fff8f8' } : {}),
  });

  const STEP_LABELS = ['Basics', 'Teams & Rosters', 'Equipment', 'Sessions', 'Review'];

  return (
    <Panel title="New Booking Request">
      {/* Progress bar */}
      <div style={progressBar}>
        {STEP_LABELS.map((label, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 5, flex: i < TOTAL - 1 ? 1 : 0 }}>
            <div style={{
              width: 26, height: 26, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
              font: '600 12px var(--font-body)', flexShrink: 0,
              background: step > i + 1 ? '#1f8a4c' : step === i + 1 ? '#26485f' : '#e5e5e5',
              color: step >= i + 1 ? '#fff' : '#888',
            }}>
              {step > i + 1 ? '✓' : i + 1}
            </div>
            <span style={{ fontSize: 11, color: step === i + 1 ? '#26485f' : '#888', fontWeight: step === i + 1 ? 600 : 400, whiteSpace: 'nowrap' }}>{label}</span>
            {i < TOTAL - 1 && <div style={{ flex: 1, height: 2, background: step > i + 1 ? '#1f8a4c' : '#e5e5e5', margin: '0 3px' }} />}
          </div>
        ))}
      </div>

      {/* ── STEP 1: Basics ── */}
      {step === 1 && (
        <div style={stepBody}>
          <h3 style={stepTitle}>Step 1 — Booking Basics</h3>
          <div style={{ marginBottom: 18 }}>
            <span style={{ ...lbl, ...(s1Err.bookingType ? { color: '#c0392b' } : {}) }}>Booking type *</span>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 8 }}>
              {[
                { type: 'INTER_UNIVERSITY' as BookingType, icon: '🏆', title: 'Inter-University Competition', desc: 'BUKC hosts a visiting university team for an official match or tournament.' },
                { type: 'INTERNAL' as BookingType, icon: '🎯', title: 'Internal Competition', desc: 'Intra-campus or inter-department competition between two BUKC teams.' },
              ].map(({ type, icon, title, desc }) => (
                <button key={type} type="button"
                  style={{ ...typeCard, ...(bookingType === type ? typeCardActive : {}), ...(s1Err.bookingType ? { borderColor: '#c0392b' } : {}) }}
                  onClick={() => { setBookingType(type); setS1Err((p) => ({ ...p, bookingType: '' })); }}>
                  <div style={{ fontSize: 26, marginBottom: 6 }}>{icon}</div>
                  <div style={{ font: '600 14px var(--font-body)', color: '#26485f', marginBottom: 4 }}>{title}</div>
                  <div style={{ fontSize: 12, color: '#5c6773', lineHeight: 1.4 }}>{desc}</div>
                </button>
              ))}
            </div>
            {s1Err.bookingType && <span style={ferr}>{s1Err.bookingType}</span>}
          </div>

          <div style={fgrid}>
            <L label="Venue *">
              <select style={fi(!!s1Err.venueId)} value={venueId} onChange={(e) => { setVenueId(Number(e.target.value)); setSport(''); setS1Err((p) => ({ ...p, venueId: '' })); }}>
                <option value={0}>Select a venue…</option>
                {venues.filter((v) => v.availability_status === 'AVAILABLE').map((v) => (
                  <option key={v.venue_id} value={v.venue_id}>{v.name}{v.location ? ` · ${v.location}` : ''} (cap. {v.capacity})</option>
                ))}
              </select>
              {s1Err.venueId && <span style={ferr}>{s1Err.venueId}</span>}
            </L>
            <L label="Sport *">
              {selectedVenue && sportOptions.length > 0 ? (
                <select style={fi(!!s1Err.sport)} value={sport} onChange={(e) => { setSport(e.target.value); setS1Err((p) => ({ ...p, sport: '' })); }}>
                  <option value="">Select sport…</option>
                  {sportOptions.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              ) : (
                <input style={fi(!!s1Err.sport)} value={sport} onChange={(e) => { setSport(e.target.value); setS1Err((p) => ({ ...p, sport: '' })); }} placeholder="e.g. Football" />
              )}
              {s1Err.sport && <span style={ferr}>{s1Err.sport}</span>}
            </L>
            <L label="BUKC team — participants *">
              <input type="number" min={1} style={fi(!!s1Err.bukcCount)} value={bukcCount} onChange={(e) => { setBukcCount(e.target.value); setS1Err((p) => ({ ...p, bukcCount: '' })); }} placeholder="e.g. 11" />
              {s1Err.bukcCount && <span style={ferr}>{s1Err.bukcCount}</span>}
              {bukcCountNum > 0 && <span style={{ fontSize: 11, color: '#5c6773' }}>Roster in Step 2 will have {bukcCountNum} entries</span>}
            </L>
            <L label={bookingType === 'INTER_UNIVERSITY' ? 'Visiting team — participants *' : 'Team B — participants *'}>
              <input type="number" min={1} style={fi(!!s1Err.opponentCount)} value={opponentCount} onChange={(e) => { setOpponentCount(e.target.value); setS1Err((p) => ({ ...p, opponentCount: '' })); }} placeholder="e.g. 11" />
              {s1Err.opponentCount && <span style={ferr}>{s1Err.opponentCount}</span>}
            </L>
            <L label="Event format *">
              <select style={inp} value={eventFormat} onChange={(e) => {
                const fmt = e.target.value as EventFormat;
                setEventFormat(fmt);
                // Lock to one session for single match
                if (fmt === 'SINGLE_MATCH') {
                  setRows((prev) => prev.slice(0, 1));
                }
              }}>
                <option value="SINGLE_MATCH">Single Match</option>
                <option value="TOURNAMENT">Multi-day Tournament</option>
              </select>
            </L>
            <L label="Match format *">
              <select style={inp} value={matchFormat} onChange={(e) => setMatchFormat(e.target.value as MatchFormat)}>
                <option value="FRIENDLY">Friendly</option>
                <option value="LEAGUE">League</option>
                <option value="KNOCKOUT">Knockout</option>
                <option value="ROUND_ROBIN">Round Robin</option>
              </select>
            </L>
            {belowThreshold && (
              <div style={{ gridColumn: '1 / -1', ...warnBox }}>
                ⚠ VENUE-01: {selectedVenue?.is_indoor ? 'Indoor' : 'Outdoor'} venues require {selectedVenue?.is_indoor ? '6+' : '10+'} total participants. Ensure you have a valid justification for the Coordinator.
              </div>
            )}
            {selectedVenue && (
              <div style={{ gridColumn: '1 / -1', ...venueInfo }}>
                <strong>{selectedVenue.name}</strong>{selectedVenue.location && <> · {selectedVenue.location}</>} · Cap. {selectedVenue.capacity} · {selectedVenue.is_indoor ? 'Indoor' : 'Outdoor'}{selectedVenue.surface_type && <> · {selectedVenue.surface_type}</>}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── STEP 2: Teams & Rosters ── */}
      {step === 2 && (
        <div style={stepBody}>
          <h3 style={stepTitle}>Step 2 — Teams & Rosters</h3>

          {/* BUKC / Team A */}
          <SecHead>{bookingType === 'INTERNAL' ? `Team A (${bukcCountNum} player${bukcCountNum !== 1 ? 's' : ''})` : `BUKC Team (${bukcCountNum} player${bukcCountNum !== 1 ? 's' : ''})`}</SecHead>
          <div style={fgrid}>
            <L label="Team name *">
              <input style={fi(!!s2Err.bukcTeamName)} value={bukcTeamName} onChange={(e) => { setBTN(e.target.value); setS2Err((p) => ({ ...p, bukcTeamName: '' })); }} placeholder="e.g. BUKC Warriors" />
              {s2Err.bukcTeamName && <span style={ferr}>{s2Err.bukcTeamName}</span>}
            </L>
            {bookingType === 'INTERNAL' && (
              <L label="Organizing department / society *">
                <input style={fi(!!s2Err.organizingEntity)} value={organizingEntity} onChange={(e) => { setOE(e.target.value); setS2Err((p) => ({ ...p, organizingEntity: '' })); }} placeholder="e.g. CS Department, Sports Society" />
                {s2Err.organizingEntity && <span style={ferr}>{s2Err.organizingEntity}</span>}
              </L>
            )}
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', margin: '10px 0 6px', font: '14px var(--font-body)' }}>
            <input type="checkbox" checked={bukcHasCaptain} onChange={(e) => setBHC(e.target.checked)} />
            This team has a designated captain
          </label>
          {bukcHasCaptain && (
            <div style={{ ...fgrid, marginBottom: 12 }}>
              <L label="Captain name *"><input style={fi(!!s2Err.bukcCaptainName)} value={bukcCaptainName} onChange={(e) => { setBCN(e.target.value); setS2Err((p) => ({ ...p, bukcCaptainName: '' })); }} placeholder="Full name" />{s2Err.bukcCaptainName && <span style={ferr}>{s2Err.bukcCaptainName}</span>}</L>
              <L label="Captain enrollment no. *"><input style={fi(!!s2Err.bukcCaptainEnrollment)} value={bukcCaptainEnrollment} onChange={(e) => { setBCE(e.target.value); setS2Err((p) => ({ ...p, bukcCaptainEnrollment: '' })); }} placeholder="e.g. 84-024000-321" />{s2Err.bukcCaptainEnrollment && <span style={ferr}>{s2Err.bukcCaptainEnrollment}</span>}</L>
              <L label="Captain contact *"><input style={fi(!!s2Err.bukcCaptainContact)} value={bukcCaptainContact} onChange={(e) => { setBCC(e.target.value); setS2Err((p) => ({ ...p, bukcCaptainContact: '' })); }} placeholder="e.g. 0311-2345678" />{s2Err.bukcCaptainContact && <span style={ferr}>{s2Err.bukcCaptainContact}</span>}</L>
            </div>
          )}
          {s2Err.bukcPlayers && <div style={{ ...ferr, marginBottom: 8 }}>{s2Err.bukcPlayers}</div>}
          <RosterTable
            players={bukcPlayers}
            onChange={setBukcPlayers}
            withEnrollment={true}
            label="BUKC Player Roster"
          />

          {/* Opponent / Visiting Team */}
          <SecHead style={{ marginTop: 24 }}>
            {bookingType === 'INTER_UNIVERSITY' ? `Visiting Team (${opponentCountNum} player${opponentCountNum !== 1 ? 's' : ''})` : `Team B (${opponentCountNum} player${opponentCountNum !== 1 ? 's' : ''})`}
          </SecHead>
          <div style={fgrid}>
            <L label={bookingType === 'INTER_UNIVERSITY' ? 'Team name *' : 'Team name *'}>
              <input style={fi(!!s2Err.opponentTeamName)} value={opponentTeamName} onChange={(e) => { setOTN(e.target.value); setS2Err((p) => ({ ...p, opponentTeamName: '' })); }} placeholder={bookingType === 'INTER_UNIVERSITY' ? 'e.g. FAST Lions' : 'e.g. EE Department XI'} />
              {s2Err.opponentTeamName && <span style={ferr}>{s2Err.opponentTeamName}</span>}
            </L>
            {bookingType === 'INTER_UNIVERSITY' && <>
              <L label="University *"><input style={fi(!!s2Err.opponentUniversity)} value={opponentUniversity} onChange={(e) => { setOU(e.target.value); setS2Err((p) => ({ ...p, opponentUniversity: '' })); }} placeholder="e.g. FAST NUCES" />{s2Err.opponentUniversity && <span style={ferr}>{s2Err.opponentUniversity}</span>}</L>
              <L label="City *"><input style={fi(!!s2Err.opponentCity)} value={opponentCity} onChange={(e) => { setOC(e.target.value); setS2Err((p) => ({ ...p, opponentCity: '' })); }} placeholder="e.g. Karachi" />{s2Err.opponentCity && <span style={ferr}>{s2Err.opponentCity}</span>}</L>
            </>}
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', margin: '10px 0 6px', font: '14px var(--font-body)' }}>
            <input type="checkbox" checked={opponentHasCaptain} onChange={(e) => setOHC(e.target.checked)} />
            This team has a designated captain
          </label>
          {opponentHasCaptain && (
            <div style={{ ...fgrid, marginBottom: 12 }}>
              <L label="Captain name *"><input style={fi(!!s2Err.opponentCaptainName)} value={opponentCaptainName} onChange={(e) => { setOCN(e.target.value); setS2Err((p) => ({ ...p, opponentCaptainName: '' })); }} placeholder="Full name" />{s2Err.opponentCaptainName && <span style={ferr}>{s2Err.opponentCaptainName}</span>}</L>
              <L label="Captain contact *"><input style={fi(!!s2Err.opponentCaptainContact)} value={opponentCaptainContact} onChange={(e) => { setOCC(e.target.value); setS2Err((p) => ({ ...p, opponentCaptainContact: '' })); }} placeholder="e.g. 0312-3456789" />{s2Err.opponentCaptainContact && <span style={ferr}>{s2Err.opponentCaptainContact}</span>}</L>
            </div>
          )}
          {s2Err.opponentPlayers && <div style={{ ...ferr, marginBottom: 8 }}>{s2Err.opponentPlayers}</div>}
          {/* Roster only for internal Team B — visiting team players not collected for inter-university events */}
          {bookingType === 'INTERNAL' && (
            <RosterTable
              players={opponentPlayers}
              onChange={setOpponentPlayers}
              withEnrollment={true}
              label="Team B Player Roster"
            />
          )}
        </div>
      )}

      {/* ── STEP 3: Equipment ── */}
      {step === 3 && (
        <div style={stepBody}>
          <h3 style={stepTitle}>Step 3 — Equipment</h3>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 22 }}>
            {[
              { value: 'SELF' as EquipmentSupport, title: 'Both teams supply own equipment', desc: 'Each team brings the equipment needed. No university support required.' },
              { value: 'UNIVERSITY' as EquipmentSupport, title: 'University support required', desc: 'The university will provide equipment. Specify what is needed below. The Coordinator will verify availability and plan allocation.' },
            ].map(({ value, title, desc }) => (
              <label key={value} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', padding: '10px 14px', border: `2px solid ${equipmentSupport === value ? '#26485f' : '#e5e5e5'}`, borderRadius: 8, background: equipmentSupport === value ? '#f0f4f8' : '#fafafa' }}>
                <input type="radio" name="eqSupport" value={value} checked={equipmentSupport === value} onChange={() => setEquipmentSupport(value)} style={{ marginTop: 3 }} />
                <div>
                  <div style={{ font: '600 14px var(--font-body)', color: '#26485f' }}>{title}</div>
                  <div style={{ font: '12px var(--font-body)', color: '#5c6773', marginTop: 2 }}>{desc}</div>
                </div>
              </label>
            ))}
          </div>

          {equipmentSupport === 'UNIVERSITY' && (
            <>
              <div style={{ ...venueInfo, marginBottom: 14 }}>
                Equipment types below are matched to <strong>{sport}</strong> at <strong>{selectedVenue?.name}</strong>. Set the quantity needed for each type. Leave at 0 if not required.
              </div>
              {typesLoading ? (
                <p style={muted}>Loading equipment types…</p>
              ) : equipmentItems.length === 0 ? (
                <p style={muted}>No equipment types found for {sport} in the inventory. Contact the Sports Department directly.</p>
              ) : (
                <div style={{ display: 'grid', gap: 10 }}>
                  {equipmentItems.map((item, i) => (
                    <div key={item.equipmentTypeId} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '10px 14px', border: `1px solid ${item.quantity > 0 ? '#26485f' : '#e5e5e5'}`, borderRadius: 8, background: item.quantity > 0 ? '#f0f4f8' : '#fafafa' }}>
                      <div style={{ flex: 1, font: '500 14px var(--font-body)', color: '#333' }}>
                        {item.name}{item.lendingUnit === 'PAIR' ? <span style={{ fontSize: 12, color: '#5c6773', marginLeft: 6 }}>(pair)</span> : null}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <button type="button" style={qtyBtn} onClick={() => setEquipmentItems((prev) => prev.map((e, j) => j === i ? { ...e, quantity: Math.max(0, e.quantity - 1) } : e))}>−</button>
                        <span style={{ font: '600 16px var(--font-body)', minWidth: 28, textAlign: 'center', color: item.quantity > 0 ? '#26485f' : '#aaa' }}>{item.quantity}</span>
                        <button type="button" style={qtyBtn} onClick={() => setEquipmentItems((prev) => prev.map((e, j) => j === i ? { ...e, quantity: e.quantity + 1 } : e))}>+</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── STEP 4: Sessions ── */}
      {step === 4 && (
        <div style={stepBody}>
          <h3 style={stepTitle}>Step 4 — {eventFormat === 'SINGLE_MATCH' ? 'Match Date & Time' : 'Tournament Schedule'}</h3>
          {calendarLoading && <div style={{ ...infoBox, marginBottom: 14 }}>Checking venue availability…</div>}
          <div style={{ ...venueInfo, marginBottom: 14 }}>
            <strong>Date rules:</strong> Weekdays only (Mon–Fri) · Future dates only · No overlap with existing approved sessions at this venue
          </div>
          {eventFormat === 'TOURNAMENT' && <p style={{ margin: '-4px 0 14px', fontSize: 13.5, color: '#5c6773' }}>Add one session per match day. Same-date sessions are not allowed.</p>}
          <SessionRowsEditor rows={sessions} onAdd={addRow} onRemove={removeRow} onUpdate={updateRow} errors={sessionErrors} allowMultiple={eventFormat === 'TOURNAMENT'} />
          <div style={{ marginTop: 20 }}>
            <L label="Special requirements / notes (optional)">
              <textarea style={{ ...inp, minHeight: 72, resize: 'vertical', width: '100%', boxSizing: 'border-box' }} value={specialRequirements} onChange={(e) => setSpecialReq(e.target.value)} placeholder="e.g. Scoreboard access, spectator seating for 50, referee required…" maxLength={500} />
              <span style={{ fontSize: 11, color: '#8a949f' }}>{specialRequirements.length}/500</span>
            </L>
          </div>
        </div>
      )}

      {/* ── STEP 5: Review ── */}
      {step === 5 && (
        <div style={stepBody}>
          <h3 style={stepTitle}>Step 5 — Review Your Request</h3>
          <p style={{ margin: '-8px 0 18px', fontSize: 13.5, color: '#5c6773' }}>Verify everything below before submitting. You cannot edit after submission.</p>

          <RevSec title="Event Details">
            <RevRow label="Type" value={bookingType === 'INTER_UNIVERSITY' ? 'Inter-University Competition' : 'Internal Competition'} />
            <RevRow label="Venue" value={`${selectedVenue?.name ?? '—'}${selectedVenue?.location ? ` · ${selectedVenue.location}` : ''}`} />
            <RevRow label="Sport" value={sport} />
            <RevRow label="Format" value={`${eventFormat === 'SINGLE_MATCH' ? 'Single Match' : 'Multi-day Tournament'} · ${matchFormat.replace('_', ' ')}`} />
            <RevRow label="Total participants" value={`${totalParticipants} (BUKC: ${bukcCountNum}, ${bookingType === 'INTER_UNIVERSITY' ? 'Visiting' : 'Team B'}: ${opponentCountNum})`} />
          </RevSec>

          <RevSec title={bookingType === 'INTERNAL' ? `Team A — ${bukcTeamName}` : `BUKC Team — ${bukcTeamName}`}>
            {bukcHasCaptain && (
              <>
                <RevRow label="Captain" value={bukcCaptainName} />
                <RevRow label="Enrollment" value={bukcCaptainEnrollment} />
                <RevRow label="Contact" value={bukcCaptainContact} />
              </>
            )}
            <RevRow label="Players" value={`${bukcPlayers.filter((p) => p.enrollmentNo.trim()).length} of ${bukcCountNum}`} />
            {bukcPlayers.filter((p) => p.fullName.trim()).map((p, i) => (
              <RevRow key={i} label={`  #${i + 1}`} value={`${p.fullName}${p.enrollmentNo ? ` · ${p.enrollmentNo}` : ''}`} />
            ))}
          </RevSec>

          <RevSec title={bookingType === 'INTER_UNIVERSITY' ? `Visiting Team — ${opponentTeamName}` : `Team B — ${opponentTeamName}`}>
            {bookingType === 'INTER_UNIVERSITY' && <RevRow label="University" value={`${opponentUniversity}, ${opponentCity}`} />}
            {opponentHasCaptain && (
              <>
                <RevRow label="Captain" value={opponentCaptainName} />
                <RevRow label="Contact" value={opponentCaptainContact} />
              </>
            )}
            {bookingType === 'INTERNAL' && (
              <>
                <RevRow label="Players" value={`${opponentPlayers.filter((p) => p.fullName.trim()).length} of ${opponentCountNum}`} />
                {opponentPlayers.filter((p) => p.fullName.trim()).map((p, i) => (
                  <RevRow key={i} label={`  #${i + 1}`} value={`${p.fullName}${p.enrollmentNo ? ` · ${p.enrollmentNo}` : ''}`} />
                ))}
              </>
            )}
          </RevSec>

          <RevSec title="Equipment">
            <RevRow label="Support" value={equipmentSupport === 'SELF' ? 'Both teams supply own equipment' : 'University support required'} />
            {equipmentSupport === 'UNIVERSITY' && equipmentItems.filter((e) => e.quantity > 0).map((e) => (
              <RevRow key={e.equipmentTypeId} label={e.name} value={`${e.quantity} unit${e.quantity !== 1 ? 's' : ''}`} />
            ))}
            {equipmentSupport === 'UNIVERSITY' && equipmentItems.filter((e) => e.quantity > 0).length === 0 && (
              <RevRow label="Note" value="No equipment types requested — coordinator will be notified of support need" />
            )}
          </RevSec>

          <RevSec title={`Sessions (${sessions.length})`}>
            {sessions.map((s) => (
              <RevRow key={s.sessionNo} label={`Session ${s.sessionNo}`} value={`${s.date} (${DAYS[new Date(s.date + 'T12:00:00').getDay()]}) · ${s.startTime}–${s.endTime}`} />
            ))}
          </RevSec>

          {specialRequirements && (
            <RevSec title="Special Requirements">
              <div style={{ padding: '6px 14px', fontSize: 13.5, color: '#444', lineHeight: 1.5 }}>{specialRequirements}</div>
            </RevSec>
          )}

          <div style={{ marginTop: 16, padding: '12px 14px', background: '#f0f4f8', borderRadius: 6, fontSize: 13, color: '#5c6773', lineHeight: 1.6 }}>
            By submitting, you confirm all information is accurate and this event complies with BUKC Sports Department policies.
          </div>
        </div>
      )}

      {/* Navigation */}
      <div style={footer}>
        <div style={{ display: 'flex', gap: 10 }}>
          {step > 1 && <button type="button" style={ghostBtn} onClick={() => setStep((s) => s - 1)}>← Back</button>}
          {step < TOTAL && <button type="button" style={primaryBtn} onClick={nextStep}>Continue →</button>}
          {step === TOTAL && <button type="button" style={submitBtn} disabled={busy} onClick={submit}>{busy ? 'Submitting…' : 'Submit Booking Request'}</button>}
        </div>
        <button type="button" style={{ ...ghostBtn, color: '#c0392b', borderColor: '#c0392b' }} onClick={onCancel}>Cancel</button>
      </div>
    </Panel>
  );
}

// ── Roster table component ──
function RosterTable({ players, onChange, withEnrollment, label }: {
  players: Player[];
  onChange: React.Dispatch<React.SetStateAction<Player[]>>;
  withEnrollment: boolean;
  label: string;
}) {
  if (players.length === 0) return <p style={muted}>Enter participant count in Step 1 to populate the roster.</p>;
  return (
    <div>
      <span style={{ ...lbl, marginBottom: 8 }}>{label}</span>
      <div style={{ display: 'grid', gap: 6 }}>
        {players.map((player, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#f8f9fa', padding: '7px 10px', borderRadius: 6, border: '1px solid #e5e5e5' }}>
            <span style={{ fontSize: 12, color: '#8a949f', width: 22, flexShrink: 0 }}>#{i + 1}</span>
            {withEnrollment && (
              <input style={{ ...inp, flex: 1 }} placeholder="Enrollment no." value={player.enrollmentNo}
                onChange={(e) => onChange((prev) => prev.map((p, j) => j === i ? { ...p, enrollmentNo: e.target.value } : p))} />
            )}
            <input style={{ ...inp, flex: 2 }} placeholder="Full name" value={player.fullName}
              onChange={(e) => onChange((prev) => prev.map((p, j) => j === i ? { ...p, fullName: e.target.value } : p))} />
          </div>
        ))}
      </div>
      <p style={{ margin: '6px 0 0', fontSize: 12, color: '#5c6773' }}>To change roster size, go back to Step 1 and update the participant count.</p>
    </div>
  );
}

// ── Small reusable components ──
function SecHead({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{ font: '600 12px var(--font-body)', color: '#26485f', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '18px 0 10px', paddingBottom: 6, borderBottom: '2px solid #e7edf4', ...style }}>{children}</div>;
}
function RevSec({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12, border: '1px solid #e5e5e5', borderRadius: 6, overflow: 'hidden' }}>
      <div style={{ padding: '7px 14px', background: '#f7f9fb', borderBottom: '1px solid #e5e5e5', font: '600 11px var(--font-body)', color: '#26485f', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{title}</div>
      <div style={{ padding: '2px 0' }}>{children}</div>
    </div>
  );
}
function RevRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', padding: '5px 14px', borderBottom: '1px solid #f4f4f4', fontSize: 13.5 }}>
      <span style={{ color: '#8a949f', fontWeight: 600 }}>{label}</span>
      <span style={{ color: '#333' }}>{value}</span>
    </div>
  );
}
function StatusBadge({ status }: { status: string }) {
  const s = ['APPROVED', 'COMPLETED'].includes(status) ? { background: '#e6f4ec', color: '#1f7a45' }
    : ['REJECTED', 'CANCELLED'].includes(status) ? { background: '#fbe9e7', color: '#b3352b' }
    : status === 'SENT_BACK' ? { background: '#fdf1e3', color: '#9a6412' }
    : { background: '#f0f4f8', color: '#26485f' };
  const label = status === 'SHORTFALL_PENDING' ? 'Awaiting your response'
    : status === 'SENT_BACK' ? 'Coordinator sent back — review required'
    : status;
  return <span style={{ font: '600 11px var(--font-mono)', padding: '2px 8px', borderRadius: 4, ...s }}>{label}</span>;
}
function SentBackDetail({ bookingId }: { bookingId: string }) {
  const [detail, setDetail] = useState<import('./api.js').BookingDetailFull | null>(null);
  useEffect(() => { getBookingFull(bookingId).then(setDetail).catch(() => {}); }, [bookingId]);
  if (!detail) return <div style={{ padding: '8px 10px', fontSize: 13, color: '#8a949f' }}>Loading coordinator note…</div>;

  const proposed = detail.coordinator_proposed_sessions;
  const note = detail.sent_back_note;

  return (
    <div style={{ border: '1px solid #fcd34d', borderRadius: 6, padding: '12px 14px', background: '#fffbeb', marginTop: 4 }}>
      <div style={{ font: '600 13px var(--font-body)', color: '#92400e', marginBottom: 8 }}>📋 Coordinator's message</div>
      {note && <p style={{ margin: '0 0 10px', fontSize: 14, color: '#78350f', lineHeight: 1.6 }}>{note}</p>}
      {proposed && proposed.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div style={{ font: '600 12px var(--font-body)', color: '#92400e', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>Proposed alternative schedule</div>
          {proposed.map((s) => (
            <div key={s.sessionNo} style={{ fontSize: 13.5, color: '#78350f', marginBottom: 3 }}>
              Session {s.sessionNo}: {new Date(s.startAt).toLocaleDateString('en-PK', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} · {new Date(s.startAt).toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' })} – {new Date(s.endAt).toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' })}
            </div>
          ))}
          <p style={{ margin: '8px 0 0', fontSize: 13, color: '#9a6412' }}>If you accept, your booking will be resubmitted with this schedule.</p>
        </div>
      )}
    </div>
  );
}
function SentBackActions({ booking, onDone, onError }: { booking: MyBooking; onDone: (m: string) => void; onError: (m: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [showDecline, setShowDecline] = useState(false);
  async function accept() {
    setBusy(true);
    try { await acceptSentBack(booking.booking_id); onDone('Booking resubmitted — back in the Coordinator\'s queue.'); }
    catch (e) { onError(errMsg(e)); } finally { setBusy(false); }
  }
  async function decline() {
    setBusy(true);
    try { await declineSentBack(booking.booking_id); onDone('Booking declined and closed.'); }
    catch (e) { onError(errMsg(e)); } finally { setBusy(false); }
  }
  if (showDecline) return (
    <span style={{ display: 'inline-flex', gap: 6 }}>
      <span style={{ fontSize: 12.5, color: '#5c6773' }}>Confirm decline?</span>
      <button style={smdanger} disabled={busy} onClick={decline}>Yes, decline</button>
      <button style={smghost} onClick={() => setShowDecline(false)}>Cancel</button>
    </span>
  );
  return (
    <span style={{ display: 'inline-flex', gap: 6 }}>
      <button style={smaccept} disabled={busy} onClick={accept}>Accept & resubmit</button>
      <button style={smghost} onClick={() => setShowDecline(true)}>Decline</button>
    </span>
  );
}
function ShortfallActions({ bookingId, onDone, onError }: { bookingId: string; onDone: (m: string) => void; onError: (m: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [dec, setDec] = useState(false);
  async function respond(yes: boolean) { setBusy(true); try { await confirmShortfall(bookingId, yes); onDone(yes ? 'Confirmed.' : 'Declined.'); } catch (e) { onError(errMsg(e)); } finally { setBusy(false); } }
  if (dec) return <span style={{ display: 'inline-flex', gap: 6 }}><button style={smdanger} disabled={busy} onClick={() => respond(false)}>Yes, decline</button><button style={smghost} onClick={() => setDec(false)}>Cancel</button></span>;
  return <span style={{ display: 'inline-flex', gap: 6 }}><button style={smaccept} disabled={busy} onClick={() => respond(true)}>I'll supply it</button><button style={smghost} onClick={() => setDec(true)}>Decline</button></span>;
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
const tbl: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 14 };
const th: React.CSSProperties = { textAlign: 'left', font: '600 11px var(--font-body)', color: '#888', textTransform: 'uppercase', letterSpacing: '0.04em', padding: '0 8px 10px', borderBottom: '1px solid #e5e5e5' };
const td: React.CSSProperties = { padding: '11px 8px', borderBottom: '1px solid #eee', color: '#333', verticalAlign: 'top' };
const lbl: React.CSSProperties = { display: 'block', font: '500 12px var(--font-body)', color: '#26485f', marginBottom: 5, marginTop: 2 };
const inp: React.CSSProperties = { width: '100%', font: '14px var(--font-body)', padding: '9px 11px', border: '1px solid #ccc', borderRadius: 6, boxSizing: 'border-box' };
const fgrid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 };
const ferr: React.CSSProperties = { display: 'block', fontSize: 12, color: '#c0392b', marginTop: 4 };
const warnBox: React.CSSProperties = { padding: '8px 12px', background: '#fdf1e3', border: '1px solid #f0c060', borderRadius: 6, fontSize: 12.5, color: '#9a6412', lineHeight: 1.5 };
const infoBox: React.CSSProperties = { padding: '10px 14px', background: '#e3f2ff', border: '1px solid #90caf9', borderRadius: 6, fontSize: 13.5, color: '#1565c0', marginBottom: 18 };
const venueInfo: React.CSSProperties = { padding: '10px 14px', background: '#f0f4f8', borderRadius: 6, fontSize: 13, color: '#26485f' };
const muted: React.CSSProperties = { color: '#8a949f', fontSize: 14, margin: '8px 0' };
const primaryBtn: React.CSSProperties = { background: '#26485f', color: '#fff', border: 'none', borderRadius: 6, padding: '9px 20px', fontSize: 14, cursor: 'pointer', fontWeight: 600 };
const submitBtn: React.CSSProperties = { background: '#1f8a4c', color: '#fff', border: 'none', borderRadius: 6, padding: '10px 24px', fontSize: 15, cursor: 'pointer', fontWeight: 700 };
const ghostBtn: React.CSSProperties = { background: '#fff', color: '#555', border: '1px solid #ccc', borderRadius: 6, padding: '9px 18px', fontSize: 14, cursor: 'pointer' };
const smaccept: React.CSSProperties = { background: '#1f8a4c', color: '#fff', border: 'none', borderRadius: 4, padding: '5px 10px', fontSize: 12.5, cursor: 'pointer' };
const smdanger: React.CSSProperties = { background: '#c0392b', color: '#fff', border: 'none', borderRadius: 4, padding: '5px 10px', fontSize: 12.5, cursor: 'pointer' };
const smghost: React.CSSProperties = { background: '#fff', color: '#555', border: '1px solid #ccc', borderRadius: 4, padding: '5px 10px', fontSize: 12.5, cursor: 'pointer' };
const progressBar: React.CSSProperties = { display: 'flex', alignItems: 'center', marginBottom: 28 };
const stepBody: React.CSSProperties = { paddingBottom: 8 };
const stepTitle: React.CSSProperties = { margin: '0 0 18px', font: '700 18px var(--font-body)', color: '#26485f' };
const footer: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 20, marginTop: 20, borderTop: '1px solid #e5e5e5' };
const typeCard: React.CSSProperties = { background: '#f8f9fa', border: '2px solid #e5e5e5', borderRadius: 10, padding: '16px 18px', cursor: 'pointer', textAlign: 'center' };
const typeCardActive: React.CSSProperties = { borderColor: '#26485f', background: '#f0f4f8' };
const emptyState: React.CSSProperties = { textAlign: 'center', padding: '40px 24px' };
const qtyBtn: React.CSSProperties = { width: 30, height: 30, borderRadius: 6, border: '1px solid #ccc', background: '#fff', cursor: 'pointer', font: '600 16px var(--font-body)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#26485f' };
const box = {
  err: { background: '#fdecec', color: '#8f2323', border: '1px solid #f3caca', borderRadius: 6, padding: '10px 14px', marginBottom: 16, fontSize: 14 } as React.CSSProperties,
  ok: { background: '#eaf6ee', color: '#1e6b3a', border: '1px solid #c2e6cd', borderRadius: 6, padding: '10px 14px', marginBottom: 16, fontSize: 14 } as React.CSSProperties,
};
