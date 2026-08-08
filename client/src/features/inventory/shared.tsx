/**
 * Shared UI primitives for the Inventory console (Feature 4 polish):
 *  - Modal: a small centered dialog, replaces browser confirm()/prompt()
 *  - CameraCapture: optional webcam photo capture, returns a base64 data URL
 *  - BarcodeScannerModal: webcam-based barcode scanner (UPC/EAN via ZXing)
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

// ── styles ──
const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(15,27,45,0.45)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
};
const box: React.CSSProperties = {
  background: '#fff', borderRadius: 8, boxShadow: '0 12px 32px rgba(0,0,0,0.2)', maxWidth: '92vw', maxHeight: '88vh', overflowY: 'auto',
};
const boxHead: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  padding: '14px 18px', borderBottom: '1px solid #e5e5e5', font: '600 15px var(--font-body)', color: '#26485f',
};
const boxBody: React.CSSProperties = { padding: 18 };
const closeBtn: React.CSSProperties = { background: 'none', border: 'none', fontSize: 20, lineHeight: 1, color: '#8a949f', cursor: 'pointer', padding: 0 };
const primaryBtnM: React.CSSProperties = { background: '#0a6ebd', color: '#fff', border: 'none', borderRadius: 4, padding: '8px 16px', fontSize: 14, cursor: 'pointer' };
const secondaryBtn: React.CSSProperties = { background: '#fff', color: '#26485f', border: '1px solid #ccc', borderRadius: 4, padding: '8px 16px', fontSize: 14, cursor: 'pointer' };
const dangerBtn: React.CSSProperties = { background: '#c0392b', color: '#fff', border: 'none', borderRadius: 4, padding: '8px 16px', fontSize: 14, cursor: 'pointer' };
const linkBtnM: React.CSSProperties = { background: 'none', border: 'none', font: '500 13px var(--font-body)', color: '#0a6ebd', cursor: 'pointer', padding: '4px 0' };
