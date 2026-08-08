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
 */
import { useEffect, useState, useCallback } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth.js';
import { PortalShell } from '../auth/PortalShell.js';
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
  const { user, loading } = useAuth();
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

  if (loading) return <PortalShell title="Conflict Detection"><p /></PortalShell>;
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

  return (
    <PortalShell title="Conflict Detection &amp; Resolution" tint="slate">
      <div style={wrap}>
        {error && <div style={box.err}>{error}</div>}
        {notice && <div style={box.ok}>{notice}</div>}

        <section style={panel}>
          <div style={panelHead}>Find Booked Slots</div>
          <div style={panelBody}>
            <p style={helpText}>
              This view shows all currently active (SCHEDULED / IN PROGRESS) venue sessions.
              Use it to identify which booking holds a contested slot, then cancel or reschedule
              the blocking session to free the slot. No role can force-approve into an existing
              conflict — the blocker must be cleared first (CONF-14).
            </p>
            <div style={filterRow}>
              <label style={lbl}>
                Venue
                <select style={inp} value={venueFilter} onChange={(e) => setVenueFilter(Number(e.target.value))}>
                  <option value={0}>All venues</option>
                  {venues.map((v) => (
                    <option key={v.venue_id} value={v.venue_id}>{v.name}</option>
                  ))}
                </select>
              </label>
              <label style={lbl}>
                From
                <input type="date" style={inp} value={fromFilter} onChange={(e) => setFromFilter(e.target.value)} />
              </label>
              <label style={lbl}>
                To
                <input type="date" style={inp} value={toFilter} onChange={(e) => setToFilter(e.target.value)} />
              </label>
              <button style={searchBtn} onClick={search}>Search</button>
            </div>
          </div>
        </section>

        <section style={panel}>
          <div style={panelHead}>
            Active Sessions
            {sessions !== null && (
              <span style={countBadge}>{sessions.length} session{sessions.length !== 1 ? 's' : ''}</span>
            )}
          </div>
          <div style={panelBody}>
            {sessions === null ? (
              <p style={muted}>Loading…</p>
            ) : sessions.length === 0 ? (
              <p style={muted}>No active sessions match the filter — no conflicts to resolve.</p>
            ) : (
              <table style={table}>
                <thead>
                  <tr>
                    <th style={th}>Venue</th>
                    <th style={th}>Date &amp; Time</th>
                    <th style={th}>Booking</th>
                    <th style={th}>Requester</th>
                    <th style={th}>Status</th>
                    <th style={th} />
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((s) => (
                    <SessionRow
                      key={s.session_id}
                      session={s}
                      busy={busy}
                      onCancel={() => handleCancel(s.session_id)}
                      onReschedule={() => handleReschedule(s.session_id)}
                    />
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>

        <section style={panel}>
          <div style={panelHead}>How to Resolve a Conflict</div>
          <div style={panelBody}>
            <ol style={guideList}>
              <li style={guideItem}>
                <strong>Identify the blocker</strong> — find the session that is holding the slot a new booking needs.
                Use the venue and date filters to narrow down.
              </li>
              <li style={guideItem}>
                <strong>Choose a resolution</strong>:
                <ul style={subList}>
                  <li><strong>Cancel</strong> — use when the session will not happen (maintenance, withdrawal). Writes a CANCELLED usage history record permanently.</li>
                  <li><strong>Mark Needs Rescheduling</strong> — use when the session should still happen but at a different time. Releases the slot without finalising the session, and notifies the requester. The rescheduled time will go through the full conflict check again (CONF-13).</li>
                </ul>
              </li>
              <li style={guideItem}>
                <strong>After clearing the blocker</strong> — the slot is free. The pending booking can now be forwarded and approved through the normal pipeline.
              </li>
            </ol>
          </div>
        </section>
      </div>
    </PortalShell>
  );
}

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

  return (
    <tr>
      <td style={td}>{session.venue_name}</td>
      <td style={td}>
        <span style={{ display: 'block', fontWeight: 600, fontSize: 13 }}>{dateStr}</span>
        <span style={{ color: '#5c6773', fontSize: 12.5 }}>{timeStr}</span>
      </td>
      <td style={td}>
        <span style={{ display: 'block', fontSize: 13 }}>{session.purpose}</span>
        <span style={{ color: '#8a949f', fontSize: 11.5 }}>
          {session.origin}{session.session_no > 1 ? ` · session ${session.session_no}` : ''}
        </span>
      </td>
      <td style={td}>{requesterLabel}</td>
      <td style={td}>
        <span style={{ ...badgeBase, ...statusColor(session.status) }}>{session.status}</span>
      </td>
      <td style={{ ...td, textAlign: 'right' }}>
        <span style={{ display: 'inline-flex', gap: 6 }}>
          <button style={reschedBtn} disabled={busy} onClick={onReschedule} title="Mark as Needs Rescheduling">
            Reschedule
          </button>
          <button style={cancelBtn} disabled={busy} onClick={onCancel} title="Cancel this session">
            Cancel
          </button>
        </span>
      </td>
    </tr>
  );
}

function statusColor(status: string): React.CSSProperties {
  if (status === 'SCHEDULED') return { background: '#e3f2fd', color: '#1565c0' };
  if (status === 'IN_PROGRESS') return { background: '#fff8e1', color: '#e65100' };
  return { background: '#f5f5f5', color: '#555' };
}

const wrap: React.CSSProperties = { maxWidth: 960, margin: '0 auto' };
const panel: React.CSSProperties = {
  background: '#fff', border: '1px solid #ddd', borderRadius: 4,
  marginBottom: 18, boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
};
const panelHead: React.CSSProperties = {
  padding: '12px 18px', borderBottom: '1px solid #e5e5e5',
  font: '600 15px var(--font-body)', color: '#333',
  background: 'linear-gradient(#fff,#f7f7f7)',
  display: 'flex', alignItems: 'center', gap: 10,
};
const panelBody: React.CSSProperties = { padding: '16px 18px' };
const filterRow: React.CSSProperties = { display: 'flex', gap: 14, alignItems: 'flex-end', flexWrap: 'wrap' };
const lbl: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, font: '500 12.5px var(--font-body)', color: '#26485f' };
const inp: React.CSSProperties = { font: '13.5px var(--font-body)', padding: '7px 9px', border: '1px solid #ccc', borderRadius: 4 };
const searchBtn: React.CSSProperties = {
  padding: '8px 18px', background: '#26485f', color: '#fff', border: 'none',
  borderRadius: 4, font: '600 13px var(--font-body)', cursor: 'pointer',
};
const table: React.CSSProperties = { width: '100%', borderCollapse: 'collapse' };
const th: React.CSSProperties = {
  textAlign: 'left', padding: '8px 10px', font: '600 12px var(--font-body)',
  color: '#5c6773', borderBottom: '1px solid #e5e5e5',
};
const td: React.CSSProperties = {
  padding: '10px 10px', font: '13.5px var(--font-body)',
  borderBottom: '1px solid #f0f0f0', verticalAlign: 'top',
};
const badgeBase: React.CSSProperties = {
  display: 'inline-block', padding: '2px 8px', borderRadius: 3,
  font: '500 11.5px var(--font-mono)', letterSpacing: '0.02em',
};
const cancelBtn: React.CSSProperties = {
  padding: '5px 10px', background: '#fff', border: '1px solid #c0392b',
  color: '#c0392b', borderRadius: 4, font: '500 12px var(--font-body)', cursor: 'pointer',
};
const reschedBtn: React.CSSProperties = {
  padding: '5px 10px', background: '#fff', border: '1px solid #26485f',
  color: '#26485f', borderRadius: 4, font: '500 12px var(--font-body)', cursor: 'pointer',
};
const muted: React.CSSProperties = { color: '#8a949f', fontSize: 14, margin: 0 };
const helpText: React.CSSProperties = {
  color: '#5c6773', fontSize: 13.5, marginTop: 0, marginBottom: 16, lineHeight: 1.6,
};
const countBadge: React.CSSProperties = {
  font: '500 12px var(--font-mono)', background: '#e8edf2', color: '#26485f',
  padding: '2px 8px', borderRadius: 10,
};
const guideList: React.CSSProperties = { paddingLeft: 22, margin: 0, color: '#444', fontSize: 13.5 };
const guideItem: React.CSSProperties = { marginBottom: 10, lineHeight: 1.65 };
const subList: React.CSSProperties = { marginTop: 6, paddingLeft: 18, lineHeight: 1.65 };

const box = {
  err: { background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 4, padding: '10px 14px', color: '#991b1b', marginBottom: 14, fontSize: 14 } as React.CSSProperties,
  ok: { background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 4, padding: '10px 14px', color: '#166534', marginBottom: 14, fontSize: 14 } as React.CSSProperties,
};
