/**
 * Forgot-password — OTP-based (AUTH-18, deliberately not a link — see the
 * chat writeup). Two steps on one screen: enter your email, then enter the
 * 8-digit code that arrives by email alongside your new password. No
 * CAPTCHA (per project). Step 1 always returns the same message whether or
 * not the email exists (no enumeration); step 2 gives the same generic
 * "invalid or expired" error whether the email, the code, or both were
 * wrong — same principle, applied all the way through.
 */
import { useState, type FormEvent } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { PortalShell, LabeledInput, PrimaryButton, fs, MailIcon, LockIcon } from './PortalShell.js';
import { forgotPassword, resetPassword } from './api.js';
import { ApiRequestError } from '../../lib/api.js';

function errMsg(e: unknown) { return e instanceof ApiRequestError ? e.body.error : 'Something went wrong.'; }

export function ForgotPasswordScreen() {
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmitEmail(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await forgotPassword(email);
    } catch {
      // still advance — the response is deliberately identical either way
    } finally {
      setLoading(false);
      setStep('code');
    }
  }

  async function onSubmitCode(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirmPassword) { setError('New password and confirmation do not match.'); return; }
    setLoading(true);
    try {
      await resetPassword(email, otp, newPassword);
      setDone(true);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <PortalShell title="Reset Password" tint="sage">
      <div style={panel}>
        <div style={panelHead}>Forgot Password</div>
        <div style={panelBody}>
          {done ? (
            <div>
              <div style={okBox}>Password reset. You can now sign in.</div>
              <Link to="/" style={{ ...link, display: 'inline-block', marginTop: 14 }}>Back to Login</Link>
            </div>
          ) : step === 'email' ? (
            <form onSubmit={onSubmitEmail} noValidate style={fs.formCol}>
              <p style={{ color: '#777', fontSize: 14, lineHeight: 1.6, marginTop: 0 }}>
                Provide your registered email address. We'll send you an 8-digit code to reset your password.
                The code expires in 15 minutes and can only be used once.
              </p>
              <LabeledInput label="Email:" icon={<MailIcon />} type="email" placeholder="Email Address"
                value={email} onChange={(e) => setEmail(e.target.value)} required />
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 8 }}>
                <PrimaryButton type="submit" disabled={loading} style={{ width: 'auto', padding: '10px 28px' }}>
                  {loading ? 'Sending…' : 'Submit'}
                </PrimaryButton>
                <Link to="/" style={link}>Back to Login</Link>
              </div>
            </form>
          ) : (
            <form onSubmit={onSubmitCode} noValidate style={fs.formCol}>
              {error && <div style={errBox}>{error}</div>}
              <p style={{ color: '#777', fontSize: 14, lineHeight: 1.6, marginTop: 0 }}>
                Enter the code sent to <strong>{email}</strong>. If it doesn't appear within a few minutes, check your spam folder.
              </p>
              <LabeledInput label="8-digit code:" icon={<LockIcon />} placeholder="XXXXXXXX"
                inputMode="numeric" maxLength={8} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} required />
              <LabeledInput label="New password:" icon={<LockIcon />} type="password" placeholder="At least 8 characters"
                autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required />
              <LabeledInput label="Confirm new password:" icon={<LockIcon />} type="password" placeholder="Repeat new password"
                autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required />
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 8, flexWrap: 'wrap' }}>
                <PrimaryButton type="submit" disabled={loading} style={{ width: 'auto', padding: '10px 28px' }}>
                  {loading ? 'Resetting…' : 'Verify & Reset'}
                </PrimaryButton>
                <button type="button" style={linkBtn} onClick={() => setStep('email')}>Use a different email / resend code</button>
              </div>
            </form>
          )}
        </div>
      </div>
    </PortalShell>
  );
}

// Anyone who still has an old, bookmarked link-based reset URL from before
// this change lands here instead of an error — the OTP flow above is the
// only path forward now.
export function ResetPasswordScreen() {
  return <Navigate to="/forgot-password" replace />;
}

const panel: React.CSSProperties = { maxWidth: 640, margin: '0 auto', background: '#fff', border: '1px solid #ddd', borderRadius: 4, boxShadow: '0 1px 2px rgba(0,0,0,0.05)' };
const panelHead: React.CSSProperties = { padding: '14px 20px', borderBottom: '1px solid #e5e5e5', font: '600 16px var(--font-body)', color: '#333', background: 'linear-gradient(#fff,#f7f7f7)' };
const panelBody: React.CSSProperties = { padding: 24 };
const link: React.CSSProperties = { color: '#0a6ebd', textDecoration: 'none', fontSize: 14 };
const linkBtn: React.CSSProperties = { background: 'none', border: 'none', color: '#0a6ebd', fontSize: 13.5, cursor: 'pointer', padding: 0 };
const okBox: React.CSSProperties = { background: '#eaf6ee', color: '#1e6b3a', border: '1px solid #c2e6cd', borderRadius: 4, padding: '12px 14px', fontSize: 14.5 };
const errBox: React.CSSProperties = { background: '#fdecec', color: '#8f2323', border: '1px solid #f3caca', borderRadius: 4, padding: '10px 12px', marginBottom: 14, fontSize: 14 };
