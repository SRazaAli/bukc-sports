/**
 * Inventory console (Feature 4) — staff only. Three tabs:
 *   Equipment  — types + live availability status + add/edit/delete a type
 *   Articles   — add single/pair articles (barcode scan or manual), list
 *                (grouped pairs), scan, decommission
 *   Damage     — open damage flags + clear with a fresh health score
 */
import { useEffect, useState, useCallback, useMemo, Fragment } from 'react';
import { Navigate } from 'react-router-dom';
import Fuse from 'fuse.js';
import { useAuth } from '../../lib/auth.js';
import { PortalShell } from '../auth/PortalShell.js';
import { ApiRequestError } from '../../lib/api.js';
import * as inv from './api.js';
import { STATE_LABEL } from './api.js';
import { Modal, ConfirmModal, CameraCapture, BarcodeScannerModal } from './shared.js';

type Tab = 'equipment' | 'articles';

export default function InventoryScreen() {
  const { user, loading } = useAuth();
  const [tab, setTab] = useState<Tab>('equipment');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (loading) return <PortalShell title="Inventory"><p /></PortalShell>;
  if (!user) return <Navigate to="/" replace />;
  if (user.role !== 'SUPER_ADMIN' && user.role !== 'COORDINATOR') return <Navigate to="/home" replace />;

  const flash: Flash = { setError, setNotice, clear: () => { setError(null); setNotice(null); } };

  return (
    <PortalShell title="Inventory" tint={user.role === 'SUPER_ADMIN' ? 'navy' : 'slate'}>
      <div style={wrap}>
        <div style={tabRow} role="tablist">
          {(['equipment', 'articles'] as Tab[]).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t}
              onClick={() => { setTab(t); flash.clear(); }}
              style={{ ...tabBtn, ...(tab === t ? tabActive : null) }}>
              {t === 'equipment' ? 'Equipment' : 'Articles'}
            </button>
          ))}
        </div>

        {error && <div style={box.err}>{error}</div>}
        {notice && <div style={box.ok}>{notice}</div>}

        {tab === 'equipment' && <EquipmentTab flash={flash} />}
        {tab === 'articles' && <ArticlesTab flash={flash} />}
      </div>
    </PortalShell>
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

  return (
    <Panel title="Equipment Types" action={<button style={primaryBtn} onClick={() => { setShowForm((v) => !v); setEditingId(null); }}>{showForm ? 'Close' : 'Add Type'}</button>}>
      <SearchInput value={search} onChange={setSearch} placeholder="Search by name or sport…" />

      {showForm && (
        <AddTypeForm cats={cats} presets={presets}
          onDone={() => { setShowForm(false); flash.setNotice('Equipment type created.'); void load(); }}
          onError={flash.setError} onCatsChanged={load} />
      )}

      {visibleTypes.length === 0 ? <p style={muted}>{types.length === 0 ? 'No equipment types yet. Add one to begin.' : 'No matches.'}</p> : (
        <table style={table}>
          <thead><tr><th style={th}></th><th style={th}>Name</th><th style={th}>Sport</th><th style={th}>Setting</th><th style={th}>Unit</th><th style={th}>Available</th><th style={th}>Status</th><th style={th} /></tr></thead>
          <tbody>
            {visibleTypes.map((t) => {
              const s = statusFor(t.equipment_type_id);
              const isEditing = editingId === t.equipment_type_id;
              return (
                <Fragment key={t.equipment_type_id}>
                  <tr>
                    <td style={td}>{t.image_url ? <img src={t.image_url} alt="" style={thumb} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} /> : <div style={thumbPlaceholder} />}</td>
                    <td style={td}>{t.name}</td>
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
                      <td colSpan={8} style={{ ...td, background: '#f7f9fb' }}>
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
      )}

      {deletingId != null && (
        <ConfirmModal title="Delete Equipment Type" danger confirmLabel="Delete"
          message="Delete this equipment type? All articles under it must be decommissioned first."
          onConfirm={confirmDelete} onCancel={() => setDeletingId(null)} />
      )}
    </Panel>
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
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5c6773" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
        </svg>
      </button>
      {open && (
        <div style={pickerDropdown}>
          <div style={{ display: 'flex', borderBottom: '1px solid #e5e5e5' }}>
            <div style={pickerCol}>
              <div style={pickerColHead}>Hr</div>
              {Array.from({ length: 24 }, (_, i) => (
                <div key={i} onClick={() => onChange(i, minutes)}
                  style={{ ...pickerCell, ...(i === hours ? pickerCellActive : {}) }}>
                  {String(i).padStart(2, '0')}
                </div>
              ))}
            </div>
            <div style={{ ...pickerCol, borderLeft: '1px solid #e5e5e5' }}>
              <div style={pickerColHead}>Min</div>
              {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map((m) => (
                <div key={m} onClick={() => onChange(hours, m)}
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
    <form onSubmit={submit} style={formGrid}>
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
          <input style={{ ...inp, background: '#f3f5f7', color: '#5c6773' }} value={lendingUnit === 'PAIR' ? 'Pair' : 'Single'} readOnly disabled />
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
          <span style={{ fontSize: 13, color: '#5c6773' }}>Image auto-assigned for {selectedPreset.name}</span>
        </div>
      )}

      <div style={{ gridColumn: '1 / -1' }}><button style={primaryBtn} disabled={busy}>{busy ? 'Saving…' : 'Create Type'}</button></div>
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
    <form onSubmit={submit} style={formGrid}>
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
        <button type="button" style={linkBtn} onClick={onCancel}>Cancel</button>
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
      <Panel title="Add Article(s)">
        <AddArticleForms types={types} onDone={(m) => { flash.setNotice(m); void load(); }} onError={flash.setError} />
      </Panel>

      <Panel title="Articles" action={
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <select style={{ ...inp, width: 'auto' }} value={filterType} onChange={(e) => setFilterType(Number(e.target.value))}>
            <option value={0}>All types</option>
            {types.map((t) => <option key={t.equipment_type_id} value={t.equipment_type_id}>{t.name}</option>)}
          </select>
          <select style={{ ...inp, width: 'auto' }} value={filterState} onChange={(e) => setFilterState(e.target.value as inv.ArticleState | '')}>
            <option value="">All states</option>
            {(['AVAILABLE', 'ON_LOAN', 'DAMAGED'] as inv.ArticleState[]).map((s) => <option key={s} value={s}>{STATE_LABEL[s]}</option>)}
          </select>
          <select style={{ ...inp, width: 'auto' }} value={filterCondition} onChange={(e) => setFilterCondition(e.target.value as inv.ConditionLabel | '')}>
            <option value="">All conditions</option>
            <option value="GOOD">Good</option><option value="WORN">Worn</option><option value="DAMAGED">Damaged</option>
          </select>
        </div>
      }>
        <SearchInput value={search} onChange={setSearch} placeholder="Search by barcode or equipment name…" />
        {rows.length === 0 ? <p style={muted}>No articles match. Add one above.</p> : (
          <table style={table}>
            <thead><tr><th style={th}>Barcode</th><th style={th}>Type</th><th style={th}>Condition</th><th style={th}>State</th><th style={th} /></tr></thead>
            <tbody>
              {rows.map((r) => r.kind === 'pair' ? (
                <tr key={r.a.pair_id}>
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
                <tr key={r.a.article_id}>
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
        )}
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
          <CameraCapture imageData={imageData} onCapture={setImageData} onClear={() => setImageData(null)} />
        </div>
        <L label="Health score (0–100)">
          <input type="number" min={0} max={100} style={inp} value={score} onChange={(e) => setScore(e.target.value)} required autoFocus />
        </L>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button type="button" style={{ ...linkBtn, padding: '8px 12px' }} onClick={onCancel}>Cancel</button>
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
      <L label="Equipment type"><select style={{ ...inp, maxWidth: 320 }} value={equipmentTypeId} onChange={(e) => setType(Number(e.target.value))} required>
        <option value={0}>Select</option>
        {types.map((t) => <option key={t.equipment_type_id} value={t.equipment_type_id}>{t.name} ({t.lending_unit === 'PAIR' ? 'Pair' : 'Single'})</option>)}
      </select></L>

      {equipmentTypeId === 0 ? null : isPair ? (
        <form onSubmit={submitPair} style={{ ...formGrid, marginTop: 10 }}>
          <p style={{ gridColumn: '1 / -1', margin: 0, fontSize: 13, color: '#5c6773' }}>
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
            <CameraCapture imageData={imageDataA} onCapture={setImageDataA} onClear={() => setImageDataA(null)} />
          </div>
          <div>
            <span style={lbl}>Photo B (optional)</span>
            <CameraCapture imageData={imageDataB} onCapture={setImageDataB} onClear={() => setImageDataB(null)} />
          </div>
          <L label="Entry score A (0–100)"><input type="number" min={0} max={100} style={inp} value={scoreA} onChange={(e) => setScoreA(e.target.value)} required /></L>
          <L label="Entry score B (0–100)"><input type="number" min={0} max={100} style={inp} value={scoreB} onChange={(e) => setScoreB(e.target.value)} required /></L>
          <div style={{ gridColumn: '1 / -1' }}><button style={primaryBtn} disabled={busy}>{busy ? 'Adding…' : 'Add Pair'}</button></div>
        </form>
      ) : (
        <form onSubmit={submitSingle} style={{ ...formGrid, marginTop: 10 }}>
          <L label="Barcode">
            <BarcodeField value={barcode} onChange={setBarcode} onScan={() => setScanningFor('single')} />
          </L>
          <L label="Entry health score (0–100)"><input type="number" min={0} max={100} style={inp} value={entryScore} onChange={(e) => setScore(e.target.value)} required /></L>
          <div style={{ gridColumn: '1 / -1' }}>
            <span style={lbl}>Photo (optional)</span>
            <CameraCapture imageData={imageData} onCapture={setImageData} onClear={() => setImageData(null)} />
          </div>
          <div style={{ gridColumn: '1 / -1' }}><button style={primaryBtn} disabled={busy}>{busy ? 'Adding…' : 'Add Article'}</button></div>
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
      <button type="button" style={{ ...secondaryBtnSm }} onClick={onScan} title="Scan with camera">📷</button>
    </div>
  );
}

// ─────────────────────────── shared UI ───────────────────────────
function Panel({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section style={panel}>
      <div style={panelHead}><span>{title}</span>{action}</div>
      <div style={panelBody}>{children}</div>
    </section>
  );
}
function L({ label, children }: { label: string; children: React.ReactNode }) {
  return <div style={{ display: 'block' }}><span style={lbl}>{label}</span>{children}</div>;
}
function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <input type="search" style={{ ...inp, marginBottom: 14 }} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
  );
}

const wrap: React.CSSProperties = { maxWidth: 900, margin: '0 auto' };
const tabRow: React.CSSProperties = { display: 'flex', gap: 4, padding: 4, background: '#e7edf4', borderRadius: 10, marginBottom: 18 };
const tabBtn: React.CSSProperties = { flex: 1, font: '500 14px var(--font-body)', padding: '9px 10px', border: 'none', background: 'transparent', color: '#5c6773', borderRadius: 7, cursor: 'pointer' };
const tabActive: React.CSSProperties = { background: '#fff', color: '#26485f', boxShadow: '0 1px 2px rgba(15,27,45,0.1)' };
const panel: React.CSSProperties = { background: '#fff', border: '1px solid #ddd', borderRadius: 4, marginBottom: 18, boxShadow: '0 1px 2px rgba(0,0,0,0.05)' };
const panelHead: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 18px', borderBottom: '1px solid #e5e5e5', font: '600 15px var(--font-body)', color: '#333', background: 'linear-gradient(#fff,#f7f7f7)' };
const panelBody: React.CSSProperties = { padding: 18 };
const table: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 14 };
const th: React.CSSProperties = { textAlign: 'left', font: '600 11px var(--font-body)', color: '#888', textTransform: 'uppercase', letterSpacing: '0.04em', padding: '0 8px 8px', borderBottom: '1px solid #e5e5e5' };
const td: React.CSSProperties = { padding: '10px 8px', borderBottom: '1px solid #eee', color: '#333' };
const muted: React.CSSProperties = { color: '#5c6773', fontSize: 14, margin: 0 };
const formGrid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, maxWidth: 560 };
const lbl: React.CSSProperties = { display: 'block', font: '500 12px var(--font-body)', color: '#26485f', marginBottom: 5 };
const inp: React.CSSProperties = { width: '100%', font: '14px var(--font-body)', padding: '8px 10px', border: '1px solid #ccc', borderRadius: 4 };
const primaryBtn: React.CSSProperties = { background: '#0a6ebd', color: '#fff', border: 'none', borderRadius: 4, padding: '8px 16px', fontSize: 14, cursor: 'pointer' };
const secondaryBtnSm: React.CSSProperties = { background: '#fff', color: '#26485f', border: '1px solid #ccc', borderRadius: 4, padding: '8px 10px', fontSize: 14, cursor: 'pointer' };
const linkBtn: React.CSSProperties = { background: 'none', border: 'none', font: '500 13px var(--font-body)', color: '#0a6ebd', cursor: 'pointer', padding: '4px 8px' };
const badgeBase: React.CSSProperties = { font: '600 11px var(--font-mono)', padding: '2px 7px', borderRadius: 4 };
const badge = {
  ok: { background: '#e6f4ec', color: '#1f7a45' } as React.CSSProperties,
  warn: { background: '#fdf1e3', color: '#9a6412' } as React.CSSProperties,
  danger: { background: '#fbe9e7', color: '#b3352b' } as React.CSSProperties,
  neutral: { background: '#eceff2', color: '#566' } as React.CSSProperties,
};
const box = {
  err: { background: '#fdecec', color: '#8f2323', border: '1px solid #f3caca', borderRadius: 4, padding: '10px 14px', marginBottom: 14, fontSize: 14 } as React.CSSProperties,
  ok: { background: '#eaf6ee', color: '#1e6b3a', border: '1px solid #c2e6cd', borderRadius: 4, padding: '10px 14px', marginBottom: 14, fontSize: 14 } as React.CSSProperties,
};
const thumb: React.CSSProperties = { width: 32, height: 32, objectFit: 'cover', borderRadius: 4, display: 'block' };
const thumbPlaceholder: React.CSSProperties = { width: 32, height: 32, borderRadius: 4, background: '#eef1f4' };
const pairChip: React.CSSProperties = { font: '600 10px var(--font-body)', padding: '1px 6px', borderRadius: 3, background: '#e7edf4', color: '#26485f', marginRight: 6, textTransform: 'uppercase', letterSpacing: '0.03em' };
const singleChip: React.CSSProperties = { font: '600 10px var(--font-body)', padding: '1px 6px', borderRadius: 3, background: '#eef1f4', color: '#5c6773', marginRight: 6, textTransform: 'uppercase', letterSpacing: '0.03em' };
const pickerDropdown: React.CSSProperties = { position: 'absolute', top: '100%', left: 0, zIndex: 100, marginTop: 4, background: '#fff', border: '1px solid #ddd', borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.12)', minWidth: 160 };
const pickerCol: React.CSSProperties = { maxHeight: 220, overflowY: 'auto', padding: 4, minWidth: 56 };
const pickerColHead: React.CSSProperties = { font: '600 10px var(--font-body)', color: '#888', textTransform: 'uppercase', textAlign: 'center', padding: '4px 0', letterSpacing: '0.04em' };
const pickerCell: React.CSSProperties = { padding: '6px 8px', textAlign: 'center', fontSize: 14, borderRadius: 6, cursor: 'pointer', color: '#333' };
const pickerCellActive: React.CSSProperties = { background: '#0a6ebd', color: '#fff', fontWeight: 600 };
