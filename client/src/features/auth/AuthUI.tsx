/**
 * AuthUI — visual kit for the "front door" of the app: LandingScreen,
 * LoginScreen, RegisterScreen. Deliberately kept separate from PortalShell
 * (which still powers Home/Profile/AdminAccounts/ForgotPassword/AcceptInvite)
 * so this redesign never touches those other screens.
 *
 * Palette sourced from the provided brand board:
 *   #EFF9F5 (mint-50)  #DFF0E8 (mint-100)  #498473 (teal-600)
 *   #E4EDF6 (sky-100)  #0B3754 (navy-900)
 * A handful of in-family shades (blue / slate) are derived from those five so
 * each of the four portals reads as visually distinct while staying on-palette.
 */
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

export const palette = {
  mint50: '#EFF9F5',
  mint100: '#DFF0E8',
  sky100: '#E4EDF6',
  teal: '#498473',
  tealDeep: '#33604F',
  navy: '#0B3754',
  navyDeep: '#082A40',
  ink: '#1B2A33',
  muted: '#5C7180',
  line: '#DCE7E2',
};

export type PortalKey = 'student' | 'external' | 'coordinator' | 'admin';

export const ROLE_THEME: Record<PortalKey, { label: string; from: string; to: string; solid: string; soft: string }> = {
  student:     { label: 'Student',              from: '#5B9C86', to: '#33604F', solid: '#498473', soft: '#DFF0E8' },
  external:    { label: 'External',             from: '#2C6E8E', to: '#0B3754', solid: '#2C6E8E', soft: '#E4EDF6' },
  coordinator: { label: 'Coordinator',           from: '#4F6B7A', to: '#233947', solid: '#4F6B7A', soft: '#E4EDF6' },
  admin:       { label: 'Administration Staff',  from: '#123F5E', to: '#082A40', solid: '#0B3754', soft: '#E4EDF6' },
};

const PORTAL_ORDER: PortalKey[] = ['student', 'external', 'coordinator', 'admin'];

/* Injects @font-face-free, self-contained hover/focus/responsive rules that
   inline styles can't express. Scoped by the `auth-ui` class prefix so it
   can't bleed into or clash with other screens' styling. */
function AuthStyleSheet() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@600;700;800&family=Inter:wght@400;500;600;700&display=swap');
      .auth-ui { font-family: 'Inter', 'Segoe UI', system-ui, sans-serif; }
      .auth-ui h1, .auth-ui h2, .auth-ui .auth-display { font-family: 'Poppins', 'Segoe UI', system-ui, sans-serif; }
      .auth-input {
        transition: border-color .15s ease, box-shadow .15s ease, background-color .15s ease;
      }
      .auth-input:focus {
        outline: none;
        border-color: var(--accent, #0B3754);
        box-shadow: 0 0 0 4px var(--accent-soft, rgba(11,55,84,0.12));
        background: #fff;
      }
      .auth-btn { transition: transform .15s ease, box-shadow .15s ease, filter .15s ease; }
      .auth-btn:hover:not(:disabled) { transform: translateY(-1px); filter: brightness(1.05); }
      .auth-btn:active:not(:disabled) { transform: translateY(0); }
      .auth-btn:disabled { opacity: .6; cursor: not-allowed; transform: none; }
      .auth-tab { transition: background-color .15s ease, color .15s ease, border-color .15s ease; }
      .auth-link { transition: color .15s ease; }
      .auth-card-anim { animation: authFadeUp .5s ease both; }
      @keyframes authFadeUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
      .auth-blob { animation: authFloat 7s ease-in-out infinite; }
      @keyframes authFloat { 0%,100% { transform: translateY(0) rotate(0deg); } 50% { transform: translateY(-10px) rotate(3deg); } }
      @media (max-width: 880px) {
        .auth-split { grid-template-columns: 1fr !important; }
        .auth-brand-panel { min-height: 200px !important; padding: 28px 24px !important; }
        .auth-brand-panel .auth-headline { font-size: 22px !important; }
        .auth-brand-panel .auth-illustration { display: none !important; }
        .auth-form-panel { padding: 28px 22px !important; }
      }
      @media (prefers-reduced-motion: reduce) {
        .auth-card-anim, .auth-blob { animation: none !important; }
      }
    `}</style>
  );
}

/* ---------- Page chrome ---------- */

export function AuthPage({ children }: { children: ReactNode }) {
  return (
    <div className="auth-ui" style={pageWrap}>
      <AuthStyleSheet />
      {children}
    </div>
  );
}

const pageWrap: React.CSSProperties = {
  minHeight: '100%',
  background: `radial-gradient(1200px 600px at 15% -10%, ${palette.sky100} 0%, transparent 60%),
               radial-gradient(1000px 500px at 110% 10%, ${palette.mint100} 0%, transparent 55%),
               ${palette.mint50}`,
  display: 'flex',
  flexDirection: 'column',
};

/* ---------- Split auth shell (Login / Register) ---------- */

export function AuthSplit({
  portal, eyebrow, headline, subhead, chip, children, formMaxWidth = 420,
}: {
  portal: PortalKey;
  eyebrow: string;
  headline: string;
  subhead: string;
  chip?: string;
  children: ReactNode;
  formMaxWidth?: number;
}) {
  const theme = ROLE_THEME[portal];
  return (
    <AuthPage>
      <TopBar />
      <main style={mainWrap}>
        <div className="auth-split auth-card-anim" style={splitCard}>
          <section
            className="auth-brand-panel"
            style={{ ...brandPanel, background: `linear-gradient(155deg, ${theme.from} 0%, ${theme.to} 100%)` }}
          >
            <div>
              <div style={brandMark}>
                <LogoMark />
                <span style={brandWordmark}>Bahria University</span>
              </div>
              <div style={portalPill}>{eyebrow}</div>
            </div>

            <div>
              <h1 className="auth-headline" style={headlineStyle}>{headline}</h1>
              <p style={subheadStyle}>{subhead}</p>
              {chip && (
                <div className="auth-blob" style={chipStyle}>
                  <span style={{ fontSize: 16 }}>🏐</span> {chip}
                </div>
              )}
            </div>

            <div className="auth-illustration" style={{ position: 'relative', height: 96 }}>
              <CourtIllustration />
            </div>
          </section>

          <section className="auth-form-panel" style={formPanel}>
            <PortalTabs active={portal} />
            <div style={{ maxWidth: formMaxWidth, width: '100%' }}>
              {children}
            </div>
          </section>
        </div>
      </main>
      <BottomFoot />
    </AuthPage>
  );
}

/**
 * Generic split shell for auth screens that aren't tied to one of the four
 * portals (e.g. Forgot Password, reached from any login page). Same visual
 * language as AuthSplit — brand panel, card, footer — but no portal tabs and
 * a fixed navy→teal gradient instead of a role tint.
 */
export function AuthGenericSplit({
  eyebrow, headline, subhead, chip, chipIcon = '🔒', children, formMaxWidth = 420,
}: {
  eyebrow: string;
  headline: string;
  subhead: string;
  chip?: string;
  chipIcon?: string;
  children: ReactNode;
  formMaxWidth?: number;
}) {
  return (
    <AuthPage>
      <TopBar />
      <main style={mainWrap}>
        <div className="auth-split auth-card-anim" style={splitCard}>
          <section
            className="auth-brand-panel"
            style={{ ...brandPanel, background: `linear-gradient(155deg, ${palette.navy} 0%, ${palette.tealDeep} 100%)` }}
          >
            <div>
              <div style={brandMark}>
                <LogoMark />
                <span style={brandWordmark}>Bahria University</span>
              </div>
              <div style={portalPill}>{eyebrow}</div>
            </div>

            <div>
              <h1 className="auth-headline" style={headlineStyle}>{headline}</h1>
              <p style={subheadStyle}>{subhead}</p>
              {chip && (
                <div className="auth-blob" style={chipStyle}>
                  <span style={{ fontSize: 16 }}>{chipIcon}</span> {chip}
                </div>
              )}
            </div>

            <div className="auth-illustration" style={{ position: 'relative', height: 96 }}>
              <CourtIllustration />
            </div>
          </section>

          <section className="auth-form-panel" style={formPanel}>
            <div style={{ maxWidth: formMaxWidth, width: '100%' }}>
              {children}
            </div>
          </section>
        </div>
      </main>
      <BottomFoot />
    </AuthPage>
  );
}

/* Neutral primary button (navy→teal) for screens with no single role tint. */
export function AuthButtonNeutral({ children, style, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className="auth-btn"
      style={{
        ...buttonBase,
        background: `linear-gradient(135deg, ${palette.navy}, ${palette.tealDeep})`,
        boxShadow: `0 10px 24px -10px ${palette.navy}99`,
        ...style,
      }}
    >
      {children}
    </button>
  );
}

function TopBar() {
  return (
    <header style={topBar}>
      <Link to="/" style={topBarBrand}>
        <LogoMark small />
        <span>Bahria University <span style={{ opacity: 0.6, fontWeight: 500 }}>· Sports</span></span>
      </Link>
    </header>
  );
}

function BottomFoot() {
  return (
    <footer style={footStyle}>
      2026 © <Link to="/" style={{ color: palette.navy, textDecoration: 'none', fontWeight: 600 }}>Bahria University</Link> — Sports Management Portal
    </footer>
  );
}

function PortalTabs({ active }: { active: PortalKey }) {
  return (
    <div style={tabsRow}>
      {PORTAL_ORDER.map((key) => {
        const t = ROLE_THEME[key];
        const isActive = key === active;
        return (
          <Link
            key={key}
            to={`/login/${key}`}
            className="auth-tab"
            style={{
              ...tabBase,
              background: isActive ? t.solid : '#fff',
              color: isActive ? '#fff' : palette.muted,
              borderColor: isActive ? t.solid : palette.line,
            }}
          >
            {t.label === 'Administration Staff' ? 'Admin' : t.label}
          </Link>
        );
      })}
    </div>
  );
}

/* ---------- Form primitives ---------- */

export function FieldGroup({
  label, icon, hint, error, children,
}: { label: string; icon?: ReactNode; hint?: string; error?: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={fieldLabel}>{label}</label>
      <div style={{ position: 'relative' }}>
        {icon && <span style={fieldIcon}>{icon}</span>}
        {children}
      </div>
      {error ? <small style={errHintStyle}>{error}</small> : hint ? <small style={hintTextStyle}>{hint}</small> : null}
    </div>
  );
}

export function AuthInput(props: React.InputHTMLAttributes<HTMLInputElement> & { hasIcon?: boolean }) {
  const { hasIcon = true, style, ...rest } = props;
  return <input {...rest} className="auth-input" style={{ ...inputBase, paddingLeft: hasIcon ? 42 : 14, ...style }} />;
}

export function AuthSelect(props: React.SelectHTMLAttributes<HTMLSelectElement> & { hasIcon?: boolean }) {
  const { hasIcon = true, style, children, ...rest } = props;
  return (
    <select {...rest} className="auth-input" style={{ ...inputBase, paddingLeft: hasIcon ? 42 : 14, ...style }}>
      {children}
    </select>
  );
}

export function AuthButton({
  portal, children, style, ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { portal: PortalKey }) {
  const t = ROLE_THEME[portal];
  return (
    <button
      {...props}
      className="auth-btn"
      style={{
        ...buttonBase,
        background: `linear-gradient(135deg, ${t.from}, ${t.to})`,
        boxShadow: `0 10px 24px -10px ${t.solid}99`,
        ...style,
      }}
    >
      {children}
    </button>
  );
}

export function AuthLinkRow({ children }: { children: ReactNode }) {
  return <div style={linkRowStyle}>{children}</div>;
}

export function AuthLink({ to, children, style }: { to: string; children: ReactNode; style?: React.CSSProperties }) {
  return <Link to={to} className="auth-link" style={{ ...linkStyle, ...style }}>{children}</Link>;
}

export function ErrorBanner({ children }: { children: ReactNode }) {
  return <div style={errorBanner}>{children}</div>;
}

export function SuccessBanner({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={successBanner}>
      <span style={successIconWrap}><CheckIcon /></span>
      <div>
        <strong style={{ display: 'block', marginBottom: 2 }}>{title}</strong>
        <span style={{ color: '#33604F', fontSize: 14 }}>{children}</span>
      </div>
    </div>
  );
}

/* ---------- Icons (hand-rolled, currentColor, no external deps) ---------- */

export const PersonIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm0 1.5c-2.5 0-6 1.25-6 3.5V15h12v-2c0-2.25-3.5-3.5-6-3.5z" /></svg>
);
export const LockIcon = () => (
  <svg width="14" height="16" viewBox="0 0 14 16" fill="currentColor"><path d="M11 6V4.5a4 4 0 0 0-8 0V6H2v9h10V6h-1zM4.5 4.5a2.5 2.5 0 0 1 5 0V6h-5V4.5z" /></svg>
);
export const BankIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1 1 5v1h14V5L8 1zM2 7v6H1v2h14v-2h-1V7h-2v6h-2V7H8v6H6V7H4v6H2V7z" /></svg>
);
export const MailIcon = () => (
  <svg width="16" height="14" viewBox="0 0 16 14" fill="currentColor"><path d="M1 2h14v10H1V2zm1.2 1L8 7.2 13.8 3H2.2zM14 4.3l-6 4.3-6-4.3V11h12V4.3z" /></svg>
);
export const PhoneIcon = () => (
  <svg width="14" height="16" viewBox="0 0 14 16" fill="currentColor"><path d="M2 1h6l2 3-2 2c.6 1.6 1.9 2.9 3.5 3.5l2-2 3 2v3c0 1-1 2-2 2C7.4 14.5.5 7.6.5 1c0-1 1-1 1-1z" transform="translate(0,0.2)"/></svg>
);
export const BuildingIcon = () => (
  <svg width="15" height="16" viewBox="0 0 15 16" fill="currentColor"><path d="M2 1h7v14H2V1zm2 2v2h1V3H4zm3 0v2h1V3H7zM4 6v2h1V6H4zm3 0v2h1V6H7zM4 9v2h1V9H4zm3 0v2h1V9H7zM9.5 6H14v9H9.5V6zm1.5 2v1.4h1.5V8H11zm0 2.6V12h1.5v-1.4H11z" /></svg>
);
export const BadgeIcon = () => (
  <svg width="15" height="16" viewBox="0 0 15 16" fill="currentColor"><path d="M7.5 0 9 3l3.3.5-2.4 2.3.6 3.3L7.5 7.5 4.5 9.1l.6-3.3L2.7 3.5 6 3 7.5 0zM4 12h7v1.2c0 1.5-1.6 2.8-3.5 2.8S4 14.7 4 13.2V12z" /></svg>
);
export const CheckIcon = () => (
  <svg width="18" height="18" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="10" fill="#498473" /><path d="M6 10.5l2.5 2.5L14 7.5" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
);

function LogoMark({ small }: { small?: boolean }) {
  const size = small ? 26 : 34;
  return (
    <span style={{
      width: size, height: size, borderRadius: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(255,255,255,0.16)', color: '#fff', fontFamily: 'Poppins, sans-serif', fontWeight: 800,
      fontSize: small ? 12 : 14, letterSpacing: -0.5, flexShrink: 0,
    }}>
      BU
    </span>
  );
}

function CourtIllustration() {
  return (
    <svg viewBox="0 0 320 100" width="100%" height="100%" style={{ position: 'absolute', bottom: 0, left: 0, opacity: 0.9 }}>
      <rect x="8" y="20" width="304" height="64" rx="6" fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.35)" strokeWidth="1.5" />
      <line x1="160" y1="20" x2="160" y2="84" stroke="rgba(255,255,255,0.35)" strokeWidth="1.5" />
      <circle cx="160" cy="52" r="16" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="1.5" />
      <circle cx="60" cy="52" r="10" fill="rgba(255,255,255,0.5)" />
      <circle cx="255" cy="40" r="6" fill="rgba(255,255,255,0.35)" />
    </svg>
  );
}

/* ---------- style objects ---------- */

const topBar: React.CSSProperties = { padding: '20px 32px' };
const topBarBrand: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 10, textDecoration: 'none',
  color: palette.navy, fontWeight: 700, fontSize: 15,
};
const mainWrap: React.CSSProperties = { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '12px 20px 40px' };
const splitCard: React.CSSProperties = {
  display: 'grid', gridTemplateColumns: 'minmax(280px, 420px) 1fr', width: '100%', maxWidth: 980,
  background: '#fff', borderRadius: 24, overflow: 'hidden', boxShadow: '0 30px 60px -25px rgba(11,55,84,0.35)',
  border: `1px solid ${palette.line}`,
};
const brandPanel: React.CSSProperties = {
  color: '#fff', padding: '40px 36px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 24, position: 'relative',
};
const brandMark: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 };
const brandWordmark: React.CSSProperties = { fontFamily: 'Poppins, serif', fontSize: 17, fontWeight: 600 };
const portalPill: React.CSSProperties = {
  display: 'inline-block', fontSize: 12, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase',
  background: 'rgba(255,255,255,0.16)', padding: '5px 12px', borderRadius: 999,
};
const headlineStyle: React.CSSProperties = { fontSize: 28, lineHeight: 1.2, fontWeight: 700, margin: '0 0 10px' };
const subheadStyle: React.CSSProperties = { fontSize: 14.5, lineHeight: 1.6, color: 'rgba(255,255,255,0.85)', margin: 0, maxWidth: 320 };
const chipStyle: React.CSSProperties = {
  marginTop: 18, display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(255,255,255,0.14)',
  border: '1px solid rgba(255,255,255,0.25)', borderRadius: 999, padding: '7px 14px', fontSize: 13, fontWeight: 600,
  backdropFilter: 'blur(4px)',
};
const formPanel: React.CSSProperties = { padding: '40px 44px', display: 'flex', flexDirection: 'column', gap: 22 };
const tabsRow: React.CSSProperties = { display: 'flex', gap: 8, flexWrap: 'wrap' };
const tabBase: React.CSSProperties = {
  fontSize: 12.5, fontWeight: 700, padding: '7px 13px', borderRadius: 999, border: '1px solid', textDecoration: 'none', cursor: 'pointer',
};
const fieldLabel: React.CSSProperties = { display: 'block', fontWeight: 700, fontSize: 13, color: palette.ink, marginBottom: 6 };
const fieldIcon: React.CSSProperties = {
  position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: palette.muted, pointerEvents: 'none', display: 'flex',
};
const inputBase: React.CSSProperties = {
  width: '100%', fontSize: 14.5, padding: '11px 14px', borderRadius: 12, border: `1.5px solid ${palette.line}`,
  background: palette.mint50, color: palette.ink, outline: 'none', fontFamily: 'inherit',
};
const buttonBase: React.CSSProperties = {
  width: '100%', color: '#fff', fontSize: 15, fontWeight: 700, padding: '13px', border: 'none', borderRadius: 12, cursor: 'pointer',
  fontFamily: 'inherit',
};
const linkRowStyle: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 };
const linkStyle: React.CSSProperties = { color: palette.navy, textDecoration: 'none', fontSize: 13.5, fontWeight: 600 };
const errHintStyle: React.CSSProperties = { display: 'block', color: '#b3352b', fontSize: 12, marginTop: 5 };
const hintTextStyle: React.CSSProperties = { display: 'block', color: palette.muted, fontSize: 12, marginTop: 5 };
const errorBanner: React.CSSProperties = {
  background: '#FDECEC', color: '#8F2323', border: '1px solid #F3CACA', borderRadius: 12, padding: '11px 14px', fontSize: 13.5,
};
const successBanner: React.CSSProperties = {
  display: 'flex', gap: 12, alignItems: 'flex-start', background: palette.mint100, color: '#245A45',
  border: `1px solid ${palette.teal}55`, borderRadius: 14, padding: '16px 18px', fontSize: 14.5,
};
const successIconWrap: React.CSSProperties = { flexShrink: 0, marginTop: 1 };
const footStyle: React.CSSProperties = { textAlign: 'center', padding: '18px 24px', fontSize: 12.5, color: palette.muted };

export { PORTAL_ORDER };
