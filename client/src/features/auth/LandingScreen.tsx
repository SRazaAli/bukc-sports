/**
 * Landing page — the role picker.
 * Four portal tiles using the new BUKC palette (#0B3754 / #498473 / #EFF9F5).
 * Clean, institutional, fast: no animations on this page — it's the first
 * thing every user sees and needs to load instantly.
 */

import { Link } from 'react-router-dom';

interface Tile {
  label: string;
  subtitle: string;
  to: string;
  accent: string;
  icon: React.ReactNode;
}

function StudentIcon() {
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
      <circle cx="20" cy="14" r="7" fill="rgba(255,255,255,0.25)" />
      <path d="M6 34c0-7.7 6.3-12 14-12s14 4.3 14 12" fill="rgba(255,255,255,0.18)" />
      <path d="M20 2L4 10l16 8 16-8-16-8zM4 10v8" stroke="rgba(255,255,255,0.8)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function ExternalIcon() {
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
      <rect x="5" y="10" width="30" height="22" rx="3" fill="rgba(255,255,255,0.18)" />
      <line x1="5" y1="17" x2="35" y2="17" stroke="rgba(255,255,255,0.6)" strokeWidth="1.8" />
      <circle cx="12" cy="26" r="2" fill="rgba(255,255,255,0.7)" />
      <line x1="18" y1="26" x2="28" y2="26" stroke="rgba(255,255,255,0.5)" strokeWidth="1.6" />
    </svg>
  );
}
function CoordIcon() {
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
      <circle cx="16" cy="13" r="5" fill="rgba(255,255,255,0.2)" />
      <path d="M4 33c0-6 5.4-10 12-10s12 4 12 10" fill="rgba(255,255,255,0.15)" />
      <path d="M27 10a5 5 0 0 1 0 10" stroke="rgba(255,255,255,0.7)" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M34 33c0-4.5-3-8-7-9" stroke="rgba(255,255,255,0.7)" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
function AdminIcon() {
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
      <path d="M20 4l-14 6v8c0 8.8 6 17 14 20 8-3 14-11.2 14-20v-8L20 4z" fill="rgba(255,255,255,0.18)" stroke="rgba(255,255,255,0.7)" strokeWidth="1.8" strokeLinejoin="round" />
      <polyline points="13,20 18,25 28,15" stroke="rgba(255,255,255,0.9)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const TILES: Tile[] = [
  {
    label: 'Student',
    subtitle: 'Borrow equipment · Book venues',
    to: '/login/student',
    accent: '#498473',
    icon: <StudentIcon />,
  },
  {
    label: 'External',
    subtitle: 'Venue bookings for institutions',
    to: '/login/external',
    accent: '#2a6d9e',
    icon: <ExternalIcon />,
  },
  {
    label: 'Coordinator',
    subtitle: 'Manage requests · Equipment',
    to: '/login/coordinator',
    accent: '#3d5a72',
    icon: <CoordIcon />,
  },
  {
    label: 'Administration Staff',
    subtitle: 'Full platform management',
    to: '/login/admin',
    accent: '#0B3754',
    icon: <AdminIcon />,
  },
];

export default function LandingScreen() {
  return (
    <div style={s.page}>
      {/* Top bar */}
      <header style={s.topbar}>
        <div style={s.topbarInner}>
          <div style={s.logoArea}>
            <div style={s.logoMark}>B</div>
            <div>
              <div style={s.logoName}>BUKC Sports</div>
              <div style={s.logoSub}>Bahria University Karachi Campus</div>
            </div>
          </div>
        </div>
      </header>

      {/* Main */}
      <main style={s.main}>
        <div style={s.hero}>
          <h1 style={s.heroTitle}>Sports Equipment &amp; Venue Management</h1>
          <p style={s.heroSub}>
            Digital platform for equipment borrowing, venue booking, and sports records.
            Select your portal to continue.
          </p>
        </div>

        <style>{`
          @media (max-width: 900px) { .bukc-portal-grid { grid-template-columns: repeat(2, 1fr) !important; } }
          @media (max-width: 520px) { .bukc-portal-grid { grid-template-columns: 1fr !important; } }
          .bukc-portal-tile:hover { transform: translateY(-3px); box-shadow: 0 12px 32px rgba(11,55,84,0.18) !important; }
          .bukc-portal-tile .tile-btn:hover { background: rgba(255,255,255,0.28) !important; }
        `}</style>
        <div style={s.grid} className="bukc-portal-grid">
          {TILES.map((tile) => (
            <div key={tile.label} style={{ ...s.tile, background: tile.accent }} className="bukc-portal-tile">
              <div style={s.tileIcon}>{tile.icon}</div>
              <div style={s.tileLabel}>{tile.label}</div>
              <div style={s.tileSub}>{tile.subtitle}</div>
              <Link to={tile.to} style={s.tileBtn} className="tile-btn">
                Sign In →
              </Link>
            </div>
          ))}
        </div>
      </main>

      <footer style={s.footer}>
        <span>© 2026 Bahria University Karachi Campus — Sports Department</span>
      </footer>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100%',
    display: 'flex',
    flexDirection: 'column',
    background: 'var(--bg)',
  },
  topbar: {
    background: 'var(--navy)',
    borderBottom: '1px solid rgba(255,255,255,0.08)',
  },
  topbarInner: {
    maxWidth: 1100,
    margin: '0 auto',
    padding: '0 var(--sp-5)',
    height: 60,
    display: 'flex',
    alignItems: 'center',
  },
  logoArea: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  },
  logoMark: {
    width: 36,
    height: 36,
    borderRadius: 8,
    background: 'var(--teal)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    font: '700 18px var(--font-display)',
    color: '#fff',
    flexShrink: 0,
  },
  logoName: {
    font: '600 15px/1 var(--font-display)',
    color: '#fff',
    letterSpacing: '0.01em',
  },
  logoSub: {
    font: '11px/1 var(--font-body)',
    color: 'rgba(255,255,255,0.5)',
    marginTop: 4,
  },
  main: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: 'var(--sp-10) var(--sp-5)',
  },
  hero: {
    textAlign: 'center',
    maxWidth: 560,
    marginBottom: 'var(--sp-8)',
  },
  heroTitle: {
    font: '700 32px/1.2 var(--font-display)',
    color: 'var(--navy)',
    margin: '0 0 var(--sp-3)',
    letterSpacing: '-0.01em',
  },
  heroSub: {
    font: '15px/1.6 var(--font-body)',
    color: 'var(--ink-muted)',
    margin: 0,
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: 'var(--sp-4)',
    width: '100%',
    maxWidth: 1040,
  },
  tile: {
    borderRadius: 'var(--radius-xl)',
    padding: 'var(--sp-6) var(--sp-5)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 'var(--sp-2)',
    boxShadow: 'var(--shadow-md)',
    transition: 'transform var(--t-base) var(--ease), box-shadow var(--t-base) var(--ease)',
    cursor: 'default',
  },
  tileIcon: {
    marginBottom: 'var(--sp-2)',
  },
  tileLabel: {
    font: '700 20px/1.2 var(--font-display)',
    color: '#fff',
    letterSpacing: '-0.01em',
  },
  tileSub: {
    font: '13px/1.5 var(--font-body)',
    color: 'rgba(255,255,255,0.65)',
    marginBottom: 'var(--sp-3)',
  },
  tileBtn: {
    display: 'inline-block',
    background: 'rgba(255,255,255,0.18)',
    border: '1px solid rgba(255,255,255,0.28)',
    borderRadius: 'var(--radius)',
    padding: '8px 18px',
    font: '600 13.5px var(--font-body)',
    color: '#fff',
    textDecoration: 'none',
    transition: 'background var(--t-fast)',
    backdropFilter: 'blur(4px)',
  },
  footer: {
    borderTop: '1px solid var(--line)',
    padding: 'var(--sp-4) var(--sp-5)',
    font: '12px var(--font-body)',
    color: 'var(--ink-muted)',
    textAlign: 'center',
  },
};
