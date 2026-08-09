/**
 * Shared multi-session row builder (VENUE-06/35/36).
 *
 * Used by both the student booking wizard and the Coordinator's academic-event
 * form. Changes vs. prior version:
 *   - Team name column removed from session rows (it served no purpose once
 *     team details are captured in Step 2 of the booking wizard)
 *   - toSessionInputs() returns teamName = '' (backend still accepts the field)
 */
import { useState } from 'react';
import type { SessionInput } from './api.js';

export interface SessionRow {
  sessionNo: number;
  date: string;
  startTime: string;
  endTime: string;
  participantDetails: string;
}

function nextWeekday(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  // Skip to Monday if weekend
  const day = d.getDay();
  if (day === 6) d.setDate(d.getDate() + 2);
  else if (day === 0) d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

function makeRow(sessionNo: number): SessionRow {
  return {
    sessionNo,
    date: nextWeekday(sessionNo + 1),
    startTime: '10:00',
    endTime: '12:00',
    participantDetails: '',
  };
}

export function useSessionRows() {
  const [rows, setRows] = useState<SessionRow[]>([makeRow(1)]);

  function addRow() {
    if (rows.length >= 30) return;
    setRows((r) => [...r, makeRow(r.length + 1)]);
  }
  function removeRow(sessionNo: number) {
    setRows((r) =>
      r.filter((row) => row.sessionNo !== sessionNo)
        .map((row, i) => ({ ...row, sessionNo: i + 1 })),
    );
  }
  function updateRow(sessionNo: number, patch: Partial<SessionRow>) {
    setRows((r) => r.map((row) => row.sessionNo === sessionNo ? { ...row, ...patch } : row));
  }
  function toSessionInputs(): SessionInput[] {
    return rows.map((r) => ({
      sessionNo: r.sessionNo,
      requestedStartAt: new Date(`${r.date}T${r.startTime}:00`).toISOString(),
      requestedEndAt: new Date(`${r.date}T${r.endTime}:00`).toISOString(),
      teamName: '',
      participantDetails: r.participantDetails || undefined,
    }));
  }

  return { rows, addRow, removeRow, updateRow, toSessionInputs, setRows };
}

export function SessionRowsEditor({
  rows, onAdd, onRemove, onUpdate, errors,
}: {
  rows: SessionRow[];
  onAdd: () => void;
  onRemove: (sessionNo: number) => void;
  onUpdate: (sessionNo: number, patch: Partial<SessionRow>) => void;
  errors?: Record<number, string>; // sessionNo → error message
}) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span style={lbl}>Sessions {rows.length > 1 ? `(${rows.length})` : ''}</span>
        {rows.length < 30 && (
          <button type="button" style={addBtn} onClick={onAdd}>+ Add session</button>
        )}
      </div>
      <div style={{ display: 'grid', gap: 10 }}>
        {rows.map((row) => {
          const err = errors?.[row.sessionNo];
          return (
            <div key={row.sessionNo} style={{ ...sessionCard, ...(err ? { borderColor: '#c0392b' } : {}) }}>
              <div style={sessionHead}>
                <span style={sessionNoStyle}>Session {row.sessionNo}</span>
                {rows.length > 1 && (
                  <button type="button" style={removeBtn} onClick={() => onRemove(row.sessionNo)}>
                    Remove
                  </button>
                )}
              </div>
              <div style={sessionGrid}>
                <input
                  type="date"
                  style={{ ...inp, ...(err ? { borderColor: '#c0392b' } : {}) }}
                  value={row.date}
                  onChange={(e) => onUpdate(row.sessionNo, { date: e.target.value })}
                />
                <input
                  type="time"
                  style={inp}
                  value={row.startTime}
                  onChange={(e) => onUpdate(row.sessionNo, { startTime: e.target.value })}
                />
                <input
                  type="time"
                  style={inp}
                  value={row.endTime}
                  onChange={(e) => onUpdate(row.sessionNo, { endTime: e.target.value })}
                />
              </div>
              {err && <div style={errStyle}>{err}</div>}
            </div>
          );
        })}
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
const sessionNoStyle: React.CSSProperties = { font: '600 12px var(--font-mono)', color: '#5c6773' };
const sessionGrid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 };
const errStyle: React.CSSProperties = { fontSize: 12, color: '#c0392b', marginTop: 6 };
