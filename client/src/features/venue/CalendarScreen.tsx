/**
 * Calendar (CAL-01..05) — shows only approved, conflict-free sessions.
 * Open to every role; read-only.
 *
 * Redesigned as an interactive weekly schedule (Mon–Sun × time-of-day),
 * styled after the brand palette instead of a plain table. A "List" view
 * toggle preserves the exact original table — same columns (Venue, When,
 * Origin, Status), same unrestricted (all-time) query — so no information
 * from the previous screen is lost, just presented two ways.
 *
 * Frontend-only: uses the same listCalendar/listVenues calls as before
 * (including the already-existing from/to params on listCalendar, used
 * here for week navigation — no backend change). No longer uses
 * PortalShell (still used by Profile/AdminAccounts/AcceptInvite, untouched).
 */
import { useEffect, useState, useCallback, useMemo } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth.js';
import { palette, ROLE_THEME, type PortalKey } from '../auth/AuthUI.js';
import { listCalendar, listVenues, type CalendarSession, type Venue } from './api.js';
import { ApiRequestError } from '../../lib/api.js';

function errMsg(e: unknown) { return e instanceof ApiRequestError ? e.body.error : 'Something went wrong.'; }

const ROLE_PORTAL: Record<string, PortalKey> = {
  STUDENT: 'student', EXTERNAL: 'external', COORDINATOR: 'coordinator', SUPER_ADMIN: 'admin',
};

const ORIGIN_LABEL: Record<string, string> = { CLIENT: 'Client', EXTERNAL: 'External', ACADEMIC: 'Academic' };

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  SCHEDULED: { label: 'Scheduled', color: '#1F7A45', bg: '#E6F4EC' },
  IN_PROGRESS: { label: 'In progress', color: '#9A6412', bg: '#FDF1E3' },
  COMPLETED: { label: 'Completed', color: '#4A5A66', bg: '#ECEFF2' },
  CANCELLED: { label: 'Cancelled', color: '#8F2323', bg: '#FDECEC' },
  NEEDS_RESCHEDULING: { label: 'Needs reschedule', color: '#9A6412', bg: '#FDF1E3' },
};
function statusMeta(s: string) { return STATUS_META[s] ?? { label: s, color: palette.muted, bg: '#EEF2F1' }; }

// On-brand rotating palette for venue color-coding in the grid.
const VENUE_COLORS = ['#498473', '#0B3754', '#2C6E8E', '#4F6B7A', '#33604F', '#1F5673'];
function colorForVenue(venueId: number, order: number[]) {
  const idx = order.indexOf(venueId);
  return VENUE_COLORS[(idx < 0 ? 0 : idx) % VENUE_COLORS.length];
}

/* ---------- date helpers (Mon-start week) ---------- */
function startOfWeek(d: Date) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = x.getDay(); // 0=Sun..6=Sat
  const diff = day === 0 ? -6 : 1 - day;
  x.setDate(x.getDate() + diff);
  return x;
}
function addDays(d: Date, n: number) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
const DAY_SHORT = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
function fmtWeekLabel(weekStart: Date) {
  const end = addDays(weekStart, 6);
  const sameMonth = weekStart.getMonth() === end.getMonth();
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  const startStr = weekStart.toLocaleDateString(undefined, sameMonth ? { day: 'numeric' } : opts);
  const endStr = end.toLocaleDateString(undefined, opts);
  return `${sameMonth ? weekStart.toLocaleDateString(undefined, { month: 'short' }) + ' ' : ''}${startStr} – ${endStr}, ${end.getFullYear()}`;
}
function fmtTime(iso: string) { return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); }
function fmtFullDate(iso: string) { return new Date(iso).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }); }
function hourFloat(d: Date) { return d.getHours() + d.getMinutes() / 60; }
function isSameDate(a: Date, b: Date) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }

const ROW_PX = 60;
const DEFAULT_MIN_HOUR = 8;
const DEFAULT_MAX_HOUR = 20;

export default function CalendarScreen() {
  const { user, loading, logout } = useAuth();
  const navigate = useNavigate();

  const [sessions, setSessions] = useState<CalendarSession[]>([]);
  const [allSessions, setAllSessions] = useState<CalendarSession[]>([]); // for List view — unrestricted, exactly like the original screen
  const [venues, setVenues] = useState<Venue[]>([]);
  const [venueId, setVenueId] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [weekStart, setWeekStart] = useState(startOfWeek(new Date()));
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [selected, setSelected] = useState<CalendarSession | null>(null);

  const weekEnd = addDays(weekStart, 7);

  const load = useCallback(async () => {
    try {
      const filter = venueId ? { venueId } : undefined;
      const [weekRes, allRes, v] = await Promise.all([
        listCalendar({ ...filter, from: weekStart.toISOString(), to: new Date(weekEnd.getTime() - 1).toISOString() }),
        listCalendar(filter),
        listVenues(),
      ]);
      setSessions(weekRes.sessions);
      setAllSessions(allRes.sessions);
      setVenues(v.venues);
    } catch (e) { setError(errMsg(e)); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venueId, weekStart.getTime()]);
  useEffect(() => { void load(); }, [load]);

  const venueOrder = useMemo(() => venues.map((v) => v.venue_id), [venues]);

  const { minHour, maxHour } = useMemo(() => {
    if (sessions.length === 0) return { minHour: DEFAULT_MIN_HOUR, maxHour: DEFAULT_MAX_HOUR };
    let lo = DEFAULT_MIN_HOUR, hi = DEFAULT_MAX_HOUR;
    for (const s of sessions) {
      lo = Math.min(lo, Math.floor(hourFloat(new Date(s.starts_at))));
      hi = Math.max(hi, Math.ceil(hourFloat(new Date(s.ends_at))));
    }
    return { minHour: Math.max(0, lo), maxHour: Math.min(24, hi) };
  }, [sessions]);

  const hours = useMemo(() => {
    const arr: number[] = [];
    for (let h = minHour; h < maxHour; h++) arr.push(h);
    return arr;
  }, [minHour, maxHour]);

  const days = useMemo(() => [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(weekStart, i)), [weekStart]);
  const today = new Date();

  if (loading) {
    return <div className="auth-ui" style={{ minHeight: '100%', background: palette.mint50 }} />;
  }
  if (!user) return <Navigate to="/" replace />;

  const theme = ROLE_THEME[ROLE_PORTAL[user.role] ?? 'admin'];

  return (
    <div className="auth-ui" style={s.page}>
      <CalendarStyles />
      <div style={s.heroBlobA} aria-hidden />
      <div style={s.heroBlobB} aria-hidden />

      <header style={s.topbar}>
        <div style={s.brand}>
          <span style={{ ...s.logoMark, background: theme.solid }}>BU</span>
          <span style={s.wordmark}>Bahria University</span>
        </div>
        <div style={s.topbarRight}>
          <Link to="/home" className="cal-topbtn" style={s.topBtn}><BackIcon /> Back</Link>
          <button type="button" className="cal-topbtn cal-signout" style={s.topBtn} onClick={() => { void logout(); navigate('/'); }}>
            <SignOutIcon /> Sign out
          </button>
        </div>
      </header>

      <main style={s.main}>
        <div style={s.headRow}>
          <div>
            <span style={{ ...s.eyebrow, color: theme.solid, background: theme.soft }}>{ROLE_LABEL(user.role)} Portal</span>
            <h1 style={s.title}>Venue Calendar</h1>
          </div>
        </div>

        {error && <div style={s.errBanner}>{error}</div>}

        <div style={s.controlsRow}>
          <div style={s.controlsLeft}>
            <select style={s.select} value={venueId} onChange={(e) => setVenueId(Number(e.target.value))}>
              <option value={0}>All venues</option>
              {venues.map((v) => <option key={v.venue_id} value={v.venue_id}>{v.name}</option>)}
            </select>

            <div style={s.viewToggle}>
              <button type="button" className="cal-toggle" style={{ ...s.toggleBtn, ...(view === 'grid' ? { background: theme.solid, color: '#fff' } : {}) }} onClick={() => setView('grid')}>
                <GridIcon /> Grid
              </button>
              <button type="button" className="cal-toggle" style={{ ...s.toggleBtn, ...(view === 'list' ? { background: theme.solid, color: '#fff' } : {}) }} onClick={() => setView('list')}>
                <ListIcon /> List
              </button>
            </div>
          </div>

          {view === 'grid' && (
            <div style={s.weekNav}>
              <button type="button" className="cal-navbtn" style={s.navBtn} onClick={() => setWeekStart(addDays(weekStart, -7))} aria-label="Previous week"><ChevronLeftIcon /></button>
              <span style={s.weekLabel}>{fmtWeekLabel(weekStart)}</span>
              <button type="button" className="cal-navbtn" style={s.navBtn} onClick={() => setWeekStart(addDays(weekStart, 7))} aria-label="Next week"><ChevronRightIcon /></button>
              <button type="button" className="cal-todaybtn" style={{ ...s.todayBtn, borderColor: theme.solid, color: theme.solid }} onClick={() => setWeekStart(startOfWeek(new Date()))}>Today</button>
            </div>
          )}
        </div>

        {view === 'grid' ? (
          <>
            <div style={s.gridCard}>
              <div style={s.gridScroll}>
                <div style={{ ...s.gridInner, gridTemplateColumns: `72px repeat(7, minmax(120px, 1fr))` }}>
                  <div style={s.cornerCell} />
                  {days.map((d, i) => {
                    const isToday = isSameDate(d, today);
                    return (
                      <div key={i} style={s.dayHeaderCell}>
                        <div style={{ ...s.dayHeaderBar, background: VENUE_COLORS[i % VENUE_COLORS.length] }} />
                        <span style={s.dayHeaderName}>{DAY_SHORT[i]}</span>
                        <span style={{ ...s.dayHeaderNum, ...(isToday ? { background: theme.solid, color: '#fff' } : {}) }}>{d.getDate()}</span>
                      </div>
                    );
                  })}

                  <div style={s.hourGutter}>
                    {hours.map((h) => (
                      <div key={h} style={{ ...s.hourLabelCell, height: ROW_PX }}>{fmtHour(h)}</div>
                    ))}
                  </div>

                  {days.map((d, dayIdx) => (
                    <div key={dayIdx} style={{ ...s.dayColumn, height: hours.length * ROW_PX }}>
                      {hours.map((h, hi) => <div key={h} style={{ ...s.hourGridLine, top: hi * ROW_PX }} />)}
                      {sessions
                        .filter((sess) => isSameDate(new Date(sess.starts_at), d))
                        .map((sess) => {
                          const start = new Date(sess.starts_at);
                          const end = new Date(sess.ends_at);
                          const top = Math.max(0, (hourFloat(start) - minHour) * ROW_PX);
                          const height = Math.max(26, (hourFloat(end) - hourFloat(start)) * ROW_PX - 3);
                          const color = colorForVenue(sess.venue_id, venueOrder);
                          const meta = statusMeta(sess.status);
                          return (
                            <button
                              key={sess.session_id}
                              type="button"
                              className="cal-event"
                              style={{ ...s.eventBlock, top, height, borderColor: color, background: `${color}22`, borderLeftWidth: 4 }}
                              onClick={() => setSelected(sess)}
                              title={`${sess.venue_name} — ${fmtTime(sess.starts_at)}–${fmtTime(sess.ends_at)}`}
                            >
                              <span style={{ ...s.eventDot, background: meta.color }} />
                              <span style={{ ...s.eventVenue, color }}>{sess.venue_name}</span>
                              <span style={s.eventTime}>{fmtTime(sess.starts_at)}–{fmtTime(sess.ends_at)}</span>
                            </button>
                          );
                        })}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {venues.length > 0 && (
              <div style={s.legend}>
                {(venueId ? venues.filter((v) => v.venue_id === venueId) : venues).map((v) => (
                  <span key={v.venue_id} style={s.legendItem}>
                    <span style={{ ...s.legendDot, background: colorForVenue(v.venue_id, venueOrder) }} />
                    {v.name}
                  </span>
                ))}
              </div>
            )}

            {sessions.length === 0 && (
              <p style={s.muted}>No approved sessions{venueId ? ' for this venue' : ''} this week.</p>
            )}
          </>
        ) : (
          <div style={s.listCard}>
            {allSessions.length === 0 ? (
              <p style={s.muted}>No approved sessions{venueId ? ' for this venue' : ''} yet.</p>
            ) : (
              <table style={s.table}>
                <thead>
                  <tr><th style={s.th}>Venue</th><th style={s.th}>When</th><th style={s.th}>Origin</th><th style={s.th}>Status</th></tr>
                </thead>
                <tbody>
                  {allSessions.map((sess) => {
                    const meta = statusMeta(sess.status);
                    return (
                      <tr key={sess.session_id} className="cal-row" onClick={() => setSelected(sess)}>
                        <td style={s.td}>{sess.venue_name}</td>
                        <td style={s.td}>{new Date(sess.starts_at).toLocaleString()} → {new Date(sess.ends_at).toLocaleTimeString()}</td>
                        <td style={s.td}>{sess.origin}</td>
                        <td style={s.td}><span style={{ ...s.badge, color: meta.color, background: meta.bg }}>{sess.status}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}
      </main>

      <footer style={s.footer}>
        2026 © <a href="/" style={s.footerLink}>Bahria University</a> — Sports Management Portal
      </footer>

      {selected && (
        <div style={s.modalOverlay} onClick={() => setSelected(null)}>
          <div style={s.modalCard} onClick={(e) => e.stopPropagation()}>
            <div style={s.modalHead}>
              <h3 style={s.modalTitle}>{selected.venue_name}</h3>
              <button type="button" style={s.modalClose} onClick={() => setSelected(null)} aria-label="Close"><CloseIcon /></button>
            </div>
            <p style={s.modalDate}>{fmtFullDate(selected.starts_at)}</p>
            <div style={s.modalGrid}>
              <ModalRow label="Time" value={`${fmtTime(selected.starts_at)} – ${fmtTime(selected.ends_at)}`} />
              <ModalRow label="Origin" value={ORIGIN_LABEL[selected.origin] ?? selected.origin} />
              <ModalRow label="Status" value={<span style={{ ...s.badge, color: statusMeta(selected.status).color, background: statusMeta(selected.status).bg }}>{statusMeta(selected.status).label}</span>} />
              <ModalRow label="Session" value={`${selected.session_no} of ${selected.total_sessions}`} />
              <ModalRow label="Booking ID" value={<span style={s.mono}>{selected.booking_id}</span>} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ROLE_LABEL(role: string) {
  return role === 'SUPER_ADMIN' ? 'Administration Staff' : role === 'COORDINATOR' ? 'Coordinator' : role === 'EXTERNAL' ? 'External' : 'Student';
}

function fmtHour(h: number) {
  const period = h < 12 || h === 24 ? 'AM' : 'PM';
  let hh = h % 12; if (hh === 0) hh = 12;
  return `${hh}:00 ${period}`;
}

function ModalRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={s.modalRow}>
      <span style={s.modalLabel}>{label}</span>
      <span style={s.modalValue}>{value}</span>
    </div>
  );
}

function CalendarStyles() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@600;700;800&family=Inter:wght@400;500;600;700&display=swap');
      .auth-ui { font-family: 'Inter', 'Segoe UI', system-ui, sans-serif; }
      .cal-topbtn { transition: background-color .15s ease, border-color .15s ease, color .15s ease; text-decoration: none; }
      .cal-topbtn:hover { background: #F1F5F3; }
      .cal-signout:hover { background: #FDECEC; border-color: #F3CACA; color: #8F2323; }
      .cal-toggle { transition: background-color .15s ease, color .15s ease; }
      .cal-navbtn { transition: background-color .15s ease; }
      .cal-navbtn:hover { background: #F1F5F3; }
      .cal-todaybtn { transition: background-color .15s ease; background: #fff; }
      .cal-todaybtn:hover { background: #F1F5F3; }
      .cal-event { transition: transform .12s ease, box-shadow .12s ease; cursor: pointer; text-align: left; }
      .cal-event:hover { transform: translateY(-1px); box-shadow: 0 8px 16px -8px rgba(11,55,84,0.35); z-index: 5; }
      .cal-row { cursor: pointer; transition: background-color .12s ease; }
      .cal-row:hover { background: ${palette.mint50}; }
      @media (max-width: 880px) {
        .cal-controls-mq { flex-direction: column !important; align-items: stretch !important; }
      }
      @media (prefers-reduced-motion: reduce) {
        .cal-event, .cal-row { transition: none !important; }
      }
    `}</style>
  );
}

/* ---------- icons ---------- */
function BackIcon() { return <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M9.5 3 4 8l5.5 5M4.5 8H14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>; }
function SignOutIcon() { return <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M6.5 2H3.5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><path d="M10.5 5 14 8l-3.5 3M14 8H6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>; }
function ChevronLeftIcon() { return <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10 3 5.5 8l4.5 5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>; }
function ChevronRightIcon() { return <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6 3l4.5 5L6 13" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>; }
function GridIcon() { return <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.4"/><rect x="9" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.4"/><rect x="2" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.4"/><rect x="9" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.4"/></svg>; }
function ListIcon() { return <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M5 4h9M5 8h9M5 12h9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><circle cx="2.3" cy="4" r="0.9" fill="currentColor"/><circle cx="2.3" cy="8" r="0.9" fill="currentColor"/><circle cx="2.3" cy="12" r="0.9" fill="currentColor"/></svg>; }
function CloseIcon() { return <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M3 3l10 10M13 3 3 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>; }

/* ---------- styles ---------- */
const s = {
  page: {
    minHeight: '100%', display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden',
    background: `radial-gradient(1200px 600px at 10% -10%, ${palette.sky100} 0%, transparent 55%),
                 radial-gradient(1000px 600px at 100% 0%, ${palette.mint100} 0%, transparent 55%),
                 ${palette.mint50}`,
  } as const,
  heroBlobA: { position: 'absolute', width: 340, height: 340, borderRadius: '50%', background: `${palette.teal}22`, top: -120, left: -100, filter: 'blur(10px)', pointerEvents: 'none' } as const,
  heroBlobB: { position: 'absolute', width: 300, height: 300, borderRadius: '50%', background: `${palette.navy}18`, bottom: -140, right: -80, filter: 'blur(10px)', pointerEvents: 'none' } as const,
  topbar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 32px', borderBottom: `1px solid ${palette.line}` } as const,
  brand: { display: 'flex', alignItems: 'center', gap: 10 } as const,
  logoMark: { width: 30, height: 30, borderRadius: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontFamily: 'Poppins, sans-serif', fontWeight: 800, fontSize: 12 } as const,
  wordmark: { fontFamily: 'Poppins, serif', fontSize: 16.5, fontWeight: 600, color: palette.navy } as const,
  topbarRight: { display: 'flex', gap: 8 } as const,
  topBtn: {
    display: 'inline-flex', alignItems: 'center', gap: 6, background: '#fff', color: palette.muted,
    border: `1.5px solid ${palette.line}`, borderRadius: 999, padding: '7px 14px', fontSize: 13, fontWeight: 700,
    cursor: 'pointer', fontFamily: 'inherit',
  } as const,
  main: { flex: 1, padding: '28px 28px 40px', maxWidth: 1180, width: '100%', margin: '0 auto' } as const,
  headRow: { marginBottom: 18 } as const,
  eyebrow: { display: 'inline-block', fontSize: 11.5, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', padding: '5px 12px', borderRadius: 999, marginBottom: 10 } as const,
  title: { fontFamily: 'Poppins, sans-serif', fontSize: 26, fontWeight: 700, color: palette.navy, margin: 0 } as const,
  errBanner: { background: '#FDECEC', color: '#8F2323', border: '1px solid #F3CACA', borderRadius: 12, padding: '11px 14px', fontSize: 13.5, marginBottom: 16 } as const,
  controlsRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 18 } as const,
  controlsLeft: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' } as const,
  select: { fontSize: 13.5, padding: '9px 12px', borderRadius: 10, border: `1.5px solid ${palette.line}`, background: '#fff', color: palette.ink, fontFamily: 'inherit' } as const,
  viewToggle: { display: 'flex', gap: 4, background: '#fff', border: `1.5px solid ${palette.line}`, borderRadius: 10, padding: 3 } as const,
  toggleBtn: { display: 'inline-flex', alignItems: 'center', gap: 6, border: 'none', background: 'transparent', color: palette.muted, fontSize: 13, fontWeight: 700, padding: '6px 12px', borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit' } as const,
  weekNav: { display: 'flex', alignItems: 'center', gap: 6 } as const,
  navBtn: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, borderRadius: 9, border: `1.5px solid ${palette.line}`, background: '#fff', color: palette.navy, cursor: 'pointer' } as const,
  weekLabel: { fontSize: 13.5, fontWeight: 700, color: palette.ink, minWidth: 150, textAlign: 'center' } as const,
  todayBtn: { fontSize: 12.5, fontWeight: 700, border: '1.5px solid', borderRadius: 999, padding: '6px 14px', cursor: 'pointer', fontFamily: 'inherit', marginLeft: 4 } as const,
  gridCard: { background: '#fff', border: `1px solid ${palette.line}`, borderRadius: 18, overflow: 'hidden', boxShadow: '0 18px 40px -28px rgba(11,55,84,0.35)' } as const,
  gridScroll: { overflowX: 'auto' } as const,
  gridInner: { display: 'grid', minWidth: 860 } as const,
  cornerCell: { borderBottom: `1px solid ${palette.line}`, borderRight: `1px solid ${palette.line}` } as const,
  dayHeaderCell: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '10px 6px 12px', borderBottom: `1px solid ${palette.line}`, borderLeft: `1px solid ${palette.line}` } as const,
  dayHeaderBar: { width: 28, height: 3, borderRadius: 2, marginBottom: 2 } as const,
  dayHeaderName: { fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: palette.muted } as const,
  dayHeaderNum: { fontSize: 14, fontWeight: 700, color: palette.ink, width: 26, height: 26, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%' } as const,
  hourGutter: { borderRight: `1px solid ${palette.line}` } as const,
  hourLabelCell: { fontSize: 11, color: palette.muted, textAlign: 'right', paddingRight: 8, paddingTop: 4, boxSizing: 'border-box', borderTop: `1px solid ${palette.line}` } as const,
  dayColumn: { position: 'relative', borderLeft: `1px solid ${palette.line}` } as const,
  hourGridLine: { position: 'absolute', left: 0, right: 0, borderTop: `1px solid ${palette.line}` } as const,
  eventBlock: {
    position: 'absolute', left: 3, right: 3, borderRadius: 10, border: '1.5px solid', padding: '5px 8px',
    display: 'flex', flexDirection: 'column', gap: 1, overflow: 'hidden', fontFamily: 'inherit',
  } as const,
  eventDot: { position: 'absolute', top: 6, right: 7, width: 6, height: 6, borderRadius: '50%' } as const,
  eventVenue: { fontSize: 12, fontWeight: 700, lineHeight: 1.2, paddingRight: 12 } as const,
  eventTime: { fontSize: 10.5, color: palette.muted, fontWeight: 600 } as const,
  legend: { display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 16 } as const,
  legendItem: { display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: palette.muted, fontWeight: 600 } as const,
  legendDot: { width: 9, height: 9, borderRadius: '50%' } as const,
  muted: { color: palette.muted, fontSize: 14, marginTop: 18, textAlign: 'center' } as const,
  listCard: { background: '#fff', border: `1px solid ${palette.line}`, borderRadius: 18, padding: 6, boxShadow: '0 18px 40px -28px rgba(11,55,84,0.35)' } as const,
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 14 } as const,
  th: { textAlign: 'left', font: '700 11px Inter, sans-serif', color: palette.muted, textTransform: 'uppercase', letterSpacing: '0.04em', padding: '12px 16px', borderBottom: `1px solid ${palette.line}` } as const,
  td: { padding: '12px 16px', borderBottom: `1px solid #EEF2F1`, color: palette.ink } as const,
  badge: { display: 'inline-block', font: '700 11px Inter, sans-serif', padding: '3px 9px', borderRadius: 999 } as const,
  footer: { textAlign: 'center', padding: '20px 24px', fontSize: 12.5, color: palette.muted, borderTop: `1px solid ${palette.line}` } as const,
  footerLink: { color: palette.navy, textDecoration: 'none', fontWeight: 600 } as const,
  modalOverlay: { position: 'fixed', inset: 0, background: 'rgba(11,55,84,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 50 } as const,
  modalCard: { background: '#fff', borderRadius: 18, padding: '22px 24px', width: '100%', maxWidth: 380, boxShadow: '0 30px 60px -20px rgba(11,55,84,0.45)' } as const,
  modalHead: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 2 } as const,
  modalTitle: { fontFamily: 'Poppins, sans-serif', fontSize: 19, fontWeight: 700, color: palette.navy, margin: 0 } as const,
  modalClose: { background: 'none', border: 'none', color: palette.muted, cursor: 'pointer', padding: 4, borderRadius: 6 } as const,
  modalDate: { fontSize: 13, color: palette.muted, margin: '2px 0 16px' } as const,
  modalGrid: { display: 'flex', flexDirection: 'column', gap: 11 } as const,
  modalRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, fontSize: 13.5 } as const,
  modalLabel: { color: palette.muted, fontWeight: 600 } as const,
  modalValue: { color: palette.ink, fontWeight: 700, textAlign: 'right' } as const,
  mono: { fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 12, color: palette.ink } as const,
};
