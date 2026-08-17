/**
 * AuthShell — shared layout for all pre-authentication screens.
 * Provides the full-page split: left decorative panel + right content card.
 * Replaces PortalShell entirely for the new design system.
 *
 * Usage:
 *   <AuthShell role="student" title="Sign In" subtitle="Student Portal">
 *     <form>…</form>
 *   </AuthShell>
 */

import { type ReactNode } from 'react';
import { Link } from 'react-router-dom';

export type AuthRole = 'student' | 'external' | 'coordinator' | 'admin';

interface RoleConfig {
  accent: string;         // solid colour for left panel
  label: string;          // human-readable role name
  backTo: string;         // "/" to go back to landing
}

const ROLE_CONFIG: Record<AuthRole, RoleConfig> = {
  student:     { accent: '#498473', label: 'Student Portal',            backTo: '/' },
  external:    { accent: '#2a6d9e', label: 'External Portal',           backTo: '/' },
  coordinator: { accent: '#3d5a72', label: 'Coordinator Portal',        backTo: '/' },
  admin:       { accent: '#0B3754', label: 'Administration Staff Portal',backTo: '/' },
};

interface AuthShellProps {
  role: AuthRole;
  title: string;
  subtitle?: string;
  children: ReactNode;
  /** Max width of the right content card. Default 420. */
  cardWidth?: number;
}

export default function AuthShell({
  role, title, subtitle, children, cardWidth = 420,
}: AuthShellProps) {
  const cfg = ROLE_CONFIG[role];

  return (
    <div style={s.page}>
      <style>{`
        .auth-input {
          width: 100%;
          font: 14px var(--font-body);
          padding: 9px 12px;
          border: 1px solid var(--line);
          border-radius: var(--radius);
          color: var(--ink);
          background: var(--white);
          outline: none;
          transition: border-color 140ms, box-shadow 140ms;
          appearance: auto;
        }
        .auth-input:focus {
          border-color: ${cfg.accent};
          box-shadow: 0 0 0 3px ${cfg.accent}22;
        }
        .auth-input::placeholder { color: var(--ink-faint); }
        .auth-input:disabled { background: var(--bg); opacity: 0.7; }

        .auth-submit {
          width: 100%;
          padding: 10px;
          font: 600 14.5px var(--font-body);
          color: #fff;
          background: ${cfg.accent};
          border: none;
          border-radius: var(--radius);
          cursor: pointer;
          transition: opacity 140ms, transform 80ms;
        }
        .auth-submit:hover:not(:disabled) { opacity: 0.88; }
        .auth-submit:active:not(:disabled) { transform: scale(0.99); }
        .auth-submit:disabled { opacity: 0.55; cursor: not-allowed; }

        .auth-link { color: ${cfg.accent}; text-decoration: none; font-size: 13.5px; }
        .auth-link:hover { text-decoration: underline; }

        .left-panel-logo { width: 44px; height: 44px; border-radius: 10px;
          background: rgba(255,255,255,0.2); display: flex; align-items: center;
          justify-content: center; font: 700 22px var(--font-display); color: #fff;
          margin-bottom: 20px; border: 1.5px solid rgba(255,255,255,0.25); }

        @media (max-width: 700px) {
          .auth-panel-left  { display: none !important; }
          .auth-panel-right { border-radius: 0 !important; max-width: 100% !important;
            min-height: 100vh; padding: 32px 24px !important; }
          .auth-page-wrap   { align-items: flex-start !important; }
        }
      `}</style>

      {/* Left decorative panel */}
      <div className="auth-panel-left" style={{ ...s.left, background: cfg.accent }}>
        {/* Back arrow */}
        <Link to={cfg.backTo} style={s.backLink}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9,1 3,7 9,13"/>
          </svg>
          All portals
        </Link>

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div className="left-panel-logo">B</div>
          <div style={s.leftTitle}>BUKC Sports</div>
          <div style={s.leftSub}>Bahria University Karachi Campus</div>
          <div style={s.leftDivider} />
          <div style={s.leftRoleLabel}>{cfg.label}</div>
          <div style={s.leftDesc}>
            Equipment borrowing · Venue booking · Sports records management
          </div>
        </div>

        {/* Bottom decoration */}
        <div style={s.leftFooter}>© 2026 Bahria University</div>
      </div>

      {/* Right content */}
      <div className="auth-page-wrap" style={s.right}>
        <div style={{ ...s.card, maxWidth: cardWidth }}>
          {/* Card header */}
          <div style={{ ...s.cardHead, borderColor: cfg.accent + '33' }}>
            <span style={{ ...s.cardHeadAccent, background: cfg.accent }} />
            <div>
              <div style={s.cardTitle}>{title}</div>
              {subtitle && <div style={s.cardSubtitle}>{subtitle}</div>}
            </div>
          </div>

          {/* Card body */}
          <div style={s.cardBody}>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
//  Shared form primitives
// ─────────────────────────────────────────────

/** A labelled form field wrapper */
export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{
        display: 'block',
        font: '500 12.5px var(--font-body)',
        color: 'var(--ink-muted)',
        marginBottom: 5,
        letterSpacing: '0.01em',
      }}>
        {label}
      </label>
      {children}
      {hint && (
        <div style={{ font: '11.5px var(--font-body)', color: 'var(--ink-faint)', marginTop: 4 }}>
          {hint}
        </div>
      )}
    </div>
  );
}

/** Error banner */
export function AuthError({ message }: { message: string }) {
  return (
    <div style={{
      background: 'var(--danger-bg)',
      color: 'var(--danger)',
      border: '1px solid #f3caca',
      borderRadius: 'var(--radius)',
      padding: '10px 14px',
      fontSize: 13.5,
      marginBottom: 18,
      lineHeight: 1.5,
    }}>
      {message}
    </div>
  );
}

/** Success / info banner */
export function AuthSuccess({ message }: { message: string }) {
  return (
    <div style={{
      background: 'var(--ok-bg)',
      color: 'var(--ok)',
      border: '1px solid #c2e6cd',
      borderRadius: 'var(--radius)',
      padding: '12px 14px',
      fontSize: 13.5,
      lineHeight: 1.5,
    }}>
      {message}
    </div>
  );
}

/** Thin divider with optional label */
export function AuthDivider({ label }: { label?: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      margin: '20px 0', color: 'var(--ink-faint)', fontSize: 12,
    }}>
      <div style={{ flex: 1, height: 1, background: 'var(--line-light)' }} />
      {label && <span>{label}</span>}
      <div style={{ flex: 1, height: 1, background: 'var(--line-light)' }} />
    </div>
  );
}

// ─────────────────────────────────────────────
//  Styles
// ─────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  page: {
    display: 'flex',
    minHeight: '100%',
    background: 'var(--bg)',
  },
  left: {
    width: 320,
    minWidth: 320,
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    padding: '28px 36px',
    position: 'sticky',
    top: 0,
    alignSelf: 'flex-start',
  },
  backLink: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    color: 'rgba(255,255,255,0.7)',
    fontSize: 13,
    textDecoration: 'none',
    marginBottom: 'auto',
    padding: '4px 0',
    transition: 'color 140ms',
  },
  leftTitle: {
    font: '700 26px/1.2 var(--font-display)',
    color: '#fff',
    letterSpacing: '-0.01em',
    marginBottom: 6,
  },
  leftSub: {
    font: '13px var(--font-body)',
    color: 'rgba(255,255,255,0.6)',
    marginBottom: 0,
  },
  leftDivider: {
    width: 40,
    height: 2,
    background: 'rgba(255,255,255,0.25)',
    borderRadius: 1,
    margin: '20px 0',
  },
  leftRoleLabel: {
    font: '600 14px var(--font-display)',
    color: 'rgba(255,255,255,0.9)',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    fontSize: 11,
  },
  leftDesc: {
    font: '13.5px/1.6 var(--font-body)',
    color: 'rgba(255,255,255,0.55)',
  },
  leftFooter: {
    font: '11px var(--font-body)',
    color: 'rgba(255,255,255,0.3)',
    marginTop: 32,
  },
  right: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '40px 24px',
    minHeight: '100vh',
  },
  card: {
    width: '100%',
    background: 'var(--white)',
    borderRadius: 'var(--radius-xl)',
    boxShadow: 'var(--shadow-lg)',
    border: '1px solid var(--line-light)',
    overflow: 'hidden',
  },
  cardHead: {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    padding: '20px 28px',
    borderBottom: '1px solid var(--line-light)',
    background: 'var(--bg)',
  },
  cardHeadAccent: {
    width: 4,
    height: 36,
    borderRadius: 2,
    flexShrink: 0,
  },
  cardTitle: {
    font: '700 18px/1.2 var(--font-display)',
    color: 'var(--navy)',
  },
  cardSubtitle: {
    font: '12.5px var(--font-body)',
    color: 'var(--ink-muted)',
    marginTop: 2,
  },
  cardBody: {
    padding: '28px',
  },
};
