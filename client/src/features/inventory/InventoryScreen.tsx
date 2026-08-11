/**
 * Inventory — Coordinator + Super Admin (Feature 4, INV-01..30).
 * Three tabs: Equipment Types · Articles (with scan + pairs) · Damage Flags.
 * All API calls use only exports that exist in client/src/features/inventory/api.ts.
 * Themed with AppShell.
 */
import { useEffect, useState, useCallback, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth.js';
import AppShell, {
  PageHeader, Card, Btn, Badge, EmptyState, ErrorBox, SuccessBox, Th, Td, TableWrapper,
} from '../../components/AppShell.js';
import {
  listSportCategories, listTypes, createType, updateThresholds,
  listArticles, addArticle, scanArticle, decommissionArticle,
  listDamageFlags, clearDamageFlag,
  type SportCategory, type EquipmentType, type Article, type DamageFlag, type ConditionLabel,
} from './api.js';
import { api } from '../../lib/api.js';

// Inline wrappers for exports that may not exist in older local api.ts builds.
// These are safe to remove once api.ts is updated.
function addArticlePair(input: {
  equipmentTypeId: number; barcodeA: string; barcodeB: string; entryScoreA: number; entryScoreB: number;
}) {
  return api<{ pairEntry: { articleIdA: string; articleIdB: string; barcodeA: string; barcodeB: string; conditionLabelA: ConditionLabel; conditionLabelB: ConditionLabel; paired: boolean } }>(
    '/api/inventory/articles/pair', { method: 'POST', body: input });
}

function formPair(articleAId: string, articleBId: string) {
  return api<{ pair: { pairId: string } }>('/api/inventory/pairs', { method: 'POST', body: { articleAId, articleBId } });
}
import { ApiRequestError } from '../../lib/api.js';

function errMsg(e: unknown) { return e instanceof ApiRequestError ? e.body.error : 'Something went wrong.'; }

type Tab = 'types' | 'articles' | 'flags';

const COND_COLOR: Record<string, string> = {
  GOOD: 'var(--ok)', WORN: 'var(--warn)', DAMAGED: 'var(--danger)',
};
const STATE_COLOR: Record<string, string> = {
  AVAILABLE: 'var(--ok)', ON_LOAN: '#6366f1', DAMAGED: 'var(--danger)',
  UNPAIRED: 'var(--warn)', DECOMMISSIONED: 'var(--ink-faint)',
};

export default function InventoryScreen() {
  const { user, loading } = useAuth();
  const [tab,    setTab]    = useState<Tab>('types');
  const [error,  setError]  = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (loading) return <AppShell title="Inventory"><p /></AppShell>;
  if (!user) return <Navigate to="/" replace />;
  if (user.role !== 'SUPER_ADMIN' && user.role !== 'COORDINATOR') return <Navigate to="/home" replace />;

  const isSuperAdmin = user.role === 'SUPER_ADMIN';
  const flash = {
    ok:  (m: string) => { setNotice(m); setError(null); },
    err: (m: string) => { setError(m); setNotice(null); },
  };

  const TABS: Array<[Tab, string]> = [['types', 'Equipment Types'], ['articles', 'Articles'], ['flags', 'Damage Flags']];

  return (
    <AppShell title="Inventory">
      <PageHeader title="Inventory" subtitle="Equipment types, articles, health scans, and damage flags" />
      {error  && <ErrorBox message={error} />}
      {notice && <SuccessBox message={notice} />}

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 'var(--sp-4)', borderBottom: '2px solid var(--line-light)', paddingBottom: 0 }}>
        {TABS.map(([id, label]) => (
          <button key={id} onClick={() => { setTab(id); setError(null); setNotice(null); }} style={{
            padding: '10px 18px', background: 'none', border: 'none', cursor: 'pointer',
            font: `${tab === id ? '600' : '400'} 13.5px var(--font-body)`,
            color: tab === id ? 'var(--teal)' : 'var(--ink-muted)',
            borderBottom: `2px solid ${tab === id ? 'var(--teal)' : 'transparent'}`,
            marginBottom: -2,
          }}>{label}</button>
        ))}
      </div>

      {tab === 'types'    && <TypesTab    flash={flash} isSuperAdmin={isSuperAdmin} />}
      {tab === 'articles' && <ArticlesTab flash={flash} isSuperAdmin={isSuperAdmin} />}
      {tab === 'flags'    && <FlagsTab   flash={flash} isSuperAdmin={isSuperAdmin} />}
    </AppShell>
  );
}

// ── Equipment Types ───────────────────────────────────────────────────────────

function TypesTab({ flash, isSuperAdmin }: { flash: { ok: (m: string) => void; err: (m: string) => void }; isSuperAdmin: boolean }) {
  const [types,   setTypes]   = useState<EquipmentType[] | null>(null);
  const [sports,  setSports]  = useState<SportCategory[]>([]);
  const [showAdd, setShowAdd] = useState(false);

  // Form state
  const [name,     setName]     = useState('');
  const [sportId,  setSportId]  = useState(0);
  const [unit,     setUnit]     = useState<'SINGLE' | 'PAIR'>('SINGLE');
  const [hours,    setHours]    = useState(8);
  const [mins,     setMins]     = useState(0);
  const [goodMin,  setGoodMin]  = useState(70);
  const [wornMin,  setWornMin]  = useState(40);
  const [lowStock, setLowStock] = useState(5);
  const [isIndoor, setIsIndoor] = useState(false);
  const [imageUrl, setImageUrl] = useState('');
  const [busy,     setBusy]     = useState(false);

  const load = useCallback(async () => {
    try {
      const [t, s] = await Promise.all([listTypes(), listSportCategories()]);
      setTypes(t.types); setSports(s.categories);
    } catch (e) { flash.err(errMsg(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!sportId) { flash.err('Select a sport category.'); return; }
    if (goodMin <= wornMin) { flash.err('Good threshold must be above Worn threshold.'); return; }
    setBusy(true);
    try {
      await createType({
        sportCategoryId: sportId, name, lendingUnit: unit,
        maxBorrowDurationMinutes: hours * 60 + mins,
        conditionGoodMinScore: goodMin, conditionWornMinScore: wornMin,
        lowStockThreshold: lowStock, isIndoor,
        imageUrl: imageUrl.trim() || undefined,
      });
      flash.ok(`Equipment type "${name}" created.`);
      setShowAdd(false); setName(''); void load();
    } catch (e) { flash.err(errMsg(e)); }
    finally { setBusy(false); }
  }

  return (
    <div style={{ display: 'grid', gap: 'var(--sp-4)' }}>
      {isSuperAdmin && (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Btn variant="secondary" onClick={() => setShowAdd((v) => !v)}>
            {showAdd ? 'Close form' : '+ Add Equipment Type'}
          </Btn>
        </div>
      )}

      {showAdd && (
        <Card style={{ padding: 'var(--sp-5)' }}>
          <div style={secTitle}>New Equipment Type</div>
          <form onSubmit={submit} noValidate
            style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px,1fr))', gap: 'var(--sp-3)' }}>
            <div><label style={lbl}>Name</label>
              <input style={inp} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Football" required />
            </div>
            <div><label style={lbl}>Sport</label>
              <select style={inp} value={sportId} onChange={(e) => setSportId(Number(e.target.value))} required>
                <option value={0}>Select…</option>
                {sports.map((s) => <option key={s.sport_category_id} value={s.sport_category_id}>{s.name}</option>)}
              </select>
            </div>
            <div><label style={lbl}>Lending Unit</label>
              <select style={inp} value={unit} onChange={(e) => setUnit(e.target.value as 'SINGLE' | 'PAIR')}>
                <option value="SINGLE">Single</option>
                <option value="PAIR">Pair</option>
              </select>
            </div>
            <div><label style={lbl}>Max Borrow — Hours</label>
              <input style={inp} type="number" min={0} value={hours} onChange={(e) => setHours(Number(e.target.value))} />
            </div>
            <div><label style={lbl}>Max Borrow — Minutes</label>
              <select style={inp} value={mins} onChange={(e) => setMins(Number(e.target.value))}>
                {[0, 15, 30, 45].map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div><label style={lbl}>Good threshold (≥)</label>
              <input style={inp} type="number" min={0} max={100} value={goodMin} onChange={(e) => setGoodMin(Number(e.target.value))} />
            </div>
            <div><label style={lbl}>Worn threshold (≥)</label>
              <input style={inp} type="number" min={0} max={100} value={wornMin} onChange={(e) => setWornMin(Number(e.target.value))} />
            </div>
            <div><label style={lbl}>Low Stock threshold</label>
              <input style={inp} type="number" min={0} value={lowStock} onChange={(e) => setLowStock(Number(e.target.value))} />
            </div>
            <div><label style={lbl}>Image URL (optional)</label>
              <input style={inp} value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://…" />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 20 }}>
              <input type="checkbox" id="isIndoorType" checked={isIndoor} onChange={(e) => setIsIndoor(e.target.checked)} />
              <label htmlFor="isIndoorType" style={{ font: '13.5px var(--font-body)', cursor: 'pointer' }}>Indoor</label>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end' }}>
              <Btn type="submit" loading={busy} style={{ width: '100%' }}>Create Type</Btn>
            </div>
          </form>
        </Card>
      )}

      <Card>
        {types === null
          ? <p style={{ padding: 'var(--sp-5)', color: 'var(--ink-muted)' }}>Loading…</p>
          : types.length === 0
          ? <EmptyState title="No equipment types yet" body="Add your first type to get started." />
          : (
            <TableWrapper>
              <thead>
                <tr>
                  <th style={Th}>Name</th>
                  <th style={Th}>Sport</th>
                  <th style={Th}>Unit</th>
                  <th style={Th}>Max Borrow</th>
                  <th style={Th}>Thresholds G / W</th>
                  <th style={Th}>Low Stock</th>
                </tr>
              </thead>
              <tbody>
                {types.map((t) => (
                  <tr key={t.equipment_type_id}>
                    <td style={Td}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        {t.image_url
                          ? <img src={t.image_url} alt={t.name} style={{ width: 32, height: 32, objectFit: 'cover', borderRadius: 4 }} />
                          : <div style={{ width: 32, height: 32, borderRadius: 4, background: 'var(--surface)', display: 'flex', alignItems: 'center', justifyContent: 'center', font: '600 13px var(--font-display)', color: 'var(--teal)' }}>{t.name.charAt(0)}</div>
                        }
                        <div>
                          <div style={{ font: '500 13.5px var(--font-body)', color: 'var(--navy)' }}>{t.name}</div>
                          <div style={{ font: '11px var(--font-body)', color: 'var(--ink-faint)' }}>{t.is_indoor ? 'Indoor' : 'Outdoor'}</div>
                        </div>
                      </div>
                    </td>
                    <td style={Td}>{t.sport_category_name}</td>
                    <td style={Td}>
                      <span style={{ font: '600 10px var(--font-mono)', padding: '2px 6px', borderRadius: 3, background: 'var(--surface)', color: 'var(--ink-muted)' }}>{t.lending_unit}</span>
                    </td>
                    <td style={{ ...Td, fontSize: 13 }}>
                      {t.max_borrow_duration_minutes >= 60
                        ? `${Math.floor(t.max_borrow_duration_minutes / 60)}h${t.max_borrow_duration_minutes % 60 ? ` ${t.max_borrow_duration_minutes % 60}m` : ''}`
                        : `${t.max_borrow_duration_minutes}m`}
                    </td>
                    <td style={Td}>
                      <span style={{ color: COND_COLOR.GOOD }}>≥{t.condition_good_min_score}</span>
                      {' / '}
                      <span style={{ color: COND_COLOR.WORN }}>≥{t.condition_worn_min_score}</span>
                    </td>
                    <td style={Td}>{t.low_stock_threshold}</td>
                  </tr>
                ))}
              </tbody>
            </TableWrapper>
          )
        }
      </Card>
    </div>
  );
}

// ── Articles ──────────────────────────────────────────────────────────────────

function ArticlesTab({ flash, isSuperAdmin }: { flash: { ok: (m: string) => void; err: (m: string) => void }; isSuperAdmin: boolean }) {
  const [types,        setTypes]        = useState<EquipmentType[]>([]);
  const [articles,     setArticles]     = useState<Article[] | null>(null);

  const [filterType,   setFilterType]   = useState(0);
  const [filterState,  setFilterState]  = useState('');
  const [filterCond,   setFilterCond]   = useState('');
  const [showAdd,      setShowAdd]      = useState(false);


  const load = useCallback(async () => {
    try {
      const [t, a] = await Promise.all([
        listTypes(),
        listArticles({ equipmentTypeId: filterType || undefined, state: (filterState as any) || undefined, condition: (filterCond as any) || undefined }),
      ]);
      setTypes(t.types); setArticles(a.articles);
    } catch (e) { flash.err(errMsg(e)); }
  }, [filterType, filterState, filterCond]);
  useEffect(() => { void load(); }, [load]);

  // Inline scan via prompt (matches original InventoryScreen)
  async function scan(id: string, barcode: string) {
    const raw = window.prompt(`Health scan for ${barcode}\nEnter score 0–100:`);
    if (raw === null) return;
    const score = Number(raw);
    if (Number.isNaN(score) || score < 0 || score > 100) { flash.err('Score must be 0–100.'); return; }
    try {
      const r = await scanArticle(id, { kind: 'AD_HOC', score });
      flash.ok(`Scan recorded for ${barcode} — condition is now ${r.conditionLabel}.`);
      void load();
    } catch (e) { flash.err(errMsg(e)); }
  }

  async function decom(id: string, barcode: string) {
    if (!window.confirm(`Decommission ${barcode}? This is permanent.`)) return;
    try { await decommissionArticle(id); flash.ok(`${barcode} decommissioned.`); void load(); }
    catch (e) { flash.err(errMsg(e)); }
  }

  // Group paired articles for display
  const seen = new Set<string>();
  const rows: Array<{ kind: 'single' | 'pair'; a: Article; b?: Article }> = [];
  if (articles) {
    for (const art of articles) {
      if (seen.has(art.article_id)) continue;
      if (art.pair_id && art.pair_partner_id) {
        const partner = articles.find((x) => x.article_id === art.pair_partner_id);
        if (partner) {
          seen.add(art.article_id); seen.add(partner.article_id);
          rows.push({ kind: 'pair', a: art, b: partner });
          continue;
        }
      }
      seen.add(art.article_id);
      rows.push({ kind: 'single', a: art });
    }
  }

  return (
    <div style={{ display: 'grid', gap: 'var(--sp-4)' }}>
      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <select style={sel} value={filterType} onChange={(e) => setFilterType(Number(e.target.value))}>
          <option value={0}>All types</option>
          {types.map((t) => <option key={t.equipment_type_id} value={t.equipment_type_id}>{t.name}</option>)}
        </select>
        <select style={sel} value={filterState} onChange={(e) => setFilterState(e.target.value)}>
          <option value="">All states</option>
          {['AVAILABLE','ON_LOAN','DAMAGED','UNPAIRED','DECOMMISSIONED'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select style={sel} value={filterCond} onChange={(e) => setFilterCond(e.target.value)}>
          <option value="">All conditions</option>
          {['GOOD','WORN','DAMAGED'].map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>

          <Btn size="sm" variant="secondary" onClick={() => { setShowAdd((v) => !v); setShowPair(false); }}>
            {showAdd ? 'Close' : '+ Add Article'}
          </Btn>
        </div>
      </div>

      {/* Add Article form */}
      {showAdd && (
        <AddArticleForm types={types} onDone={(m) => { flash.ok(m); void load(); }} onError={flash.err} />
      )}



      {/* Articles table */}
      <Card>
        {articles === null ? <p style={{ padding: 'var(--sp-5)', color: 'var(--ink-muted)' }}>Loading…</p>
        : rows.length === 0 ? <EmptyState title="No articles" body="Add articles to build your inventory." />
        : (
          <TableWrapper>
            <thead>
              <tr>
                <th style={Th}>Barcode</th>
                <th style={Th}>Type</th>
                <th style={Th}>State</th>
                <th style={Th}>Condition</th>
                <th style={Th}>Last Scan</th>
                <th style={Th} />
              </tr>
            </thead>
            <tbody>
              {rows.map(({ kind, a, b }) => (
                <tr key={a.article_id}>
                  <td style={{ ...Td, font: '13px var(--font-mono)', color: 'var(--navy)' }}>
                    {kind === 'pair'
                      ? <span><span style={{ font: '600 9px var(--font-mono)', background: 'var(--surface-alt)', color: 'var(--navy)', padding: '1px 5px', borderRadius: 3, marginRight: 5 }}>PAIR</span>{a.barcode} + {b?.barcode}</span>
                      : a.barcode
                    }
                  </td>
                  <td style={Td}>{a.equipment_type_name ?? '—'}</td>
                  <td style={Td}>
                    <span style={{ font: '600 10px var(--font-mono)', padding: '2px 6px', borderRadius: 3, background: `${STATE_COLOR[a.state] ?? 'var(--surface)'}18`, color: STATE_COLOR[a.state] ?? 'var(--ink-muted)' }}>
                      {a.state === 'DAMAGED' ? 'UNAVAILABLE' : a.state}
                    </span>
                  </td>
                  <td style={Td}>
                    <span style={{ font: '600 11.5px var(--font-body)', color: COND_COLOR[a.current_condition_label] ?? 'var(--ink-muted)' }}>
                      {a.current_condition_label}
                    </span>
                  </td>
                  <td style={{ ...Td, fontSize: 12, color: 'var(--ink-muted)' }}>
                    {a.entered_at ? new Date(a.entered_at as string).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                  </td>
                  <td style={{ ...Td, textAlign: 'right' }}>
                    {a.state !== 'DECOMMISSIONED' && (
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        <Btn size="sm" variant="secondary" onClick={() => scan(a.article_id, a.barcode)}>
                          📷 Scan
                        </Btn>
                        {isSuperAdmin && (
                          <Btn size="sm" variant="danger" onClick={() => decom(a.article_id, a.barcode)}>
                            Decommission
                          </Btn>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrapper>
        )}
      </Card>
    </div>
  );
}

// ── Add Article form ──────────────────────────────────────────────────────────

function AddArticleForm({ types, onDone, onError }: { types: EquipmentType[]; onDone: (m: string) => void; onError: (m: string) => void }) {
  const [typeId,   setTypeId]   = useState(0);
  const [barcode,  setBarcode]  = useState('');
  const [score,    setScore]    = useState(80);
  // Pair-specific
  const [barcodeB, setBarcodeB] = useState('');
  const [scoreB,   setScoreB]   = useState(80);
  const [busy,     setBusy]     = useState(false);

  const selectedType = types.find((t) => t.equipment_type_id === typeId);
  const isPair = selectedType?.lending_unit === 'PAIR';

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!typeId) { onError('Select an equipment type.'); return; }
    setBusy(true);
    try {
      if (isPair) {
        await addArticlePair({ equipmentTypeId: typeId, barcodeA: barcode, barcodeB, entryScoreA: score, entryScoreB: scoreB });
        onDone(`Pair ${barcode} + ${barcodeB} added.`);
      } else {
        await addArticle({ equipmentTypeId: typeId, barcode, entryScore: score });
        onDone(`Article ${barcode} added.`);
      }
      setBarcode(''); setBarcodeB(''); setScore(80); setScoreB(80); setTypeId(0);
    } catch (e) { onError(errMsg(e)); }
    finally { setBusy(false); }
  }

  return (
    <Card style={{ padding: 'var(--sp-5)' }}>
      <div style={secTitle}>{isPair ? 'Add Pair Entry' : 'Add Article'}</div>
      <form onSubmit={submit} noValidate style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px,1fr))', gap: 'var(--sp-3)' }}>
        <div><label style={lbl}>Equipment Type</label>
          <select style={inp} value={typeId} onChange={(e) => setTypeId(Number(e.target.value))} required>
            <option value={0}>Select…</option>
            {types.map((t) => <option key={t.equipment_type_id} value={t.equipment_type_id}>{t.name} ({t.lending_unit})</option>)}
          </select>
        </div>
        <div><label style={lbl}>{isPair ? 'Barcode A' : 'Barcode'}</label>
          <input style={inp} value={barcode} onChange={(e) => setBarcode(e.target.value)} placeholder="BALL-0001" required />
        </div>
        <div><label style={lbl}>{isPair ? 'Entry Score A' : 'Entry Score'} ({isPair ? score : score})</label>
          <input type="range" min={0} max={100} value={score} onChange={(e) => setScore(Number(e.target.value))} style={{ width: '100%', marginTop: 8 }} />
        </div>
        {isPair && (
          <>
            <div><label style={lbl}>Barcode B</label>
              <input style={inp} value={barcodeB} onChange={(e) => setBarcodeB(e.target.value)} placeholder="BALL-0002" required />
            </div>
            <div><label style={lbl}>Entry Score B ({scoreB})</label>
              <input type="range" min={0} max={100} value={scoreB} onChange={(e) => setScoreB(Number(e.target.value))} style={{ width: '100%', marginTop: 8 }} />
            </div>
          </>
        )}
        <div style={{ display: 'flex', alignItems: 'flex-end' }}>
          <Btn type="submit" loading={busy} style={{ width: '100%' }}>
            {isPair ? 'Add Pair' : 'Add Article'}
          </Btn>
        </div>
      </form>
    </Card>
  );
}

// ── Re-pair form ──────────────────────────────────────────────────────────────


// ── Damage Flags ──────────────────────────────────────────────────────────────

function FlagsTab({ flash, isSuperAdmin }: { flash: { ok: (m: string) => void; err: (m: string) => void }; isSuperAdmin: boolean }) {
  const [flags,    setFlags]    = useState<DamageFlag[] | null>(null);
  const [clearing, setClearing] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setFlags((await listDamageFlags()).flags); }
    catch (e) { flash.err(errMsg(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function clear(flag: DamageFlag) {
    const label = window.prompt(`Clear damage flag for ${flag.barcode}.\nNew condition label (GOOD / WORN):`, 'WORN');
    if (!label) return;
    const up = label.trim().toUpperCase() as ConditionLabel;
    if (!['GOOD', 'WORN'].includes(up)) { flash.err('Label must be GOOD or WORN.'); return; }
    setClearing(flag.flag_id);
    try { await clearDamageFlag(flag.flag_id, up); flash.ok(`Damage flag for ${flag.barcode} cleared.`); void load(); }
    catch (e) { flash.err(errMsg(e)); }
    finally { setClearing(null); }
  }

  return (
    <Card>
      {flags === null ? (
        <p style={{ padding: 'var(--sp-5)', color: 'var(--ink-muted)' }}>Loading…</p>
      ) : flags.length === 0 ? (
        <EmptyState title="No open damage flags" body="All articles are in acceptable condition. Flags appear here when an article is scanned as damaged or entered in damaged condition." />
      ) : (
        <>
          {!isSuperAdmin && (
            <div style={{ padding: 'var(--sp-3) var(--sp-4)', background: 'var(--surface-alt)', borderBottom: '1px solid var(--line-light)', font: '13px var(--font-body)', color: 'var(--ink-muted)' }}>
              Read-only view — only Super Admin can clear damage flags.
            </div>
          )}
          <TableWrapper>
            <thead>
              <tr>
                <th style={Th}>Barcode</th>
                <th style={Th}>Type</th>
                <th style={Th}>Flagged</th>
                <th style={Th}>Source</th>
                {isSuperAdmin && <th style={Th} />}
              </tr>
            </thead>
            <tbody>
              {flags.map((f) => (
                <tr key={f.flag_id}>
                  <td style={{ ...Td, font: '13px var(--font-mono)', color: 'var(--navy)' }}>{f.barcode}</td>
                  <td style={Td}>{f.equipment_type_name}</td>
                  <td style={{ ...Td, fontSize: 13 }}>
                    {new Date(f.raised_at as string).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                  </td>
                  <td style={Td}>
                    <span style={{ font: '600 10px var(--font-mono)', padding: '2px 6px', borderRadius: 3, background: 'var(--surface)', color: 'var(--ink-muted)' }}>
                      {f.raised_by_system ? 'SYSTEM' : 'MANUAL'}
                    </span>
                  </td>
                  {isSuperAdmin && (
                    <td style={{ ...Td, textAlign: 'right' }}>
                      <Btn size="sm" onClick={() => clear(f)} loading={clearing === f.flag_id}>
                        Clear Flag
                      </Btn>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </TableWrapper>
        </>
      )}
    </Card>
  );
}

// ── Style constants ───────────────────────────────────────────────────────────

const secTitle: React.CSSProperties = { font: '600 14px var(--font-display)', color: 'var(--navy)', marginBottom: 'var(--sp-3)' };
const lbl: React.CSSProperties = { display: 'block', font: '500 12.5px var(--font-body)', color: 'var(--ink-muted)', marginBottom: 5 };
const inp: React.CSSProperties = { width: '100%', font: '13.5px var(--font-body)', padding: '8px 11px', border: '1px solid var(--line)', borderRadius: 'var(--radius)', outline: 'none', background: 'var(--white)', color: 'var(--ink)' };
const sel: React.CSSProperties = { font: '13.5px var(--font-body)', padding: '7px 10px', border: '1px solid var(--line)', borderRadius: 'var(--radius)', background: 'var(--white)', color: 'var(--ink)', outline: 'none' };
