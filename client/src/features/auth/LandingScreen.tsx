/**
 * Landing page — the role picker, matching the BUKC portal's tile grid concept
 * (Student / External / Coordinator / Administration Staff), redesigned around
 * the brand palette instead of four flat, arbitrarily-colored blocks.
 */
import { Link } from 'react-router-dom';
import { palette, ROLE_THEME, type PortalKey } from './AuthUI.js';

interface Tile {
  key: PortalKey;
  label: string;
  to: string;
  description: string;
  icon: JSX.Element;
}

const TILES: Tile[] = [
  {
    key: 'student', label: 'Student', to: '/login/student',
    description: 'Book venues and borrow sports equipment with your enrollment number.',
    icon: <GraduationIcon />,
  },
  {
    key: 'external', label: 'External', to: '/login/external',
    description: 'Request venues on behalf of a partner institution or organization.',
    icon: <GlobeIcon />,
  },
  {
    key: 'coordinator', label: 'Coordinator', to: '/login/coordinator',
    description: 'Manage borrow queues, venue conflicts, and equipment alerts.',
    icon: <WhistleIcon />,
  },
  {
    key: 'admin', label: 'Administration Staff', to: '/login/admin',
    description: 'Full oversight — accounts, approvals, and platform activity.',
    icon: <ShieldIcon />,
  },
];

export default function LandingScreen() {
  return (
    <div className="auth-ui" style={s.page}>
      <LandingStyles />

      <header style={s.topbar}>
        <div style={s.brand}>
          <span style={s.logoMark}>BU</span>
          <span style={s.wordmark}>Bahria University</span>
        </div>
        <span style={s.topbarTag}>Sports Management Portal</span>
      </header>

      <main style={s.main}>
        <div style={s.heroBlobA} aria-hidden />
        <div style={s.heroBlobB} aria-hidden />

        <div style={s.hero}>
          <span style={s.heroEyebrow}>Karachi Campus</span>
          <h1 style={s.heroTitle}>Every court, every booking,<br />one portal.</h1>
          <p style={s.heroSubtitle}>
            Choose your portal to reserve venues, manage equipment, and keep campus sports running smoothly.
          </p>
        </div>

        <div style={s.grid}>
          {TILES.map((t, i) => {
            const theme = ROLE_THEME[t.key];
            return (
              <Link
                key={t.key}
                to={t.to}
                className="landing-tile"
                style={{ ...s.tile, animationDelay: `${i * 70}ms` }}
              >
                <div style={{ ...s.tileGlow, background: `linear-gradient(135deg, ${theme.from}, ${theme.to})` }} />
                <div style={{ ...s.tileIcon, background: `linear-gradient(135deg, ${theme.from}, ${theme.to})` }}>
                  {t.icon}
                </div>
                <h2 style={s.tileLabel}>{t.label}</h2>
                <p style={s.tileDesc}>{t.description}</p>
                <span className="landing-tile-cta" style={{ ...s.tileCta, color: theme.solid }}>
                  Sign in <ArrowIcon />
                </span>
              </Link>
            );
          })}
        </div>
      </main>

      <footer style={s.footer}>
        2026 © <a href="/" style={s.footerLink}>Bahria University</a> — Sports Management Portal
      </footer>
    </div>
  );
}

function LandingStyles() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@600;700;800&family=Inter:wght@400;500;600;700&display=swap');
      .auth-ui { font-family: 'Inter', 'Segoe UI', system-ui, sans-serif; }
      .landing-tile {
        opacity: 0; animation: landingIn .5s ease forwards;
        text-decoration: none; transition: transform .2s ease, box-shadow .2s ease, border-color .2s ease;
      }
      .landing-tile:hover {
        transform: translateY(-6px);
        box-shadow: 0 24px 40px -18px rgba(11,55,84,0.28);
        border-color: transparent;
      }
      .landing-tile:hover .landing-tile-cta { gap: 8px; }
      .landing-tile-cta { display: inline-flex; align-items: center; gap: 4px; transition: gap .2s ease; }
      @keyframes landingIn { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
      @media (max-width: 720px) {
        .landing-grid-mq { grid-template-columns: 1fr !important; }
      }
      @media (prefers-reduced-motion: reduce) {
        .landing-tile { animation: none !important; opacity: 1 !important; }
      }
    `}</style>
  );
}

function GraduationIcon() {
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M2 8l10-5 10 5-10 5-10-5z" stroke="#fff" strokeWidth="1.6" strokeLinejoin="round"/><path d="M6 10.5V16c0 1.4 2.7 3 6 3s6-1.6 6-3v-5.5" stroke="#fff" strokeWidth="1.6" strokeLinecap="round"/><path d="M21 8v6" stroke="#fff" strokeWidth="1.6" strokeLinecap="round"/></svg>;
}
function GlobeIcon() {
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="#fff" strokeWidth="1.6"/><path d="M3 12h18M12 3c2.5 2.5 3.8 5.7 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.7-3.8-9S9.5 5.5 12 3z" stroke="#fff" strokeWidth="1.6"/></svg>;
}
function WhistleIcon() {
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><circle cx="9" cy="15" r="5" stroke="#fff" strokeWidth="1.6"/><path d="M9 15v-1a1 1 0 0 1 1-1h4l5-4v3l-4 3" stroke="#fff" strokeWidth="1.6" strokeLinejoin="round"/><circle cx="9" cy="15" r="1.4" fill="#fff"/></svg>;
}
function ShieldIcon() {
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" stroke="#fff" strokeWidth="1.6" strokeLinejoin="round"/><path d="M9 12l2 2 4-4" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}
function ArrowIcon() {
  return <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}

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
    background: palette.navy, color: '#fff', fontFamily: 'Poppins, sans-serif', fontWeight: 800, fontSize: 13,
  } as const,
  wordmark: { fontFamily: 'Poppins, serif', fontSize: 18, fontWeight: 600, color: palette.navy } as const,
  topbarTag: { fontSize: 13, color: palette.muted, fontWeight: 500 } as const,
  main: { flex: 1, position: 'relative', padding: '64px 24px 40px', display: 'flex', flexDirection: 'column', alignItems: 'center', overflow: 'hidden' } as const,
  heroBlobA: { position: 'absolute', width: 340, height: 340, borderRadius: '50%', background: `${palette.teal}22`, top: -120, left: -100, filter: 'blur(10px)' } as const,
  heroBlobB: { position: 'absolute', width: 300, height: 300, borderRadius: '50%', background: `${palette.navy}18`, bottom: -140, right: -80, filter: 'blur(10px)' } as const,
  hero: { textAlign: 'center', maxWidth: 640, marginBottom: 48, position: 'relative' } as const,
  heroEyebrow: {
    display: 'inline-block', fontSize: 12.5, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase',
    color: palette.teal, background: palette.mint100, padding: '6px 14px', borderRadius: 999, marginBottom: 18,
  } as const,
  heroTitle: { fontFamily: 'Poppins, sans-serif', fontSize: 40, lineHeight: 1.2, fontWeight: 700, color: palette.navy, margin: '0 0 14px' } as const,
  heroSubtitle: { fontSize: 16, lineHeight: 1.6, color: palette.muted, margin: 0 } as const,
  grid: {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 20,
    width: '100%', maxWidth: 980, position: 'relative',
  } as const,
  tile: {
    position: 'relative', background: '#fff', border: `1px solid ${palette.line}`, borderRadius: 20,
    padding: '28px 24px', display: 'flex', flexDirection: 'column', gap: 6, overflow: 'hidden',
  } as const,
  tileGlow: { position: 'absolute', top: -60, right: -60, width: 140, height: 140, borderRadius: '50%', opacity: 0.12, filter: 'blur(6px)' } as const,
  tileIcon: {
    width: 48, height: 48, borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center',
    marginBottom: 14, boxShadow: '0 10px 18px -10px rgba(11,55,84,0.5)',
  } as const,
  tileLabel: { fontFamily: 'Poppins, sans-serif', fontSize: 18.5, fontWeight: 700, color: palette.ink, margin: '0 0 6px' } as const,
  tileDesc: { fontSize: 13.5, lineHeight: 1.55, color: palette.muted, margin: '0 0 18px', flex: 1 } as const,
  tileCta: { fontSize: 13.5, fontWeight: 700 } as const,
  footer: { textAlign: 'center', padding: '20px 24px', fontSize: 12.5, color: palette.muted, borderTop: `1px solid ${palette.line}` } as const,
  footerLink: { color: palette.navy, textDecoration: 'none', fontWeight: 600 } as const,
};
