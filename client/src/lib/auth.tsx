/**
 * Auth context. Holds the current user in memory, exposes login/logout, and on
 * app load attempts a silent refresh (the HTTP-only cookie survives reloads even
 * though the in-memory access token does not).
 *
 * The concrete login/logout API calls are filled in with Feature 1; this shape
 * is what every screen depends on.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, setAccessToken, setCurrentUserId, refreshSession, SESSION_REPLACED_EVENT } from './api.js';

export type UserRole = 'SUPER_ADMIN' | 'COORDINATOR' | 'STUDENT' | 'EXTERNAL';

export interface CurrentUser {
  userId: string;
  role: UserRole;
  fullName: string;
  email: string;
}

interface AuthContextValue {
  user: CurrentUser | null;
  loading: boolean;
  setUser: (u: CurrentUser | null) => void;
  logout: () => Promise<void>;
  /** Set when this tab's session was silently replaced by a different login
   *  on another tab of the same browser (see api.ts for why this can happen
   *  — one shared refresh cookie per browser, not per tab). Show this,
   *  then clear it once acknowledged. */
  sessionReplacedNotice: boolean;
  clearSessionReplacedNotice: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionReplacedNotice, setSessionReplacedNotice] = useState(false);

  function setUser(u: CurrentUser | null) {
    setCurrentUserId(u?.userId ?? null);
    setUserState(u);
  }

  // On load: try to restore a session via the refresh cookie. refreshSession()
  // is shared/deduplicated in api.ts, so this is safe even under React
  // StrictMode's double effect invocation in dev (see api.ts for why that
  // matters with rotating refresh tokens).
  useEffect(() => {
    let cancelled = false;
    refreshSession().then((data) => {
      if (cancelled) return;
      if (data) {
        setAccessToken(data.accessToken);
        setUser(data.user as CurrentUser);
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // A background token refresh (api.ts) detected this tab's session was
  // silently replaced by a different login elsewhere in the same browser —
  // clear everything and tell the person plainly, rather than letting them
  // keep acting as if they're still the account they started as.
  useEffect(() => {
    function onReplaced() {
      setUserState(null);
      setSessionReplacedNotice(true);
    }
    window.addEventListener(SESSION_REPLACED_EVENT, onReplaced);
    return () => window.removeEventListener(SESSION_REPLACED_EVENT, onReplaced);
  }, []);

  async function logout() {
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } finally {
      setAccessToken(null);
      setUser(null);
    }
  }

  return (
    <AuthContext.Provider value={{
      user, loading, setUser, logout,
      sessionReplacedNotice, clearSessionReplacedNotice: () => setSessionReplacedNotice(false),
    }}>
      {sessionReplacedNotice && (
        <div style={bannerStyle}>
          <span>
            You were signed out — a different account signed in on another tab of this browser
            (the login session is shared per browser, not per tab). Please sign in again.
          </span>
          <button onClick={() => setSessionReplacedNotice(false)} style={bannerCloseStyle} aria-label="Dismiss">×</button>
        </div>
      )}
      {children}
    </AuthContext.Provider>
  );
}

const bannerStyle: React.CSSProperties = {
  position: 'fixed', top: 0, left: 0, right: 0, zIndex: 2000,
  background: '#fdf1e3', color: '#8a4413', borderBottom: '1px solid #f3d3ba',
  padding: '10px 20px', fontSize: 13.5, display: 'flex', alignItems: 'center',
  justifyContent: 'center', gap: 16, textAlign: 'center',
};
const bannerCloseStyle: React.CSSProperties = {
  background: 'none', border: 'none', fontSize: 18, lineHeight: 1, color: '#8a4413', cursor: 'pointer', padding: 0,
};

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
