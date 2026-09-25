/**
 * Shared UI primitives for the Inventory console (Feature 4 polish):
 *  - Modal: a small centered dialog, replaces browser confirm()/prompt()
 *  - CameraCapture: optional webcam photo capture, returns a base64 data URL
 *  - BarcodeScannerModal: webcam-based barcode scanner (UPC/EAN via ZXing)
 *  - PhotoUploadScan: upload a photo, read its barcode (ZXing) and attach a
 *    compressed copy as the article photo — used instead of CameraCapture on
 *    the Articles screen. CameraCapture is kept but no longer used there.
 *
 * Camera features degrade gracefully — if getUserMedia isn't available or
 * permission is denied, the surrounding form still works with manual entry.
 */
import { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';
import type { IScannerControls } from '@zxing/browser';

// ── Modal ──
export function Modal({ title, onClose, children, width = 420 }: {
  title: string; onClose: () => void; children: React.ReactNode; width?: number;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div style={overlay} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ ...box, width }} onMouseDown={(e) => e.stopPropagation()}>
        <div style={boxHead}>
          <span>{title}</span>
          <button type="button" onClick={onClose} style={closeBtn} aria-label="Close">×</button>
        </div>
        <div style={boxBody}>{children}</div>
      </div>
    </div>
  );
}

// ── Confirm modal (replaces window.confirm) ──
export function ConfirmModal({ title, message, confirmLabel = 'Confirm', danger, onConfirm, onCancel }: {
  title: string; message: string; confirmLabel?: string; danger?: boolean;
  onConfirm: () => void; onCancel: () => void;
}) {
  return (
    <Modal title={title} onClose={onCancel} width={360}>
      <p style={{ margin: '0 0 16px', fontSize: 14, color: '#3a4552', lineHeight: 1.5 }}>{message}</p>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button type="button" onClick={onCancel} style={secondaryBtn}>Cancel</button>
        <button type="button" onClick={onConfirm} style={danger ? dangerBtn : primaryBtnM}>{confirmLabel}</button>
      </div>
    </Modal>
  );
}

// ── Camera capture (optional photo at entry/scan time) ──
export function CameraCapture({ imageData, onCapture, onClear }: {
  imageData: string | null; onCapture: (dataUrl: string) => void; onClear: () => void;
}) {
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  async function start() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      streamRef.current = stream;
      setActive(true);
      // video element mounts this render pass; attach the stream right after.
      requestAnimationFrame(() => { if (videoRef.current) videoRef.current.srcObject = stream; });
    } catch {
      setError('Camera unavailable — check browser permissions, or skip and enter the score manually.');
    }
  }

  function stop() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setActive(false);
  }

  function takePhoto() {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    onCapture(canvas.toDataURL('image/jpeg', 0.7));
    stop();
  }

  useEffect(() => () => stop(), []); // eslint-disable-line react-hooks/exhaustive-deps

  if (imageData) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <img src={imageData} alt="Captured" style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 4, border: '1px solid #ddd' }} />
        <button type="button" style={linkBtnM} onClick={onClear}>Remove photo</button>
      </div>
    );
  }

  if (!active) {
    return (
      <div>
        <button type="button" style={secondaryBtn} onClick={start}>📷 Take Photo (optional)</button>
        {error && <p style={{ margin: '6px 0 0', fontSize: 12.5, color: '#b3352b' }}>{error}</p>}
        <p style={{ margin: '6px 0 0', fontSize: 12, color: '#8a949f' }}>
          Automatic scoring isn't available yet — enter the score manually below either way.
        </p>
      </div>
    );
  }

  return (
    <div>
      <video ref={videoRef} autoPlay playsInline muted style={{ width: '100%', maxWidth: 320, borderRadius: 6, background: '#000' }} />
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button type="button" style={primaryBtnM} onClick={takePhoto}>Capture</button>
        <button type="button" style={secondaryBtn} onClick={stop}>Cancel</button>
      </div>
    </div>
  );
}

// ── Photo upload + barcode read from the uploaded image ──
// Replaces the "Take Photo" option on the Articles screen. The chosen image is
// (1) decoded for a 12-digit UPC barcode at full resolution — when one is
// found it is passed to onBarcode so the form's barcode field fills itself —
// and (2) downscaled/compressed into a JPEG data URL that fits the server's
// 500,000-character imageData limit, then passed to onImage as the article
// photo (the same field the old camera capture filled).
const MAX_IMAGE_CHARS = 480_000; // headroom under the server's 500_000 limit

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('unreadable image'));
    img.src = src;
  });
}

async function compressForUpload(img: HTMLImageElement): Promise<string> {
  let maxSide = 1280;
  let quality = 0.75;
  for (let attempt = 0; attempt < 8; attempt++) {
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) break;
    ctx.fillStyle = '#fff'; // transparent PNGs → white, not black, in JPEG
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const out = canvas.toDataURL('image/jpeg', quality);
    if (out.length <= MAX_IMAGE_CHARS) return out;
    if (quality > 0.5) quality -= 0.1; else maxSide = Math.round(maxSide * 0.75);
  }
  throw new Error('too large');
}

// UPC-A is 12 digits. ZXing can also report the same code as EAN-13 with a
// leading 0 — that's the identical barcode, so normalise it to 12 digits.
function normaliseUpc(text: string): string | null {
  if (/^\d{12}$/.test(text)) return text;
  if (/^0\d{12}$/.test(text)) return text.slice(1);
  return null;
}

async function readBarcodeFromImage(img: HTMLImageElement): Promise<string | null> {
  const reader = new BrowserMultiFormatReader();
  try {
    return normaliseUpc((await reader.decodeFromImageElement(img)).getText());
  } catch {
    // Not found at full size — very large photos sometimes decode better scaled down.
  }
  try {
    const scale = Math.min(1, 1200 / Math.max(img.naturalWidth, img.naturalHeight));
    if (scale >= 1) return null;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height);
    const small = await loadImage(canvas.toDataURL('image/png'));
    return normaliseUpc((await reader.decodeFromImageElement(small)).getText());
  } catch {
    return null;
  }
}

export function PhotoUploadScan({ imageData, onImage, onClear, onBarcode, label = 'Upload Photo' }: {
  imageData: string | null;
  onImage: (dataUrl: string) => void;
  onClear: () => void;
  /** When provided, the uploaded photo is scanned and a detected barcode is passed here. */
  onBarcode?: (code: string) => void;
  label?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: 'ok' | 'warn' | 'err'; text: string } | null>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (inputRef.current) inputRef.current.value = ''; // allow re-choosing the same file
    if (!file) return;
    if (!file.type.startsWith('image/')) { setStatus({ kind: 'err', text: 'Please choose an image file (JPG, PNG, etc.).' }); return; }

    setBusy(true);
    setStatus(null);
    const objectUrl = URL.createObjectURL(file);
    try {
      const img = await loadImage(objectUrl);
      let found: string | null = null;
      if (onBarcode) found = await readBarcodeFromImage(img);
      const compressed = await compressForUpload(img);
      onImage(compressed);
      if (onBarcode) {
        if (found) {
          onBarcode(found);
          setStatus({ kind: 'ok', text: `Barcode ${found} read from the photo and filled in.` });
        } else {
          setStatus({ kind: 'warn', text: 'No 12-digit barcode found in this photo — type it in, or upload a clearer, closer photo of the barcode.' });
        }
      }
    } catch {
      setStatus({ kind: 'err', text: "Couldn't read that image — try a different photo." });
    } finally {
      URL.revokeObjectURL(objectUrl);
      setBusy(false);
    }
  }

  const statusColor = status?.kind === 'ok' ? '#1F7A45' : status?.kind === 'warn' ? '#9A6412' : '#B3352B';

  return (
    <div>
      <input ref={inputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFile} />
      {imageData ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <img src={imageData} alt="Uploaded" style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 10, border: '1px solid #CAD5E2' }} />
          <button type="button" style={secondaryBtn} disabled={busy} onClick={() => inputRef.current?.click()}>
            {busy ? 'Scanning…' : 'Replace photo'}
          </button>
          <button type="button" style={linkBtnM} disabled={busy} onClick={() => { onClear(); setStatus(null); }}>Remove photo</button>
        </div>
      ) : (
        <button type="button" style={secondaryBtn} disabled={busy} onClick={() => inputRef.current?.click()}>
          {busy ? 'Scanning photo…' : `⬆ ${label}`}
        </button>
      )}
      {status && <p style={{ margin: '6px 0 0', fontSize: 12.5, color: statusColor, fontWeight: 600 }}>{status.text}</p>}
      {!status && onBarcode && !imageData && (
        <p style={{ margin: '6px 0 0', fontSize: 12, color: '#62748E' }}>
          Upload a photo showing the barcode — it's read automatically and fills in the barcode field.
        </p>
      )}
    </div>
  );
}

// ── Webcam barcode scanner (UPC/EAN via device camera) ──
export function BarcodeScannerModal({ onDetected, onClose }: {
  onDetected: (code: string) => void; onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let controls: IScannerControls | undefined;
    let cancelled = false;
    const reader = new BrowserMultiFormatReader();

    reader.decodeFromVideoDevice(undefined, videoRef.current ?? undefined, (result) => {
      if (result && !cancelled) {
        const text = result.getText();
        if (/^\d{12}$/.test(text)) {
          cancelled = true;
          controls?.stop();
          onDetected(text);
        }
      }
    }).then((c) => { controls = c; }).catch(() => {
      if (!cancelled) setError('Camera unavailable — check permissions, or enter the barcode manually.');
    });

    return () => { cancelled = true; controls?.stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Modal title="Scan Barcode" onClose={onClose} width={360}>
      {error ? (
        <p style={{ fontSize: 13.5, color: '#b3352b', margin: 0 }}>{error}</p>
      ) : (
        <>
          <video ref={videoRef} autoPlay playsInline muted style={{ width: '100%', borderRadius: 6, background: '#000' }} />
          <p style={{ fontSize: 12.5, color: '#8a949f', margin: '8px 0 0' }}>Point the camera at a 12-digit UPC/EAN barcode.</p>
        </>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
        <button type="button" style={secondaryBtn} onClick={onClose}>Cancel</button>
      </div>
    </Modal>
  );
}

// ── styles (re-themed to match the navy/glass site theme — values only) ──
const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(3,22,54,0.6)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16,
};
const box: React.CSSProperties = {
  background: '#fff', borderRadius: 16, boxShadow: '0 24px 60px -20px rgba(3,22,54,0.6)', maxWidth: '92vw', maxHeight: '88vh', overflowY: 'auto',
  fontFamily: 'Inter, system-ui, sans-serif',
};
const boxHead: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  padding: '14px 20px', borderBottom: '1px solid #CAD5E2', font: '700 15.5px Inter, sans-serif', color: '#0F172B', background: '#F8FAFC',
  borderRadius: '16px 16px 0 0',
};
const boxBody: React.CSSProperties = { padding: 20 };
const closeBtn: React.CSSProperties = { background: 'none', border: 'none', fontSize: 22, lineHeight: 1, color: '#62748E', cursor: 'pointer', padding: 0 };
const primaryBtnM: React.CSSProperties = { background: '#1C398E', color: '#fff', border: 'none', borderRadius: 10, padding: '9px 18px', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'Inter, sans-serif' };
const secondaryBtn: React.CSSProperties = { background: '#fff', color: '#1C398E', border: '1.5px solid #CAD5E2', borderRadius: 10, padding: '9px 16px', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'Inter, sans-serif' };
const dangerBtn: React.CSSProperties = { background: '#B3352B', color: '#fff', border: 'none', borderRadius: 10, padding: '9px 18px', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'Inter, sans-serif' };
const linkBtnM: React.CSSProperties = { background: 'none', border: 'none', font: '700 13px Inter, sans-serif', color: '#1C398E', cursor: 'pointer', padding: '4px 0' };
