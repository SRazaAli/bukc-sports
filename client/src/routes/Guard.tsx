/**
 * Route guards. RequireAuth gates on being logged in; RequireRole gates on role.
 * These mirror the server's requireAuth/requireRole — the client hides what the
 * server would refuse, so the UI never dead-ends a user into a 403.
 */
import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth, type UserRole } from '../lib/auth.js';

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <FullPageLoading />;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export function RequireRole({ roles, children }: { roles: UserRole[]; children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <FullPageLoading />;
  if (!user) return <Navigate to="/login" replace />;
  if (!roles.includes(user.role)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function FullPageLoading() {
  return (
    <div style={{ display: 'grid', placeItems: 'center', height: '100%', color: 'var(--muted)' }}>
      Loading…
    </div>
  );
}
