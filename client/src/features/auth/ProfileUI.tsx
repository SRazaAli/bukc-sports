/**
 * ProfileUI — visual kit for the "My Profile" screen only.
 *
 * Re-themed to match the site's ACTUAL current visual language — the one
 * used by LandingScreen / HomeScreen / RegisterScreen — not the older
 * mint/teal palette from AuthUI.tsx (that palette is now only used by the
 * legacy Login/PasswordReset/AdminAccounts screens and was a mismatch here).
 *
 * Palette values below are copied verbatim from LandingScreen's/HomeScreen's
 * local `palette` const: dark navy page (#0F172B) with two soft accent/slate
 * glows, white content cards, navy900 headings, slate500/600 body text, and
 * a single accent blue (#1C398E) used for every interactive/brand element —
 * "the one blue, reserved for the active state" per HomeScreen's own notes.
 * Font is Inter only (400–800), matching Landing/Home/Register exactly.
 *
 * Deliberately its own file, mirroring how AuthUI.tsx is kept separate from
 * PortalShell: this redesign should never touch PortalShell.tsx (still used
 * by Home/AdminAccounts/history/etc.) or any other screen. ProfileScreen.tsx
 * is the only consumer of this file.
 */
import { useState, type ReactNode } from 'react';

/* ---------- theme (identical values to LandingScreen/HomeScreen `palette`) ---------- */

export const palette = {
  navy900: '#0F172B',
  navy800: '#132357',
  navyDeep: '#031636',
  slate600: '#132357',
  slate500: '#62748E',
  slate400: '#90A1B9',
  slate300: '#CAD5E2',
  slate100: '#E2E8F0',
  slate50: '#F8FAFC',
  white: '#FFFFFF',
  accent: '#1C398E',
  accentSoft: '#DBEAFE',
  accentWash: '#1C398E14',
  errorBg: '#FEF2F2',
  errorBorder: '#FECACA',
  errorText: '#B91C1C',
  okBg: '#ECFDF5',
  okBorder: '#A7F3D0',
  okText: '#047857',
};

export type PortalKey = 'student' | 'external' | 'coordinator' | 'admin';

export function roleToPortalKey(role: string): PortalKey {
  switch (role) {
    case 'STUDENT': return 'student';
    case 'EXTERNAL': return 'external';
    case 'COORDINATOR': return 'coordinator';
    default: return 'admin';
  }
}

const ROLE_LABEL: Record<PortalKey, string> = {
  student: 'Student',
  external: 'External',
  coordinator: 'Coordinator',
  admin: 'Administration Staff',
};

/* ---------- Page chrome ---------- */

export function ProfilePage({ children }: { children: ReactNode }) {
  return (
    <div className="bukc-profile" style={s.page}>
      <ProfileStyleSheet />
      <div style={s.glowA} aria-hidden />
      <div style={s.glowB} aria-hidden />
      {children}
    </div>
  );
}

function ProfileStyleSheet() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
      .bukc-profile { font-family: 'Inter', system-ui, sans-serif; position: relative; }
      .bukc-profile * { box-sizing: border-box; }
      .pf-card-anim { opacity: 0; animation: pfFadeUp .5s cubic-bezier(.2,.75,.25,1) forwards; }
      @keyframes pfFadeUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
      .pf-btn { transition: filter .15s ease, transform .15s ease, background-color .18s ease, border-color .18s ease, color .18s ease; cursor: pointer; }
      .pf-btn:hover:not(:disabled) { filter: brightness(1.08); }
      .pf-btn:active:not(:disabled) { transform: translateY(1px); }
      .pf-btn:disabled { opacity: .6; cursor: not-allowed; }
      .pf-signout { background: transparent; border: 1.5px solid ${palette.slate400}; color: ${palette.slate100}; }
      .pf-signout:hover { background-color: ${palette.accent}; border-color: ${palette.accent}; color: ${palette.white}; }
      .pf-ghost-btn { background: transparent; border: 1.5px solid ${palette.slate400}; color: ${palette.slate100}; }
      .pf-ghost-btn:hover { background-color: rgba(255,255,255,0.08); border-color: ${palette.slate100}; }
      .pf-input { transition: border-color .15s ease, box-shadow .15s ease; }
      .pf-input:focus { outline: none; border-color: ${palette.accent} !important; box-shadow: 0 0 0 3px ${palette.accentSoft}; }
      .pf-link { transition: opacity .15s ease; }
      .pf-link:hover { text-decoration: underline; }
      .pf-notif:hover { background: ${palette.slate50} !important; }
      .pf-quicklink:hover { background: ${palette.slate50} !important; color: ${palette.accent} !important; }
      .pf-quicklink:hover svg { transform: translateX(2px); }
      .pf-quicklink svg { transition: transform .15s ease; }
      .pf-sidebar { position: sticky; top: 20px; }
      @media (max-width: 900px) {
        .pf-grid { grid-template-columns: 1fr !important; }
        .pf-sidebar { position: static !important; top: auto !important; }
      }
      @media (max-width: 640px) {
        .pf-topbar { padding: 14px 16px !important; }
        .pf-topbar-actions span.pf-btn-label { display: none; }
        .pf-main { padding: 20px 14px 40px !important; }
      }
      @media (prefers-reduced-motion: reduce) {
        .pf-card-anim { animation: none !important; opacity: 1 !important; }
      }
    `}</style>
  );
}

const s = {
  page: {
    minHeight: '100%', display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden',
    background: `radial-gradient(1100px 700px at 15% 0%, ${palette.navy800}aa 0%, transparent 60%),
                 radial-gradient(900px 600px at 100% 100%, ${palette.accent}22 0%, transparent 55%),
                 ${palette.navy900}`,
  } as const,
  glowA: { position: 'absolute', width: 420, height: 420, borderRadius: '50%', background: `${palette.accent}1a`, top: -160, left: -140, filter: 'blur(30px)', pointerEvents: 'none' } as const,
  glowB: { position: 'absolute', width: 380, height: 380, borderRadius: '50%', background: `${palette.slate600}22`, bottom: -160, right: -120, filter: 'blur(30px)', pointerEvents: 'none' } as const,
};

/* ---------- Top bar: brand + Go back / Sign out ---------- */

export function ProfileTopBar({ onBack, onSignOut }: { onBack: () => void; onSignOut: () => void }) {
  return (
    <header className="pf-topbar" style={tb.wrap}>
      <div style={tb.brand}>
        <img src="/landing/bu_logo.png" alt="Bahria University" style={tb.logoImg} />
        <div>
          <div style={tb.wordmark}>Bahria University</div>
          <div style={tb.wordmarkSub}>Sports Management Portal</div>
        </div>
      </div>
      <div className="pf-topbar-actions" style={tb.actions}>
        <button className="pf-btn pf-ghost-btn" style={tb.ghostBtn} onClick={onBack}>
          <ArrowLeftIcon /> <span className="pf-btn-label">Go back</span>
        </button>
        <button className="pf-btn pf-signout" style={tb.signOutBtn} onClick={onSignOut}>
          <LogoutIcon /> <span className="pf-btn-label">Sign out</span>
        </button>
      </div>
    </header>
  );
}

const tb = {
  wrap: { position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 32px', flexWrap: 'wrap', gap: 12 } as const,
  brand: { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' } as const,
  logoImg: { width: 40, height: 40, borderRadius: 10, objectFit: 'contain', background: palette.slate50, padding: 4, border: `1px solid ${palette.slate300}` } as const,
  wordmark: { fontSize: 16, fontWeight: 700, color: palette.white, lineHeight: 1.2 } as const,
  wordmarkSub: { fontSize: 12, color: palette.slate400, marginTop: 1 } as const,
  actions: { display: 'flex', alignItems: 'center', gap: 10 } as const,
  ghostBtn: { display: 'inline-flex', alignItems: 'center', gap: 7, borderRadius: 999, padding: '9px 16px', fontSize: 13.5, fontWeight: 700, fontFamily: 'inherit' } as const,
  signOutBtn: { display: 'inline-flex', alignItems: 'center', gap: 7, borderRadius: 999, padding: '9px 16px', fontSize: 13.5, fontWeight: 700, fontFamily: 'inherit', border: 'none' } as const,
};

/* ---------- Main wrap + grid ---------- */

export function ProfileMain({ children }: { children: ReactNode }) {
  return <main className="pf-main bukc-container" style={{ position: 'relative', zIndex: 1, flex: 1, padding: '8px 0 56px', maxWidth: 1320, margin: '0 auto', width: '100%', paddingLeft: 22, paddingRight: 22 }}>{children}</main>;
}

export function ProfileGrid({ sidebar, children }: { sidebar: ReactNode; children: ReactNode }) {
  return (
    <div className="pf-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 320px) 1fr', gap: 20, alignItems: 'start' }}>
      {/* Sticky on desktop: the sidebar is naturally shorter than the activity
          column, so pinning it while the right column scrolls removes the
          dead whitespace that used to open up beneath it. Reverts to normal
          static flow on mobile where the grid stacks to one column. */}
      <div className="pf-sidebar" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>{sidebar}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>{children}</div>
    </div>
  );
}

export function ProfileFooter() {
  return (
    <footer className="bukc-container" style={{ position: 'relative', zIndex: 1, textAlign: 'center', padding: '20px 22px', fontSize: 12.5, color: palette.slate400, borderTop: `1px solid ${palette.slate600}55` }}>
      2026 © <a href="/" style={{ color: palette.accentSoft, textDecoration: 'none', fontWeight: 600 }}>Bahria University</a> — Sports Management Portal
    </footer>
  );
}

/* ---------- Identity card (avatar + name + badge) ---------- */

export function IdentityCard({
  portal, name, email, roleLabel, deactivated,
}: { portal: PortalKey; name: string; email: string; roleLabel: string; deactivated?: boolean }) {
  return (
    <section className="pf-card-anim" style={id.card}>
      <div style={id.banner} />
      <div style={id.avatarWrap}>
        <div style={id.avatar}>
          <RoleIconFor portal={portal} />
        </div>
      </div>
      <div style={id.eyebrow}>Signed in as</div>
      <div style={id.name}>{name}</div>
      <div style={id.email}>{email}</div>
      <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginTop: 10, flexWrap: 'wrap' }}>
        <span style={id.badge}>{roleLabel || ROLE_LABEL[portal]}</span>
        {deactivated && <span style={{ ...id.badge, background: palette.errorBg, color: palette.errorText }}>Deactivated</span>}
      </div>
    </section>
  );
}

const id = {
  card: {
    position: 'relative', overflow: 'hidden', background: 'linear-gradient(145deg, #F8FAFF 0%, #EAF0FC 100%)',
    borderRadius: 16, border: `1px solid ${palette.slate300}e6`, boxShadow: '0 12px 30px -22px rgba(3,22,54,.85)',
    textAlign: 'center', paddingBottom: 22,
  } as const,
  banner: { height: 72, width: '100%', background: `linear-gradient(120deg, ${palette.navy800}, ${palette.accent})` } as const,
  avatarWrap: { marginTop: -40, marginBottom: 10 } as const,
  avatar: {
    width: 80, height: 80, borderRadius: '50%', margin: '0 auto', border: '4px solid #fff',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: palette.accent, boxShadow: '0 10px 20px -8px rgba(3,22,54,.55)',
  } as const,
  eyebrow: { fontSize: 12, color: palette.slate500, padding: '0 18px' } as const,
  name: { fontSize: 19, fontWeight: 700, color: palette.navy900, marginTop: 3, padding: '0 18px', wordBreak: 'break-word' } as const,
  email: { fontSize: 13, color: palette.slate500, marginTop: 3, padding: '0 18px', wordBreak: 'break-word' } as const,
  badge: { display: 'inline-block', fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', padding: '4px 11px', borderRadius: 999, background: palette.accentWash, color: palette.accent } as const,
};

/* ---------- Panel (card with header) ---------- */

export function Panel({
  title, icon, action, accent, children,
}: { title: string; icon?: ReactNode; action?: ReactNode; accent?: boolean; children: ReactNode }) {
  return (
    <section className="pf-card-anim" style={{ ...pn.card, ...(accent ? { borderLeft: `4px solid ${palette.accent}` } : {}) }}>
      <div style={pn.head}>
        <span style={pn.title}>{icon}{title}</span>
        {action}
      </div>
      <div style={pn.body}>{children}</div>
    </section>
  );
}

const pn = {
  card: {
    background: 'linear-gradient(145deg, #F8FAFF 0%, #EAF0FC 100%)', borderRadius: 16,
    border: `1px solid ${palette.slate300}e6`, boxShadow: '0 12px 30px -22px rgba(3,22,54,.85)', overflow: 'hidden',
  } as const,
  head: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '15px 20px', borderBottom: `1px solid ${palette.slate300}`, background: palette.white } as const,
  title: { display: 'flex', alignItems: 'center', gap: 9, fontSize: 14.5, fontWeight: 700, color: palette.navy900 } as const,
  body: { padding: 20 } as const,
};

export function LinkBtn({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className="pf-link" {...props} style={{ background: 'none', border: 'none', font: '700 13px inherit', color: palette.accent, cursor: 'pointer', padding: 0, display: 'inline-flex', alignItems: 'center', gap: 4 }}>{children}</button>;
}

/* ---------- Quick link row (sidebar navigation shortcuts) ---------- */

export function QuickLinkItem({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="pf-quicklink" onClick={onClick} style={ql.item}>
      <span>{label}</span>
      <ArrowRightIcon />
    </button>
  );
}
const ql = {
  item: {
    width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
    background: 'none', border: 'none', borderRadius: 10, padding: '9px 10px', margin: 0,
    font: '600 13.5px inherit', color: palette.navy900, cursor: 'pointer', textAlign: 'left',
  } as const,
};

/* ---------- Personal details ---------- */

export function DetailRow({ label, value }: { label: string; value?: string }) {
  return (
    <div style={dr.row}>
      <div style={dr.label}>{label}</div>
      <div style={dr.value}>{value ?? '—'}</div>
    </div>
  );
}
const dr = {
  row: { padding: '9px 0', borderBottom: `1px solid ${palette.slate100}` } as const,
  label: { fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: palette.slate500, marginBottom: 2 } as const,
  value: { fontSize: 14.5, color: palette.navy900, fontWeight: 500, wordBreak: 'break-word' } as const,
};

/* ---------- Banners ---------- */

export function Banner({ kind, children }: { kind: 'error' | 'ok'; children: ReactNode }) {
  const style = kind === 'error'
    ? { background: palette.errorBg, color: palette.errorText, border: `1px solid ${palette.errorBorder}` }
    : { background: palette.okBg, color: palette.okText, border: `1px solid ${palette.okBorder}` };
  return <div style={{ ...style, borderRadius: 10, padding: '12px 16px', marginBottom: 16, fontSize: 14 }}>{children}</div>;
}

/* ---------- Notifications ---------- */

export function NotifItem({
  title, body, time, unread, onClick,
}: { title: string; body: string; time: string; unread: boolean; onClick?: () => void }) {
  return (
    <div
      className="pf-notif"
      onClick={onClick}
      style={{ ...nf.item, ...(unread ? nf.itemUnread : {}), cursor: onClick ? 'pointer' : 'default' }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {unread && <span style={nf.dot} aria-hidden />}
          <span style={{ ...nf.title, fontWeight: unread ? 700 : 600 }}>{title}</span>
        </div>
        <div style={nf.body}>{body}</div>
      </div>
      <span style={nf.time}>{time}</span>
    </div>
  );
}
const nf = {
  item: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, padding: '11px 12px', borderRadius: 10, marginBottom: 8, background: palette.white, border: `1px solid ${palette.slate300}` } as const,
  itemUnread: { borderLeft: `3px solid ${palette.accent}`, boxShadow: '0 1px 2px rgba(3,22,54,0.06)' } as const,
  dot: { width: 6, height: 6, borderRadius: '50%', background: palette.accent, flexShrink: 0 } as const,
  title: { fontSize: 13.5, color: palette.navy900 } as const,
  body: { fontSize: 12.5, color: palette.slate500, marginTop: 2, lineHeight: 1.4 } as const,
  time: { fontSize: 11, color: palette.slate400, whiteSpace: 'nowrap', flexShrink: 0, paddingTop: 1 } as const,
};

export function CountPill({ children }: { children: ReactNode }) {
  return <span style={{ fontSize: 11.5, fontWeight: 700, background: palette.accentWash, color: palette.accent, padding: '3px 10px', borderRadius: 999 }}>{children}</span>;
}

/* ---------- Stats ---------- */

export function StatBox({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div style={{ flex: 1, textAlign: 'center', padding: '14px 8px', background: warn ? palette.errorBg : palette.white, borderRadius: 12, border: `1px solid ${warn ? palette.errorBorder : palette.slate300}` }}>
      <div style={{ fontSize: 22, fontWeight: 800, color: warn ? palette.errorText : palette.navy900 }}>{value}</div>
      <div style={{ fontSize: 11.5, color: palette.slate500, marginTop: 2 }}>{label}</div>
    </div>
  );
}

export function WarnBanner({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: palette.errorBg, color: palette.errorText, border: `1px solid ${palette.errorBorder}`, borderRadius: 10, padding: '10px 14px', marginBottom: 12, fontSize: 13.5, fontWeight: 600 }}>
      <WarnIcon /> {children}
    </div>
  );
}

/* ---------- Status pill (borrow/booking status) ---------- */

export function StatusPill({ status }: { status: string }) {
  let bg: string = palette.slate100, fg: string = palette.slate500;
  if (['APPROVED', 'ACTIVE', 'COMPLETED'].includes(status)) { bg = palette.okBg; fg = palette.okText; }
  else if (['REJECTED', 'CANCELLED', 'COMPLETED_LATE', 'COMPLETED_DAMAGED'].includes(status)) { bg = palette.errorBg; fg = palette.errorText; }
  return <span style={{ font: '700 10.5px ui-monospace, "JetBrains Mono", monospace', padding: '3px 9px', borderRadius: 999, background: bg, color: fg, whiteSpace: 'nowrap' }}>{status}</span>;
}

/* ---------- Table (borrow requests) ---------- */

export function DataTable({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div style={{ overflowX: 'auto', marginTop: 12 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
        <thead>
          <tr>{head.map((h) => <th key={h} style={{ textAlign: 'left', font: '700 10.5px Inter', color: palette.slate500, textTransform: 'uppercase', letterSpacing: 0.4, padding: '0 10px 8px', borderBottom: `1px solid ${palette.slate300}` }}>{h}</th>)}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
export const td: React.CSSProperties = { padding: '10px 10px', borderBottom: `1px solid ${palette.slate100}`, color: palette.navy900 };

export function ActivityRow({ children }: { children: ReactNode }) {
  return <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '10px 4px', borderBottom: `1px solid ${palette.slate100}`, fontSize: 13.5, color: palette.navy900 }}>{children}</div>;
}

export function Muted({ children }: { children: ReactNode }) {
  return <p style={{ color: palette.slate500, fontSize: 13.5, margin: 0 }}>{children}</p>;
}

/* ---------- Form primitives (password change) ---------- */

export function PfField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: 'block', fontWeight: 600, fontSize: 12.5, color: palette.slate600, marginBottom: 6 }}>{label}</label>
      {children}
    </div>
  );
}

export function PfInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className="pf-input" style={{ width: '100%', fontSize: 13.5, padding: '11px 14px', borderRadius: 10, border: `1.5px solid ${palette.slate300}`, background: palette.slate50, color: palette.navy900, outline: 'none', fontFamily: 'inherit' }} />;
}

/** Password input with a show/hide eye toggle on the right. Same look as
 *  PfInput; type flips between 'password' and 'text' on click. No left
 *  icon — matches the plain (no-icon) password fields used on Landing and
 *  Register, so there's no reserved dead space on the left. */
export function PfPasswordInput(props: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const [visible, setVisible] = useState(false);
  return (
    <div style={{ position: 'relative' }}>
      <input
        {...props}
        type={visible ? 'text' : 'password'}
        className="pf-input"
        style={{ width: '100%', fontSize: 13.5, padding: '11px 42px 11px 14px', borderRadius: 10, border: `1.5px solid ${palette.slate300}`, background: palette.slate50, color: palette.navy900, outline: 'none', fontFamily: 'inherit' }}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? 'Hide password' : 'Show password'}
        aria-pressed={visible}
        style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', padding: 4, display: 'flex', alignItems: 'center', color: palette.slate400, cursor: 'pointer' }}
      >
        {visible ? <EyeOffIcon /> : <EyeIcon />}
      </button>
    </div>
  );
}

export function PfButton({
  children, ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className="pf-btn"
      style={{
        width: '100%', color: palette.white, fontSize: 14.5, fontWeight: 700, padding: '12px', border: 'none', borderRadius: 10,
        fontFamily: 'inherit', background: palette.accent, boxShadow: '0 10px 22px -12px rgba(28,57,142,.75)',
      }}
    >
      {children}
    </button>
  );
}

/* ---------- Icons ---------- */

function RoleIconFor({ portal }: { portal: PortalKey }) {
  switch (portal) {
    case 'student': return <GraduationIcon />;
    case 'external': return <GlobeIcon />;
    case 'coordinator': return <WhistleIcon />;
    default: return <ShieldIcon />;
  }
}
function GraduationIcon() {
  return <svg width="30" height="30" viewBox="0 0 24 24" fill="none"><path d="M2 8l10-5 10 5-10 5-10-5z" stroke="#fff" strokeWidth="1.6" strokeLinejoin="round"/><path d="M6 10.5V16c0 1.4 2.7 3 6 3s6-1.6 6-3v-5.5" stroke="#fff" strokeWidth="1.6" strokeLinecap="round"/><path d="M21 8v6" stroke="#fff" strokeWidth="1.6" strokeLinecap="round"/></svg>;
}
function GlobeIcon() {
  return <svg width="30" height="30" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="#fff" strokeWidth="1.6"/><path d="M3 12h18M12 3c2.5 2.5 3.8 5.7 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.7-3.8-9S9.5 5.5 12 3z" stroke="#fff" strokeWidth="1.6"/></svg>;
}
function WhistleIcon() {
  return <svg width="30" height="30" viewBox="0 0 24 24" fill="none"><circle cx="9" cy="15" r="5" stroke="#fff" strokeWidth="1.6"/><path d="M9 15v-1a1 1 0 0 1 1-1h4l5-4v3l-4 3" stroke="#fff" strokeWidth="1.6" strokeLinejoin="round"/><circle cx="9" cy="15" r="1.4" fill="#fff"/></svg>;
}
function ShieldIcon() {
  return <svg width="30" height="30" viewBox="0 0 24 24" fill="none"><path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" stroke="#fff" strokeWidth="1.6" strokeLinejoin="round"/><path d="M9 12l2 2 4-4" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}
export function ArrowLeftIcon() {
  return <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M13 8H3M7 4L3 8l4 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}
export function ArrowRightIcon() {
  return <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}
export function LogoutIcon() {
  return <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M6 2H3a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3M11 11l3-3-3-3M14 8H6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}
export function BellIcon() {
  return <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a1 1 0 0 1 1 1v.6a4.5 4.5 0 0 1 3.5 4.4v2.3l1 2H2.5l1-2V7a4.5 4.5 0 0 1 3.5-4.4V2a1 1 0 0 1 1-1zM6.2 13h3.6a1.8 1.8 0 0 1-3.6 0z"/></svg>;
}
export function IdCardIcon() {
  return <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor"><path d="M1 3h14a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H1a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zm3 3.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM2.3 11.2c.3-1 1.4-1.7 2.7-1.7s2.4.7 2.7 1.7H2.3zM9 5h5v1H9V5zm0 2.2h5v1H9v-1zM9 9.4h3.5v1H9v-1z"/></svg>;
}
export function KeyIcon() {
  return <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M9.5 1a4.5 4.5 0 0 0-4.4 5.5L1 10.6V13h2.4l.5-.5v-1h1v-1h1l1.2-1.2A4.5 4.5 0 1 0 9.5 1zm1.3 2.7a1.3 1.3 0 1 1 0 2.6 1.3 1.3 0 0 1 0-2.6z"/></svg>;
}
export function ShieldCheckIcon() {
  return <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 1l6 2.5v4c0 4-2.6 6.5-6 7.5-3.4-1-6-3.5-6-7.5v-4L8 1z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/><path d="M5.5 8l1.7 1.7L10.5 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}
export function ChartIcon() {
  return <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor"><path d="M1 14V2h1.5v10.5H14V14H1zm2.5-2.5V7H5v4.5H3.5zm3.2 0V4H8v7.5H6.7zm3.3 0v-6h1.5v6H10z"/></svg>;
}
export function CompassIcon() {
  return <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.8" stroke="currentColor" strokeWidth="1.4"/><path d="M10.3 5.7 8.9 8.9l-3.2 1.4 1.4-3.2 3.2-1.4z" fill="currentColor"/></svg>;
}
export function CalendarIcon() {
  return <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor"><path d="M4 1h1v1.5h6V1h1v1.5h2A1.5 1.5 0 0 1 15.5 4v9A1.5 1.5 0 0 1 14 14.5H2A1.5 1.5 0 0 1 .5 13V4A1.5 1.5 0 0 1 2 2.5h2V1zM1.5 6v7A.5.5 0 0 0 2 13.5h12a.5.5 0 0 0 .5-.5V6h-13z"/></svg>;
}
export function EyeIcon() {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M1 8s2.7-5 7-5 7 5 7 5-2.7 5-7 5-7-5-7-5z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/><circle cx="8" cy="8" r="2.2" stroke="currentColor" strokeWidth="1.5"/></svg>;
}
export function EyeOffIcon() {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M1 8s2.7-5 7-5c1.4 0 2.6.4 3.7 1M15 8s-2.7 5-7 5c-1.4 0-2.6-.4-3.7-1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><path d="M6 9.7A2.2 2.2 0 0 1 8 5.8M10 6.3c.5.4.8 1 .8 1.7 0 .3-.05.6-.15.9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><path d="M1.5 1.5l13 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>;
}
function WarnIcon() {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1 15.5 14H.5L8 1zm0 4.5v4M8 11.5h.01" stroke="#B91C1C" strokeWidth="1.5" strokeLinecap="round" fill="none"/></svg>;
}
