/**
 * Inventory console (Feature 4) — staff only. Three tabs:
 *   Equipment  — types + live availability status + add/edit/delete a type
 *   Articles   — add single/pair articles (barcode scan or manual), list
 *                (grouped pairs), scan, decommission
 *   Damage     — open damage flags + clear with a fresh health score
 *
 * Re-themed to the site's navy + glassmorphism language (same header, page
 * background, glow blobs, frosted glass shell, light soft-gradient cards and
 * #1C398E accent as Accounts / Conflict Detection / Venue Approvals).
 * Frontend only — no API, validation, camera or barcode-scanner logic changes
 * Articles use PhotoUploadScan (upload a photo → barcode read from it) in place
 * of the old Take Photo camera capture; the live BarcodeScannerModal is unchanged.
 */
import { useEffect, useState, useCallback, useMemo, Fragment, type ReactNode } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import Fuse from 'fuse.js';
import { useAuth } from '../../lib/auth.js';
import { ApiRequestError } from '../../lib/api.js';
import * as inv from './api.js';
import { STATE_LABEL } from './api.js';
import { Modal, ConfirmModal, PhotoUploadScan, BarcodeScannerModal } from './shared.js';
import { HideInAppShell } from '../../components/AppShellContext.js';
import { useBackStep } from '../../components/backStack.js';

type Tab = 'equipment' | 'articles';

export default function InventoryScreen() {
  const { user, loading, logout } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('equipment');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const header = (
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
          <Link to="/home" className="inv-topbtn" style={s.topBtn}><BackIcon /> Back</Link>
          <button type="button" className="inv-topbtn inv-signout" style={s.topBtn} onClick={() => { void logout(); navigate('/'); }}>
            <SignOutIcon /> Sign out
          </button>
        </div>
      </header>
    </HideInAppShell>
  );

  if (loading) {
    return (
      <div className="inv-ui" style={s.page}>
        <InvStyles />
        {header}
        <main style={s.main}><div className="inv-glass" style={s.glassPanel} /></main>
      </div>
    );
  }
  if (!user) return <Navigate to="/" replace />;
  if (user.role !== 'SUPER_ADMIN' && user.role !== 'COORDINATOR') return <Navigate to="/home" replace />;

  const flash: Flash = { setError, setNotice, clear: () => { setError(null); setNotice(null); } };
  const isSuperAdmin = user.role === 'SUPER_ADMIN';

  return (
    <div className="inv-ui" style={s.page}>
      <InvStyles />
      <div style={s.blobA} aria-hidden />
      <div style={s.blobB} aria-hidden />

      {header}

      <main style={s.main}>
        <div className="inv-glass" style={s.glassPanel}>
          <div style={s.hero}>
            <span style={s.heroEyebrow}><BoxIcon size={14} /> {isSuperAdmin ? 'Administration Staff' : 'Coordinator'}</span>
            <h1 style={s.heroTitle}>Inventory</h1>
            <p style={s.heroSubtitle}>Manage equipment types, add and scan articles, and keep an eye on stock levels.</p>
          </div>

          <div style={tabRow} role="tablist">
            {(['equipment', 'articles'] as Tab[]).map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} className="inv-tab"
                onClick={() => { setTab(t); flash.clear(); }}
                style={{ ...tabBtn, ...(tab === t ? tabActive : null) }}>
                {t === 'equipment' ? <BoxIcon size={16} /> : <BarcodeIcon />}
                {t === 'equipment' ? 'Equipment' : 'Articles'}
              </button>
            ))}
          </div>

          {error && <div className="inv-toast" style={box.err}><AlertIcon /> {error}</div>}
          {notice && <div className="inv-toast" style={box.ok}><CheckCircleIcon /> {notice}</div>}

          {tab === 'equipment' && <EquipmentTab flash={flash} />}
          {tab === 'articles' && <ArticlesTab flash={flash} />}
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

function InvStyles() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
      .inv-ui { font-family: 'Inter', system-ui, sans-serif; }
      .inv-ui * { box-sizing: border-box; }
      .inv-card { animation: invFadeUp .45s ease both; }
      @keyframes invFadeUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
      .inv-row { transition: background-color .15s ease; }
      .inv-row:hover { background: ${palette.slate50}; }
      .inv-tab { transition: background-color .15s ease, color .15s ease, box-shadow .15s ease; }
      .inv-tab:hover:not([aria-selected="true"]) { background: ${palette.accentWash}; color: ${palette.accent}; }
      .inv-ui button { transition: transform .15s ease, box-shadow .15s ease, filter .15s ease, background-color .15s ease, border-color .15s ease, color .15s ease; }
      .inv-ui button:hover:not(:disabled) { filter: brightness(1.04); }
      .inv-ui button:disabled { opacity: .6; cursor: not-allowed; }
      .inv-ui input, .inv-ui select, .inv-ui textarea { transition: border-color .15s ease, box-shadow .15s ease, background-color .15s ease; }
      .inv-ui input::placeholder { color: ${palette.slate400}; opacity: 1; }
      .inv-ui input:focus, .inv-ui select:focus, .inv-ui textarea:focus { outline: none; border-color: ${palette.accent} !important; box-shadow: 0 0 0 4px ${palette.accentSoft}; background-color: #fff !important; }
      .inv-ui input[type="file"] { padding: 8px 10px !important; }
      .inv-ui input[type="file"]::file-selector-button { font: 600 13px Inter, sans-serif; border: none; border-radius: 8px; padding: 7px 12px; margin-right: 10px; background: ${palette.accentWash}; color: ${palette.accent}; cursor: pointer; }
      .inv-ui video { border-radius: 12px !important; border: 1px solid ${palette.slate300}; }
      .inv-picker-cell:hover { background: ${palette.accentWash}; }
      .inv-toast { animation: invToast .3s ease both; }
      @keyframes invToast { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }
      .inv-stat { transition: transform .18s ease, box-shadow .18s ease; }
      .inv-stat:hover { transform: translateY(-2px); box-shadow: 0 14px 26px -16px rgba(3,22,54,0.4); }
      .inv-topbtn { transition: background-color .18s ease, border-color .18s ease, color .18s ease; text-decoration: none; }
      .inv-topbtn:hover { background-color: rgba(255,255,255,0.08); border-color: ${palette.slate100}; }
      .inv-signout:hover { background-color: ${palette.accent} !important; border-color: ${palette.accent} !important; color: #fff !important; }
      @media (max-width: 720px) {
        .inv-glass { padding: 20px 14px 26px !important; border-radius: 18px !important; }
        .inv-form-grid { grid-template-columns: 1fr !important; }
      }
      @media (prefers-reduced-motion: reduce) {
        .inv-card, .inv-toast { animation: none !important; }
      }
    `}</style>
  );
}

interface Flash { setError: (m: string | null) => void; setNotice: (m: string | null) => void; clear: () => void }
function errMsg(e: unknown) { return e instanceof ApiRequestError ? e.body.error : 'Something went wrong.'; }

// Image key → static asset path for predefined item presets.
function presetImageSrc(imageKey: string): string {
  return `/equipment/${imageKey}.png`;
}

function useDebounced<T>(value: T, delay = 150): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => { const t = setTimeout(() => setDebounced(value), delay); return () => clearTimeout(t); }, [value, delay]);
  return debounced;
}

// ─────────────────────────── EQUIPMENT ───────────────────────────
function EquipmentTab({ flash }: { flash: Flash }) {
  const [types, setTypes] = useState<inv.EquipmentType[]>([]);
  const [status, setStatus] = useState<inv.StatusRow[]>([]);
  const [cats, setCats] = useState<inv.SportCategory[]>([]);
  const [presets, setPresets] = useState<inv.ItemPreset[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  // Go back (top right) closes the Add Type / Edit form opened on this tab.
  useBackStep(showForm, () => setShowForm(false));
  useBackStep(editingId !== null, () => setEditingId(null));
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounced(search);

  const load = useCallback(async () => {
    try {
      const [t, s, c, p] = await Promise.all([inv.listTypes(), inv.listStatus(), inv.listSportCategories(), inv.listItemPresets()]);
      setTypes(t.types); setStatus(s.status); setCats(c.categories); setPresets(p.presets);
    } catch (e) { flash.setError(errMsg(e)); }
  }, [flash]);
  useEffect(() => { void load(); }, [load]);

  const fuse = useMemo(() => new Fuse(types, {
    keys: ['name', 'sport_category_name'], threshold: 0.4, ignoreLocation: true,
  }), [types]);
  const [typePage, setTypePage] = useState(1);
  useEffect(() => { setTypePage(1); }, [debouncedSearch]);
  const visibleTypes = debouncedSearch.trim()
    ? fuse.search(debouncedSearch.trim()).map((r) => r.item)
    : types;

  const badgeStyle = (b: string) => b === 'AVAILABLE' ? badge.ok : b === 'LOW_STOCK' ? badge.warn : badge.danger;
  const statusFor = (id: number) => status.find((s) => s.equipment_type_id === id);

  async function confirmDelete() {
    if (deletingId == null) return;
    try {
      await inv.deleteType(deletingId);
      flash.setNotice('Equipment type deleted.');
      setDeletingId(null);
      void load();
    } catch (e) { flash.setError(errMsg(e)); setDeletingId(null); }
  }

  // Stat boxes count only the types listed below (the status view can include
  // types the list doesn't show, e.g. archived ones). "In stock" means at least
  // one unit is free — the server's AVAILABLE badge means *above* the low-stock
  // threshold, so a type with a few units left is badged LOW_STOCK, not AVAILABLE.
  const typeIds = new Set(types.map((t) => t.equipment_type_id));
  const shownStatus = status.filter((r) => typeIds.has(r.equipment_type_id));
  const inStockCount = shownStatus.filter((r) => r.available_units > 0).length;
  const countBy = (b: inv.StatusRow['status_badge']) => shownStatus.filter((r) => r.status_badge === b).length;

  return (
    <>
    <div style={statRow}>
      <StatCard label="Equipment types" value={types.length} accent={palette.accent} icon={<BoxIcon size={17} />} />
      <StatCard label="In stock" value={inStockCount} accent="#1F7A45" icon={<CheckCircleIcon />} />
      <StatCard label="Low stock" value={countBy('LOW_STOCK')} accent="#9A6412" icon={<AlertIcon />} />
      <StatCard label="Out of stock" value={countBy('CHECKED_OUT')} accent="#B3352B" icon={<ClockIcon />} />
    </div>
    <Panel title="Equipment Types" icon={<BoxIcon size={17} />} action={<button style={primaryBtn} onClick={() => { setShowForm((v) => !v); setEditingId(null); }}>{showForm ? <><XIcon /> Close</> : <><PlusIcon /> Add Type</>}</button>}>
      <SearchInput value={search} onChange={setSearch} placeholder="Search by name or sport…" />

      {showForm && (
        <div style={formBlock}>
          <div style={formBlockTitle}><PlusIcon /> New equipment type</div>
        <AddTypeForm cats={cats} presets={presets}
          onDone={() => { setShowForm(false); flash.setNotice('Equipment type created.'); void load(); }}
          onError={flash.setError} onCatsChanged={load} />
        </div>
      )}

      {visibleTypes.length === 0 ? <EmptyState text={types.length === 0 ? 'No equipment types yet. Add one to begin.' : 'No equipment types match your search.'} /> : (
        <div style={tableWrap}>
        <table style={table}>
          <thead><tr><th style={th}></th><th style={th}>Name</th><th style={th}>Sport</th><th style={th}>Setting</th><th style={th}>Unit</th><th style={th}>Available</th><th style={th}>Status</th><th style={th} /></tr></thead>
          <tbody>
            {paginate(visibleTypes, typePage).map((t) => {
              const s = statusFor(t.equipment_type_id);
              const isEditing = editingId === t.equipment_type_id;
              return (
                <Fragment key={t.equipment_type_id}>
                  <tr className="inv-row">
                    <td style={td}>{t.image_url ? <img src={t.image_url} alt="" style={thumb} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} /> : <div style={thumbPlaceholder} />}</td>
                    <td style={{ ...td, fontWeight: 700 }}>{t.name}</td>
                    <td style={td}>{t.sport_category_name}</td>
                    <td style={td}>{t.is_indoor ? 'Indoor' : 'Outdoor'}</td>
                    <td style={td}>{t.lending_unit === 'PAIR' ? 'Pair' : 'Single'}</td>
                    <td style={td}>{s ? s.available_units : '—'}</td>
                    <td style={td}>{s ? <span style={{ ...badgeBase, ...badgeStyle(s.status_badge) }}>{s.status_badge.replace('_', ' ')}</span> : '—'}</td>
                    <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button style={linkBtn} onClick={() => { setEditingId(isEditing ? null : t.equipment_type_id); setShowForm(false); }}>{isEditing ? 'Cancel' : 'Edit'}</button>
                      <button style={{ ...linkBtn, color: 'var(--danger)' }} onClick={() => setDeletingId(t.equipment_type_id)}>Delete</button>
                    </td>
                  </tr>
                  {isEditing && (
                    <tr>
                      <td colSpan={8} style={{ ...td, background: '#F1F5FD', padding: '18px 16px' }}>
                        <div style={formBlockTitle}><EditIcon /> Editing {t.name}</div>
                        <EditTypeForm type={t}
                          onDone={() => { setEditingId(null); flash.setNotice('Equipment type updated.'); void load(); }}
                          onError={flash.setError} onCancel={() => setEditingId(null)} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        </div>
      )}
      {visibleTypes.length > 0 && (
        <Pager page={typePage} total={visibleTypes.length} noun="equipment types" onChange={(pg) => { setTypePage(pg); setEditingId(null); }} />
      )}

      {deletingId != null && (
        <ConfirmModal title="Delete Equipment Type" danger confirmLabel="Delete"
          message="Delete this equipment type? All articles under it must be decommissioned first."
          onConfirm={confirmDelete} onCancel={() => setDeletingId(null)} />
      )}
    </Panel>
    </>
  );
}

// ── Duration picker — scrollable hour + minute columns ──
function DurationPicker({ hours, minutes, onChange }: {
  hours: number; minutes: number;
  onChange: (h: number, m: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const display = `${String(hours).padStart(2, '0')}h ${String(minutes).padStart(2, '0')}m`;

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      const el = document.getElementById('duration-picker-root');
      if (el && !el.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  return (
    <div id="duration-picker-root" style={{ position: 'relative', display: 'inline-block', width: '100%' }}>
      <button type="button" style={{ ...inp, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', textAlign: 'left' }}
        onClick={() => setOpen((v) => !v)}>
        <span>{display}</span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#62748E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
        </svg>
      </button>
      {open && (
        <div style={pickerDropdown}>
          <div style={{ display: 'flex', borderBottom: '1px solid #e5e5e5' }}>
            <div style={pickerCol}>
              <div style={pickerColHead}>Hr</div>
              {Array.from({ length: 24 }, (_, i) => (
                <div key={i} className="inv-picker-cell" onClick={() => onChange(i, minutes)}
                  style={{ ...pickerCell, ...(i === hours ? pickerCellActive : {}) }}>
                  {String(i).padStart(2, '0')}
                </div>
              ))}
            </div>
            <div style={{ ...pickerCol, borderLeft: '1px solid #e5e5e5' }}>
              <div style={pickerColHead}>Min</div>
              {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map((m) => (
                <div key={m} className="inv-picker-cell" onClick={() => onChange(hours, m)}
                  style={{ ...pickerCell, ...(m === minutes ? pickerCellActive : {}) }}>
                  {String(m).padStart(2, '0')}
                </div>
              ))}
            </div>
          </div>
          <div style={{ padding: '6px 10px', display: 'flex', justifyContent: 'flex-end' }}>
            <button type="button" onClick={() => setOpen(false)}
              style={{ ...primaryBtn, padding: '4px 14px', fontSize: 13 }}>OK</button>
          </div>
        </div>
      )}
    </div>
  );
}

function AddTypeForm({ cats, presets, onDone, onError, onCatsChanged }: {
  cats: inv.SportCategory[]; presets: inv.ItemPreset[];
  onDone: () => void; onError: (m: string) => void; onCatsChanged: () => void;
}) {
  const [sportCategoryId, setSport] = useState(0);
  const [isCustomSport, setIsCustomSport] = useState(false);
  const [customSportName, setCustomSportName] = useState('');
  const [customSportIndoor, setCustomSportIndoor] = useState<'' | '1' | '0'>('');

  const [itemNameMode, setItemNameMode] = useState<'preset' | 'custom'>('preset');
  const [selectedPresetName, setSelectedPresetName] = useState('');
  const [customItemName, setCustomItemName] = useState('');

  const [lendingUnit, setUnit] = useState<'SINGLE' | 'PAIR'>('SINGLE');
  const [lowStockThreshold, setThreshold] = useState<string>('7');
  const [hours, setHours] = useState(2);
  const [minutes, setMinutes] = useState(0);
  const [conditionGoodMinScore, setGood] = useState(70);
  const [conditionWornMinScore, setWorn] = useState(40);
  const [isIndoor, setIndoor] = useState<'' | '1' | '0'>('');
  const [customImageData, setCustomImageData] = useState('');
  const [busy, setBusy] = useState(false);

  const sportPresets = presets.filter((p) => p.sport_category_id === sportCategoryId);
  const selectedPreset = sportPresets.find((p) => p.name === selectedPresetName);

  const resolvedName = itemNameMode === 'preset' ? selectedPresetName : customItemName;
  const resolvedImageUrl = itemNameMode === 'preset' && selectedPreset
    ? presetImageSrc(selectedPreset.image_key)
    : customImageData || undefined;

  // Predefined items lock their lending unit to the preset's default — a
  // Badminton Racket is always a pair, a Basketball is always single.
  useEffect(() => {
    if (itemNameMode === 'preset' && selectedPreset) setUnit(selectedPreset.default_lending_unit);
  }, [itemNameMode, selectedPreset]);

  function handleSportChange(val: string) {
    if (val === '__custom__') {
      setIsCustomSport(true); setSport(0); setSelectedPresetName(''); setItemNameMode('custom');
    } else {
      setIsCustomSport(false); setSport(Number(val)); setSelectedPresetName(''); setItemNameMode('preset');
    }
  }

  function handleItemNameChange(val: string) {
    if (val === '__custom__') {
      setItemNameMode('custom'); setSelectedPresetName('');
    } else {
      setItemNameMode('preset'); setSelectedPresetName(val); setCustomItemName(''); setCustomImageData('');
    }
  }

  function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { onError('Please select an image file.'); return; }
    if (file.size > 400_000) { onError('Image must be under 400 KB.'); return; }
    const reader = new FileReader();
    reader.onload = () => setCustomImageData(reader.result as string);
    reader.readAsDataURL(file);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (isIndoor === '') { onError('Please select Indoor or Outdoor.'); return; }
    const threshold = lowStockThreshold === '' ? -1 : Number(lowStockThreshold);
    if (Number.isNaN(threshold) || threshold < 0) { onError('Low-stock threshold must be a non-negative number.'); return; }
    const maxBorrowDurationMinutes = hours * 60 + minutes;
    if (maxBorrowDurationMinutes <= 0) { onError('Max borrow duration must be greater than 0.'); return; }
    if (!resolvedName || resolvedName.length < 2) { onError('Item name is required (min 2 characters).'); return; }

    setBusy(true);
    try {
      let finalSportCategoryId = sportCategoryId;
      if (isCustomSport) {
        if (!customSportName.trim()) { onError('Sport name is required.'); setBusy(false); return; }
        if (customSportIndoor === '') { onError('Please select Indoor or Outdoor for the new sport.'); setBusy(false); return; }
        const catRes = await inv.createSportCategory({
          name: customSportName.trim(), isIndoor: customSportIndoor === '1', imageData: customImageData || undefined,
        });
        finalSportCategoryId = catRes.category.sport_category_id;
      }

      await inv.createType({
        sportCategoryId: finalSportCategoryId, name: resolvedName, lendingUnit,
        lowStockThreshold: threshold, maxBorrowDurationMinutes,
        conditionGoodMinScore, conditionWornMinScore,
        isIndoor: isIndoor === '1', imageUrl: resolvedImageUrl,
      });
      if (isCustomSport) onCatsChanged();
      onDone();
    } catch (e) { onError(errMsg(e)); } finally { setBusy(false); }
  }

  const showCustomImage = isCustomSport || itemNameMode === 'custom';
  const lendingUnitLocked = itemNameMode === 'preset' && Boolean(selectedPreset);

  return (
    <form onSubmit={submit} className="inv-form-grid" style={formGrid}>
      <L label="Sport / Category">
        <select style={inp} value={isCustomSport ? '__custom__' : sportCategoryId} onChange={(e) => handleSportChange(e.target.value)} required>
          <option value={0} disabled>Select</option>
          {cats.map((c) => <option key={c.sport_category_id} value={c.sport_category_id}>{c.name}</option>)}
          <option value="__custom__">Other (add new sport)…</option>
        </select>
      </L>

      {isCustomSport ? (
        <>
          <L label="New sport name"><input style={inp} value={customSportName} onChange={(e) => setCustomSportName(e.target.value)} placeholder="e.g. Squash" required /></L>
          <L label="Sport setting (Indoor / Outdoor)">
            <select style={inp} value={customSportIndoor} onChange={(e) => setCustomSportIndoor(e.target.value as '' | '1' | '0')} required>
              <option value="" disabled>Select</option>
              <option value="1">Indoor</option>
              <option value="0">Outdoor</option>
            </select>
          </L>
          <L label="Item name"><input style={inp} value={customItemName} onChange={(e) => setCustomItemName(e.target.value)} placeholder="e.g. Squash Racket" required /></L>
        </>
      ) : (
        <L label="Item name">
          {sportCategoryId === 0 ? (
            <select style={inp} disabled><option>Select a sport first</option></select>
          ) : (
            <select style={inp} value={itemNameMode === 'preset' ? selectedPresetName : '__custom__'}
              onChange={(e) => handleItemNameChange(e.target.value)} required>
              <option value="" disabled>Select</option>
              {sportPresets.map((p) => <option key={p.preset_id} value={p.name}>{p.name}</option>)}
              <option value="__custom__">Other (custom name)…</option>
            </select>
          )}
        </L>
      )}

      {!isCustomSport && itemNameMode === 'custom' && sportCategoryId > 0 && (
        <L label="Custom item name"><input style={inp} value={customItemName} onChange={(e) => setCustomItemName(e.target.value)} placeholder="e.g. Training Cone" required /></L>
      )}

      <L label="Lending unit">
        {lendingUnitLocked ? (
          <input style={{ ...inp, background: '#EEF2F8', color: '#62748E' }} value={lendingUnit === 'PAIR' ? 'Pair' : 'Single'} readOnly disabled />
        ) : (
          <select style={inp} value={lendingUnit} onChange={(e) => setUnit(e.target.value as 'SINGLE' | 'PAIR')}>
            <option value="SINGLE">Single</option><option value="PAIR">Pair</option>
          </select>
        )}
      </L>
      <L label="Indoor / Outdoor">
        <select style={inp} value={isIndoor} onChange={(e) => setIndoor(e.target.value as '' | '1' | '0')} required>
          <option value="" disabled>Select</option>
          <option value="1">Indoor</option>
          <option value="0">Outdoor</option>
        </select>
      </L>

      <L label="Low-stock threshold">
        <input type="number" min={0} style={inp} value={lowStockThreshold} onChange={(e) => setThreshold(e.target.value)} placeholder="7" required />
      </L>
      <L label="Max borrow duration">
        <DurationPicker hours={hours} minutes={minutes} onChange={(h, m) => { setHours(h); setMinutes(m); }} />
      </L>

      <L label="GOOD ≥ score"><input type="number" min={0} max={100} style={inp} value={conditionGoodMinScore} onChange={(e) => setGood(Number(e.target.value))} required /></L>
      <L label="WORN ≥ score"><input type="number" min={0} max={100} style={inp} value={conditionWornMinScore} onChange={(e) => setWorn(Number(e.target.value))} required /></L>

      {showCustomImage && (
        <div style={{ gridColumn: '1 / -1' }}>
          <L label="Equipment image"><input type="file" accept="image/*" style={inp} onChange={handleImageUpload} required /></L>
          {customImageData && <img src={customImageData} alt="Preview" style={{ ...thumb, width: 64, height: 64, marginTop: 8 }} />}
        </div>
      )}

      {!showCustomImage && selectedPreset && (
        <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0' }}>
          <img src={presetImageSrc(selectedPreset.image_key)} alt={selectedPreset.name} style={{ ...thumb, width: 48, height: 48 }} />
          <span style={{ fontSize: 13, color: '#62748E' }}>Image auto-assigned for {selectedPreset.name}</span>
        </div>
      )}

      <div style={{ gridColumn: '1 / -1' }}><button style={primaryBtn} disabled={busy}><CheckCircleIcon /> {busy ? 'Saving…' : 'Create Type'}</button></div>
    </form>
  );
}

// Editable fields only: name, indoor flag, thresholds/duration, condition
// bands, image. Sport and lending unit stay fixed once a type exists.
function EditTypeForm({ type, onDone, onError, onCancel }: {
  type: inv.EquipmentType; onDone: () => void; onError: (m: string) => void; onCancel: () => void;
}) {
  const [name, setName] = useState(type.name);
  const [isIndoor, setIndoor] = useState(type.is_indoor ? '1' : '0');
  const [lowStockThreshold, setThreshold] = useState(String(type.low_stock_threshold));
  const [hours, setHours] = useState(Math.floor(type.max_borrow_duration_minutes / 60));
  const [minutes, setMinutes] = useState(type.max_borrow_duration_minutes % 60);
  const [conditionGoodMinScore, setGood] = useState(Number(type.condition_good_min_score));
  const [conditionWornMinScore, setWorn] = useState(Number(type.condition_worn_min_score));
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const threshold = Number(lowStockThreshold);
    if (Number.isNaN(threshold) || threshold < 0) { onError('Low-stock threshold must be a non-negative number.'); return; }
    const maxBorrowDurationMinutes = hours * 60 + minutes;
    if (maxBorrowDurationMinutes <= 0) { onError('Max borrow duration must be greater than 0.'); return; }
    setBusy(true);
    try {
      await inv.updateType(type.equipment_type_id, {
        name, isIndoor: isIndoor === '1', lowStockThreshold: threshold, maxBorrowDurationMinutes,
        conditionGoodMinScore, conditionWornMinScore,
      });
      onDone();
    } catch (e) { onError(errMsg(e)); } finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="inv-form-grid" style={formGrid}>
      <L label="Name"><input style={inp} value={name} onChange={(e) => setName(e.target.value)} required /></L>
      <L label="Indoor / Outdoor">
        <select style={inp} value={isIndoor} onChange={(e) => setIndoor(e.target.value)}>
          <option value="1">Indoor</option><option value="0">Outdoor</option>
        </select>
      </L>
      <L label="Low-stock threshold"><input type="number" min={0} style={inp} value={lowStockThreshold} onChange={(e) => setThreshold(e.target.value)} required /></L>
      <L label="Max borrow duration"><DurationPicker hours={hours} minutes={minutes} onChange={(h, m) => { setHours(h); setMinutes(m); }} /></L>
      <L label="GOOD ≥ score"><input type="number" min={0} max={100} style={inp} value={conditionGoodMinScore} onChange={(e) => setGood(Number(e.target.value))} required /></L>
      <L label="WORN ≥ score"><input type="number" min={0} max={100} style={inp} value={conditionWornMinScore} onChange={(e) => setWorn(Number(e.target.value))} required /></L>
      <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8 }}>
        <button style={primaryBtn} disabled={busy}>{busy ? 'Saving…' : 'Save Changes'}</button>
        <button type="button" style={ghostBtn} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

// ─────────────────────────── ARTICLES ───────────────────────────
function ArticlesTab({ flash }: { flash: Flash }) {
  const [types, setTypes] = useState<inv.EquipmentType[]>([]);
  const [articles, setArticles] = useState<inv.Article[]>([]);
  const [filterType, setFilterType] = useState<number>(0);
  const [filterState, setFilterState] = useState<inv.ArticleState | ''>('');
  const [filterCondition, setFilterCondition] = useState<inv.ConditionLabel | ''>('');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounced(search);
  const [decommissioning, setDecommissioning] = useState<string | null>(null);
  const [scanTarget, setScanTarget] = useState<{ articleId: string; label: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const [t, a] = await Promise.all([
        inv.listTypes(),
        inv.listArticles({
          equipmentTypeId: filterType || undefined,
          state: filterState || undefined,
          condition: filterCondition || undefined,
        }),
      ]);
      setTypes(t.types); setArticles(a.articles);
    } catch (e) { flash.setError(errMsg(e)); }
  }, [flash, filterType, filterState, filterCondition]);
  useEffect(() => { void load(); }, [load]);

  const fuse = useMemo(() => new Fuse(articles, {
    keys: ['barcode', 'equipment_type_name'], threshold: 0.4, ignoreLocation: true,
  }), [articles]);
  const searchedArticles = debouncedSearch.trim() ? fuse.search(debouncedSearch.trim()).map((r) => r.item) : articles;
  const [articlePage, setArticlePage] = useState(1);
  useEffect(() => { setArticlePage(1); }, [debouncedSearch, filterType, filterState, filterCondition]);

  async function decommission(id: string) {
    try { await inv.decommissionArticle(id); flash.setNotice('Article decommissioned.'); void load(); }
    catch (e) { flash.setError(errMsg(e)); } finally { setDecommissioning(null); }
  }

  const stateBadge = (s: inv.ArticleState) => s === 'AVAILABLE' ? badge.ok : s === 'DAMAGED' ? badge.danger : badge.neutral;

  // Group paired rows together for display so a pair reads as one logical unit.
  const seenPairs = new Set<string>();
  const rows: Array<{ kind: 'single' | 'pair'; a: inv.Article; b?: inv.Article }> = [];
  for (const a of searchedArticles) {
    if (a.pair_id) {
      if (seenPairs.has(a.pair_id)) continue;
      seenPairs.add(a.pair_id);
      const b = searchedArticles.find((x) => x.pair_id === a.pair_id && x.article_id !== a.article_id);
      rows.push({ kind: 'pair', a, b });
    } else {
      rows.push({ kind: 'single', a });
    }
  }

  return (
    <>
      <Panel title="Add Article(s)" icon={<PlusIcon />}>
        <AddArticleForms types={types} onDone={(m) => { flash.setNotice(m); void load(); }} onError={flash.setError} />
      </Panel>

      <Panel title="Articles" icon={<BarcodeIcon />} action={
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <select style={filterSelect} value={filterType} onChange={(e) => setFilterType(Number(e.target.value))}>
            <option value={0}>All types</option>
            {types.map((t) => <option key={t.equipment_type_id} value={t.equipment_type_id}>{t.name}</option>)}
          </select>
          <select style={filterSelect} value={filterState} onChange={(e) => setFilterState(e.target.value as inv.ArticleState | '')}>
            <option value="">All states</option>
            {(['AVAILABLE', 'ON_LOAN', 'DAMAGED'] as inv.ArticleState[]).map((s) => <option key={s} value={s}>{STATE_LABEL[s]}</option>)}
          </select>
          <select style={filterSelect} value={filterCondition} onChange={(e) => setFilterCondition(e.target.value as inv.ConditionLabel | '')}>
            <option value="">All conditions</option>
            <option value="GOOD">Good</option><option value="WORN">Worn</option><option value="DAMAGED">Damaged</option>
          </select>
        </div>
      }>
        <SearchInput value={search} onChange={setSearch} placeholder="Search by barcode or equipment name…" />
        {rows.length === 0 ? <EmptyState text="No articles match. Add one above." /> : (
          <div style={tableWrap}>
          <table style={table}>
            <thead><tr><th style={th}>Barcode</th><th style={th}>Type</th><th style={th}>Condition</th><th style={th}>State</th><th style={th} /></tr></thead>
            <tbody>
              {paginate(rows, articlePage).map((r) => r.kind === 'pair' ? (
                <tr key={r.a.pair_id} className="inv-row">
                  <td style={{ ...td, fontFamily: 'var(--font-mono)' }}>
                    <span style={pairChip}>Pair</span> {r.a.barcode}{r.b ? ` + ${r.b.barcode}` : ''}
                  </td>
                  <td style={td}>{r.a.equipment_type_name}</td>
                  <td style={td}>{r.a.current_condition_label}{r.b && r.b.current_condition_label !== r.a.current_condition_label ? ` / ${r.b.current_condition_label}` : ''}</td>
                  <td style={td}><span style={{ ...badgeBase, ...stateBadge(r.a.state) }}>{STATE_LABEL[r.a.state]}</span></td>
                  <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button style={linkBtn} onClick={() => setScanTarget({ articleId: r.a.article_id, label: `${r.a.barcode} (A)` })}>Scan A</button>
                    {r.b && <button style={linkBtn} onClick={() => setScanTarget({ articleId: r.b!.article_id, label: `${r.b!.barcode} (B)` })}>Scan B</button>}
                    <button style={{ ...linkBtn, color: 'var(--danger)' }} onClick={() => setDecommissioning(r.a.article_id)}>Decommission Pair</button>
                  </td>
                </tr>
              ) : (
                <tr key={r.a.article_id} className="inv-row">
                  <td style={{ ...td, fontFamily: 'var(--font-mono)' }}><span style={singleChip}>Single</span> {r.a.barcode}</td>
                  <td style={td}>{r.a.equipment_type_name}</td>
                  <td style={td}>{r.a.current_condition_label}</td>
                  <td style={td}><span style={{ ...badgeBase, ...stateBadge(r.a.state) }}>{STATE_LABEL[r.a.state]}</span></td>
                  <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button style={linkBtn} onClick={() => setScanTarget({ articleId: r.a.article_id, label: r.a.barcode })}>Scan</button>
                    <button style={{ ...linkBtn, color: 'var(--danger)' }} onClick={() => setDecommissioning(r.a.article_id)}>Decommission</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
        {rows.length > 0 && <Pager page={articlePage} total={rows.length} noun="entries (pairs count as one)" onChange={setArticlePage} />}
      </Panel>

      {decommissioning && (
        <ConfirmModal title="Decommission Article" danger confirmLabel="Decommission"
          message="This is permanent and removes the article (and its pair sibling, if any) from active stock."
          onConfirm={() => decommission(decommissioning)} onCancel={() => setDecommissioning(null)} />
      )}

      {scanTarget && (
        <ScanModal label={scanTarget.label}
          onSubmit={async (score, imageData) => {
            try {
              const r = await inv.scanArticle(scanTarget.articleId, { kind: 'AD_HOC', score, imageData });
              flash.setNotice(`Scan recorded — condition is now ${r.conditionLabel}.`);
              setScanTarget(null); void load();
            } catch (e) { flash.setError(errMsg(e)); setScanTarget(null); }
          }}
          onCancel={() => setScanTarget(null)} />
      )}

    </>
  );
}

// Health-score capture modal used by the Articles "Scan" action. A non-DAMAGED
// result automatically clears any open damage flag and restores availability
// server-side — no separate review step needed.
function ScanModal({ label, onSubmit, onCancel }: {
  label: string; onSubmit: (score: number, imageData?: string) => void; onCancel: () => void;
}) {
  const [score, setScore] = useState('');
  const [imageData, setImageData] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const n = Number(score);
    if (score === '' || Number.isNaN(n) || n < 0 || n > 100) return;
    setBusy(true);
    await onSubmit(n, imageData ?? undefined);
    setBusy(false);
  }

  return (
    <Modal title={`Health Check — ${label}`} onClose={onCancel}>
      <form onSubmit={submit}>
        <div style={{ marginBottom: 14 }}>
          <span style={lbl}>Photo (optional)</span>
          <PhotoUploadScan imageData={imageData} onImage={setImageData} onClear={() => setImageData(null)} />
        </div>
        <L label="Health score (0–100)">
          <input type="number" min={0} max={100} style={inp} value={score} onChange={(e) => setScore(e.target.value)} required autoFocus />
        </L>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button type="button" style={ghostBtn} onClick={onCancel}>Cancel</button>
          <button style={primaryBtn} disabled={busy}>{busy ? 'Saving…' : 'Submit'}</button>
        </div>
      </form>
    </Modal>
  );
}

function AddArticleForms({ types, onDone, onError }: { types: inv.EquipmentType[]; onDone: (m: string) => void; onError: (m: string) => void }) {
  const [equipmentTypeId, setType] = useState(0);
  const selectedType = types.find((t) => t.equipment_type_id === equipmentTypeId);
  const isPair = selectedType?.lending_unit === 'PAIR';

  const [barcode, setBarcode] = useState('');
  const [entryScore, setScore] = useState('');
  const [imageData, setImageData] = useState<string | null>(null);
  const [scanningFor, setScanningFor] = useState<'single' | 'A' | 'B' | null>(null);

  const [barcodeA, setBarcodeA] = useState('');
  const [barcodeB, setBarcodeB] = useState('');
  const [scoreA, setScoreA] = useState('');
  const [scoreB, setScoreB] = useState('');
  const [imageDataA, setImageDataA] = useState<string | null>(null);
  const [imageDataB, setImageDataB] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function validScore(s: string): number | null {
    const n = Number(s);
    if (s === '' || Number.isNaN(n) || n < 0 || n > 100) return null;
    return n;
  }

  async function submitSingle(e: React.FormEvent) {
    e.preventDefault();
    const score = validScore(entryScore);
    if (score === null) { onError('Health score is required (0–100).'); return; }
    if (!/^\d{12}$/.test(barcode)) { onError('Barcode must be exactly 12 digits.'); return; }
    setBusy(true);
    try {
      const r = await inv.addArticle({ equipmentTypeId, barcode, entryScore: score, imageData: imageData ?? undefined });
      onDone(`Article ${r.article.barcode} added (${STATE_LABEL[r.article.state]}, ${r.article.conditionLabel}).`);
      setBarcode(''); setScore(''); setImageData(null);
    } catch (e) { onError(errMsg(e)); } finally { setBusy(false); }
  }

  async function submitPair(e: React.FormEvent) {
    e.preventDefault();
    const sA = validScore(scoreA); const sB = validScore(scoreB);
    if (sA === null || sB === null) { onError('Both health scores are required (0–100).'); return; }
    if (!/^\d{12}$/.test(barcodeA) || !/^\d{12}$/.test(barcodeB)) { onError('Both barcodes must be exactly 12 digits.'); return; }
    setBusy(true);
    try {
      const r = await inv.addArticlePair({
        equipmentTypeId, barcodeA, barcodeB, entryScoreA: sA, entryScoreB: sB,
        imageDataA: imageDataA ?? undefined, imageDataB: imageDataB ?? undefined,
      });
      onDone(`Pair added: ${r.pairEntry.barcodeA} + ${r.pairEntry.barcodeB} (${STATE_LABEL[r.pairEntry.state]}).`);
      setBarcodeA(''); setBarcodeB(''); setScoreA(''); setScoreB(''); setImageDataA(null); setImageDataB(null);
    } catch (e) { onError(errMsg(e)); } finally { setBusy(false); }
  }

  return (
    <>
      <L label="Equipment type"><select style={{ ...inp, maxWidth: 360 }} value={equipmentTypeId} onChange={(e) => setType(Number(e.target.value))} required>
        <option value={0}>Select</option>
        {types.map((t) => <option key={t.equipment_type_id} value={t.equipment_type_id}>{t.name} ({t.lending_unit === 'PAIR' ? 'Pair' : 'Single'})</option>)}
      </select></L>

      {equipmentTypeId === 0 ? null : isPair ? (
        <form onSubmit={submitPair} className="inv-form-grid" style={{ ...formGrid, marginTop: 14 }}>
          <p style={{ gridColumn: '1 / -1', margin: 0, ...infoNote }}>
            This type lends in pairs — enter both articles together; they'll be stored already paired.
          </p>
          <L label="Barcode A">
            <BarcodeField value={barcodeA} onChange={setBarcodeA} onScan={() => setScanningFor('A')} />
          </L>
          <L label="Barcode B">
            <BarcodeField value={barcodeB} onChange={setBarcodeB} onScan={() => setScanningFor('B')} />
          </L>
          <div>
            <span style={lbl}>Photo A (optional)</span>
            <PhotoUploadScan imageData={imageDataA} onImage={setImageDataA} onClear={() => setImageDataA(null)} onBarcode={setBarcodeA} label="Upload Photo A" />
          </div>
          <div>
            <span style={lbl}>Photo B (optional)</span>
            <PhotoUploadScan imageData={imageDataB} onImage={setImageDataB} onClear={() => setImageDataB(null)} onBarcode={setBarcodeB} label="Upload Photo B" />
          </div>
          <L label="Entry score A (0–100)"><input type="number" min={0} max={100} style={inp} value={scoreA} onChange={(e) => setScoreA(e.target.value)} required /></L>
          <L label="Entry score B (0–100)"><input type="number" min={0} max={100} style={inp} value={scoreB} onChange={(e) => setScoreB(e.target.value)} required /></L>
          <div style={{ gridColumn: '1 / -1' }}><button style={primaryBtn} disabled={busy}><PlusIcon /> {busy ? 'Adding…' : 'Add Pair'}</button></div>
        </form>
      ) : (
        <form onSubmit={submitSingle} className="inv-form-grid" style={{ ...formGrid, marginTop: 14 }}>
          <L label="Barcode">
            <BarcodeField value={barcode} onChange={setBarcode} onScan={() => setScanningFor('single')} />
          </L>
          <L label="Entry health score (0–100)"><input type="number" min={0} max={100} style={inp} value={entryScore} onChange={(e) => setScore(e.target.value)} required /></L>
          <div style={{ gridColumn: '1 / -1' }}>
            <span style={lbl}>Photo (optional)</span>
            <PhotoUploadScan imageData={imageData} onImage={setImageData} onClear={() => setImageData(null)} onBarcode={setBarcode} />
          </div>
          <div style={{ gridColumn: '1 / -1' }}><button style={primaryBtn} disabled={busy}><PlusIcon /> {busy ? 'Adding…' : 'Add Article'}</button></div>
        </form>
      )}

      {scanningFor && (
        <BarcodeScannerModal
          onDetected={(code) => {
            if (scanningFor === 'single') setBarcode(code);
            else if (scanningFor === 'A') setBarcodeA(code);
            else setBarcodeB(code);
            setScanningFor(null);
          }}
          onClose={() => setScanningFor(null)}
        />
      )}
    </>
  );
}

function BarcodeField({ value, onChange, onScan }: { value: string; onChange: (v: string) => void; onScan: () => void }) {
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      <input style={inp} value={value} onChange={(e) => onChange(e.target.value)} placeholder="12-digit UPC/EAN" maxLength={12} required />
      <button type="button" style={{ ...secondaryBtnSm }} onClick={onScan} title="Scan with camera" aria-label="Scan barcode with camera"><CameraIcon /> Scan</button>
    </div>
  );
}

// ─────────────────────────── shared UI ───────────────────────────
function Panel({ title, icon, action, children }: { title: string; icon?: ReactNode; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="inv-card" style={panel}>
      <div style={panelHead}>
        <span style={panelHeadLeft}>
          <span style={panelIcon}>{icon ?? <BoxIcon size={17} />}</span>
          <span>{title}</span>
        </span>
        {action}
      </div>
      <div style={panelBody}>{children}</div>
    </section>
  );
}
// ── Pagination (client-side, 10 rows per page) ──
const PAGE_SIZE = 10;
function paginate<T>(items: T[], page: number): T[] {
  return items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
}
function Pager({ page, total, noun, onChange }: { page: number; total: number; noun: string; onChange: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const current = Math.min(page, pages);
  // Keep the page valid if the list shrinks (e.g. after a delete).
  useEffect(() => { if (page > pages) onChange(pages); }, [page, pages, onChange]);
  const from = (current - 1) * PAGE_SIZE + 1;
  const to = Math.min(current * PAGE_SIZE, total);
  const nums = Array.from({ length: pages }, (_, i) => i + 1)
    .filter((n) => pages <= 7 || n === 1 || n === pages || Math.abs(n - current) <= 1);
  return (
    <div style={pagerRow}>
      <span style={tableFoot}>Showing {from}–{to} of {total} {noun}</span>
      {pages > 1 && (
        <nav style={{ display: 'flex', alignItems: 'center', gap: 6 }} aria-label="Pagination">
          <button type="button" style={pagerBtn} disabled={current === 1} onClick={() => onChange(current - 1)} aria-label="Previous page"><ChevronLeftIcon /></button>
          {nums.map((n, i) => (
            <Fragment key={n}>
              {i > 0 && n - nums[i - 1]! > 1 && <span style={{ color: palette.slate400, padding: '0 2px' }}>…</span>}
              <button type="button" onClick={() => onChange(n)} aria-current={n === current ? 'page' : undefined}
                style={{ ...pagerBtn, ...(n === current ? pagerBtnActive : null) }}>{n}</button>
            </Fragment>
          ))}
          <button type="button" style={pagerBtn} disabled={current === pages} onClick={() => onChange(current + 1)} aria-label="Next page"><ChevronRightIcon /></button>
        </nav>
      )}
    </div>
  );
}
function StatCard({ label, value, accent, icon }: { label: string; value: number; accent: string; icon: ReactNode }) {
  return (
    <div className="inv-stat" style={statCard}>
      <span style={{ ...statIcon, color: accent, background: `${accent}1a` }}>{icon}</span>
      <div>
        <div style={{ ...statValue, color: accent }}>{value}</div>
        <div style={statLabel}>{label}</div>
      </div>
    </div>
  );
}
function EmptyState({ text }: { text: string }) {
  return (
    <div style={emptyState}>
      <span style={emptyIcon}><BoxIcon size={20} /></span>
      <p style={{ ...muted, maxWidth: 380 }}>{text}</p>
    </div>
  );
}
function L({ label, children }: { label: string; children: React.ReactNode }) {
  return <div style={{ display: 'block' }}><span style={lbl}>{label}</span>{children}</div>;
}
function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div style={{ position: 'relative', marginBottom: 16 }}>
      <span style={searchIconPos}><SearchIcon /></span>
      <input type="search" style={{ ...inp, paddingLeft: 38 }} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
    </div>
  );
}

/* ---------- icons ---------- */
const ico = (size: number, children: ReactNode) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{children}</svg>
);
function BackIcon() { return <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M9.5 3 4 8l5.5 5M4.5 8H14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>; }
function SignOutIcon() { return <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M6.5 2H3.5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /><path d="M10.5 5 14 8l-3.5 3M14 8H6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>; }
function BoxIcon({ size = 16 }: { size?: number }) { return ico(size, <><path d="M21 8 12 3 3 8v8l9 5 9-5V8z" /><path d="m3 8 9 5 9-5M12 13v8" /></>); }
function BarcodeIcon() { return ico(16, <path d="M4 6v12M7 6v12M10.5 6v12M13 6v12M16.5 6v12M20 6v12" />); }
function CameraIcon() { return ico(16, <><path d="M4 8h3l1.5-2.5h7L17 8h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></>); }
function SearchIcon() { return ico(16, <><circle cx="11" cy="11" r="6.5" /><path d="m20 20-3.6-3.6" /></>); }
function AlertIcon() { return ico(16, <><path d="M12 3.5 21.5 20h-19L12 3.5z" /><path d="M12 10v4.2" /><circle cx="12" cy="17" r="0.6" fill="currentColor" /></>); }
function CheckCircleIcon() { return ico(16, <><circle cx="12" cy="12" r="9.2" /><path d="m8 12.3 2.6 2.6L16.3 9" /></>); }
function ClockIcon() { return ico(16, <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>); }
function PlusIcon() { return ico(15, <path d="M12 5v14M5 12h14" />); }
function XIcon() { return ico(15, <path d="M6 6l12 12M18 6 6 18" />); }
function ChevronLeftIcon() { return ico(16, <path d="m15 6-6 6 6 6" />); }
function ChevronRightIcon() { return ico(16, <path d="m9 6 6 6-6 6" />); }
function EditIcon() { return ico(15, <><path d="M4 20h4L19 9l-4-4L4 16v4z" /><path d="m13.5 6.5 4 4" /></>); }

/* ---------- theme (same values as AdminAccountsScreen / ConflictDetectionScreen `palette`) ---------- */
const palette = {
  navy900: '#0F172B',
  navy800: '#132357',
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
const CARD_BG = 'linear-gradient(145deg, #F8FAFF 0%, #EAF0FC 100%)';
const CARD_SHADOW = '0 12px 30px -22px rgba(3,22,54,.85)';
const INPUT_BORDER = `1.5px solid ${palette.slate300}`;

/* ---------- page chrome (identical to Accounts) ---------- */
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
  topBtn: { display: 'inline-flex', alignItems: 'center', gap: 7, background: 'transparent', color: palette.slate100, border: `1.5px solid ${palette.slate400}`, borderRadius: 999, padding: '9px 16px', fontSize: 13.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'none' } as const,
  main: { flex: 1, position: 'relative', zIndex: 1, padding: '20px 24px 48px', width: '100%', maxWidth: 1100, margin: '0 auto', boxSizing: 'border-box' } as const,
  glassPanel: {
    position: 'relative', background: 'rgba(255,255,255,0.07)', minHeight: 200,
    backdropFilter: 'blur(22px) saturate(160%)', WebkitBackdropFilter: 'blur(22px) saturate(160%)',
    border: '1px solid rgba(255,255,255,0.16)', borderRadius: 24,
    padding: '28px 28px 34px',
    boxShadow: '0 24px 60px -32px rgba(3,22,54,0.75), inset 0 1px 0 rgba(255,255,255,0.10)',
  } as const,
  hero: { position: 'relative', textAlign: 'center', maxWidth: 600, margin: '0 auto 22px' } as const,
  heroEyebrow: {
    display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase',
    padding: '6px 14px', borderRadius: 999, marginBottom: 14,
    color: palette.slate100, background: `${palette.navy800}88`, border: `1px solid ${palette.slate400}55`,
  } as const,
  heroTitle: { fontSize: 32, fontWeight: 800, color: palette.white, margin: '0 0 8px', letterSpacing: '-0.5px' } as const,
  heroSubtitle: { fontSize: 14.5, lineHeight: 1.55, color: palette.slate300, margin: 0 } as const,
  footer: { textAlign: 'center', padding: '20px 24px', fontSize: 12.5, color: palette.slate400, borderTop: `1px solid ${palette.slate600}55`, position: 'relative', zIndex: 1 } as const,
  footerLink: { color: palette.accentSoft, textDecoration: 'none', fontWeight: 600 } as const,
} satisfies Record<string, React.CSSProperties>;

/* ---------- content styles (names unchanged; values re-themed) ---------- */
const tabRow: React.CSSProperties = { display: 'flex', gap: 4, padding: 4, background: palette.white, border: `1px solid ${palette.slate300}`, borderRadius: 12, marginBottom: 20, boxShadow: '0 2px 10px -6px rgba(3,22,54,0.3)' };
const tabBtn: React.CSSProperties = { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, font: '600 14px Inter, sans-serif', padding: '10px 12px', border: 'none', background: 'transparent', color: palette.slate500, borderRadius: 9, cursor: 'pointer' };
const tabActive: React.CSSProperties = { background: palette.accent, color: '#fff', boxShadow: '0 8px 16px -8px rgba(3,22,54,0.6)' };
const panel: React.CSSProperties = { background: CARD_BG, border: `1px solid ${palette.slate300}e6`, borderRadius: 18, boxShadow: CARD_SHADOW, marginBottom: 22 };
const panelHead: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '14px 22px', borderBottom: `1px solid ${palette.slate300}`, background: palette.white, borderRadius: '18px 18px 0 0' };
const panelHeadLeft: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, font: '700 15.5px Inter, sans-serif', color: palette.navy900 };
const panelIcon: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, borderRadius: 9, background: palette.accentWash, color: palette.accent };
const panelBody: React.CSSProperties = { padding: 22 };
const tableWrap: React.CSSProperties = { overflowX: 'auto' };
const table: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 14, minWidth: 560 };
const th: React.CSSProperties = { textAlign: 'left', font: '700 11.5px Inter, sans-serif', color: palette.slate500, textTransform: 'uppercase', letterSpacing: '0.05em', padding: '0 12px 12px', borderBottom: `1px solid ${palette.slate300}` };
const td: React.CSSProperties = { padding: '12px 12px', borderBottom: `1px solid ${palette.slate100}`, color: palette.navy900, verticalAlign: 'middle' };
const tableFoot: React.CSSProperties = { fontSize: 12.5, color: palette.slate500 };
const muted: React.CSSProperties = { color: palette.slate500, fontSize: 14, margin: 0 };
const formGrid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '16px 18px', maxWidth: 680 };
const formBlock: React.CSSProperties = { background: palette.white, border: `1px solid ${palette.slate300}`, borderRadius: 14, padding: 18, marginBottom: 20 };
const formBlockTitle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, font: '700 14px Inter, sans-serif', color: palette.accent, marginBottom: 14 };
const lbl: React.CSSProperties = { display: 'block', font: '600 12.5px Inter, sans-serif', color: palette.slate600, marginBottom: 6 };
const inp: React.CSSProperties = { width: '100%', font: '14px Inter, sans-serif', padding: '10px 12px', border: INPUT_BORDER, borderRadius: 10, background: palette.slate50, color: palette.navy900, boxSizing: 'border-box' };
const filterSelect: React.CSSProperties = { ...inp, width: 'auto', padding: '8px 10px', fontSize: 13.5, background: palette.white };
const searchIconPos: React.CSSProperties = { position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', display: 'flex', color: palette.slate500, pointerEvents: 'none' };
const infoNote: React.CSSProperties = { fontSize: 13, color: palette.accent, background: palette.accentWash, border: `1px solid ${palette.accentSoft}`, borderRadius: 10, padding: '9px 12px' };
const primaryBtn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 7, background: palette.accent, color: '#fff', border: 'none', borderRadius: 10, padding: '10px 18px', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'Inter, sans-serif', boxShadow: '0 8px 16px -8px rgba(3,22,54,0.6)' };
const ghostBtn: React.CSSProperties = { background: palette.white, color: palette.slate500, border: `1.5px solid ${palette.slate300}`, borderRadius: 10, padding: '10px 18px', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'Inter, sans-serif' };
const secondaryBtnSm: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0, background: palette.accentWash, color: palette.accent, border: `1px solid ${palette.accentSoft}`, borderRadius: 10, padding: '8px 12px', fontSize: 13.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'Inter, sans-serif' };
const linkBtn: React.CSSProperties = { background: 'none', border: 'none', font: '700 13px Inter, sans-serif', color: palette.accent, cursor: 'pointer', padding: '4px 8px' };
const badgeBase: React.CSSProperties = { display: 'inline-block', font: '700 11px Inter, sans-serif', padding: '4px 10px', borderRadius: 999, whiteSpace: 'nowrap' };
const badge = {
  ok: { background: '#E6F4EC', color: '#1F7A45' } as React.CSSProperties,
  warn: { background: '#FDF1E3', color: '#9A6412' } as React.CSSProperties,
  danger: { background: '#FDECEC', color: '#B3352B' } as React.CSSProperties,
  neutral: { background: palette.accentWash, color: palette.accent } as React.CSSProperties,
};
const box = {
  err: { display: 'flex', alignItems: 'center', gap: 8, background: '#FDECEC', color: '#8F2323', border: '1px solid #F3CACA', borderRadius: 12, padding: '11px 16px', marginBottom: 16, fontSize: 14 } as React.CSSProperties,
  ok: { display: 'flex', alignItems: 'center', gap: 8, background: '#E6F4EC', color: '#1F7A45', border: '1px solid #1F7A4555', borderRadius: 12, padding: '11px 16px', marginBottom: 16, fontSize: 14 } as React.CSSProperties,
};
const thumb: React.CSSProperties = { width: 38, height: 38, objectFit: 'cover', borderRadius: 10, display: 'block', background: palette.white, border: `1px solid ${palette.slate300}` };
const thumbPlaceholder: React.CSSProperties = { width: 38, height: 38, borderRadius: 10, background: palette.accentWash };
const pairChip: React.CSSProperties = { font: '700 10px Inter, sans-serif', padding: '3px 8px', borderRadius: 999, background: palette.accentWash, color: palette.accent, marginRight: 6, textTransform: 'uppercase', letterSpacing: '0.04em' };
const singleChip: React.CSSProperties = { font: '700 10px Inter, sans-serif', padding: '3px 8px', borderRadius: 999, background: palette.slate100, color: palette.slate500, marginRight: 6, textTransform: 'uppercase', letterSpacing: '0.04em' };
const pickerDropdown: React.CSSProperties = { position: 'absolute', top: '100%', left: 0, zIndex: 100, marginTop: 6, background: palette.white, border: `1px solid ${palette.slate300}`, borderRadius: 12, boxShadow: '0 18px 40px -16px rgba(3,22,54,0.45)', minWidth: 170, overflow: 'hidden' };
const pickerCol: React.CSSProperties = { maxHeight: 220, overflowY: 'auto', padding: 4, minWidth: 60 };
const pickerColHead: React.CSSProperties = { font: '700 10px Inter, sans-serif', color: palette.slate500, textTransform: 'uppercase', textAlign: 'center', padding: '4px 0', letterSpacing: '0.05em' };
const pickerCell: React.CSSProperties = { padding: '6px 8px', textAlign: 'center', fontSize: 14, borderRadius: 8, cursor: 'pointer', color: palette.navy900 };
const pickerCellActive: React.CSSProperties = { background: palette.accent, color: '#fff', fontWeight: 700 };
const statRow: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 20 };
const statCard: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 12, background: palette.slate50, border: `1px solid ${palette.slate300}`, borderRadius: 14, padding: '12px 14px' };
const statIcon: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36, borderRadius: 10 };
const statValue: React.CSSProperties = { fontSize: 20, fontWeight: 800, lineHeight: 1.1 };
const statLabel: React.CSSProperties = { fontSize: 11.5, color: palette.slate500, fontWeight: 600, marginTop: 2 };
const emptyState: React.CSSProperties = { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '30px 16px', textAlign: 'center' };
const emptyIcon: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 46, height: 46, borderRadius: '50%', background: palette.accentWash, color: palette.accent };
const pagerRow: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginTop: 14 };
const pagerBtn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 34, height: 34, padding: '0 8px', borderRadius: 9, border: `1.5px solid ${palette.slate300}`, background: palette.white, color: palette.navy900, font: '600 13px Inter, sans-serif', cursor: 'pointer' };
const pagerBtnActive: React.CSSProperties = { background: palette.accent, borderColor: palette.accent, color: '#fff' };
