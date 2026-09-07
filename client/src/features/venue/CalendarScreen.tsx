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
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth.js';
import { listCalendar, listVenues, type CalendarSession, type Venue } from './api.js';
import { ApiRequestError } from '../../lib/api.js';

/* ---------- theme (identical values to LandingScreen/HomeScreen/ProfileUI/
   UsageHistoryScreen/AdminAccountsScreen/OfflineFallbackScreen/
   ConflictDetectionScreen `palette`) ---------- */
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

function errMsg(e: unknown) { return e instanceof ApiRequestError ? e.body.error : 'Something went wrong.'; }

const ORIGIN_LABEL: Record<string, string> = { CLIENT: 'Client', EXTERNAL: 'External', ACADEMIC: 'Academic' };
const ORIGIN_FILTERS: Array<{ value: '' | string; label: string }> = [
  { value: '', label: 'All origins' },
  { value: 'CLIENT', label: 'Client' },
  { value: 'EXTERNAL', label: 'External' },
  { value: 'ACADEMIC', label: 'Academic' },
];

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  SCHEDULED: { label: 'Scheduled', color: '#1F7A45', bg: '#E6F4EC' },
  IN_PROGRESS: { label: 'In progress', color: '#9A6412', bg: '#FDF1E3' },
  COMPLETED: { label: 'Completed', color: '#4A5A66', bg: '#ECEFF2' },
  CANCELLED: { label: 'Cancelled', color: '#8F2323', bg: '#FDECEC' },
  NEEDS_RESCHEDULING: { label: 'Needs reschedule', color: '#9A6412', bg: '#FDF1E3' },
};
function statusMeta(s: string) { return STATUS_META[s] ?? { label: s, color: palette.slate500, bg: palette.slate100 }; }

// Rotating palette for venue color-coding in the grid — purely a visual
// distinguisher for whichever venues actually come back from the API, not
// tied to any specific venue.
const VENUE_COLORS = ['#1C398E', '#1F7A45', '#7C3AED', '#B45309', '#0F766E', '#BE185D'];
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
const DEFAULT_MIN_HOUR = 9;
const DEFAULT_MAX_HOUR = 19;

export default function CalendarScreen() {
  const { user, loading, logout } = useAuth();
  const navigate = useNavigate();

  const [sessions, setSessions] = useState<CalendarSession[]>([]);
  const [allSessions, setAllSessions] = useState<CalendarSession[]>([]); // for List view — unrestricted, exactly like the original screen
  const [venues, setVenues] = useState<Venue[]>([]);
  const [venueId, setVenueId] = useState(0);
  const [originFilter, setOriginFilter] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
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

  // Client-side filters over real API data only — no fabricated fields.
  const matchesFilters = useCallback((sess: CalendarSession) => {
    if (originFilter && sess.origin !== originFilter) return false;
    if (searchTerm.trim()) {
      const q = searchTerm.trim().toLowerCase();
      if (!sess.venue_name.toLowerCase().includes(q)) return false;
    }
    return true;
  }, [originFilter, searchTerm]);

  const visibleSessions = useMemo(() => sessions.filter(matchesFilters), [sessions, matchesFilters]);
  const visibleAllSessions = useMemo(() => allSessions.filter(matchesFilters), [allSessions, matchesFilters]);

  // Upcoming events sidebar — derived entirely from the same unrestricted
  // listCalendar() result already fetched for the List view; just the
  // still-to-come ones, soonest first. While actively searching, show every
  // matching session for that venue instead of capping at 6, since the
  // point of searching is to see everything for that venue.
  const upcomingEvents = useMemo(() => {
    const now = Date.now();
    const list = visibleAllSessions
      .filter((sess) => new Date(sess.ends_at).getTime() >= now)
      .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());
    return searchTerm.trim() ? list : list.slice(0, 6);
  }, [visibleAllSessions, searchTerm]);

  // Fixed 9 AM – 7 PM grid window (no dynamic expansion) — sessions outside
  // this window still render, just clipped at the grid edges.
  const minHour = DEFAULT_MIN_HOUR;
  const maxHour = DEFAULT_MAX_HOUR;

  const hours = useMemo(() => {
    const arr: number[] = [];
    for (let h = minHour; h < maxHour; h++) arr.push(h);
    return arr;
  }, [minHour, maxHour]);

  const days = useMemo(() => [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(weekStart, i)), [weekStart]);
  const today = new Date();

  // Default "Event Details" to whatever's clicked, or the soonest upcoming
  // session when nothing's been clicked yet — never a fabricated placeholder.
  const detailEvent = selected ?? upcomingEvents[0] ?? null;

  if (loading) {
    return <div className="cal-ui" style={{ minHeight: '100%', background: palette.navy900 }} />;
  }
  if (!user) return <Navigate to="/" replace />;


  return (
    <div className="cal-ui" style={s.page}>
      <CalendarStyles />
      <div style={s.blobA} aria-hidden />
      <div style={s.blobB} aria-hidden />

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

      <main style={s.main}>
        {/* Frosted glassmorphism shell around everything below the header —
            same treatment as Usage History, Accounts, Offline Fallback
            Entry, and Conflict Detection. */}
        <div className="cal-glass" style={s.glassPanel}>
          <div style={s.headRow}>
            <span style={s.eyebrow}>{ROLE_LABEL(user.role)} Portal</span>
            <h1 style={s.title}>Venue Calendar</h1>
            <p style={s.subtitle}>View all approved, conflict-free venue sessions across every court and ground.</p>
          </div>

          {error && <div style={s.errBanner}>{error}</div>}

          <div style={s.controlsRow}>
            <div style={s.controlsLeft}>
              <select className="cal-select" style={s.select} value={venueId} onChange={(e) => setVenueId(Number(e.target.value))}>
                <option value={0}>All venues</option>
                {venues.map((v) => <option key={v.venue_id} value={v.venue_id}>{v.name}</option>)}
              </select>

              <select className="cal-select" style={s.select} value={originFilter} onChange={(e) => setOriginFilter(e.target.value)}>
                {ORIGIN_FILTERS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>

              <div style={s.searchBox}>
                <span style={s.searchIcon}><SearchIcon /></span>
                <input
                  className="cal-select"
                  style={s.searchInput}
                  type="search"
                  placeholder="Search by venue name…"
                  value={searchTerm}
                  onChange={(e) => { setSearchTerm(e.target.value); setSelected(null); }}
                />
              </div>
            </div>

            <div style={s.viewToggle}>
              <button type="button" className="cal-toggle" style={{ ...s.toggleBtn, ...(view === 'grid' ? { background: palette.accent, color: '#fff' } : {}) }} onClick={() => setView('grid')}>
                <GridIcon /> Week
              </button>
              <button type="button" className="cal-toggle" style={{ ...s.toggleBtn, ...(view === 'list' ? { background: palette.accent, color: '#fff' } : {}) }} onClick={() => setView('list')}>
                <ListIcon /> List
              </button>
            </div>
          </div>

          {view === 'grid' && (
            <div style={s.weekNav}>
              <button type="button" className="cal-navbtn" style={s.navBtn} onClick={() => setWeekStart(addDays(weekStart, -7))} aria-label="Previous week"><ChevronLeftIcon /></button>
              <span style={s.weekLabel}>{fmtWeekLabel(weekStart)}</span>
              <button type="button" className="cal-navbtn" style={s.navBtn} onClick={() => setWeekStart(addDays(weekStart, 7))} aria-label="Next week"><ChevronRightIcon /></button>
              <button type="button" className="cal-todaybtn" style={s.todayBtn} onClick={() => setWeekStart(startOfWeek(new Date()))}>Today</button>
            </div>
          )}

          <div className="cal-body-mq" style={s.bodyGrid}>
            <div style={s.calendarCol}>
              {view === 'grid' ? (
                <>
                  <div style={s.gridCard}>
                    <div style={s.gridScroll}>
                      <div style={{ ...s.gridInner, gridTemplateColumns: `56px repeat(7, minmax(0, 1fr))` }}>
                        <div style={s.cornerCell} />
                        {days.map((d, i) => {
                          const isToday = isSameDate(d, today);
                          return (
                            <div key={i} style={s.dayHeaderCell}>
                              <div style={{ ...s.dayHeaderBar, background: VENUE_COLORS[i % VENUE_COLORS.length] }} />
                              <span style={s.dayHeaderName}>{DAY_SHORT[i]}</span>
                              <span style={{ ...s.dayHeaderNum, ...(isToday ? { background: palette.accent, color: '#fff' } : {}) }}>{d.getDate()}</span>
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
                            {visibleSessions
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
                                    style={{ ...s.eventBlock, top, height, borderColor: color, background: `${color}1f`, borderLeftWidth: 4 }}
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

                  {visibleSessions.length === 0 && (
                    <p style={s.muted}>No approved sessions{venueId ? ' for this venue' : ''} this week.</p>
                  )}
                </>
              ) : (
                <div style={s.listCard}>
                  {visibleAllSessions.length === 0 ? (
                    <p style={s.muted}>No approved sessions{venueId ? ' for this venue' : ''} yet.</p>
                  ) : (
                    <table style={s.table}>
                      <thead>
                        <tr><th style={s.th}>Venue</th><th style={s.th}>When</th><th style={s.th}>Origin</th><th style={s.th}>Status</th></tr>
                      </thead>
                      <tbody>
                        {visibleAllSessions.map((sess) => {
                          const meta = statusMeta(sess.status);
                          return (
                            <tr key={sess.session_id} className="cal-row" onClick={() => setSelected(sess)}>
                              <td style={s.td}>{sess.venue_name}</td>
                              <td style={s.td}>{new Date(sess.starts_at).toLocaleString()} → {new Date(sess.ends_at).toLocaleTimeString()}</td>
                              <td style={s.td}>{ORIGIN_LABEL[sess.origin] ?? sess.origin}</td>
                              <td style={s.td}><span style={{ ...s.badge, color: meta.color, background: meta.bg }}>{meta.label}</span></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>

            {/* Sidebar — Event Details for whatever's selected (or the
                soonest upcoming session by default) plus a real Upcoming
                Events list, both sourced from the same listCalendar() data
                already fetched above. No fabricated titles/organizers —
                only fields the API actually returns. */}
            <div style={s.sidebarCol}>
              <div style={s.detailCard}>
                <div style={s.detailHead}><CalendarGlyph /> Event Details</div>
                {detailEvent ? (
                  <div style={s.detailBody}>
                    <div style={{ ...s.detailBanner, borderColor: colorForVenue(detailEvent.venue_id, venueOrder) }}>
                      <div style={s.detailVenue}>{detailEvent.venue_name}</div>
                      <div style={s.detailDate}>{fmtFullDate(detailEvent.starts_at)}</div>
                      <div style={s.detailTime}>{fmtTime(detailEvent.starts_at)} – {fmtTime(detailEvent.ends_at)}</div>
                    </div>
                    <DetailRow label="Origin" value={ORIGIN_LABEL[detailEvent.origin] ?? detailEvent.origin} />
                    <DetailRow
                      label="Status"
                      value={<span style={{ ...s.badge, color: statusMeta(detailEvent.status).color, background: statusMeta(detailEvent.status).bg }}>{statusMeta(detailEvent.status).label}</span>}
                    />
                    <DetailRow label="Session" value={`${detailEvent.session_no} of ${detailEvent.total_sessions}`} />
                    <DetailRow label="Booking ID" value={<span style={s.mono}>{detailEvent.booking_id}</span>} />
                  </div>
                ) : (
                  <p style={{ ...s.muted, margin: '14px 20px 18px', textAlign: 'left' }}>No sessions to show yet.</p>
                )}
              </div>

              <div style={s.upcomingCard}>
                <div style={{ ...s.detailHead, justifyContent: 'space-between' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <CalendarGlyph /> {searchTerm.trim() ? `Matches for "${searchTerm.trim()}"` : 'Upcoming Events'}
                  </span>
                  {searchTerm.trim() && <span style={s.matchCount}>{upcomingEvents.length}</span>}
                </div>
                <div style={s.upcomingList}>
                  {upcomingEvents.length === 0 ? (
                    <p style={{ ...s.muted, margin: '4px 20px 16px', textAlign: 'left' }}>
                      {searchTerm.trim() ? `No sessions found for "${searchTerm.trim()}".` : 'Nothing upcoming.'}
                    </p>
                  ) : (
                    upcomingEvents.map((sess) => {
                      const meta = statusMeta(sess.status);
                      return (
                        <button
                          key={sess.session_id}
                          type="button"
                          className="cal-upitem"
                          style={s.upcomingItem}
                          onClick={() => setSelected(sess)}
                        >
                          <span style={{ ...s.upcomingDot, background: colorForVenue(sess.venue_id, venueOrder) }} />
                          <span style={s.upcomingText}>
                            <span style={s.upcomingTitle}>{sess.venue_name}</span>
                            <span style={s.upcomingTime}>{fmtShortDate(sess.starts_at)} · {fmtTime(sess.starts_at)} – {fmtTime(sess.ends_at)}</span>
                          </span>
                          <span style={{ ...s.upcomingStatusDot, background: meta.color }} title={meta.label} />
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      <footer style={s.footer}>
        2026 © <a href="/" style={s.footerLink}>Bahria University</a> — Sports Management Portal
      </footer>
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
function fmtShortDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={s.detailRow}>
      <span style={s.detailLabel}>{label}</span>
      <span style={s.detailValue}>{value}</span>
    </div>
  );
}

function CalendarGlyph() {
  return <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor"><path d="M4 1h1v1.5h6V1h1v1.5h2A1.5 1.5 0 0 1 15.5 4v9A1.5 1.5 0 0 1 14 14.5H2A1.5 1.5 0 0 1 .5 13V4A1.5 1.5 0 0 1 2 2.5h2V1zM1.5 6v7A.5.5 0 0 0 2 13.5h12a.5.5 0 0 0 .5-.5V6h-13z"/></svg>;
}
function SearchIcon() {
  return <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.6"/><path d="m14 14-2.8-2.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>;
}

function CalendarStyles() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
      .cal-ui { font-family: 'Inter', system-ui, sans-serif; }
      .cal-ui * { box-sizing: border-box; }
      .hist-topbtn { transition: background-color .18s ease, border-color .18s ease, color .18s ease; text-decoration: none; }
      .hist-topbtn:hover { background-color: rgba(255,255,255,0.08); border-color: ${palette.slate100}; }
      .hist-signout:hover { background-color: ${palette.accent} !important; border-color: ${palette.accent} !important; color: #fff !important; }
      .cal-select { transition: border-color .15s ease, box-shadow .15s ease; }
      .cal-select:focus { outline: none; border-color: ${palette.accent} !important; box-shadow: 0 0 0 3px ${palette.accentSoft}; }
      .cal-toggle { transition: background-color .15s ease, color .15s ease; }
      .cal-navbtn { transition: background-color .15s ease; }
      .cal-navbtn:hover { background: ${palette.slate50}; }
      .cal-todaybtn { transition: background-color .15s ease, color .15s ease; }
      .cal-todaybtn:hover { background: ${palette.accent}; color: #fff; }
      .cal-event { transition: transform .12s ease, box-shadow .12s ease; cursor: pointer; text-align: left; }
      .cal-event:hover { transform: translateY(-1px); box-shadow: 0 8px 16px -8px rgba(3,22,54,0.45); z-index: 5; }
      .cal-row { cursor: pointer; transition: background-color .12s ease; }
      .cal-row:hover { background: ${palette.slate50}; }
      .cal-upitem { transition: background-color .12s ease; cursor: pointer; text-align: left; width: 100%; }
      .cal-upitem:hover { background: ${palette.slate50}; }
      @media (max-width: 980px) {
        .cal-body-mq { grid-template-columns: 1fr !important; }
      }
      @media (max-width: 880px) {
        .cal-controls-mq { flex-direction: column !important; align-items: stretch !important; }
      }
      @media (max-width: 620px) {
        .cal-glass { padding: 20px 14px 26px !important; border-radius: 18px !important; }
      }
      @media (prefers-reduced-motion: reduce) {
        .cal-event, .cal-row, .cal-upitem { transition: none !important; }
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

/* ---------- styles ---------- */
const CARD_BG = 'linear-gradient(145deg, #F8FAFF 0%, #EAF0FC 100%)';
const CARD_SHADOW = '0 12px 30px -22px rgba(3,22,54,.85)';

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

  main: { position: 'relative', zIndex: 1, flex: 1, padding: '20px 24px 56px', width: '100%', maxWidth: 1320, margin: '0 auto', boxSizing: 'border-box' } as const,
  glassPanel: {
    position: 'relative', background: 'rgba(255,255,255,0.07)',
    backdropFilter: 'blur(22px) saturate(160%)', WebkitBackdropFilter: 'blur(22px) saturate(160%)',
    border: '1px solid rgba(255,255,255,0.16)', borderRadius: 24,
    padding: '28px 24px 32px',
    boxShadow: '0 24px 60px -32px rgba(3,22,54,0.75), inset 0 1px 0 rgba(255,255,255,0.10)',
  } as const,

  headRow: { marginBottom: 18 } as const,
  eyebrow: {
    display: 'inline-block', fontSize: 11.5, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase',
    padding: '6px 14px', borderRadius: 999, marginBottom: 10,
    color: palette.slate100, background: `${palette.navy800}88`, border: `1px solid ${palette.slate400}55`,
  } as const,
  title: { fontSize: 28, fontWeight: 800, color: palette.white, margin: '0 0 6px', letterSpacing: '-0.5px' } as const,
  subtitle: { fontSize: 14, color: palette.slate300, margin: 0 } as const,

  errBanner: { background: '#FDECEC', color: '#8F2323', border: '1px solid #F3CACA', borderRadius: 12, padding: '11px 14px', fontSize: 13.5, marginBottom: 16 } as const,

  controlsRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 14 } as const,
  controlsLeft: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' } as const,
  select: { fontSize: 13.5, padding: '9px 12px', borderRadius: 10, border: `1.5px solid ${palette.slate300}`, background: palette.white, color: palette.navy900, fontFamily: 'inherit' } as const,
  searchBox: { position: 'relative' } as const,
  searchIcon: { position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: palette.slate500, display: 'flex' } as const,
  searchInput: { fontSize: 13.5, padding: '9px 12px 9px 32px', borderRadius: 10, border: `1.5px solid ${palette.slate300}`, background: palette.white, color: palette.navy900, fontFamily: 'inherit', width: 220 } as const,
  viewToggle: { display: 'flex', gap: 4, background: palette.white, border: `1.5px solid ${palette.slate300}`, borderRadius: 10, padding: 3 } as const,
  toggleBtn: { display: 'inline-flex', alignItems: 'center', gap: 6, border: 'none', background: 'transparent', color: palette.slate500, fontSize: 13, fontWeight: 700, padding: '6px 12px', borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit' } as const,
  weekNav: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 18 } as const,
  navBtn: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, borderRadius: 9, border: `1.5px solid ${palette.slate300}`, background: palette.white, color: palette.navy900, cursor: 'pointer' } as const,
  weekLabel: { fontSize: 13.5, fontWeight: 700, color: palette.slate100, minWidth: 150, textAlign: 'center' } as const,
  todayBtn: { fontSize: 12.5, fontWeight: 700, border: `1.5px solid ${palette.accent}`, color: palette.accent, background: palette.white, borderRadius: 999, padding: '6px 14px', cursor: 'pointer', fontFamily: 'inherit', marginLeft: 4 } as const,

  bodyGrid: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 320px', gap: 20, alignItems: 'start' } as const,
  calendarCol: { minWidth: 0 } as const,
  sidebarCol: { display: 'flex', flexDirection: 'column', gap: 16 } as const,

  gridCard: { background: CARD_BG, border: `1px solid ${palette.slate300}e6`, borderRadius: 16, overflow: 'hidden', boxShadow: CARD_SHADOW } as const,
  gridScroll: {} as const,
  gridInner: { display: 'grid' } as const,
  cornerCell: { borderBottom: `1px solid ${palette.slate300}`, borderRight: `1px solid ${palette.slate300}` } as const,
  dayHeaderCell: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '10px 6px 12px', borderBottom: `1px solid ${palette.slate300}`, borderLeft: `1px solid ${palette.slate300}` } as const,
  dayHeaderBar: { width: 28, height: 3, borderRadius: 2, marginBottom: 2 } as const,
  dayHeaderName: { fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: palette.slate500 } as const,
  dayHeaderNum: { fontSize: 14, fontWeight: 700, color: palette.navy900, width: 26, height: 26, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%' } as const,
  hourGutter: { borderRight: `1px solid ${palette.slate300}` } as const,
  hourLabelCell: { fontSize: 10.5, color: palette.slate500, textAlign: 'right', paddingRight: 6, paddingTop: 4, boxSizing: 'border-box', borderTop: `1px solid ${palette.slate300}`, lineHeight: 1.25 } as const,
  dayColumn: { position: 'relative', borderLeft: `1px solid ${palette.slate300}` } as const,
  hourGridLine: { position: 'absolute', left: 0, right: 0, borderTop: `1px solid ${palette.slate100}` } as const,
  eventBlock: {
    position: 'absolute', left: 3, right: 3, borderRadius: 10, border: '1.5px solid', padding: '5px 8px',
    display: 'flex', flexDirection: 'column', gap: 1, overflow: 'hidden', fontFamily: 'inherit',
  } as const,
  eventDot: { position: 'absolute', top: 6, right: 7, width: 6, height: 6, borderRadius: '50%' } as const,
  eventVenue: { fontSize: 12, fontWeight: 700, lineHeight: 1.2, paddingRight: 12 } as const,
  eventTime: { fontSize: 10.5, color: palette.slate500, fontWeight: 600 } as const,

  legend: { display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 16 } as const,
  legendItem: { display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: palette.slate300, fontWeight: 600 } as const,
  legendDot: { width: 9, height: 9, borderRadius: '50%' } as const,
  muted: { color: palette.slate300, fontSize: 14, marginTop: 18, textAlign: 'center' } as const,

  listCard: { background: CARD_BG, border: `1px solid ${palette.slate300}e6`, borderRadius: 16, padding: 6, boxShadow: CARD_SHADOW } as const,
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 14 } as const,
  th: { textAlign: 'left', font: '700 11px Inter, sans-serif', color: palette.slate500, textTransform: 'uppercase', letterSpacing: '0.04em', padding: '12px 16px', borderBottom: `1px solid ${palette.slate300}` } as const,
  td: { padding: '12px 16px', borderBottom: `1px solid ${palette.slate100}`, color: palette.navy900 } as const,
  badge: { display: 'inline-block', font: '700 11px Inter, sans-serif', padding: '3px 9px', borderRadius: 999 } as const,

  footer: { position: 'relative', zIndex: 1, textAlign: 'center', padding: '20px 24px', fontSize: 12.5, color: palette.slate400, borderTop: `1px solid ${palette.slate600}55` } as const,
  footerLink: { color: palette.accentSoft, textDecoration: 'none', fontWeight: 600 } as const,

  detailCard: { background: CARD_BG, border: `1px solid ${palette.slate300}e6`, borderRadius: 16, overflow: 'hidden', boxShadow: CARD_SHADOW } as const,
  detailHead: { display: 'flex', alignItems: 'center', gap: 8, padding: '14px 20px', borderBottom: `1px solid ${palette.slate300}`, background: palette.white, font: '700 14px Inter, sans-serif', color: palette.navy900 } as const,
  detailBody: { padding: '16px 20px 18px' } as const,
  detailBanner: { background: palette.slate50, border: '1.5px solid', borderRadius: 12, padding: '12px 14px', marginBottom: 14 } as const,
  detailVenue: { fontSize: 15, fontWeight: 800, color: palette.navy900 } as const,
  detailDate: { fontSize: 12.5, color: palette.slate500, marginTop: 4, fontWeight: 600 } as const,
  detailTime: { fontSize: 12.5, color: palette.slate500, marginTop: 1 } as const,
  detailRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '9px 0', borderTop: `1px solid ${palette.slate100}` } as const,
  detailLabel: { fontSize: 12, fontWeight: 700, color: palette.slate500 } as const,
  detailValue: { fontSize: 13.5, fontWeight: 700, color: palette.navy900, textAlign: 'right' } as const,
  mono: { fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 11.5, color: palette.navy900 } as const,

  upcomingCard: { background: CARD_BG, border: `1px solid ${palette.slate300}e6`, borderRadius: 16, overflow: 'hidden', boxShadow: CARD_SHADOW } as const,
  matchCount: { fontSize: 11.5, fontWeight: 700, background: palette.accentWash, color: palette.accent, padding: '2px 9px', borderRadius: 999 } as const,
  upcomingList: { display: 'flex', flexDirection: 'column', padding: '6px 0 8px' } as const,
  upcomingItem: { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 20px', background: 'none', border: 'none', cursor: 'pointer' } as const,
  upcomingDot: { width: 9, height: 9, borderRadius: '50%', flexShrink: 0 } as const,
  upcomingText: { display: 'flex', flexDirection: 'column', gap: 1, flex: 1, minWidth: 0 } as const,
  upcomingTitle: { fontSize: 13, fontWeight: 700, color: palette.navy900, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } as const,
  upcomingTime: { fontSize: 11.5, color: palette.slate500 } as const,
  upcomingStatusDot: { width: 6, height: 6, borderRadius: '50%', flexShrink: 0 } as const,
};
