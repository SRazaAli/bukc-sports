/**
 * Equipment Availability Checker (Feature 2 — EQUIP-AVAIL-01..10).
 * Open to every authenticated role. Read-only — no borrow request is ever
 * submitted from this screen (EQUIP-AVAIL-09). Students see a "Request to
 * Borrow" link per card that navigates to the dedicated request screen
 * (/my-borrows) with the equipment type pre-selected — the request itself
 * is still only ever submitted there, this is pure navigation.
 * Total stock only renders for staff (EQUIP-AVAIL-05); the server already
 * omits it for other roles.
 */
import { useEffect, useMemo, useState, useCallback } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth.js';
import { PortalShell } from '../auth/PortalShell.js';
import { listSportCategories, type SportCategory } from '../inventory/api.js';
import { listAvailability, subscribeAvailability, type AvailabilityRow } from './api.js';
import { ApiRequestError } from '../../lib/api.js';

export default function AvailabilityScreen() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState<AvailabilityRow[] | null>(null);
  const [cats, setCats] = useState<SportCategory[]>([]);
  const [sportCategoryId, setSportCategoryId] = useState(0);
  const [indoorFilter, setIndoorFilter] = useState<'' | 'indoor' | 'outdoor'>('');
  const [live, setLive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadInitial = useCallback(async () => {
    try {
      const [status, categories] = await Promise.all([listAvailability(), listSportCategories()]);
      setRows(status.status);
      setCats(categories.categories);
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.body.error : 'Could not load availability.');
    }
  }, []);

  useEffect(() => { void loadInitial(); }, [loadInitial]);

  // Live updates via SSE. The stream sends the full list on every change;
  // filters are applied client-side against whatever the stream last sent.
  useEffect(() => {
    if (loading || !user) return;
    const close = subscribeAvailability((snapshot) => {
      setRows(snapshot);
      setLive(true);
    });
    return close;
  }, [loading, user]);

  const filtered = useMemo(() => {
    if (!rows) return [];
    return rows.filter((r) => {
      if (sportCategoryId && r.sportCategoryId !== sportCategoryId) return false;
      if (indoorFilter === 'indoor' && !r.isIndoor) return false;
      if (indoorFilter === 'outdoor' && r.isIndoor) return false;
      return true;
    });
  }, [rows, sportCategoryId, indoorFilter]);

  if (loading) return <PortalShell title="Equipment Availability"><p /></PortalShell>;
  if (!user) return <Navigate to="/" replace />;

  const isStaff = user.role === 'SUPER_ADMIN' || user.role === 'COORDINATOR';
  const isStudent = user.role === 'STUDENT';

  return (
    <PortalShell title="Equipment Availability" tint={isStaff ? 'navy' : 'sage'}>
      <div style={wrap}>
        <div style={headerRow}>
          <p style={subtitle}>Live status per equipment type. Updates automatically — no refresh needed.</p>
          <span style={{ ...liveDot, ...(live ? liveDotOn : undefined) }}>
            <span style={dot} /> {live ? 'Live' : 'Connecting…'}
          </span>
        </div>

        <div style={filterRow}>
          <select style={select} value={sportCategoryId} onChange={(e) => setSportCategoryId(Number(e.target.value))}>
            <option value={0}>All sports</option>
            {cats.map((c) => <option key={c.sport_category_id} value={c.sport_category_id}>{c.name}</option>)}
          </select>
          <select style={select} value={indoorFilter} onChange={(e) => setIndoorFilter(e.target.value as '' | 'indoor' | 'outdoor')}>
            <option value="">Indoor &amp; outdoor</option>
            <option value="indoor">Indoor only</option>
            <option value="outdoor">Outdoor only</option>
          </select>
        </div>

        {error && <div style={errBox}>{error}</div>}

        {rows === null ? (
          <p style={muted}>Loading…</p>
        ) : filtered.length === 0 ? (
          <p style={muted}>No equipment matches these filters.</p>
        ) : (
          <div style={grid}>
            {filtered.map((r) => (
              <EquipmentCard key={r.equipmentTypeId} row={r} showTotal={isStaff}
                onRequest={isStudent ? () => navigate(`/my-borrows?type=${r.equipmentTypeId}`) : undefined} />
            ))}
          </div>
        )}
      </div>
    </PortalShell>
  );
}

function EquipmentCard({ row, showTotal, onRequest }: { row: AvailabilityRow; showTotal: boolean; onRequest?: () => void }) {
  const badgeStyle = row.statusBadge === 'AVAILABLE' ? badge.ok : row.statusBadge === 'LOW_STOCK' ? badge.warn : badge.danger;
  const badgeText = row.statusBadge === 'AVAILABLE' ? 'Available' : row.statusBadge === 'LOW_STOCK' ? 'Low Stock' : 'Checked Out';

  return (
    <div style={card}>
      <div style={cardImageWrap}>
        {row.imageUrl
          ? <img src={row.imageUrl} alt="" style={cardImage} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          : <div style={cardImagePlaceholder}>{row.name.charAt(0)}</div>}
      </div>
      <div style={cardBody}>
        <div style={cardTop}>
          <h3 style={cardTitle}>{row.name}</h3>
          <span style={{ ...badgeBase, ...badgeStyle }}>{badgeText}</span>
        </div>
        <p style={cardMeta}>{row.sportCategoryName} · {row.isIndoor ? 'Indoor' : 'Outdoor'} · {row.lendingUnit === 'PAIR' ? 'Pair' : 'Single'}</p>
        <div style={cardCount}>
          <span style={countNumber}>{row.availableUnits}</span>
          <span style={countLabel}>available{showTotal && row.totalStock !== undefined ? ` of ${row.totalStock}` : ''}</span>
        </div>
        {/* Navigation only, never submits a request from here — the actual
            borrow request is always initiated on the dedicated screen
            (EQUIP-AVAIL-09: this checker stays read-only). */}
        {onRequest && (
          <button type="button" style={requestBtn} onClick={onRequest}>
            Request to Borrow →
          </button>
        )}
      </div>
    </div>
  );
}

const wrap: React.CSSProperties = { maxWidth: 980, margin: '0 auto' };
const headerRow: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, gap: 16, flexWrap: 'wrap' };
const subtitle: React.CSSProperties = { color: '#5c6773', fontSize: 14.5, margin: 0, maxWidth: 480 };
const liveDot: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600, color: '#8a949f', whiteSpace: 'nowrap' };
const liveDotOn: React.CSSProperties = { color: '#1f8a4c' };
const dot: React.CSSProperties = { width: 7, height: 7, borderRadius: '50%', background: 'currentColor', display: 'inline-block' };
const filterRow: React.CSSProperties = { display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' };
const select: React.CSSProperties = { font: '14px var(--font-body)', padding: '8px 12px', border: '1px solid #ccc', borderRadius: 4, background: '#fff' };
const muted: React.CSSProperties = { color: '#5c6773', fontSize: 14.5 };
const errBox: React.CSSProperties = { background: '#fdecec', color: '#8f2323', border: '1px solid #f3caca', borderRadius: 4, padding: '10px 14px', marginBottom: 16, fontSize: 14 };
const grid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 16 };
const card: React.CSSProperties = { background: '#fff', border: '1px solid #ddd', borderRadius: 8, overflow: 'hidden', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' };
const cardImageWrap: React.CSSProperties = { height: 110, background: '#eef1f4' };
const cardImage: React.CSSProperties = { width: '100%', height: '100%', objectFit: 'cover', display: 'block' };
const cardImagePlaceholder: React.CSSProperties = { width: '100%', height: '100%', display: 'grid', placeItems: 'center', font: '600 32px var(--font-display)', color: '#b8c2cc' };
const cardBody: React.CSSProperties = { padding: 14 };
const cardTop: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 };
const cardTitle: React.CSSProperties = { font: '600 15px var(--font-body)', color: '#26485f', margin: 0 };
const cardMeta: React.CSSProperties = { fontSize: 12.5, color: '#8a949f', margin: '4px 0 10px' };
const cardCount: React.CSSProperties = { display: 'flex', alignItems: 'baseline', gap: 6 };
const requestBtn: React.CSSProperties = { marginTop: 12, width: '100%', font: '600 13px var(--font-body)', padding: '8px 10px', border: 'none', borderRadius: 4, background: '#0a6ebd', color: '#fff', cursor: 'pointer' };
const countNumber: React.CSSProperties = { font: '700 24px var(--font-display)', color: '#1a1d21' };
const countLabel: React.CSSProperties = { fontSize: 12.5, color: '#5c6773' };
const badgeBase: React.CSSProperties = { font: '600 11px var(--font-mono)', padding: '3px 8px', borderRadius: 4, whiteSpace: 'nowrap' };
const badge = {
  ok: { background: '#e6f4ec', color: '#1f7a45' } as React.CSSProperties,
  warn: { background: '#fdf1e3', color: '#9a6412' } as React.CSSProperties,
  danger: { background: '#fbe9e7', color: '#b3352b' } as React.CSSProperties,
};
