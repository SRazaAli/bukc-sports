/**
 * RegisterScreen — student | external registration.
 *
 * Coordinator and Super Admin have NO register screen (invite-only / seeded).
 *
 * Backend logic unchanged:
 *  - Student  → POST /api/auth/register/student
 *  - External → POST /api/auth/register/external
 *  - On success → "awaiting verification" state (no auto-login)
 *
 * Student form has cascading Department → Program Title dropdowns.
 * External form has institution + representative + designation fields.
 */
import { useState, useMemo, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import AuthShell, { Field, AuthError, AuthSuccess, type AuthRole } from './AuthShell.js';
import { registerStudent, registerExternal } from './api.js';
import { ApiRequestError } from '../../lib/api.js';
import { DEPARTMENTS } from './reference-data.js';

type Role = 'student' | 'external';

interface RoleCfg {
  title: string;
  subtitle: string;
  loginLink: string;
}
const CFG: Record<Role, RoleCfg> = {
  student:  { title: 'Create Account', subtitle: 'Student — Bahria University', loginLink: '/login/student' },
  external: { title: 'Create Account', subtitle: 'External Organisation',        loginLink: '/login/external' },
};

export default function RegisterScreen({ role }: { role: Role }) {
  const cfg = CFG[role];

  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Shared fields
  const [fullName,      setFullName]      = useState('');
  const [email,         setEmail]         = useState('');
  const [contactNumber, setContactNumber] = useState('');
  const [password,      setPassword]      = useState('');

  // Student-only
  const [enrollmentNo,  setEnrollmentNo]  = useState('');
  const [department,    setDepartment]    = useState('');
  const [programTitle,  setProgramTitle]  = useState('');

  // External-only
  const [institutionName,    setInstitutionName]    = useState('');
  const [representativeName, setRepresentativeName] = useState('');
  const [designation,        setDesignation]        = useState('');

  const programs = useMemo(
    () => DEPARTMENTS.find((d) => d.name === department)?.programs ?? [],
    [department],
  );

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (role === 'student') {
        await registerStudent({ fullName, email, contactNumber, password, enrollmentNo, department, programTitle });
      } else {
        await registerExternal({ fullName, email, contactNumber, password, institutionName, representativeName, designation });
      }
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.body.error : 'Could not create the account. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  // ── Success state ──────────────────────────────────────────────────────────

  if (done) {
    return (
      <AuthShell role={role as AuthRole} title="Account Created" subtitle={cfg.subtitle}>
        <div style={{ textAlign: 'center', padding: '8px 0' }}>
          <div style={{
            width: 56, height: 56, borderRadius: '50%',
            background: 'var(--ok-bg)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 20px',
            color: 'var(--ok)',
          }}>
            <svg width="26" height="26" viewBox="0 0 26 26" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="5,13 10,18 21,8"/>
            </svg>
          </div>
          <h3 style={{ font: '700 18px var(--font-display)', color: 'var(--navy)', margin: '0 0 10px' }}>
            Application Submitted
          </h3>
          <p style={{ font: '13.5px/1.6 var(--font-body)', color: 'var(--ink-muted)', margin: '0 0 24px' }}>
            Your account is awaiting administrator verification. You'll receive an email once it's approved.
          </p>
          <AuthSuccess message="Account created — awaiting administrator verification." />
          <div style={{ marginTop: 20 }}>
            <Link to={cfg.loginLink} className="auth-link" style={{ fontWeight: 600 }}>
              ← Back to Sign In
            </Link>
          </div>
        </div>
      </AuthShell>
    );
  }

  // ── Form ───────────────────────────────────────────────────────────────────

  return (
    <AuthShell role={role as AuthRole} title={cfg.title} subtitle={cfg.subtitle} cardWidth={520}>
      <form onSubmit={onSubmit} noValidate>
        {error && <AuthError message={error} />}

        {/* ── Shared fields ── */}
        <SectionLabel>Personal Details</SectionLabel>

        <TwoCol>
          <Field label="Full Name">
            <input className="auth-input" type="text" value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Muhammad Ali Khan" required />
          </Field>
          <Field label="Contact Number">
            <input className="auth-input" type="tel" value={contactNumber}
              onChange={(e) => setContactNumber(e.target.value)}
              placeholder="03xxxxxxxxx" required />
          </Field>
        </TwoCol>

        <Field label="Email Address">
          <input className="auth-input" type="email" value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com" autoComplete="email" required />
        </Field>

        <Field label="Password" hint="Minimum 8 characters">
          <div style={{ position: 'relative' }}>
            <input
              className="auth-input"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Create a password"
              autoComplete="new-password"
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

        {/* ── Student-specific ── */}
        {role === 'student' && (
          <>
            <Divider />
            <SectionLabel>Academic Information</SectionLabel>

            <Field label="Enrollment Number" hint="Format: 84-024000-123">
              <input className="auth-input" type="text" value={enrollmentNo}
                onChange={(e) => setEnrollmentNo(e.target.value)}
                placeholder="84-024000-123" required />
            </Field>

            <TwoCol>
              <Field label="Department">
                <select className="auth-input" value={department}
                  onChange={(e) => { setDepartment(e.target.value); setProgramTitle(''); }}
                  required>
                  <option value="">Select department</option>
                  {DEPARTMENTS.map((d) => (
                    <option key={d.name} value={d.name}>{d.name}</option>
                  ))}
                </select>
              </Field>

              <Field label="Program">
                <select className="auth-input" value={programTitle}
                  onChange={(e) => setProgramTitle(e.target.value)}
                  disabled={!department} required>
                  <option value="">{department ? 'Select program' : 'Pick department first'}</option>
                  {programs.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </Field>
            </TwoCol>
          </>
        )}

        {/* ── External-specific ── */}
        {role === 'external' && (
          <>
            <Divider />
            <SectionLabel>Organisation Details</SectionLabel>

            <Field label="Institution / Organisation Name">
              <input className="auth-input" type="text" value={institutionName}
                onChange={(e) => setInstitutionName(e.target.value)}
                placeholder="e.g. NUST, DHA College" required />
            </Field>

            <TwoCol>
              <Field label="Representative Name">
                <input className="auth-input" type="text" value={representativeName}
                  onChange={(e) => setRepresentativeName(e.target.value)}
                  placeholder="Full name" required />
              </Field>
              <Field label="Designation / Role">
                <input className="auth-input" type="text" value={designation}
                  onChange={(e) => setDesignation(e.target.value)}
                  placeholder="e.g. Head of Sports" required />
              </Field>
            </TwoCol>
          </>
        )}

        <div style={{ marginTop: 24 }}>
          <button type="submit" className="auth-submit" disabled={loading}>
            {loading ? 'Creating account…' : 'Create Account'}
          </button>
        </div>

        <div style={{ textAlign: 'center', marginTop: 18, fontSize: 13.5, color: 'var(--ink-muted)' }}>
          Already have an account?{' '}
          <Link to={cfg.loginLink} className="auth-link" style={{ fontWeight: 600 }}>
            Sign in
          </Link>
        </div>
      </form>
    </AuthShell>
  );
}

// ── Layout helpers ────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      font: '600 11px var(--font-body)',
      color: 'var(--ink-muted)',
      textTransform: 'uppercase',
      letterSpacing: '0.08em',
      marginBottom: 12,
    }}>
      {children}
    </div>
  );
}

function TwoCol({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: 12,
    }}>
      <style>{`@media (max-width: 480px) { .two-col { grid-template-columns: 1fr !important; } }`}</style>
      <div className="two-col" style={{
        display: 'contents',
      }}>
        {children}
      </div>
    </div>
  );
}

function Divider() {
  return <div style={{ height: 1, background: 'var(--line-light)', margin: '20px 0 16px' }} />;
}

// ── Eye icons ─────────────────────────────────────────────────────────────────

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
