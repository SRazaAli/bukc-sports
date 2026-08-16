/**
 * Login screen, parameterized by role. Matches the BUKC portal screenshots:
 *  - Student: Enrollment + Password + Institute (Karachi default, rest disabled)
 *  - External / Coordinator / Admin: Email + Password only
 * Student & External show a "New …" registration link; Coordinator & Admin do
 * not (coordinators are invited per AUTH-06; admins are seeded).
 *
 * Visual redesign only — auth logic, validation, and API calls are unchanged.
 */
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AuthSplit, FieldGroup, AuthInput, AuthSelect, AuthButton, AuthLinkRow, AuthLink, ErrorBanner,
  PersonIcon, LockIcon, BankIcon, type PortalKey,
} from './AuthUI.js';
import { useAuth } from '../../lib/auth.js';
import { login, studentLogin } from './api.js';
import { ApiRequestError } from '../../lib/api.js';
import { INSTITUTES, DEFAULT_INSTITUTE } from './reference-data.js';

export type LoginRole = 'student' | 'external' | 'coordinator' | 'admin';

const CONFIG: Record<LoginRole, {
  title: string; expectedRole: string; newLink?: { to: string; label: string };
  headline: string; subhead: string; chip: string;
}> = {
  student: {
    title: 'Student', expectedRole: 'STUDENT', newLink: { to: '/register/student', label: 'New Student' },
    headline: 'Book courts, track equipment, done in minutes.',
    subhead: 'Sign in with your enrollment number to reserve venues and borrow sports equipment across campus.',
    chip: 'Live venue availability',
  },
  external: {
    title: 'External', expectedRole: 'EXTERNAL', newLink: { to: '/register/external', label: 'New External' },
    headline: 'Bring your event to the BUKC courts.',
    subhead: 'External members can request venues and manage bookings once verified by an administrator.',
    chip: 'Trusted by partner institutions',
  },
  coordinator: {
    title: 'Coordinator', expectedRole: 'COORDINATOR',
    headline: 'Keep every booking and borrow request on track.',
    subhead: 'Review the borrow queue, resolve venue conflicts, and manage equipment alerts in one dashboard.',
    chip: 'Queue & conflict tools',
  },
  admin: {
    title: 'Administration Staff', expectedRole: 'SUPER_ADMIN',
    headline: 'Oversee the whole sports operation at a glance.',
    subhead: 'Approve venues, manage accounts, and monitor activity across the entire platform.',
    chip: 'Full platform control',
  },
};

export default function LoginScreen({ role }: { role: LoginRole }) {
  const cfg = CONFIG[role];
  const { setUser } = useAuth();
  const navigate = useNavigate();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const isStudent = role === 'student';
  const portal = role as PortalKey;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const user = isStudent
        ? await studentLogin(identifier, password)
        : await login(identifier, password);

      if (user.role !== cfg.expectedRole) {
        setError(`These credentials are not for the ${cfg.title} portal.`);
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
    <AuthSplit
      portal={portal}
      eyebrow={`${cfg.title} Portal`}
      headline={cfg.headline}
      subhead={cfg.subhead}
      chip={cfg.chip}
    >
      <div style={{ marginBottom: 22 }}>
        <h2 style={{ margin: '2px 0 4px', fontSize: 24, fontWeight: 700, color: '#0B3754' }}>
          Sign in to {cfg.title}
        </h2>
        <p style={{ margin: 0, fontSize: 14, color: '#5C7180' }}>Enter your credentials to continue.</p>
      </div>

      <form onSubmit={onSubmit} noValidate>
        {error && <div style={{ marginBottom: 16 }}><ErrorBanner>{error}</ErrorBanner></div>}

        {isStudent ? (
          <FieldGroup label="Enrollment" icon={<PersonIcon />}>
            <AuthInput
              placeholder="e.g. 84-024000-123" autoComplete="username" required
              value={identifier} onChange={(e) => setIdentifier(e.target.value)}
            />
          </FieldGroup>
        ) : (
          <FieldGroup label="Email" icon={<PersonIcon />}>
            <AuthInput
              type="email" placeholder="you@example.com" autoComplete="username" required
              value={identifier} onChange={(e) => setIdentifier(e.target.value)}
            />
          </FieldGroup>
        )}

        <FieldGroup label="Password" icon={<LockIcon />}>
          <AuthInput
            type="password" placeholder="••••••••" autoComplete="current-password" required
            value={password} onChange={(e) => setPassword(e.target.value)}
          />
        </FieldGroup>

        {isStudent && (
          <FieldGroup label="Institute" icon={<BankIcon />}>
            <AuthSelect defaultValue={DEFAULT_INSTITUTE}>
              {INSTITUTES.map((inst) => (
                <option key={inst} value={inst} disabled={inst !== DEFAULT_INSTITUTE}>{inst}</option>
              ))}
            </AuthSelect>
          </FieldGroup>
        )}

        <div style={{ marginTop: 6 }}>
          <AuthButton type="submit" portal={portal} disabled={loading}>
            {loading ? 'Signing in…' : `Sign in as ${cfg.title === 'Administration Staff' ? 'Admin' : cfg.title}`}
          </AuthButton>
        </div>

        <div style={{ marginTop: 18 }}>
          <AuthLinkRow>
            {cfg.newLink ? <AuthLink to={cfg.newLink.to}>{cfg.newLink.label}</AuthLink> : <span />}
            <AuthLink to="/forgot-password">Forgot password?</AuthLink>
          </AuthLinkRow>
        </div>
        <div style={{ marginTop: 16, textAlign: 'center' }}>
          <AuthLink to="/" style={{ fontSize: 12.5, color: '#5C7180', fontWeight: 500 }}>← Back to all portals</AuthLink>
        </div>
      </form>
    </AuthSplit>
  );
}
