/**
 * Equipment Availability Checker (Feature 2 — EQUIP-AVAIL-01..10).
 * Open to every authenticated role. Read-only — no borrow action here
 * (EQUIP-AVAIL-09; that's Feature 3). Total stock only renders for staff
 * (EQUIP-AVAIL-05); the server already omits it for other roles.
 *
 * Students see a "Request to Borrow" button on each card that navigates to
 * /my-borrows with the equipment type pre-selected — this is navigation only,
 * not a borrow action on this screen.
 *
 * Kit Pack card appears below individual items when a sport filter is active
 * and that sport has ≥2 equipment types.
 */
import { useEffect, useMemo, useState, useCallback } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth.js';
import { PortalShell } from '../auth/PortalShell.js';
import { listSportCategories, type SportCategory } from '../inventory/api.js';
import { listAvailability, subscribeAvailability, type AvailabilityRow } from './api.js';
import { getKitPack, type KitPack } from './kitPackApi.js';
import { KitPackCard } from './KitPackCard.js';
import { ApiRequestError } from '../../lib/api.js';

export default function AvailabilityScreen() {
  const { user, loading } = useAuth();
  const [rows, setRows] = useState<AvailabilityRow[] | null>(null);
  const [cats, setCats] = useState<SportCategory[]>([]);
  const [sportCategoryId, setSportCategoryId] = useState(0);
  const [indoorFilter, setIndoorFilter] = useState<'' | 'indoor' | 'outdoor'>('');
  const [live, setLive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  // Kit pack state
  const [kitPack, setKitPack] = useState<KitPack | null>(null);
  const [kitLoading, setKitLoading] = useState(false);

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

  // Live updates via SSE
  useEffect(() => {
    if (loading || !user) return;
    const close = subscribeAvailability((snapshot) => {
      setRows(snapshot);
      setLive(true);
    });
    return close;
  }, [loading, user]);

  // Load kit pack when sport filter changes
  useEffect(() => {
    if (!sportCategoryId) { setKitPack(null); return; }
    setKitLoading(true);
    getKitPack(sportCategoryId)
      .then((res) => setKitPack(res.kitPack))
      .catch(() => setKitPack(null))
      .finally(() => setKitLoading(false));
  }, [sportCategoryId]);

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
  const showKitPack = !!sportCategoryId && !indoorFilter && kitPack && kitPack.items.length >= 2;

  return (
    <PortalShell title="Equipment Availability" tint={isStaff ? 'navy' : 'sage'}>
      <div style={wrap}>
        <div style={headerRow}>
          <p style={subtitle}>Live status per equipment type. Updates automatically — no refresh needed.</p>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
            <span style={{ ...liveDot, ...(live ? liveDotOn : undefined) }}>
              <span style={dot} /> {live ? 'Live' : 'Connecting…'}
            </span>
            {isStudent && (
              <button style={myBorrowsBtn} onClick={() => navigate('/my-borrows')}>
                My Borrows
              </button>
            )}
          </div>
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

        {/* Individual items grid */}
        {rows === null ? (
          <p style={muted}>Loading…</p>
        ) : filtered.length === 0 ? (
          <p style={muted}>No equipment matches these filters.</p>
        ) : (
          <div style={grid}>
            {filtered.map((r) => (
              <EquipmentCard key={r.equipmentTypeId} row={r} showTotal={isStaff} isStudent={isStudent} />
            ))}
          </div>
        )}

        {/* Kit Pack card — below individual items */}
        {sportCategoryId > 0 && (
          <>
            {showKitPack && <p style={sectionLabel}>Full kit</p>}
            <div>
              {kitLoading ? (
                <p style={muted}>Loading kit pack…</p>
              ) : showKitPack ? (
                <KitPackCard pack={kitPack!} isStudent={isStudent} />
              ) : null}
            </div>
          </>
        )}
      </div>
    </PortalShell>
  );
}

function EquipmentCard({ row, showTotal, isStudent }: { row: AvailabilityRow; showTotal: boolean; isStudent: boolean }) {
  const navigate = useNavigate();
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
          <span style={countLabel}>
            available{showTotal && row.totalStock !== undefined ? ` of ${row.totalStock} total` : ''}
          </span>
        </div>

        {/* Borrow request button — students only, navigates to My Borrows with type pre-selected */}
        {isStudent && (
          <button
            style={row.availableUnits > 0 ? borrowBtn : borrowBtnDisabled}
            disabled={row.availableUnits === 0}
            onClick={() => navigate(`/borrow/${row.equipmentTypeId}`)}
          >
            {row.availableUnits > 0 ? 'Request to Borrow' : 'Unavailable'}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const wrap: React.CSSProperties = { maxWidth: 900, margin: '0 auto', padding: '24px 16px' };
const headerRow: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, gap: 12, flexWrap: 'wrap' };
const subtitle: React.CSSProperties = { margin: 0, color: '#6b7280', fontSize: 14 };
const liveDot: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#6b7280' };
const liveDotOn: React.CSSProperties = { color: '#059669' };
const dot: React.CSSProperties = { display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: 'currentColor' };
const filterRow: React.CSSProperties = { display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' };
const select: React.CSSProperties = { padding: '8px 12px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 14, background: '#fff', cursor: 'pointer' };
const errBox: React.CSSProperties = { padding: '10px 14px', borderRadius: 8, background: '#fee2e2', color: '#991b1b', fontSize: 14, marginBottom: 16 };
const muted: React.CSSProperties = { color: '#6b7280', fontSize: 14 };
const sectionLabel: React.CSSProperties = { margin: '24px 0 12px', fontSize: 13, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#6b7280' };
const grid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 16 };

const card: React.CSSProperties = { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden', display: 'flex', flexDirection: 'column' };
const cardImageWrap: React.CSSProperties = { height: 120, background: '#f9fafb', display: 'flex', alignItems: 'center', justifyContent: 'center' };
const cardImage: React.CSSProperties = { width: '100%', height: '100%', objectFit: 'cover' };
const cardImagePlaceholder: React.CSSProperties = { width: 56, height: 56, borderRadius: '50%', background: '#2563eb', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, fontWeight: 700 };
const cardBody: React.CSSProperties = { padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 4, flex: 1 };
const cardTop: React.CSSProperties = { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 };
const cardTitle: React.CSSProperties = { margin: 0, fontSize: 15, fontWeight: 600, color: '#111', flex: 1 };
const cardMeta: React.CSSProperties = { margin: 0, fontSize: 12, color: '#6b7280' };
const cardCount: React.CSSProperties = { display: 'flex', alignItems: 'baseline', gap: 4, marginTop: 6 };
const countNumber: React.CSSProperties = { fontSize: 24, fontWeight: 700, color: '#111', lineHeight: 1 };
const countLabel: React.CSSProperties = { fontSize: 12, color: '#6b7280' };
const badgeBase: React.CSSProperties = { display: 'inline-block', padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' };
const badge = {
  ok: { backgroundColor: '#d1fae5', color: '#065f46' },
  warn: { backgroundColor: '#fef3c7', color: '#92400e' },
  danger: { backgroundColor: '#fee2e2', color: '#991b1b' },
} as const;

const borrowBtn: React.CSSProperties = { marginTop: 10, width: '100%', padding: '8px 0', borderRadius: 7, border: 'none', background: '#374151', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' };
const borrowBtnDisabled: React.CSSProperties = { ...borrowBtn, background: '#e5e7eb', color: '#9ca3af', cursor: 'not-allowed' };
const myBorrowsBtn: React.CSSProperties = { padding: '7px 16px', borderRadius: 7, border: 'none', background: '#374151', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' };
