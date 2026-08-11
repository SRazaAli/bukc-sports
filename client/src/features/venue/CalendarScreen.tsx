/**
 * Venue Calendar — all roles, read-only (CAL-01..05). Redesigned with AppShell.
 * More visual space per session: each day is a card with session cards inside.
 */
import { useEffect, useState, useCallback } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth.js';
import AppShell, { PageHeader, Card, Badge, EmptyState, ErrorBox } from '../../components/AppShell.js';
import { listCalendar, listVenues, type CalendarSession, type Venue } from './api.js';
import { ApiRequestError } from '../../lib/api.js';

function errMsg(e: unknown) { return e instanceof ApiRequestError ? e.body.error : 'Something went wrong.'; }

const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function fmtDate(d: string) {
  const dt = new Date(d);
  return { day: DAY_NAMES[dt.getDay()], date: dt.getDate(), month: MONTH_NAMES[dt.getMonth()], year: dt.getFullYear() };
}
function fmtTime(d: string) {
  return new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}
function durationMin(start: string, end: string) {
  return Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000);
}

const ORIGIN_COLOR: Record<string, string> = {
  CLIENT:   'var(--teal)',
  EXTERNAL: 'var(--info)',
  ACADEMIC: 'var(--navy)',
};

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

  // Group sessions by date string (YYYY-MM-DD)
  const byDate: Map<string, CalendarSession[]> = new Map();
  sessions.forEach((s) => {
    const key = s.starts_at.slice(0, 10);
    const arr = byDate.get(key) ?? [];
    arr.push(s);
    byDate.set(key, arr);
  });

  // Sort dates ascending
  const sortedDates = [...byDate.keys()].sort();

  return (
    <AppShell title="Venue Calendar">
      <PageHeader title="Venue Calendar" subtitle="All approved sessions — updated in real time" />
      {error && <ErrorBox message={error} />}

      {/* Filter */}
      <div style={{ marginBottom: 'var(--sp-5)' }}>
        <select style={sel} value={venueId} onChange={(e) => setVenueId(Number(e.target.value))}>
          <option value={0}>All venues</option>
          {venues.map((v) => <option key={v.venue_id} value={v.venue_id}>{v.name}</option>)}
        </select>
      </div>

      {sessions.length === 0 ? (
        <EmptyState title="No sessions scheduled" body={venueId ? 'No approved sessions for this venue.' : 'No approved sessions in the system yet.'} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
          {sortedDates.map((dateKey) => {
            const daySessions = byDate.get(dateKey)!;
            const { day, date, month, year } = fmtDate(daySessions[0].starts_at);
            const isToday = dateKey === new Date().toISOString().slice(0, 10);

            return (
              <div key={dateKey}>
                {/* Day header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', marginBottom: 'var(--sp-3)' }}>
                  <div style={{
                    minWidth: 56, textAlign: 'center',
                    padding: '8px 12px',
                    background: isToday ? 'var(--navy)' : 'var(--white)',
                    border: `1px solid ${isToday ? 'var(--navy)' : 'var(--line)'}`,
                    borderRadius: 'var(--radius)',
                    boxShadow: 'var(--shadow-xs)',
                  }}>
                    <div style={{ font: '500 11px var(--font-body)', color: isToday ? 'rgba(255,255,255,0.7)' : 'var(--ink-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{day.slice(0,3)}</div>
                    <div style={{ font: `700 22px/1 var(--font-display)`, color: isToday ? '#fff' : 'var(--navy)', marginTop: 2 }}>{date}</div>
                    <div style={{ font: '11px var(--font-body)', color: isToday ? 'rgba(255,255,255,0.6)' : 'var(--ink-muted)' }}>{month} {year}</div>
                  </div>
                  <div style={{ flex: 1, height: 1, background: 'var(--line-light)' }} />
                  <span style={{ font: '12px var(--font-body)', color: 'var(--ink-muted)' }}>{daySessions.length} session{daySessions.length !== 1 ? 's' : ''}</span>
                </div>

                {/* Session cards */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 'var(--sp-3)', marginLeft: 72 }}>
                  {daySessions.map((s) => {
                    const dur = durationMin(s.starts_at, s.ends_at);
                    const accentColor = ORIGIN_COLOR[s.origin] ?? 'var(--teal)';

                    return (
                      <div key={s.session_id} style={{
                        background: 'var(--white)',
                        border: '1px solid var(--line-light)',
                        borderLeft: `4px solid ${accentColor}`,
                        borderRadius: 'var(--radius)',
                        padding: 'var(--sp-4)',
                        boxShadow: 'var(--shadow-xs)',
                        transition: 'box-shadow var(--t-fast)',
                      }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = 'var(--shadow-sm)'; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = 'var(--shadow-xs)'; }}
                      >
                        {/* Time + duration */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--sp-2)' }}>
                          <div style={{ font: '600 15px/1 var(--font-display)', color: 'var(--navy)' }}>
                            {fmtTime(s.starts_at)}
                            <span style={{ font: '400 13px var(--font-body)', color: 'var(--ink-muted)', marginLeft: 4 }}>→ {fmtTime(s.ends_at)}</span>
                          </div>
                          <span style={{ font: '11px var(--font-body)', color: 'var(--ink-faint)', background: 'var(--bg)', padding: '2px 7px', borderRadius: 10 }}>
                            {dur >= 60 ? `${Math.floor(dur/60)}h${dur%60 ? ` ${dur%60}m` : ''}` : `${dur}m`}
                          </span>
                        </div>

                        {/* Venue */}
                        <div style={{ font: '500 13px var(--font-body)', color: 'var(--ink)', marginBottom: 'var(--sp-2)' }}>
                          📍 {s.venue_name}
                        </div>

                        {/* Session info row */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
                          <Badge status={s.status} />
                          <span style={{ font: '600 10px var(--font-mono)', padding: '2px 6px', borderRadius: 3, background: `${accentColor}18`, color: accentColor }}>
                            {s.origin}
                          </span>
                          {s.total_sessions > 1 && (
                            <span style={{ font: '11px var(--font-body)', color: 'var(--ink-faint)' }}>
                              Session {s.session_no} of {s.total_sessions}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}

const sel: React.CSSProperties = { font: '13.5px var(--font-body)', padding: '8px 12px', border: '1px solid var(--line)', borderRadius: 'var(--radius)', background: 'var(--white)', color: 'var(--ink)', outline: 'none' };
