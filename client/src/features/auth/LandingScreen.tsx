/**
 * Landing page — the role picker, matching the BUKC portal's tile grid.
 * Four tiles: Student, External, Coordinator, Administration Staff. Each links
 * to its own login page. This replaces the old role dropdown entirely.
 */
import { Link } from 'react-router-dom';

interface Tile {
  label: string;
  to: string;
  action: string;
  color: string;
}

const TILES: Tile[] = [
  { label: 'Student', to: '/login/student', action: 'Sign In', color: '#7c9478' },
  { label: 'External', to: '/login/external', action: 'Sign In', color: '#0a5c9c' },
  { label: 'Coordinator', to: '/login/coordinator', action: 'Sign In', color: '#5c5350' },
  { label: 'Administration Staff', to: '/login/admin', action: 'Sign In', color: '#2f4a5c' },
];

export default function LandingScreen() {
  return (
    <div style={s.page}>
      <header style={s.topbar}>
        <span style={s.wordmark}>Bahria University</span>
      </header>

      <main style={s.main}>
        <div style={s.grid}>
          {TILES.map((t) => (
            <div key={t.label} style={{ ...s.tile, background: t.color }}>
              <span style={s.tileLabel}>{t.label}</span>
              <Link to={t.to} style={s.tileBtn}>{t.action}</Link>
            </div>
          ))}
        </div>
      </main>

      <footer style={s.footer}>
        2026 © <a href="/" style={s.footerLink}>Bahria University</a>
      </footer>
    </div>
  );
}

const s = {
  page: { minHeight: '100%', display: 'flex', flexDirection: 'column', background: '#fff' } as const,
  topbar: { height: 56, display: 'flex', alignItems: 'center', padding: '0 24px', background: '#26485f' } as const,
  wordmark: { color: '#fff', fontFamily: 'Georgia, "Times New Roman", serif', fontSize: 24 } as const,
  main: { flex: 1, display: 'flex', justifyContent: 'center', padding: '56px 24px' } as const,
  grid: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(280px, 420px))', gap: 28, width: '100%', maxWidth: 900 } as const,
  tile: { minHeight: 150, borderRadius: 3, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 } as const,
  tileLabel: { color: '#fff', fontSize: 32, fontWeight: 400, fontFamily: '"Segoe UI", system-ui, sans-serif' } as const,
  tileBtn: { background: '#efefef', color: '#333', fontSize: 14, padding: '7px 16px', borderRadius: 4, textDecoration: 'none', border: '1px solid #d5d5d5' } as const,
  footer: { borderTop: '1px solid #e6e6e6', padding: '14px 24px', fontSize: 13, color: '#333' } as const,
  footerLink: { color: '#0a6ebd', textDecoration: 'none' } as const,
};
