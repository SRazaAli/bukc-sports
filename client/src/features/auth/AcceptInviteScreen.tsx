/**
 * Coordinator invite acceptance (AUTH-06). The invitee arrives via an email link
 * carrying a single-use token, sets their password, and the account activates.
 */
import { useState, type FormEvent } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { PortalShell, LabeledInput, PrimaryButton, fs, LockIcon } from './PortalShell.js';
import { acceptInvite } from './api.js';
import { useAuth } from '../../lib/auth.js';
import { ApiRequestError } from '../../lib/api.js';

export default function AcceptInviteScreen() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { setUser } = useAuth();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null); setLoading(true);
    try {
      await acceptInvite(token, password);
      setUser(null);
      navigate('/login/coordinator', { replace: true });
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.body.error : 'Could not activate the account.');
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <PortalShell title="Coordinator" tint="slate">
        <div style={panel}><div style={panelBody}>
          <div style={errBox}>This invitation link is missing its token. Ask your administrator to resend it.</div>
        </div></div>
      </PortalShell>
    );
  }

  return (
    <PortalShell title="Coordinator" tint="slate">
      <div style={panel}>
        <div style={panelHead}>Activate Your Account</div>
        <div style={panelBody}>
          <form onSubmit={onSubmit} noValidate style={fs.formCol}>
            {error && <div style={errBox}>{error}</div>}
            <p style={{ color: '#777', fontSize: 14, lineHeight: 1.6, marginTop: 0 }}>
              Set a password to finish setting up your coordinator account.
            </p>
            <LabeledInput label="Create a password:" icon={<LockIcon />} type="password"
              placeholder="At least 8 characters" autoComplete="new-password"
              value={password} onChange={(e) => setPassword(e.target.value)} required />
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 8 }}>
              <PrimaryButton type="submit" disabled={loading} style={{ width: 'auto', padding: '10px 28px' }}>
                {loading ? 'Activating…' : 'Activate Account'}
              </PrimaryButton>
              <Link to="/login/coordinator" style={link}>Already activated? Sign in</Link>
            </div>
          </form>
        </div>
      </div>
    </PortalShell>
  );
}

const panel: React.CSSProperties = { maxWidth: 640, margin: '0 auto', background: '#fff', border: '1px solid #ddd', borderRadius: 4, boxShadow: '0 1px 2px rgba(0,0,0,0.05)' };
const panelHead: React.CSSProperties = { padding: '14px 20px', borderBottom: '1px solid #e5e5e5', font: '600 16px var(--font-body)', color: '#333', background: 'linear-gradient(#fff,#f7f7f7)' };
const panelBody: React.CSSProperties = { padding: 24 };
const link: React.CSSProperties = { color: '#0a6ebd', textDecoration: 'none', fontSize: 14 };
const errBox: React.CSSProperties = { background: '#fdecec', color: '#8f2323', border: '1px solid #f3caca', borderRadius: 4, padding: '10px 12px', marginBottom: 14, fontSize: 14 };
