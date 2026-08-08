/**
 * Portal chrome matching the BUKC screenshots: a dark navy top bar with the
 * university wordmark, a light title band naming the current page, the content,
 * and a thin footer. The top bar tint changes per role to echo the landing tiles
 * (student = sage green, admin = navy, etc.), exactly as the real portal does.
 */
import type { ReactNode } from 'react';

export type BarTint = 'navy' | 'sage' | 'blue' | 'slate';

const TINTS: Record<BarTint, string> = {
  navy: '#26485f',
  sage: '#7c9478',
  blue: '#0a5c9c',
  slate: '#2f4a5c',
};

export function PortalShell({
  title, tint = 'navy', children,
}: { title: string; tint?: BarTint; children: ReactNode }) {
  return (
    <div style={s.page}>
      <header style={{ ...s.topbar, background: TINTS[tint] }}>
        <span style={s.wordmark}>Bahria University</span>
      </header>
      <div style={s.titleBand}>
        <h1 style={s.title}>{title}</h1>
      </div>
      <main style={s.main}>{children}</main>
      <footer style={s.footer}>
        2026 © <a href="/" style={s.footerLink}>Bahria University</a>
      </footer>
    </div>
  );
}

const s = {
  page: { minHeight: '100%', display: 'flex', flexDirection: 'column', background: '#fff', fontFamily: 'var(--font-body)' } as const,
  topbar: { height: 56, display: 'flex', alignItems: 'center', padding: '0 24px', borderTop: '3px solid #0a5c9c' } as const,
  wordmark: { color: '#fff', fontFamily: 'Georgia, "Times New Roman", serif', fontSize: 24, fontWeight: 400 } as const,
  titleBand: { background: '#f7f7f7', borderBottom: '1px solid #e6e6e6', padding: '18px 24px' } as const,
  title: { textAlign: 'center', margin: 0, fontSize: 30, fontWeight: 800, color: '#2b2b2b', fontFamily: '"Segoe UI", system-ui, sans-serif' } as const,
  main: { flex: 1, padding: '48px 24px' } as const,
  footer: { borderTop: '1px solid #e6e6e6', padding: '14px 24px', fontSize: 13, color: '#333' } as const,
  footerLink: { color: '#0a6ebd', textDecoration: 'none' } as const,
};

// Shared form primitives styled to match the screenshots (icon box + input).
export function LabeledInput({
  label, icon, ...props
}: { label: string; icon: ReactNode } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div style={{ marginBottom: 18 }}>
      <label style={fs.label}>{label}</label>
      <div style={fs.inputRow}>
        <span style={fs.iconBox}>{icon}</span>
        <input {...props} style={fs.input} />
      </div>
    </div>
  );
}

export function LabeledSelect({
  label, icon, children, ...props
}: { label: string; icon: ReactNode; children: ReactNode } & React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div style={{ marginBottom: 18 }}>
      <label style={fs.label}>{label}</label>
      <div style={fs.inputRow}>
        <span style={fs.iconBox}>{icon}</span>
        <select {...props} style={{ ...fs.input, appearance: 'auto' }}>{children}</select>
      </div>
    </div>
  );
}

export function PrimaryButton({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} style={{ ...fs.button, ...(props.disabled ? fs.buttonDisabled : null) }}>{children}</button>;
}

export const fs = {
  label: { display: 'block', fontWeight: 700, fontSize: 14, color: '#333', marginBottom: 6 } as const,
  inputRow: { display: 'flex', alignItems: 'stretch' } as const,
  iconBox: { display: 'flex', alignItems: 'center', justifyContent: 'center', width: 42, background: '#eee', border: '1px solid #ccc', borderRight: 'none', borderRadius: '4px 0 0 4px', color: '#555' } as const,
  input: { flex: 1, fontSize: 15, padding: '9px 12px', border: '1px solid #ccc', borderRadius: '0 4px 4px 0', color: '#333', outline: 'none', minWidth: 0 } as const,
  button: { width: '100%', background: 'linear-gradient(#127bb5, #0a5c8f)', color: '#fff', fontSize: 16, fontWeight: 600, padding: '11px', border: 'none', borderRadius: 4, cursor: 'pointer' } as const,
  buttonDisabled: { opacity: 0.6, cursor: 'not-allowed' } as const,
  formCol: { maxWidth: 620, margin: '0 auto' } as const,
};

// Small inline icons matching the screenshots' glyphs.
export const PersonIcon = () => <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm0 1.5c-2.5 0-6 1.25-6 3.5V15h12v-2c0-2.25-3.5-3.5-6-3.5z"/></svg>;
export const LockIcon = () => <svg width="14" height="16" viewBox="0 0 14 16" fill="currentColor"><path d="M11 6V4.5a4 4 0 0 0-8 0V6H2v9h10V6h-1zM4.5 4.5a2.5 2.5 0 0 1 5 0V6h-5V4.5z"/></svg>;
export const BankIcon = () => <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1 1 5v1h14V5L8 1zM2 7v6H1v2h14v-2h-1V7h-2v6h-2V7H8v6H6V7H4v6H2V7z"/></svg>;
export const MailIcon = () => <svg width="16" height="14" viewBox="0 0 16 14" fill="currentColor"><path d="M1 2h14v10H1V2zm1.2 1L8 7.2 13.8 3H2.2zM14 4.3l-6 4.3-6-4.3V11h12V4.3z"/></svg>;
export const RoleIcon = () => <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M6 7a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zm0 1c-2 0-5 1-5 3v1h7.5A3.5 3.5 0 0 1 8 11c0-1.1.5-2.1 1.3-2.7C8.4 8.1 7.2 8 6 8zm7 0 .7 1.2 1.3.3-1 1 .2 1.3L13 12l-1.2.6.2-1.3-1-1 1.3-.3L13 8z"/></svg>;
