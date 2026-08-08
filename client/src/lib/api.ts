/**
 * API client. Implements the confirmed auth model:
 *  - access token held in memory only (never localStorage — XSS-safe)
 *  - refresh token in an HTTP-only cookie (sent automatically with credentials)
 *  - on a 401 from an AUTHENTICATED call, transparently try /api/auth/refresh
 *    once, then retry the request
 *
 * Feature routers add typed wrappers over `api()`; this is the transport.
 *
 * Cross-tab caveat (by design of HTTP cookies, not fixable in app code): the
 * refresh cookie lives at the browser/origin level, not per-tab. If a Super
 * Admin is signed in on one tab and a Coordinator signs in on another tab of
 * the SAME browser, that second login overwrites the ONE shared cookie. We
 * can't make two simultaneous different logins coexist in tabs of one
 * browser (that would need separate cookie jars — separate browser profiles
 * / an Incognito window / a different browser altogether), but we CAN detect
 * when a refresh comes back as a different identity than this tab itself
 * believes it is, and force a clean, explicit sign-out instead of silently
 * swapping the dashboard underneath the user. Two places this can surface,
 * both guarded below:
 *  1. Mid-session: this tab's access token expires, a request 401s, the
 *     transparent retry silently refreshes — but the shared cookie now
 *     belongs to whoever logged in on another tab since.
 *  2. On reload: a plain in-memory "who am I" flag resets to nothing on
 *     every page load, so a naive bootstrap refresh has nothing to compare
 *     against and would silently accept whatever the (possibly since-
 *     overwritten) cookie says. sessionStorage — unlike a JS module
 *     variable — survives a reload but, unlike cookies/localStorage, is
 *     genuinely isolated per tab, so it's exactly the right place to
 *     remember "what THIS tab itself last confirmed being logged in as."
 */
const API_BASE = import.meta.env.VITE_API_BASE ?? '';
const TAB_USER_KEY = 'bukc:tabUserId';

let accessToken: string | null = null;
let currentUserId: string | null = readTabUserId();

function readTabUserId(): string | null {
  try {
    return sessionStorage.getItem(TAB_USER_KEY);
  } catch {
    return null; // sessionStorage can throw in some locked-down contexts
  }
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
}
export function getAccessToken(): string | null {
  return accessToken;
}

/** Record which identity THIS tab believes it's authenticated as — persisted
 *  per-tab so it survives a reload (see the file header for why). */
export function setCurrentUserId(userId: string | null): void {
  currentUserId = userId;
  try {
    if (userId) sessionStorage.setItem(TAB_USER_KEY, userId);
    else sessionStorage.removeItem(TAB_USER_KEY);
  } catch {
    /* ignore — in-memory value still works for this page's lifetime */
  }
}

export const SESSION_REPLACED_EVENT = 'bukc:session-replaced';

export interface ApiError {
  error: string;
  code?: string;
}

export class ApiRequestError extends Error {
  constructor(
    public status: number,
    public body: ApiError,
  ) {
    super(body.error);
    this.name = 'ApiRequestError';
  }
}

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  /** internal: prevents infinite refresh loops */
  _isRetry?: boolean;
}

export interface RefreshResult {
  accessToken: string;
  user: { userId: string; role: string; fullName: string; email: string };
}

// Refresh tokens rotate on every use (AUTH-09) — a second concurrent call
// starting from the same cookie loses the race against the first and fails,
// even though the first succeeded. This can happen two ways: several api()
// calls hitting 401 around the same moment (e.g. a screen firing parallel
// requests right as the access token expires), or React StrictMode's
// intentional double-invoke of effects on mount in dev. Every caller within
// the same tick shares one in-flight request instead of starting its own.
let inFlightRefresh: Promise<RefreshResult | null> | null = null;

function rawRefresh(): Promise<RefreshResult | null> {
  if (!inFlightRefresh) {
    inFlightRefresh = fetch(`${API_BASE}/api/auth/refresh`, { method: 'POST', credentials: 'include' })
      .then(async (res) => (res.ok ? (await res.json()) as RefreshResult : null))
      .catch(() => null)
      .finally(() => { inFlightRefresh = null; });
  }
  return inFlightRefresh;
}

/**
 * The one function anything should call to (re)establish a session — the
 * app-load bootstrap AND the transparent 401-retry both go through this, so
 * the cross-tab mismatch check applies uniformly everywhere a refresh can
 * happen, not just one of the two paths. If this tab has a previously-
 * confirmed identity (from sessionStorage, so this also catches a reload)
 * and the refresh comes back as someone else, that's a replaced session —
 * clear everything and signal it rather than silently adopting the new
 * identity. A tab with no prior identity yet (genuinely first load) has
 * nothing to compare against, so whatever the cookie says becomes this tab's
 * starting point, same as before.
 */
export async function refreshSession(): Promise<RefreshResult | null> {
  const result = await rawRefresh();
  if (result && currentUserId && result.user.userId !== currentUserId) {
    setAccessToken(null);
    setCurrentUserId(null);
    window.dispatchEvent(new CustomEvent(SESSION_REPLACED_EVENT));
    return null;
  }
  return result;
}

export async function api<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { body, _isRetry, headers, ...rest } = opts;
  // Captured before the request fires — this is what decides whether a 401
  // response even COULD mean "your token expired." A request made with no
  // access token attached (login, register, forgot-password, ...) getting a
  // 401 means "wrong credentials" or "not authorized," full stop — there is
  // no token to have expired, so a silent refresh-and-retry here would be
  // both meaningless and actively dangerous (it can silently adopt whatever
  // identity happens to be sitting in the shared browser cookie from a
  // completely unrelated tab, on a page where the user hasn't even
  // successfully logged in yet).
  const hadAuthHeader = Boolean(accessToken);

  const res = await fetch(`${API_BASE}${path}`, {
    ...rest,
    credentials: 'include',
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  // transparent refresh on expired access token — only meaningful for a
  // request that was actually authenticated to begin with
  if (res.status === 401 && !_isRetry && hadAuthHeader) {
    const refreshed = await refreshSession();
    if (refreshed) {
      setAccessToken(refreshed.accessToken);
      return api<T>(path, { ...opts, _isRetry: true });
    }
    setAccessToken(null);
  }

  if (!res.ok) {
    let errBody: ApiError = { error: `Request failed (${res.status})` };
    try {
      errBody = (await res.json()) as ApiError;
    } catch {
      /* non-JSON error */
    }
    throw new ApiRequestError(res.status, errBody);
  }

  // 204 / empty
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
