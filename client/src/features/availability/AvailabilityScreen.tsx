/**
 * Equipment Availability — all roles (EQUIP-AVAIL-01..10).
 * Live SSE updates. Read-only. Redesigned with AppShell theme.
 */
import { useEffect, useState, useCallback } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth.js';
import AppShell, { PageHeader, Badge, EmptyState, ErrorBox, Skeleton } from '../../components/AppShell.js';
import { listAvailability, subscribeAvailability, type AvailabilityRow, type AvailabilityFilter } from './api.js';
import { api, ApiRequestError } from '../../lib/api.js';

function errMsg(e: unknown) { return e instanceof ApiRequestError ? e.body.error : 'Something went wrong.'; }
interface SportCat { sport_category_id: number; name: string; }

export default function AvailabilityScreen() {
  const { user, loading: authLoading } = useAuth();
  const [rows,   setRows]   = useState<AvailabilityRow[] | null>(null);
  const [sports, setSports] = useState<SportCat[]>([]);
  const [filter, setFilter] = useState<AvailabilityFilter>({});
  const [live,   setLive]   = useState(false);
  const [error,  setError]  = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setRows((await listAvailability(filter)).status); } catch (e) { setError(errMsg(e)); }
  }, [filter]);
  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const unsub = subscribeAvailability((snap) => { setRows(snap); setLive(true); });
    return unsub;
  }, []);

  useEffect(() => {
    api<{ categories: SportCat[] }>('/api/inventory/sport-categories')
      .then((r) => setSports(r.categories)).catch(() => {});
  }, []);

  if (authLoading) return <AppShell title="Equipment"><p /></AppShell>;
  if (!user) return <Navigate to="/" replace />;
  const isStaff = user.role === 'SUPER_ADMIN' || user.role === 'COORDINATOR';

  return (
    <AppShell title="Equipment Availability">
      <PageHeader title="Equipment Availability" subtitle="Live status across all sport equipment">
        <LivePill live={live} />
      </PageHeader>
      {error && <ErrorBox message={error} />}

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 'var(--sp-4)' }}>
        <select style={sel} value={filter.sportCategoryId ?? ''} onChange={(e) => setFilter((f) => ({ ...f, sportCategoryId: e.target.value ? Number(e.target.value) : undefined }))}>
          <option value="">All sports</option>
          {sports.map((s) => <option key={s.sport_category_id} value={s.sport_category_id}>{s.name}</option>)}
        </select>
        <select style={sel} value={filter.isIndoor === undefined ? '' : String(filter.isIndoor)} onChange={(e) => setFilter((f) => ({ ...f, isIndoor: e.target.value === '' ? undefined : e.target.value === 'true' }))}>
          <option value="">Indoor &amp; Outdoor</option>
          <option value="true">Indoor only</option>
          <option value="false">Outdoor only</option>
        </select>
        {(filter.sportCategoryId || filter.isIndoor !== undefined) && (
          <button style={ghostBtn} onClick={() => setFilter({})}>Clear filters</button>
        )}
      </div>

      {/* Card grid */}
      {rows === null ? (
        <div style={grid}>{[1,2,3,4,5,6].map((i) => <div key={i} style={{ ...equipCard, height: 180, animation: 'pulse 1.4s ease infinite' }}><style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}`}</style></div>)}</div>
      ) : rows.length === 0 ? (
        <EmptyState title="No equipment found" body="Try adjusting your filters or check back later." />
      ) : (
        <div style={grid}>
          {rows.map((r) => (
            <div key={r.equipmentTypeId} style={equipCard}
              onMouseEnter={(e) => { Object.assign((e.currentTarget as HTMLElement).style, { boxShadow: 'var(--shadow-md)', transform: 'translateY(-2px)' }); }}
              onMouseLeave={(e) => { Object.assign((e.currentTarget as HTMLElement).style, { boxShadow: 'var(--shadow-sm)', transform: 'none' }); }}>
              {r.imageUrl
                ? <img src={r.imageUrl} alt={r.name} style={imgStyle} />
                : <div style={{ ...imgStyle, background: 'linear-gradient(135deg, var(--navy) 0%, var(--teal) 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', font: '700 32px var(--font-display)', color: 'rgba(255,255,255,0.4)' }}>{r.name.charAt(0)}</div>
              }
              <div style={{ padding: '14px 16px 16px' }}>
                <div style={{ font: '600 14px var(--font-display)', color: 'var(--navy)', marginBottom: 2 }}>{r.name}</div>
                <div style={{ font: '12px var(--font-body)', color: 'var(--ink-muted)', marginBottom: 12 }}>
                  {r.sportCategoryName} · {r.isIndoor ? 'Indoor' : 'Outdoor'} · {r.lendingUnit === 'PAIR' ? 'Pair unit' : 'Single unit'}
                </div>
                <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
                  <div>
                    <span style={{ font: '700 22px/1 var(--font-display)', color: 'var(--navy)' }}>{r.availableUnits}</span>
                    <span style={{ font: '12px var(--font-body)', color: 'var(--ink-muted)', marginLeft: 4 }}>
                      available{isStaff && r.totalStock !== undefined ? ` / ${r.totalStock} total` : ''}
                    </span>
                  </div>
                  <Badge status={r.statusBadge} />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </AppShell>
  );
}

function LivePill({ live }: { live: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ width: 8, height: 8, borderRadius: '50%', background: live ? '#1f7a45' : 'var(--line)', transition: 'background 400ms' }} />
      <span style={{ font: '12px var(--font-body)', color: live ? '#1f7a45' : 'var(--ink-muted)' }}>{live ? 'Live' : 'Connecting…'}</span>
    </div>
  );
}

const sel: React.CSSProperties = { font: '13.5px var(--font-body)', padding: '7px 10px', border: '1px solid var(--line)', borderRadius: 'var(--radius)', background: 'var(--white)', color: 'var(--ink)', outline: 'none' };
const ghostBtn: React.CSSProperties = { font: '13px var(--font-body)', padding: '7px 12px', background: 'none', border: '1px solid var(--line)', borderRadius: 'var(--radius)', cursor: 'pointer', color: 'var(--ink-muted)' };
const grid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 'var(--sp-4)' };
const equipCard: React.CSSProperties = { background: 'var(--white)', border: '1px solid var(--line-light)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', boxShadow: 'var(--shadow-sm)', transition: 'box-shadow var(--t-fast) var(--ease), transform var(--t-fast) var(--ease)' };
const imgStyle: React.CSSProperties = { width: '100%', height: 110, objectFit: 'cover', display: 'block' };
