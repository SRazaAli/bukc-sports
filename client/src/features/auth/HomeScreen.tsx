/**
 * Signed-in home. Role-aware landing after login.
 */
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth.js';
import { PortalShell, PrimaryButton, type BarTint } from './PortalShell.js';

const TINT_BY_ROLE: Record<string, BarTint> = {
  STUDENT: 'sage',
  EXTERNAL: 'blue',
  COORDINATOR: 'slate',
  SUPER_ADMIN: 'navy',
};

const ROLE_LABEL: Record<string, string> = {
  STUDENT: 'Student',
  EXTERNAL: 'External',
  COORDINATOR: 'Coordinator',
  SUPER_ADMIN: 'Administration Staff',
};

export default function HomeScreen() {
  const { user, loading, logout } = useAuth();
  const navigate = useNavigate();

  if (loading) return <PortalShell title="…"><p /></PortalShell>;
  if (!user) return <Navigate to="/" replace />;

  const tint = TINT_BY_ROLE[user.role] ?? 'navy';

  return (
    <PortalShell title={ROLE_LABEL[user.role] ?? 'Home'} tint={tint}>
      <div style={{ maxWidth: 560, margin: '0 auto' }}>
        <div style={card}>
          <p style={{ margin: 0, color: '#5c6773', fontSize: 14 }}>Signed in as</p>
          <h2 style={{ margin: '4px 0 2px', font: '600 22px var(--font-display)', color: '#26485f' }}>
            {user.fullName}
          </h2>
          <p style={{ margin: 0, color: '#5c6773', fontSize: 14 }}>{user.email} · {ROLE_LABEL[user.role]}</p>

          <div style={{ marginTop: 22, display: 'grid', gap: 10 }}>
            <PrimaryButton onClick={() => navigate('/profile')}>My Profile</PrimaryButton>
            {user.role === 'SUPER_ADMIN' && (
              <PrimaryButton onClick={() => navigate('/dashboard')}>Admin Dashboard</PrimaryButton>
            )}
            {user.role === 'SUPER_ADMIN' && (
              <PrimaryButton onClick={() => navigate('/admin/accounts')}>Manage Accounts</PrimaryButton>
            )}
            {user.role === 'COORDINATOR' && (
              <PrimaryButton onClick={() => navigate('/admin/accounts')}>View Accounts</PrimaryButton>
            )}
            {(user.role === 'SUPER_ADMIN' || user.role === 'COORDINATOR') && (
              <PrimaryButton onClick={() => navigate('/inventory')}>Inventory</PrimaryButton>
            )}
            <PrimaryButton onClick={() => navigate('/availability')}>Equipment Availability</PrimaryButton>
            {user.role === 'COORDINATOR' && (
              <PrimaryButton onClick={() => navigate('/borrow-queue')}>Borrow Queue</PrimaryButton>
            )}
            {(user.role === 'SUPER_ADMIN' || user.role === 'COORDINATOR') && (
              <PrimaryButton onClick={() => navigate('/active-borrows')}>Active Borrows</PrimaryButton>
            )}
            {(user.role === 'STUDENT' || user.role === 'EXTERNAL') && (
              <PrimaryButton onClick={() => navigate('/book-venue')}>Book a Venue</PrimaryButton>
            )}
            {user.role === 'COORDINATOR' && (
              <>
                <PrimaryButton onClick={() => navigate('/venue-queue')}>Venue Queue</PrimaryButton>
                <PrimaryButton onClick={() => navigate('/equipment-alerts')}>Equipment Alerts</PrimaryButton>
              </>
            )}
            {user.role === 'SUPER_ADMIN' && (
              <PrimaryButton onClick={() => navigate('/venue-approvals')}>Venue Approvals</PrimaryButton>
            )}
            {/* Feature 9: Conflict Detection & Resolution — Coordinator + Super Admin */}
            {(user.role === 'SUPER_ADMIN' || user.role === 'COORDINATOR') && (
              <PrimaryButton onClick={() => navigate('/conflict-detection')}>Conflict Detection</PrimaryButton>
            )}
            <PrimaryButton onClick={() => navigate('/calendar')}>Calendar</PrimaryButton>
            <PrimaryButton onClick={() => navigate('/usage-history')}>Usage History</PrimaryButton>
            {(user.role === 'SUPER_ADMIN' || user.role === 'COORDINATOR') && (
              <PrimaryButton onClick={() => navigate('/offline-fallback')}>Offline Fallback Entry</PrimaryButton>
            )}
            <button style={signout} onClick={() => { void logout(); navigate('/'); }}>Sign out</button>
          </div>

          <p style={{ marginTop: 20, marginBottom: 0, color: '#8a949f', fontSize: 13, lineHeight: 1.5 }}>
            More features — venue booking, equipment, calendar — arrive in the next milestones.
          </p>
        </div>
      </div>
    </PortalShell>
  );
}

const card: React.CSSProperties = {
  background: '#fff', border: '1px solid #ddd', borderRadius: 4,
  padding: 28, boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
};
const signout: React.CSSProperties = {
  background: '#fff', color: '#555', border: '1px solid #ccc',
  borderRadius: 4, padding: '10px 20px', fontSize: 14.5, cursor: 'pointer',
};
