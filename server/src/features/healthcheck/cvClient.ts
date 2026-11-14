/**
 * Thin HTTP client for the Python CV microservice (cv-service/, FastAPI).
 *
 * The browser never talks to the CV service directly: photos go
 * browser → Express (auth + role check + article lookup) → CV service,
 * and the result is saved by Express. This keeps the CV service private
 * (bind it to 127.0.0.1) and the database the single source of truth.
 *
 * Env (optional, read here so the shared config schema stays untouched):
 *   CV_SERVICE_URL   default http://127.0.0.1:8001
 *   CV_API_KEY       shared secret; must equal CV_API_KEY in cv-service/.env
 *   CV_TIMEOUT_MS    default 120000 (4 photos on a slow laptop CPU ≈ 15 s)
 */
import { AppError } from '../../middleware/errors.js';

export const CV_SERVICE_URL = (process.env.CV_SERVICE_URL ?? 'http://127.0.0.1:8001').replace(/\/$/, '');
const CV_API_KEY = process.env.CV_API_KEY ?? '';
const CV_TIMEOUT_MS = Number(process.env.CV_TIMEOUT_MS ?? 120_000);

export type CvEquipmentType = 'basketball' | 'football' | 'volleyball';

export interface CvViewResult {
  index: number;
  health_score: number;
  anomaly_percent: number;
  severity: number;
  heatmap_image: string;
}

export interface CvResult {
  equipment_type: CvEquipmentType;
  health_score: number;
  label: 'GOOD' | 'FAIR' | 'POOR' | 'REPLACE';
  label_text: string;
  advice: string;
  anomaly_percent: number;
  severity: number;
  confidence: number;
  heatmap_image: string;
  processed_image: string;
  worst_view_index: number;
  views: CvViewResult[];
  thresholds: { good: number; fair: number; poor: number };
  warnings: string[];
  model_version: string;
  processing_ms: number;
}

interface CvErrorBody { error?: { code?: string; message?: string; details?: Record<string, unknown> } }

/** One decoded photo ready to upload. */
export interface PhotoBlob { bytes: Buffer; mime: string }

function headers(): Record<string, string> {
  return CV_API_KEY ? { 'X-CV-Key': CV_API_KEY } : {};
}

/** POST the photos to /v1/health-check and return the parsed result. */
export async function runHealthCheck(equipmentType: CvEquipmentType, photos: PhotoBlob[]): Promise<CvResult> {
  const form = new FormData();
  form.append('equipment_type', equipmentType);
  photos.forEach((p, i) => {
    const ext = p.mime === 'image/png' ? 'png' : p.mime === 'image/webp' ? 'webp' : 'jpg';
    form.append('images', new Blob([p.bytes], { type: p.mime }), `photo-${i + 1}.${ext}`);
  });

  let res: Response;
  try {
    res = await fetch(`${CV_SERVICE_URL}/v1/health-check`, {
      method: 'POST', body: form, headers: headers(), signal: AbortSignal.timeout(CV_TIMEOUT_MS),
    });
  } catch (e) {
    const timedOut = (e as Error)?.name === 'TimeoutError';
    throw new AppError(503, timedOut
      ? 'The health check took too long. Please try again with fewer photos.'
      : 'The equipment health-check service is not running. Ask the admin to start it.', 'CV_SERVICE_UNAVAILABLE');
  }

  if (res.ok) return (await res.json()) as CvResult;

  let body: CvErrorBody = {};
  try { body = (await res.json()) as CvErrorBody; } catch { /* non-JSON */ }
  const code = body.error?.code ?? 'CV_ERROR';
  const idx = body.error?.details?.photo_index;
  const prefix = typeof idx === 'number' && photos.length > 1 ? `Photo ${idx + 1}: ` : '';
  const message = prefix + (body.error?.message ?? `Health check failed (${res.status}).`);

  // Photo problems the coordinator can fix → 422/400/413/415 pass straight through.
  if ([400, 413, 415, 422].includes(res.status)) throw new AppError(res.status, message, code);
  if (res.status === 401) {
    throw new AppError(502, 'The server and the health-check service have different CV_API_KEY values.', 'CV_MISCONFIGURED');
  }
  if (res.status === 503) throw new AppError(503, message, code);
  throw new AppError(502, 'The health-check service returned an unexpected error.', code);
}

/** GET /health of the CV service — used by the UI to show which types are ready. */
export async function cvStatus(): Promise<{ online: boolean; equipment_types?: Record<string, { ready: boolean }> }> {
  try {
    const res = await fetch(`${CV_SERVICE_URL}/health`, { headers: headers(), signal: AbortSignal.timeout(4000) });
    if (!res.ok) return { online: false };
    const body = (await res.json()) as { equipment_types: Record<string, { ready: boolean }> };
    return { online: true, equipment_types: body.equipment_types };
  } catch {
    return { online: false };
  }
}
