/**
 * Feature 9 — Conflict Detection & Resolution (CONF-01..16).
 *
 * Staff-only screen. Surfaces all currently SCHEDULED/IN_PROGRESS sessions
 * so that Coordinators and Super Admins can identify which booking holds a
 * contested slot and act on it — either cancelling or marking it
 * NEEDS_RESCHEDULING — to free the slot for a new booking (CONF-16).
 *
 * Per the Role-Based Access Table:
 *   - Both Coordinator and Super Admin can cancel or reschedule a blocking entry.
 *   - No role can force-approve into a conflict (CONF-14) — resolution is always
 *     done by clearing the blocker first, then re-submitting or approving the
 *     pending request through the normal pipeline.
 *
 * CONF-13: when a rescheduled session's new time is eventually submitted, it
 * goes through the identical lock-and-conflict process as any new booking.
 *
 * NOTE — visual-only pass: this file owns its own page chrome (header, hero,
 * background) instead of <PortalShell> so the refresh stays scoped to this
 * screen and doesn't touch any other page's look. All data/handlers below
 * are unchanged from the original implementation.
 */
import { useEffect, useState, useCallback } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth.js';
import { palette } from '../auth/AuthUI.js';
import {
  listVenues,
  queryConflicts,
  cancelSession,
  markSessionNeedsRescheduling,
  type Venue,
  type ApprovedSession,
} from './api.js';
import { ApiRequestError } from '../../lib/api.js';

function errMsg(e: unknown) {
  return e instanceof ApiRequestError ? e.body.error : 'Something went wrong.';
}

export default function ConflictDetectionScreen() {
  const { user, loading, logout } = useAuth();
  const navigate = useNavigate();
  const [venues, setVenues] = useState<Venue[]>([]);
  const [sessions, setSessions] = useState<ApprovedSession[] | null>(null);
  const [venueFilter, setVenueFilter] = useState<number>(0);
  const [fromFilter, setFromFilter] = useState('');
  const [toFilter, setToFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Load venue list once on mount.
  useEffect(() => {
    listVenues().then((r) => setVenues(r.venues)).catch((e) => setError(errMsg(e)));
  }, []);

  const search = useCallback(async () => {
    setError(null);
    setSessions(null);
    try {
      const params: { venueId?: number; from?: string; to?: string } = {};
      if (venueFilter > 0) params.venueId = venueFilter;
      if (fromFilter) params.from = fromFilter;
      if (toFilter) params.to = toFilter;
      const result = await queryConflicts(params);
      setSessions(result.sessions);
    } catch (e) {
      setError(errMsg(e));
    }
  }, [venueFilter, fromFilter, toFilter]);

  // Auto-search on mount with no filters (show everything upcoming).
  useEffect(() => {
    void search();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return (
      <Shell onBack={() => navigate('/home')} onSignOut={() => { void logout(); navigate('/'); }}>
        <div style={{ ...glassCard, padding: '40px 24px', textAlign: 'center', color: NAVY }}>Loading…</div>
      </Shell>
    );
  }
  if (!user) return <Navigate to="/" replace />;
  if (user.role !== 'COORDINATOR' && user.role !== 'SUPER_ADMIN') {
    return <Navigate to="/home" replace />;
  }

  function flash(type: 'ok' | 'err', msg: string) {
    if (type === 'ok') { setNotice(msg); setError(null); }
    else { setError(msg); setNotice(null); }
  }

  async function handleCancel(sessionId: string) {
    const reason = prompt('Reason for cancellation:');
    if (!reason || !reason.trim()) return;
    setBusy(true);
    try {
      await cancelSession(sessionId, reason.trim());
      flash('ok', 'Session cancelled. The slot is now free.');
      void search();
    } catch (e) {
      flash('err', errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleReschedule(sessionId: string) {
    const reason = prompt('Reason for rescheduling (the requester will be notified):');
    if (!reason || !reason.trim()) return;
    setBusy(true);
    try {
      await markSessionNeedsRescheduling(sessionId, reason.trim());
      flash('ok', 'Session marked as NEEDS_RESCHEDULING. The slot is released for other bookings.');
      void search();
    } catch (e) {
      flash('err', errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  const scheduledCount = sessions?.filter((s) => s.status === 'SCHEDULED').length ?? 0;
  const inProgressCount = sessions?.filter((s) => s.status === 'IN_PROGRESS').length ?? 0;

  return (
    <Shell onBack={() => navigate('/home')} onSignOut={() => { void logout(); navigate('/'); }}>
      <div style={wrap}>
        {error && (
          <div style={box.err} className="cdr-alert">
            <AlertIcon /> <span>{error}</span>
          </div>
        )}
        {notice && (
          <div style={box.ok} className="cdr-alert">
            <CheckIcon /> <span>{notice}</span>
          </div>
        )}

        {/* Hero / intro */}
        <section style={{ ...glassCard, ...heroCard }} className="cdr-fade-in">
          <div style={heroIconWrap}>
            <ConflictGlyph />
          </div>
          <div style={{ flex: 1, minWidth: 240 }}>
            <h2 style={heroTitle}>Find &amp; clear a booked slot</h2>
            <p style={heroText}>
              This view lists every currently active (<strong>SCHEDULED</strong> / <strong>IN&nbsp;PROGRESS</strong>) venue
              session. Identify whichever booking is holding a contested slot, then cancel or reschedule it to free
              the slot. No role can force-approve into an existing conflict — the blocker must be cleared first.
              <span style={confRef}>CONF-14</span>
            </p>
          </div>
          <div style={heroStats}>
            <StatPill value={sessions?.length ?? 0} label="Active" color={GREEN} />
            <StatPill value={scheduledCount} label="Scheduled" color={NAVY} />
            <StatPill value={inProgressCount} label="In progress" color="#c9822b" />
          </div>
        </section>

        {/* Filters */}
        <section style={{ ...glassCard, marginBottom: 22 }} className="cdr-fade-in">
          <div style={panelHead}>
            <span style={panelHeadIcon}><SearchGlyph /></span>
            Find Booked Slots
          </div>
          <div style={panelBody}>
            <div style={filterRow}>
              <label style={lbl}>
                Venue
                <select
                  className="cdr-input"
                  style={inp}
                  value={venueFilter}
                  onChange={(e) => setVenueFilter(Number(e.target.value))}
                >
                  <option value={0}>All venues</option>
                  {venues.map((v) => (
                    <option key={v.venue_id} value={v.venue_id}>{v.name}</option>
                  ))}
                </select>
              </label>
              <label style={lbl}>
                From
                <input
                  className="cdr-input"
                  type="date"
                  style={inp}
                  value={fromFilter}
                  onChange={(e) => setFromFilter(e.target.value)}
                />
              </label>
              <label style={lbl}>
                To
                <input
                  className="cdr-input"
                  type="date"
                  style={inp}
                  value={toFilter}
                  onChange={(e) => setToFilter(e.target.value)}
                />
              </label>
              <button className="cdr-btn-search" style={searchBtn} onClick={search}>
                <SearchGlyph light /> Search
              </button>
            </div>
          </div>
        </section>

        {/* Active sessions */}
        <section style={{ ...glassCard, marginBottom: 22 }} className="cdr-fade-in">
          <div style={panelHead}>
            <span style={panelHeadIcon}><ListGlyph /></span>
            Active Sessions
            {sessions !== null && (
              <span style={countBadge}>{sessions.length} session{sessions.length !== 1 ? 's' : ''}</span>
            )}
          </div>
          <div style={{ ...panelBody, paddingTop: sessions && sessions.length ? 14 : 16 }}>
            {sessions === null ? (
              <div style={emptyState}>
                <span className="cdr-spin" style={spinner} />
                <p style={muted}>Loading sessions…</p>
              </div>
            ) : sessions.length === 0 ? (
              <div style={emptyState}>
                <CheckIcon big />
                <p style={muted}>No active sessions match the filter — no conflicts to resolve.</p>
              </div>
            ) : (
              <div style={cardList}>
                {sessions.map((s) => (
                  <SessionRow
                    key={s.session_id}
                    session={s}
                    busy={busy}
                    onCancel={() => handleCancel(s.session_id)}
                    onReschedule={() => handleReschedule(s.session_id)}
                  />
                ))}
              </div>
            )}
          </div>
        </section>

        {/* How-to guide */}
        <section style={{ ...glassCard, marginBottom: 8 }} className="cdr-fade-in">
          <div style={panelHead}>
            <span style={panelHeadIcon}><GuideGlyph /></span>
            How to Resolve a Conflict
          </div>
          <div style={panelBody}>
            <div style={stepsRow}>
              <StepCard n={1} title="Identify the blocker" color={NAVY}>
                Find the session that is holding the slot a new booking needs. Use the venue and date filters
                to narrow down.
              </StepCard>
              <StepConnector />
              <StepCard n={2} title="Choose a resolution" color={GREEN}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <ResolutionChip tone="danger" label="Cancel">
                    Use when the session will not happen (maintenance, withdrawal). Writes a
                    <strong> CANCELLED</strong> usage-history record permanently.
                  </ResolutionChip>
                  <ResolutionChip tone="info" label="Mark Needs Rescheduling">
                    Use when the session should still happen, just at a different time. Releases the slot without
                    finalising it and notifies the requester. Goes through the full conflict check again.
                    <span style={confRef}>CONF-13</span>
                  </ResolutionChip>
                </div>
              </StepCard>
              <StepConnector />
              <StepCard n={3} title="After clearing the blocker" color="#c9822b">
                The slot is free. The pending booking can now be forwarded and approved through the normal
                pipeline.
              </StepCard>
            </div>
          </div>
        </section>
      </div>
    </Shell>
  );
}

/* ————————————————————— Page chrome (header + blobbed background) ————————————————————— */

function Shell({ onBack, onSignOut, children }: { onBack: () => void; onSignOut: () => void; children: React.ReactNode }) {
  return (
    <div style={page}>
      <style>{CDR_CSS}</style>
      <div className="cdr-blob cdr-blob-a" aria-hidden />
      <div className="cdr-blob cdr-blob-b" aria-hidden />
      <div className="cdr-blob cdr-blob-c" aria-hidden />
      <div className="cdr-blob cdr-blob-d" aria-hidden />

      <header style={topbar}>
        <div style={brandRow}>
          <span style={crest}>BU</span>
          <span style={wordmark}>Bahria University</span>
        </div>
        <div style={headerActions}>
          <button type="button" className="cdr-back-btn" style={backBtn} onClick={onBack}>
            <BackGlyph /> Back
          </button>
          <button type="button" className="cdr-signout-btn" style={signOutBtn} onClick={onSignOut}>
            <SignOutGlyph /> Sign out
          </button>
        </div>
      </header>

      <div style={titleBand}>
        <span style={eyebrow}>Venue Operations</span>
        <h1 style={pageTitle}>Conflict Detection &amp; Resolution</h1>
      </div>

      <main style={main}>{children}</main>

      <footer style={footer}>
        2026 © <a href="/" style={footerLink}>Bahria University</a>
      </footer>
    </div>
  );
}

/* ————————————————————————————— Session row (card) ————————————————————————————— */

function SessionRow({
  session, busy, onCancel, onReschedule,
}: {
  session: ApprovedSession;
  busy: boolean;
  onCancel: () => void;
  onReschedule: () => void;
}) {
  const startDt = new Date(session.starts_at);
  const endDt = new Date(session.ends_at);
  const sameDay = startDt.toDateString() === endDt.toDateString();

  const dateStr = startDt.toLocaleDateString('en-PK', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  const timeStr = `${startDt.toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' })} – ${endDt.toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' })}${!sameDay ? ` (${endDt.toLocaleDateString('en-PK', { day: 'numeric', month: 'short' })})` : ''}`;

  const requesterLabel = session.requester_name
    ?? session.internal_client_ref
    ?? (session.origin === 'ACADEMIC' ? 'BUKC Sports Department' : '—');

  const status = statusMeta(session.status);

  return (
    <div className="cdr-session-row" style={{ ...sessionRow, borderLeftColor: status.accent }}>
      <div style={sessionRowMain}>
        <div style={sessionCol.venue}>
          <span style={venueIconBox}><PinGlyph /></span>
          <span style={venueName}>{session.venue_name}</span>
        </div>

        <div style={sessionCol.datetime}>
          <span style={dateLine}>{dateStr}</span>
          <span style={timeLine}>{timeStr}</span>
        </div>

        <div style={sessionCol.booking}>
          <span style={bookingLine}>{session.purpose}</span>
          <span style={originTag}>
            {session.origin}{session.session_no > 1 ? ` · session ${session.session_no}` : ''}
          </span>
        </div>

        <div style={sessionCol.requester}>
          <span style={avatarChip}>{initials(requesterLabel)}</span>
          <span style={requesterName}>{requesterLabel}</span>
        </div>

        <div style={sessionCol.status}>
          <span style={{ ...statusPill, background: status.bg, color: status.color }}>
            <span style={{ ...statusDot, background: status.color }} />
            {session.status.replace('_', ' ')}
          </span>
        </div>
      </div>

      <div style={sessionActions}>
        <button
          className="cdr-btn-resched"
          style={reschedBtn}
          disabled={busy}
          onClick={onReschedule}
          title="Mark as Needs Rescheduling"
        >
          <ReschedGlyph /> Reschedule
        </button>
        <button
          className="cdr-btn-cancel"
          style={cancelBtn}
          disabled={busy}
          onClick={onCancel}
          title="Cancel this session"
        >
          <CancelGlyph /> Cancel
        </button>
      </div>
    </div>
  );
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '—';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]!.charAt(0) + parts[parts.length - 1]!.charAt(0)).toUpperCase();
}

function statusMeta(status: string): { bg: string; color: string; accent: string } {
  if (status === 'SCHEDULED') return { bg: '#e4edf6', color: '#0e5da8', accent: '#2e7fc9' };
  if (status === 'IN_PROGRESS') return { bg: '#fdf1de', color: '#a5610f', accent: '#e6a04a' };
  return { bg: '#eef1ef', color: '#4b5a55', accent: '#8a9a94' };
}

/* ———————————————————————————— Small presentational bits ———————————————————————————— */

function StatPill({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <div style={{ ...statPill, borderColor: `${color}33` }}>
      <span style={{ ...statPillValue, color }}>{value}</span>
      <span style={statPillLabel}>{label}</span>
    </div>
  );
}

function StepCard({ n, title, color, children }: { n: number; title: string; color: string; children: React.ReactNode }) {
  return (
    <div style={stepCard} className="cdr-step-card">
      <span style={{ ...stepNum, background: color }}>{n}</span>
      <h3 style={stepTitle}>{title}</h3>
      <div style={stepBody}>{children}</div>
    </div>
  );
}

function StepConnector() {
  return <span style={stepConnector} className="cdr-step-connector" aria-hidden />;
}

function ResolutionChip({ tone, label, children }: { tone: 'danger' | 'info'; label: string; children: React.ReactNode }) {
  const palette = tone === 'danger'
    ? { bg: '#fdf1de', border: '#e8b26a', text: '#a5610f' }
    : { bg: '#e4edf6', border: '#9cbdda', text: '#0e5da8' };
  return (
    <div style={{ ...resolutionChip, background: palette.bg, borderColor: palette.border }}>
      <span style={{ ...resolutionChipLabel, color: palette.text }}>{label}</span>
      <span style={resolutionChipBody}>{children}</span>
    </div>
  );
}

/* ————————————————————————————————— Inline glyphs ————————————————————————————————— */

const GREEN = '#498473';
const GREEN_DARK = '#356255';
const NAVY = '#0B3754';
const MINT = '#DFF0E8';
const SKY = '#E4EDF6';
const PAPER = '#EFF9F5';

function BackGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <path d="M9.5 3 4 8l5.5 5" stroke={GREEN_DARK} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4.5 8H13" stroke={GREEN_DARK} strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}
function SignOutGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
      <path d="M6.5 2H3.5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M10.5 5 14 8l-3.5 3M14 8H6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function ConflictGlyph() {
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" fill={MINT} />
      <path d="M12 7v6" stroke={GREEN_DARK} strokeWidth="2" strokeLinecap="round" />
      <circle cx="12" cy="16.3" r="1.15" fill={GREEN_DARK} />
    </svg>
  );
}
function SearchGlyph({ light }: { light?: boolean } = {}) {
  const c = light ? '#fff' : NAVY;
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
      <circle cx="11" cy="11" r="7" stroke={c} strokeWidth="2" />
      <path d="m20 20-3.2-3.2" stroke={c} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
function ListGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
      <path d="M8 6h13M8 12h13M8 18h13" stroke={NAVY} strokeWidth="2" strokeLinecap="round" />
      <circle cx="3.5" cy="6" r="1.5" fill={GREEN} />
      <circle cx="3.5" cy="12" r="1.5" fill={GREEN} />
      <circle cx="3.5" cy="18" r="1.5" fill={GREEN} />
    </svg>
  );
}
function GuideGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
      <path d="M12 3 3 7.5 12 12l9-4.5L12 3Z" stroke={NAVY} strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M3 12l9 4.5 9-4.5M3 16.5 12 21l9-4.5" stroke={NAVY} strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}
function PinGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
      <path d="M12 22s7-7.2 7-12.5A7 7 0 0 0 5 9.5C5 14.8 12 22 12 22Z" fill={GREEN} fillOpacity="0.18" stroke={GREEN_DARK} strokeWidth="1.6" />
      <circle cx="12" cy="9.5" r="2.4" fill={GREEN_DARK} />
    </svg>
  );
}
function ReschedGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
      <path d="M4 4v6h6" stroke={GREEN_DARK} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4.6 15a8 8 0 1 0 2-8.4L4 10" stroke={GREEN_DARK} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function CancelGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke="#c0392b" strokeWidth="2" />
      <path d="m9 9 6 6m0-6-6 6" stroke="#c0392b" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
function AlertIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
      <path d="M12 3 2 21h20L12 3Z" fill="#991b1b" fillOpacity="0.14" stroke="#991b1b" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M12 10v5" stroke="#991b1b" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="12" cy="17.6" r="1" fill="#991b1b" />
    </svg>
  );
}
function CheckIcon({ big }: { big?: boolean } = {}) {
  const size = big ? 34 : 17;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
      <circle cx="12" cy="12" r="10" fill={big ? MINT : '#166534'} fillOpacity={big ? 1 : 0.14} stroke="#166534" strokeWidth="1.6" />
      <path d="m7.5 12.5 3 3 6-6.5" stroke="#166534" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ————————————————————————————————————— CSS (blobs / hover / motion) ————————————————————————————————————— */

const CDR_CSS = `
@keyframes cdrFloatA { 0%,100% { transform: translate(0,0) scale(1); } 50% { transform: translate(30px,-24px) scale(1.06); } }
@keyframes cdrFloatB { 0%,100% { transform: translate(0,0) scale(1); } 50% { transform: translate(-26px,20px) scale(1.08); } }
@keyframes cdrFloatC { 0%,100% { transform: translate(0,0) scale(1); } 50% { transform: translate(18px,26px) scale(1.05); } }
@keyframes cdrFadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
@keyframes cdrSpin { to { transform: rotate(360deg); } }

.cdr-blob { position: fixed; border-radius: 50%; filter: blur(10px); pointer-events: none; z-index: 0; }
.cdr-blob-a { width: 340px; height: 340px; top: -140px; left: -100px; background: #49847322; animation: cdrFloatA 26s ease-in-out infinite; }
.cdr-blob-b { width: 300px; height: 300px; bottom: -160px; right: -80px; background: #0B375418; animation: cdrFloatB 30s ease-in-out infinite; }
.cdr-blob-c { width: 260px; height: 260px; top: 30%; right: -120px; background: #DFF0E866; animation: cdrFloatC 22s ease-in-out infinite; }
.cdr-blob-d { width: 220px; height: 220px; bottom: 12%; left: 8%; background: #E4EDF677; animation: cdrFloatB 24s ease-in-out infinite; }

.cdr-fade-in { animation: cdrFadeIn 0.5s ease both; }
.cdr-alert { animation: cdrFadeIn 0.35s ease both; }

.cdr-input { transition: border-color 0.18s ease, box-shadow 0.18s ease; }
.cdr-input:focus { outline: none; border-color: #498473 !important; box-shadow: 0 0 0 3px rgba(73,132,115,0.18); }

.cdr-btn-search { transition: transform 0.15s ease, box-shadow 0.15s ease, filter 0.15s ease; }
.cdr-btn-search:hover { transform: translateY(-1px); filter: brightness(1.06); box-shadow: 0 8px 18px rgba(11,55,84,0.28); }
.cdr-btn-search:active { transform: translateY(0); }

.cdr-btn-resched { transition: background 0.15s ease, transform 0.15s ease, box-shadow 0.15s ease; }
.cdr-btn-resched:hover:not(:disabled) { background: #498473 !important; color: #fff !important; transform: translateY(-1px); box-shadow: 0 6px 14px rgba(73,132,115,0.3); }
.cdr-btn-resched:hover:not(:disabled) svg path, .cdr-btn-resched:hover:not(:disabled) svg { stroke: #fff; }

.cdr-btn-cancel { transition: background 0.15s ease, transform 0.15s ease, box-shadow 0.15s ease; }
.cdr-btn-cancel:hover:not(:disabled) { background: #c0392b !important; color: #fff !important; transform: translateY(-1px); box-shadow: 0 6px 14px rgba(192,57,43,0.3); }
.cdr-btn-cancel:hover:not(:disabled) svg path, .cdr-btn-cancel:hover:not(:disabled) svg circle { stroke: #fff; }

.cdr-btn-resched:disabled, .cdr-btn-cancel:disabled { opacity: 0.45; cursor: not-allowed; }

.cdr-session-row { transition: transform 0.16s ease, box-shadow 0.16s ease, border-color 0.16s ease; }
.cdr-session-row:hover { transform: translateY(-2px); box-shadow: 0 10px 26px rgba(11,55,84,0.12); }

.cdr-step-card { transition: transform 0.18s ease, box-shadow 0.18s ease; }
.cdr-step-card:hover { transform: translateY(-3px); box-shadow: 0 12px 24px rgba(11,55,84,0.1); }

.cdr-spin { animation: cdrSpin 0.9s linear infinite; }

.cdr-back-btn, .cdr-signout-btn { transition: background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease; }
.cdr-back-btn:hover { background: #DFF0E8; border-color: #498473aa; color: #356255; }
.cdr-signout-btn:hover { background: #FDECEC; border-color: #F3CACA; color: #8F2323; }

@media (max-width: 860px) {
  .cdr-step-connector { display: none !important; }
}
`;

/* ————————————————————————————————————— Style objects ————————————————————————————————————— */

const page: React.CSSProperties = {
  minHeight: '100%',
  display: 'flex',
  flexDirection: 'column',
  position: 'relative',
  overflow: 'hidden',
  background: `radial-gradient(1200px 600px at 10% -10%, ${SKY} 0%, transparent 55%),
               radial-gradient(1000px 600px at 100% 0%, ${MINT} 0%, transparent 55%),
               ${PAPER}`,
  fontFamily: 'var(--font-body)',
};

const topbar: React.CSSProperties = {
  position: 'relative', zIndex: 2,
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '20px 40px', borderBottom: `1px solid ${palette.line}`,
};
const brandRow: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10 };
const crest: React.CSSProperties = {
  width: 32, height: 32, borderRadius: 9, background: NAVY,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  color: '#fff', fontFamily: 'Poppins, sans-serif', fontWeight: 800, fontSize: 13,
};
const wordmark: React.CSSProperties = { fontFamily: 'Poppins, sans-serif', fontSize: 18, fontWeight: 600, color: NAVY };
const headerActions: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10 };
const backBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 7, background: '#fff', color: GREEN_DARK,
  border: `1.5px solid ${palette.line}`, borderRadius: 999, padding: '8px 16px', fontSize: 13.5, fontWeight: 700,
  cursor: 'pointer', fontFamily: 'inherit',
};
const signOutBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 7, background: '#fff', color: palette.muted,
  border: `1.5px solid ${palette.line}`, borderRadius: 999, padding: '8px 16px', fontSize: 13.5, fontWeight: 700,
  cursor: 'pointer', fontFamily: 'inherit',
};

const titleBand: React.CSSProperties = {
  position: 'relative', zIndex: 2, textAlign: 'center', padding: '30px 24px 14px',
};
const eyebrow: React.CSSProperties = {
  display: 'inline-block', fontSize: 11.5, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase',
  color: GREEN_DARK, background: 'rgba(73,132,115,0.12)', padding: '4px 12px', borderRadius: 999, marginBottom: 10,
};
const pageTitle: React.CSSProperties = {
  margin: 0, fontSize: 32, fontWeight: 800, color: NAVY, letterSpacing: '-0.01em',
  fontFamily: 'var(--font-display, "Segoe UI"), system-ui, sans-serif',
};

const main: React.CSSProperties = { position: 'relative', zIndex: 2, flex: 1, padding: '28px 24px 56px' };

const footer: React.CSSProperties = {
  position: 'relative', zIndex: 2, textAlign: 'center', padding: '16px 24px', fontSize: 13, color: '#3d5b52',
  borderTop: `1px solid rgba(73,132,115,0.2)`,
};
const footerLink: React.CSSProperties = { color: GREEN_DARK, textDecoration: 'none', fontWeight: 600 };

const wrap: React.CSSProperties = { maxWidth: 1040, margin: '0 auto' };

const glassCard: React.CSSProperties = {
  background: 'rgba(255,255,255,0.72)',
  backdropFilter: 'blur(14px)',
  WebkitBackdropFilter: 'blur(14px)',
  border: '1px solid rgba(255,255,255,0.6)',
  borderRadius: 18,
  boxShadow: '0 8px 30px rgba(11,55,84,0.08)',
  overflow: 'hidden',
};

const heroCard: React.CSSProperties = {
  display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'center',
  padding: '22px 26px', marginBottom: 22,
  borderLeft: `4px solid ${GREEN}`,
};
const heroIconWrap: React.CSSProperties = {
  width: 54, height: 54, borderRadius: 14, background: SKY,
  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
};
const heroTitle: React.CSSProperties = { margin: '0 0 6px', fontSize: 17, fontWeight: 800, color: NAVY };
const heroText: React.CSSProperties = { margin: 0, fontSize: 13.5, lineHeight: 1.65, color: '#3d5259', maxWidth: 620 };
const confRef: React.CSSProperties = {
  display: 'inline-block', marginLeft: 8, fontFamily: 'var(--font-mono)', fontSize: 10.5, fontWeight: 700,
  color: GREEN_DARK, background: 'rgba(73,132,115,0.14)', padding: '1px 7px', borderRadius: 5, letterSpacing: 0.3,
};
const heroStats: React.CSSProperties = { display: 'flex', gap: 10, flexWrap: 'wrap' };
const statPill: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
  minWidth: 74, padding: '8px 10px', borderRadius: 12, background: '#fff',
  border: '1px solid rgba(11,55,84,0.08)', boxShadow: '0 2px 8px rgba(11,55,84,0.05)',
};
const statPillValue: React.CSSProperties = { fontSize: 20, fontWeight: 800, lineHeight: 1.1, fontFamily: 'var(--font-mono)' };
const statPillLabel: React.CSSProperties = { fontSize: 10, fontWeight: 600, color: '#7c8a90', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 2 };

const panelHead: React.CSSProperties = {
  padding: '14px 22px', borderBottom: '1px solid rgba(11,55,84,0.08)',
  font: '700 14.5px var(--font-body)', color: NAVY,
  background: 'linear-gradient(180deg, rgba(255,255,255,0.9), rgba(239,249,245,0.5))',
  display: 'flex', alignItems: 'center', gap: 10,
};
const panelHeadIcon: React.CSSProperties = {
  width: 26, height: 26, borderRadius: 8, background: MINT,
  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
};
const panelBody: React.CSSProperties = { padding: '18px 22px 20px' };

const filterRow: React.CSSProperties = { display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap' };
const lbl: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 6, font: '700 11.5px var(--font-body)',
  color: NAVY, textTransform: 'uppercase', letterSpacing: '0.04em', minWidth: 150,
};
const inp: React.CSSProperties = {
  font: '13.5px var(--font-body)', padding: '9px 12px', border: '1.5px solid rgba(11,55,84,0.16)',
  borderRadius: 10, background: '#fff', color: '#1a2b33',
};
const searchBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, padding: '10px 22px',
  background: `linear-gradient(135deg, ${GREEN}, ${GREEN_DARK})`, color: '#fff', border: 'none',
  borderRadius: 10, font: '700 13.5px var(--font-body)', cursor: 'pointer',
  boxShadow: '0 4px 12px rgba(73,132,115,0.3)',
};

const countBadge: React.CSSProperties = {
  marginLeft: 'auto', font: '700 11.5px var(--font-mono)', background: MINT, color: GREEN_DARK,
  padding: '3px 10px', borderRadius: 999,
};

const emptyState: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
  padding: '30px 10px', textAlign: 'center',
};
const spinner: React.CSSProperties = {
  width: 26, height: 26, borderRadius: '50%',
  border: `3px solid ${MINT}`, borderTopColor: GREEN, display: 'inline-block',
};
const muted: React.CSSProperties = { color: '#7c8a90', fontSize: 13.5, margin: 0 };

const cardList: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 12 };

const sessionRow: React.CSSProperties = {
  display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 14,
  background: '#fff', border: '1px solid rgba(11,55,84,0.07)', borderLeft: '4px solid transparent',
  borderRadius: 14, padding: '14px 18px', boxShadow: '0 2px 10px rgba(11,55,84,0.05)',
};
const sessionRowMain: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 22, flex: 1, minWidth: 0 };
const sessionCol = {
  venue: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 120 } as React.CSSProperties,
  datetime: { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 150 } as React.CSSProperties,
  booking: { display: 'flex', flexDirection: 'column', gap: 3, minWidth: 150 } as React.CSSProperties,
  requester: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 140 } as React.CSSProperties,
  status: { display: 'flex', alignItems: 'center' } as React.CSSProperties,
};
const venueIconBox: React.CSSProperties = {
  width: 26, height: 26, borderRadius: 8, background: MINT,
  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
};
const venueName: React.CSSProperties = { fontSize: 13.5, fontWeight: 700, color: NAVY };
const dateLine: React.CSSProperties = { fontSize: 13, fontWeight: 700, color: '#1a2b33' };
const timeLine: React.CSSProperties = { fontSize: 12, color: '#7c8a90', fontFamily: 'var(--font-mono)' };
const bookingLine: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: '#1a2b33' };
const originTag: React.CSSProperties = { fontSize: 10.5, fontWeight: 600, color: '#8a949f', textTransform: 'uppercase', letterSpacing: '0.04em' };
const avatarChip: React.CSSProperties = {
  width: 26, height: 26, borderRadius: '50%', background: `linear-gradient(135deg, ${GREEN}, ${NAVY})`,
  color: '#fff', fontSize: 10.5, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
};
const requesterName: React.CSSProperties = { fontSize: 12.5, color: '#3d5259', fontWeight: 500 };

const statusPill: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 11px', borderRadius: 999,
  font: '700 10.5px var(--font-mono)', letterSpacing: '0.03em', textTransform: 'uppercase',
};
const statusDot: React.CSSProperties = { width: 6, height: 6, borderRadius: '50%' };

const sessionActions: React.CSSProperties = { display: 'flex', gap: 8, flexShrink: 0 };
const cancelBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6, padding: '7px 13px', background: '#fff',
  border: '1.5px solid #c0392b', color: '#c0392b', borderRadius: 9, font: '700 12px var(--font-body)', cursor: 'pointer',
};
const reschedBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6, padding: '7px 13px', background: '#fff',
  border: `1.5px solid ${GREEN}`, color: GREEN_DARK, borderRadius: 9, font: '700 12px var(--font-body)', cursor: 'pointer',
};

const stepsRow: React.CSSProperties = { display: 'flex', alignItems: 'stretch', gap: 4, flexWrap: 'wrap' };
const stepCard: React.CSSProperties = {
  flex: '1 1 240px', background: '#fff', border: '1px solid rgba(11,55,84,0.07)', borderRadius: 14,
  padding: '18px 16px 16px', position: 'relative', boxShadow: '0 2px 10px rgba(11,55,84,0.05)',
};
const stepNum: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, borderRadius: '50%',
  color: '#fff', fontSize: 13.5, fontWeight: 800, marginBottom: 10, fontFamily: 'var(--font-mono)',
};
const stepTitle: React.CSSProperties = { margin: '0 0 8px', fontSize: 13.5, fontWeight: 800, color: NAVY };
const stepBody: React.CSSProperties = { fontSize: 12.5, lineHeight: 1.6, color: '#4b5a55' };
const stepConnector: React.CSSProperties = {
  alignSelf: 'center', width: 26, height: 2, background: `linear-gradient(90deg, ${MINT}, ${SKY})`, flexShrink: 0, marginTop: -20,
};

const resolutionChip: React.CSSProperties = { border: '1px solid', borderRadius: 10, padding: '8px 10px' };
const resolutionChipLabel: React.CSSProperties = { display: 'block', fontSize: 11.5, fontWeight: 800, marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.03em' };
const resolutionChipBody: React.CSSProperties = { fontSize: 12, lineHeight: 1.55, color: '#4b5a55' };

const box = {
  err: {
    display: 'flex', alignItems: 'center', gap: 9,
    background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 12, padding: '11px 16px',
    color: '#991b1b', marginBottom: 16, fontSize: 13.5, fontWeight: 600,
  } as React.CSSProperties,
  ok: {
    display: 'flex', alignItems: 'center', gap: 9,
    background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 12, padding: '11px 16px',
    color: '#166534', marginBottom: 16, fontSize: 13.5, fontWeight: 600,
  } as React.CSSProperties,
};
