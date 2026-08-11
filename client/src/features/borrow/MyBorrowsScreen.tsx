/**
 * Student — Borrow Equipment (BORROW-01..14). Submit a same-day request and
 * track its status. No borrow action is initiated from the availability
 * checker (EQUIP-AVAIL-09) — this is the dedicated request screen.
 *
 * Navigation state accepted:
 *   - { equipmentTypeId: number }  → pre-selects that type in the individual request form
 *   - { kitPack: { sportCategoryId, sportCategoryName, canRequestAll } } → opens the kit panel pre-filled
 */
import { useEffect, useState, useCallback } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../lib/auth.js';
import { PortalShell, PrimaryButton } from '../auth/PortalShell.js';
import { listTypes, listSportCategories, type EquipmentType, type SportCategory } from '../inventory/api.js';
import { submitRequest, listMyRequests, type MyRequest } from './api.js';
import { getKitPack, submitKitBorrowRequest, type KitPack } from '../availability/kitPackApi.js';
import { ApiRequestError } from '../../lib/api.js';

function errMsg(e: unknown) { return e instanceof ApiRequestError ? e.body.error : 'Something went wrong.'; }

// ─── Individual request form (original) ──────────────────────────────────────

// ── Time helpers ──────────────────────────────────────────────────────────────
const OPEN_HH = 8;   // 08:00
const CLOSE_HH = 17; // 17:00

function toHHMM(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60).toString().padStart(2, '0');
  const m = (totalMinutes % 60).toString().padStart(2, '0');
  return `${h}:${m}`;
}

function smartStart(): string {
  const now = new Date();
  const localMin = now.getHours() * 60 + now.getMinutes();
  // Round up to next multiple of 5
  const rounded = Math.ceil(localMin / 5) * 5;
  // Clamp to [08:00, 17:00)
  const clamped = Math.min(Math.max(rounded, OPEN_HH * 60), CLOSE_HH * 60 - 5);
  return toHHMM(clamped);
}

function smartEnd(startHHMM: string, maxDurationMinutes: number): string {
  const parts = startHHMM.split(':').map(Number);
  const startMin = (parts[0] ?? 8) * 60 + (parts[1] ?? 0);
  const endMin = Math.min(startMin + maxDurationMinutes, CLOSE_HH * 60);
  return toHHMM(endMin);
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function nowMinTime(date: string): string {
  const today = todayStr();
  if (date !== today) return `${OPEN_HH.toString().padStart(2, '0')}:00`;
  const now = new Date();
  return toHHMM(Math.max(now.getHours() * 60 + now.getMinutes(), OPEN_HH * 60));
}

// ─── Individual request form ───────────────────────────────────────────────────
function RequestForm({ types, initialTypeId, onDone, onError }: {
  types: EquipmentType[];
  initialTypeId?: number;
  onDone: (m: string) => void;
  onError: (m: string) => void;
}) {
  const [equipmentTypeId, setType] = useState(initialTypeId ?? 0);
  const [date, setDate] = useState(todayStr);
  const [startTime, setStartTime] = useState(smartStart);
  const [endTime, setEndTime] = useState(() => {
    const sel = types.find((t) => t.equipment_type_id === (initialTypeId ?? 0));
    return smartEnd(smartStart(), sel?.max_borrow_duration_minutes ?? 480);
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (initialTypeId && equipmentTypeId === 0) setType(initialTypeId);
  }, [initialTypeId]); // eslint-disable-line react-hooks/exhaustive-deps

  // When type changes, recalc end time using new max duration
  function handleTypeChange(id: number) {
    setType(id);
    const sel = types.find((t) => t.equipment_type_id === id);
    if (sel) setEndTime(smartEnd(startTime, sel.max_borrow_duration_minutes));
  }

  // When start changes, push end time forward by max duration
  function handleStartChange(val: string) {
    setStartTime(val);
    const sel = types.find((t) => t.equipment_type_id === equipmentTypeId);
    setEndTime(smartEnd(val, sel?.max_borrow_duration_minutes ?? 480));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!equipmentTypeId) { onError('Choose an equipment type.'); return; }
    if (startTime >= endTime) { onError('Return time must be after start time.'); return; }
    setBusy(true);
    try {
      const requestedStartAt = `${date}T${startTime}:00.000Z`;
      const requestedReturnAt = `${date}T${endTime}:00.000Z`;
      await submitRequest({ equipmentTypeId, requestedStartAt, requestedReturnAt });
      onDone('Request submitted. You will be notified once a Coordinator reviews it.');
    } catch (e) { onError(errMsg(e)); } finally { setBusy(false); }
  }

  const minTime = nowMinTime(date);

  return (
    <form onSubmit={submit} style={formGrid}>
      <L label="Equipment">
        <select style={inp} value={equipmentTypeId} onChange={(e) => handleTypeChange(Number(e.target.value))} required>
          <option value={0}>Select</option>
          {types.map((t) => <option key={t.equipment_type_id} value={t.equipment_type_id}>{t.name}</option>)}
        </select>
      </L>
      <L label="Date">
        <input type="date" style={inp} value={date} min={todayStr()} onChange={(e) => setDate(e.target.value)} required />
      </L>
      <L label="Start time">
        <input type="time" style={inp} value={startTime} min={minTime} max="17:00" step={300}
          onChange={(e) => handleStartChange(e.target.value)} required />
      </L>
      <L label="Return by">
        <input type="time" style={inp} value={endTime} min={startTime} max="17:00" step={300}
          onChange={(e) => setEndTime(e.target.value)} required />
      </L>
      <div style={{ gridColumn: '1 / -1' }}>
        <PrimaryButton disabled={busy}>{busy ? 'Submitting…' : 'Submit Request'}</PrimaryButton>
      </div>
    </form>
  );
}

function L({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={lbl}>
      <span style={lblText}>{label}</span>
      {children}
    </label>
  );
}

// ─── Kit request form ─────────────────────────────────────────────────────────

function KitRequestForm({ cats, initialSportId, onDone, onError }: {
  cats: SportCategory[];
  initialSportId?: number;
  onDone: (m: string) => void;
  onError: (m: string) => void;
}) {
  const [sportId, setSportId] = useState<number>(initialSportId ?? 0);
  const [kitPack, setKitPack] = useState<KitPack | null>(null);
  const [kitLoading, setKitLoading] = useState(false);
  const [date, setDate] = useState(todayStr);
  const [startTime, setStartTime] = useState(smartStart);
  const [endTime, setEndTime] = useState(() => smartEnd(smartStart(), 480));
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!sportId) { setKitPack(null); return; }
    setKitLoading(true);
    getKitPack(sportId)
      .then((res) => setKitPack(res.kitPack))
      .catch(() => { setKitPack(null); onError('Could not load kit details.'); })
      .finally(() => setKitLoading(false));
  }, [sportId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!sportId) { onError('Select a sport first.'); return; }
    if (!kitPack?.canRequestAll) { onError('Not all items in this kit are available.'); return; }
    setSubmitting(true);
    try {
      const requestedStartAt = `${date}T${startTime}:00.000Z`;
      const requestedReturnAt = `${date}T${endTime}:00.000Z`;
      const res = await submitKitBorrowRequest({ sportCategoryId: sportId, requestedStartAt, requestedReturnAt });
      onDone(res.message);
      setSportId(0); setKitPack(null);
    } catch (e) { onError(errMsg(e)); }
    finally { setSubmitting(false); }
  }

  const kitBadgeStyle: React.CSSProperties | undefined = !kitPack ? undefined : {
    display: 'inline-block', padding: '2px 8px', borderRadius: 12, fontSize: 12, fontWeight: 600,
    backgroundColor: kitPack.kitStatusBadge === 'AVAILABLE' ? '#d1fae5' : kitPack.kitStatusBadge === 'PARTIAL' ? '#fef3c7' : '#fee2e2',
    color: kitPack.kitStatusBadge === 'AVAILABLE' ? '#065f46' : kitPack.kitStatusBadge === 'PARTIAL' ? '#92400e' : '#991b1b',
  };
  const kitBadgeText = !kitPack ? '' : kitPack.kitStatusBadge === 'AVAILABLE' ? 'Full kit available' : kitPack.kitStatusBadge === 'PARTIAL' ? 'Partially available' : 'Unavailable';

  return (
    <form onSubmit={handleSubmit} style={formGrid}>
      <L label="Sport">
        <select style={inp} value={sportId} onChange={(e) => setSportId(Number(e.target.value))}>
          <option value={0}>— select a sport —</option>
          {cats.map((c) => <option key={c.sport_category_id} value={c.sport_category_id}>{c.name}</option>)}
        </select>
      </L>

      {kitLoading && <p style={{ ...muted, gridColumn: '1 / -1' }}>Loading kit…</p>}

      {kitPack && !kitLoading && (
        <div style={{ gridColumn: '1 / -1', ...kitSummary }}>
          <div style={kitSummaryHeader}>
            <span style={kitSummaryTitle}>🎒 {kitPack.sportCategoryName} Kit Pack</span>
            {kitBadgeStyle && <span style={kitBadgeStyle}>{kitBadgeText}</span>}
          </div>
          <ul style={kitItemList}>
            {kitPack.items.map((item) => (
              <li key={item.equipmentTypeId} style={kitItemLi}>
                <span style={{ fontSize: 13, color: '#0c4a6e' }}>{item.name}</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: item.availableUnits > 0 ? '#065f46' : '#991b1b' }}>
                  {item.availableUnits} available
                </span>
              </li>
            ))}
          </ul>
          {kitPack.kitStatusBadge === 'PARTIAL' && (
            <p style={kitWarning}>⚠ Some items have no stock. Request individual items from the form above.</p>
          )}
        </div>
      )}

      {kitPack?.canRequestAll && (
        <>
          <L label="Date">
            <input type="date" style={inp} value={date} min={todayStr()} onChange={(e) => setDate(e.target.value)} required />
          </L>
          <L label="Start time">
            <input type="time" style={inp} value={startTime} min={nowMinTime(date)} max="17:00" step={300}
              onChange={(e) => { setStartTime(e.target.value); setEndTime(smartEnd(e.target.value, 480)); }} required />
          </L>
          <L label="Return by">
            <input type="time" style={inp} value={endTime} min={startTime} max="17:00" step={300}
              onChange={(e) => setEndTime(e.target.value)} required />
          </L>
          <div style={{ gridColumn: '1 / -1' }}>
            <PrimaryButton disabled={submitting}>
              {submitting ? 'Submitting…' : `Request Full ${kitPack.sportCategoryName} Kit`}
            </PrimaryButton>
          </div>
        </>
      )}
    </form>
  );
}

// ─── Panel wrapper ────────────────────────────────────────────────────────────

function Panel({ title, children, defaultOpen = true }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={panelWrap}>
      <button style={panelHeader} onClick={() => setOpen((v) => !v)}>
        <span style={panelTitle}>{title}</span>
        <span style={{ fontSize: 11, color: '#6b7280' }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && <div style={panelBody}>{children}</div>}
    </div>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

interface LocationState {
  equipmentTypeId?: number;
  kitPack?: { sportCategoryId: number; sportCategoryName: string; canRequestAll: boolean };
}

export default function MyBorrowsScreen() {
  const { user, loading } = useAuth();
  const location = useLocation();
  const locationState = (location.state ?? {}) as LocationState;
  const incomingTypeId = locationState.equipmentTypeId;
  const incomingKit   = locationState.kitPack;

  const [types, setTypes] = useState<EquipmentType[]>([]);
  const [cats, setCats] = useState<SportCategory[]>([]);
  const [requests, setRequests] = useState<MyRequest[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [t, r, c] = await Promise.all([listTypes(), listMyRequests(), listSportCategories()]);
      setTypes(t.types); setRequests(r.requests); setCats(c.categories);
    } catch (e) { setError(errMsg(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (loading) return <PortalShell title="My Borrows"><p /></PortalShell>;
  if (!user) return <Navigate to="/" replace />;
  if (user.role !== 'STUDENT') return <Navigate to="/home" replace />;

  const flash = {
    ok:  (m: string) => { setNotice(m); setError(null); void load(); },
    err: (m: string) => { setError(m); setNotice(null); },
  };

  return (
    <PortalShell title="My Borrows" tint="sage">
      <div style={wrap}>
        {error  && <div style={box.err}>{error}</div>}
        {notice && <div style={box.ok}>{notice}</div>}

        {/* Individual item request — expanded by default, or always if arriving with a typeId */}
        <Panel title="Request Equipment" defaultOpen={!incomingKit}>
          <RequestForm
            types={types}
            initialTypeId={incomingTypeId}
            onDone={flash.ok}
            onError={flash.err}
          />
        </Panel>

        {/* Kit pack request — expanded when arriving from the kit CTA */}
        <Panel title="Request Full Kit" defaultOpen={!!incomingKit}>
          <KitRequestForm
            cats={cats}
            initialSportId={incomingKit?.sportCategoryId}
            onDone={flash.ok}
            onError={flash.err}
          />
        </Panel>

        <Panel title="My Requests">
          {requests.length === 0 ? (
            <p style={muted}>You haven't submitted any requests yet.</p>
          ) : (
            <table style={table}>
              <thead>
                <tr>
                  <th style={th}>Equipment</th>
                  <th style={th}>Window</th>
                  <th style={th}>Status</th>
                  <th style={th}>Note</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((r) => (
                  <tr key={r.borrow_request_id}>
                    <td style={td}>{r.equipment_type_name}</td>
                    <td style={td}>
                      {new Date(r.requested_start_at).toLocaleString()} → {new Date(r.requested_return_at).toLocaleTimeString()}
                    </td>
                    <td style={td}>
                      {isExpired(r.requested_start_at, r.status)
                        ? <span style={{ ...badgeBase, background: '#f3f4f6', color: '#6b7280' }}>EXPIRED</span>
                        : <span style={{ ...badgeBase, ...statusBadge(r.status) }}>{r.status}</span>}
                    </td>
                    <td style={{ ...td, color: '#8f2323' }}>{r.rejection_reason ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      </div>
    </PortalShell>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const wrap: React.CSSProperties = { maxWidth: 860, margin: '0 auto', padding: '24px 16px', display: 'flex', flexDirection: 'column', gap: 16 };
const muted: React.CSSProperties = { color: '#6b7280', fontSize: 14, margin: 0 };
const box = {
  err: { padding: '10px 14px', borderRadius: 8, background: '#fee2e2', color: '#991b1b', fontSize: 14 } as React.CSSProperties,
  ok:  { padding: '10px 14px', borderRadius: 8, background: '#d1fae5', color: '#065f46', fontSize: 14 } as React.CSSProperties,
};

// Panel
const panelWrap: React.CSSProperties = { border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden', background: '#fff' };
const panelHeader: React.CSSProperties = { width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', background: '#f9fafb', border: 'none', cursor: 'pointer', textAlign: 'left' };
const panelTitle: React.CSSProperties = { fontSize: 15, fontWeight: 600, color: '#111' };
const panelBody: React.CSSProperties = { padding: '16px 18px' };

// Form
const formGrid: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 20px' };
const lbl: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4 };
const lblText: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: '#374151' };
const inp: React.CSSProperties = { padding: '8px 10px', borderRadius: 7, border: '1px solid #d1d5db', fontSize: 14 };

// Kit summary
const kitSummary: React.CSSProperties = { background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 8, padding: '12px 14px' };
const kitSummaryHeader: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, gap: 8, flexWrap: 'wrap' };
const kitSummaryTitle: React.CSSProperties = { fontSize: 14, fontWeight: 700, color: '#0c4a6e' };
const kitItemList: React.CSSProperties = { margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 };
const kitItemLi: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 };
const kitWarning: React.CSSProperties = { margin: '10px 0 0', fontSize: 12, color: '#92400e', padding: '6px 10px', background: '#fef3c7', borderRadius: 6 };

// Requests table
const table: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 14 };
const th: React.CSSProperties = { padding: '8px 10px', textAlign: 'left', fontWeight: 600, borderBottom: '1px solid #e5e7eb', color: '#374151', fontSize: 13 };
const td: React.CSSProperties = { padding: '9px 10px', borderBottom: '1px solid #f3f4f6', verticalAlign: 'top' };
const badgeBase: React.CSSProperties = { display: 'inline-block', padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600 };
function isExpired(requestedStartAt: string, status: string): boolean {
  return status === 'PENDING' && new Date(requestedStartAt).getTime() < Date.now();
}
function statusBadge(s: string): React.CSSProperties {
  if (s === 'APPROVED') return { background: '#d1fae5', color: '#065f46' };
  if (s === 'REJECTED') return { background: '#fee2e2', color: '#991b1b' };
  if (s === 'CANCELLED') return { background: '#f3f4f6', color: '#6b7280' };
  return { background: '#fef3c7', color: '#92400e' }; // PENDING
}
