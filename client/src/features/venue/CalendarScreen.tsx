/**
 * Calendar (CAL-01..05) — shows only approved, conflict-free sessions.
 * Open to every role; read-only.
 */
import { useEffect, useState, useCallback } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth.js';
import { PortalShell } from '../auth/PortalShell.js';
import { listCalendar, listVenues, type CalendarSession, type Venue } from './api.js';
import { ApiRequestError } from '../../lib/api.js';

function errMsg(e: unknown) { return e instanceof ApiRequestError ? e.body.error : 'Something went wrong.'; }

export default function CalendarScreen() {
  const { user, loading } = useAuth();
  const [sessions, setSessions] = useState<CalendarSession[]>([]);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [venueId, setVenueId] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, v] = await Promise.all([listCalendar(venueId ? { venueId } : undefined), listVenues()]);
      setSessions(s.sessions); setVenues(v.venues);
    } catch (e) { setError(errMsg(e)); }
  }, [venueId]);
  useEffect(() => { void load(); }, [load]);

  if (loading) return <PortalShell title="Calendar"><p /></PortalShell>;
  if (!user) return <Navigate to="/" replace />;

  const statusStyle = (s: string) => s === 'SCHEDULED' ? badge.ok : s === 'IN_PROGRESS' ? badge.warn : badge.neutral;

  return (
    <PortalShell title="Venue Calendar" tint="blue">
      <div style={wrap}>
        {error && <div style={box.err}>{error}</div>}
        <div style={filterRow}>
          <select style={select} value={venueId} onChange={(e) => setVenueId(Number(e.target.value))}>
            <option value={0}>All venues</option>
            {venues.map((v) => <option key={v.venue_id} value={v.venue_id}>{v.name}</option>)}
          </select>
        </div>
        {sessions.length === 0 ? <p style={muted}>No approved sessions{venueId ? ' for this venue' : ''} yet.</p> : (
          <table style={table}>
            <thead><tr><th style={th}>Venue</th><th style={th}>When</th><th style={th}>Origin</th><th style={th}>Status</th></tr></thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.session_id}>
                  <td style={td}>{s.venue_name}</td>
                  <td style={td}>{new Date(s.starts_at).toLocaleString()} → {new Date(s.ends_at).toLocaleTimeString()}</td>
                  <td style={td}>{s.origin}</td>
                  <td style={td}><span style={{ ...badgeBase, ...statusStyle(s.status) }}>{s.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </PortalShell>
  );
}

const wrap: React.CSSProperties = { maxWidth: 860, margin: '0 auto' };
const filterRow: React.CSSProperties = { marginBottom: 16 };
const select: React.CSSProperties = { font: '14px var(--font-body)', padding: '8px 12px', border: '1px solid #ccc', borderRadius: 4, background: '#fff' };
const table: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 14, background: '#fff', border: '1px solid #ddd', borderRadius: 4 };
const th: React.CSSProperties = { textAlign: 'left', font: '600 11px var(--font-body)', color: '#888', textTransform: 'uppercase', letterSpacing: '0.04em', padding: '10px 12px', borderBottom: '1px solid #e5e5e5' };
const td: React.CSSProperties = { padding: '10px 12px', borderBottom: '1px solid #eee', color: '#333' };
const muted: React.CSSProperties = { color: '#5c6773', fontSize: 14.5 };
const badgeBase: React.CSSProperties = { font: '600 11px var(--font-mono)', padding: '2px 7px', borderRadius: 4 };
const badge = {
  ok: { background: '#e6f4ec', color: '#1f7a45' } as React.CSSProperties,
  warn: { background: '#fdf1e3', color: '#9a6412' } as React.CSSProperties,
  neutral: { background: '#eceff2', color: '#566' } as React.CSSProperties,
};
const box = {
  err: { background: '#fdecec', color: '#8f2323', border: '1px solid #f3caca', borderRadius: 4, padding: '10px 14px', marginBottom: 16, fontSize: 14 } as React.CSSProperties,
};
