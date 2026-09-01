/**
 * Landing page — split-panel role picker inspired by the "Spotter HOS"
 * reference design, with the right panel's role cards + sign-in form
 * restyled to match the Mazik Global "Talent" login layout (compact
 * 2x2 role cards, selected-state radio dot, email/password fields,
 * remember-me, and a static "Sign into BUKC Sports Portal" button).
 * Right panel background is now white, with all text recolored for
 * contrast against a light background.
 *
 * Below "Remember me" there is now a "Not a user? Register account"
 * link (replacing the old "Forgot password?" link) which routes to
 * the correct /register/<role> screen for the currently selected
 * role. Only student and external roles have self-service
 * registration — admin/coordinator accounts are created by an
 * administrator, so the link stays disabled with a short hint for
 * those roles.
 */
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type { PortalKey } from './AuthUI.js';
import { useAuth } from '../../lib/auth.js';
import { login, studentLogin } from './api.js';
import { ApiRequestError } from '../../lib/api.js';

const palette = {
  navy900: '#0F172B',   // page background / dark text on white panel
  navy800: '#132357',   // left panel background
  navyDeep: '#031636',  // deepest shade — overlays / shadows
  slate600: '#132357',
  slate500: '#62748E',
  slate400: '#90A1B9',
  slate300: '#CAD5E2',
  slate100: '#E2E8F0',
  slate50: '#F8FAFC',
  white: '#FFFFFF',
  accent: '#1C398E',    // the one blue — reserved for the active state only
  accentSoft: '#DBEAFE',
  accentWash: '#1C398E14', // very light tint of accent, used for selected card bg
};

interface RoleOption {
  key: PortalKey;
  label: string;
  description: string;
  to: string;
  expectedRole: 'SUPER_ADMIN' | 'COORDINATOR' | 'STUDENT' | 'EXTERNAL';
  registerTo?: string;
}

// `to` is kept only as a fallback deep-link (e.g. shared URLs); the sign-in
// button below no longer navigates here — it logs the user in directly.
const ROLES: RoleOption[] = [
  {
    key: 'admin', label: 'Super Administrator', to: '/login/admin', expectedRole: 'SUPER_ADMIN',
    description: 'Full platform oversight - manages approvals.',
  },
  {
    key: 'coordinator', label: 'Coordinator', to: '/login/coordinator', expectedRole: 'COORDINATOR',
    description: 'Manage queues & conflicts for equipment and venues.',
  },
  {
    key: 'student', label: 'Student', to: '/login/student', expectedRole: 'STUDENT',
    description: 'Book venues & borrow sports equipment.',
    registerTo: '/register/student',
  },
  {
    key: 'external', label: 'External', to: '/login/external', expectedRole: 'EXTERNAL',
    description: 'Request venues for a partner institution.',
    registerTo: '/register/external',
  },
];

export default function LandingScreen() {
  const [selected, setSelected] = useState<PortalKey | null>(null);
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { setUser } = useAuth();
  const navigate = useNavigate();
  const active = ROLES.find((r) => r.key === selected) ?? null;
  const isStudent = active?.key === 'student';

  // Signs the user in right here on the landing page — no more bouncing to
  // a separate /login/<role> screen. On success we land straight on /home,
  // the same place the old per-role login screen used to send people.
  async function onSignIn(e: FormEvent) {
    e.preventDefault();
    if (!active) return;
    setError(null);
    setLoading(true);
    try {
      const user = isStudent
        ? await studentLogin(identifier, password)
        : await login(identifier, password);

      if (user.role !== active.expectedRole) {
        setError(`These credentials are not for the ${active.label} portal.`);
        setLoading(false);
        return;
      }
      setUser(user);
      navigate('/home');
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.body.error : 'Could not sign in. Try again.');
      setLoading(false);
    }
  }

  return (
    <div style={s.page}>
      <LandingStyles />
      <div style={s.glowA} aria-hidden />
      <div style={s.glowB} aria-hidden />

      <div style={s.card} className="landing-card-mq">
        {/* Left — brand / image panel */}
        <div style={s.leftPanel} className="landing-left-panel">
          <div style={s.leftOverlay} />
          <div style={s.leftContent}>
            <span style={s.leftEyebrow}>Bahria University</span>
            <h1 style={s.leftTitle}>BUKC Sports</h1>
            <p style={s.leftText} className="landing-left-text">
              The campus sports management portal — reserve venues, borrow
              equipment, and keep every game, court, and booking running
              smoothly from one place.
            </p>
          </div>
        </div>

        {/* Right — role picker + sign-in panel */}
        <div style={s.rightPanel} className="landing-right-panel">
          <div style={s.rightTop}>
            <img src="/landing/bu_logo.png" alt="Bahria University" style={s.logo} />
            <div>
              <div style={s.logoWordmark}>Bahria University</div>
              <div style={s.logoTag}>Sports Management Portal</div>
            </div>
          </div>

          <h3 style={s.pickPrompt}>SELECT YOUR ROLE </h3>

          <div style={s.roleGrid} className="role-grid-mq">
            {ROLES.map((r) => {
              const isActive = selected === r.key;
              return (
                <button
                  key={r.key}
                  type="button"
                  onClick={() => setSelected(r.key)}
                  className="role-card"
                  style={{ ...s.roleCard, ...(isActive ? s.roleCardActive : {}) }}
                >
                  <span style={{ ...s.roleDot, ...(isActive ? s.roleDotActive : {}) }} />
                  <span style={{ ...s.roleLabel, ...(isActive ? s.roleLabelActive : {}) }}>{r.label}</span>
                  <span style={s.roleDesc}>{r.description}</span>
                </button>
              );
            })}
          </div>

          <form onSubmit={onSignIn} noValidate>
            {error && <div style={s.errorBanner}>{error}</div>}

            <div style={s.formGroup}>
              <label style={s.formLabel} htmlFor="landing-identifier">{isStudent ? 'Enrollment' : 'Email'}</label>
              <input
                id="landing-identifier"
                type={isStudent ? 'text' : 'email'}
                placeholder={isStudent ? 'e.g. 84-024000-123' : 'you@bukc.edu.pk'}
                autoComplete="username"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                style={s.input}
                required
              />
            </div>

            <div style={s.formGroup}>
              <label style={s.formLabel} htmlFor="landing-password">Password</label>
              <div style={s.passwordWrap}>
                <input
                  id="landing-password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  style={s.inputWithToggle}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  style={s.showToggle}
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>

            {/* Remember me + Forgot password share one row, directly below
               the password field's Show/Hide toggle line. */}
            <div style={s.rememberForgotRow}>
              <label style={s.rememberRow}>
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  style={s.checkbox}
                />
                Remember me
              </label>
              <a href="/forgot-password" style={s.forgotLink}>Forgot password?</a>
            </div>

            {/* "Not a user? Register account" — routes to /register/student or
               /register/external based on the role selected above. Admin and
               Coordinator have no self-registration flow, so the link is
               disabled with a short explanatory hint in that case. */}
            <div style={s.registerRow}>
              <button
                type="button"
                disabled={!active?.registerTo}
                onClick={() => active?.registerTo && navigate(active.registerTo)}
                style={{ ...s.registerLink, ...(active?.registerTo ? s.registerLinkActive : s.registerLinkDisabled) }}
              >
                Not a user? <span style={s.registerLinkStrong}>Register account</span>
              </button>
              {selected && !active?.registerTo && (
                <p style={s.registerHint}>Self-registration isn&apos;t available for this role.</p>
              )}
            </div>

            <button
              type="submit"
              disabled={!active || loading}
              style={{ ...s.signInBtn, ...(active && !loading ? s.signInBtnActive : s.signInBtnDisabled) }}
            >
              {loading ? 'Signing in…' : 'Sign into BUKC Sports Portal'}
              {!loading && <ArrowIcon />}
            </button>
          </form>

          <p style={s.helperNote}>Choose a role, then enter your credentials</p>
        </div>
      </div>

      <footer style={s.footer}>2026 © Bahria University — Sports Management Portal</footer>
    </div>
  );
}

function LandingStyles() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
      * { font-family: 'Inter', system-ui, sans-serif; box-sizing: border-box; }
      .role-card { transition: background .18s ease, border-color .18s ease, transform .18s ease; }
      .role-card:hover { transform: translateY(-2px); }
      input[type="email"]::placeholder, input[type="password"]::placeholder, input[type="text"]::placeholder {
        color: ${palette.slate400};
      }
      input[type="email"]:focus, input[type="password"]:focus, input[type="text"]:focus {
        outline: none;
        border-color: ${palette.accent} !important;
        box-shadow: 0 0 0 3px ${palette.accentSoft};
      }
      @media (max-width: 860px) {
        .landing-card-mq { grid-template-columns: 1fr !important; max-width: 460px !important; }
        .landing-card-mq .landing-left-panel { height: 250px !important; min-height: 0 !important; padding: 20px 24px !important; }
        .landing-card-mq .landing-left-panel h1 { font-size: 28px !important; margin: 0 0 4px !important; }
        .landing-card-mq .landing-left-panel .landing-left-text { display: none !important; }
        .landing-card-mq .landing-right-panel { padding: 26px 22px 24px !important; }
      }
      @media (max-width: 420px) {
        .role-grid-mq { grid-template-columns: 1fr !important; }
      }
    `}</style>
  );
}

function ArrowIcon() {
  return <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

const s = {
  page: {
    minHeight: '100vh', width: '100%', display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden',
    background: `radial-gradient(1100px 700px at 15% 0%, ${palette.navy800}aa 0%, transparent 60%),
                 radial-gradient(900px 600px at 100% 100%, ${palette.accent}22 0%, transparent 55%),
                 ${palette.navy900}`,
    padding: '32px 20px',
  } as const,
  glowA: { position: 'absolute', width: 420, height: 420, borderRadius: '50%', background: `${palette.accent}1a`, top: -160, left: -140, filter: 'blur(30px)', pointerEvents: 'none' } as const,
  glowB: { position: 'absolute', width: 380, height: 380, borderRadius: '50%', background: `${palette.slate600}22`, bottom: -160, right: -120, filter: 'blur(30px)', pointerEvents: 'none' } as const,

  card: {
    position: 'relative', width: '100%', maxWidth: 1100, minHeight: 500, borderRadius: 28,
    overflow: 'hidden', display: 'grid', gridTemplateColumns: '1.05fr 1fr',
    boxShadow: `0 40px 80px -30px ${palette.navyDeep}dd, 0 0 0 1px ${palette.slate600}33`,
  } as const,

  leftPanel: {
    position: 'relative', backgroundImage: `url('/landing/bukc.jpg')`, backgroundSize: 'cover',
    backgroundPosition: 'center', display: 'flex', alignItems: 'flex-end', padding: '40px',
    overflow: 'hidden',
  } as const,
  leftOverlay: {
    position: 'absolute', inset: 0,
    background: `linear-gradient(180deg, transparent 45%, ${palette.navyDeep}f0 100%)`,
  } as const,
  leftContent: { position: 'relative', zIndex: 1 } as const,
  leftEyebrow: {
    display: 'inline-block', fontSize: 12, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase',
    color: palette.slate100, background: `${palette.navy800}88`, border: `1px solid ${palette.slate400}55`,
    padding: '6px 12px', borderRadius: 999, marginBottom: 16,
  } as const,
  leftTitle: { fontSize: 42, fontWeight: 800, color: palette.white, margin: '0 0 12px', letterSpacing: -0.5 } as const,
  leftText: { fontSize: 14.5, lineHeight: 1.65, color: `${palette.slate100}dd`, margin: 0, maxWidth: 380 } as const,

  // Right panel is now white — all text below is recolored to sit on a light background
  rightPanel: {
    position: 'relative', background: palette.white,
    padding: '32px 36px 30px', display: 'flex', flexDirection: 'column',
  } as const,
  rightTop: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 } as const,
  logo: { width: 42, height: 42, borderRadius: 10, objectFit: 'contain', background: palette.slate50, padding: 4, border: `1px solid ${palette.slate300 ?? palette.slate100}` } as const,
  logoWordmark: { fontSize: 14.5, fontWeight: 700, color: palette.navy900 } as const,
  logoTag: { fontSize: 11.5, color: palette.slate500, marginTop: 1 } as const,

  pickPrompt: { fontSize: 13, fontWeight: 600, color: palette.slate600, margin: '0 0 12px', letterSpacing: 0.2 } as const,

  // Compact 2x2 role cards, Mazik-Talent style, now on a white panel
  roleGrid: {
    display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 6, marginBottom: 24,
  } as const,
  roleCard: {
    position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4,
    textAlign: 'left', padding: '14px 16px', borderRadius: 12, border: `1.5px solid ${palette.slate300}`,
    background: palette.slate50, cursor: 'pointer',
  } as const,
  roleCardActive: {
    background: palette.accentWash, borderColor: palette.accent,
    boxShadow: `0 0 0 3px ${palette.accent}22`,
  } as const,
  roleDot: {
    position: 'absolute', top: 12, right: 12, width: 14, height: 14, borderRadius: '50%',
    border: `1.8px solid ${palette.slate400}`, background: 'transparent',
  } as const,
  roleDotActive: {
    background: palette.accent, borderColor: palette.accent, boxShadow: `inset 0 0 0 3px ${palette.white}`,
  } as const,
  roleLabel: { fontSize: 13.5, fontWeight: 700, color: palette.navy900 } as const,
  roleLabelActive: { color: palette.accent } as const,
  roleDesc: { fontSize: 11, lineHeight: 1.4, color: palette.slate500 } as const,

  // Email / password form, recolored for the white panel
  formGroup: { marginTop: 6, marginBottom: 14 } as const,
  formLabel: { display: 'block', fontSize: 12.5, fontWeight: 600, color: palette.slate600, marginBottom: 6 } as const,
  input: {
    width: '100%', padding: '11px 14px', borderRadius: 10, border: `1.5px solid ${palette.slate300}`,
    background: palette.slate50, color: palette.navy900, fontSize: 13.5,
  } as const,
  passwordWrap: { position: 'relative' } as const,
  inputWithToggle: {
    width: '100%', padding: '11px 56px 11px 14px', borderRadius: 10, border: `1.5px solid ${palette.slate300}`,
    background: palette.slate50, color: palette.navy900, fontSize: 13.5,
  } as const,
  showToggle: {
    position: 'absolute', top: '50%', right: 12, transform: 'translateY(-50%)', background: 'none',
    border: 'none', color: palette.accent, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', padding: 0,
  } as const,

  errorBanner: {
    background: '#FEF2F2', color: '#B91C1C', border: '1px solid #FECACA',
    borderRadius: 10, padding: '11px 14px', fontSize: 13, marginBottom: 16,
  } as const,

  rememberForgotRow: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12,
  } as const,
  rememberRow: {
    display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: palette.slate600,
    cursor: 'pointer',
  } as const,
  checkbox: { width: 15, height: 15, accentColor: palette.accent, cursor: 'pointer' } as const,
  forgotLink: { fontSize: 12.5, color: palette.accent, textDecoration: 'none', fontWeight: 600 } as const,

  registerRow: { marginBottom: 16 } as const,
  registerLink: {
    background: 'none', border: 'none', padding: 0, fontSize: 12.5, cursor: 'pointer', textAlign: 'left',
  } as const,
  registerLinkActive: { color: palette.slate600 } as const,
  registerLinkStrong: { color: palette.accent, fontWeight: 700 } as const,
  registerLinkDisabled: { color: palette.slate400, cursor: 'not-allowed' } as const,
  registerHint: { margin: '4px 0 0', fontSize: 11.5, color: palette.slate500 } as const,

  signInBtn: {
    width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
    padding: '14px 18px', borderRadius: 14, fontSize: 14.5, fontWeight: 700, border: 'none', cursor: 'pointer',
    transition: 'opacity .18s ease, transform .18s ease',
  } as const,
  signInBtnActive: { background: palette.accent, color: palette.white } as const,
  signInBtnDisabled: { background: palette.slate100, color: palette.slate400, cursor: 'not-allowed' } as const,

  helperNote: { marginTop: 10, fontSize: 12, color: palette.slate500, textAlign: 'center' } as const,

  footer: { marginTop: 20, fontSize: 12, color: palette.slate500, textAlign: 'center', position: 'relative' } as const,
};
