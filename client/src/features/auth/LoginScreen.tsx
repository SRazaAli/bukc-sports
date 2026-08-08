/**
 * Login screen, parameterized by role. Matches the BUKC portal screenshots:
 *  - Student: Enrollment + Password + Institute (Karachi default, rest disabled)
 *  - External / Coordinator / Admin: Email + Password only
 * Student & External show a "New …" registration link; Coordinator & Admin do
 * not (coordinators are invited per AUTH-06; admins are seeded).
 */
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  PortalShell, LabeledInput, LabeledSelect, PrimaryButton, fs,
  PersonIcon, LockIcon, BankIcon, type BarTint,
} from './PortalShell.js';
import { useAuth } from '../../lib/auth.js';
import { login, studentLogin } from './api.js';
import { ApiRequestError } from '../../lib/api.js';
import { INSTITUTES, DEFAULT_INSTITUTE } from './reference-data.js';

export type LoginRole = 'student' | 'external' | 'coordinator' | 'admin';

const CONFIG: Record<LoginRole, { title: string; tint: BarTint; newLink?: { to: string; label: string }; expectedRole: string }> = {
  student:     { title: 'Student', tint: 'sage', newLink: { to: '/register/student', label: 'New Student' }, expectedRole: 'STUDENT' },
  external:    { title: 'External', tint: 'blue', newLink: { to: '/register/external', label: 'New External' }, expectedRole: 'EXTERNAL' },
  coordinator: { title: 'Coordinator', tint: 'slate', expectedRole: 'COORDINATOR' },
  admin:       { title: 'Administration Staff', tint: 'navy', expectedRole: 'SUPER_ADMIN' },
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
    <PortalShell title={cfg.title} tint={cfg.tint}>
      <form onSubmit={onSubmit} noValidate style={fs.formCol}>
        {error && <div style={errorBox}>{error}</div>}

        {isStudent ? (
          <LabeledInput
            label="Enrollment:" icon={<PersonIcon />} placeholder="Enrollment"
            autoComplete="username" value={identifier} onChange={(e) => setIdentifier(e.target.value)} required
          />
        ) : (
          <LabeledInput
            label="Email:" icon={<PersonIcon />} type="email" placeholder="Email"
            autoComplete="username" value={identifier} onChange={(e) => setIdentifier(e.target.value)} required
          />
        )}

        <LabeledInput
          label="Password:" icon={<LockIcon />} type="password" placeholder="Password"
          autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required
        />

        {isStudent && (
          <LabeledSelect label="Institute:" icon={<BankIcon />} defaultValue={DEFAULT_INSTITUTE}>
            {INSTITUTES.map((inst) => (
              <option key={inst} value={inst} disabled={inst !== DEFAULT_INSTITUTE}>{inst}</option>
            ))}
          </LabeledSelect>
        )}

        <PrimaryButton type="submit" disabled={loading}>{loading ? 'Signing in…' : 'Sign In'}</PrimaryButton>

        <div style={linkRow}>
          {cfg.newLink ? <Link to={cfg.newLink.to} style={link}>{cfg.newLink.label}</Link> : <span />}
          <Link to="/forgot-password" style={link}>Forgot Password?</Link>
        </div>
        <div style={{ marginTop: 18, textAlign: 'center' }}>
          <Link to="/" style={{ ...link, fontSize: 13 }}>← All portals</Link>
        </div>
      </form>
    </PortalShell>
  );
}

const errorBox: React.CSSProperties = { background: '#fdecec', color: '#8f2323', border: '1px solid #f3caca', borderRadius: 4, padding: '10px 12px', marginBottom: 16, fontSize: 14 };
const linkRow: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', marginTop: 16 };
const link: React.CSSProperties = { color: '#0a6ebd', textDecoration: 'none', fontSize: 14 };
