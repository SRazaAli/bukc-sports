/**
 * Equipment Availability Checker (Feature 2 — EQUIP-AVAIL-01..10).
 * Open to every authenticated role. Read-only — no borrow action here
 * (EQUIP-AVAIL-09; that's Feature 3). Total stock only renders for staff
 * (EQUIP-AVAIL-05); the server already omits it for other roles.
 *
 * Role behaviour across all four roles (unchanged from before this re-theme):
 *  - STUDENT: sees a "Request to Borrow" button on each card that navigates
 *    to /borrow/:equipmentTypeId — this is navigation only, not a borrow
 *    action on this screen — plus a "Kit Borrow" shortcut to My Borrows, and
 *    the Kit Pack card's CTA.
 *  - EXTERNAL: browse-only. No borrow CTA, no total stock column.
 *  - COORDINATOR / SUPER_ADMIN ("staff"): browse-only, but do see total
 *    stock alongside available units.
 *
 * Kit Pack card appears below individual items when a sport filter is active
 * and that sport has ≥2 equipment types.
 *
 * Re-themed to match the site's actual current visual language (Landing /
 * Home / Register / Profile / Usage History / Accounts / Offline Fallback /
 * Conflict Detection / Venue Calendar): dark navy page with two soft glow
 * blobs, the same header (logo, wordmark, ghost Back/Sign out) as the
 * Accounts screen, everything wrapped in one frosted glass panel, white
 * soft-gradient cards, and a single accent blue for interactive elements.
 * All data is real — listAvailability()/listSportCategories()/
 * subscribeAvailability() (SSE) and getKitPack() — nothing hardcoded or
 * mocked. The only new UI is a client-side name search over that same real
 * data (the reference mockup had a search box; there wasn't one here yet).
 */
import { useEffect, useMemo, useState, useCallback } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth.js';
import { listSportCategories, type SportCategory } from '../inventory/api.js';
import { listAvailability, subscribeAvailability, type AvailabilityRow } from './api.js';
import { getKitPack, type KitPack } from './kitPackApi.js';
import { KitPackCard } from './KitPackCard.js';
import { ApiRequestError } from '../../lib/api.js';
import { HideInAppShell } from '../../components/AppShellContext.js';

/* ---------- theme (identical values to LandingScreen/HomeScreen/ProfileUI/
   UsageHistoryScreen/AdminAccountsScreen/OfflineFallbackScreen/
   ConflictDetectionScreen/CalendarScreen `palette`) ---------- */
const palette = {
  navy900: '#0F172B',
  navy800: '#132357',
  navyDeep: '#031636',
  slate600: '#132357',
  slate500: '#62748E',
  slate400: '#90A1B9',
  slate300: '#CAD5E2',
  slate100: '#E2E8F0',
  slate50: '#F8FAFC',
  white: '#FFFFFF',
  accent: '#1C398E',
  accentSoft: '#DBEAFE',
  accentWash: '#1C398E14',
};

function roleLabel(role: string) {
  return role === 'SUPER_ADMIN' ? 'Administration Staff' : role === 'COORDINATOR' ? 'Coordinator' : role === 'EXTERNAL' ? 'External' : 'Student';
}

export default function AvailabilityScreen() {
  const { user, loading, logout } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState<AvailabilityRow[] | null>(null);
  const [cats, setCats] = useState<SportCategory[]>([]);
  const [sportCategoryId, setSportCategoryId] = useState(0);
  const [indoorFilter, setIndoorFilter] = useState<'' | 'indoor' | 'outdoor'>('');
  const [searchTerm, setSearchTerm] = useState('');
  const [live, setLive] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  useEffect(() => {
    if (loading || !user) return;
    void loadInitial();
  }, [loading, user, loadInitial]);

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
    const q = searchTerm.trim().toLowerCase();
    return rows.filter((r) => {
      if (sportCategoryId && r.sportCategoryId !== sportCategoryId) return false;
      if (indoorFilter === 'indoor' && !r.isIndoor) return false;
      if (indoorFilter === 'outdoor' && r.isIndoor) return false;
      if (q && !r.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, sportCategoryId, indoorFilter, searchTerm]);

  if (loading) {
    return <div className="eq-ui" style={{ minHeight: '100%', background: palette.navy900 }} />;
  }
  if (!user) return <Navigate to="/" replace />;

  const isStaff = user.role === 'SUPER_ADMIN' || user.role === 'COORDINATOR';
  const isStudent = user.role === 'STUDENT';
  const showKitPack = !!sportCategoryId && !indoorFilter && kitPack && kitPack.items.length >= 2;

  return (
    <div className="eq-ui" style={s.page}>
      <EqStyles />
      <div style={s.blobA} aria-hidden />
      <div style={s.blobB} aria-hidden />

      <HideInAppShell>
        <header style={s.topbar}>
          <div style={s.brand}>
            <img src="/landing/bu_logo.png" alt="Bahria University" style={s.logoImg} />
            <div>
              <div style={s.wordmark}>Bahria University</div>
              <div style={s.wordmarkSub}>Sports Management Portal</div>
            </div>
          </div>
          <div style={s.topbarRight}>
            <button type="button" className="hist-topbtn" style={s.topBtn} onClick={() => navigate('/home')}><BackIcon /> Back</button>
            <button type="button" className="hist-topbtn hist-signout" style={s.topBtn} onClick={() => { void logout(); navigate('/'); }}>
              <SignOutIcon /> Sign out
            </button>
          </div>
        </header>
      </HideInAppShell>

      <main style={s.main}>
        {/* Frosted glassmorphism shell around everything below the header —
            same treatment as Usage History, Accounts, Offline Fallback
            Entry, Conflict Detection, and Venue Calendar. */}
        <div className="eq-glass" style={s.glassPanel}>
          <div style={s.headRow}>
            <div style={s.headTop}>
              <div>
                <span style={s.eyebrow}>{roleLabel(user.role)} Portal</span>
                <h1 style={s.title}>Equipment Availability</h1>
                <p style={s.subtitle}>Live status per equipment type — updates automatically, no refresh needed.</p>
              </div>
              <div style={s.headRight}>
                <span style={{ ...s.liveDot, ...(live ? s.liveDotOn : {}) }}>
                  <span style={{ ...s.dot, ...(live ? s.dotOn : {}) }} /> {live ? 'Live' : 'Connecting…'}
                </span>
                {isStudent && (
                  <button type="button" className="eq-btn-primary" style={s.myBorrowsBtn} onClick={() => navigate('/my-borrows')}>
                    Kit Borrow
                  </button>
                )}
              </div>
            </div>
          </div>

          <div style={s.controlsRow}>
            <select className="eq-select" style={s.select} value={sportCategoryId} onChange={(e) => setSportCategoryId(Number(e.target.value))}>
              <option value={0}>All games</option>
              {cats.map((c) => <option key={c.sport_category_id} value={c.sport_category_id}>{c.name}</option>)}
            </select>
            <select className="eq-select" style={s.select} value={indoorFilter} onChange={(e) => setIndoorFilter(e.target.value as '' | 'indoor' | 'outdoor')}>
              <option value="">Indoor &amp; outdoor</option>
              <option value="indoor">Indoor only</option>
              <option value="outdoor">Outdoor only</option>
            </select>
            <div style={s.searchBox}>
              <span style={s.searchIcon}><SearchIcon /></span>
              <input
                className="eq-select"
                style={s.searchInput}
                type="search"
                placeholder="Search equipment…"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>

          {error && <div style={s.errBanner}>{error}</div>}

          {/* Individual items grid */}
          {rows === null ? (
            <SkeletonGrid />
          ) : filtered.length === 0 ? (
            <p style={s.muted}>No equipment matches these filters.</p>
          ) : (
            <div style={s.grid}>
              {filtered.map((r) => (
                <EquipmentCard key={r.equipmentTypeId} row={r} showTotal={isStaff} isStudent={isStudent} />
              ))}
            </div>
          )}

          {/* Kit Pack card — below individual items */}
          {sportCategoryId > 0 && (
            <>
              {showKitPack && <p style={s.sectionLabel}>Full kit</p>}
              <div>
                {kitLoading ? (
                  <p style={s.muted}>Loading kit pack…</p>
                ) : showKitPack ? (
                  <KitPackCard pack={kitPack!} isStudent={isStudent} />
                ) : null}
              </div>
            </>
          )}
        </div>
      </main>

      <HideInAppShell>
        <footer style={s.footer}>
          2026 © <a href="/" style={s.footerLink}>Bahria University</a> — Sports Management Portal
        </footer>
      </HideInAppShell>
    </div>
  );
}

function EquipmentCard({ row, showTotal, isStudent }: { row: AvailabilityRow; showTotal: boolean; isStudent: boolean }) {
  const navigate = useNavigate();
  const meta = row.statusBadge === 'AVAILABLE' ? STATUS.AVAILABLE : row.statusBadge === 'LOW_STOCK' ? STATUS.LOW_STOCK : STATUS.CHECKED_OUT;

  return (
    <div className="eq-card" style={s.card}>
      <div style={s.cardImageWrap}>
        {row.imageUrl
          ? <img src={row.imageUrl} alt="" style={s.cardImage} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          : <div style={s.cardImagePlaceholder}>{row.name.charAt(0)}</div>}
        <span style={{ ...s.stockPill, color: meta.color, background: meta.bg }}>
          <StockIcon /> {row.availableUnits} in stock
        </span>
      </div>
      <div style={s.cardBody}>
        <h3 style={s.cardTitle}>{row.name}</h3>
        <div style={s.metaRow}>
          <span style={s.metaTag}><TagIcon /> {row.sportCategoryName}</span>
          <span style={s.metaTag}>{row.isIndoor ? <><HomeIcon /> Indoor</> : <><SunIcon /> Outdoor</>}</span>
        </div>
        <div style={s.cardFootRow}>
          <span style={{ ...s.badge, color: meta.color, background: meta.bg }}>{meta.label}</span>
          {showTotal && row.totalStock !== undefined && <span style={s.totalText}>of {row.totalStock} total</span>}
        </div>

        {/* Borrow request button — students only, navigates to My Borrows
            with the type pre-selected. Unchanged: still /borrow/:id. */}
        {isStudent && (
          <button
            type="button"
            className="eq-btn-borrow"
            style={{ ...s.borrowBtn, ...(row.availableUnits === 0 ? s.borrowBtnDisabled : {}) }}
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

function SkeletonGrid() {
  return (
    <div style={s.grid}>
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} style={s.card}>
          <div className="eq-skel" style={{ ...s.cardImageWrap, background: palette.slate100 }} />
          <div style={s.cardBody}>
            <div className="eq-skel" style={{ height: 14, width: '70%', borderRadius: 6 }} />
            <div className="eq-skel" style={{ height: 10, width: '50%', borderRadius: 6, marginTop: 8 }} />
            <div className="eq-skel" style={{ height: 22, width: '40%', borderRadius: 6, marginTop: 10 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/* ---------- icons ---------- */
function BackIcon() { return <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M9.5 3 4 8l5.5 5M4.5 8H14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>; }
function SignOutIcon() { return <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M6.5 2H3.5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><path d="M10.5 5 14 8l-3.5 3M14 8H6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>; }
function SearchIcon() { return <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.6"/><path d="m14 14-2.8-2.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>; }
function StockIcon() { return <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M2 5.5 8 2l6 3.5v5L8 14 2 10.5v-5Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/><path d="M2 5.5 8 9l6-3.5M8 9v5" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/></svg>; }
function TagIcon() { return <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M9 2H4a1 1 0 0 0-1 1v5l7 7 6-6-7-7Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/><circle cx="6" cy="6" r="1" fill="currentColor"/></svg>; }
function HomeIcon() { return <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M2 7.5 8 2l6 5.5V13a1 1 0 0 1-1 1h-3v-4H6v4H3a1 1 0 0 1-1-1V7.5Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/></svg>; }
function SunIcon() { return <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.4"/><path d="M8 1v1.4M8 13.6V15M15 8h-1.4M2.4 8H1M12.7 3.3l-1 1M4.3 11.7l-1 1M12.7 12.7l-1-1M4.3 4.3l-1-1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>; }

function EqStyles() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
      .eq-ui { font-family: 'Inter', system-ui, sans-serif; }
      .eq-ui * { box-sizing: border-box; }
      .hist-topbtn { transition: background-color .18s ease, border-color .18s ease, color .18s ease; text-decoration: none; }
      .hist-topbtn:hover { background-color: rgba(255,255,255,0.08); border-color: ${palette.slate100}; }
      .hist-signout:hover { background-color: ${palette.accent} !important; border-color: ${palette.accent} !important; color: #fff !important; }
      .eq-select { transition: border-color .15s ease, box-shadow .15s ease; }
      .eq-select:focus { outline: none; border-color: ${palette.accent} !important; box-shadow: 0 0 0 3px ${palette.accentSoft}; }
      .eq-btn-primary { transition: filter .15s ease, transform .15s ease; }
      .eq-btn-primary:hover { filter: brightness(1.08); transform: translateY(-1px); }
      .eq-card { transition: transform .18s ease, box-shadow .18s ease; }
      .eq-card:hover { transform: translateY(-3px); box-shadow: 0 16px 30px -16px rgba(3,22,54,0.5); }
      .eq-btn-borrow { transition: filter .15s ease, transform .15s ease; }
      .eq-btn-borrow:hover:not(:disabled) { filter: brightness(1.1); transform: translateY(-1px); }
      .eq-btn-borrow:disabled { cursor: not-allowed; }
      .eq-skel { position: relative; overflow: hidden; background: ${palette.slate100}; }
      .eq-skel::after {
        content: ''; position: absolute; inset: 0; transform: translateX(-100%);
        background: linear-gradient(90deg, transparent, rgba(255,255,255,0.7), transparent);
        animation: eqShimmer 1.3s ease-in-out infinite;
      }
      @keyframes eqShimmer { 100% { transform: translateX(100%); } }
      @media (max-width: 620px) {
        .eq-glass { padding: 20px 14px 26px !important; border-radius: 18px !important; }
      }
    `}</style>
  );
}

/* ---------- styles ---------- */
const CARD_BG = 'linear-gradient(145deg, #F8FAFF 0%, #EAF0FC 100%)';
const CARD_SHADOW = '0 12px 30px -22px rgba(3,22,54,.85)';

const STATUS = {
  AVAILABLE: { label: 'Available', color: '#1F7A45', bg: '#E6F4EC' },
  LOW_STOCK: { label: 'Low Stock', color: '#9A6412', bg: '#FDF1E3' },
  CHECKED_OUT: { label: 'Checked Out', color: '#8F2323', bg: '#FDECEC' },
};

const s = {
  page: {
    minHeight: '100%', display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden',
    background: `radial-gradient(1100px 700px at 15% 0%, ${palette.navy800}aa 0%, transparent 60%),
                 radial-gradient(900px 600px at 100% 100%, ${palette.accent}22 0%, transparent 55%),
                 ${palette.navy900}`,
  } as const,
  blobA: { position: 'absolute', width: 420, height: 420, borderRadius: '50%', background: `${palette.accent}1a`, top: -160, left: -140, filter: 'blur(30px)', pointerEvents: 'none' } as const,
  blobB: { position: 'absolute', width: 380, height: 380, borderRadius: '50%', background: `${palette.slate600}22`, bottom: -160, right: -120, filter: 'blur(30px)', pointerEvents: 'none' } as const,

  topbar: { position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 32px', flexWrap: 'wrap', gap: 12 } as const,
  brand: { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' } as const,
  logoImg: { width: 40, height: 40, borderRadius: 10, objectFit: 'contain', background: palette.slate50, padding: 4, border: `1px solid ${palette.slate300}` } as const,
  wordmark: { fontSize: 16, fontWeight: 700, color: palette.white, lineHeight: 1.2 } as const,
  wordmarkSub: { fontSize: 12, color: palette.slate400, marginTop: 1 } as const,
  topbarRight: { display: 'flex', gap: 10 } as const,
  topBtn: {
    display: 'inline-flex', alignItems: 'center', gap: 7, background: 'transparent', color: palette.slate100,
    border: `1.5px solid ${palette.slate400}`, borderRadius: 999, padding: '9px 16px', fontSize: 13.5, fontWeight: 700,
    cursor: 'pointer', fontFamily: 'inherit',
  } as const,

  main: { position: 'relative', zIndex: 1, flex: 1, padding: '20px 24px 56px', width: '100%', maxWidth: 1320, margin: '0 auto', boxSizing: 'border-box' } as const,
  glassPanel: {
    position: 'relative', background: 'rgba(255,255,255,0.07)',
    backdropFilter: 'blur(22px) saturate(160%)', WebkitBackdropFilter: 'blur(22px) saturate(160%)',
    border: '1px solid rgba(255,255,255,0.16)', borderRadius: 24,
    padding: '28px 24px 32px',
    boxShadow: '0 24px 60px -32px rgba(3,22,54,0.75), inset 0 1px 0 rgba(255,255,255,0.10)',
  } as const,

  headRow: { marginBottom: 18 } as const,
  headTop: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 14 } as const,
  headRight: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 10 } as const,
  eyebrow: {
    display: 'inline-block', fontSize: 11.5, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase',
    padding: '6px 14px', borderRadius: 999, marginBottom: 10,
    color: palette.slate100, background: `${palette.navy800}88`, border: `1px solid ${palette.slate400}55`,
  } as const,
  title: { fontSize: 28, fontWeight: 800, color: palette.white, margin: '0 0 6px', letterSpacing: '-0.5px' } as const,
  subtitle: { fontSize: 14, color: palette.slate300, margin: 0, maxWidth: 520 } as const,

  liveDot: { display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12.5, fontWeight: 600, color: palette.slate400 } as const,
  liveDotOn: { color: '#3FBE73' } as const,
  dot: { display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: 'currentColor' } as const,
  dotOn: { boxShadow: '0 0 0 3px rgba(63,190,115,0.25)' } as const,
  myBorrowsBtn: { padding: '9px 18px', borderRadius: 10, border: 'none', background: palette.accent, color: '#fff', fontSize: 13.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 10px 22px -12px rgba(28,57,142,.75)' } as const,

  controlsRow: { display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 18 } as const,
  select: { fontSize: 13.5, padding: '9px 12px', borderRadius: 10, border: `1.5px solid ${palette.slate300}`, background: palette.white, color: palette.navy900, fontFamily: 'inherit' } as const,
  searchBox: { position: 'relative' } as const,
  searchIcon: { position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: palette.slate500, display: 'flex' } as const,
  searchInput: { fontSize: 13.5, padding: '9px 12px 9px 32px', borderRadius: 10, border: `1.5px solid ${palette.slate300}`, background: palette.white, color: palette.navy900, fontFamily: 'inherit', width: 220 } as const,

  errBanner: { background: '#FDECEC', color: '#8F2323', border: '1px solid #F3CACA', borderRadius: 12, padding: '11px 14px', fontSize: 13.5, marginBottom: 16 } as const,
  muted: { color: palette.slate300, fontSize: 14, textAlign: 'center', margin: '18px 0' } as const,
  sectionLabel: { margin: '26px 0 12px', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: palette.slate300 } as const,

  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 16 } as const,

  card: { background: CARD_BG, border: `1px solid ${palette.slate300}e6`, borderRadius: 16, overflow: 'hidden', boxShadow: CARD_SHADOW, display: 'flex', flexDirection: 'column' } as const,
  cardImageWrap: { position: 'relative', height: 120, background: palette.slate100, display: 'flex', alignItems: 'center', justifyContent: 'center' } as const,
  cardImage: { width: '100%', height: '100%', objectFit: 'cover' } as const,
  cardImagePlaceholder: { width: 52, height: 52, borderRadius: '50%', background: `linear-gradient(135deg, ${palette.navy800}, ${palette.accent})`, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, fontWeight: 700 } as const,
  stockPill: { position: 'absolute', top: 8, left: 8, display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999 } as const,

  cardBody: { padding: '12px 14px 14px', display: 'flex', flexDirection: 'column', gap: 6, flex: 1 } as const,
  cardTitle: { margin: 0, fontSize: 15, fontWeight: 800, color: palette.navy900 } as const,
  metaRow: { display: 'flex', flexDirection: 'column', gap: 3 } as const,
  metaTag: { display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: palette.slate500, fontWeight: 600 } as const,
  cardFootRow: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 } as const,
  badge: { display: 'inline-block', fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999 } as const,
  totalText: { fontSize: 11.5, color: palette.slate500 } as const,

  borrowBtn: { marginTop: 8, width: '100%', padding: '9px 0', borderRadius: 9, border: 'none', background: palette.accent, color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' } as const,
  borrowBtnDisabled: { background: palette.slate100, color: palette.slate400, cursor: 'not-allowed' } as const,

  footer: { position: 'relative', zIndex: 1, textAlign: 'center', padding: '20px 24px', fontSize: 12.5, color: palette.slate400, borderTop: `1px solid ${palette.slate600}55` } as const,
  footerLink: { color: palette.accentSoft, textDecoration: 'none', fontWeight: 600 } as const,
};
