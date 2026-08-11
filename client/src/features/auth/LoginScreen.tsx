/**
 * LoginScreen — parameterized by role (student | external | coordinator | admin).
 *
 * Backend logic unchanged:
 *  - Student logs in by enrollment number  → POST /api/auth/login/student
 *  - All others log in by email            → POST /api/auth/login
 *  - Role mismatch (wrong portal) → client-side guard
 *  - Coordinator and Admin have NO register link (invite-only / seeded)
 */
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import AuthShell, { Field, AuthError, AuthDivider, type AuthRole } from './AuthShell.js';
import { useAuth } from '../../lib/auth.js';
import { login, studentLogin } from './api.js';
import { ApiRequestError } from '../../lib/api.js';
import { INSTITUTES, DEFAULT_INSTITUTE } from './reference-data.js';

export type LoginRole = 'student' | 'external' | 'coordinator' | 'admin';

interface RoleCfg {
  title: string;
  subtitle: string;
  expectedRole: string;
  registerLink?: { to: string; label: string };
}

const CONFIG: Record<LoginRole, RoleCfg> = {
  student: {
    title: 'Sign In',
    subtitle: 'Student Portal — Bahria University',
    expectedRole: 'STUDENT',
    registerLink: { to: '/register/student', label: 'Create account' },
  },
  external: {
    title: 'Sign In',
    subtitle: 'External Organisation Portal',
    expectedRole: 'EXTERNAL',
    registerLink: { to: '/register/external', label: 'Create account' },
  },
  coordinator: {
    title: 'Sign In',
    subtitle: 'Coordinator Portal — Invite only',
    expectedRole: 'COORDINATOR',
  },
  admin: {
    title: 'Sign In',
    subtitle: 'Administration Staff Portal',
    expectedRole: 'SUPER_ADMIN',
  },
};

export default function LoginScreen({ role }: { role: LoginRole }) {
  const cfg = CONFIG[role];
  const authRole = role as AuthRole;
  const { setUser } = useAuth();
  const navigate = useNavigate();

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [institute, setInstitute] = useState(DEFAULT_INSTITUTE);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const isStudent = role === 'student';

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const user = isStudent
        ? await studentLogin(identifier, password)
        : await login(identifier, password);

      if (user.role !== cfg.expectedRole) {
        setError(`These credentials belong to a different portal. Please use the correct sign-in page.`);
        setLoading(false);
        return;
      }
      setUser(user);
      navigate('/home');
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.body.error : 'Could not sign in. Please try again.');
      setLoading(false);
    }
  }

  return (
    <AuthShell role={authRole} title={cfg.title} subtitle={cfg.subtitle}>
      <form onSubmit={onSubmit} noValidate>
        {error && <AuthError message={error} />}

        {/* Identifier field */}
        {isStudent ? (
          <Field label="Enrollment Number" hint="Format: 84-024000-123">
            <input
              className="auth-input"
              type="text"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="84-024000-123"
              autoComplete="username"
              required
            />
          </Field>
        ) : (
          <Field label="Email Address">
            <input
              className="auth-input"
              type="email"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              required
            />
          </Field>
        )}

        {/* Password */}
        <Field label="Password">
          <div style={{ position: 'relative' }}>
            <input
              className="auth-input"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Your password"
              autoComplete="current-password"
              style={{ paddingRight: 40 }}
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              tabIndex={-1}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              style={{
                position: 'absolute', right: 10, top: '50%',
                transform: 'translateY(-50%)',
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--ink-faint)', display: 'flex', padding: 2,
              }}
            >
              {showPassword ? <EyeOff /> : <EyeOn />}
            </button>
          </div>
        </Field>

        {/* Institute dropdown (student only) */}
        {isStudent && (
          <Field label="Institute">
            <select
              className="auth-input"
              value={institute}
              onChange={(e) => setInstitute(e.target.value)}
            >
              {INSTITUTES.map((inst) => (
                <option key={inst} value={inst} disabled={inst !== DEFAULT_INSTITUTE}>
                  {inst}{inst !== DEFAULT_INSTITUTE ? ' (not available)' : ''}
                </option>
              ))}
            </select>
          </Field>
        )}

        {/* Forgot password */}
        <div style={{ textAlign: 'right', marginBottom: 20, marginTop: -6 }}>
          <Link to="/forgot-password" className="auth-link" style={{ fontSize: 12.5 }}>
            Forgot password?
          </Link>
        </div>

        <button type="submit" className="auth-submit" disabled={loading}>
          {loading ? 'Signing in…' : 'Sign In'}
        </button>

        {/* Register link — Student and External only */}
        {cfg.registerLink && (
          <>
            <AuthDivider label="or" />
            <div style={{ textAlign: 'center', fontSize: 13.5, color: 'var(--ink-muted)' }}>
              New to BUKC Sports?{' '}
              <Link to={cfg.registerLink.to} className="auth-link" style={{ fontWeight: 600 }}>
                {cfg.registerLink.label}
              </Link>
            </div>
          </>
        )}

        {/* Coordinator info note */}
        {role === 'coordinator' && (
          <p style={{
            marginTop: 20, marginBottom: 0,
            font: '12.5px/1.6 var(--font-body)',
            color: 'var(--ink-faint)',
            textAlign: 'center',
          }}>
            Coordinator accounts are created by invitation only. Contact the sports department administrator.
          </p>
        )}
      </form>
    </AuthShell>
  );
}

// ── SVG eye icons ─────────────────────────────────────────────────────────────

function EyeOn() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z"/>
      <circle cx="8" cy="8" r="2"/>
    </svg>
  );
}
function EyeOff() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 2l12 12M6.5 6.6A2 2 0 0 0 9.4 9.5"/>
      <path d="M6.9 3.1C7.3 3 7.6 3 8 3c4.5 0 7 5 7 5a12 12 0 0 1-1.8 2.6M4.7 4.8A12 12 0 0 0 1 8s2.5 5 7 5c1.4 0 2.7-.4 3.8-1"/>
    </svg>
  );
}
