/**
 * Student — Borrow Equipment (BORROW-01..14). Submit a same-day request and
 * track its status. No borrow action is initiated from the availability
 * checker (EQUIP-AVAIL-09) — this is the dedicated request screen.
 *
 * Navigation state accepted:
 *   - { equipmentTypeId: number }  → pre-selects that type in the individual request form
 *   - { kitPack: { sportCategoryId, sportCategoryName, canRequestAll } } → opens the kit panel pre-filled
 *
 * Visual language: dark navy page with soft glow blobs and the same header
 * (logo, wordmark, ghost Back/Sign out) as Accounts/Usage History/Offline
 * Fallback/Conflict Detection — this is the app-wide theme for now. A
 * light/dark toggle is planned for a later pass across the whole app; this
 * screen intentionally stays dark until that lands, rather than going light
 * on its own. Content cards use the same opaque white/soft-gradient
 * treatment as those other screens. The Kit Pack summary shows only fields
 * the API actually returns (item count, the scarcest item's availability)
 * — never a fabricated "total stock" figure, since kits don't have one. No
 * borrow logic, validation, or API calls were touched — only the wrapper
 * and styling.
 */
import { useEffect, useState, useCallback } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth.js';
import { listTypes, listSportCategories, type EquipmentType, type SportCategory } from '../inventory/api.js';
import { submitRequest, listMyRequests, type MyRequest } from './api.js';
import { getKitPack, submitKitBorrowRequest, type KitPack } from '../availability/kitPackApi.js';
import { ApiRequestError } from '../../lib/api.js';
import { HideInAppShell } from '../../components/AppShellContext.js';

/* ---------- theme (identical values used across the app) ---------- */
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
        <button type="submit" className="mb-btn-primary" style={{ ...primaryBtn, ...(busy ? primaryBtnDisabled : {}) }} disabled={busy}>{busy ? 'Submitting…' : 'Submit Request'}</button>
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
    display: 'inline-block', padding: '2px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700,
    backgroundColor: kitPack.kitStatusBadge === 'AVAILABLE' ? '#E6F4EC' : kitPack.kitStatusBadge === 'PARTIAL' ? '#FDF1E3' : '#FDECEC',
    color: kitPack.kitStatusBadge === 'AVAILABLE' ? '#1F7A45' : kitPack.kitStatusBadge === 'PARTIAL' ? '#9A6412' : '#8F2323',
  };
  const kitBadgeText = !kitPack ? '' : kitPack.kitStatusBadge === 'AVAILABLE' ? 'Full kit available' : kitPack.kitStatusBadge === 'PARTIAL' ? 'Partially available' : 'Unavailable';

  // Real, derived stats only — the API never returns a "total stock" figure
  // for a kit (only per-item availableUnits), so instead of fabricating one
  // we show two figures actually backed by the data: how many item types
  // make up the kit, and the scarcest item's availability (the number that
  // actually determines whether the whole kit can be requested).
  const itemCount = kitPack?.items.length ?? 0;
  const minAvailable = kitPack && kitPack.items.length > 0 ? Math.min(...kitPack.items.map((i) => i.availableUnits)) : 0;
  const previewImage = kitPack?.items.find((i) => i.imageUrl)?.imageUrl ?? null;

  return (
    <form onSubmit={handleSubmit} className="mb-kit-form" style={kitFormLayout}>
      {/* Left column — sport picker + kit contents */}
      <div className="mb-kit-left" style={kitLeftCol}>
        <div style={colHeading}><span style={colHeadingIcon}><BagIcon /></span> Request Full Kit</div>

        <L label="Sport">
          <div style={selectWrap}>
            <span style={selectIcon}><SportIcon /></span>
            <select className="mb-input" style={{ ...inp, paddingLeft: 34 }} value={sportId} onChange={(e) => setSportId(Number(e.target.value))}>
              <option value={0}>— select a sport —</option>
              {cats.map((c) => <option key={c.sport_category_id} value={c.sport_category_id}>{c.name}</option>)}
            </select>
          </div>
        </L>

        {kitLoading && <p style={muted}>Loading kit…</p>}

        {kitPack && !kitLoading && (
          <div style={kitSummary}>
            <div style={kitSummaryHeader}>
              <span style={kitSummaryTitle}><span style={kitSummaryIcon}><BagIcon /></span> {kitPack.sportCategoryName} Kit Pack</span>
              {kitBadgeStyle && <span style={kitBadgeStyle}>{kitBadgeText}</span>}
            </div>
            <ul style={kitItemList}>
              {kitPack.items.map((item) => (
                <li key={item.equipmentTypeId} style={kitItemLi}>
                  <span style={kitItemName}>{item.name}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: item.availableUnits > 0 ? '#1F7A45' : '#8F2323' }}>
                    {item.availableUnits} available
                  </span>
                </li>
              ))}
            </ul>
            {kitPack.kitStatusBadge === 'PARTIAL' && (
              <p style={kitWarning}>⚠ Some items have no stock. Request individual items from the availability screen instead.</p>
            )}
          </div>
        )}
      </div>

      {/* Right column — preview, stats, date/time, submit */}
      <div style={kitRightCol}>
        {kitPack ? (
          <>
            <div style={previewRow}>
              <div style={previewThumb}>
                {previewImage ? <img src={previewImage} alt="" style={previewThumbImg} /> : <BagIcon />}
              </div>
              <div>
                <div style={previewTitle}>{kitPack.sportCategoryName} Kit Pack</div>
                <div style={previewSub}>Sport · {kitPack.sportCategoryName}</div>
                {kitBadgeStyle && <span style={{ ...kitBadgeStyle, marginTop: 6 }}>{kitBadgeText}</span>}
              </div>
            </div>

            <div style={statsRow}>
              <div style={statTile}>
                <span style={statTileIcon}><BagIcon /></span>
                <span style={statTileCol}><span style={statTileLabel}>Items in Kit</span><span style={statTileValue}>{itemCount}</span></span>
              </div>
              <div style={statTile}>
                <span style={statTileIcon}><AlertSmallIcon /></span>
                <span style={statTileCol}><span style={statTileLabel}>Min Available</span><span style={statTileValue}>{minAvailable}</span></span>
              </div>
            </div>

            {kitPack.canRequestAll && (
              <>
                <div style={dateTimeRow}>
                  <div style={dtTile}>
                    <span style={dtTileLabel}><CalendarSmallIcon /> Date</span>
                    <input className="mb-input" type="date" style={dtInput} value={date} min={todayStr()} onChange={(e) => setDate(e.target.value)} required />
                  </div>
                  <div style={dtTile}>
                    <span style={dtTileLabel}><ClockSmallIcon /> Start time</span>
                    <input className="mb-input" type="time" style={dtInput} value={startTime} min={nowMinTime(date)} max="17:00" step={300}
                      onChange={(e) => { setStartTime(e.target.value); setEndTime(smartEnd(e.target.value, 480)); }} required />
                  </div>
                  <div style={dtTile}>
                    <span style={dtTileLabel}><ClockSmallIcon /> Return by</span>
                    <input className="mb-input" type="time" style={dtInput} value={endTime} min={startTime} max="17:00" step={300}
                      onChange={(e) => setEndTime(e.target.value)} required />
                  </div>
                </div>

                <button type="submit" className="mb-btn-primary" style={{ ...primaryBtn, ...(submitting ? primaryBtnDisabled : {}) }} disabled={submitting}>
                  <SendIcon /> {submitting ? 'Submitting…' : `Request Full ${kitPack.sportCategoryName} Kit`}
                </button>
              </>
            )}
          </>
        ) : (
          <p style={{ ...muted, textAlign: 'center', margin: 'auto' }}>Select a sport to see kit details.</p>
        )}
      </div>
    </form>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

interface LocationState {
  equipmentTypeId?: number;
  kitPack?: { sportCategoryId: number; sportCategoryName: string; canRequestAll: boolean };
}

export default function MyBorrowsScreen() {
  const { user, loading, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const locationState = (location.state ?? {}) as LocationState;
  const incomingTypeId = locationState.equipmentTypeId;
  const incomingKit   = locationState.kitPack;

  const [types, setTypes] = useState<EquipmentType[]>([]);
  const [cats, setCats] = useState<SportCategory[]>([]);
  const [requests, setRequests] = useState<MyRequest[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reqSearch, setReqSearch] = useState('');

  const load = useCallback(async () => {
    try {
      const [t, r, c] = await Promise.all([listTypes(), listMyRequests(), listSportCategories()]);
      setTypes(t.types); setRequests(r.requests); setCats(c.categories);
    } catch (e) { setError(errMsg(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (loading) return <div className="mb-ui" style={{ minHeight: '100%', background: palette.navy900 }} />;
  if (!user) return <Navigate to="/" replace />;
  if (user.role !== 'STUDENT') return <Navigate to="/home" replace />;

  const flash = {
    ok:  (m: string) => { setNotice(m); setError(null); void load(); },
    err: (m: string) => { setError(m); setNotice(null); },
  };

  const visibleRequests = requests.filter((r) =>
    !reqSearch.trim() || r.equipment_type_name.toLowerCase().includes(reqSearch.trim().toLowerCase())
  );

  return (
    <div className="mb-ui" style={s.page}>
      <MbStyles />
      <div style={s.blobA} aria-hidden />
      <div style={s.blobB} aria-hidden />
      <div style={s.blobC} aria-hidden />

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
            <button type="button" className="hist-topbtn" style={s.topBtn} onClick={() => navigate('/availability')}><BackIcon /> Back</button>
            <button type="button" className="hist-topbtn hist-signout" style={s.topBtn} onClick={() => { void logout(); navigate('/'); }}>
              <SignOutIcon /> Sign out
            </button>
          </div>
        </header>
      </HideInAppShell>

      <main style={s.main}>
        <div className="mb-glass" style={s.glassPanel}>
          <div style={s.headRow}>
            <span style={s.eyebrow}>Student Portal</span>
            <h1 style={s.title}>Kit Borrow</h1>
            <p style={s.subtitle}>Request a full kit for your selected sport. Choose the sport, check available kit details and submit your request.</p>
          </div>

          <div style={heroCard}>
            {error  && <div style={box.err}>{error}</div>}
            {notice && <div style={box.ok}>{notice}</div>}

            <KitRequestForm
              cats={cats}
              initialSportId={incomingKit?.sportCategoryId}
              onDone={flash.ok}
              onError={flash.err}
            />
          </div>

        <div style={requestsCard}>
          <div style={requestsHeadRow}>
            <div style={colHeading}><span style={colHeadingIcon}><HistoryIcon /></span> My Requests</div>
            <div style={selectWrap}>
              <span style={selectIcon}><SearchIcon /></span>
              <input
                className="mb-input"
                style={{ ...inp, paddingLeft: 34, width: 220 }}
                type="search"
                placeholder="Search requests…"
                value={reqSearch}
                onChange={(e) => setReqSearch(e.target.value)}
              />
            </div>
          </div>

          {requests.length === 0 ? (
            <p style={muted}>You haven't submitted any requests yet.</p>
          ) : visibleRequests.length === 0 ? (
            <p style={muted}>No requests match "{reqSearch}".</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={table}>
                <thead>
                  <tr>
                    <th style={th}>Equipment</th>
                    <th style={th}>Window</th>
                    <th style={th}>Status</th>
                    <th style={th}>Note</th>
                    <th style={{ ...th, width: 24 }} />
                  </tr>
                </thead>
                <tbody>
                  {visibleRequests.map((r) => (
                    <tr key={r.borrow_request_id} className="mb-row">
                      <td style={td}>
                        <div style={equipCell}>
                          <span style={equipIcon}>{r.equipment_type_name.charAt(0)}</span>
                          {r.equipment_type_name}
                        </div>
                      </td>
                      <td style={td}>
                        {new Date(r.requested_start_at).toLocaleString()} → {new Date(r.requested_return_at).toLocaleTimeString()}
                      </td>
                      <td style={td}>
                        {(r.status === 'EXPIRED' || isExpired(r.requested_start_at, r.status))
                          ? <span style={{ ...badgeBase, ...statusBadge('EXPIRED') }}>EXPIRED</span>
                          : <span style={{ ...badgeBase, ...statusBadge(r.status) }}>{r.status}</span>}
                      </td>
                      <td style={{ ...td, color: r.rejection_reason ? '#8F2323' : palette.slate400 }}>{r.rejection_reason ?? '—'}</td>
                      <td style={{ ...td, color: palette.slate400 }}>›</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
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

function BackIcon() { return <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M9.5 3 4 8l5.5 5M4.5 8H14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>; }
function SignOutIcon() { return <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M6.5 2H3.5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><path d="M10.5 5 14 8l-3.5 3M14 8H6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>; }
function BagIcon() { return <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M4 5.5h8l.6 8a1 1 0 0 1-1 1.1H4.4a1 1 0 0 1-1-1.1l.6-8Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/><path d="M6 5.5v-1a2 2 0 0 1 4 0v1" stroke="currentColor" strokeWidth="1.4"/></svg>; }
function SportIcon() { return <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.4"/><path d="M2 8h12M8 2c1.8 1.7 1.8 10.3 0 12M8 2c-1.8 1.7-1.8 10.3 0 12" stroke="currentColor" strokeWidth="1.2"/></svg>; }
function HistoryIcon() { return <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/><path d="M1.5 2.5V5h2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/><path d="M8 5v3.3l2.2 1.3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>; }
function SearchIcon() { return <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.6"/><path d="m14 14-2.8-2.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>; }
function SendIcon() { return <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M14.5 1.5 1.5 7l5 2 2 5 6-12.5Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/><path d="M6.5 9 14.5 1.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>; }
function AlertSmallIcon() { return <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M8 1.5 1 14h14L8 1.5Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/><path d="M8 6.5v3.2M8 11.6h.01" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>; }
function CalendarSmallIcon() { return <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M4 1h1v1.5h6V1h1v1.5h2A1.5 1.5 0 0 1 15.5 4v9A1.5 1.5 0 0 1 14 14.5H2A1.5 1.5 0 0 1 .5 13V4A1.5 1.5 0 0 1 2 2.5h2V1zM1.5 6v7A.5.5 0 0 0 2 13.5h12a.5.5 0 0 0 .5-.5V6h-13z"/></svg>; }
function ClockSmallIcon() { return <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.3" stroke="currentColor" strokeWidth="1.3"/><path d="M8 4.5V8l2.6 1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>; }

function MbStyles() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
      .mb-ui { font-family: 'Inter', system-ui, sans-serif; }
      .mb-ui * { box-sizing: border-box; }
      .hist-topbtn { transition: background-color .18s ease, border-color .18s ease, color .18s ease; text-decoration: none; }
      .hist-topbtn:hover { background-color: rgba(255,255,255,0.08); border-color: ${palette.slate100}; }
      .hist-signout:hover { background-color: ${palette.accent} !important; border-color: ${palette.accent} !important; color: #fff !important; }
      .mb-btn-primary { transition: filter .15s ease, transform .15s ease; }
      .mb-btn-primary:hover:not(:disabled) { filter: brightness(1.08); transform: translateY(-1px); }
      .mb-btn-primary:disabled { cursor: not-allowed; }
      .mb-input { transition: border-color .15s ease, box-shadow .15s ease; }
      .mb-input:focus, input[type="date"]:focus, input[type="time"]:focus, select:focus {
        outline: none; border-color: ${palette.accent} !important; box-shadow: 0 0 0 3px ${palette.accentSoft};
      }
      .mb-row { transition: background-color .12s ease; }
      .mb-row:hover { background: ${palette.slate50}; }
      @media (max-width: 860px) {
        .mb-kit-form { grid-template-columns: 1fr !important; }
        .mb-kit-left { border-right: none !important; border-bottom: 1px solid ${palette.slate100}; padding-right: 0 !important; padding-bottom: 20px; }
      }
      @media (max-width: 620px) {
        .mb-glass { padding: 20px 14px 26px !important; border-radius: 18px !important; }
      }
    `}</style>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const muted: React.CSSProperties = { color: palette.slate500, fontSize: 14, margin: 0 };
const box = {
  err: { padding: '10px 14px', borderRadius: 8, background: '#FDECEC', color: '#8F2323', fontSize: 14, border: '1px solid #F3CACA', marginBottom: 16 } as React.CSSProperties,
  ok:  { padding: '10px 14px', borderRadius: 8, background: '#E6F4EC', color: '#1F7A45', fontSize: 14, border: '1px solid #1F7A4555', marginBottom: 16 } as React.CSSProperties,
};

// Shared field label + input
const formGrid: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 20px' };
const lbl: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6 };
const lblText: React.CSSProperties = { fontSize: 12.5, fontWeight: 700, color: palette.navy900 };
const inp: React.CSSProperties = { padding: '9px 12px', borderRadius: 9, border: `1.5px solid ${palette.slate300}`, background: palette.white, color: palette.navy900, fontSize: 14, fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' };
const selectWrap: React.CSSProperties = { position: 'relative' };
const selectIcon: React.CSSProperties = { position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: palette.slate500, display: 'flex', pointerEvents: 'none' };

// Section heading (used for "Request Full Kit" and "My Requests")
const colHeading: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 9, fontSize: 16, fontWeight: 800, color: palette.navy900, marginBottom: 16 };
const colHeadingIcon: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, borderRadius: 9, background: palette.accentWash, color: palette.accent, flexShrink: 0 };

// Kit request form — two-column layout
const kitFormLayout: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1.15fr 1fr', gap: 28 };
const kitLeftCol: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 14, paddingRight: 28, borderRight: `1px solid ${palette.slate100}` };
const kitRightCol: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 14 };

// Kit summary box
const kitSummary: React.CSSProperties = { background: palette.accentWash, border: `1px solid ${palette.accent}30`, borderRadius: 12, padding: '14px 16px' };
const kitSummaryHeader: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, gap: 8, flexWrap: 'wrap' };
const kitSummaryIcon: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, borderRadius: 6, background: palette.accent, color: '#fff', marginRight: 6 };
const kitSummaryTitle: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', fontSize: 14.5, fontWeight: 800, color: palette.navy900 };
const kitItemList: React.CSSProperties = { margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 };
const kitItemLi: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 };
const kitItemName: React.CSSProperties = { fontSize: 13, color: palette.navy900, display: 'flex', alignItems: 'center', gap: 6 };
const kitWarning: React.CSSProperties = { margin: '10px 0 0', fontSize: 12, color: '#9A6412', padding: '6px 10px', background: '#FDF1E3', borderRadius: 8 };

// Right column: preview / stats / date-time
const previewRow: React.CSSProperties = { display: 'flex', alignItems: 'flex-start', gap: 12 };
const previewThumb: React.CSSProperties = { width: 52, height: 52, borderRadius: 12, background: palette.slate50, border: `1px solid ${palette.slate100}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: palette.accent, flexShrink: 0, overflow: 'hidden' };
const previewThumbImg: React.CSSProperties = { width: '100%', height: '100%', objectFit: 'contain' };
const previewTitle: React.CSSProperties = { fontSize: 15.5, fontWeight: 800, color: palette.navy900 };
const previewSub: React.CSSProperties = { fontSize: 12.5, color: palette.slate500, margin: '2px 0 6px' };

const statsRow: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 };
const statTile: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, background: palette.slate50, border: `1px solid ${palette.slate100}`, borderRadius: 12, padding: '10px 12px' };
const statTileIcon: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, borderRadius: 9, background: palette.accentWash, color: palette.accent, flexShrink: 0 };
const statTileCol: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 1 };
const statTileLabel: React.CSSProperties = { fontSize: 10.5, fontWeight: 700, color: palette.slate500 };
const statTileValue: React.CSSProperties = { fontSize: 17, fontWeight: 800, color: palette.navy900 };

const dateTimeRow: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 };
const dtTile: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 5, background: palette.slate50, border: `1px solid ${palette.slate100}`, borderRadius: 10, padding: '8px 10px' };
const dtTileLabel: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 5, fontSize: 10.5, fontWeight: 700, color: palette.slate500 };
const dtInput: React.CSSProperties = { border: 'none', background: 'transparent', padding: 0, fontSize: 13.5, fontWeight: 700, color: palette.navy900, fontFamily: 'inherit', width: '100%' };

const primaryBtn: React.CSSProperties = { width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, background: palette.accent, color: '#fff', fontSize: 14.5, fontWeight: 700, padding: '12px', border: 'none', borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 10px 22px -12px rgba(28,57,142,.75)' };
const primaryBtnDisabled: React.CSSProperties = { opacity: 0.6, cursor: 'not-allowed', boxShadow: 'none' };

// Requests table
const requestsHeadRow: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginBottom: 8 };
const table: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 14, minWidth: 640 };
const th: React.CSSProperties = { padding: '10px 10px', textAlign: 'left', fontWeight: 700, borderBottom: `1px solid ${palette.slate300}`, color: palette.slate500, fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '0.04em' };
const td: React.CSSProperties = { padding: '11px 10px', borderBottom: `1px solid ${palette.slate100}`, verticalAlign: 'middle', color: palette.navy900 };
const equipCell: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 9, fontWeight: 600 };
const equipIcon: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26, borderRadius: '50%', background: palette.accentWash, color: palette.accent, fontSize: 11.5, fontWeight: 800, flexShrink: 0 };
const badgeBase: React.CSSProperties = { display: 'inline-block', padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700 };
function isExpired(requestedStartAt: string, status: string): boolean {
  return status === 'PENDING' && new Date(requestedStartAt).getTime() < Date.now();
}
function statusBadge(s: string): React.CSSProperties {
  if (s === 'APPROVED') return { background: '#E6F4EC', color: '#1F7A45' };
  if (s === 'REJECTED') return { background: '#FDECEC', color: '#8F2323' };
  if (s === 'CANCELLED') return { background: palette.slate100, color: palette.slate500 };
  if (s === 'EXPIRED')  return { background: '#F3E8FF', color: '#6B21A8' };
  return { background: '#FDF1E3', color: '#9A6412' }; // PENDING
}

// Hero + requests cards — opaque white/soft-gradient cards sitting on the
// dark page (same convention as Accounts/Offline/Conflict Detection).
const CARD_BG = 'linear-gradient(145deg, #F8FAFF 0%, #EAF0FC 100%)';
const CARD_SHADOW = '0 12px 30px -22px rgba(3,22,54,.85)';
const heroCard: React.CSSProperties = {
  position: 'relative', background: CARD_BG, border: `1px solid ${palette.slate300}e6`,
  borderRadius: 20, padding: '26px 28px 28px', marginBottom: 22,
  boxShadow: CARD_SHADOW,
};
const requestsCard: React.CSSProperties = {
  position: 'relative', background: CARD_BG, border: `1px solid ${palette.slate300}e6`,
  borderRadius: 20, padding: '24px 28px 26px',
  boxShadow: CARD_SHADOW,
};

// Shell-level styles (page/header/footer)
const s = {
  page: {
    minHeight: '100%', display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden',
    background: `radial-gradient(1100px 700px at 15% 0%, ${palette.navy800}aa 0%, transparent 60%),
                 radial-gradient(900px 600px at 100% 100%, ${palette.accent}22 0%, transparent 55%),
                 ${palette.navy900}`,
  } as const,
  blobA: { position: 'absolute', width: 420, height: 420, borderRadius: '50%', background: `${palette.accent}1a`, top: -160, left: -140, filter: 'blur(30px)', pointerEvents: 'none' } as const,
  blobB: { position: 'absolute', width: 380, height: 380, borderRadius: '50%', background: `${palette.slate600}22`, bottom: -160, right: -120, filter: 'blur(30px)', pointerEvents: 'none' } as const,
  blobC: { display: 'none' } as const,

  topbar: {
    position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '18px 32px', flexWrap: 'wrap', gap: 12,
  } as const,
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

  main: { position: 'relative', zIndex: 1, flex: 1, padding: '28px 24px 56px', width: '100%', maxWidth: 1160, margin: '0 auto', boxSizing: 'border-box' } as const,
  /* Frosted glassmorphism shell around everything below the header — title,
     hero card, and requests card all sit inside this one translucent panel
     (same treatment as Usage History, Accounts, Offline Fallback Entry,
     Conflict Detection, and Venue Calendar). */
  glassPanel: {
    position: 'relative', background: 'rgba(255,255,255,0.07)',
    backdropFilter: 'blur(22px) saturate(160%)', WebkitBackdropFilter: 'blur(22px) saturate(160%)',
    border: '1px solid rgba(255,255,255,0.16)', borderRadius: 24,
    padding: '28px 24px 32px',
    boxShadow: '0 24px 60px -32px rgba(3,22,54,0.75), inset 0 1px 0 rgba(255,255,255,0.10)',
  } as const,

  headRow: { marginBottom: 20 } as const,
  eyebrow: {
    display: 'inline-block', fontSize: 11.5, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase',
    padding: '6px 14px', borderRadius: 999, marginBottom: 10,
    color: palette.slate100, background: `${palette.navy800}88`, border: `1px solid ${palette.slate400}55`,
  } as const,
  title: { fontSize: 28, fontWeight: 800, color: palette.white, margin: 0, letterSpacing: '-0.5px' } as const,
  subtitle: { fontSize: 14, color: palette.slate300, margin: '6px 0 0', maxWidth: 620, lineHeight: 1.5 } as const,

  footer: { position: 'relative', zIndex: 1, textAlign: 'center', padding: '20px 24px', fontSize: 12.5, color: palette.slate400, borderTop: `1px solid ${palette.slate600}55` } as const,
  footerLink: { color: palette.accentSoft, textDecoration: 'none', fontWeight: 600 } as const,
};
