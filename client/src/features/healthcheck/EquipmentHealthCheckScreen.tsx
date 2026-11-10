/**
 * Coordinator — Equipment Health Check (computer vision).
 *
 * The coordinator picks an equipment type (Basketball / Football /
 * Volleyball), the exact item (barcode), uploads or captures 1–4 photos, and the
 * CV service returns a 0–100 health score, a Good/Fair/Poor/Replace label, the
 * anomaly % of the item's surface and a heatmap of where the damage is. The
 * result is saved against that item (health_check_scan + cv_health_assessment)
 * and listed in Scan History.
 *
 * Layout follows the supplied design; colours, type and card treatment use the
 * BUKC tokens (navy #0F172B, accent #1C398E, slate scale, Inter). Inside the
 * signed-in sidebar layout the page's own top bar is hidden (<HideInAppShell>)
 * because the sidebar already shows the logo and the signed-in user.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent } from 'react';
import { useAuth } from '../../lib/auth.js';
import { ApiRequestError } from '../../lib/api.js';
import { HideInAppShell } from '../../components/AppShellContext.js';
import {
  createScan, getCvStatus, getScan, listCandidateArticles, listScans, photoToDataUrl,
  type CandidateArticle, type CvLabel, type CvStatus, type EquipmentKind, type ScanDetail, type ScanSummary,
} from './api.js';

/* ---------- theme (BUKC tokens) ---------- */
const P = {
  navy900: '#0F172B', navy800: '#132357', accent: '#1C398E', accentHover: '#18317A', accentSoft: '#EAF0FD',
  slate600: '#45556C', slate500: '#62748E', slate400: '#90A1B9', slate300: '#CAD5E2', slate200: '#E2E8F0',
  slate100: '#EEF2F8', slate50: '#F8FAFC', white: '#FFFFFF',
};
const LABEL_STYLE: Record<CvLabel, { text: string; color: string; soft: string; track: string }> = {
  GOOD: { text: 'Good', color: '#16A34A', soft: '#DCFCE7', track: '#D1F2DC' },
  FAIR: { text: 'Fair', color: '#E39A0B', soft: '#FEF3C7', track: '#FBE7B5' },
  POOR: { text: 'Poor', color: '#E5484D', soft: '#FEE2E2', track: '#FBD3D4' },
  REPLACE: { text: 'Replace', color: '#9F1239', soft: '#FFE4E6', track: '#F9CDD5' },
};
const ADVICE: Record<CvLabel, string> = {
  GOOD: 'The equipment is in good condition and has plenty of usable life left.',
  FAIR: 'Visible wear was found. The item is usable — keep an eye on the highlighted areas.',
  POOR: 'Clear damage was found. Inspect the item by hand before lending it again.',
  REPLACE: 'Severe damage was found. Take the item out of use and plan a replacement.',
};
const KINDS: Array<{ kind: EquipmentKind; label: string; img: string; cvKey: string }> = [
  { kind: 'BASKETBALL', label: 'Basketball', img: '/equipment/basketball.png', cvKey: 'basketball' },
  { kind: 'FOOTBALL', label: 'Football', img: '/equipment/football.png', cvKey: 'football' },
  { kind: 'VOLLEYBALL', label: 'Volleyball', img: '/equipment/volleyball.png', cvKey: 'volleyball' },
];
const ERROR_TIPS: Record<string, string> = {
  BLURRY_IMAGE: 'Hold the phone steady, tap the item to focus, and retake the photo.',
  TOO_DARK: 'Move to a brighter spot (near a window or under the room lights). Do not use flash.',
  NO_OBJECT_DETECTED: 'Place the whole item in the middle of a plain sheet, with nothing else in the frame.',
  WRONG_EQUIPMENT_TYPE: 'Check that the selected equipment type and item match the photo.',
  CV_SERVICE_UNAVAILABLE: 'The health-check service is offline. Start it (see the README) and try again.',
  MODEL_NOT_READY: 'Reference photos for this equipment have not been processed yet (build_bank).',
  IMAGE_TOO_LARGE: 'Use fewer or smaller photos.',
};
const MAX_PHOTOS = 4;
const MAX_FILE_MB = 10;

interface Photo { id: number; dataUrl: string; name: string }

function errInfo(e: unknown): { message: string; code?: string } {
  if (e instanceof ApiRequestError) return { message: e.body.error, code: e.body.code };
  return { message: e instanceof Error ? e.message : 'Something went wrong.' };
}
function fmtDate(iso: string) {
  const d = new Date(iso);
  const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  return `${date} • ${time}`;
}
function initials(name: string) {
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] ?? '') + (p.length > 1 ? p[p.length - 1]![0] : '')).toUpperCase();
}

export default function EquipmentHealthCheckScreen() {
  const { user } = useAuth();

  const [kind, setKind] = useState<EquipmentKind>('BASKETBALL');
  const [articles, setArticles] = useState<CandidateArticle[]>([]);
  const [articlesLoading, setArticlesLoading] = useState(false);
  const [articleId, setArticleId] = useState('');
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [scheduled, setScheduled] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);
  const [cv, setCv] = useState<CvStatus | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);

  const [result, setResult] = useState<ScanDetail | null>(null);
  const [resultIsNew, setResultIsNew] = useState(false);
  const [viewIndex, setViewIndex] = useState(0);
  const [showPhoto, setShowPhoto] = useState(false);

  const [history, setHistory] = useState<ScanSummary[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(true);

  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const nextId = useRef(1);

  // ── loading ──
  const loadHistory = useCallback(async (all: boolean, offset = 0) => {
    setHistoryLoading(true);
    try {
      const r = await listScans(all ? 20 : 4, offset);
      setHistory((h) => (offset === 0 ? r.scans : [...h, ...r.scans]));
      setHistoryTotal(r.total);
      return r.scans;
    } catch { return []; } finally { setHistoryLoading(false); }
  }, []);

  useEffect(() => {
    getCvStatus().then(setCv).catch(() => setCv({ online: false }));
    // Show the most recent scan in the result card until a new one is run.
    loadHistory(false).then((scans) => {
      if (scans[0]) getScan(scans[0].scanId).then((r) => { setResult(r.scan); setViewIndex(worstIndex(r.scan)); }).catch(() => {});
    });
  }, [loadHistory]);

  useEffect(() => {
    let alive = true;
    setArticlesLoading(true);
    listCandidateArticles(kind)
      .then((r) => {
        if (!alive) return;
        setArticles(r.articles);
        setArticleId(r.articles[0]?.articleId ?? '');
      })
      .catch((e) => alive && setError(errInfo(e)))
      .finally(() => alive && setArticlesLoading(false));
    return () => { alive = false; };
  }, [kind]);

  // ── photos ──
  async function addFiles(files: FileList | File[]) {
    setError(null);
    const list = Array.from(files);
    const room = MAX_PHOTOS - photos.length;
    if (room <= 0) { setError({ message: `You can add up to ${MAX_PHOTOS} photos (angles) of one item.` }); return; }
    const added: Photo[] = [];
    for (const f of list.slice(0, room)) {
      if (!/^image\/(jpeg|png)$/.test(f.type)) { setError({ message: `${f.name}: only JPG and PNG photos are supported.` }); continue; }
      if (f.size > MAX_FILE_MB * 1024 * 1024) { setError({ message: `${f.name} is larger than ${MAX_FILE_MB} MB.` }); continue; }
      try { added.push({ id: nextId.current++, dataUrl: await photoToDataUrl(f), name: f.name }); }
      catch (e) { setError(errInfo(e)); }
    }
    if (list.length > room) setError({ message: `Only ${MAX_PHOTOS} photos per item — extra photos were not added.` });
    setPhotos((p) => [...p, ...added]);
  }
  function onDrop(e: DragEvent) {
    e.preventDefault(); setDragOver(false);
    if (e.dataTransfer.files?.length) void addFiles(e.dataTransfer.files);
  }
  function openCamera() {
    // Live camera when the browser allows it (HTTPS or localhost); otherwise the
    // phone's own camera app via <input capture>.
    if (typeof navigator.mediaDevices?.getUserMedia === 'function') setCameraOpen(true);
    else cameraInput.current?.click();
  }

  // ── run ──
  async function start() {
    setError(null);
    if (!articleId) { setError({ message: 'Choose the item (barcode) you are checking.' }); return; }
    if (photos.length === 0) { setError({ message: 'Add at least one photo of the item.' }); return; }
    setBusy(true);
    try {
      const r = await createScan({ equipmentKind: kind, articleId, scanKind: scheduled ? 'SCHEDULED' : 'AD_HOC', images: photos.map((p) => p.dataUrl) });
      setResult(r.scan); setResultIsNew(true); setViewIndex(worstIndex(r.scan)); setShowPhoto(false);
      setPhotos([]);
      void loadHistory(showAll);
      listCandidateArticles(kind).then((x) => setArticles(x.articles)).catch(() => {});
      resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) {
      setError(errInfo(e));
    } finally {
      setBusy(false);
    }
  }

  async function viewScan(id: string) {
    try {
      const r = await getScan(id);
      setResult(r.scan); setResultIsNew(false); setViewIndex(worstIndex(r.scan)); setShowPhoto(false);
      resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) { setError(errInfo(e)); }
  }

  const kindReady = (k: string) => cv?.online && cv.equipment_types?.[k]?.ready;
  const selectedKind = KINDS.find((k) => k.kind === kind)!;

  return (
    <div className="ehc-page">
      <Styles />
      {/* navy glow blobs — same as Inventory / Messages; clipped by their own layer */}
      <div className="ehc-blobs" aria-hidden>
        <div className="ehc-blob ehc-blob-a" />
        <div className="ehc-blob ehc-blob-b" />
      </div>

      <HideInAppShell>
        <header className="ehc-topbar">
          <div className="ehc-brand">
            <img src="/landing/bu_logo.png" alt="Bahria University" />
            <div><strong>Bahria University</strong><span>Sports Management Portal</span></div>
          </div>
          <div className="ehc-user">
            <span className="ehc-bell" aria-hidden><BellIcon /></span>
            <span className="ehc-avatar" aria-hidden>{user ? initials(user.fullName) : ''}</span>
            <div><strong>{user?.fullName}</strong><span>Coordinator</span></div>
          </div>
        </header>
      </HideInAppShell>

      <main className="ehc-wrap">
        <div className="ehc-glass">
        <div className="ehc-hero">
          <span className="ehc-eyebrow"><ShieldSmallIcon /> Coordinator</span>
          <h1>Equipment Health Check</h1>
          <p>Upload a photo of equipment to detect any damage and get a health score.</p>
        </div>

        {cv && !cv.online && (
          <div className="ehc-banner" role="status">
            <InfoIcon /> The health-check service is offline. Results cannot be produced until it is started.
          </div>
        )}

        <div className="ehc-grid">
          {/* ───────── left: scan form ───────── */}
          <section className="ehc-card" aria-labelledby="ehc-scan-h">
            <h2 id="ehc-scan-h" className="ehc-card-head"><span className="ehc-head-icon"><CameraIcon /></span>Scan Equipment</h2>

            <div className="ehc-field-label">Select Equipment Type</div>
            <div className="ehc-types" role="radiogroup" aria-label="Equipment type">
              {KINDS.map((k) => (
                <button key={k.kind} type="button" role="radio" aria-checked={kind === k.kind}
                  className={`ehc-type${kind === k.kind ? ' is-on' : ''}`} onClick={() => { setKind(k.kind); setError(null); }}>
                  <img src={k.img} alt="" />
                  <span>{k.label}</span>
                  {cv?.online && !kindReady(k.cvKey) && <em title="Reference bank not built yet">not ready</em>}
                </button>
              ))}
            </div>

            <label className="ehc-field-label" htmlFor="ehc-item">Select Item</label>
            <select id="ehc-item" className="ehc-select" value={articleId} onChange={(e) => setArticleId(e.target.value)}
              disabled={articlesLoading || articles.length === 0}>
              {articlesLoading && <option>Loading items…</option>}
              {!articlesLoading && articles.length === 0 && <option value="">No {selectedKind.label} items in inventory</option>}
              {articles.map((a) => (
                <option key={a.articleId} value={a.articleId}>
                  {a.barcode} · {a.conditionLabel.charAt(0) + a.conditionLabel.slice(1).toLowerCase()}
                  {a.lastScore !== null ? ` · last scan ${a.lastScore}/100` : ' · not scanned yet'}
                </option>
              ))}
            </select>

            <div
              className={`ehc-drop${dragOver ? ' is-over' : ''}${photos.length ? ' has-photos' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
            >
              {photos.length === 0 ? (
                <button type="button" className="ehc-drop-btn" onClick={() => fileInput.current?.click()}>
                  <UploadCloudIcon />
                  <strong>Upload a Photo</strong>
                  <span>Drag and drop an image here, or click to browse</span>
                  <small>Supports: JPG, PNG • Max size: {MAX_FILE_MB}MB • Up to {MAX_PHOTOS} angles</small>
                </button>
              ) : (
                <div className="ehc-thumbs">
                  {photos.map((p, i) => (
                    <figure key={p.id} className="ehc-thumb">
                      <img src={p.dataUrl} alt={`Angle ${i + 1}`} />
                      <figcaption>Angle {i + 1}</figcaption>
                      <button type="button" aria-label={`Remove angle ${i + 1}`} onClick={() => setPhotos((x) => x.filter((y) => y.id !== p.id))}>×</button>
                    </figure>
                  ))}
                  {photos.length < MAX_PHOTOS && (
                    <button type="button" className="ehc-thumb ehc-thumb-add" onClick={() => fileInput.current?.click()}>
                      <span>+</span>Add angle
                    </button>
                  )}
                </div>
              )}
              <input ref={fileInput} type="file" accept="image/jpeg,image/png" multiple hidden
                onChange={(e) => { if (e.target.files) void addFiles(e.target.files); e.target.value = ''; }} />
              <input ref={cameraInput} type="file" accept="image/jpeg,image/png" capture="environment" hidden
                onChange={(e) => { if (e.target.files) void addFiles(e.target.files); e.target.value = ''; }} />
            </div>

            <div className="ehc-or"><span>OR</span></div>
            <button type="button" className="ehc-camera-btn" onClick={openCamera} disabled={photos.length >= MAX_PHOTOS}>
              <CameraIcon /> Capture with Camera
            </button>

            <div className="ehc-guide">
              <div className="ehc-guide-head"><InfoIcon /> Photo Guidelines</div>
              <ul>
                <li><CheckIcon /> Use a clear, well-lit photo on a plain background</li>
                <li><CheckIcon /> Capture the full item — add up to 4 angles for a fuller check</li>
                <li><CheckIcon /> Avoid blurry or dark images</li>
              </ul>
            </div>

            <label className="ehc-check">
              <input type="checkbox" checked={scheduled} onChange={(e) => setScheduled(e.target.checked)} />
              Count this as the item's scheduled weekly health check
            </label>

            {error && (
              <div className="ehc-error" role="alert">
                <strong>{error.message}</strong>
                {error.code && ERROR_TIPS[error.code] && <span>{ERROR_TIPS[error.code]}</span>}
              </div>
            )}

            <button type="button" className="ehc-primary" onClick={start} disabled={busy}>
              {busy ? <><span className="ehc-spinner" aria-hidden /> Analysing {photos.length > 1 ? `${photos.length} photos` : 'photo'}…</> : <><ScanIcon /> Start Health Check</>}
            </button>
          </section>

          {/* ───────── right: result + history ───────── */}
          <div className="ehc-right">
            <section className="ehc-card" ref={resultRef} aria-labelledby="ehc-result-h">
              <h2 id="ehc-result-h" className="ehc-card-head">
                <span className="ehc-head-icon ehc-head-plain"><PulseIcon /></span>Scan Result
                {result && !resultIsNew && <span className="ehc-chip">Saved scan</span>}
                {result && resultIsNew && <span className="ehc-chip ehc-chip-new">Just scanned · saved</span>}
              </h2>
              {!result ? (
                <div className="ehc-empty">
                  <PulseIcon />
                  <p>No scans yet. Choose an item, add a photo and press <strong>Start Health Check</strong>.</p>
                </div>
              ) : (
                <ResultBody result={result} viewIndex={viewIndex} setViewIndex={setViewIndex}
                  showPhoto={showPhoto} setShowPhoto={setShowPhoto} />
              )}
            </section>

            <section className="ehc-card" aria-labelledby="ehc-hist-h">
              <div className="ehc-hist-head">
                <h2 id="ehc-hist-h" className="ehc-card-head"><span className="ehc-head-icon ehc-head-plain"><HistoryIcon /></span>Scan History</h2>
                {historyTotal > 4 && (
                  <button type="button" className="ehc-link" onClick={() => { const n = !showAll; setShowAll(n); void loadHistory(n); }}>
                    {showAll ? 'Show Less' : 'View All'} <ArrowRightIcon />
                  </button>
                )}
              </div>
              <div className="ehc-table-wrap">
                <table className="ehc-table">
                  <thead>
                    <tr><th>Date &amp; Time</th><th>Equipment</th><th>Health Score</th><th>Status</th><th>Action</th></tr>
                  </thead>
                  <tbody>
                    {history.map((s) => {
                      const st = LABEL_STYLE[s.cvLabel];
                      return (
                        <tr key={s.scanId} className={result?.scanId === s.scanId ? 'is-current' : ''}>
                          <td>{fmtDate(s.scannedAt)}</td>
                          <td>{s.equipmentTypeName}<small>{s.barcode}</small></td>
                          <td>{Math.round(s.healthScore)} / 100</td>
                          <td><span className="ehc-status" style={{ color: st.color }}><i style={{ background: st.color }} />{st.text}</span></td>
                          <td><button type="button" className="ehc-view" onClick={() => viewScan(s.scanId)}><EyeIcon /> View</button></td>
                        </tr>
                      );
                    })}
                    {!historyLoading && history.length === 0 && (
                      <tr><td colSpan={5} className="ehc-td-empty">No health checks have been recorded yet.</td></tr>
                    )}
                    {historyLoading && history.length === 0 && (
                      <tr><td colSpan={5} className="ehc-td-empty">Loading…</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              {showAll && history.length < historyTotal && (
                <button type="button" className="ehc-more" disabled={historyLoading} onClick={() => loadHistory(true, history.length)}>
                  {historyLoading ? 'Loading…' : `Load more (${historyTotal - history.length} left)`}
                </button>
              )}
            </section>
          </div>
        </div>
        </div>
      </main>

      {cameraOpen && (
        <CameraModal
          onClose={() => setCameraOpen(false)}
          onFallback={() => { setCameraOpen(false); cameraInput.current?.click(); }}
          onCapture={(dataUrl) => {
            setPhotos((p) => (p.length >= MAX_PHOTOS ? p : [...p, { id: nextId.current++, dataUrl, name: 'camera.jpg' }]));
            setCameraOpen(false);
          }}
        />
      )}
    </div>
  );
}

function worstIndex(s: ScanDetail): number {
  if (!s.perView?.length) return 0;
  return s.perView.reduce((w, v, i, a) => (v.health_score < a[w]!.health_score ? i : w), 0);
}

/* ───────── result card body ───────── */
function ResultBody({ result, viewIndex, setViewIndex, showPhoto, setShowPhoto }: {
  result: ScanDetail; viewIndex: number; setViewIndex: (i: number) => void;
  showPhoto: boolean; setShowPhoto: (v: boolean) => void;
}) {
  const st = LABEL_STYLE[result.cvLabel];
  const worst = worstIndex(result);
  const view = result.perView?.[viewIndex];
  const canShowPhoto = !!result.processedImage && viewIndex === worst;
  const img = showPhoto && canShowPhoto ? result.processedImage! : (view?.heatmap_image ?? result.heatmapImage);
  const score = Math.round(result.healthScore);

  return (
    <>
      <div className="ehc-result">
        <div className="ehc-res-img">
          <img src={img} alt={showPhoto ? 'Processed photo' : 'Damage heatmap — coloured areas differ from healthy equipment'} />
          <div className="ehc-toggle" role="group" aria-label="Image view">
            <button type="button" className={!showPhoto ? 'is-on' : ''} onClick={() => setShowPhoto(false)}>Heatmap</button>
            <button type="button" className={showPhoto ? 'is-on' : ''} onClick={() => setShowPhoto(true)} disabled={!canShowPhoto}
              title={canShowPhoto ? '' : 'The plain photo is stored for the worst angle only'}>Photo</button>
          </div>
          {result.perView.length > 1 && (
            <div className="ehc-views">
              {result.perView.map((v, i) => (
                <button key={i} type="button" className={i === viewIndex ? 'is-on' : ''} onClick={() => setViewIndex(i)}
                  title={`Angle ${i + 1}: ${v.health_score}/100`}>
                  <img src={v.heatmap_image} alt={`Angle ${i + 1}`} /><span>{v.health_score}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="ehc-res-score">
          <ScoreRing score={score} color={st.color} track={st.track} />
          <span className="ehc-pill" style={{ background: st.soft, color: st.color }}>
            <span className="ehc-pill-dot" style={{ background: st.color }}><CheckIcon /></span>
            {st.text} Condition
          </span>
          <div className="ehc-anom">Anomaly: {result.anomalyPercent.toFixed(1)}%</div>
          {result.perView.length > 1 && <div className="ehc-sub">{result.perView.length} angles · worst angle shown</div>}
        </div>

        <div className="ehc-res-details">
          <h3>Details</h3>
          <dl>
            <div><dt>Equipment Type</dt><dd>{result.equipmentTypeName}</dd></div>
            <div><dt>Item (Barcode)</dt><dd>{result.barcode}</dd></div>
            <div><dt>Scanned On</dt><dd>{fmtDate(result.scannedAt)}</dd></div>
            <div><dt>Scanned By</dt><dd>{result.scannedByName}</dd></div>
            <div><dt>Inventory Condition</dt><dd>{result.conditionLabel.charAt(0) + result.conditionLabel.slice(1).toLowerCase()}</dd></div>
          </dl>
          <div className="ehc-tip"><BulbIcon /><span>{ADVICE[result.cvLabel]}</span></div>
        </div>
      </div>
      {result.warnings?.length > 0 && (
        <p className="ehc-warn">Note: {result.warnings.map((w) => w.replace('ITEM_MAY_BE_CUT_OFF', 'the item may be cut off at the photo edge')).join('; ')}.</p>
      )}
      <p className="ehc-disclaimer">
        The score is a visual condition estimate from the photo(s): it cannot see inside the item (e.g. air pressure or a
        cracked core). Coloured areas look different from the healthy reference photos.
      </p>
    </>
  );
}

function ScoreRing({ score, color, track }: { score: number; color: string; track: string }) {
  const r = 68, c = 2 * Math.PI * r;
  const [shown, setShown] = useState(0);
  useEffect(() => { const t = requestAnimationFrame(() => setShown(score)); return () => cancelAnimationFrame(t); }, [score]);
  return (
    <div className="ehc-ring" role="img" aria-label={`Health score ${score} out of 100`}>
      <svg width="164" height="164" viewBox="0 0 164 164">
        <circle cx="82" cy="82" r={r} fill="none" stroke={track} strokeWidth="12" />
        <circle cx="82" cy="82" r={r} fill="none" stroke={color} strokeWidth="12" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - shown / 100)} transform="rotate(-90 82 82)"
          style={{ transition: 'stroke-dashoffset .9s ease' }} />
      </svg>
      <div className="ehc-ring-text"><strong>{score}</strong><span>/100</span></div>
    </div>
  );
}

/* ───────── camera modal ───────── */
function CameraModal({ onClose, onCapture, onFallback }: {
  onClose: () => void; onCapture: (dataUrl: string) => void; onFallback: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [failed, setFailed] = useState('');

  useEffect(() => {
    let s: MediaStream | null = null;
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 } }, audio: false })
      .then((ms) => { s = ms; setStream(ms); if (video.current) video.current.srcObject = ms; })
      .catch(() => setFailed('Camera access was blocked or no camera was found.'));
    return () => { s?.getTracks().forEach((t) => t.stop()); };
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function snap() {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const scale = Math.min(1, 1600 / Math.max(v.videoWidth, v.videoHeight));
    const cnv = document.createElement('canvas');
    cnv.width = Math.round(v.videoWidth * scale); cnv.height = Math.round(v.videoHeight * scale);
    cnv.getContext('2d')?.drawImage(v, 0, 0, cnv.width, cnv.height);
    stream?.getTracks().forEach((t) => t.stop());
    onCapture(cnv.toDataURL('image/jpeg', 0.92));
  }

  return (
    <div className="ehc-modal" role="dialog" aria-modal="true" aria-label="Capture with camera" onClick={onClose}>
      <div className="ehc-modal-card" onClick={(e) => e.stopPropagation()}>
        <h3>Capture with Camera</h3>
        {failed ? (
          <div className="ehc-error"><strong>{failed}</strong><span>You can use your phone's camera app instead.</span></div>
        ) : (
          <video ref={video} autoPlay playsInline muted className="ehc-video" />
        )}
        <p className="ehc-sub">Fill most of the frame with the item, on a plain background.</p>
        <div className="ehc-modal-actions">
          <button type="button" className="ehc-camera-btn" onClick={onClose}>Cancel</button>
          {failed
            ? <button type="button" className="ehc-primary" onClick={onFallback}>Open camera app</button>
            : <button type="button" className="ehc-primary" onClick={snap} disabled={!stream}><CameraIcon /> Take Photo</button>}
        </div>
      </div>
    </div>
  );
}

/* ───────── styles ───────── */
function Styles() {
  const css = useMemo(() => `
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
    /* page chrome — identical values to Inventory / Messages (navy + glass) */
    .ehc-page { position: relative; min-height: 100%; display: flex; flex-direction: column;
      background: radial-gradient(1100px 700px at 15% 0%, ${P.navy800}aa 0%, transparent 60%),
                  radial-gradient(900px 600px at 100% 100%, ${P.accent}22 0%, transparent 55%), ${P.navy900};
      font-family: 'Inter', system-ui, sans-serif; color: ${P.navy900}; }
    .ehc-page *, .ehc-page *::before, .ehc-page *::after { box-sizing: border-box; }
    .ehc-blobs { position: absolute; inset: 0; overflow: hidden; pointer-events: none; }
    .ehc-blob { position: absolute; border-radius: 50%; filter: blur(30px); pointer-events: none; }
    .ehc-blob-a { width: 420px; height: 420px; top: -160px; left: -140px; background: ${P.accent}1a; }
    .ehc-blob-b { width: 380px; height: 380px; bottom: -160px; right: -120px; background: ${P.navy800}22; }
    .ehc-wrap { position: relative; z-index: 1; flex: 1; width: 100%; max-width: 1360px; margin: 0 auto; padding: 20px 24px 48px; }
    .ehc-glass { position: relative; background: rgba(255,255,255,0.07);
      backdrop-filter: blur(22px) saturate(160%); -webkit-backdrop-filter: blur(22px) saturate(160%);
      border: 1px solid rgba(255,255,255,0.16); border-radius: 24px; padding: 26px 26px 32px;
      box-shadow: 0 24px 60px -32px rgba(3,22,54,0.75), inset 0 1px 0 rgba(255,255,255,0.10); }

    .ehc-topbar { position: relative; z-index: 1; display: flex; justify-content: space-between; align-items: center; gap: 16px;
      padding: 18px 32px; flex-wrap: wrap; }
    .ehc-brand, .ehc-user { display: flex; align-items: center; gap: 12px; }
    .ehc-brand img { width: 40px; height: 40px; border-radius: 10px; object-fit: contain; background: ${P.slate50}; padding: 4px;
      border: 1px solid ${P.slate300}; }
    .ehc-brand strong, .ehc-user strong { display: block; font-size: 16px; font-weight: 700; color: #fff; }
    .ehc-brand span, .ehc-user span { display: block; font-size: 12px; color: ${P.slate400}; margin-top: 1px; }
    .ehc-bell { position: relative; color: ${P.slate100}; margin-right: 14px; display: inline-flex; }
    .ehc-bell::after { content: ''; position: absolute; top: 0; right: 1px; width: 7px; height: 7px; border-radius: 50%; background: #E5484D; }
    .ehc-avatar { width: 40px; height: 40px; border-radius: 50%; display: inline-flex !important; align-items: center; justify-content: center;
      background: linear-gradient(135deg, ${P.accent}, #2F55C4); color: #fff !important; font: 700 14px Inter, sans-serif; margin: 0 !important; }


    .ehc-hero { text-align: center; max-width: 640px; margin: 4px auto 24px; }
    .ehc-eyebrow { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 700; letter-spacing: .5px;
      text-transform: uppercase; padding: 6px 14px; border-radius: 999px; margin-bottom: 14px;
      color: ${P.slate100}; background: ${P.navy800}88; border: 1px solid ${P.slate400}55; }
    .ehc-hero h1 { margin: 0 0 8px; font-size: 32px; font-weight: 800; letter-spacing: -.5px; color: #fff; }
    .ehc-hero p { margin: 0; font-size: 14.5px; line-height: 1.55; color: ${P.slate300}; }

    .ehc-banner { display: flex; align-items: center; gap: 8px; margin: 0 0 18px; padding: 10px 14px; border-radius: 12px;
      background: #FEF3C7; color: #92400E; border: 1px solid #FCD34D; font-size: 13.5px; font-weight: 600; }

    .ehc-grid { display: grid; grid-template-columns: minmax(340px, 5fr) minmax(0, 7.6fr); gap: 20px; align-items: start; }
    .ehc-right { display: grid; gap: 20px; min-width: 0; }
    .ehc-card { background: linear-gradient(145deg, #F8FAFF 0%, #EAF0FC 100%); border: 1px solid ${P.slate300}e6; border-radius: 18px;
      padding: 22px 22px 24px; box-shadow: 0 12px 30px -22px rgba(3,22,54,.85); min-width: 0; scroll-margin-top: 16px; }
    .ehc-card-head { display: flex; align-items: center; gap: 12px; margin: 0 0 18px; font-size: 20px; font-weight: 700; color: ${P.navy800}; flex-wrap: wrap; }
    .ehc-head-icon { display: inline-flex; align-items: center; justify-content: center; width: 34px; height: 30px; border-radius: 8px;
      background: ${P.accent}; color: #fff; }
    .ehc-head-plain { background: none; color: ${P.accent}; width: auto; }
    .ehc-chip { margin-left: auto; font-size: 11.5px; font-weight: 700; padding: 4px 10px; border-radius: 999px; background: ${P.slate100}; color: ${P.slate500}; }
    .ehc-chip-new { background: #DCFCE7; color: #15803D; }

    .ehc-field-label { display: block; font-size: 15px; font-weight: 700; margin: 4px 0 12px; color: ${P.navy900}; }
    .ehc-types { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin-bottom: 18px; }
    .ehc-type { position: relative; display: flex; align-items: center; justify-content: center; gap: 9px; min-height: 52px; padding: 8px 10px;
      border-radius: 10px; border: 1.5px solid ${P.slate300}; background: #fff; color: ${P.navy900}; font: 500 14px Inter, sans-serif;
      cursor: pointer; transition: border-color .15s, background-color .15s, box-shadow .15s; }
    .ehc-type img { width: 30px; height: 30px; object-fit: contain; flex: 0 0 auto; }
    .ehc-type:hover { border-color: ${P.slate300}; background: ${P.slate50}; }
    .ehc-type.is-on { background: #DBEAFE; border: 1.5px solid ${P.accent}; color: ${P.accent}; font-weight: 600;
      box-shadow: 0 0 0 3px ${P.accent}14; }
    .ehc-type em { position: absolute; top: -8px; right: 6px; font-style: normal; font-size: 10px; font-weight: 700; padding: 1px 6px;
      border-radius: 999px; background: #FEF3C7; color: #92400E; }

    .ehc-select { width: 100%; padding: 11px 12px; border-radius: 10px; border: 1.5px solid ${P.slate300}; background: ${P.slate50};
      color: ${P.navy900}; font: 500 14px Inter, sans-serif; margin-bottom: 18px; }
    .ehc-select:focus, .ehc-type:focus-visible, .ehc-primary:focus-visible, .ehc-camera-btn:focus-visible, .ehc-drop-btn:focus-visible {
      outline: 2px solid ${P.accent}; outline-offset: 2px; }

    .ehc-drop { border: 2px dashed ${P.slate300}; border-radius: 12px; background: #FBFCFF; transition: background-color .15s, border-color .15s; }
    .ehc-drop.is-over { border-color: ${P.accent}; background: ${P.accentSoft}; }
    .ehc-drop-btn { width: 100%; display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 28px 16px 26px;
      background: none; border: none; cursor: pointer; color: ${P.slate600}; font-family: inherit; }
    .ehc-drop-btn svg { color: ${P.accent}; margin-bottom: 4px; }
    .ehc-drop-btn strong { font-size: 19px; color: ${P.navy800}; font-weight: 700; }
    .ehc-drop-btn span { font-size: 14.5px; }
    .ehc-drop-btn small { font-size: 12.5px; color: ${P.slate500}; margin-top: 8px; }
    .ehc-thumbs { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 10px; padding: 14px; }
    .ehc-thumb { position: relative; margin: 0; aspect-ratio: 1; border-radius: 10px; overflow: hidden; background: ${P.slate100}; border: 1px solid ${P.slate200}; }
    .ehc-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .ehc-thumb figcaption { position: absolute; left: 0; right: 0; bottom: 0; padding: 3px 6px; font-size: 11px; font-weight: 600; color: #fff;
      background: linear-gradient(transparent, rgba(15,23,43,.75)); }
    .ehc-thumb button { position: absolute; top: 4px; right: 4px; width: 24px; height: 24px; border-radius: 50%; border: none;
      background: rgba(15,23,43,.7); color: #fff; font-size: 16px; line-height: 1; cursor: pointer; }
    .ehc-thumb-add { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; cursor: pointer;
      border-style: dashed; color: ${P.accent}; font: 600 12.5px Inter, sans-serif; background: #fff; }
    .ehc-thumb-add span { font-size: 26px; line-height: 1; }

    .ehc-or { display: flex; align-items: center; gap: 12px; margin: 16px 0; color: ${P.slate500}; font-size: 12.5px; }
    .ehc-or::before, .ehc-or::after { content: ''; flex: 1; height: 1px; background: ${P.slate200}; }
    .ehc-camera-btn { width: 100%; display: inline-flex; align-items: center; justify-content: center; gap: 10px; padding: 12px;
      border-radius: 10px; border: 1px solid #D9E2F3; background: #F1F5FD; color: ${P.navy800}; font: 500 15px Inter, sans-serif;
      cursor: pointer; transition: background-color .15s, border-color .15s; }
    .ehc-camera-btn svg { color: ${P.accent}; }
    .ehc-camera-btn:hover:not(:disabled) { background: ${P.accentSoft}; border-color: ${P.slate300}; }
    .ehc-camera-btn:disabled { opacity: .5; cursor: not-allowed; }

    .ehc-guide { margin-top: 18px; padding: 14px 16px; border-radius: 12px; background: #F6F8FD; border: 1px solid ${P.slate200}; }
    .ehc-guide-head { display: flex; align-items: center; gap: 10px; font-weight: 700; font-size: 14.5px; color: ${P.navy800}; }
    .ehc-guide-head svg { color: ${P.accent}; }
    .ehc-guide ul { list-style: none; margin: 8px 0 0; padding: 0 0 0 32px; display: grid; gap: 6px; font-size: 13.5px; color: ${P.slate600}; }
    .ehc-guide li { display: flex; align-items: center; gap: 8px; }
    .ehc-guide li svg { color: #16A34A; flex: 0 0 auto; }

    .ehc-check { display: flex; align-items: center; gap: 9px; margin: 16px 2px 0; font-size: 13.5px; color: ${P.slate600}; cursor: pointer; }
    .ehc-check input { width: 16px; height: 16px; accent-color: ${P.accent}; }

    .ehc-error { display: grid; gap: 4px; margin-top: 16px; padding: 11px 14px; border-radius: 10px; background: #FDECEC; border: 1px solid #F3CACA; color: #8F2323; font-size: 13.5px; }
    .ehc-error span { color: #A13A3A; }

    .ehc-primary { width: 100%; display: inline-flex; align-items: center; justify-content: center; gap: 10px; margin-top: 18px; padding: 14px;
      border-radius: 10px; border: none; background: ${P.accent}; color: #fff; font: 600 15.5px Inter, sans-serif; cursor: pointer;
      box-shadow: 0 12px 24px -14px rgba(28,57,142,.85); transition: background-color .15s, transform .15s; }
    .ehc-primary:hover:not(:disabled) { background: ${P.accentHover}; transform: translateY(-1px); }
    .ehc-primary:disabled { opacity: .7; cursor: progress; }
    .ehc-spinner { width: 16px; height: 16px; border-radius: 50%; border: 2px solid rgba(255,255,255,.35); border-top-color: #fff; animation: ehcSpin .8s linear infinite; }
    @keyframes ehcSpin { to { transform: rotate(360deg); } }

    .ehc-empty { display: grid; place-items: center; gap: 10px; padding: 46px 20px; color: ${P.slate500}; text-align: center; font-size: 14px; }
    .ehc-empty svg { width: 40px; height: 40px; color: ${P.slate300}; }

    .ehc-result { display: grid; grid-template-columns: minmax(170px, 210px) minmax(165px, 0.85fr) minmax(255px, 1.45fr); gap: 0; align-items: stretch; }
    .ehc-result > * { min-width: 0; }
    .ehc-res-img { padding-right: 22px; }
    .ehc-res-img > img { width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 12px; background: ${P.slate100}; display: block; }
    .ehc-toggle { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin-top: 10px; padding: 3px; border-radius: 9px; background: ${P.slate100}; }
    .ehc-toggle button { padding: 6px; border: none; border-radius: 7px; background: none; font: 600 12.5px Inter, sans-serif; color: ${P.slate500}; cursor: pointer; }
    .ehc-toggle button.is-on { background: #fff; color: ${P.accent}; box-shadow: 0 2px 6px -3px rgba(3,22,54,.4); }
    .ehc-toggle button:disabled { opacity: .45; cursor: not-allowed; }
    .ehc-views { display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap; }
    .ehc-views button { position: relative; width: 46px; height: 46px; padding: 0; border-radius: 8px; overflow: hidden; border: 2px solid transparent; cursor: pointer; background: none; }
    .ehc-views button.is-on { border-color: ${P.accent}; }
    .ehc-views img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .ehc-views span { position: absolute; bottom: 0; right: 0; padding: 0 4px; font: 700 10px Inter, sans-serif; color: #fff; background: rgba(15,23,43,.75); border-top-left-radius: 5px; }

    .ehc-res-score { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 4px 18px;
      border-left: 1px solid ${P.slate200}; border-right: 1px solid ${P.slate200}; }
    .ehc-ring { position: relative; width: 164px; height: 164px; }
    .ehc-ring-text { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; }
    .ehc-ring-text strong { font-size: 46px; font-weight: 800; line-height: 1; color: ${P.navy900}; }
    .ehc-ring-text span { font-size: 19px; color: ${P.slate600}; margin-top: 4px; }
    .ehc-pill { display: inline-flex; align-items: center; gap: 9px; padding: 8px 16px; border-radius: 999px; font-weight: 700; font-size: 15px; white-space: nowrap; }
    .ehc-pill-dot { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; border-radius: 50%; color: #fff; }
    .ehc-pill-dot svg { width: 12px; height: 12px; color: #fff; }
    .ehc-anom { font-size: 15px; font-weight: 500; color: ${P.navy900}; }
    .ehc-sub { font-size: 12px; color: ${P.slate500}; margin: 0; text-align: center; }

    .ehc-res-details { padding-left: 22px; }
    .ehc-res-details h3 { margin: 0 0 6px; font-size: 16px; font-weight: 700; padding-bottom: 10px; border-bottom: 1px solid ${P.slate200}; }
    .ehc-res-details dl { margin: 0; display: grid; }
    .ehc-res-details dl > div { display: grid; grid-template-columns: 112px minmax(0, 1fr); gap: 10px; padding: 9px 0; font-size: 13.5px; }
    .ehc-res-details dt { color: ${P.slate600}; }
    .ehc-res-details dd { margin: 0; color: ${P.navy900}; font-weight: 500; overflow-wrap: break-word; font-variant-numeric: tabular-nums; }
    .ehc-tip { display: flex; gap: 10px; margin-top: 10px; padding: 12px 14px; border-radius: 10px; background: ${P.accentSoft}; color: ${P.accent}; font-size: 13.5px; line-height: 1.45; }
    .ehc-tip svg { flex: 0 0 auto; margin-top: 1px; }
    .ehc-warn { margin: 14px 0 0; font-size: 12.5px; color: #92400E; }
    .ehc-disclaimer { margin: 14px 0 0; font-size: 12px; color: ${P.slate500}; line-height: 1.5; }

    .ehc-hist-head { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
    .ehc-hist-head .ehc-card-head { margin-bottom: 14px; }
    .ehc-link { display: inline-flex; align-items: center; gap: 6px; background: none; border: none; color: ${P.accent}; font: 600 14px Inter, sans-serif; cursor: pointer; margin-bottom: 14px; }
    .ehc-table-wrap { overflow-x: auto; }
    .ehc-table { width: 100%; border-collapse: collapse; font-size: 14.5px; min-width: 560px; }
    .ehc-table th { text-align: left; font-weight: 500; color: ${P.slate600}; background: #F1F5FB; padding: 11px 14px; white-space: nowrap; }
    .ehc-table th:first-child { border-radius: 10px 0 0 10px; } .ehc-table th:last-child { border-radius: 0 10px 10px 0; }
    .ehc-table td { padding: 12px 14px; border-bottom: 1px solid ${P.slate100}; white-space: nowrap; color: ${P.navy900}; }
    .ehc-table td small { display: block; font-size: 11.5px; color: ${P.slate500}; margin-top: 2px; }
    .ehc-table tr:last-child td { border-bottom: none; }
    .ehc-table tr.is-current td { background: #F7F9FE; }
    .ehc-td-empty { text-align: center; color: ${P.slate500} !important; padding: 26px !important; white-space: normal !important; }
    .ehc-status { display: inline-flex; align-items: center; gap: 8px; font-weight: 500; }
    .ehc-status i { width: 9px; height: 9px; border-radius: 50%; display: inline-block; }
    .ehc-view { display: inline-flex; align-items: center; gap: 7px; background: none; border: none; color: ${P.accent}; font: 500 14px Inter, sans-serif; cursor: pointer; padding: 4px 2px; }
    .ehc-view:hover { text-decoration: underline; }
    .ehc-more { margin-top: 12px; width: 100%; padding: 10px; border-radius: 10px; border: 1px solid ${P.slate200}; background: #fff; color: ${P.accent}; font: 600 13.5px Inter, sans-serif; cursor: pointer; }

    .ehc-modal { position: fixed; inset: 0; z-index: 100; display: grid; place-items: center; padding: 16px; background: rgba(3,10,30,.6); }
    .ehc-modal-card { width: min(640px, 100%); background: #fff; border-radius: 16px; padding: 20px; box-shadow: 0 30px 60px -20px rgba(0,0,0,.5); }
    .ehc-modal-card h3 { margin: 0 0 12px; font-size: 18px; color: ${P.navy800}; }
    .ehc-video { width: 100%; max-height: 60vh; border-radius: 12px; background: #000; display: block; }
    .ehc-modal-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 12px; }
    .ehc-modal-actions .ehc-primary { margin-top: 0; }

    @media (max-width: 1180px) {
      .ehc-grid { grid-template-columns: 1fr; }
    }
    @media (max-width: 760px) {
      .ehc-wrap { padding: 12px 12px 32px; }
      .ehc-glass { padding: 20px 14px 26px; border-radius: 18px; }
      .ehc-topbar { padding: 12px 16px; }
      .ehc-hero h1 { font-size: 26px; }
      .ehc-result { grid-template-columns: 1fr; gap: 18px; }
      .ehc-res-img { padding-right: 0; max-width: 320px; width: 100%; margin: 0 auto; }
      .ehc-res-score { border: none; border-top: 1px solid ${P.slate200}; border-bottom: 1px solid ${P.slate200}; padding: 16px 0; }
      .ehc-res-details { padding-left: 0; }
    }
    @media (max-width: 520px) {
      .ehc-types { grid-template-columns: 1fr; }
      .ehc-type { justify-content: flex-start; }
    }
    @media (prefers-reduced-motion: reduce) { .ehc-page * { transition: none !important; animation: none !important; } }
  `, []);
  return <style>{css}</style>;
}

/* ───────── icons (stroke = currentColor) ───────── */
type IP = { style?: CSSProperties };
const sv = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
function ShieldSmallIcon() { return <svg width="14" height="15" viewBox="0 0 24 27" {...sv} strokeWidth={2.2} aria-hidden><path d="M12 2 21 5.6v7.1c0 5.6-3.8 9.7-9 11.3-5.2-1.6-9-5.7-9-11.3V5.6L12 2z" /><path d="m7.8 13.2 3 3 5.6-6" /></svg>; }
function CameraIcon(p: IP) { return <svg width="20" height="20" viewBox="0 0 24 24" {...sv} style={p.style} aria-hidden><path d="M3 8.5A2 2 0 0 1 5 6.5h2.2l1.5-2h6.6l1.5 2H19a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8.5z" /><circle cx="12" cy="13" r="3.6" /></svg>; }
function PulseIcon() { return <svg width="26" height="26" viewBox="0 0 24 24" {...sv} strokeWidth={2} aria-hidden><path d="M2.5 12.5h4l2.5-6 4.5 12 2.6-6.5h5.4" /></svg>; }
function HistoryIcon() { return <svg width="24" height="24" viewBox="0 0 24 24" {...sv} aria-hidden><path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1" /><path d="M3 4.5v4h4" /><path d="M12 7.5V12l3 2" /></svg>; }
function UploadCloudIcon() { return <svg width="68" height="56" viewBox="0 0 34 28" {...sv} strokeWidth={1.8} aria-hidden><path d="M9 22H7.5a6 6 0 0 1-.6-12A8.5 8.5 0 0 1 23.4 8 6.8 6.8 0 0 1 26 22h-1" /><path d="M17 26V13M12.5 17.5 17 13l4.5 4.5" strokeWidth={2.2} /></svg>; }
function InfoIcon() { return <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden><circle cx="12" cy="12" r="10" fill="currentColor" /><path d="M12 11v6" stroke="#fff" strokeWidth="2" strokeLinecap="round" /><circle cx="12" cy="7.6" r="1.2" fill="#fff" /></svg>; }
function CheckIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" {...sv} strokeWidth={2.6} aria-hidden><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>; }
function ScanIcon() { return <svg width="20" height="20" viewBox="0 0 24 24" {...sv} aria-hidden><path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16" /><rect x="8.5" y="9" width="7" height="6" rx="1.2" /></svg>; }
function EyeIcon() { return <svg width="18" height="18" viewBox="0 0 24 24" {...sv} aria-hidden><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="2.8" /></svg>; }
function ArrowRightIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" {...sv} strokeWidth={2} aria-hidden><path d="M5 12h14M13 6l6 6-6 6" /></svg>; }
function BulbIcon() { return <svg width="20" height="20" viewBox="0 0 24 24" {...sv} aria-hidden><path d="M9 18h6M10 21h4" /><path d="M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1 2V16h5.2v-.2c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z" /><path d="M12 1v.01M4 5l.7.7M20 5l-.7.7M2 11h1M21 11h1" /></svg>; }
function BellIcon() { return <svg width="24" height="24" viewBox="0 0 24 24" {...sv} aria-hidden><path d="M6 16V10a6 6 0 0 1 12 0v6l1.6 2.3H4.4L6 16z" /><path d="M9.5 20.5a2.5 2.5 0 0 0 5 0" /></svg>; }
