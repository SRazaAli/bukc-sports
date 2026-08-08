/**
 * Shared multi-session row builder (VENUE-06/35/36) — used by both the
 * student booking form and the Coordinator's academic-event form. Starts
 * with one row (the common single-session case) and lets the user add up
 * to 30.
 */
import { useState } from 'react';
import type { SessionInput } from './api.js';

export interface SessionRow {
  sessionNo: number; date: string; startTime: string; endTime: string;
  teamName: string; participantDetails: string;
}

function makeRow(sessionNo: number, defaultTeamName = ''): SessionRow {
  const d = new Date(); d.setDate(d.getDate() + 1 + sessionNo);
  return {
    sessionNo, date: d.toISOString().slice(0, 10), startTime: '10:00', endTime: '12:00',
    teamName: defaultTeamName, participantDetails: '',
  };
}

export function useSessionRows(defaultTeamName = '') {
  const [rows, setRows] = useState<SessionRow[]>([makeRow(1, defaultTeamName)]);

  function addRow() {
    if (rows.length >= 30) return; // VENUE-35
    setRows((r) => [...r, makeRow(r.length + 1, defaultTeamName)]);
  }
  function removeRow(sessionNo: number) {
    setRows((r) => r.filter((row) => row.sessionNo !== sessionNo).map((row, i) => ({ ...row, sessionNo: i + 1 })));
  }
  function updateRow(sessionNo: number, patch: Partial<SessionRow>) {
    setRows((r) => r.map((row) => row.sessionNo === sessionNo ? { ...row, ...patch } : row));
  }
  function toSessionInputs(): SessionInput[] {
    return rows.map((r) => ({
      sessionNo: r.sessionNo,
      requestedStartAt: new Date(`${r.date}T${r.startTime}:00`).toISOString(),
      requestedEndAt: new Date(`${r.date}T${r.endTime}:00`).toISOString(),
      teamName: r.teamName,
      participantDetails: r.participantDetails || undefined,
    }));
  }

  return { rows, addRow, removeRow, updateRow, toSessionInputs, setRows };
}

export function SessionRowsEditor({
  rows, onAdd, onRemove, onUpdate,
}: {
  rows: SessionRow[];
  onAdd: () => void;
  onRemove: (sessionNo: number) => void;
  onUpdate: (sessionNo: number, patch: Partial<SessionRow>) => void;
}) {
  return (
    <div style={{ gridColumn: '1 / -1' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={lbl}>Sessions {rows.length > 1 ? `(${rows.length})` : ''}</span>
        {rows.length < 30 && <button type="button" style={addBtn} onClick={onAdd}>+ Add session</button>}
      </div>
      <div style={{ display: 'grid', gap: 10 }}>
        {rows.map((row) => (
          <div key={row.sessionNo} style={sessionCard}>
            <div style={sessionHead}>
              <span style={sessionNo}>Session {row.sessionNo}</span>
              {rows.length > 1 && <button type="button" style={removeBtn} onClick={() => onRemove(row.sessionNo)}>Remove</button>}
            </div>
            <div style={sessionGrid}>
              <input type="date" style={inp} value={row.date} onChange={(e) => onUpdate(row.sessionNo, { date: e.target.value })} required />
              <input type="time" style={inp} value={row.startTime} onChange={(e) => onUpdate(row.sessionNo, { startTime: e.target.value })} required />
              <input type="time" style={inp} value={row.endTime} onChange={(e) => onUpdate(row.sessionNo, { endTime: e.target.value })} required />
              <input style={inp} placeholder="Team name" value={row.teamName} onChange={(e) => onUpdate(row.sessionNo, { teamName: e.target.value })} required />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const lbl: React.CSSProperties = { display: 'block', font: '500 12px var(--font-body)', color: '#26485f' };
const inp: React.CSSProperties = { font: '13.5px var(--font-body)', padding: '7px 9px', border: '1px solid #ccc', borderRadius: 4 };
const addBtn: React.CSSProperties = { background: 'none', border: 'none', color: '#0a6ebd', font: '600 13px var(--font-body)', cursor: 'pointer' };
const removeBtn: React.CSSProperties = { background: 'none', border: 'none', color: '#c0392b', font: '500 12.5px var(--font-body)', cursor: 'pointer' };
const sessionCard: React.CSSProperties = { border: '1px solid #e2e6ea', borderRadius: 6, padding: 10, background: '#fafbfc' };
const sessionHead: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', marginBottom: 6 };
const sessionNo: React.CSSProperties = { font: '600 12px var(--font-mono)', color: '#5c6773' };
const sessionGrid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 };
