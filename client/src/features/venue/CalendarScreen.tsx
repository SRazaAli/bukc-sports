/**
 * Venue Calendar — all roles, read-only (CAL-01..05). Redesigned with AppShell.
 * Backend unchanged: listCalendar, listVenues.
 */
import { useEffect, useState, useCallback } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth.js';
import AppShell, { PageHeader, Card, Badge, EmptyState, ErrorBox, Th, Td, TableWrapper } from '../../components/AppShell.js';
import { listCalendar, listVenues, type CalendarSession, type Venue } from './api.js';
import { ApiRequestError } from '../../lib/api.js';

function errMsg(e: unknown) { return e instanceof ApiRequestError ? e.body.error : 'Something went wrong.'; }
function fmtDT(d: string) { return new Date(d).toLocaleString('en-GB', { weekday:'short', day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }); }

export default function CalendarScreen() {
  const { user, loading } = useAuth();
  const [sessions, setSessions] = useState<CalendarSession[]>([]);
  const [venues,   setVenues]   = useState<Venue[]>([]);
  const [venueId,  setVenueId]  = useState(0);
  const [error,    setError]    = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, v] = await Promise.all([listCalendar(venueId ? { venueId } : undefined), listVenues()]);
      setSessions(s.sessions); setVenues(v.venues);
    } catch (e) { setError(errMsg(e)); }
  }, [venueId]);
  useEffect(() => { void load(); }, [load]);

  if (loading) return <AppShell title="Calendar"><p /></AppShell>;
  if (!user) return <Navigate to="/" replace />;

  // Group sessions by date
  const byDate: Record<string, CalendarSession[]> = {};
  sessions.forEach((s) => {
    const d = new Date(s.starts_at).toLocaleDateString('en-GB', { weekday:'long', day:'2-digit', month:'long', year:'numeric' });
    (byDate[d] = byDate[d] ?? []).push(s);
  });

  return (
    <AppShell title="Venue Calendar">
      <PageHeader title="Venue Calendar" subtitle="All approved and scheduled venue sessions" />
      {error && <ErrorBox message={error} />}

      {/* Filter */}
      <div style={{ marginBottom: 'var(--sp-4)' }}>
        <select style={sel} value={venueId} onChange={(e) => setVenueId(Number(e.target.value))}>
          <option value={0}>All venues</option>
          {venues.map((v) => <option key={v.venue_id} value={v.venue_id}>{v.name}</option>)}
        </select>
      </div>

      {sessions.length === 0 ? (
        <EmptyState title="No sessions scheduled" body={venueId ? 'No sessions for this venue.' : 'No approved sessions in the system yet.'} />
      ) : Object.entries(byDate).map(([date, daySessions]) => (
        <div key={date} style={{ marginBottom: 'var(--sp-4)' }}>
          <div style={{ font: '600 12px var(--font-body)', color: 'var(--ink-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 'var(--sp-2)' }}>{date}</div>
          <Card>
            <TableWrapper>
              <thead><tr><th style={Th}>Venue</th><th style={Th}>Time</th><th style={Th}>Session</th><th style={Th}>Status</th><th style={Th}>Type</th></tr></thead>
              <tbody>{daySessions.map((s) => (
                <tr key={s.session_id}>
                  <td style={Td}>{s.venue_name}</td>
                  <td style={{ ...Td, whiteSpace: 'nowrap', fontSize: 13 }}>
                    {new Date(s.starts_at).toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' })} → {new Date(s.ends_at).toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' })}
                  </td>
                  <td style={Td}>Session {s.session_no}{s.total_sessions > 1 ? ` of ${s.total_sessions}` : ''}</td>
                  <td style={Td}><Badge status={s.status} /></td>
                  <td style={Td}><span style={{ font: '600 10px var(--font-mono)', background: 'var(--surface-alt)', color: 'var(--navy)', padding: '2px 6px', borderRadius: 4 }}>{s.origin}</span></td>
                </tr>
              ))}</tbody>
            </TableWrapper>
          </Card>
        </div>
      ))}
    </AppShell>
  );
}

const sel: React.CSSProperties = { font: '13.5px var(--font-body)', padding: '7px 10px', border: '1px solid var(--line)', borderRadius: 'var(--radius)', background: 'var(--white)', color: 'var(--ink)', outline: 'none' };
