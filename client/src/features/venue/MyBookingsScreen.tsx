/**
 * External — Book a Venue. (BUKC students can no longer book a venue.)
 *
 * Four-step wizard:
 *   Step 1 — Venue, sport, number of teams
 *   Step 2 — Teams & members: for each member their name, university name and
 *            university ID (free text — every university uses its own format)
 *   Step 3 — Date & time (one or more sessions, conflict pre-check)
 *   Step 4 — Review & submit → Coordinator's Venue Queue
 *
 * Workflow after submission: Coordinator reviews + checks conflicts and
 * forwards to the Super Admin, who approves or rejects (with a reason). The
 * external is notified with the confirmed schedule or the rejection reason;
 * both also show in the table here.
 *
 * Rules enforced client-side (server enforces the same):
 *   VENUE-01: threshold advisory (6 indoor / 10 outdoor)
 *   VENUE-06: single or multi-session
 *   VENUE-07: one active request at a time
 *   VENUE-24/25: session conflict pre-check against approved calendar
 *
 * Re-themed to match the site's actual current visual language (Landing /
 * Home / Register / Profile / Usage History / Accounts / Offline Fallback /
 * Conflict Detection / Venue Calendar / Equipment Availability / Kit
 * Borrow): dark navy page with two soft glow blobs, the same header (logo,
 * wordmark, ghost Back/Sign out) as Accounts, everything wrapped in one
 * frosted glass panel, white/soft-gradient cards, and a single accent blue
 * for interactive elements. Every color in the five-step wizard, the
 * booking table, and the Sent-back review modal was mapped from the old
 * ad-hoc palette onto these same tokens — no JSX structure, validation, or
 * API calls were touched, only color/style values.
 */
import { useEffect, useState, useCallback, Fragment } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth.js';
import {
  listVenues, submitBooking, listMyBookings, confirmShortfall, listCalendar,
  acceptSentBack, declineSentBack, getBookingFull,
  type Venue, type MyBooking, type BookingDetailFull, type ExternalTeam, type ExternalMember,
} from './api.js';
import { useSessionRows, SessionRowsEditor } from './SessionsBuilder.js';
import { ApiRequestError } from '../../lib/api.js';
import { HideInAppShell } from '../../components/AppShellContext.js';
import { useBackStep } from '../../components/backStack.js';

/* ---------- theme (identical values used across the app) ---------- */
const palette = {
  navy900: '#0F172B',
  navy800: '#132357',
  navyDeep: '#031636',
  slate600: '#132357',
  slate500: '#62748E',
  slate400: '#90A1B9',
  slate300: '#CAD5E2',
  slate100: '#E2E8F0',
  slate50: '#F8FAFC',
  white: '#FFFFFF',
  accent: '#1C398E',
  accentSoft: '#DBEAFE',
  accentWash: '#1C398E14',
};

function errMsg(e: unknown) {
  return e instanceof ApiRequestError ? e.body.error : 'Something went wrong.';
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// ── Root screen ──
export default function MyBookingsScreen() {
  const { user, loading, logout } = useAuth();
  const navigate = useNavigate();
  const [venues, setVenues] = useState<Venue[]>([]);
  const [bookings, setBookings] = useState<MyBooking[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [reviewingBooking, setReviewingBooking] = useState<MyBooking | null>(null);
  const [openSchedule, setOpenSchedule] = useState<string | null>(null);

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

  // Go back (top right) closes the booking form opened with "New Booking Request".
  useBackStep(showForm, () => setShowForm(false));

  if (loading) return <div className="mbk-ui" style={{ minHeight: '100%', background: palette.navy900 }} />;
  if (!user) return <Navigate to="/" replace />;
  // Only externals can book a venue — BUKC students don't see this page.
  if (user.role !== 'EXTERNAL') return <Navigate to="/home" replace />;

  // One request at a time: something still being decided, or an approved
  // booking whose sessions haven't finished yet (server enforces the same).
  const hasActive = bookings.some((b) =>
    ['PENDING', 'FORWARDED', 'SHORTFALL_PENDING', 'SENT_BACK'].includes(b.status)
    || (b.status === 'APPROVED' && b.lastEnd != null && new Date(b.lastEnd).getTime() > Date.now()),
  );

  return (
    <div className="mbk-ui" style={s.page}>
      <MbkStyles />
      <div style={s.blobA} aria-hidden />
      <div style={s.blobB} aria-hidden />

      <HideInAppShell>
        <header style={s.topbar}>
          <div style={s.brand}>
            <img src="/landing/bu_logo.png" alt="Bahria University" style={s.logoImg} />
            <div>
              <div style={s.wordmark}>Bahria University</div>
              <div style={s.wordmarkSub}>Sports Management Portal</div>
            </div>
          </div>
          <div style={s.topbarRight}>
            <button type="button" className="hist-topbtn" style={s.topBtn} onClick={() => navigate('/home')}><BackIcon /> Back</button>
            <button type="button" className="hist-topbtn hist-signout" style={s.topBtn} onClick={() => { void logout(); navigate('/'); }}>
              <SignOutIcon /> Sign out
            </button>
          </div>
        </header>
      </HideInAppShell>

      <main style={s.main}>
        <div className="mbk-glass" style={s.glassPanel}>
          <div style={s.headRow}>
            <span style={s.eyebrow}>External Portal</span>
            <h1 style={s.title}>Book a Venue</h1>
            <p style={s.subtitle}>Request a venue for your teams. The Coordinator reviews it and forwards it to the Super Admin for approval.</p>
          </div>

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
              <p style={{ margin: '0 0 6px', font: '600 16px Inter, sans-serif', color: '#0F172B' }}>No booking requests yet.</p>
              <p style={{ margin: '0 0 20px', font: '14px Inter, sans-serif', color: '#62748E' }}>Submit a request to book a venue for your match or tournament.</p>
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
                    <td style={td}><div style={{ fontWeight: 600 }}>{b.venue_name}</div><div style={{ fontSize: 12, color: '#62748E' }}>{b.purpose}</div></td>
                    <td style={td}>{b.sessionCount > 1 ? `${b.sessionCount} sessions · ` : ''}{b.firstStart ? new Date(b.firstStart).toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}</td>
                    <td style={td}><StatusBadge status={b.status} /></td>
                    <td style={{ ...td, fontSize: 13 }}>
                      {b.status === 'REJECTED' && b.rejection_reason && <span style={{ color: '#8F2323' }}><strong>Reason:</strong> {b.rejection_reason}</span>}
                      {b.status === 'APPROVED' && <span style={{ color: '#1F7A45' }}>Approved — see your schedule</span>}
                      {b.status === 'PENDING' && <span style={{ color: '#62748E' }}>Coordinator is reviewing</span>}
                      {b.status === 'FORWARDED' && <span style={{ color: '#62748E' }}>Waiting for Super Admin decision</span>}
                      {b.status === 'EXPIRED' && <span style={{ color: '#62748E' }}>No decision before the first session</span>}
                    </td>
                    <td style={{ ...td, textAlign: 'right' }}>
                      {['APPROVED', 'COMPLETED'].includes(b.status) && (
                        <button style={smghost} onClick={() => setOpenSchedule((o) => (o === b.booking_id ? null : b.booking_id))}>
                          {openSchedule === b.booking_id ? 'Hide schedule' : 'View schedule'}
                        </button>
                      )}
                      {b.status === 'SHORTFALL_PENDING' && (
                        <ShortfallActions bookingId={b.booking_id}
                          onDone={(m) => { setNotice(m); void load(); }}
                          onError={(m) => setError(m)} />
                      )}
                      {b.status === 'SENT_BACK' && (
                        <button style={smaccept} onClick={() => setReviewingBooking(b)}>
                          📋 Review Response
                        </button>
                      )}
                    </td>
                  </tr>
                  {openSchedule === b.booking_id && (
                    <tr><td colSpan={5} style={{ ...td, background: '#F3FAF6' }}><ScheduleRow bookingId={b.booking_id} /></td></tr>
                  )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        {hasActive && !showForm && (
          <div style={infoBox}>
            <strong>One booking at a time.</strong> You have a request that is still being reviewed, or an approved booking with upcoming sessions. You can submit a new request once it is decided or its sessions are over.
          </div>
        )}
        {showForm && (
          <BookingWizard venues={venues}
            onDone={(m) => { setNotice(m); setShowForm(false); void load(); }}
            onError={(m) => setError(m)}
            onCancel={() => setShowForm(false)} />
        )}
        {reviewingBooking && (
          <SentBackReviewModal
            booking={reviewingBooking}
            onDone={(m) => { setNotice(m); setError(null); setReviewingBooking(null); void load(); }}
            onError={(m) => { setError(m); setNotice(null); }}
            onClose={() => setReviewingBooking(null)} />
        )}
          </div>
        </div>
      </main>

      <HideInAppShell>
        <footer style={s.footer}>
          2026 © <a href="/" style={s.footerLink}>Bahria University</a> — Sports Management Portal
        </footer>
      </HideInAppShell>
    </div>
  );
}

function BackIcon() { return <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M9.5 3 4 8l5.5 5M4.5 8H14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>; }
function SignOutIcon() { return <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M6.5 2H3.5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><path d="M10.5 5 14 8l-3.5 3M14 8H6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>; }

function MbkStyles() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
      .mbk-ui { font-family: 'Inter', system-ui, sans-serif; }
      .mbk-ui * { box-sizing: border-box; }
      .hist-topbtn { transition: background-color .18s ease, border-color .18s ease, color .18s ease; text-decoration: none; }
      .hist-topbtn:hover { background-color: rgba(255,255,255,0.08); border-color: ${palette.slate100}; }
      .hist-signout:hover { background-color: ${palette.accent} !important; border-color: ${palette.accent} !important; color: #fff !important; }
      @media (max-width: 620px) {
        .mbk-glass { padding: 20px 14px 26px !important; border-radius: 18px !important; }
        .mbk-member-head { display: none !important; }
        .mbk-member-row { flex-wrap: wrap; }
        .mbk-member-row input { flex: 1 1 100% !important; }
      }
    `}</style>
  );
}

// ── Wizard (external request) ──
// Step 1 — Venue, sport, number of teams
// Step 2 — Teams & members (name, university name, university ID — free text)
// Step 3 — Date & time (one or more sessions, conflict pre-check)
// Step 4 — Review & submit → goes to the Coordinator's Venue Queue
const MAX_TEAMS = 16;
const MAX_MEMBERS = 30;

function emptyMember(): ExternalMember { return { fullName: '', universityName: '', universityId: '' }; }
function emptyTeam(): ExternalTeam { return { teamName: '', members: [emptyMember()] }; }

function BookingWizard({ venues, onDone, onError, onCancel }: {
  venues: Venue[];
  onDone: (m: string) => void;
  onError: (m: string) => void;
  onCancel: () => void;
}) {
  const TOTAL = 4;
  const [step, setStep] = useState(1);
  // Go back from step 2+ returns to the previous step (step 1 → closes the form).
  useBackStep(step > 1, () => setStep((n) => Math.max(1, n - 1)), 1);

  // Step 1
  const [venueId, setVenueId] = useState(0);
  const [sport, setSport] = useState('');
  const [teamCount, setTeamCount] = useState('2');
  const [s1Err, setS1Err] = useState<Record<string, string>>({});

  // Step 2
  const [teams, setTeams] = useState<ExternalTeam[]>([emptyTeam(), emptyTeam()]);
  const [s2Err, setS2Err] = useState<Record<string, string>>({});

  // Step 3
  const { rows: sessions, addRow, removeRow, updateRow, toSessionInputs } = useSessionRows();
  const [sessionErrors, setSessionErrors] = useState<Record<number, string>>({});
  const [approvedSessions, setApprovedSessions] = useState<Array<{ starts_at: string; ends_at: string }>>([]);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [specialRequirements, setSpecialReq] = useState('');

  const [busy, setBusy] = useState(false);

  const selectedVenue = venues.find((v) => v.venue_id === venueId);
  const sportOptions = selectedVenue?.sports.map((s) => s.sport_name) ?? [];
  const teamCountNum = parseInt(teamCount, 10) || 0;
  const totalMembers = teams.reduce((n, t) => n + t.members.length, 0);
  const threshold = selectedVenue?.is_indoor ? 6 : 10;
  const belowThreshold = totalMembers > 0 && totalMembers < threshold;

  // Keep the number of team cards in step with "Number of teams".
  useEffect(() => {
    if (teamCountNum < 1 || teamCountNum > MAX_TEAMS) return;
    setTeams((prev) => {
      if (prev.length === teamCountNum) return prev;
      if (prev.length < teamCountNum) return [...prev, ...Array.from({ length: teamCountNum - prev.length }, emptyTeam)];
      return prev.slice(0, teamCountNum);
    });
  }, [teamCountNum]);

  // Approved calendar for the conflict pre-check on the date & time step.
  useEffect(() => {
    if (step !== 3 || !venueId) return;
    setCalendarLoading(true);
    listCalendar({ venueId })
      .then((r) => setApprovedSessions(r.sessions))
      .catch(() => setApprovedSessions([]))
      .finally(() => setCalendarLoading(false));
  }, [step, venueId]);

  // ── team/member editing ──
  function updateTeam(ti: number, patch: Partial<ExternalTeam>) {
    setTeams((prev) => prev.map((t, i) => (i === ti ? { ...t, ...patch } : t)));
  }
  function updateMember(ti: number, mi: number, patch: Partial<ExternalMember>) {
    setTeams((prev) => prev.map((t, i) => (i !== ti ? t : { ...t, members: t.members.map((m, j) => (j === mi ? { ...m, ...patch } : m)) })));
  }
  function addMember(ti: number) {
    setTeams((prev) => prev.map((t, i) => (i !== ti || t.members.length >= MAX_MEMBERS ? t : {
      ...t,
      // New rows start with the previous member's university — most teams come from one university.
      members: [...t.members, { ...emptyMember(), universityName: t.members[t.members.length - 1]?.universityName ?? '' }],
    })));
  }
  function removeMember(ti: number, mi: number) {
    setTeams((prev) => prev.map((t, i) => (i !== ti || t.members.length <= 1 ? t : { ...t, members: t.members.filter((_, j) => j !== mi) })));
  }
  function copyUniversityToAll(ti: number) {
    setTeams((prev) => prev.map((t, i) => {
      if (i !== ti) return t;
      const uni = t.members[0]?.universityName ?? '';
      return { ...t, members: t.members.map((m) => ({ ...m, universityName: uni })) };
    }));
  }

  // ── Validators ──
  function validateS1(): boolean {
    const e: Record<string, string> = {};
    if (!venueId) e.venueId = 'Select a venue.';
    if (!sport.trim()) e.sport = 'Specify the sport.';
    if (!teamCount || teamCountNum < 1 || teamCountNum > MAX_TEAMS || !Number.isInteger(Number(teamCount))) {
      e.teamCount = `Enter a whole number of teams between 1 and ${MAX_TEAMS}.`;
    }
    setS1Err(e);
    return Object.keys(e).length === 0;
  }

  function validateS2(): boolean {
    const e: Record<string, string> = {};
    const seen = new Map<string, number>();
    teams.forEach((t, ti) => {
      const name = t.teamName.trim();
      if (!name) e[`t${ti}.name`] = 'Team name is required.';
      else {
        const key = name.replace(/\s+/g, '').toLowerCase();
        if (seen.has(key)) e[`t${ti}.name`] = `Same name as Team ${seen.get(key)! + 1} — team names must be different.`;
        else seen.set(key, ti);
      }
      t.members.forEach((m, mi) => {
        if (m.fullName.trim().length < 2) e[`t${ti}.m${mi}.fullName`] = 'Name required.';
        if (m.universityName.trim().length < 2) e[`t${ti}.m${mi}.universityName`] = 'University required.';
        if (!m.universityId.trim()) e[`t${ti}.m${mi}.universityId`] = 'ID required.';
      });
    });
    setS2Err(e);
    return Object.keys(e).length === 0;
  }

  function validateS3(): boolean {
    const today = new Date().toISOString().slice(0, 10);
    const errs: Record<number, string> = {};
    for (const row of sessions) {
      if (!row.date) { errs[row.sessionNo] = 'Pick a date.'; continue; }
      if (row.date < today) { errs[row.sessionNo] = `${row.date} is in the past. Select a future date.`; continue; }
      const dow = new Date(row.date + 'T12:00:00').getDay();
      if (dow === 0 || dow === 6) { errs[row.sessionNo] = `${DAYS[dow]}s are not permitted. Bookings must be on weekdays (Mon–Fri).`; continue; }
      if (row.endTime <= row.startTime) { errs[row.sessionNo] = 'End time must be after start time.'; continue; }
      if (row.startTime < '09:00' || row.endTime > '18:00') { errs[row.sessionNo] = 'Outside venue hours — sessions must be between 9:00 am and 6:00 pm.'; continue; }
      if (new Date(`${row.date}T${row.startTime}:00`).getTime() <= Date.now()) { errs[row.sessionNo] = 'This start time has already passed. Choose a later time or date.'; continue; }
      const dup = sessions.some((s) => s.date === row.date && s.sessionNo !== row.sessionNo);
      if (dup) { errs[row.sessionNo] = `Duplicate date — another session in this request is already on ${row.date}.`; continue; }
      const reqStart = new Date(`${row.date}T${row.startTime}:00`);
      const reqEnd = new Date(`${row.date}T${row.endTime}:00`);
      const clash = approvedSessions.find((s) => reqStart < new Date(s.ends_at) && reqEnd > new Date(s.starts_at));
      if (clash) {
        const cs = new Date(clash.starts_at).toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' });
        const ce = new Date(clash.ends_at).toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' });
        errs[row.sessionNo] = `Venue already booked on ${row.date} from ${cs}–${ce}. Choose a different time or date.`;
      }
    }
    setSessionErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function nextStep() {
    if (step === 1 && !validateS1()) return;
    if (step === 2 && !validateS2()) return;
    if (step === 3 && !validateS3()) return;
    setStep((s) => Math.min(s + 1, TOTAL));
  }

  async function submit() {
    if (!validateS2()) { setStep(2); return; }
    if (!validateS3()) { setStep(3); return; }
    setBusy(true);
    try {
      const cleanTeams: ExternalTeam[] = teams.map((t) => ({
        teamName: t.teamName.trim(),
        members: t.members.map((m) => ({ fullName: m.fullName.trim(), universityName: m.universityName.trim(), universityId: m.universityId.trim() })),
      }));
      await submitBooking({
        venueId,
        estimatedParticipants: totalMembers,
        sessions: toSessionInputs(),
        metadata: {
          bookingType: 'EXTERNAL_EVENT',
          sport: sport.trim(),
          numberOfTeams: cleanTeams.length,
          teams: cleanTeams,
          specialRequirements: specialRequirements.trim() || undefined,
        },
      });
      onDone('Booking request submitted to the Coordinator. You will be notified once the Super Admin approves (with your schedule) or rejects it (with the reason).');
    } catch (e) { onError(errMsg(e)); }
    finally { setBusy(false); }
  }

  const fi = (hasErr: boolean): React.CSSProperties => ({
    ...inp, ...(hasErr ? { borderColor: '#B3352B', background: '#FDECEC' } : {}),
  });

  const STEP_LABELS = ['Venue & Sport', 'Teams & Members', 'Date & Time', 'Review'];
  const fmtSessionDuration = (start: string, end: string) => {
    const [sh, sm] = start.split(':').map(Number); const [eh, em] = end.split(':').map(Number);
    const mins = ((eh ?? 0) * 60 + (em ?? 0)) - ((sh ?? 0) * 60 + (sm ?? 0));
    if (!(mins > 0)) return '';
    const h = Math.floor(mins / 60); const m = mins % 60;
    return `${h ? `${h} h` : ''}${h && m ? ' ' : ''}${m ? `${m} min` : ''}`;
  };

  return (
    <Panel title="New Booking Request">
      {/* Progress bar */}
      <div style={progressBar}>
        {STEP_LABELS.map((label, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 5, flex: i < TOTAL - 1 ? 1 : 0 }}>
            <div style={{
              width: 26, height: 26, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
              font: '600 12px Inter, sans-serif', flexShrink: 0,
              background: step > i + 1 ? '#1F7A45' : step === i + 1 ? '#1C398E' : '#CAD5E2',
              color: step >= i + 1 ? '#fff' : '#62748E',
            }}>
              {step > i + 1 ? '✓' : i + 1}
            </div>
            <span style={{ fontSize: 11, color: step === i + 1 ? '#1C398E' : '#62748E', fontWeight: step === i + 1 ? 600 : 400, whiteSpace: 'nowrap' }}>{label}</span>
            {i < TOTAL - 1 && <div style={{ flex: 1, height: 2, background: step > i + 1 ? '#1F7A45' : '#CAD5E2', margin: '0 3px' }} />}
          </div>
        ))}
      </div>

      {/* ── STEP 1: Venue & Sport ── */}
      {step === 1 && (
        <div style={stepBody}>
          <h3 style={stepTitle}>Step 1 — Venue &amp; Sport</h3>
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
            <L label="Number of teams *">
              <input type="number" min={1} max={MAX_TEAMS} style={fi(!!s1Err.teamCount)} value={teamCount}
                onChange={(e) => { setTeamCount(e.target.value); setS1Err((p) => ({ ...p, teamCount: '' })); }} placeholder="e.g. 2" />
              {s1Err.teamCount && <span style={ferr}>{s1Err.teamCount}</span>}
              {teamCountNum > 0 && teamCountNum <= MAX_TEAMS && <span style={{ fontSize: 11, color: '#62748E' }}>You'll enter {teamCountNum} team{teamCountNum === 1 ? '' : 's'} and their members in Step 2</span>}
            </L>
            {selectedVenue && (
              <div style={{ gridColumn: '1 / -1', ...venueInfo }}>
                <strong>{selectedVenue.name}</strong>{selectedVenue.location && <> · {selectedVenue.location}</>} · Cap. {selectedVenue.capacity} · {selectedVenue.is_indoor ? 'Indoor' : 'Outdoor'}{selectedVenue.surface_type && <> · {selectedVenue.surface_type}</>}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── STEP 2: Teams & Members ── */}
      {step === 2 && (
        <div style={stepBody}>
          <h3 style={stepTitle}>Step 2 — Teams &amp; Members</h3>
          <p style={{ margin: '-8px 0 16px', fontSize: 13.5, color: '#62748E' }}>
            For every member give their name, university and university ID. Enter the ID exactly as it appears on their university card — any format is accepted.
          </p>
          {teams.map((t, ti) => (
            <div key={ti} style={teamCard}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: 12 }}>
                <span style={teamBadge}>Team {ti + 1}</span>
                <div style={{ flex: 1, minWidth: 220 }}>
                  <input style={fi(!!s2Err[`t${ti}.name`])} value={t.teamName} maxLength={120}
                    onChange={(e) => { updateTeam(ti, { teamName: e.target.value }); setS2Err((p) => ({ ...p, [`t${ti}.name`]: '' })); }}
                    placeholder="Team name *" aria-label={`Team ${ti + 1} name`} />
                  {s2Err[`t${ti}.name`] && <span style={ferr}>{s2Err[`t${ti}.name`]}</span>}
                </div>
                <span style={{ fontSize: 12.5, color: '#62748E', paddingTop: 10 }}>{t.members.length} member{t.members.length === 1 ? '' : 's'}</span>
              </div>

              <div className="mbk-member-head" style={memberHead}>
                <span style={{ width: 24 }} />
                <span style={{ flex: 2 }}>Full name *</span>
                <span style={{ flex: 2 }}>University name *</span>
                <span style={{ flex: 1.4 }}>University ID *</span>
                <span style={{ width: 30 }} />
              </div>
              <div style={{ display: 'grid', gap: 6 }}>
                {t.members.map((m, mi) => {
                  const k = `t${ti}.m${mi}`;
                  const rowErr = s2Err[`${k}.fullName`] || s2Err[`${k}.universityName`] || s2Err[`${k}.universityId`];
                  return (
                    <div key={mi}>
                      <div className="mbk-member-row" style={memberRow}>
                        <span style={{ fontSize: 12, color: '#62748E', width: 24, flexShrink: 0 }}>#{mi + 1}</span>
                        <input style={{ ...fi(!!s2Err[`${k}.fullName`]), flex: 2 }} placeholder="Full name" value={m.fullName} maxLength={100}
                          onChange={(e) => { updateMember(ti, mi, { fullName: e.target.value }); setS2Err((p) => ({ ...p, [`${k}.fullName`]: '' })); }} />
                        <input style={{ ...fi(!!s2Err[`${k}.universityName`]), flex: 2 }} placeholder="University name" value={m.universityName} maxLength={150}
                          onChange={(e) => { updateMember(ti, mi, { universityName: e.target.value }); setS2Err((p) => ({ ...p, [`${k}.universityName`]: '' })); }} />
                        <input style={{ ...fi(!!s2Err[`${k}.universityId`]), flex: 1.4 }} placeholder="University ID" value={m.universityId} maxLength={50}
                          onChange={(e) => { updateMember(ti, mi, { universityId: e.target.value }); setS2Err((p) => ({ ...p, [`${k}.universityId`]: '' })); }} />
                        <button type="button" style={{ ...iconBtn, visibility: t.members.length > 1 ? 'visible' : 'hidden' }}
                          onClick={() => removeMember(ti, mi)} aria-label={`Remove member ${mi + 1}`} title="Remove member">×</button>
                      </div>
                      {rowErr && <span style={{ ...ferr, marginLeft: 32 }}>{rowErr}</span>}
                    </div>
                  );
                })}
              </div>
              <div style={{ display: 'flex', gap: 16, marginTop: 10, flexWrap: 'wrap' }}>
                {t.members.length < MAX_MEMBERS && (
                  <button type="button" style={linkBtn} onClick={() => addMember(ti)}>+ Add member</button>
                )}
                {t.members.length > 1 && t.members[0]?.universityName.trim() && (
                  <button type="button" style={linkBtn} onClick={() => copyUniversityToAll(ti)}>Use member #1's university for everyone</button>
                )}
              </div>
            </div>
          ))}
          <div style={{ fontSize: 13, color: '#62748E', marginTop: 4 }}>Total participants: <strong style={{ color: '#0F172B' }}>{totalMembers}</strong></div>
          {belowThreshold && (
            <div style={{ ...warnBox, marginTop: 10 }}>
              ⚠ {selectedVenue?.is_indoor ? 'Indoor' : 'Outdoor'} venues normally need {threshold}+ participants. You can still submit — the Coordinator will take this into account.
            </div>
          )}
        </div>
      )}

      {/* ── STEP 3: Date & Time ── */}
      {step === 3 && (
        <div style={stepBody}>
          <h3 style={stepTitle}>Step 3 — Date &amp; Time</h3>
          {calendarLoading && <div style={{ ...infoBox, marginBottom: 14 }}>Checking venue availability…</div>}
          <div style={{ ...venueInfo, marginBottom: 14 }}>
            <strong>Date rules:</strong> Weekdays only (Mon–Fri) · Between 9:00 am and 6:00 pm · Future dates only · One session per date · No overlap with approved bookings or a time already held by a pending request at this venue
          </div>
          <p style={{ margin: '-4px 0 14px', fontSize: 13.5, color: '#62748E' }}>Pick the date, start time and end time. Need the venue on more than one day? Add a session for each day.</p>
          <SessionRowsEditor rows={sessions} onAdd={addRow} onRemove={removeRow} onUpdate={updateRow} errors={sessionErrors} allowMultiple minDate={new Date().toISOString().slice(0, 10)} minTime="09:00" maxTime="18:00" />
          <div style={{ marginTop: 20 }}>
            <L label="Special requirements / notes (optional)">
              <textarea style={{ ...inp, minHeight: 72, resize: 'vertical', width: '100%', boxSizing: 'border-box' }} value={specialRequirements} onChange={(e) => setSpecialReq(e.target.value)} placeholder="e.g. Spectator seating for 50, referee required…" maxLength={500} />
              <span style={{ fontSize: 11, color: '#62748E' }}>{specialRequirements.length}/500</span>
            </L>
          </div>
        </div>
      )}

      {/* ── STEP 4: Review ── */}
      {step === 4 && (
        <div style={stepBody}>
          <h3 style={stepTitle}>Step 4 — Review Your Request</h3>
          <p style={{ margin: '-8px 0 18px', fontSize: 13.5, color: '#62748E' }}>Check everything below. You can't edit the request after submitting.</p>

          <RevSec title="Venue & Sport">
            <RevRow label="Venue" value={`${selectedVenue?.name ?? '—'}${selectedVenue?.location ? ` · ${selectedVenue.location}` : ''}`} />
            <RevRow label="Sport" value={sport} />
            <RevRow label="Number of teams" value={String(teams.length)} />
            <RevRow label="Total participants" value={String(totalMembers)} />
          </RevSec>

          {teams.map((t, ti) => (
            <RevSec key={ti} title={`Team ${ti + 1} — ${t.teamName} (${t.members.length})`}>
              {t.members.map((m, mi) => (
                <RevRow key={mi} label={`#${mi + 1} ${m.fullName}`} value={`${m.universityName} · ID ${m.universityId}`} />
              ))}
            </RevSec>
          ))}

          <RevSec title={`Date & Time (${sessions.length} session${sessions.length === 1 ? '' : 's'})`}>
            {sessions.map((s) => (
              <RevRow key={s.sessionNo} label={`Session ${s.sessionNo}`}
                value={`${s.date} (${DAYS[new Date(s.date + 'T12:00:00').getDay()]}) · ${s.startTime}–${s.endTime}${fmtSessionDuration(s.startTime, s.endTime) ? ` · ${fmtSessionDuration(s.startTime, s.endTime)}` : ''}`} />
            ))}
          </RevSec>

          {specialRequirements && (
            <RevSec title="Special Requirements">
              <div style={{ padding: '6px 14px', fontSize: 13.5, color: '#0F172B', lineHeight: 1.5 }}>{specialRequirements}</div>
            </RevSec>
          )}

          <div style={{ marginTop: 16, padding: '12px 14px', background: '#1C398E14', borderRadius: 6, fontSize: 13, color: '#62748E', lineHeight: 1.6 }}>
            <strong style={{ color: '#1C398E' }}>What happens next:</strong> the Coordinator reviews your request and checks for clashes, then forwards it to the Super Admin.
            If it's approved you'll be notified with your confirmed schedule; if it's rejected you'll be notified with the reason.
          </div>
        </div>
      )}

      {/* Navigation */}
      <div style={footer}>
        <div style={{ display: 'flex', gap: 10 }}>
          {step > 1 && <button type="button" style={ghostBtn} onClick={() => setStep((s) => s - 1)}>← Back</button>}
          {step < TOTAL && <button type="button" style={primaryBtn} onClick={nextStep}>Continue →</button>}
          {step === TOTAL && <button type="button" style={submitBtn} disabled={busy} onClick={submit}>{busy ? 'Submitting…' : 'Submit to Coordinator'}</button>}
        </div>
        <button type="button" style={{ ...ghostBtn, color: '#B3352B', borderColor: '#B3352B' }} onClick={onCancel}>Cancel</button>
      </div>
    </Panel>
  );
}

// ── Approved booking: confirmed schedule (expands under the row) ──
function ScheduleRow({ bookingId }: { bookingId: string }) {
  const [detail, setDetail] = useState<BookingDetailFull | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    getBookingFull(bookingId).then(setDetail).catch((e) => setErr(errMsg(e)));
  }, [bookingId]);
  if (err) return <div style={{ ...box.err, margin: 0 }}>{err}</div>;
  if (!detail) return <p style={muted}>Loading schedule…</p>;
  const meta = detail.booking_metadata as { sport?: string; teams?: ExternalTeam[] } | null;
  return (
    <div style={{ padding: '4px 0 8px' }}>
      <div style={{ font: '600 12px Inter, sans-serif', color: '#1F7A45', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>Confirmed schedule</div>
      <div style={{ fontSize: 13.5, color: '#0F172B', marginBottom: 6 }}>
        {detail.venue_name}{meta?.sport ? ` · ${meta.sport}` : ''}{meta?.teams?.length ? ` · ${meta.teams.map((t) => t.teamName).join(' vs ')}` : ''}
      </div>
      {detail.sessions.map((s) => (
        <div key={s.request_session_id} style={{ fontSize: 13.5, color: '#0F172B', padding: '3px 0' }}>
          Session {s.session_no}: {new Date(s.requested_start_at).toLocaleDateString('en-PK', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
          {' · '}{new Date(s.requested_start_at).toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' })}–{new Date(s.requested_end_at).toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' })}
        </div>
      ))}
    </div>
  );
}

// ── Small reusable components ──
function SecHead({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{ font: '600 12px Inter, sans-serif', color: '#1C398E', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '18px 0 10px', paddingBottom: 6, borderBottom: '2px solid #E2E8F0', ...style }}>{children}</div>;
}
function RevSec({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12, border: '1px solid #CAD5E2', borderRadius: 6, overflow: 'hidden' }}>
      <div style={{ padding: '7px 14px', background: '#F8FAFC', borderBottom: '1px solid #CAD5E2', font: '600 11px Inter, sans-serif', color: '#1C398E', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{title}</div>
      <div style={{ padding: '2px 0' }}>{children}</div>
    </div>
  );
}
function RevRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', padding: '5px 14px', borderBottom: '1px solid #F8FAFC', fontSize: 13.5 }}>
      <span style={{ color: '#62748E', fontWeight: 600 }}>{label}</span>
      <span style={{ color: '#0F172B' }}>{value}</span>
    </div>
  );
}
function StatusBadge({ status }: { status: string }) {
  const s = ['APPROVED', 'COMPLETED'].includes(status) ? { background: '#E6F4EC', color: '#1F7A45' }
    : ['REJECTED', 'CANCELLED'].includes(status) ? { background: '#FDECEC', color: '#B3352B' }
    : status === 'SENT_BACK' ? { background: '#FDF1E3', color: '#9A6412' }
    : status === 'EXPIRED' ? { background: '#E2E8F0', color: '#62748E' }
    : { background: '#1C398E14', color: '#1C398E' };
  const label = status === 'SHORTFALL_PENDING' ? 'Awaiting your response'
    : status === 'SENT_BACK' ? 'Returned'
    : status === 'PENDING' ? 'With Coordinator'
    : status === 'FORWARDED' ? 'With Super Admin'
    : status === 'EXPIRED' ? 'Expired'
    : status;
  return <span style={{ font: '600 11px "JetBrains Mono", ui-monospace, monospace', padding: '2px 8px', borderRadius: 4, ...s }}>{label}</span>;
}
function SentBackReviewModal({ booking, onDone, onError, onClose }: {
  booking: MyBooking;
  onDone: (m: string) => void;
  onError: (m: string) => void;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<import('./api.js').BookingDetailFull | null>(null);
  const [busy, setBusy] = useState(false);
  const [declining, setDeclining] = useState(false);

  useEffect(() => {
    getBookingFull(booking.booking_id).then(setDetail).catch(() => onError('Could not load booking detail.'));
  }, [booking.booking_id]); // eslint-disable-line

  async function accept() {
    setBusy(true);
    try { await acceptSentBack(booking.booking_id); onDone('Booking resubmitted — back in the Coordinator\'s queue.'); onClose(); }
    catch (e) { onError(errMsg(e)); } finally { setBusy(false); }
  }
  async function decline() {
    setBusy(true);
    try { await declineSentBack(booking.booking_id); onDone('Booking declined and closed.'); onClose(); }
    catch (e) { onError(errMsg(e)); } finally { setBusy(false); }
  }

  const proposed = detail?.coordinator_proposed_sessions;
  const note = detail?.sent_back_note;
  const coordEquip = detail?.coordinator_equipment ?? [];
  const studentEquip = (detail?.booking_metadata?.equipmentItems as Array<{ name: string; equipmentTypeId: number; quantity: number }> | undefined) ?? [];
  const equipSupport = detail?.booking_metadata?.equipmentSupport as string | undefined;
  const hasEquipInfo = equipSupport === 'UNIVERSITY' && coordEquip.length > 0;
  const equipShortfalls = coordEquip.filter((ce) => {
    const se = studentEquip.find((e) => e.equipmentTypeId === ce.equipment_type_id);
    return se && ce.quantity < se.quantity;
  });

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(3,22,54,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
      onClick={onClose}>
      <div style={{ background: '#fff', borderRadius: 16, padding: '28px 32px', maxWidth: 560, width: '94%', boxShadow: '0 24px 60px -20px rgba(3,22,54,0.6)', maxHeight: '90vh', overflowY: 'auto' }}
        onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 19, color: '#1C398E' }}>Coordinator's Response</h2>
            <div style={{ fontSize: 13, color: '#62748E', marginTop: 3 }}>
              {booking.venue_name} · {booking.purpose}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#62748E', lineHeight: 1 }}>×</button>
        </div>

        {!detail ? (
          <p style={{ color: '#62748E', fontSize: 14 }}>Loading…</p>
        ) : (
          <>
            {/* Coordinator's note */}
            {note && (
              <div style={{ background: '#FDF1E3', border: '1px solid #F0C060', borderRadius: 8, padding: '14px 16px', marginBottom: 16 }}>
                <div style={{ font: '600 12px Inter, sans-serif', color: '#9A6412', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>
                  Coordinator's Note
                </div>
                <p style={{ margin: 0, fontSize: 14.5, color: '#9A6412', lineHeight: 1.6 }}>{note}</p>
              </div>
            )}

            {/* Proposed schedule */}
            {proposed && proposed.length > 0 && (
              <div style={{ background: '#E3F2FF', border: '1px solid #90CAF9', borderRadius: 8, padding: '14px 16px', marginBottom: 16 }}>
                <div style={{ font: '600 12px Inter, sans-serif', color: '#1565C0', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 10 }}>
                  📅 Proposed Alternative Schedule
                </div>
                {proposed.map((s) => (
                  <div key={s.sessionNo} style={{ display: 'grid', gridTemplateColumns: '70px 1fr', gap: 8, marginBottom: 6, fontSize: 14 }}>
                    <span style={{ font: '600 12px "JetBrains Mono", ui-monospace, monospace', color: '#1565C0' }}>Session {s.sessionNo}</span>
                    <span style={{ color: '#1565C0' }}>
                      {new Date(s.startAt).toLocaleDateString('en-PK', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                      {' · '}
                      {new Date(s.startAt).toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' })}
                      {' – '}
                      {new Date(s.endAt).toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                ))}
                <p style={{ margin: '10px 0 0', fontSize: 13, color: '#1565C0' }}>
                  If you accept, your booking will be resubmitted with this schedule.
                </p>
              </div>
            )}

            {/* Original sessions if no proposed */}
            {(!proposed || proposed.length === 0) && detail.sessions.length > 0 && (
              <div style={{ background: '#F8FAFC', border: '1px solid #CAD5E2', borderRadius: 8, padding: '12px 16px', marginBottom: 16 }}>
                <div style={{ font: '600 12px Inter, sans-serif', color: '#1C398E', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>
                  Original Sessions (unchanged)
                </div>
                {detail.sessions.map((s) => (
                  <div key={s.request_session_id} style={{ fontSize: 14, color: '#0F172B', marginBottom: 4 }}>
                    Session {s.session_no}: {new Date(s.requested_start_at).toLocaleDateString('en-PK', { weekday: 'short', day: 'numeric', month: 'short' })}
                    {' · '}{new Date(s.requested_start_at).toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' })}
                    {' – '}{new Date(s.requested_end_at).toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' })}
                  </div>
                ))}
              </div>
            )}

            {/* Equipment allocation info */}
            {hasEquipInfo && (
              <div style={{ background: '#F8FAFC', border: '1px solid #CAD5E2', borderRadius: 8, padding: '14px 16px', marginBottom: 16 }}>
                <div style={{ font: '600 12px Inter, sans-serif', color: '#1C398E', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 10 }}>
                  📦 Equipment Allocation
                </div>
                {coordEquip.map((ce) => {
                  const se = studentEquip.find((e) => e.equipmentTypeId === ce.equipment_type_id);
                  const short = se && ce.quantity < se.quantity;
                  return (
                    <div key={ce.equipment_type_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderBottom: '1px solid #E2E8F0', fontSize: 14 }}>
                      <span style={{ color: '#0F172B' }}>{ce.name}</span>
                      <span>
                        <span style={{ fontWeight: 600, color: short ? '#B3352B' : '#1F7A45' }}>×{ce.quantity}</span>
                        {short && se && <span style={{ fontSize: 12, color: '#B3352B', marginLeft: 6 }}>(you requested {se.quantity})</span>}
                      </span>
                    </div>
                  );
                })}
                {equipShortfalls.length > 0 && (
                  <div style={{ marginTop: 10, padding: '8px 10px', background: '#FDECEC', border: '1px solid #F3CACA', borderRadius: 6, fontSize: 13, color: '#8F2323' }}>
                    ⚠ The university can provide less equipment than requested for {equipShortfalls.length} item{equipShortfalls.length > 1 ? 's' : ''}.
                    Review the coordinator's note for details and decide whether to accept or decline.
                  </div>
                )}
              </div>
            )}

            {/* Decision */}
            <div style={{ paddingTop: 16, borderTop: '1px solid #E2E8F0' }}>
              <p style={{ margin: '0 0 14px', fontSize: 14, color: '#62748E' }}>
                {proposed && proposed.length > 0
                  ? 'Accept the proposed schedule and resubmit, or decline to cancel this booking.'
                  : 'Accept and resubmit your booking, or decline to cancel it.'}
              </p>
              {!declining ? (
                <div style={{ display: 'flex', gap: 10 }}>
                  <button style={smaccept2} disabled={busy} onClick={accept}>
                    {busy ? 'Submitting…' : '✓ Accept & Resubmit'}
                  </button>
                  <button style={smdanger2} onClick={() => setDeclining(true)}>Decline & Cancel</button>
                  <button style={smghost2} onClick={onClose}>Close</button>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <span style={{ fontSize: 14, color: '#8F2323', fontWeight: 600 }}>Cancel this booking permanently?</span>
                  <button style={smdanger2} disabled={busy} onClick={decline}>{busy ? '…' : 'Yes, cancel'}</button>
                  <button style={smghost2} onClick={() => setDeclining(false)}>No, go back</button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
function SentBackActions({ booking, onDone, onError }: { booking: MyBooking; onDone: (m: string) => void; onError: (m: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [showDecline, setShowDecline] = useState(false);
  useBackStep(showDecline, () => setShowDecline(false));
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
      <span style={{ fontSize: 12.5, color: '#62748E' }}>Confirm decline?</span>
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

// Shell-level styles (page/header/glass/footer — same tokens as Accounts,
// Usage History, Offline Fallback, Conflict Detection, Venue Calendar, and
// Kit Borrow). This is the one piece that was missing from the re-theme —
// every other style in this file already uses these exact palette values.
const s = {
  page: {
    minHeight: '100%', display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden',
    background: `radial-gradient(1100px 700px at 15% 0%, ${palette.navy800}aa 0%, transparent 60%),
                 radial-gradient(900px 600px at 100% 100%, ${palette.accent}22 0%, transparent 55%),
                 ${palette.navy900}`,
  } as const,
  blobA: { position: 'absolute', width: 420, height: 420, borderRadius: '50%', background: `${palette.accent}1a`, top: -160, left: -140, filter: 'blur(30px)', pointerEvents: 'none' } as const,
  blobB: { position: 'absolute', width: 380, height: 380, borderRadius: '50%', background: `${palette.slate600}22`, bottom: -160, right: -120, filter: 'blur(30px)', pointerEvents: 'none' } as const,

  topbar: { position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 32px', flexWrap: 'wrap', gap: 12 } as const,
  brand: { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' } as const,
  logoImg: { width: 40, height: 40, borderRadius: 10, objectFit: 'contain', background: palette.slate50, padding: 4, border: `1px solid ${palette.slate300}` } as const,
  wordmark: { fontSize: 16, fontWeight: 700, color: palette.white, lineHeight: 1.2 } as const,
  wordmarkSub: { fontSize: 12, color: palette.slate400, marginTop: 1 } as const,
  topbarRight: { display: 'flex', gap: 10 } as const,
  topBtn: {
    display: 'inline-flex', alignItems: 'center', gap: 7, background: 'transparent', color: palette.slate100,
    border: `1.5px solid ${palette.slate400}`, borderRadius: 999, padding: '9px 16px', fontSize: 13.5, fontWeight: 700,
    cursor: 'pointer', fontFamily: 'inherit',
  } as const,

  main: { position: 'relative', zIndex: 1, flex: 1, padding: '20px 24px 56px', width: '100%', maxWidth: 1040, margin: '0 auto', boxSizing: 'border-box' } as const,
  glassPanel: {
    position: 'relative', background: 'rgba(255,255,255,0.07)',
    backdropFilter: 'blur(22px) saturate(160%)', WebkitBackdropFilter: 'blur(22px) saturate(160%)',
    border: '1px solid rgba(255,255,255,0.16)', borderRadius: 24,
    padding: '28px 24px 32px',
    boxShadow: '0 24px 60px -32px rgba(3,22,54,0.75), inset 0 1px 0 rgba(255,255,255,0.10)',
  } as const,

  headRow: { marginBottom: 20 } as const,
  eyebrow: {
    display: 'inline-block', fontSize: 11.5, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase',
    padding: '6px 14px', borderRadius: 999, marginBottom: 10,
    color: palette.slate100, background: `${palette.navy800}88`, border: `1px solid ${palette.slate400}55`,
  } as const,
  title: { fontSize: 28, fontWeight: 800, color: palette.white, margin: 0, letterSpacing: '-0.5px' } as const,
  subtitle: { fontSize: 14, color: palette.slate300, margin: '6px 0 0', maxWidth: 560, lineHeight: 1.5 } as const,

  footer: { position: 'relative', zIndex: 1, textAlign: 'center', padding: '20px 24px', fontSize: 12.5, color: palette.slate400, borderTop: `1px solid ${palette.slate600}55` } as const,
  footerLink: { color: palette.accentSoft, textDecoration: 'none', fontWeight: 600 } as const,
};
const panel: React.CSSProperties = { background: '#fff', border: '1px solid #CAD5E2', borderRadius: 8, marginBottom: 18, boxShadow: '0 1px 3px rgba(0,0,0,0.07)' };
const panelHead: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 20px', borderBottom: '1px solid #CAD5E2', font: '600 16px Inter, sans-serif', color: '#1C398E', background: 'linear-gradient(#fff,#F8FAFC)', borderRadius: '8px 8px 0 0' };
const panelBody: React.CSSProperties = { padding: '20px 24px' };
const tbl: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 14 };
const th: React.CSSProperties = { textAlign: 'left', font: '600 11px Inter, sans-serif', color: '#62748E', textTransform: 'uppercase', letterSpacing: '0.04em', padding: '0 8px 10px', borderBottom: '1px solid #CAD5E2' };
const td: React.CSSProperties = { padding: '11px 8px', borderBottom: '1px solid #E2E8F0', color: '#0F172B', verticalAlign: 'top' };
const lbl: React.CSSProperties = { display: 'block', font: '500 12px Inter, sans-serif', color: '#1C398E', marginBottom: 5, marginTop: 2 };
const inp: React.CSSProperties = { width: '100%', font: '14px Inter, sans-serif', padding: '9px 11px', border: '1px solid #CAD5E2', borderRadius: 6, boxSizing: 'border-box' };
const fgrid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 };
const ferr: React.CSSProperties = { display: 'block', fontSize: 12, color: '#B3352B', marginTop: 4 };
const warnBox: React.CSSProperties = { padding: '8px 12px', background: '#FDF1E3', border: '1px solid #F0C060', borderRadius: 6, fontSize: 12.5, color: '#9A6412', lineHeight: 1.5 };
const infoBox: React.CSSProperties = { padding: '10px 14px', background: '#E3F2FF', border: '1px solid #90CAF9', borderRadius: 6, fontSize: 13.5, color: '#1565C0', marginBottom: 18 };
const venueInfo: React.CSSProperties = { padding: '10px 14px', background: '#1C398E14', borderRadius: 6, fontSize: 13, color: '#1C398E' };
const muted: React.CSSProperties = { color: '#62748E', fontSize: 14, margin: '8px 0' };
const primaryBtn: React.CSSProperties = { background: '#1C398E', color: '#fff', border: 'none', borderRadius: 6, padding: '9px 20px', fontSize: 14, cursor: 'pointer', fontWeight: 600 };
const submitBtn: React.CSSProperties = { background: '#1F7A45', color: '#fff', border: 'none', borderRadius: 6, padding: '10px 24px', fontSize: 15, cursor: 'pointer', fontWeight: 700 };
const ghostBtn: React.CSSProperties = { background: '#fff', color: '#62748E', border: '1px solid #CAD5E2', borderRadius: 6, padding: '9px 18px', fontSize: 14, cursor: 'pointer' };
const smaccept: React.CSSProperties = { background: '#1F7A45', color: '#fff', border: 'none', borderRadius: 4, padding: '5px 10px', fontSize: 12.5, cursor: 'pointer' };
const smdanger: React.CSSProperties = { background: '#B3352B', color: '#fff', border: 'none', borderRadius: 4, padding: '5px 10px', fontSize: 12.5, cursor: 'pointer' };
const smghost: React.CSSProperties = { background: '#fff', color: '#62748E', border: '1px solid #CAD5E2', borderRadius: 4, padding: '5px 10px', fontSize: 12.5, cursor: 'pointer' };
const progressBar: React.CSSProperties = { display: 'flex', alignItems: 'center', marginBottom: 28 };
const stepBody: React.CSSProperties = { paddingBottom: 8 };
const stepTitle: React.CSSProperties = { margin: '0 0 18px', font: '700 18px Inter, sans-serif', color: '#1C398E' };
const footer: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 20, marginTop: 20, borderTop: '1px solid #CAD5E2' };
const typeCard: React.CSSProperties = { background: '#F8FAFC', border: '2px solid #CAD5E2', borderRadius: 10, padding: '16px 18px', cursor: 'pointer', textAlign: 'center' };
const typeCardActive: React.CSSProperties = { borderColor: '#1C398E', background: '#1C398E14' };
const emptyState: React.CSSProperties = { textAlign: 'center', padding: '40px 24px' };
const qtyBtn: React.CSSProperties = { width: 30, height: 30, borderRadius: 6, border: '1px solid #CAD5E2', background: '#fff', cursor: 'pointer', font: '600 16px Inter, sans-serif', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#1C398E' };
const box = {
  err: { background: '#FDECEC', color: '#8F2323', border: '1px solid #F3CACA', borderRadius: 6, padding: '10px 14px', marginBottom: 16, fontSize: 14 } as React.CSSProperties,
  ok: { background: '#E6F4EC', color: '#1F7A45', border: '1px solid #1F7A4555', borderRadius: 6, padding: '10px 14px', marginBottom: 16, fontSize: 14 } as React.CSSProperties,
};
const smaccept2: React.CSSProperties = { background: '#1F7A45', color: '#fff', border: 'none', borderRadius: 6, padding: '9px 18px', fontSize: 14, cursor: 'pointer', fontWeight: 600 };
const smdanger2: React.CSSProperties = { background: '#B3352B', color: '#fff', border: 'none', borderRadius: 6, padding: '9px 18px', fontSize: 14, cursor: 'pointer' };
const smghost2: React.CSSProperties = { background: '#fff', color: '#62748E', border: '1px solid #CAD5E2', borderRadius: 6, padding: '9px 18px', fontSize: 14, cursor: 'pointer' };
const teamCard: React.CSSProperties = { border: '1px solid #CAD5E2', borderRadius: 10, padding: '14px 16px', marginBottom: 14, background: '#FBFCFE' };
const teamBadge: React.CSSProperties = { font: '700 12px Inter, sans-serif', color: '#fff', background: '#1C398E', borderRadius: 999, padding: '5px 12px', marginTop: 6, whiteSpace: 'nowrap' };
const memberHead: React.CSSProperties = { display: 'flex', gap: 8, padding: '0 10px 6px', font: '600 11px Inter, sans-serif', color: '#62748E', textTransform: 'uppercase', letterSpacing: '0.04em' };
const memberRow: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, background: '#F8FAFC', padding: '7px 10px', borderRadius: 6, border: '1px solid #CAD5E2' };
const iconBtn: React.CSSProperties = { width: 30, height: 30, flexShrink: 0, borderRadius: 6, border: '1px solid #CAD5E2', background: '#fff', color: '#B3352B', cursor: 'pointer', font: '600 16px Inter, sans-serif', lineHeight: 1 };
const linkBtn: React.CSSProperties = { background: 'none', border: 'none', padding: 0, color: '#1C398E', font: '600 13px Inter, sans-serif', cursor: 'pointer' };
