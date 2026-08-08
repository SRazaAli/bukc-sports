/**
 * Student — Borrow Equipment (BORROW-01..14). Not linked from anywhere in
 * the UI as a standalone destination anymore — every equipment card on
 * Availability has its own "Request to Borrow" link that lands here with
 * ?type=<id>, showing a product-page-style detail view for that specific
 * type. This screen and its route stay fully functional (the per-equipment
 * flow depends on it), the compact-picker fallback below still exists for
 * a bare /my-borrows visit, it's just intentionally not surfaced via any
 * nav button or link — Availability is the one entry point now. Start time
 * defaults to the current time (rounded to nearest 5 min), return time
 * to start + 1 hour. Max borrow duration is enforced client-side for
 * immediate feedback (server enforces it too — defense in depth).
 */
import { useEffect, useState, useCallback, useMemo } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../lib/auth.js';
import { PortalShell, PrimaryButton } from '../auth/PortalShell.js';
import { listTypes, type EquipmentType } from '../inventory/api.js';
import { listAvailability, type AvailabilityRow } from '../availability/api.js';
import { submitRequest } from './api.js';
import { ApiRequestError } from '../../lib/api.js';

function errMsg(e: unknown) { return e instanceof ApiRequestError ? e.body.error : 'Something went wrong.'; }

/** Round a Date up to the next 5-minute mark. */
function roundTo5(d: Date): Date {
  const ms = 5 * 60_000;
  return new Date(Math.ceil(d.getTime() / ms) * ms);
}
function toTimeStr(d: Date) { return d.toTimeString().slice(0, 5); }
function toDateStr(d: Date) { return d.toISOString().slice(0, 10); }

export default function MyBorrowsScreen() {
  const { user, loading } = useAuth();
  const [searchParams] = useSearchParams();
  const preselectedType = Number(searchParams.get('type')) || 0;
  const [types, setTypes] = useState<EquipmentType[]>([]);
  const [availability, setAvailability] = useState<AvailabilityRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [t, a] = await Promise.all([listTypes(), listAvailability()]);
      setTypes(t.types);
      setAvailability(a.status);
    } catch (e) { setError(errMsg(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (loading) return <PortalShell title="Request Equipment"><p /></PortalShell>;
  if (!user) return <Navigate to="/" replace />;
  if (user.role !== 'STUDENT') return <Navigate to="/home" replace />;

  return (
    <PortalShell title="Request Equipment" tint="sage">
      <div style={wrap}>
        {error && <div style={box.err}>{error}</div>}
        {notice && <div style={box.ok}>{notice}</div>}

        {preselectedType ? (
          <ProductDetailRequest
            typeId={preselectedType}
            types={types}
            availability={availability}
            onDone={(m) => { setNotice(m); setError(null); void load(); }}
            onError={(m) => { setError(m); setNotice(null); }}
          />
        ) : (
          <Panel title="Request Equipment">
            <RequestForm
              types={types}
              availability={availability}
              onDone={(m) => { setNotice(m); setError(null); void load(); }}
              onError={(m) => { setError(m); setNotice(null); }}
            />
          </Panel>
        )}
      </div>
    </PortalShell>
  );
}

/** Product-page style view when a specific equipment type is pre-selected. */
function ProductDetailRequest({ typeId, types, availability, onDone, onError }: {
  typeId: number; types: EquipmentType[]; availability: AvailabilityRow[];
  onDone: (m: string) => void; onError: (m: string) => void;
}) {
  const eqType = types.find((t) => t.equipment_type_id === typeId);
  const avail = availability.find((a) => a.equipmentTypeId === typeId);

  if (types.length > 0 && !eqType) {
    return <Panel title="Equipment Not Found"><p style={muted}>This equipment type does not exist or is no longer available.</p></Panel>;
  }
  if (!eqType) return <Panel title="Loading…"><p style={muted}>Loading equipment details…</p></Panel>;

  const availableUnits = avail?.availableUnits ?? 0;
  const maxMinutes = eqType.max_borrow_duration_minutes;

  return (
    <div style={productLayout}>
      {/* Image / placeholder */}
      <div style={productImageWrap}>
        {eqType.image_url ? (
          <img src={eqType.image_url} alt={eqType.name} style={productImage} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
        ) : (
          <div style={productImagePlaceholder}>{eqType.name.charAt(0)}</div>
        )}
      </div>

      {/* Details + form */}
      <div style={productDetails}>
        <div style={productMeta}>{eqType.sport_category_name}</div>
        <h2 style={productTitle}>{eqType.name}</h2>
        <div style={productTags}>
          <span style={tag}>{eqType.is_indoor ? 'Indoor' : 'Outdoor'}</span>
          <span style={tag}>{eqType.lending_unit === 'PAIR' ? 'Lent as pair' : 'Single unit'}</span>
        </div>

        <div style={stockRow}>
          <span style={{ ...stockNumber, color: availableUnits > 0 ? '#1f7a45' : '#b3352b' }}>{availableUnits}</span>
          <span style={stockLabel}>unit{availableUnits !== 1 ? 's' : ''} available</span>
        </div>

        <div style={divider} />

        <RequestForm
          types={types}
          availability={availability}
          fixedTypeId={typeId}
          maxMinutesProp={maxMinutes}
          onDone={onDone}
          onError={onError}
        />
      </div>
    </div>
  );
}

function RequestForm({ types, availability, fixedTypeId, maxMinutesProp, onDone, onError }: {
  types: EquipmentType[]; availability: AvailabilityRow[];
  fixedTypeId?: number; maxMinutesProp?: number;
  onDone: (m: string) => void; onError: (m: string) => void;
}) {
  const now = useMemo(() => roundTo5(new Date()), []);
  const oneHourLater = useMemo(() => new Date(now.getTime() + 60 * 60_000), [now]);

  const [equipmentTypeId, setType] = useState(fixedTypeId ?? 0);
  const [date, setDate] = useState(() => toDateStr(now));
  const [startTime, setStartTime] = useState(() => toTimeStr(now));
  const [endTime, setEndTime] = useState(() => toTimeStr(oneHourLater));
  const [busy, setBusy] = useState(false);

  const selectedType = types.find((t) => t.equipment_type_id === equipmentTypeId);
  const maxMinutes = selectedType?.max_borrow_duration_minutes ?? maxMinutesProp ?? 0;

  // Client-side max-duration validation
  const durationError = useMemo(() => {
    if (!startTime || !endTime || !maxMinutes) return null;
    const start = new Date(`${date}T${startTime}:00`);
    const end = new Date(`${date}T${endTime}:00`);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return null;
    const mins = (end.getTime() - start.getTime()) / 60_000;
    if (mins <= 0) return 'Return time must be after start time.';
    if (mins > maxMinutes) {
      const h = Math.floor(maxMinutes / 60);
      const m = maxMinutes % 60;
      const dur = h > 0 && m > 0 ? `${h}h ${m}m` : h > 0 ? `${h}h` : `${m}m`;
      return `Maximum borrow duration is ${dur}.`;
    }
    return null;
  }, [startTime, endTime, date, maxMinutes]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!equipmentTypeId) { onError('Choose an equipment type.'); return; }
    if (durationError) { onError(durationError); return; }
    setBusy(true);
    try {
      const requestedStartAt = new Date(`${date}T${startTime}:00`).toISOString();
      const requestedReturnAt = new Date(`${date}T${endTime}:00`).toISOString();
      await submitRequest({ equipmentTypeId, requestedStartAt, requestedReturnAt });
      onDone('Request submitted. You will be notified once a Coordinator reviews it.');
    } catch (e) { onError(errMsg(e)); } finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} style={formGrid}>
      {!fixedTypeId && (
        <L label="Equipment">
          <select style={inp} value={equipmentTypeId} onChange={(e) => setType(Number(e.target.value))} required>
            <option value={0}>Select</option>
            {types.filter((t) => t.equipment_type_id).map((t) => {
              const av = availability.find((a) => a.equipmentTypeId === t.equipment_type_id);
              const units = av?.availableUnits ?? 0;
              return <option key={t.equipment_type_id} value={t.equipment_type_id}>{t.name} ({units} available)</option>;
            })}
          </select>
        </L>
      )}
      <L label="Date"><input type="date" style={inp} value={date} onChange={(e) => setDate(e.target.value)} required /></L>
      <L label="Start time"><input type="time" style={inp} value={startTime} onChange={(e) => setStartTime(e.target.value)} required /></L>
      <L label="Return time"><input type="time" style={inp} value={endTime} onChange={(e) => setEndTime(e.target.value)} required /></L>
      {durationError && <div style={{ ...durationWarn, gridColumn: '1 / -1' }}>{durationError}</div>}
      {maxMinutes > 0 && !durationError && (
        <div style={{ ...durationHint, gridColumn: '1 / -1' }}>
          Max borrow duration: {Math.floor(maxMinutes / 60) > 0 ? `${Math.floor(maxMinutes / 60)}h` : ''}{maxMinutes % 60 > 0 ? ` ${maxMinutes % 60}m` : ''}
        </div>
      )}
      <div style={{ gridColumn: '1 / -1' }}><PrimaryButton disabled={busy || !!durationError}>{busy ? 'Submitting…' : 'Submit Request'}</PrimaryButton></div>
    </form>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return <section style={panel}><div style={panelHead}>{title}</div><div style={panelBody}>{children}</div></section>;
}
function L({ label, children }: { label: string; children: React.ReactNode }) {
  return <label style={{ display: 'block' }}><span style={lbl}>{label}</span>{children}</label>;
}

// ── Styles ──
const wrap: React.CSSProperties = { maxWidth: 820, margin: '0 auto' };
const panel: React.CSSProperties = { background: '#fff', border: '1px solid #ddd', borderRadius: 4, marginBottom: 18, boxShadow: '0 1px 2px rgba(0,0,0,0.05)' };
const panelHead: React.CSSProperties = { padding: '12px 18px', borderBottom: '1px solid #e5e5e5', font: '600 15px var(--font-body)', color: '#333', background: 'linear-gradient(#fff,#f7f7f7)' };
const panelBody: React.CSSProperties = { padding: 18 };
const muted: React.CSSProperties = { color: '#5c6773', fontSize: 14.5, margin: 0 };
const formGrid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, maxWidth: 480 };
const lbl: React.CSSProperties = { display: 'block', font: '500 12px var(--font-body)', color: '#26485f', marginBottom: 5 };
const inp: React.CSSProperties = { width: '100%', font: '14px var(--font-body)', padding: '8px 10px', border: '1px solid #ccc', borderRadius: 4 };
const box = {
  err: { background: '#fdecec', color: '#8f2323', border: '1px solid #f3caca', borderRadius: 4, padding: '10px 14px', marginBottom: 16, fontSize: 14 } as React.CSSProperties,
  ok: { background: '#eaf6ee', color: '#1e6b3a', border: '1px solid #c2e6cd', borderRadius: 4, padding: '10px 14px', marginBottom: 16, fontSize: 14 } as React.CSSProperties,
};
const durationWarn: React.CSSProperties = { color: '#b3352b', fontSize: 13, background: '#fef0ee', border: '1px solid #f3caca', borderRadius: 4, padding: '6px 10px' };
const durationHint: React.CSSProperties = { color: '#8a949f', fontSize: 12.5 };

// Product-page layout
const productLayout: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0, background: '#fff', border: '1px solid #ddd', borderRadius: 4, overflow: 'hidden', boxShadow: '0 1px 2px rgba(0,0,0,0.05)', marginBottom: 18 };
const productImageWrap: React.CSSProperties = { background: '#eef1f4', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 320 };
const productImage: React.CSSProperties = { width: '100%', height: '100%', objectFit: 'cover', display: 'block' };
const productImagePlaceholder: React.CSSProperties = { font: '600 72px var(--font-display)', color: '#b8c2cc' };
const productDetails: React.CSSProperties = { padding: '28px 28px 24px' };
const productMeta: React.CSSProperties = { font: '600 11px var(--font-mono)', color: '#0a6ebd', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 };
const productTitle: React.CSSProperties = { font: '700 24px var(--font-display)', color: '#1a1d21', margin: '0 0 10px' };
const productTags: React.CSSProperties = { display: 'flex', gap: 8, marginBottom: 14 };
const tag: React.CSSProperties = { font: '500 11.5px var(--font-body)', padding: '3px 10px', borderRadius: 12, background: '#eef2f6', color: '#5c6773' };
const stockRow: React.CSSProperties = { display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 6 };
const stockNumber: React.CSSProperties = { font: '700 28px var(--font-display)' };
const stockLabel: React.CSSProperties = { fontSize: 13, color: '#5c6773' };
const divider: React.CSSProperties = { borderTop: '1px solid #e5e5e5', margin: '16px 0' };
