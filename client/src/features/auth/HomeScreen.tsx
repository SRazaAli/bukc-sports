/**
 * Signed-in home. Role-aware landing after login, redesigned as a feature
 * card grid (same visual language as LandingScreen/AuthUI) instead of the
 * old stacked full-width button list.
 *
 * Frontend-only change: the exact same feature set, same conditions per
 * role, and same destination routes as before — just re-laid-out as cards.
 * Sign-out still calls the same `logout()` from useAuth(); no auth/session
 * logic touched. PortalShell.tsx (used by Profile/AdminAccounts/AcceptInvite)
 * is untouched — this screen no longer uses it.
 */
import type { ReactNode } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth.js';
import { palette, ROLE_THEME, type PortalKey } from './AuthUI.js';

type Role = 'STUDENT' | 'EXTERNAL' | 'COORDINATOR' | 'SUPER_ADMIN';

const ROLE_LABEL: Record<Role, string> = {
  STUDENT: 'Student',
  EXTERNAL: 'External',
  COORDINATOR: 'Coordinator',
  SUPER_ADMIN: 'Administration Staff',
};

const ROLE_PORTAL: Record<Role, PortalKey> = {
  STUDENT: 'student',
  EXTERNAL: 'external',
  COORDINATOR: 'coordinator',
  SUPER_ADMIN: 'admin',
};

interface Feature {
  key: string;
  label: string;
  to: string;
  description: string;
  icon: ReactNode;
}

/** Same routes, same per-role conditions, same order as the original HomeScreen. */
function getFeatures(role: Role): Feature[] {
  const features: Feature[] = [];
  const push = (f: Feature) => features.push(f);

  push({ key: 'profile', label: 'My Profile', to: '/profile', description: 'View and update your account details.', icon: <ProfileIcon /> });

  if (role === 'SUPER_ADMIN') {
    push({ key: 'dashboard', label: 'Admin Dashboard', to: '/dashboard', description: 'Platform-wide metrics and activity at a glance.', icon: <DashboardIcon /> });
    push({ key: 'manage-accounts', label: 'Manage Accounts', to: '/admin/accounts', description: 'Approve, edit, and manage every account.', icon: <PeopleIcon /> });
  }
  if (role === 'COORDINATOR') {
    push({ key: 'view-accounts', label: 'View Accounts', to: '/admin/accounts', description: 'Browse verified accounts across the platform.', icon: <EyeIcon /> });
  }
  if (role === 'SUPER_ADMIN' || role === 'COORDINATOR') {
    push({ key: 'inventory', label: 'Inventory', to: '/inventory', description: 'Track all sports equipment stock.', icon: <BoxIcon /> });
  }

  push({ key: 'availability', label: 'Equipment Availability', to: '/availability', description: "Check what's available to borrow right now.", icon: <ToolIcon /> });

  if (role === 'COORDINATOR') {
    push({ key: 'borrow-queue', label: 'Borrow Queue', to: '/borrow-queue', description: 'Review and process pending borrow requests.', icon: <QueueIcon /> });
  }
  if (role === 'SUPER_ADMIN' || role === 'COORDINATOR') {
    push({ key: 'active-borrows', label: 'Active Borrows', to: '/active-borrows', description: 'See equipment currently checked out.', icon: <ClipboardIcon /> });
  }
  if (role === 'STUDENT' || role === 'EXTERNAL') {
    push({ key: 'book-venue', label: 'Book a Venue', to: '/book-venue', description: 'Reserve a court or venue for your activity.', icon: <PinIcon /> });
  }
  if (role === 'COORDINATOR') {
    push({ key: 'venue-queue', label: 'Venue Queue', to: '/venue-queue', description: 'Manage pending venue booking requests.', icon: <QueueIcon /> });
    push({ key: 'equipment-alerts', label: 'Equipment Alerts', to: '/equipment-alerts', description: 'Stay on top of overdue or low-stock alerts.', icon: <BellIcon /> });
  }
  if (role === 'SUPER_ADMIN') {
    push({ key: 'venue-approvals', label: 'Venue Approvals', to: '/venue-approvals', description: 'Approve or decline pending venue requests.', icon: <ShieldCheckIcon /> });
  }
  if (role === 'SUPER_ADMIN' || role === 'COORDINATOR') {
    push({ key: 'conflict-detection', label: 'Conflict Detection', to: '/conflict-detection', description: 'Spot and resolve scheduling conflicts.', icon: <AlertIcon /> });
  }

  push({ key: 'calendar', label: 'Calendar', to: '/calendar', description: 'See all bookings and events in one view.', icon: <CalendarIcon /> });
  push({ key: 'usage-history', label: 'Usage History', to: '/usage-history', description: 'Review past bookings and borrow records.', icon: <HistoryIcon /> });

  if (role === 'SUPER_ADMIN' || role === 'COORDINATOR') {
    push({ key: 'offline-fallback', label: 'Offline Fallback Entry', to: '/offline-fallback', description: 'Log activity manually when offline.', icon: <WifiOffIcon /> });
  }

  return features;
}

export default function HomeScreen() {
  const { user, loading, logout } = useAuth();
  const navigate = useNavigate();

  if (loading) {
    return (
      <div className="auth-ui" style={s.page}>
        <HomeStyles />
      </div>
    );
  }
  if (!user) return <Navigate to="/" replace />;

  const role = (user.role in ROLE_LABEL ? user.role : 'SUPER_ADMIN') as Role;
  const label = ROLE_LABEL[role];
  const theme = ROLE_THEME[ROLE_PORTAL[role]];
  const features = getFeatures(role);

  return (
    <div className="auth-ui" style={s.page}>
      <HomeStyles />

      <header style={s.topbar}>
        <div style={s.brand}>
          <span style={{ ...s.logoMark, background: theme.solid }}>BU</span>
          <span style={s.wordmark}>Bahria University</span>
        </div>
        <button
          type="button"
          className="home-signout"
          style={s.signOutBtn}
          onClick={() => { void logout(); navigate('/'); }}
        >
          <SignOutIcon /> Sign out
        </button>
      </header>

      <main style={s.main}>
        <div style={s.heroBlobA} aria-hidden />
        <div style={s.heroBlobB} aria-hidden />

        <div style={s.hero}>
          <span style={{ ...s.heroEyebrow, color: theme.solid, background: theme.soft }}>{label} Portal</span>
          <h1 style={s.heroTitle}>Welcome back, {firstName(user.fullName)}.</h1>
          <p style={s.heroSubtitle}>{user.email} · {label}</p>
        </div>

        <div style={s.grid}>
          {features.map((f, i) => (
            <Link
              key={f.key}
              to={f.to}
              className="home-tile"
              style={{ ...s.tile, animationDelay: `${i * 45}ms` }}
            >
              <div style={{ ...s.tileGlow, background: `linear-gradient(135deg, ${theme.from}, ${theme.to})` }} />
              <div style={{ ...s.tileIcon, background: `linear-gradient(135deg, ${theme.from}, ${theme.to})` }}>
                {f.icon}
              </div>
              <h2 style={s.tileLabel}>{f.label}</h2>
              <p style={s.tileDesc}>{f.description}</p>
              <span className="home-tile-cta" style={{ ...s.tileCta, color: theme.solid }}>
                Open <ArrowIcon />
              </span>
            </Link>
          ))}
        </div>

        <p style={s.moreNote}>More features — venue booking, equipment, calendar — arrive in the next milestones.</p>
      </main>

      <footer style={s.footer}>
        2026 © <a href="/" style={s.footerLink}>Bahria University</a> — Sports Management Portal
      </footer>
    </div>
  );
}

function firstName(fullName: string) {
  return fullName.trim().split(/\s+/)[0] || fullName;
}

function HomeStyles() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@600;700;800&family=Inter:wght@400;500;600;700&display=swap');
      .auth-ui { font-family: 'Inter', 'Segoe UI', system-ui, sans-serif; }
      .home-tile {
        opacity: 0; animation: homeIn .5s ease forwards;
        text-decoration: none; transition: transform .2s ease, box-shadow .2s ease;
      }
      .home-tile:hover { transform: translateY(-6px); box-shadow: 0 24px 40px -18px rgba(11,55,84,0.28); }
      .home-tile:hover .home-tile-cta { gap: 8px; }
      .home-tile-cta { display: inline-flex; align-items: center; gap: 4px; transition: gap .2s ease; }
      @keyframes homeIn { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
      .home-signout { transition: background-color .15s ease, border-color .15s ease, color .15s ease; }
      .home-signout:hover { background: #FDECEC; border-color: #F3CACA; color: #8F2323; }
      @media (max-width: 720px) {
        .home-grid-mq { grid-template-columns: 1fr !important; }
      }
      @media (prefers-reduced-motion: reduce) {
        .home-tile { animation: none !important; opacity: 1 !important; }
      }
    `}</style>
  );
}

/* ---------- icons (24px, stroke, currentColor via #fff on tinted bg) ---------- */
function ProfileIcon() { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="3.4" stroke="#fff" strokeWidth="1.6"/><path d="M5 20c1-3.5 4-5.5 7-5.5s6 2 7 5.5" stroke="#fff" strokeWidth="1.6" strokeLinecap="round"/></svg>; }
function DashboardIcon() { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><rect x="3.5" y="3.5" width="7" height="7" rx="1.4" stroke="#fff" strokeWidth="1.6"/><rect x="13.5" y="3.5" width="7" height="4.5" rx="1.4" stroke="#fff" strokeWidth="1.6"/><rect x="13.5" y="10.5" width="7" height="10" rx="1.4" stroke="#fff" strokeWidth="1.6"/><rect x="3.5" y="13" width="7" height="7.5" rx="1.4" stroke="#fff" strokeWidth="1.6"/></svg>; }
function PeopleIcon() { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><circle cx="9" cy="8" r="3" stroke="#fff" strokeWidth="1.6"/><path d="M3 20c.8-3.2 3-5 6-5s5.2 1.8 6 5" stroke="#fff" strokeWidth="1.6" strokeLinecap="round"/><circle cx="17" cy="8" r="2.4" stroke="#fff" strokeWidth="1.5"/><path d="M15.5 12.2c2.4.3 4 1.8 4.5 4.3" stroke="#fff" strokeWidth="1.5" strokeLinecap="round"/></svg>; }
function EyeIcon() { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" stroke="#fff" strokeWidth="1.6" strokeLinejoin="round"/><circle cx="12" cy="12" r="2.6" stroke="#fff" strokeWidth="1.6"/></svg>; }
function BoxIcon() { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M3.5 7.5 12 3.5l8.5 4v9L12 20.5l-8.5-4v-9z" stroke="#fff" strokeWidth="1.6" strokeLinejoin="round"/><path d="M3.7 7.6 12 11.5l8.3-3.9M12 11.5v9" stroke="#fff" strokeWidth="1.6" strokeLinejoin="round"/></svg>; }
function ToolIcon() { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M14.7 6.3a3.6 3.6 0 0 1-4.9 4.4L4.5 16l1.9 1.9 5.4-5.3a3.6 3.6 0 0 1 4.4-4.9l-1.9 1.9-1.6-1.6 1.9-1.9z" stroke="#fff" strokeWidth="1.5" strokeLinejoin="round"/></svg>; }
function QueueIcon() { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M4 6.5h16M4 12h16M4 17.5h10" stroke="#fff" strokeWidth="1.6" strokeLinecap="round"/></svg>; }
function ClipboardIcon() { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><rect x="5" y="4.5" width="14" height="16" rx="1.6" stroke="#fff" strokeWidth="1.6"/><rect x="8.5" y="3" width="7" height="3" rx="1" stroke="#fff" strokeWidth="1.6"/><path d="M8.5 11.5h7M8.5 15.5h7" stroke="#fff" strokeWidth="1.6" strokeLinecap="round"/></svg>; }
function PinIcon() { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M12 21s7-6.4 7-11.5a7 7 0 1 0-14 0C5 14.6 12 21 12 21z" stroke="#fff" strokeWidth="1.6" strokeLinejoin="round"/><circle cx="12" cy="9.3" r="2.4" stroke="#fff" strokeWidth="1.6"/></svg>; }
function BellIcon() { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M6 16V10a6 6 0 0 1 12 0v6l1.6 2.3H4.4L6 16z" stroke="#fff" strokeWidth="1.6" strokeLinejoin="round"/><path d="M9.5 20.5a2.5 2.5 0 0 0 5 0" stroke="#fff" strokeWidth="1.6" strokeLinecap="round"/></svg>; }
function ShieldCheckIcon() { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M12 3.5l7 2.8v6c0 4.6-3 7.8-7 9.2-4-1.4-7-4.6-7-9.2v-6l7-2.8z" stroke="#fff" strokeWidth="1.6" strokeLinejoin="round"/><path d="M9 12l2 2 4-4.2" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>; }
function AlertIcon() { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M12 3.5 21.5 20h-19L12 3.5z" stroke="#fff" strokeWidth="1.6" strokeLinejoin="round"/><path d="M12 10v4.2" stroke="#fff" strokeWidth="1.6" strokeLinecap="round"/><circle cx="12" cy="17" r="0.9" fill="#fff"/></svg>; }
function CalendarIcon() { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><rect x="4" y="5.5" width="16" height="14.5" rx="1.8" stroke="#fff" strokeWidth="1.6"/><path d="M4 9.5h16M8 3.5v4M16 3.5v4" stroke="#fff" strokeWidth="1.6" strokeLinecap="round"/></svg>; }
function HistoryIcon() { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="13" r="7.5" stroke="#fff" strokeWidth="1.6"/><path d="M12 9v4.2l3 1.8" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/><path d="M8.5 3.5A9.6 9.6 0 0 0 4.3 7" stroke="#fff" strokeWidth="1.6" strokeLinecap="round"/></svg>; }
function WifiOffIcon() { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M3 8.5c2.6-2.2 6-3.3 9-3.3M21 8.5c-1.3-1.1-2.8-1.9-4.4-2.5M6.5 12.3c1.6-1.2 3.5-1.8 5.5-1.8M17.5 12.3a9 9 0 0 0-2-1.4" stroke="#fff" strokeWidth="1.6" strokeLinecap="round"/><path d="M9.8 16a4.8 4.8 0 0 1 4.4 0" stroke="#fff" strokeWidth="1.6" strokeLinecap="round"/><circle cx="12" cy="19" r="1" fill="#fff"/><path d="M2.5 3 21.5 21" stroke="#fff" strokeWidth="1.6" strokeLinecap="round"/></svg>; }
function ArrowIcon() { return <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>; }
function SignOutIcon() { return <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M6.5 2H3.5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><path d="M10.5 5 14 8l-3.5 3M14 8H6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>; }

const s = {
  page: {
    minHeight: '100%', display: 'flex', flexDirection: 'column',
    background: `radial-gradient(1200px 600px at 10% -10%, ${palette.sky100} 0%, transparent 55%),
                 radial-gradient(1000px 600px at 100% 0%, ${palette.mint100} 0%, transparent 55%),
                 ${palette.mint50}`,
  } as const,
  topbar: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '20px 40px', borderBottom: `1px solid ${palette.line}`,
  } as const,
  brand: { display: 'flex', alignItems: 'center', gap: 10 } as const,
  logoMark: {
    width: 32, height: 32, borderRadius: 9, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    color: '#fff', fontFamily: 'Poppins, sans-serif', fontWeight: 800, fontSize: 13,
  } as const,
  wordmark: { fontFamily: 'Poppins, serif', fontSize: 18, fontWeight: 600, color: palette.navy } as const,
  signOutBtn: {
    display: 'inline-flex', alignItems: 'center', gap: 7, background: '#fff', color: palette.muted,
    border: `1.5px solid ${palette.line}`, borderRadius: 999, padding: '8px 16px', fontSize: 13.5, fontWeight: 700,
    cursor: 'pointer', fontFamily: 'inherit',
  } as const,
  main: { flex: 1, position: 'relative', padding: '48px 24px 40px', display: 'flex', flexDirection: 'column', alignItems: 'center', overflow: 'hidden' } as const,
  heroBlobA: { position: 'absolute', width: 340, height: 340, borderRadius: '50%', background: `${palette.teal}22`, top: -140, left: -100, filter: 'blur(10px)' } as const,
  heroBlobB: { position: 'absolute', width: 300, height: 300, borderRadius: '50%', background: `${palette.navy}18`, bottom: -160, right: -80, filter: 'blur(10px)' } as const,
  hero: { textAlign: 'center', maxWidth: 640, marginBottom: 40, position: 'relative' } as const,
  heroEyebrow: {
    display: 'inline-block', fontSize: 12.5, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase',
    padding: '6px 14px', borderRadius: 999, marginBottom: 18,
  } as const,
  heroTitle: { fontFamily: 'Poppins, sans-serif', fontSize: 32, lineHeight: 1.25, fontWeight: 700, color: palette.navy, margin: '0 0 8px' } as const,
  heroSubtitle: { fontSize: 14.5, color: palette.muted, margin: 0 } as const,
  grid: {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 18,
    width: '100%', maxWidth: 1040, position: 'relative',
  } as const,
  tile: {
    position: 'relative', background: '#fff', border: `1px solid ${palette.line}`, borderRadius: 18,
    padding: '24px 22px', display: 'flex', flexDirection: 'column', gap: 4, overflow: 'hidden',
  } as const,
  tileGlow: { position: 'absolute', top: -50, right: -50, width: 120, height: 120, borderRadius: '50%', opacity: 0.1, filter: 'blur(6px)' } as const,
  tileIcon: {
    width: 44, height: 44, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center',
    marginBottom: 12, boxShadow: '0 10px 18px -10px rgba(11,55,84,0.5)',
  } as const,
  tileLabel: { fontFamily: 'Poppins, sans-serif', fontSize: 16.5, fontWeight: 700, color: palette.ink, margin: '0 0 5px' } as const,
  tileDesc: { fontSize: 13, lineHeight: 1.5, color: palette.muted, margin: '0 0 14px', flex: 1 } as const,
  tileCta: { fontSize: 13, fontWeight: 700 } as const,
  moreNote: { marginTop: 30, fontSize: 12.5, color: palette.muted, textAlign: 'center', maxWidth: 480 } as const,
  footer: { textAlign: 'center', padding: '20px 24px', fontSize: 12.5, color: palette.muted, borderTop: `1px solid ${palette.line}` } as const,
  footerLink: { color: palette.navy, textDecoration: 'none', fontWeight: 600 } as const,
};
