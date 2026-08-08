/**
 * Student — Borrow Equipment (BORROW-01..14). Submit a same-day request and
 * track its status. No borrow action is initiated from the availability
 * checker (EQUIP-AVAIL-09) — this is the dedicated request screen.
 *
 * Kit Pack flow: when navigated here from AvailabilityScreen with a kit pack
 * in location.state, the Kit Request panel is pre-filled and expanded at the
 * top. Students can also open it manually via the "Request Full Kit" button.
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

// ─── Kit Request Panel ────────────────────────────────────────────────────────

interface KitFormProps {
  cats: SportCategory[];
  initialSportId?: number;
  initialSportName?: string;
  onDone: (msg: string) => void;
  onError: (msg: string) => void;
}

function KitRequestForm({ cats, initialSportId, initialSportName, onDone, onError }: KitFormProps) {
  const [sportId, setSportId] = useState<number>(initialSportId ?? 0);
  const [kitPack, setKitPack] = useState<KitPack | null>(null);
  const [kitLoading, setKitLoading] = useState(false);
  const [startAt, setStartAt] = useState('');
  const [endAt, setEndAt] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Pre-load kit for the sport passed via navigation state
  useEffect(() => {
    if (!sportId) { setKitPack(null); return; }
    setKitLoading(true);
    getKitPack(sportId)
      .then((res) => setKitPack(res.kitPack))
      .catch(() => { setKitPack(null); onError('Could not load kit details.'); })
      .finally(() => setKitLoading(false));
  }, [sportId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSubmit() {
    if (!sportId) { onError('Select a sport first.'); return; }
    if (!startAt || !endAt) { onError('Select a borrow window.'); return; }
    if (!kitPack?.canRequestAll) { onError('Not all items in this kit are available.'); return; }
    setSubmitting(true);
    try {
      const res = await submitKitBorrowRequest({
        sportCategoryId: sportId,
        requestedStartAt: new Date(startAt).toISOString(),
        requestedReturnAt: new Date(endAt).toISOString(),
      });
      onDone(res.message);
      setStartAt(''); setEndAt(''); setSportId(0); setKitPack(null);
    } catch (e) {
      onError(errMsg(e));
    } finally {
      setSubmitting(false);
    }
  }

  const kitBadgeColor =
    !kitPack ? undefined
    : kitPack.kitStatusBadge === 'AVAILABLE' ? '#065f46'
    : kitPack.kitStatusBadge === 'PARTIAL' ? '#92400e'
    : '#991b1b';

  const kitBadgeBg =
    !kitPack ? undefined
    : kitPack.kitStatusBadge === 'AVAILABLE' ? '#d1fae5'
    : kitPack.kitStatusBadge === 'PARTIAL' ? '#fef3c7'
    : '#fee2e2';

  const kitBadgeText =
    !kitPack ? ''
    : kitPack.kitStatusBadge === 'AVAILABLE' ? 'Full kit available'
    : kitPack.kitStatusBadge === 'PARTIAL' ? 'Partially available'
    : 'Unavailable';

  return (
    <div style={kitFormWrap}>
      <div style={formRow}>
        <label style={label}>Sport</label>
        <select
          style={input}
          value={sportId}
          onChange={(e) => setSportId(Number(e.target.value))}
        >
          <option value={0}>— select a sport —</option>
          {cats.map((c) => (
            <option key={c.sport_category_id} value={c.sport_category_id}>{c.name}</option>
          ))}
        </select>
      </div>

      {kitLoading && <p style={muted}>Loading kit…</p>}

      {kitPack && !kitLoading && (
        <div style={kitSummary}>
          <div style={kitSummaryHeader}>
            <span style={kitSummaryTitle}>🎒 {kitPack.sportCategoryName} Kit Pack</span>
            <span style={{ ...kitBadge, backgroundColor: kitBadgeBg, color: kitBadgeColor }}>{kitBadgeText}</span>
          </div>
          <ul style={kitItemList}>
            {kitPack.items.map((item) => (
              <li key={item.equipmentTypeId} style={kitItemLi}>
                <span style={kitItemName}>{item.name}</span>
                <span style={kitItemAvail(item.availableUnits)}>
                  {item.availableUnits} available
                </span>
              </li>
            ))}
          </ul>
          {kitPack.kitStatusBadge === 'PARTIAL' && (
            <p style={kitWarning}>
              ⚠ Some items have no stock. You can request individual items from the form below.
            </p>
          )}
        </div>
      )}

      {kitPack?.canRequestAll && (
        <>
          <div style={formRow}>
            <label style={label}>Start time</label>
            <input type="datetime-local" style={input} value={startAt} onChange={(e) => setStartAt(e.target.value)} />
          </div>
          <div style={formRow}>
            <label style={label}>Return time</label>
            <input type="datetime-local" style={input} value={endAt} onChange={(e) => setEndAt(e.target.value)} />
          </div>
          <PrimaryButton disabled={submitting} onClick={handleSubmit}>
            {submitting ? 'Submitting…' : `Request Full ${kitPack.sportCategoryName} Kit`}
          </PrimaryButton>
        </>
      )}
    </div>
  );
}

// ─── Per-item Request Form ────────────────────────────────────────────────────

interface RequestFormProps {
  types: EquipmentType[];
  onDone: (msg: string) => void;
  onError: (msg: string) => void;
}

function RequestForm({ types, onDone, onError }: RequestFormProps) {
  const [typeId, setTypeId] = useState(0);
  const [startAt, setStartAt] = useState('');
  const [endAt, setEndAt] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (!typeId) { onError('Select an equipment type.'); return; }
    if (!startAt || !endAt) { onError('Select a borrow window.'); return; }
    setSubmitting(true);
    try {
      await submitRequest({ equipmentTypeId: typeId, requestedStartAt: new Date(startAt).toISOString(), requestedReturnAt: new Date(endAt).toISOString() });
      onDone('Request submitted — awaiting coordinator approval.');
      setTypeId(0); setStartAt(''); setEndAt('');
    } catch (e) { onError(errMsg(e)); }
    finally { setSubmitting(false); }
  }

  return (
    <div style={kitFormWrap}>
      <div style={formRow}>
        <label style={label}>Equipment type</label>
        <select style={input} value={typeId} onChange={(e) => setTypeId(Number(e.target.value))}>
          <option value={0}>— select —</option>
          {types.map((t) => <option key={t.equipment_type_id} value={t.equipment_type_id}>{t.name} ({t.sport_category_name})</option>)}
        </select>
      </div>
      <div style={formRow}>
        <label style={label}>Start time</label>
        <input type="datetime-local" style={input} value={startAt} onChange={(e) => setStartAt(e.target.value)} />
      </div>
      <div style={formRow}>
        <label style={label}>Return time</label>
        <input type="datetime-local" style={input} value={endAt} onChange={(e) => setEndAt(e.target.value)} />
      </div>
      <PrimaryButton disabled={submitting} onClick={handleSubmit}>
        {submitting ? 'Submitting…' : 'Submit Request'}
      </PrimaryButton>
    </div>
  );
}

// ─── Panel wrapper ────────────────────────────────────────────────────────────

function Panel({ title, children, defaultOpen = true }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={panelWrap}>
      <button style={panelHeader} onClick={() => setOpen((v) => !v)}>
        <span style={panelTitle}>{title}</span>
        <span style={panelChevron}>{open ? '▲' : '▼'}</span>
      </button>
      {open && <div style={panelBody}>{children}</div>}
    </div>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

interface LocationState {
  kitPack?: {
    sportCategoryId: number;
    sportCategoryName: string;
    canRequestAll: boolean;
  };
}

export default function MyBorrowsScreen() {
  const { user, loading } = useAuth();
  const location = useLocation();
  const locationState = (location.state ?? {}) as LocationState;
  const incomingKit = locationState.kitPack;

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

  return (
    <PortalShell title="My Borrows" tint="sage">
      <div style={wrap}>
        {error && <div style={box.err}>{error}</div>}
        {notice && <div style={box.ok}>{notice}</div>}

        {/* Kit Pack panel — expanded by default when arriving from AvailabilityScreen */}
        <Panel title="🎒 Request Full Kit" defaultOpen={!!incomingKit}>
          <KitRequestForm
            cats={cats}
            initialSportId={incomingKit?.sportCategoryId}
            initialSportName={incomingKit?.sportCategoryName}
            onDone={(m) => { setNotice(m); setError(null); void load(); }}
            onError={(m) => { setError(m); setNotice(null); }}
          />
        </Panel>

        <Panel title="Request Individual Item" defaultOpen={!incomingKit}>
          <RequestForm types={types} onDone={(m) => { setNotice(m); setError(null); void load(); }} onError={(m) => { setError(m); setNotice(null); }} />
        </Panel>

        <Panel title="My Requests" defaultOpen>
          {requests.length === 0 ? <p style={muted}>You haven't submitted any requests yet.</p> : (
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
                    <td style={td}>{new Date(r.requested_start_at).toLocaleString()} → {new Date(r.requested_return_at).toLocaleTimeString()}</td>
                    <td style={td}><span style={{ ...badgeBase, ...statusBadge(r.status) }}>{r.status}</span></td>
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

const panelWrap: React.CSSProperties = { border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden', background: '#fff' };
const panelHeader: React.CSSProperties = { width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', background: '#f9fafb', border: 'none', cursor: 'pointer', textAlign: 'left' };
const panelTitle: React.CSSProperties = { fontSize: 15, fontWeight: 600, color: '#111' };
const panelChevron: React.CSSProperties = { fontSize: 11, color: '#6b7280' };
const panelBody: React.CSSProperties = { padding: '16px 18px' };

const kitFormWrap: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 12 };
const formRow: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4 };
const label: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: '#374151' };
const input: React.CSSProperties = { padding: '8px 10px', borderRadius: 7, border: '1px solid #d1d5db', fontSize: 14, background: '#fff' };

const kitSummary: React.CSSProperties = { background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 8, padding: '12px 14px' };
const kitSummaryHeader: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, gap: 8, flexWrap: 'wrap' };
const kitSummaryTitle: React.CSSProperties = { fontSize: 14, fontWeight: 700, color: '#0c4a6e' };
const kitBadge: React.CSSProperties = { display: 'inline-block', padding: '2px 8px', borderRadius: 12, fontSize: 12, fontWeight: 600 };
const kitItemList: React.CSSProperties = { margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 };
const kitItemLi: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 };
const kitItemName: React.CSSProperties = { fontSize: 13, color: '#0c4a6e' };
const kitItemAvail = (units: number): React.CSSProperties => ({
  fontSize: 12,
  fontWeight: 600,
  color: units > 0 ? '#065f46' : '#991b1b',
});
const kitWarning: React.CSSProperties = { margin: '10px 0 0', fontSize: 12, color: '#92400e', padding: '6px 10px', background: '#fef3c7', borderRadius: 6 };

const table: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 14 };
const th: React.CSSProperties = { padding: '8px 10px', textAlign: 'left', fontWeight: 600, borderBottom: '1px solid #e5e7eb', color: '#374151', fontSize: 13 };
const td: React.CSSProperties = { padding: '9px 10px', borderBottom: '1px solid #f3f4f6', verticalAlign: 'top' };
const badgeBase: React.CSSProperties = { display: 'inline-block', padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600 };
function statusBadge(s: string): React.CSSProperties {
  if (s === 'APPROVED') return { background: '#d1fae5', color: '#065f46' };
  if (s === 'REJECTED') return { background: '#fee2e2', color: '#991b1b' };
  if (s === 'CANCELLED') return { background: '#f3f4f6', color: '#6b7280' };
  return { background: '#fef3c7', color: '#92400e' }; // PENDING
}
