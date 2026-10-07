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
 *
 * Re-themed to the site's navy + glassmorphism language (same header, page
 * background, glow blobs, frosted glass shell, light soft-gradient cards and
 * #1C398E accent as Accounts / Conflict Detection / Venue Approvals).
 * "Initiate Event" opens a two-column layout — event form on the left,
 * guidelines on the right, venue reference list below.
 * Frontend only — no API/route/validation/logic changes.
 */
import { useEffect, useState, useCallback, type ReactNode } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth.js';
import {
  listQueue, forwardBooking, rejectBooking, getBookingFull, listVenues,
  initiateAcademicEvent, planAllocation, sendBackToRequester,
  checkEquipmentForSessions, queryConflicts, listCalendar, getArticleAvailability,
  type QueueBooking, type BookingDetailFull, type Venue, type CalendarSession,
  type ApprovedSession, type EquipmentAvailRow, type ArticleAvailGroup, type ArticleAvailEntry,
  type VenueAvailabilityStatus,
} from './api.js';
import { useSessionRows, SessionRowsEditor, type SessionRow } from './SessionsBuilder.js';
import { ApiRequestError } from '../../lib/api.js';
import { HideInAppShell } from '../../components/AppShellContext.js';
import { useBackStep } from '../../components/backStack.js';

function errMsg(e: unknown) { return e instanceof ApiRequestError ? e.body.error : 'Something went wrong.'; }
function fmtDate(iso: string) { return new Date(iso).toLocaleDateString('en-PK', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }); }
function fmtTime(iso: string) { return new Date(iso).toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' }); }
function fmtShortDate(iso: string) { return new Date(iso).toLocaleDateString('en-PK', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }); }
function fmtDT(iso: string) { return new Date(iso).toLocaleString('en-PK', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); }

type ProposedSession = { sessionNo: number; startAt: string; endAt: string };
const EXPIRED_PAGE_SIZE = 10;

/* ---------- theme (same values as AdminAccountsScreen / ConflictDetectionScreen `palette`) ---------- */
const palette = {
  navy900: '#0F172B',
  navy800: '#132357',
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

const AVAIL_LABEL: Record<VenueAvailabilityStatus, string> = {
  AVAILABLE: 'Available',
  UNDER_MAINTENANCE: 'Under Maintenance',
  CLOSED: 'Closed',
};
const AVAIL_STYLE: Record<VenueAvailabilityStatus, React.CSSProperties> = {
  AVAILABLE: { background: '#E6F4EC', color: '#1F7A45' },
  UNDER_MAINTENANCE: { background: '#FDF1E3', color: '#9A6412' },
  CLOSED: { background: '#FDECEC', color: '#B3352B' },
};

// ── Root screen ──────────────────────────────────────────────────────────────
export default function VenueQueueScreen() {
  const { user, loading, logout } = useAuth();
  const navigate = useNavigate();
  const [queue, setQueue] = useState<QueueBooking[] | null>(null);
  const [selected, setSelected] = useState<QueueBooking | null>(null);
  const [showAcademic, setShowAcademic] = useState(false);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [venuesLoaded, setVenuesLoaded] = useState(false);
  const [viewingVenue, setViewingVenue] = useState<Venue | null>(null);
  const [search, setSearch] = useState('');
  // Expired Requests is a collapsed dropdown (closed by default) with 10 rows per page.
  const [expiredOpen, setExpiredOpen] = useState(false);
  const [expiredPage, setExpiredPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [q, v] = await Promise.all([listQueue(), listVenues()]);
      setQueue(q.queue); setVenues(v.venues);
    } catch (e) { setError(errMsg(e)); }
    finally { setVenuesLoaded(true); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Go back (top right) closes whichever view a button on this page opened.
  useBackStep(!!selected, () => setSelected(null));
  useBackStep(showAcademic, () => setShowAcademic(false));

  const header = (
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
          <Link to="/home" className="vq-topbtn" style={s.topBtn}><BackIcon /> Back</Link>
          <button type="button" className="vq-topbtn vq-signout" style={s.topBtn} onClick={() => { void logout(); navigate('/'); }}>
            <SignOutIcon /> Sign out
          </button>
        </div>
      </header>
    </HideInAppShell>
  );

  if (loading) {
    return (
      <div className="vq-ui" style={s.page}>
        <VqStyles />
        {header}
        <main style={s.main}><div className="vq-glass" style={s.glassPanel}><SkeletonRows rows={4} /></div></main>
      </div>
    );
  }
  if (!user) return <Navigate to="/home" replace />;
  if (user.role !== 'COORDINATOR') return <Navigate to="/home" replace />;

  // Split the queue: live requests vs. ones whose first session has already
  // passed. The server marks those EXPIRED; the date check also catches any
  // that passed while this page has been open (until the next reload).
  const nowMs = Date.now();
  const isExpired = (q: QueueBooking) =>
    q.status === 'EXPIRED' || (q.firstStart != null && new Date(q.firstStart).getTime() <= nowMs);
  const pendingQueue = queue ? queue.filter((q) => !isExpired(q)) : null;
  const expiredQueue = queue ? queue.filter(isExpired) : [];

  // Presentation-only filter over the already-loaded queue.
  const term = search.trim().toLowerCase();
  const filteredQueue = pendingQueue && term
    ? pendingQueue.filter((q) =>
      (q.requester_name ?? 'BUKC Sports Dept.').toLowerCase().includes(term)
      || q.venue_name.toLowerCase().includes(term)
      || q.origin.toLowerCase().includes(term)
      || q.purpose.toLowerCase().includes(term))
    : pendingQueue;

  const academicCount = pendingQueue?.filter((q) => q.origin === 'ACADEMIC').length ?? 0;
  const availableVenues = venues.filter((v) => v.availability_status === 'AVAILABLE').length;

  const venuesPanel = (
    <Panel title={showAcademic ? 'Venues' : 'Academic Calendar Events'} icon={<CalendarIcon />}
      action={!showAcademic ? (
        <button type="button" className="vq-btn" style={s.primarySmBtn}
          onClick={() => { setShowAcademic(true); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>
          <PlusIcon /> Initiate Event
        </button>
      ) : undefined}>
      {!showAcademic && (
        <p style={{ ...s.muted, margin: '0 0 16px' }}>
          Recurring annual events — same review pipeline, no student requester. Venues available for events are listed below.
        </p>
      )}
      {!venuesLoaded ? <SkeletonRows rows={3} /> : venues.length === 0 ? (
        <EmptyState icon={<BuildingIcon />} text="No venues have been set up yet." />
      ) : (
        <>
          <div className="vq-table-wrap" style={s.tableWrap}>
            <table style={s.table}>
              <thead>
                <tr>
                  <th style={s.th}>Name</th>
                  <th style={s.th}>Sports</th>
                  <th style={s.th}>Cap.</th>
                  <th className="vq-hide-mobile" style={s.th}>Setting</th>
                  <th style={s.th}>Status</th>
                  <th className="vq-hide-mobile" style={s.th}>Note</th>
                  <th style={{ ...s.th, textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {venues.map((v, i) => (
                  <tr key={v.venue_id} className="vq-row vq-row-anim" style={{ animationDelay: `${i * 30}ms` }}>
                    <td style={s.td}>
                      <div style={s.nameText}>{v.name}</div>
                      {v.location && <div style={s.subText}>{v.location}</div>}
                    </td>
                    <td style={s.td}>{v.sports.length === 0 ? <span style={{ color: palette.slate400 }}>—</span> : v.sports.map((sp) => sp.sport_name).join(', ')}</td>
                    <td style={s.td}>{v.capacity}</td>
                    <td className="vq-hide-mobile" style={s.td}>{v.is_indoor ? 'Indoor' : 'Outdoor'}</td>
                    <td style={s.td}><span style={{ ...s.badge, ...AVAIL_STYLE[v.availability_status] }}>{AVAIL_LABEL[v.availability_status]}</span></td>
                    <td className="vq-hide-mobile" style={{ ...s.td, maxWidth: 200 }}>
                      {v.description ? <span style={s.noteText} title={v.description}>{v.description}</span> : <span style={{ color: palette.slate400 }}>—</span>}
                    </td>
                    <td style={{ ...s.td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button type="button" className="vq-btn vq-link" style={s.linkBtn} onClick={() => setViewingVenue(v)}><EyeIcon /> View</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={s.tableFoot}>Showing {venues.length} venue{venues.length !== 1 ? 's' : ''}</div>
        </>
      )}
    </Panel>
  );

  return (
    <div className="vq-ui" style={s.page}>
      <VqStyles />
      <div style={s.blobA} aria-hidden />
      <div style={s.blobB} aria-hidden />

      {header}

      <main style={s.main}>
        <div className="vq-glass" style={s.glassPanel}>
          <div style={s.hero}>
            <span style={s.heroEyebrow}><CalendarIcon size={14} /> Coordinator</span>
            <h1 style={s.heroTitle}>Venue Queue</h1>
            <p style={s.heroSubtitle}>
              {showAcademic
                ? 'Put a recurring academic event on the calendar. It goes through the same review pipeline as student requests.'
                : 'Track pending booking requests and upcoming academic calendar events.'}
            </p>
          </div>

          {error && <div className="vq-toast" style={s.banner.error}><AlertIcon /> {error}</div>}
          {notice && <div className="vq-toast" style={s.banner.ok}><CheckCircleIcon /> {notice}</div>}

          {selected ? (
            <ReviewPanel item={selected}
              onBack={() => setSelected(null)}
              onDone={(m) => { setNotice(m); setError(null); setSelected(null); void load(); }}
              onError={(m) => { setError(m); setNotice(null); }} />
          ) : showAcademic ? (
            <>
              {/* ── Initiate Event layout: form + guidelines, venues below ── */}
              <div className="vq-add-grid" style={s.addGrid}>
                <section className="vq-card" style={{ ...s.card, marginBottom: 0 }}>
                  <div style={s.formHead}>
                    <span style={s.formHeadIcon}><CalendarIcon size={20} /></span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={s.formHeadTitle}>Initiate Academic Event</div>
                      <div style={s.formHeadSub}>Fill in the details below to reserve a venue for a university event.</div>
                    </div>
                    <button type="button" className="vq-btn vq-icon-btn" style={s.closeIconBtn}
                      onClick={() => setShowAcademic(false)} aria-label="Close initiate event form" title="Close">
                      <XIcon />
                    </button>
                  </div>
                  <div style={{ padding: '0 24px 24px' }}>
                    <AcademicEventForm venues={venues}
                      onDone={(m) => { setNotice(m); setNotice(m); setShowAcademic(false); void load(); }}
                      onError={(m) => setError(m)}
                      onCancel={() => setShowAcademic(false)} />
                  </div>
                </section>

                <aside className="vq-card" style={{ ...s.card, marginBottom: 0 }}>
                  <div style={s.formHead}>
                    <span style={s.formHeadIcon}><DocIcon /></span>
                    <div style={s.formHeadTitle}>Event Guidelines</div>
                  </div>
                  <div style={{ padding: '0 24px 24px' }}>
                    <ul style={s.guideList}>
                      {[
                        'Pick a venue that is Available and fits the expected turnout.',
                        'Give the event a clear name, e.g. Annual Sports Day.',
                        'Add one session per day the venue is needed, between 9:00 am and 6:00 pm.',
                        'Check the times against existing bookings before creating.',
                      ].map((g) => (
                        <li key={g} style={s.guideItem}><span style={s.guideTick}><TickIcon /></span>{g}</li>
                      ))}
                    </ul>
                    <div style={s.infoBox}>
                      <span style={{ color: palette.accent, display: 'inline-flex', marginTop: 1 }}><ClockIcon /></span>
                      <div>
                        <div style={s.infoTitle}>Same review pipeline</div>
                        <div style={s.infoText}>
                          New events appear in Pending Booking Requests with origin Academic, and are reviewed like any other request.
                        </div>
                      </div>
                    </div>
                  </div>
                </aside>
              </div>
              <div style={{ height: 22 }} />
              {venuesPanel}
            </>
          ) : (
            <>
              <div style={s.statRow}>
                <StatCard label="Pending requests" value={pendingQueue?.length ?? 0} accent={palette.accent} icon={<InboxIcon />} />
                <StatCard label="Academic events" value={academicCount} accent="#6B21A8" icon={<CalendarIcon />} />
                <StatCard label="Expired (last 30 days)" value={expiredQueue.length} accent="#B3352B" icon={<ClockIcon size={17} />} />
                <StatCard label="Venues available" value={availableVenues} accent="#1F7A45" icon={<CheckCircleIcon />} />
              </div>

              <Panel title="Pending Booking Requests" icon={<CalendarIcon />}
                action={
                  <div style={s.searchBox}>
                    <span style={s.searchIcon}><SearchIcon /></span>
                    <input type="search" className="vq-input" style={s.searchInput} value={search}
                      onChange={(e) => setSearch(e.target.value)} placeholder="Search requests…" aria-label="Search requests" />
                  </div>
                }>
                {filteredQueue === null ? <SkeletonRows rows={3} />
                  : pendingQueue!.length === 0 ? <EmptyState icon={<CheckCircleIcon />} text="No pending venue requests. New requests will appear here." />
                  : filteredQueue.length === 0 ? (
                    <EmptyState icon={<SearchIcon />} text={`No requests match "${search.trim()}".`} action={{ label: 'Clear search', onClick: () => setSearch('') }} />
                  ) : (
                    <>
                      <div className="vq-table-wrap" style={s.tableWrap}>
                        <table style={s.table}>
                          <thead><tr>
                            <th style={s.th}>Requester</th><th style={s.th}>Venue</th><th style={s.th}>Sessions</th>
                            <th className="vq-hide-mobile" style={s.th}>Participants</th><th style={{ ...s.th, textAlign: 'right' }}>Actions</th>
                          </tr></thead>
                          <tbody>
                            {filteredQueue.map((q, i) => (
                              <tr key={q.booking_id} className="vq-row vq-row-click vq-row-anim" style={{ animationDelay: `${i * 35}ms` }} onClick={() => setSelected(q)}>
                                <td style={s.td}>
                                  <div style={s.nameCell}>
                                    <span style={s.reqIcon}><PeopleIcon /></span>
                                    <div>
                                      <div style={s.nameText}>{q.requester_name ?? 'BUKC Sports Dept.'}</div>
                                      <div style={s.originText}>{q.origin}</div>
                                    </div>
                                  </div>
                                </td>
                                <td style={s.td}><span style={s.iconCell}><span style={s.cellIcon}><PinIcon /></span>{q.venue_name}</span></td>
                                <td style={s.td}>
                                  <span style={s.iconCell}><span style={s.cellIcon}><CalendarIcon size={16} /></span>
                                    <span>
                                      {q.firstStart ? (
                                        q.sessionCount <= 1 && q.lastEnd ? (
                                          <>
                                            <span style={{ display: 'block' }}>{fmtShortDate(q.firstStart)}</span>
                                            <span style={{ display: 'block', color: palette.slate500, fontSize: 12.5 }}>{fmtTime(q.firstStart)} – {fmtTime(q.lastEnd)}</span>
                                          </>
                                        ) : (
                                          <>
                                            <span style={{ display: 'block' }}>{q.sessionCount} sessions</span>
                                            <span style={{ display: 'block', color: palette.slate500, fontSize: 12.5 }}>from {fmtShortDate(q.firstStart)}, {fmtTime(q.firstStart)}</span>
                                          </>
                                        )
                                      ) : `${q.sessionCount} session${q.sessionCount !== 1 ? 's' : ''}`}
                                    </span>
                                  </span>
                                </td>
                                <td className="vq-hide-mobile" style={s.td}><span style={s.iconCell}><span style={s.cellIcon}><PeopleIcon /></span>{q.estimated_participants}</span></td>
                                <td style={{ ...s.td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                                  <button type="button" className="vq-btn" style={s.reviewBtn} onClick={(e) => { e.stopPropagation(); setSelected(q); }}>
                                    <EyeIcon /> Review
                                  </button>
                                  <span className="vq-chev" style={s.rowChevron}><ChevronRightIcon /></span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div style={s.tableFoot}>Showing {filteredQueue.length}{term ? ` of ${pendingQueue!.length}` : ''} request{filteredQueue.length !== 1 ? 's' : ''}</div>
                    </>
                  )}
              </Panel>

              {expiredQueue.length > 0 && (() => {
                const pages = Math.max(1, Math.ceil(expiredQueue.length / EXPIRED_PAGE_SIZE));
                const page = Math.min(expiredPage, pages);
                const from = (page - 1) * EXPIRED_PAGE_SIZE;
                const pageRows = expiredQueue.slice(from, from + EXPIRED_PAGE_SIZE);
                return (
                  <section className="vq-card" style={s.card}>
                    <button type="button" className="vq-dropdown-head" style={{ ...s.dropdownHead, ...(expiredOpen ? { borderBottom: `1px solid ${palette.slate300}` } : null) }}
                      onClick={() => setExpiredOpen((o) => !o)} aria-expanded={expiredOpen} aria-controls="vq-expired-list">
                      <span style={s.panelHeadLeft}>
                        <span style={{ ...s.panelIcon, background: '#FDECEC', color: '#B3352B' }}><ClockIcon size={17} /></span>
                        <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
                          <span>Expired Requests</span>
                          <span style={s.dropdownSub}>First session passed before a decision · kept for 30 days</span>
                        </span>
                      </span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <span style={s.expiredCountPill}>{expiredQueue.length} expired</span>
                        <span style={s.dropdownToggleText}>{expiredOpen ? 'Hide' : 'Show'}</span>
                        <span className="vq-dropdown-chevron" style={{ ...s.dropdownChevron, transform: expiredOpen ? 'rotate(180deg)' : 'none' }}><ChevronDownIcon /></span>
                      </span>
                    </button>

                    {expiredOpen && (
                      <div id="vq-expired-list" className="vq-dropdown-body" style={s.panelBody}>
                        <p style={{ ...s.muted, margin: '0 0 14px' }}>
                          These requests' first session date passed before a decision was made, so they can no longer be
                          forwarded, sent back or approved. They're shown here for 30 days for reference.
                        </p>
                        <div className="vq-table-wrap" style={s.tableWrap}>
                          <table style={s.table}>
                            <thead><tr>
                              <th style={s.th}>Requester</th><th style={s.th}>Venue</th><th style={s.th}>First session</th>
                              <th className="vq-hide-mobile" style={s.th}>Expired on</th><th style={{ ...s.th, textAlign: 'right' }}>Status</th>
                            </tr></thead>
                            <tbody>
                              {pageRows.map((q) => (
                                <tr key={q.booking_id} style={s.expiredRow}>
                                  <td style={s.td}>
                                    <div style={s.nameCell}>
                                      <span style={{ ...s.reqIcon, background: '#E2E8F0', color: palette.slate500 }}><PeopleIcon /></span>
                                      <div>
                                        <div style={{ ...s.nameText, color: palette.slate500 }}>{q.requester_name ?? 'BUKC Sports Dept.'}</div>
                                        <div style={s.originText}>{q.origin} · {q.purpose}</div>
                                      </div>
                                    </div>
                                  </td>
                                  <td style={{ ...s.td, color: palette.slate500 }}>{q.venue_name}</td>
                                  <td style={{ ...s.td, color: palette.slate500 }}>
                                    {q.firstStart ? `${fmtDate(q.firstStart)} · ${fmtTime(q.firstStart)}` : '—'}
                                    {q.sessionCount > 1 ? ` (+${q.sessionCount - 1} more)` : ''}
                                  </td>
                                  <td className="vq-hide-mobile" style={{ ...s.td, color: palette.slate500 }}>
                                    {q.expired_at ? fmtDate(q.expired_at) : 'Just now'}
                                  </td>
                                  <td style={{ ...s.td, textAlign: 'right' }}><span style={s.expiredBadge}>Expired</span></td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <div style={s.pagerRow}>
                          <span style={{ ...s.tableFoot, marginTop: 0 }}>Showing {from + 1}–{from + pageRows.length} of {expiredQueue.length} expired request{expiredQueue.length !== 1 ? 's' : ''}</span>
                          {pages > 1 && (
                            <nav style={{ display: 'flex', alignItems: 'center', gap: 6 }} aria-label="Expired requests pages">
                              <button type="button" className="vq-btn" style={s.pagerBtn} disabled={page === 1} onClick={() => setExpiredPage(page - 1)} aria-label="Previous page"><ChevronLeftIcon /></button>
                              <span style={s.pagerLabel}>Page {page} of {pages}</span>
                              <button type="button" className="vq-btn" style={s.pagerBtn} disabled={page === pages} onClick={() => setExpiredPage(page + 1)} aria-label="Next page"><ChevronRightIcon /></button>
                            </nav>
                          )}
                        </div>
                      </div>
                    )}
                  </section>
                );
              })()}

              {venuesPanel}
            </>
          )}
        </div>
      </main>

      <HideInAppShell>
        <footer style={s.footer}>
          2026 © <a href="/" style={s.footerLink}>Bahria University</a> — Sports Management Portal
        </footer>
      </HideInAppShell>

      {viewingVenue && <VenueDetailModal venue={viewingVenue} onClose={() => setViewingVenue(null)} />}
    </div>
  );
}

function VqStyles() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
      .vq-ui { font-family: 'Inter', system-ui, sans-serif; }
      .vq-ui * { box-sizing: border-box; }
      .vq-card { animation: vqFadeUp .45s ease both; }
      @keyframes vqFadeUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
      .vq-row { transition: background-color .15s ease; }
      .vq-row:hover { background: ${palette.slate50}; }
      .vq-row-click { cursor: pointer; }
      .vq-row-click .vq-chev { transition: transform .15s ease, color .15s ease; }
      .vq-row-click:hover .vq-chev { transform: translateX(3px); color: ${palette.accent}; }
      .vq-row-anim { opacity: 0; animation: vqRowIn .35s ease forwards; }
      .vq-dropdown-head { transition: background-color .15s ease; }
      .vq-dropdown-head:hover { background: ${palette.slate50} !important; }
      .vq-dropdown-head:focus-visible { outline: 2px solid ${palette.accent}; outline-offset: -2px; }
      .vq-dropdown-chevron { transition: transform .2s ease; }
      .vq-dropdown-body { animation: vqFadeUp .25s ease both; }
      @keyframes vqRowIn { from { opacity: 0; transform: translateX(-6px); } to { opacity: 1; transform: translateX(0); } }
      .vq-btn { transition: transform .15s ease, box-shadow .15s ease, filter .15s ease, background-color .15s ease, border-color .15s ease, color .15s ease; }
      .vq-btn:hover:not(:disabled) { transform: translateY(-1px); filter: brightness(1.04); }
      .vq-btn:active:not(:disabled) { transform: translateY(0); }
      .vq-btn:disabled { opacity: .55; cursor: not-allowed; }
      .vq-link:hover { text-decoration: underline; text-underline-offset: 3px; }
      .vq-icon-btn:hover { background: ${palette.accentWash} !important; color: ${palette.accent} !important; }
      .vq-input { transition: border-color .15s ease, box-shadow .15s ease, background-color .15s ease; }
      .vq-input::placeholder { color: ${palette.slate400}; opacity: 1; }
      .vq-input:hover { border-color: ${palette.slate400} !important; }
      .vq-input:focus { outline: none; border-color: ${palette.accent} !important; box-shadow: 0 0 0 4px ${palette.accentSoft}; background-color: #fff !important; }
      .vq-field:focus-within .vq-field-icon { color: ${palette.accent}; }
      .vq-ui textarea:focus, .vq-ui select:focus { outline: none; border-color: ${palette.accent} !important; box-shadow: 0 0 0 4px ${palette.accentSoft}; }
      /* Shared SessionRowsEditor (used elsewhere too) — restyled only inside this screen. */
      .vq-sessions input { font: 14px Inter, sans-serif !important; padding: 9px 11px !important; border: 1.5px solid ${palette.slate300} !important; border-radius: 10px !important; background: #fff !important; color: ${palette.navy900}; }
      .vq-sessions input:focus { outline: none; border-color: ${palette.accent} !important; box-shadow: 0 0 0 4px ${palette.accentSoft}; }
      .vq-sessions > div > div:last-child > div { border-radius: 12px !important; border-color: ${palette.slate300} !important; background: ${palette.slate50} !important; padding: 12px !important; }
      .vq-sessions button { font-family: Inter, sans-serif !important; }
      .vq-sessions > div > div:first-child span { font: 600 12.5px Inter, sans-serif !important; color: ${palette.slate600} !important; }
      .vq-sessions > div > div:first-child button { color: ${palette.accent} !important; font-weight: 700 !important; }
      .vq-modal-anim { animation: vqPop .2s ease both; }
      @keyframes vqPop { from { opacity: 0; transform: translateY(8px) scale(.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
      .vq-toast { animation: vqToast .3s ease both; }
      @keyframes vqToast { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }
      .vq-stat { transition: transform .18s ease, box-shadow .18s ease; }
      .vq-stat:hover { transform: translateY(-2px); box-shadow: 0 14px 26px -16px rgba(3,22,54,0.4); }
      .vq-skel { position: relative; overflow: hidden; background: ${palette.slate300}; }
      .vq-skel::after {
        content: ''; position: absolute; inset: 0; transform: translateX(-100%);
        background: linear-gradient(90deg, transparent, rgba(255,255,255,0.7), transparent);
        animation: vqShimmer 1.3s ease-in-out infinite;
      }
      @keyframes vqShimmer { 100% { transform: translateX(100%); } }
      .vq-topbtn { transition: background-color .18s ease, border-color .18s ease, color .18s ease; text-decoration: none; }
      .vq-topbtn:hover { background-color: rgba(255,255,255,0.08); border-color: ${palette.slate100}; }
      .vq-signout:hover { background-color: ${palette.accent} !important; border-color: ${palette.accent} !important; color: #fff !important; }
      .vq-step-dot { transition: transform .15s ease; }
      .vq-step-dot[data-done="1"]:hover { transform: scale(1.08); }
      @media (max-width: 960px) {
        .vq-add-grid { grid-template-columns: 1fr !important; }
      }
      @media (max-width: 720px) {
        .vq-hide-mobile { display: none !important; }
        .vq-form-grid { grid-template-columns: 1fr !important; }
        .vq-glass { padding: 20px 14px 26px !important; border-radius: 18px !important; }
        .vq-detail-grid { grid-template-columns: 1fr !important; }
        .vq-stepper { overflow-x: auto; padding-bottom: 6px; }
      }
      @media (prefers-reduced-motion: reduce) {
        .vq-card, .vq-row-anim, .vq-toast, .vq-modal-anim { animation: none !important; opacity: 1 !important; }
      }
    `}</style>
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
  // Go back from step 2–4 returns to the previous step (step 1 → back to the queue).
  useBackStep(step > 1, () => setStep((n) => (n > 1 ? n - 1 : n) as StepN), 1);

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

        // Hydrate coordinator qty — prefer previously saved values over student request
        if (d.coordinator_equipment && d.coordinator_equipment.length > 0) {
          setEquipQty(Object.fromEntries(d.coordinator_equipment.map((e) => [e.equipment_type_id, e.quantity])));
        } else {
          setEquipQty(Object.fromEntries(items.map((e) => [e.equipmentTypeId, e.quantity])));
        }

        // Hydrate previously selected articles
        if (d.coordinator_selected_articles && d.coordinator_selected_articles.length > 0) {
          setSelectedArticles(Object.fromEntries(
            d.coordinator_selected_articles.map((e) => [e.equipmentTypeId, e.articleIds]),
          ));
        }

        // Hydrate proposed sessions — if coordinator previously proposed a schedule, pre-populate
        if (d.coordinator_proposed_sessions && d.coordinator_proposed_sessions.length > 0) {
          setProposedSessions(d.coordinator_proposed_sessions);
          setProposalRows(d.coordinator_proposed_sessions.map((s) => ({
            sessionNo: s.sessionNo,
            date: s.startAt.slice(0, 10),
            startTime: s.startAt.slice(11, 16),
            endTime: s.endAt.slice(11, 16),
            participantDetails: '',
          })));
          setShowProposalEditor(true);
          // Conflict check considered done if there's a saved proposal
          setConflictChecked(true);
        } else {
          // Init proposal rows from original sessions for editor pre-population
          setProposalRows(d.sessions.map((s, i) => ({
            sessionNo: i + 1,
            date: s.requested_start_at.slice(0, 10),
            startTime: s.requested_start_at.slice(11, 16),
            endTime: s.requested_end_at.slice(11, 16),
            participantDetails: '',
          })));
        }
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
    <Panel title={`Review — ${requesterName}`} icon={<EyeIcon />}>
      {/* Stepper */}
      <div className="vq-stepper" style={stepperWrap}>
        {STEPS.map((s, i) => (
          <div key={s.n} style={{ display: 'flex', alignItems: 'center', flex: i < STEPS.length - 1 ? 1 : 0 }}>
            <div className="vq-step-dot" data-done={step > s.n ? '1' : '0'} style={{ width: 30, height: 30, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', font: '700 13px Inter, sans-serif', flexShrink: 0, background: step > s.n ? '#1F7A45' : step === s.n ? '#1C398E' : '#E2E8F0', boxShadow: step === s.n ? '0 0 0 4px #DBEAFE' : 'none', color: step >= s.n ? '#fff' : '#8a949f', cursor: step > s.n ? 'pointer' : 'default' }}
              onClick={() => { if (step > s.n) setStep(s.n as StepN); }}>
              {step > s.n ? '✓' : s.n}
            </div>
            <span style={{ fontSize: 12, marginLeft: 6, color: step === s.n ? '#1C398E' : '#8a949f', fontWeight: step === s.n ? 700 : 400, whiteSpace: 'nowrap', flexShrink: 0 }}>{s.label}</span>
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

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 24, paddingTop: 16, borderTop: '1px solid #CAD5E2' }}>
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
                  for (const item2 of requestedEquipment) {
                    const qty = equipQty[item2.equipmentTypeId] ?? 0;
                    if (qty > 0) allocations.push({ requestSessionId: s.request_session_id, equipmentTypeId: item2.equipmentTypeId, quantity: qty });
                  }
                }
                const selArticlesArr = Object.entries(selectedArticles).map(([typeId, ids]) => ({
                  equipmentTypeId: Number(typeId), articleIds: ids,
                }));
                try { await planAllocation(detail.booking_id, allocations, selArticlesArr); } catch { /* non-fatal */ }
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
            <span style={{ font: '600 11px Inter, sans-serif', color: '#5c6773', textTransform: 'uppercase', letterSpacing: '0.04em', alignSelf: 'start', paddingTop: 2 }}>{label}</span>
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
        {checking ? 'Checking…' : conflictChecked ? 'Re-check' : 'Run Conflict Check'}
      </button>

      {conflictChecked && (
        <div style={{ marginTop: 16 }}>
          {!hasConflicts ? (
            <div style={{ ...box.ok, display: 'flex', gap: 10, alignItems: 'center' }}>
              <span>No conflicts — all {effectiveSessions.length} session{effectiveSessions.length > 1 ? 's' : ''} are free on the calendar.</span>
            </div>
          ) : (
            <div style={{ ...box.err }}>{Object.values(sessionConflicts).filter((c) => c.length > 0).length} session(s) conflict with existing approved bookings.</div>
          )}

          {effectiveSessions.map((s) => {
            const cs = sessionConflicts[s.request_session_id] ?? [];
            const date = s.requested_start_at.slice(0, 10);
            const dayEvents = calendarSessions.filter((c) => c.starts_at.slice(0, 10) === date);
            return (
              <div key={s.request_session_id} style={{ marginTop: 12, border: `1px solid ${cs.length > 0 ? '#fca5a5' : '#86efac'}`, borderRadius: 8, overflow: 'hidden' }}>
                <div style={{ padding: '8px 16px', background: cs.length > 0 ? '#fef2f2' : '#f0fdf4', display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ font: '600 13px Inter, sans-serif', color: cs.length > 0 ? '#991b1b' : '#166534' }}>
                    {cs.length > 0 ? `Session ${s.session_no} — CONFLICT` : `Session ${s.session_no} — Clear`}
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
                {hasConflicts ? 'Propose an alternative schedule' : 'Propose an alternative schedule anyway…'}
              </button>
            )}
            {showProposalEditor && (
              <div style={{ padding: 16, border: '1px solid #bfdbfe', borderRadius: 8, background: '#eff6ff' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <span style={{ font: '600 14px Inter, sans-serif', color: '#1e40af' }}>Proposed Alternative Schedule</span>
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
                  <button style={primaryBtn} onClick={applyProposal}>Apply as proposed schedule</button>
                  {proposedSessions && (
                    <span style={{ fontSize: 13, color: '#1f8a4c', fontWeight: 600 }}>Applied — equipment step will use these dates</span>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {!conflictChecked && (
        <div style={{ textAlign: 'center', padding: '32px 24px', color: '#8a949f' }}>
          
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
  const [loading, setLoading] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<number, boolean>>({});
  const isLoaded = equipAvail.length > 0 || articleGroups.length > 0;
  const availMap = Object.fromEntries(equipAvail.map((a) => [a.equipment_type_id, a]));

  useEffect(() => {
    if (equipmentSupport === 'SELF' || requestedEquipment.length === 0) return;
    if (isLoaded) return;
    setLoading(true);
    const typeIds = requestedEquipment.map((e) => e.equipmentTypeId);
    const windows = effectiveSessions.map((s) => ({ startAt: s.requested_start_at, endAt: s.requested_end_at }));
    Promise.all([
      checkEquipmentForSessions(bookingId, { equipmentTypeIds: typeIds, sessionWindows: windows }),
      getArticleAvailability(bookingId, { sessionWindows: windows, equipmentTypeIds: typeIds }),
    ])
      .then(([availRes, artRes]) => {
        onEquipAvailChange(availRes.availability);
        onArticleGroupsChange(artRes.groups);
        const hasSaved = Object.keys(selectedArticles).length > 0;
        if (!hasSaved) {
          const initSel: Record<number, string[]> = {};
          typeIds.forEach((id) => { initSel[id] = []; });
          onSelectedArticlesChange(initSel);
        }
      })
      .catch(() => onError('Could not load inventory data.'))
      .finally(() => setLoading(false));
  }, []); // eslint-disable-line

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
      {loading && <p style={muted}>Loading inventory…</p>}
      {isLoaded && (
        <div>
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
                <div style={{ padding: '10px 14px', background: '#f7f9fb', borderBottom: isCollapsed ? 'none' : '1px solid #e5e7eb', cursor: 'pointer', display: 'grid', gridTemplateColumns: '1fr auto auto', alignItems: 'center', gap: 12 }}
                  onClick={() => setCollapsed((c) => ({ ...c, [item.equipmentTypeId]: !isCollapsed }))}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ font: '600 14px Inter, sans-serif', color: '#1C398E' }}>{item.name}</span>
                    {group && <span style={{ fontSize: 12, color: '#5c6773' }}>({group.lending_unit.toLowerCase()})</span>}
                    <span style={{ fontSize: 12, fontWeight: 600, color: selMismatch ? '#c0392b' : selArts.length === coordQty && coordQty > 0 ? '#1f8a4c' : '#5c6773' }}>
                      {selArts.length}/{coordQty} selected{selMismatch ? ' — must match qty' : ''}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }} onClick={(e) => e.stopPropagation()}>
                    <span style={{ fontSize: 12, color: '#5c6773' }}>Qty (max {studentReq}):</span>
                    <button style={qtyBtn} onClick={() => setQty(item.equipmentTypeId, coordQty - 1)}>−</button>
                    <span style={{ font: '600 15px Inter, sans-serif', minWidth: 24, textAlign: 'center' }}>{coordQty}</span>
                    <button style={qtyBtn} onClick={() => setQty(item.equipmentTypeId, coordQty + 1)}>+</button>
                  </div>
                  <span style={{ fontSize: 14, color: '#5c6773', userSelect: 'none' }}>{isCollapsed ? '▶' : '▼'}</span>
                </div>
                {!isCollapsed && (
                  <>
                    <div style={{ padding: '8px 14px', display: 'flex', gap: 20, fontSize: 13, borderBottom: '1px solid #f0f0f0' }}>
                      <span>Available now: <strong>{avail?.available_now ?? '—'}</strong></span>
                      <span style={{ color: (avail?.locked_on_date ?? 0) > 0 ? '#9a6412' : '#5c6773' }}>Locked on date(s): <strong>{avail?.locked_on_date ?? '—'}</strong></span>
                      <span style={{ color: isShort ? '#b3352b' : '#1f7a45', fontWeight: 700 }}>Net available: {avail?.net_available ?? '—'}</span>
                    </div>
                    {isBelowReq && <div style={{ padding: '6px 14px', background: '#fdf1e3', borderBottom: '1px solid #f0e4b8', fontSize: 13, color: '#9a6412' }}>Allocating {coordQty} of {studentReq} requested — shortfall noted in send-back.</div>}
                    {isShort && <div style={{ padding: '6px 14px', background: '#fef2f2', borderBottom: '1px solid #fca5a5', fontSize: 13, color: '#991b1b' }}>Net available ({avail?.net_available}) is less than coordinator quantity ({coordQty}). Reduce or send back.</div>}
                    {selMismatch && <div style={{ padding: '6px 14px', background: '#fef2f2', borderBottom: '1px solid #fca5a5', fontSize: 13, color: '#991b1b' }}>Select exactly {coordQty} article{coordQty !== 1 ? 's' : ''} — {selArts.length} currently selected.</div>}
                    {group && (
                      <div style={{ padding: '10px 14px' }}>
                        <div style={{ font: '500 12px Inter, sans-serif', color: '#1C398E', marginBottom: 8 }}>Select articles to allocate ({selArts.length}/{coordQty}):</div>
                        <div style={{ display: 'grid', gap: 6 }}>
                          {group.articles.map((art) => {
                            const isLocked = art.locked_elsewhere;
                            const isSelected = selArts.includes(art.article_id);
                            const canSelect = !isLocked && (isSelected || selArts.length < coordQty);
                            return (
                              <label key={art.article_id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', borderRadius: 6, border: `1px solid ${isSelected ? '#1C398E' : '#e5e7eb'}`, background: isLocked ? '#f9fafb' : isSelected ? '#f0f4f8' : '#fff', cursor: isLocked || (!canSelect && !isSelected) ? 'not-allowed' : 'pointer', opacity: isLocked ? 0.55 : 1 }}>
                                <input type="checkbox" checked={isSelected} disabled={isLocked || (!canSelect && !isSelected)} onChange={() => toggleArticle(item.equipmentTypeId, art.article_id)} />
                                <span style={{ font: '500 13px var(--font-mono)', color: '#1C398E' }}>{art.barcode}</span>
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
          {hasShortfall && <div style={{ ...box.err, marginTop: 8 }}>Insufficient availability for some types. Reduce quantities or send back.</div>}
        </div>
      )}
      {!isLoaded && !loading && <p style={{ fontSize: 13, color: '#8a949f', marginTop: 12 }}>Loading inventory data…</p>}
    </div>
  );
}


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
  useBackStep(mode !== 'none', () => setMode('none'), 2);
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
        <div style={{ font: '600 12px Inter, sans-serif', color: '#1C398E', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 10 }}>Review Summary</div>
        <div style={{ display: 'grid', gap: 8, fontSize: 13.5 }}>
          <div>
            <strong>Sessions:</strong>{' '}
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
              <strong>Equipment:</strong>{' '}
              {equipChanges.map((e) => (
                <span key={e.name} style={{ marginRight: 10 }}>
                  {e.name} ×{e.allocated}{e.below && <span style={{ color: '#c0392b', marginLeft: 4 }}>(requested {e.requested})</span>}
                </span>
              ))}
            </div>
          )}
          {hasEquipChanges && (
            <div style={{ color: '#c0392b' }}>Equipment shortfall — some items are being allocated below the requested quantity.</div>
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
            <button style={warnBtn} onClick={() => setMode('sendback')}>Send Back to {requesterName}…</button>
            <button style={ghostBtn} onClick={onBack}>← Back to queue</button>
          </div>
        </div>
      )}

      {mode === 'reject' && (
        <div>
          <label style={lbl}>Rejection reason (shown to {requesterName})</label>
          <textarea style={{ ...textarea, width: '100%', borderColor: rejectErr ? '#c0392b' : undefined }} rows={3} value={reason}
            onChange={(e) => { setReason(e.target.value); if (rejectErr) setRejectErr(''); }} />
          {rejectErr && <div style={{ color: '#c0392b', fontSize: 13, marginTop: 4, fontWeight: 500 }}>{rejectErr}</div>}
          <div style={actionRow}>
            <button style={rejectBtn} disabled={!reason.trim() || busy} onClick={reject}>Confirm rejection</button>
            <button style={ghostBtn} onClick={() => setMode('none')}>Cancel</button>
          </div>
        </div>
      )}

      {mode === 'sendback' && (
        <div style={{ border: '1px solid #fcd34d', borderRadius: 8, background: '#fffbeb', padding: 20 }}>
          <div style={{ font: '600 15px Inter, sans-serif', color: '#92400e', marginBottom: 6 }}>Send Back to {requesterName}</div>

          {/* Compiled summary of what's changing */}
          <div style={{ background: '#fff', border: '1px solid #fde68a', borderRadius: 6, padding: '12px 14px', marginBottom: 14 }}>
            <div style={{ font: '600 12px Inter, sans-serif', color: '#78350f', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>Changes being communicated</div>
            {proposedSessions ? (
              <div style={{ marginBottom: 8 }}>
                <span style={{ font: '600 13px Inter, sans-serif', color: '#333' }}>Proposed alternative schedule:</span>
                {proposedSessions.map((s) => (
                  <div key={s.sessionNo} style={{ fontSize: 13, color: '#555', marginLeft: 14, marginTop: 2 }}>
                    Session {s.sessionNo}: {fmtDate(s.startAt)} · {fmtTime(s.startAt)}–{fmtTime(s.endAt)}
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: 13, color: '#5c6773', marginBottom: 8 }}>No schedule changes — original sessions remain.</div>
            )}
            {hasEquipChanges ? (
              <div>
                <span style={{ font: '600 13px Inter, sans-serif', color: '#333' }}>Equipment shortfall:</span>
                {equipChanges.filter((e) => e.below).map((e) => (
                  <div key={e.name} style={{ fontSize: 13, color: '#c0392b', marginLeft: 14, marginTop: 2 }}>
                    {e.name}: university can provide {e.allocated} (you requested {e.requested})
                  </div>
                ))}
              </div>
            ) : requestedEquipment.length > 0 ? (
              <div style={{ fontSize: 13, color: '#1f8a4c' }}>Full equipment quantities can be provided.</div>
            ) : null}
          </div>

          <label style={lbl}>Your note to {requesterName} *</label>
          <textarea
            style={{ ...textarea, width: '100%', minHeight: 120, marginBottom: noteErr ? 6 : 14, borderColor: noteErr ? '#c0392b' : undefined }}
            placeholder="Explain the conflict or issue and what you propose. Be specific — include dates, times, and reasons. If equipment is short, describe what the university can provide."
            value={sendBackNote}
            onChange={(e) => { setSendBackNote(e.target.value); if (noteErr) setNoteErr(''); }}
          />
          {noteErr && <div style={{ color: '#c0392b', fontSize: 13, marginBottom: 10, fontWeight: 500 }}>{noteErr}</div>}
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
// University match hours — every session must fall between these (server enforces the same).
const MATCH_START = '09:00';
const MATCH_END = '18:00';

// Local calendar date (YYYY-MM-DD) — lower bound for the date pickers.
function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Client-side checks mirroring the server rules, so mistakes are flagged on the
// exact session row before anything is sent. The server re-checks everything
// (and also catches duplicates of requests already in the pipeline).
function checkSessionRows(rows: SessionRow[]): Record<number, string> {
  const errs: Record<number, string> = {};
  const now = Date.now();
  const windows: Array<{ no: number; start: number; end: number }> = [];
  for (const r of rows) {
    if (!r.date) { errs[r.sessionNo] = 'Pick a date for this session.'; continue; }
    if (!r.startTime || !r.endTime) { errs[r.sessionNo] = 'Pick a start and an end time.'; continue; }
    const start = new Date(`${r.date}T${r.startTime}:00`).getTime();
    const end = new Date(`${r.date}T${r.endTime}:00`).getTime();
    if (Number.isNaN(start) || Number.isNaN(end)) { errs[r.sessionNo] = 'Enter a valid date and time.'; continue; }
    if (end <= start) { errs[r.sessionNo] = 'End time must be after the start time.'; continue; }
    if (r.startTime < MATCH_START || r.endTime > MATCH_END) { errs[r.sessionNo] = 'Outside match hours — sessions must be between 9:00 am and 6:00 pm.'; continue; }
    if (start <= now) { errs[r.sessionNo] = 'This date and time has already passed — events can only be created for future slots.'; continue; }
    windows.push({ no: r.sessionNo, start, end });
  }
  for (let i = 0; i < windows.length; i++) {
    for (let j = i + 1; j < windows.length; j++) {
      const a = windows[i]!; const b = windows[j]!;
      if (a.start < b.end && b.start < a.end && !errs[b.no]) {
        errs[b.no] = `Overlaps session ${a.no} — each session needs its own time slot.`;
      }
    }
  }
  return errs;
}

function AcademicEventForm({ venues, onDone, onError: _onError, onCancel }: { venues: Venue[]; onDone: (m: string) => void; onError: (m: string) => void; onCancel?: () => void }) {
  const [venueId, setVenue] = useState(0);
  const [purpose, setPurpose] = useState('');
  const [estimatedParticipants, setParticipants] = useState(50);
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);            // show field errors after the first submit attempt
  const [formError, setFormError] = useState<string | null>(null);
  const { rows, addRow, removeRow, updateRow, toSessionInputs } = useSessionRows();

  const sessionErrors = tried ? checkSessionRows(rows) : {};
  const fieldErrors = {
    venue: tried && !venueId ? 'Choose the venue for this event.' : '',
    purpose: tried && purpose.trim().length < 2 ? 'Give the event a name (at least 2 characters).' : '',
    participants: tried && (!Number.isInteger(estimatedParticipants) || estimatedParticipants < 1) ? 'Enter the expected number of participants (1 or more).' : '',
  };

  // Any edit clears a server error — it may no longer apply.
  useEffect(() => { setFormError(null); }, [venueId, purpose, estimatedParticipants, rows]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTried(true);
    const sErrs = checkSessionRows(rows);
    const nSessionErrs = Object.keys(sErrs).length;
    if (!venueId || purpose.trim().length < 2 || !Number.isInteger(estimatedParticipants) || estimatedParticipants < 1 || nSessionErrs > 0) {
      setFormError(nSessionErrs > 0
        ? `Please fix ${nSessionErrs === 1 ? 'the highlighted session' : `the ${nSessionErrs} highlighted sessions`} before creating the event.`
        : 'Please fill in the highlighted fields.');
      return;
    }
    setBusy(true);
    try {
      await initiateAcademicEvent({ venueId, purpose: purpose.trim(), estimatedParticipants, sessions: toSessionInputs() });
      onDone('Academic event created — it now appears in Pending Booking Requests.');
    } catch (err) {
      setFormError(errMsg(err));
    } finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} noValidate>
      <div className="vq-form-grid" style={s.formGrid}>
        <div>
          <Field label="Venue" required icon={<PinIcon />} select>
            <select className="vq-input" style={{ ...s.select, ...(fieldErrors.venue ? s.inputErr : null) }} value={venueId} onChange={(e) => setVenue(Number(e.target.value))}>
              <option value={0}>Select a venue</option>
              {venues.map((v) => <option key={v.venue_id} value={v.venue_id}>{v.name}</option>)}
            </select>
          </Field>
          {fieldErrors.venue && <div style={s.fieldErr}>{fieldErrors.venue}</div>}
        </div>
        <div>
          <Field label="Participants" required icon={<PeopleIcon />}>
            <input type="number" min={1} className="vq-input" style={{ ...s.input, ...(fieldErrors.participants ? s.inputErr : null) }} value={estimatedParticipants} onChange={(e) => setParticipants(Number(e.target.value))} />
          </Field>
          {fieldErrors.participants && <div style={s.fieldErr}>{fieldErrors.participants}</div>}
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <Field label="Event name" required icon={<FlagIcon />}>
            <input className="vq-input" style={{ ...s.input, ...(fieldErrors.purpose ? s.inputErr : null) }} value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="e.g. Annual Sports Day" />
          </Field>
          {fieldErrors.purpose && <div style={s.fieldErr}>{fieldErrors.purpose}</div>}
        </div>
        <div className="vq-sessions" style={{ gridColumn: '1 / -1' }}>
          <SessionRowsEditor rows={rows} onAdd={addRow} onRemove={removeRow} onUpdate={updateRow} errors={sessionErrors} minDate={localToday()} minTime={MATCH_START} maxTime={MATCH_END} />
          <p style={{ margin: '8px 0 0', fontSize: 12.5, color: palette.slate500 }}>Match hours: 9:00 am – 6:00 pm. A venue can't be requested for a time that's already in a pending request.</p>
        </div>
        {formError && (
          <div className="vq-toast" role="alert" style={{ ...s.banner.error, gridColumn: '1 / -1', marginBottom: 0, alignItems: 'flex-start' }}>
            <span style={{ display: 'inline-flex', marginTop: 1 }}><AlertIcon /></span>
            <span>{formError}</span>
          </div>
        )}
        <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 10, marginTop: 6, flexWrap: 'wrap' }}>
          <button className="vq-btn" style={s.primaryBtn} disabled={busy}><SendIcon /> {busy ? 'Creating…' : 'Create Event'}</button>
          {onCancel && <button type="button" className="vq-btn" style={s.ghostBtn} onClick={onCancel}>Cancel</button>}
        </div>
      </div>
    </form>
  );
}

// ── Venue detail modal (read-only) ──
function VenueDetailModal({ venue, onClose }: { venue: Venue; onClose: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div style={s.overlay} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="vq-modal-anim vq-ui" style={s.modalBox} role="dialog" aria-modal="true" aria-label="Venue details">
        <div style={s.modalHead}>
          <span>Venue Details</span>
          <button type="button" className="vq-btn vq-icon-btn" onClick={onClose} style={s.closeIconBtn} aria-label="Close"><XIcon /></button>
        </div>
        <div style={{ padding: 22 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 18 }}>
            <span style={s.formHeadIcon}><BuildingIcon size={20} /></span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 19, fontWeight: 800, color: palette.navy900 }}>{venue.name}</div>
              {venue.location && <div style={{ fontSize: 13, color: palette.slate500, marginTop: 3, display: 'flex', alignItems: 'center', gap: 5 }}><PinIcon />{venue.location}</div>}
            </div>
            <span style={{ ...s.badge, ...AVAIL_STYLE[venue.availability_status], fontSize: 12, padding: '5px 12px' }}>{AVAIL_LABEL[venue.availability_status]}</span>
          </div>
          <div className="vq-detail-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
            {([
              ['Capacity', String(venue.capacity)],
              ['Setting', venue.is_indoor ? 'Indoor' : 'Outdoor'],
              ['Surface', venue.surface_type ?? '—'],
              ['Sports', venue.sports.length > 0 ? venue.sports.map((sp) => sp.sport_name).join(', ') : '—'],
            ] as Array<[string, string]>).map(([k, v]) => (
              <div key={k} style={s.detailTile}>
                <div style={{ font: '700 11px Inter, sans-serif', color: palette.slate500, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>{k}</div>
                <div style={{ fontSize: 14, color: palette.navy900, fontWeight: 600 }}>{v}</div>
              </div>
            ))}
          </div>
          {venue.description && (
            <div style={{ marginBottom: 16 }}>
              <div style={sectionLabel}>Description</div>
              <div style={{ fontSize: 14, color: palette.navy900, lineHeight: 1.55, marginTop: 6 }}>{venue.description}</div>
            </div>
          )}
          {venue.photos.length > 0 && (
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {venue.photos.map((p, i) => (
                <img key={i} src={p} alt={`${venue.name} ${i + 1}`} style={{ width: 150, height: 100, objectFit: 'cover', borderRadius: 10, border: `1px solid ${palette.slate300}` }} />
              ))}
            </div>
          )}
          <div style={{ marginTop: 20, paddingTop: 14, borderTop: `1px solid ${palette.slate100}`, display: 'flex', justifyContent: 'flex-end' }}>
            <button type="button" className="vq-btn" style={s.ghostBtn} onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Shared components ─────────────────────────────────────────────────────────
function Panel({ title, icon, action, children }: { title: string; icon?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="vq-card" style={s.card}>
      <div style={s.panelHead}>
        <span style={s.panelHeadLeft}>
          <span style={s.panelIcon}>{icon ?? <InboxIcon />}</span>
          <span>{title}</span>
        </span>
        {action}
      </div>
      <div style={s.panelBody}>{children}</div>
    </section>
  );
}
function Field({ label, required, icon, select, children }: { label: string; required?: boolean; icon: ReactNode; select?: boolean; children: ReactNode }) {
  return (
    <label className="vq-field" style={{ display: 'block' }}>
      <span style={s.lbl}>{label}{required && <span style={{ color: '#C0392B' }}> *</span>}</span>
      <span style={{ position: 'relative', display: 'block' }}>
        <span className="vq-field-icon" style={s.fieldIcon}>{icon}</span>
        {children}
        {select && <span style={s.selectChevron}><ChevronDownIcon /></span>}
      </span>
    </label>
  );
}
function StatCard({ label, value, accent, icon }: { label: string; value: number; accent: string; icon: ReactNode }) {
  return (
    <div className="vq-stat" style={s.statCard}>
      <span style={{ ...s.statIcon, color: accent, background: `${accent}1a` }}>{icon}</span>
      <div>
        <div style={{ ...s.statValue, color: accent }}>{value}</div>
        <div style={s.statLabel}>{label}</div>
      </div>
    </div>
  );
}
function EmptyState({ icon, text, action }: { icon: ReactNode; text: string; action?: { label: string; onClick: () => void } }) {
  return (
    <div style={s.emptyState}>
      <span style={s.emptyIcon}>{icon}</span>
      <p style={{ color: palette.slate500, fontSize: 14, margin: 0, maxWidth: 380 }}>{text}</p>
      {action && <button type="button" className="vq-btn" style={ghostBtn} onClick={action.onClick}>{action.label}</button>}
    </div>
  );
}
function SkeletonRows({ rows = 3 }: { rows?: number }) {
  return (
    <div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} style={s.skeletonRow}>
          <span className="vq-skel" style={{ width: 36, height: 36, borderRadius: '50%', display: 'inline-block' }} />
          <div style={{ flex: 1 }}>
            <span className="vq-skel" style={{ ...s.skeletonLine, width: '38%' }} />
            <span className="vq-skel" style={{ ...s.skeletonLine, width: '55%', marginTop: 8 }} />
          </div>
        </div>
      ))}
    </div>
  );
}
function stateTag(state: string): React.CSSProperties {
  return state === 'AVAILABLE'
    ? { background: '#E6F4EC', color: '#1F7A45', padding: '2px 8px', borderRadius: 999, fontWeight: 700 }
    : { background: '#FDF1E3', color: '#9A6412', padding: '2px 8px', borderRadius: 999, fontWeight: 700 };
}

/* ---------- icons ---------- */
const ico = (size: number, children: ReactNode) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{children}</svg>
);
function BackIcon() { return <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M9.5 3 4 8l5.5 5M4.5 8H14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>; }
function SignOutIcon() { return <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M6.5 2H3.5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /><path d="M10.5 5 14 8l-3.5 3M14 8H6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>; }
function SearchIcon() { return ico(16, <><circle cx="11" cy="11" r="6.5" /><path d="m20 20-3.6-3.6" /></>); }
function AlertIcon() { return ico(16, <><path d="M12 3.5 21.5 20h-19L12 3.5z" /><path d="M12 10v4.2" /><circle cx="12" cy="17" r="0.6" fill="currentColor" /></>); }
function CheckCircleIcon() { return ico(16, <><circle cx="12" cy="12" r="9.2" /><path d="m8 12.3 2.6 2.6L16.3 9" /></>); }
function TickIcon() { return ico(16, <path d="m5 12.5 4.5 4.5L19 7.5" />); }
function InboxIcon() { return ico(17, <><path d="M3.5 13.5 6 5h12l2.5 8.5V19a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1v-5.5z" /><path d="M3.5 13.5H9l1 2h4l1-2h5.5" /></>); }
function CalendarIcon({ size = 17 }: { size?: number }) { return ico(size, <><rect x="3.5" y="5" width="17" height="15.5" rx="2" /><path d="M3.5 10h17M8 3v4M16 3v4" /><path d="M8 14h.01M12 14h.01M16 14h.01M8 17h.01M12 17h.01" /></>); }
function BuildingIcon({ size = 16 }: { size?: number }) { return ico(size, <><path d="M4 20V9l8-5 8 5v11" /><path d="M9 20v-6h6v6" /><path d="M3 20h18" /></>); }
function PinIcon() { return ico(16, <><path d="M12 21s-6.5-5.6-6.5-11A6.5 6.5 0 0 1 18.5 10c0 5.4-6.5 11-6.5 11z" /><circle cx="12" cy="10" r="2.3" /></>); }
function PeopleIcon() { return ico(16, <><circle cx="9" cy="8" r="3" /><path d="M3 20c.8-3.2 3-5 6-5s5.2 1.8 6 5" /><circle cx="17" cy="8.5" r="2.3" /><path d="M16 13.2c2.2.4 3.6 1.9 4.2 4.3" /></>); }
function EyeIcon() { return ico(15, <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="2.6" /></>); }
function ChevronRightIcon() { return ico(16, <path d="m9 6 6 6-6 6" />); }
function ChevronLeftIcon() { return ico(16, <path d="m15 6-6 6 6 6" />); }
function ChevronDownIcon() { return ico(15, <path d="m6 9 6 6 6-6" />); }
function DocIcon() { return ico(20, <><path d="M7 3h7l4 4v14H7z" /><path d="M14 3v4h4" /><path d="M10 12h5M10 16h5" /></>); }
function FlagIcon() { return ico(16, <><path d="M5 21V4" /><path d="M5 4h11l-2 4 2 4H5" /></>); }
function SendIcon() { return ico(16, <><path d="M21 3 10 14" /><path d="m21 3-7 18-4-7-7-4 18-7z" /></>); }
function PlusIcon() { return ico(15, <path d="M12 5v14M5 12h14" />); }
function XIcon() { return ico(16, <path d="M6 6l12 12M18 6 6 18" />); }
function ClockIcon({ size = 22 }: { size?: number }) { return ico(size, <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>); }

/* ---------- style tokens (same card system as Accounts / Conflict Detection / Venue Approvals) ---------- */
const CARD_BG = 'linear-gradient(145deg, #F8FAFF 0%, #EAF0FC 100%)';
const CARD_SHADOW = '0 12px 30px -22px rgba(3,22,54,.85)';
const INPUT_BG = palette.slate50;
const INPUT_BORDER = `1.5px solid ${palette.slate300}`;

const s = {
  page: {
    minHeight: '100%', display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden',
    background: `radial-gradient(1100px 700px at 15% 0%, ${palette.navy800}aa 0%, transparent 60%),
                 radial-gradient(900px 600px at 100% 100%, ${palette.accent}22 0%, transparent 55%),
                 ${palette.navy900}`,
  } as const,
  blobA: { position: 'absolute', width: 420, height: 420, borderRadius: '50%', background: `${palette.accent}1a`, top: -160, left: -140, filter: 'blur(30px)', pointerEvents: 'none' } as const,
  blobB: { position: 'absolute', width: 380, height: 380, borderRadius: '50%', background: `${palette.slate600}22`, bottom: -160, right: -120, filter: 'blur(30px)', pointerEvents: 'none' } as const,

  // Header — identical to AdminAccountsScreen.
  topbar: { position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 32px', flexWrap: 'wrap', gap: 12 } as const,
  brand: { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' } as const,
  logoImg: { width: 40, height: 40, borderRadius: 10, objectFit: 'contain', background: palette.slate50, padding: 4, border: `1px solid ${palette.slate300}` } as const,
  wordmark: { fontSize: 16, fontWeight: 700, color: palette.white, lineHeight: 1.2 } as const,
  wordmarkSub: { fontSize: 12, color: palette.slate400, marginTop: 1 } as const,
  topbarRight: { display: 'flex', gap: 10 } as const,
  topBtn: { display: 'inline-flex', alignItems: 'center', gap: 7, background: 'transparent', color: palette.slate100, border: `1.5px solid ${palette.slate400}`, borderRadius: 999, padding: '9px 16px', fontSize: 13.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'none' } as const,

  main: { flex: 1, position: 'relative', zIndex: 1, padding: '20px 24px 48px', width: '100%', maxWidth: 1240, margin: '0 auto', boxSizing: 'border-box' } as const,
  glassPanel: {
    position: 'relative', background: 'rgba(255,255,255,0.07)',
    backdropFilter: 'blur(22px) saturate(160%)', WebkitBackdropFilter: 'blur(22px) saturate(160%)',
    border: '1px solid rgba(255,255,255,0.16)', borderRadius: 24,
    padding: '28px 28px 34px',
    boxShadow: '0 24px 60px -32px rgba(3,22,54,0.75), inset 0 1px 0 rgba(255,255,255,0.10)',
  } as const,

  hero: { position: 'relative', textAlign: 'center', maxWidth: 600, margin: '0 auto 24px' } as const,
  heroEyebrow: {
    display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase',
    padding: '6px 14px', borderRadius: 999, marginBottom: 14,
    color: palette.slate100, background: `${palette.navy800}88`, border: `1px solid ${palette.slate400}55`,
  } as const,
  heroTitle: { fontSize: 32, fontWeight: 800, color: palette.white, margin: '0 0 8px', letterSpacing: '-0.5px' } as const,
  heroSubtitle: { fontSize: 14.5, lineHeight: 1.55, color: palette.slate300, margin: 0 } as const,

  banner: {
    error: { display: 'flex', alignItems: 'center', gap: 8, background: '#FDECEC', color: '#8F2323', border: '1px solid #F3CACA', borderRadius: 12, padding: '11px 16px', fontSize: 14, marginBottom: 16 } as const,
    ok: { display: 'flex', alignItems: 'center', gap: 8, background: '#E6F4EC', color: '#1F7A45', border: '1px solid #1F7A4555', borderRadius: 12, padding: '11px 16px', fontSize: 14, marginBottom: 16 } as const,
  },

  card: { background: CARD_BG, border: `1px solid ${palette.slate300}e6`, borderRadius: 18, boxShadow: CARD_SHADOW, marginBottom: 22, overflow: 'hidden' } as const,
  panelHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '14px 22px', borderBottom: `1px solid ${palette.slate300}`, background: palette.white, flexWrap: 'wrap' } as const,
  panelHeadLeft: { display: 'flex', alignItems: 'center', gap: 10, font: '700 15.5px Inter, sans-serif', color: palette.navy900 } as const,
  panelIcon: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, borderRadius: 9, background: palette.accentWash, color: palette.accent } as const,
  panelBody: { padding: 22 } as const,
  muted: { color: palette.slate500, fontSize: 14 } as const,

  addGrid: { display: 'grid', gridTemplateColumns: 'minmax(0, 1.75fr) minmax(0, 1fr)', gap: 22, alignItems: 'start' } as const,
  formHead: { display: 'flex', alignItems: 'center', gap: 14, padding: '18px 24px', background: palette.white, borderBottom: `1px solid ${palette.slate300}`, marginBottom: 18 } as const,
  formHeadIcon: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 44, height: 44, minWidth: 44, borderRadius: '50%', background: palette.accentWash, color: palette.accent } as const,
  formHeadTitle: { fontSize: 16.5, fontWeight: 800, color: palette.navy900 } as const,
  formHeadSub: { fontSize: 12.5, color: palette.slate500, marginTop: 3 } as const,
  closeIconBtn: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, borderRadius: 10, border: `1px solid ${palette.slate300}`, background: palette.white, color: palette.slate500, cursor: 'pointer', padding: 0 } as const,

  guideList: { listStyle: 'none', margin: '0 0 22px', padding: 0, display: 'grid', gap: 14 } as const,
  guideItem: { display: 'flex', alignItems: 'flex-start', gap: 12, fontSize: 14, color: palette.slate600, lineHeight: 1.45 } as const,
  guideTick: { display: 'inline-flex', color: palette.accent, marginTop: 1 } as const,
  infoBox: { display: 'flex', gap: 12, padding: '16px 18px', borderRadius: 14, background: palette.accentWash, border: `1px solid ${palette.accentSoft}` } as const,
  infoTitle: { fontSize: 14, fontWeight: 700, color: palette.accent, marginBottom: 4 } as const,
  infoText: { fontSize: 13, color: palette.slate500, lineHeight: 1.55 } as const,

  formGrid: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '18px 20px' } as const,
  lbl: { display: 'flex', alignItems: 'center', gap: 4, font: '600 12.5px Inter, sans-serif', color: palette.slate600, marginBottom: 7 } as const,
  fieldIcon: { position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', display: 'flex', color: palette.slate500, pointerEvents: 'none', transition: 'color .15s ease' } as const,
  input: { width: '100%', font: '14px Inter, sans-serif', padding: '10px 14px 10px 40px', background: INPUT_BG, border: INPUT_BORDER, borderRadius: 10, color: palette.navy900, boxSizing: 'border-box' } as const,
  select: { width: '100%', font: '14px Inter, sans-serif', padding: '10px 38px 10px 40px', background: INPUT_BG, border: INPUT_BORDER, borderRadius: 10, color: palette.navy900, boxSizing: 'border-box', appearance: 'none', WebkitAppearance: 'none', cursor: 'pointer' } as const,
  inputErr: { borderColor: '#C0392B', background: '#FFF8F8' } as const,
  fieldErr: { fontSize: 12, color: '#C0392B', marginTop: 5, fontWeight: 500 } as const,
  selectChevron: { position: 'absolute', right: 13, top: '50%', transform: 'translateY(-50%)', display: 'flex', color: palette.slate500, pointerEvents: 'none' } as const,

  primaryBtn: { display: 'inline-flex', alignItems: 'center', gap: 8, background: palette.accent, color: '#fff', border: 'none', borderRadius: 10, padding: '11px 22px', fontSize: 14.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 8px 16px -8px rgba(3,22,54,0.6)' } as const,
  primarySmBtn: { display: 'inline-flex', alignItems: 'center', gap: 6, background: palette.accent, color: '#fff', border: 'none', borderRadius: 9, padding: '8px 16px', fontSize: 13.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' } as const,
  ghostBtn: { background: palette.white, color: palette.slate500, border: `1.5px solid ${palette.slate300}`, borderRadius: 10, padding: '11px 22px', fontSize: 14.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' } as const,
  reviewBtn: { display: 'inline-flex', alignItems: 'center', gap: 7, background: palette.accentWash, color: palette.accent, border: `1px solid ${palette.accentSoft}`, borderRadius: 9, padding: '7px 16px', fontSize: 13.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' } as const,
  linkBtn: { display: 'inline-flex', alignItems: 'center', gap: 5, background: 'none', border: 'none', font: '700 13px Inter, sans-serif', color: palette.accent, cursor: 'pointer', padding: '4px 8px' } as const,
  rowChevron: { display: 'inline-flex', verticalAlign: 'middle', color: palette.slate400, marginLeft: 12 } as const,

  statRow: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, marginBottom: 22 } as const,
  statCard: { display: 'flex', alignItems: 'center', gap: 12, background: palette.slate50, border: `1px solid ${palette.slate300}`, borderRadius: 14, padding: '12px 14px' } as const,
  statIcon: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36, borderRadius: 10 } as const,
  statValue: { fontSize: 20, fontWeight: 800, lineHeight: 1.1 } as const,
  statLabel: { fontSize: 11.5, color: palette.slate500, fontWeight: 600, marginTop: 2 } as const,

  searchBox: { position: 'relative', width: 280, maxWidth: '100%' } as const,
  searchIcon: { position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: palette.slate500, display: 'flex', pointerEvents: 'none' } as const,
  searchInput: { width: '100%', font: '13.5px Inter, sans-serif', padding: '9px 12px 9px 36px', background: INPUT_BG, border: INPUT_BORDER, borderRadius: 10, color: palette.navy900, boxSizing: 'border-box' } as const,

  tableWrap: { overflowX: 'auto' } as const,
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 14, minWidth: 600 } as const,
  th: { textAlign: 'left', font: '700 11.5px Inter, sans-serif', color: palette.slate500, textTransform: 'uppercase', letterSpacing: '0.05em', padding: '0 12px 12px' } as const,
  td: { padding: '13px 12px', borderTop: `1px solid ${palette.slate100}`, color: palette.navy900, verticalAlign: 'middle' } as const,
  tableFoot: { fontSize: 12.5, color: palette.slate500, marginTop: 14 } as const,
  nameCell: { display: 'flex', alignItems: 'center', gap: 12 } as const,
  nameText: { fontWeight: 700, color: palette.navy900, fontSize: 14.5 } as const,
  subText: { fontSize: 12.5, color: palette.slate500, marginTop: 2 } as const,
  originText: { fontSize: 11.5, color: palette.slate500, marginTop: 2, fontWeight: 600, letterSpacing: '0.04em' } as const,
  reqIcon: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 38, height: 38, minWidth: 38, borderRadius: '50%', background: palette.accentWash, color: palette.accent } as const,
  iconCell: { display: 'inline-flex', alignItems: 'center', gap: 9 } as const,
  cellIcon: { display: 'inline-flex', color: palette.accent, opacity: 0.8 } as const,
  noteText: { display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13, color: palette.slate500 } as const,
  badge: { display: 'inline-block', font: '700 11px Inter, sans-serif', padding: '4px 10px', borderRadius: 999, whiteSpace: 'nowrap' } as const,
  expiredBadge: { display: 'inline-block', font: '700 11px Inter, sans-serif', padding: '4px 10px', borderRadius: 999, whiteSpace: 'nowrap', background: '#FDECEC', color: '#B3352B' } as const,
  expiredCountPill: { font: '700 12px Inter, sans-serif', padding: '5px 12px', borderRadius: 999, background: '#FDECEC', color: '#B3352B' } as const,
  expiredRow: { background: 'rgba(226,232,240,0.35)' } as const,
  dropdownHead: { width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', padding: '14px 22px', border: 'none', background: palette.white, cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' } as const,
  dropdownSub: { font: '500 12px Inter, sans-serif', color: palette.slate500 } as const,
  dropdownToggleText: { font: '700 13px Inter, sans-serif', color: palette.accent } as const,
  dropdownChevron: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, borderRadius: 9, background: palette.accentWash, color: palette.accent } as const,
  pagerRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginTop: 14 } as const,
  pagerBtn: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, borderRadius: 9, border: `1.5px solid ${palette.slate300}`, background: palette.white, color: palette.navy900, cursor: 'pointer' } as const,
  pagerLabel: { font: '600 13px Inter, sans-serif', color: palette.slate500, padding: '0 6px' } as const,

  emptyState: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '34px 16px', textAlign: 'center' } as const,
  emptyIcon: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 46, height: 46, borderRadius: '50%', background: palette.accentWash, color: palette.accent } as const,
  skeletonRow: { display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderTop: `1px solid ${palette.slate100}` } as const,
  skeletonLine: { display: 'inline-block', height: 10, borderRadius: 5 } as const,
  detailTile: { background: palette.slate50, border: `1px solid ${palette.slate300}`, borderRadius: 12, padding: '11px 14px' } as const,

  overlay: { position: 'fixed', inset: 0, background: 'rgba(3,22,54,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 } as const,
  modalBox: { background: palette.white, borderRadius: 16, boxShadow: '0 24px 60px -20px rgba(3,22,54,0.6)', width: 580, maxWidth: '100%', maxHeight: '88vh', overflowY: 'auto' } as const,
  modalHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 20px', borderBottom: `1px solid ${palette.slate300}`, font: '700 15.5px Inter, sans-serif', color: palette.navy900, background: palette.slate50 } as const,

  footer: { textAlign: 'center', padding: '20px 24px', fontSize: 12.5, color: palette.slate400, borderTop: `1px solid ${palette.slate600}55`, position: 'relative', zIndex: 1 } as const,
  footerLink: { color: palette.accentSoft, textDecoration: 'none', fontWeight: 600 } as const,
} satisfies Record<string, React.CSSProperties | Record<string, React.CSSProperties>>;

// ── Review-stepper styles (names unchanged; values re-themed) ──
const stepperWrap: React.CSSProperties = { display: 'flex', alignItems: 'center', marginBottom: 28, padding: '14px 16px', background: palette.white, border: `1px solid ${palette.slate300}`, borderRadius: 14 };
const stepTitle: React.CSSProperties = { margin: '0 0 18px', font: '800 18px Inter, sans-serif', color: palette.navy900 };
const sectionLabel: React.CSSProperties = { font: '700 12px Inter, sans-serif', color: palette.slate500, textTransform: 'uppercase', letterSpacing: '0.05em' };
const tbl: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 14, background: palette.white, borderRadius: 12, overflow: 'hidden' };
const th: React.CSSProperties = { textAlign: 'left', font: '700 11.5px Inter, sans-serif', color: palette.slate500, textTransform: 'uppercase', letterSpacing: '0.05em', padding: '10px 12px', borderBottom: `1px solid ${palette.slate300}`, background: palette.slate50 };
const td: React.CSSProperties = { padding: '11px 12px', borderBottom: `1px solid ${palette.slate100}`, color: palette.navy900, verticalAlign: 'top' };
const muted: React.CSSProperties = { color: palette.slate500, fontSize: 14, margin: 0 };
const lbl: React.CSSProperties = { display: 'block', font: '600 12.5px Inter, sans-serif', color: palette.slate600, marginBottom: 6 };
const inp: React.CSSProperties = { width: '100%', font: '14px Inter, sans-serif', padding: '10px 12px', border: INPUT_BORDER, borderRadius: 10, background: INPUT_BG, color: palette.navy900, boxSizing: 'border-box' as const };
const textarea: React.CSSProperties = { font: '14px Inter, sans-serif', padding: '11px 13px', border: INPUT_BORDER, borderRadius: 10, background: palette.white, color: palette.navy900, resize: 'vertical' as const, boxSizing: 'border-box' as const };
const infoBox: React.CSSProperties = { padding: '12px 16px', background: palette.accentWash, border: `1px solid ${palette.accentSoft}`, borderRadius: 12, fontSize: 13.5, color: palette.accent, lineHeight: 1.6 };
const primaryBtn: React.CSSProperties = { background: palette.accent, color: '#fff', border: 'none', borderRadius: 10, padding: '10px 20px', fontSize: 14, cursor: 'pointer', fontWeight: 700, fontFamily: 'Inter, sans-serif', boxShadow: '0 8px 16px -8px rgba(3,22,54,0.6)' };
const ghostBtn: React.CSSProperties = { background: palette.white, color: palette.navy900, border: `1.5px solid ${palette.slate300}`, borderRadius: 10, padding: '10px 18px', fontSize: 14, cursor: 'pointer', fontWeight: 600, fontFamily: 'Inter, sans-serif' };
const acceptBtn: React.CSSProperties = { background: palette.accent, color: '#fff', border: 'none', borderRadius: 10, padding: '11px 20px', fontSize: 14.5, cursor: 'pointer', fontWeight: 700, fontFamily: 'Inter, sans-serif' };
const rejectBtn: React.CSSProperties = { background: '#B3352B', color: '#fff', border: 'none', borderRadius: 10, padding: '11px 20px', fontSize: 14.5, cursor: 'pointer', fontWeight: 700, fontFamily: 'Inter, sans-serif' };
const warnBtn: React.CSSProperties = { background: '#9A6412', color: '#fff', border: 'none', borderRadius: 10, padding: '11px 20px', fontSize: 14, cursor: 'pointer', fontWeight: 700, fontFamily: 'Inter, sans-serif' };
const actionRow: React.CSSProperties = { display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' };
const qtyBtn: React.CSSProperties = { width: 28, height: 28, borderRadius: 8, border: `1.5px solid ${palette.slate300}`, background: palette.white, color: palette.accent, cursor: 'pointer', font: '700 14px Inter, sans-serif' };
const bdanger: React.CSSProperties = { background: '#FDECEC', color: '#B3352B', font: '700 11px Inter, sans-serif', padding: '3px 9px', borderRadius: 999, flexShrink: 0 };
const box = {
  err: { background: '#FDECEC', color: '#8F2323', border: '1px solid #F3CACA', borderRadius: 12, padding: '11px 16px', marginBottom: 12, fontSize: 14 } as React.CSSProperties,
  ok: { background: '#E6F4EC', color: '#1F7A45', border: '1px solid #1F7A4555', borderRadius: 12, padding: '11px 16px', marginBottom: 12, fontSize: 14 } as React.CSSProperties,
};
