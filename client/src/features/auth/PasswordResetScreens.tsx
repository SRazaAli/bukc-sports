/**
 * Forgot-password — OTP-based (AUTH-18, deliberately not a link — see the
 * chat writeup). Two steps on one screen: enter your email, then enter the
 * 8-digit code that arrives by email alongside your new password. No
 * CAPTCHA (per project). Step 1 always returns the same message whether or
 * not the email exists (no enumeration); step 2 gives the same generic
 * "invalid or expired" error whether the email, the code, or both were
 * wrong — same principle, applied all the way through.
 *
 * Visual redesign only — state machine, validation, and API calls
 * (forgotPassword / resetPassword) are unchanged from the original.
 */
import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import {
  AuthGenericSplit, FieldGroup, AuthInput, AuthButtonNeutral, AuthLink,
  ErrorBanner, SuccessBanner, MailIcon, LockIcon,
} from './AuthUI.js';
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

  if (done) {
    return (
      <AuthGenericSplit
        eyebrow="Account Recovery"
        headline="All set — you're back in."
        subhead="Your password has been reset. Use it the next time you sign in to any BUKC Sports portal."
        chip="Recovery complete"
        chipIcon="✅"
      >
        <SuccessBanner title="Password reset.">You can now sign in with your new password.</SuccessBanner>
        <div style={{ marginTop: 18 }}>
          <AuthLink to="/">← Back to sign in</AuthLink>
        </div>
      </AuthGenericSplit>
    );
  }

  if (step === 'email') {
    return (
      <AuthGenericSplit
        eyebrow="Account Recovery"
        headline="Forgot your password?"
        subhead="No problem. Tell us the email on your account and we'll send a one-time code to get you back in."
        chip="8-digit code · expires in 15 min"
      >
        <div style={{ marginBottom: 20 }}>
          <h2 style={{ margin: '2px 0 4px', fontSize: 24, fontWeight: 700, color: '#0B3754' }}>Reset your password</h2>
          <p style={{ margin: 0, fontSize: 14, color: '#5C7180', lineHeight: 1.6 }}>
            Provide your registered email address. We&apos;ll send you an 8-digit code to reset your password.
            The code expires in 15 minutes and can only be used once.
          </p>
        </div>

        <form onSubmit={onSubmitEmail} noValidate>
          <FieldGroup label="Email" icon={<MailIcon />}>
            <AuthInput
              type="email" placeholder="you@example.com" required
              value={email} onChange={(e) => setEmail(e.target.value)}
            />
          </FieldGroup>

          <div style={{ marginTop: 6 }}>
            <AuthButtonNeutral type="submit" disabled={loading}>
              {loading ? 'Sending…' : 'Send reset code'}
            </AuthButtonNeutral>
          </div>

          <div style={{ marginTop: 16, textAlign: 'center' }}>
            <AuthLink to="/" style={{ fontSize: 12.5, color: '#5C7180', fontWeight: 500 }}>← Back to sign in</AuthLink>
          </div>
        </form>
      </AuthGenericSplit>
    );
  }

  return (
    <AuthGenericSplit
      eyebrow="Account Recovery"
      headline="Enter your code."
      subhead="We've emailed an 8-digit code to your address. Enter it below along with your new password."
      chip="Didn't get it? Check spam"
    >
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ margin: '2px 0 4px', fontSize: 24, fontWeight: 700, color: '#0B3754' }}>Verify &amp; reset</h2>
        <p style={{ margin: 0, fontSize: 14, color: '#5C7180', lineHeight: 1.6 }}>
          Enter the code sent to <strong>{email}</strong>. If it doesn&apos;t appear within a few minutes, check your spam folder.
        </p>
      </div>

      <form onSubmit={onSubmitCode} noValidate>
        {error && <div style={{ marginBottom: 16 }}><ErrorBanner>{error}</ErrorBanner></div>}

        <FieldGroup label="8-digit code" icon={<LockIcon />}>
          <AuthInput
            placeholder="XXXXXXXX" inputMode="numeric" maxLength={8} required
            value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
            style={{ letterSpacing: '0.35em', fontWeight: 700 }}
          />
        </FieldGroup>

        <FieldGroup label="New password" icon={<LockIcon />}>
          <AuthInput
            type="password" placeholder="At least 8 characters" autoComplete="new-password" required
            value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
          />
        </FieldGroup>

        <FieldGroup label="Confirm new password" icon={<LockIcon />}>
          <AuthInput
            type="password" placeholder="Repeat new password" autoComplete="new-password" required
            value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
          />
        </FieldGroup>

        <div style={{ marginTop: 6 }}>
          <AuthButtonNeutral type="submit" disabled={loading}>
            {loading ? 'Resetting…' : 'Verify & reset password'}
          </AuthButtonNeutral>
        </div>

        <div style={{ marginTop: 16, textAlign: 'center' }}>
          <button type="button" onClick={() => setStep('email')} style={resendBtn}>
            Use a different email / resend code
          </button>
        </div>
      </form>
    </AuthGenericSplit>
  );
}

// Anyone who still has an old, bookmarked link-based reset URL from before
// this change lands here instead of an error — the OTP flow above is the
// only path forward now.
export function ResetPasswordScreen() {
  return <Navigate to="/forgot-password" replace />;
}

const resendBtn: React.CSSProperties = {
  background: 'none', border: 'none', color: '#0B3754', fontSize: 13, fontWeight: 600, cursor: 'pointer', padding: 0,
};
