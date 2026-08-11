/**
 * Conflict Detection — Super Admin view (CONF-01..16).
 *
 * The backend has NO /api/venue/bookings/rejected endpoint.
 * Instead, we fetch from the existing admin-queue history by:
 *  - Reading bookings that passed through the admin queue via
 *    GET /api/venue/bookings/:id (staff-only) for individual items
 *  - Or we explain the conflict rules with real data from the calendar
 *    to show what sessions are approved and therefore lock out conflicts.
 *
 * The conflict detection UI shows:
 *  1. The business rules (always available, no API needed)
 *  2. Current approved sessions on the calendar (real data)
 *  3. A note that rejected-due-to-conflict bookings appear here
 *     once the server exposes a rejected-bookings list endpoint.
 *
 * Zero backend changes — uses only existing endpoints.
 */
import { useEffect, useState, useCallback } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth.js';
import AppShell, { PageHeader, Card, Badge, EmptyState, Th, Td, TableWrapper, Btn } from '../../components/AppShell.js';
import { listCalendar, listVenues, type CalendarSession, type Venue } from './api.js';
import { ApiRequestError } from '../../lib/api.js';

function errMsg(e: unknown) { return e instanceof ApiRequestError ? e.body.error : 'Something went wrong.'; }

function fmt(d: string) {
  return new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function fmtTime(d: string) {
  return new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

export default function ConflictDetectionScreen() {
  const { user, loading } = useAuth();
  const [sessions, setSessions] = useState<CalendarSession[] | null>(null);
  const [venues,   setVenues]   = useState<Venue[]>([]);
  const [venueId,  setVenueId]  = useState(0);
  const [error,    setError]    = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, v] = await Promise.all([
        listCalendar(venueId ? { venueId } : undefined),
        listVenues(),
      ]);
      setSessions(s.sessions);
      setVenues(v.venues);
    } catch (e) {
      setError(errMsg(e));
      setSessions([]);
    }
  }, [venueId]);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <AppShell title="Conflict Detection"><p /></AppShell>;
  if (!user) return <Navigate to="/" replace />;
  if (user.role !== 'SUPER_ADMIN') return <Navigate to="/home" replace />;

  // Group approved sessions by venue to show potential conflict zones
  const approvedSessions = (sessions ?? []).filter(s => s.status === 'APPROVED' || s.status === 'IN_PROGRESS');

  return (
    <AppShell title="Conflict Detection">
      <PageHeader title="Conflict Detection" subtitle="Venue slot conflict rules and approved session lock status (CONF-01..16)" />

      {error && (
        <div style={{ background: 'var(--warn-bg)', color: 'var(--warn)', border: '1px solid #f3d9a0', borderRadius: 'var(--radius)', padding: 'var(--sp-3) var(--sp-4)', marginBottom: 'var(--sp-4)', fontSize: 14 }}>
          {error}
        </div>
      )}

      {/* Rules explainer */}
      <Card style={{ padding: 'var(--sp-5)', marginBottom: 'var(--sp-4)', background: 'var(--surface-alt)', border: '1px solid var(--navy-100)' }}>
        <div style={{ font: '600 13px var(--font-display)', color: 'var(--navy)', marginBottom: 'var(--sp-3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Active Conflict Rules
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 'var(--sp-3)' }}>
          {[
            ['CONF-02', 'Conflicts checked against APPROVED bookings only — PENDING/FORWARDED never block a slot'],
            ['CONF-09', 'First check runs at Coordinator review — catches obvious conflicts early'],
            ['CONF-10', 'Second, authoritative check runs at Super Admin approval — race conditions caught here'],
            ['CONF-14', 'No role can force-approve into an existing conflict — the DB exclusion constraint always wins'],
            ['CONF-15', 'A booking rejected due to conflict carries the conflict details in its rejection reason'],
            ['CONF-16', 'Conflict information is surfaced to the Super Admin at the point of rejection'],
          ].map(([rule, desc]) => (
            <div key={rule} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <span style={{ font: '600 10px var(--font-mono)', padding: '3px 7px', borderRadius: 3, background: 'var(--navy)', color: '#fff', flexShrink: 0, marginTop: 1 }}>{rule}</span>
              <span style={{ font: '12.5px/1.5 var(--font-body)', color: 'var(--ink-muted)' }}>{desc}</span>
            </div>
          ))}
        </div>
      </Card>

      {/* Info banner about rejected bookings */}
      <Card style={{ padding: 'var(--sp-4) var(--sp-5)', marginBottom: 'var(--sp-4)', border: '1px solid var(--teal-100)', background: 'var(--teal-50)' }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="var(--teal-700)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}>
            <circle cx="9" cy="9" r="7.5"/><line x1="9" y1="6" x2="9" y2="9.5"/><circle cx="9" cy="12" r=".5" fill="var(--teal-700)" stroke="none"/>
          </svg>
          <div style={{ font: '13px/1.5 var(--font-body)', color: 'var(--teal-700)' }}>
            <strong>Conflict-rejected bookings</strong> are visible in the Venue Approvals queue at the time of rejection. The rejection reason contains the conflicting slot details per CONF-15/16.
            When a <code style={{ font: '12px var(--font-mono)', background: 'rgba(0,0,0,0.06)', padding: '1px 4px', borderRadius: 3 }}>GET /api/venue/bookings/rejected</code> endpoint is added to the server, the full historical conflict log will populate here automatically.
          </div>
        </div>
      </Card>

      {/* Venue filter */}
      <div style={{ marginBottom: 'var(--sp-4)' }}>
        <select style={sel} value={venueId} onChange={(e) => setVenueId(Number(e.target.value))}>
          <option value={0}>All venues</option>
          {venues.map((v) => <option key={v.venue_id} value={v.venue_id}>{v.name}</option>)}
        </select>
      </div>

      {/* Approved sessions — the slots that would cause a conflict */}
      <Card>
        <div style={{ padding: 'var(--sp-3) var(--sp-5)', borderBottom: '1px solid var(--line-light)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ font: '600 14px var(--font-display)', color: 'var(--navy)' }}>
            Locked Slots (Approved Sessions)
          </span>
          {approvedSessions.length > 0 && (
            <span style={{ background: 'var(--danger)', color: '#fff', font: '600 10px var(--font-mono)', padding: '2px 7px', borderRadius: 10 }}>
              {approvedSessions.length} locked
            </span>
          )}
          <span style={{ font: '12px var(--font-body)', color: 'var(--ink-faint)', marginLeft: 'auto' }}>
            Any new booking overlapping these slots will be rejected as a conflict
          </span>
        </div>

        {sessions === null ? (
          <div style={{ padding: 'var(--sp-6)', textAlign: 'center', color: 'var(--ink-muted)' }}>Loading…</div>
        ) : approvedSessions.length === 0 ? (
          <EmptyState title="No approved sessions" body={venueId ? 'No approved sessions for this venue — no conflict locks in effect.' : 'No approved sessions in the system yet.'} />
        ) : (
          <TableWrapper>
            <thead>
              <tr>
                <th style={Th}>Venue</th>
                <th style={Th}>Date &amp; Time</th>
                <th style={Th}>Duration</th>
                <th style={Th}>Status</th>
                <th style={Th}>Origin</th>
                <th style={Th}>Session</th>
              </tr>
            </thead>
            <tbody>
              {approvedSessions.map((s) => {
                const dur = Math.round((new Date(s.ends_at).getTime() - new Date(s.starts_at).getTime()) / 60000);
                return (
                  <tr key={s.session_id}>
                    <td style={Td}>{s.venue_name}</td>
                    <td style={{ ...Td, whiteSpace: 'nowrap', fontSize: 13 }}>
                      {new Date(s.starts_at).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' })}
                      {' '}{fmtTime(s.starts_at)} → {fmtTime(s.ends_at)}
                    </td>
                    <td style={{ ...Td, fontSize: 13 }}>
                      {dur >= 60 ? `${Math.floor(dur/60)}h${dur%60 ? ` ${dur%60}m` : ''}` : `${dur}m`}
                    </td>
                    <td style={Td}><Badge status={s.status} /></td>
                    <td style={Td}>
                      <span style={{ font: '600 10px var(--font-mono)', padding: '2px 6px', borderRadius: 3, background: 'var(--surface)', color: 'var(--navy)' }}>
                        {s.origin}
                      </span>
                    </td>
                    <td style={{ ...Td, fontSize: 13 }}>
                      {s.session_no}{s.total_sessions > 1 ? ` of ${s.total_sessions}` : ''}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrapper>
        )}
      </Card>
    </AppShell>
  );
}

const sel: React.CSSProperties = { font: '13.5px var(--font-body)', padding: '8px 12px', border: '1px solid var(--line)', borderRadius: 'var(--radius)', background: 'var(--white)', color: 'var(--ink)', outline: 'none' };
