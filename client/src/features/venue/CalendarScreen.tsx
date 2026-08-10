/**
 * Calendar (CAL-01..CAL-11) — weekly time-grid view.
 * 8:30–19:00 across 7 days; coloured blocks per approved session.
 * Open to every authenticated role; read-only.
 */
import { useEffect, useState, useCallback, useRef } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth.js';
import { PortalShell } from '../auth/PortalShell.js';
import { listCalendar, type CalendarSession } from './api.js';
import { ApiRequestError } from '../../lib/api.js';

// ─── constants ────────────────────────────────────────────────────────────────

const GRID_START_H = 8;
const GRID_START_M = 30;
const GRID_END_H   = 19;
const GRID_END_M   = 0;

const GRID_TOTAL_MINS =
  (GRID_END_H * 60 + GRID_END_M) - (GRID_START_H * 60 + GRID_START_M); // 630

const HOUR_SLOTS: number[] = [];
for (let h = GRID_START_H; h < GRID_END_H; h++) HOUR_SLOTS.push(h);

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_COL_W  = 54; // px

// ─── helpers ─────────────────────────────────────────────────────────────────

function errMsg(e: unknown) {
  return e instanceof ApiRequestError ? e.body.error : 'Something went wrong.';
}
function startOfWeek(d: Date): Date {
  const c = new Date(d); c.setHours(0, 0, 0, 0); c.setDate(c.getDate() - c.getDay()); return c;
}
function addDays(d: Date, n: number): Date {
  const c = new Date(d); c.setDate(c.getDate() + n); return c;
}
function isoDate(d: Date): string { return d.toISOString().slice(0, 10); }
function minsFromOrigin(d: Date): number {
  return d.getHours() * 60 + d.getMinutes() - (GRID_START_H * 60 + GRID_START_M);
}
function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }
function fmtTime(d: Date) {
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}
function fmtFull(d: Date) {
  return d.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
}

// ─── colour map — non-optional values, no index signature ────────────────────

interface ColorToken { bg: string; border: string; text: string }

const C_EXTERNAL_SCHED: ColorToken = { bg: '#ede9fe', border: '#8b5cf6', text: '#4c1d95' };
const C_ACADEMIC_SCHED: ColorToken = { bg: '#dcfce7', border: '#22c55e', text: '#14532d' };
const C_IN_PROGRESS:    ColorToken = { bg: '#fef9c3', border: '#eab308', text: '#78350f' };
const C_COMPLETED:      ColorToken = { bg: '#f1f5f9', border: '#94a3b8', text: '#475569' };
const C_DEFAULT:        ColorToken = { bg: '#f0f9ff', border: '#0ea5e9', text: '#0c4a6e' };

function colorFor(s: CalendarSession): ColorToken {
  if (s.status === 'COMPLETED')   return C_COMPLETED;
  if (s.status === 'IN_PROGRESS') return C_IN_PROGRESS;
  if (s.origin === 'EXTERNAL')    return C_EXTERNAL_SCHED;
  if (s.origin === 'ACADEMIC')    return C_ACADEMIC_SCHED;
  return C_DEFAULT;
}

// ─── legend ──────────────────────────────────────────────────────────────────

const LEGEND: Array<{ color: ColorToken; label: string }> = [
  { color: C_EXTERNAL_SCHED, label: 'External — Scheduled' },
  { color: C_ACADEMIC_SCHED, label: 'Academic — Scheduled' },
  { color: C_IN_PROGRESS,    label: 'In Progress'          },
  { color: C_COMPLETED,      label: 'Completed'            },
];

function Legend() {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px', marginBottom: 16 }}>
      {LEGEND.map(({ color, label }) => (
        <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <div style={{ width: 12, height: 12, borderRadius: 3, background: color.bg, border: `2px solid ${color.border}` }} />
          <span style={{ font: '400 12px var(--font-body)', color: '#64748b' }}>{label}</span>
        </div>
      ))}
    </div>
  );
}

// ─── tooltip ─────────────────────────────────────────────────────────────────

interface TooltipProps { session: CalendarSession; anchorRect: DOMRect | null; onClose: () => void }

function Tooltip({ session, anchorRect, onClose }: TooltipProps) {
  const ref = useRef<HTMLDivElement>(null);
  const c   = colorFor(session);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const top  = anchorRect ? Math.min(anchorRect.bottom + 6, window.innerHeight - 240) : 200;
  const left = anchorRect ? Math.max(8, Math.min(anchorRect.left, window.innerWidth - 280)) : 200;
  const starts = new Date(session.starts_at);
  const ends   = new Date(session.ends_at);

  return (
    <div ref={ref} style={{
      position: 'fixed', top, left, width: 268, zIndex: 1000,
      background: '#fff', border: `1.5px solid ${c.border}`, borderRadius: 8,
      boxShadow: '0 8px 24px rgba(0,0,0,0.13)', padding: '12px 14px',
      fontSize: 13, color: '#334155', lineHeight: 1.55,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <span style={{ font: '600 13px/1.2 var(--font-display)', color: c.text }}>{session.venue_name}</span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: 16, lineHeight: 1, padding: 0 }}>×</button>
      </div>
      <TRow label="Date"    value={starts.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })} />
      <TRow label="Time"    value={`${fmtTime(starts)} → ${fmtTime(ends)}`} />
      <TRow label="Origin"  value={session.origin} />
      <TRow label="Status"  value={session.status.replace(/_/g, ' ')} />
      {session.total_sessions > 1 && (
        <TRow label="Session" value={`${session.session_no} of ${session.total_sessions}`} />
      )}
      <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #f1f5f9' }}>
        <span style={{ font: '500 11px var(--font-mono)', color: '#94a3b8' }}>#{session.booking_id.slice(0, 8)}</span>
      </div>
    </div>
  );
}

function TRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', gap: 6, marginBottom: 3 }}>
      <span style={{ color: '#94a3b8', minWidth: 54, font: '500 12px var(--font-body)' }}>{label}</span>
      <span style={{ font: '500 12px var(--font-body)', color: '#1e293b' }}>{value}</span>
    </div>
  );
}

// ─── event block ─────────────────────────────────────────────────────────────

interface EventBlockProps {
  session: CalendarSession;
  onSelect: (s: CalendarSession, rect: DOMRect) => void;
}

function EventBlock({ session, onSelect }: EventBlockProps) {
  const starts   = new Date(session.starts_at);
  const ends     = new Date(session.ends_at);
  const startMin = clamp(minsFromOrigin(starts), 0, GRID_TOTAL_MINS);
  const endMin   = clamp(minsFromOrigin(ends),   0, GRID_TOTAL_MINS);
  const durMin   = Math.max(endMin - startMin, 15);
  const leftPct  = (startMin / GRID_TOTAL_MINS) * 100;
  const widthPct = (durMin   / GRID_TOTAL_MINS) * 100;
  const c        = colorFor(session);

  return (
    <div
      onClick={(e) => { e.stopPropagation(); onSelect(session, (e.currentTarget as HTMLElement).getBoundingClientRect()); }}
      title={`${session.venue_name} · ${fmtFull(starts)}`}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.filter = 'brightness(0.92)'; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.filter = 'none'; }}
      style={{
        position: 'absolute', top: 4, bottom: 4,
        left: `${leftPct}%`, width: `calc(${widthPct}% - 2px)`,
        background: c.bg, borderLeft: `3px solid ${c.border}`, borderRadius: 4,
        padding: '2px 5px', overflow: 'hidden', cursor: 'pointer',
        display: 'flex', flexDirection: 'column', justifyContent: 'center',
        transition: 'filter 0.12s', fontSize: 11, lineHeight: 1.3,
        color: c.text, boxSizing: 'border-box', minWidth: 4, zIndex: 1,
      }}
    >
      <span style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {session.venue_name}
      </span>
      <span style={{ opacity: 0.8, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {fmtTime(starts)}–{fmtTime(ends)}
      </span>
    </div>
  );
}

// ─── time ruler ──────────────────────────────────────────────────────────────

function TimeRuler() {
  return (
    <div style={{ display: 'flex', position: 'relative', height: 22, marginBottom: 2 }}>
      <div style={{ width: DAY_COL_W, flexShrink: 0 }} />
      <div style={{ flex: 1, position: 'relative' }}>
        {HOUR_SLOTS.map((h) => {
          const pct = ((h * 60 - (GRID_START_H * 60 + GRID_START_M)) / GRID_TOTAL_MINS) * 100;
          return (
            <span key={h} style={{
              position: 'absolute', left: `${pct}%`,
              font: '500 10px var(--font-mono)', color: '#94a3b8',
              transform: 'translateX(-50%)', whiteSpace: 'nowrap', userSelect: 'none',
            }}>
              {String(h).padStart(2, '0')}:00
            </span>
          );
        })}
        <span style={{
          position: 'absolute', right: 0,
          font: '500 10px var(--font-mono)', color: '#94a3b8',
          transform: 'translateX(50%)', userSelect: 'none',
        }}>19:00</span>
      </div>
    </div>
  );
}

// ─── day row ─────────────────────────────────────────────────────────────────

interface DayRowProps {
  date: Date;
  sessions: CalendarSession[];
  isToday: boolean;
  onSelect: (s: CalendarSession, rect: DOMRect) => void;
}

function DayRow({ date, sessions, isToday, onSelect }: DayRowProps) {
  const dayLabel = DAY_LABELS[date.getDay()] ?? '';
  const dateNum  = date.getDate();

  return (
    <div style={{ display: 'flex', alignItems: 'stretch', marginBottom: 3 }}>
      <div style={{
        width: DAY_COL_W, flexShrink: 0, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', paddingRight: 8, gap: 1,
      }}>
        <span style={{ font: '600 10px var(--font-body)', color: isToday ? '#3b82f6' : '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {dayLabel}
        </span>
        <span style={{
          font: '700 15px var(--font-display)',
          color: isToday ? '#fff' : '#1e293b',
          background: isToday ? '#3b82f6' : 'transparent',
          borderRadius: '50%', width: 26, height: 26,
          display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: '1',
        }}>
          {dateNum}
        </span>
      </div>

      <div style={{
        flex: 1, position: 'relative', height: 56,
        background: isToday ? '#f0f9ff' : '#f8fafc',
        border: `1px solid ${isToday ? '#bfdbfe' : '#e2e8f0'}`,
        borderRadius: 6, overflow: 'visible',
      }}>
        {HOUR_SLOTS.map((h) => {
          const pct = ((h * 60 - (GRID_START_H * 60 + GRID_START_M)) / GRID_TOTAL_MINS) * 100;
          return (
            <div key={h} style={{
              position: 'absolute', top: 0, bottom: 0, left: `${pct}%`,
              width: 1, background: '#e2e8f0', pointerEvents: 'none',
            }} />
          );
        })}
        {sessions.map((s) => (
          <EventBlock key={s.session_id} session={s} onSelect={onSelect} />
        ))}
        {sessions.length === 0 && (
          <span style={{
            position: 'absolute', top: '50%', left: '50%',
            transform: 'translate(-50%,-50%)',
            font: '400 11px var(--font-body)', color: '#cbd5e1',
            pointerEvents: 'none', whiteSpace: 'nowrap',
          }}>No sessions</span>
        )}
      </div>
    </div>
  );
}

// ─── nav button ──────────────────────────────────────────────────────────────

function NavBtn({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button onClick={onClick} style={{
      font: '500 16px var(--font-body)', width: 30, height: 30,
      border: '1px solid #d1d5db', borderRadius: 6, background: '#fff', color: '#374151',
      cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: '1',
    }}>
      {label}
    </button>
  );
}

// ─── main ────────────────────────────────────────────────────────────────────

export default function CalendarScreen() {
  const { user, loading } = useAuth();
  const [sessions, setSessions]   = useState<CalendarSession[]>([]);
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(new Date()));
  const [error, setError]         = useState<string | null>(null);
  const [tooltip, setTooltip]     = useState<{ session: CalendarSession; rect: DOMRect } | null>(null);

  const weekEnd = addDays(weekStart, 7);

  const load = useCallback(async () => {
    try {
      const s = await listCalendar({ from: weekStart.toISOString(), to: weekEnd.toISOString() });
      setSessions(s.sessions);
    } catch (e) {
      setError(errMsg(e));
    }
  }, [weekStart]);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <PortalShell title="Calendar"><p /></PortalShell>;
  if (!user)   return <Navigate to="/" replace />;

  const todayStr = isoDate(new Date());
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const byDay: Record<string, CalendarSession[]> = {};
  for (const s of sessions) {
    const key = isoDate(new Date(s.starts_at));
    if (!byDay[key]) byDay[key] = [];
    byDay[key].push(s);
  }

  const prevWeek = () => setWeekStart((w) => addDays(w, -7));
  const nextWeek = () => setWeekStart((w) => addDays(w, +7));
  const goToday  = () => setWeekStart(startOfWeek(new Date()));

  const weekLabel = `${weekStart.toLocaleDateString([], { month: 'short', day: 'numeric' })} – ${addDays(weekStart, 6).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}`;

  return (
    <PortalShell title="Venue Calendar" tint="blue">
      <div style={{ maxWidth: 1080, margin: '0 auto', padding: '0 4px' }}>
        {error && (
          <div style={{ background: '#fdecec', color: '#8f2323', border: '1px solid #f3caca', borderRadius: 6, padding: '10px 14px', marginBottom: 14, fontSize: 14 }}>
            {error}
          </div>
        )}

        {/* toolbar */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <NavBtn onClick={prevWeek} label="‹" />
            <NavBtn onClick={nextWeek} label="›" />
            <button
              onClick={goToday}
              style={{ font: '500 13px var(--font-body)', padding: '5px 12px', border: '1px solid #d1d5db', borderRadius: 6, background: '#fff', color: '#374151', cursor: 'pointer' }}
            >
              Today
            </button>
            <span style={{ font: '600 14px var(--font-display)', color: '#1e293b', marginLeft: 6 }}>
              {weekLabel}
            </span>
          </div>
        </div>

        <Legend />

        {/* grid */}
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '14px 14px 10px', overflowX: 'auto' }}>
          <TimeRuler />
          {weekDays.map((d) => {
            const key = isoDate(d);
            return (
              <DayRow
                key={key}
                date={d}
                sessions={byDay[key] ?? []}
                isToday={key === todayStr}
                onSelect={(s, rect) => setTooltip({ session: s, rect })}
              />
            );
          })}
        </div>

        <p style={{ font: '400 12px var(--font-body)', color: '#94a3b8', marginTop: 10 }}>
          {sessions.length} session{sessions.length !== 1 ? 's' : ''} this week
        </p>
      </div>

      {tooltip && (
        <Tooltip session={tooltip.session} anchorRect={tooltip.rect} onClose={() => setTooltip(null)} />
      )}
    </PortalShell>
  );
}
