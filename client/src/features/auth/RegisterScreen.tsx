/**
 * Registration screens (student | external) — rebuilt to reuse the exact
 * two-panel shell from LandingScreen: same left-panel image/overlay/brand
 * copy, same card geometry, same dark-navy page background with the two
 * blurred glows. Only the right panel's *content* changes — it now holds
 * the registration form instead of the role picker — but it's built with
 * the same visual language as the landing page's right panel (white
 * background, navy/slate ink, the single #1C398E accent, the same input,
 * label, and button treatments).
 *
 * This is a visual-only rebuild: field state, validation, submit handlers,
 * and API calls are unchanged from the previous implementation.
 */
import { useState, useMemo, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { registerStudent, registerExternal } from './api.js';
import { ApiRequestError } from '../../lib/api.js';
import { DEPARTMENTS, EXTERNAL_UNIVERSITIES } from './reference-data.js';
import {
  validateFullName, validateEmail, validateContactNumber,
  validateInstitution, validateDesignation, validatePassword,
} from './validation.js';

/* ---------- theme (identical values to LandingScreen's palette) ---------- */

const palette = {
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
};

type Role = 'student' | 'external';

const CFG: Record<Role, { title: string; portalLabel: string; loginLink: string; subhead: string; chip: string }> = {
  student: {
    title: 'Student Registration',
    portalLabel: 'Student Portal',
    loginLink: '/login/student',
    subhead: 'Create your student account to book venues and borrow equipment. An administrator verifies every new account.',
    chip: 'For enrolled BUKC students',
  },
  external: {
    title: 'External Registration',
    portalLabel: 'External Portal',
    loginLink: '/login/external',
    subhead: 'Register as an external member to request venues for your events. An administrator verifies every new account.',
    chip: 'For partner institutions',
  },
};

const OTHER = '__other__';

type FieldErrors = Partial<Record<
  'fullName' | 'email' | 'contactNumber' | 'enrollmentNo' | 'department' | 'programTitle'
  | 'institutionName' | 'designation' | 'password', string
>>;

export default function RegisterScreen({ role }: { role: Role }) {
  const cfg = CFG[role];
  const navigate = useNavigate();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  // shared
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [contactNumber, setContactNumber] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  // student
  const [enrollmentNo, setEnrollmentNo] = useState('');
  const [department, setDepartment] = useState('');
  const [programTitle, setProgramTitle] = useState('');
  // external
  const [institutionChoice, setInstitutionChoice] = useState('');
  const [customInstitution, setCustomInstitution] = useState('');
  const [designation, setDesignation] = useState('');

  const programs = useMemo(
    () => DEPARTMENTS.find((d) => d.name === department)?.programs ?? [],
    [department],
  );

  const institutionName = institutionChoice === OTHER ? customInstitution.trim() : institutionChoice;

  function validate(): FieldErrors {
    const errs: FieldErrors = {};
    const nameErr = validateFullName(fullName); if (nameErr) errs.fullName = nameErr;
    const emailErr = validateEmail(email); if (emailErr) errs.email = emailErr;
    const contactErr = validateContactNumber(contactNumber); if (contactErr) errs.contactNumber = contactErr;
    const passErr = validatePassword(password); if (passErr) errs.password = passErr;

    if (role === 'student') {
      if (!enrollmentNo.trim()) errs.enrollmentNo = 'Enrollment number is required.';
      else if (!/^[0-9]{2}-[0-9]{6}-[0-9]{3}$/.test(enrollmentNo)) errs.enrollmentNo = 'Format: 84-024000-123.';
      if (!department) errs.department = 'Select a department.';
      if (!programTitle) errs.programTitle = 'Select a program.';
    } else {
      if (!institutionChoice) errs.institutionName = 'Select an institution.';
      else {
        const instErr = validateInstitution(institutionName);
        if (instErr) errs.institutionName = instErr;
      }
      const desigErr = validateDesignation(designation); if (desigErr) errs.designation = desigErr;
    }
    return errs;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const errs = validate();
    setFieldErrors(errs);
    if (Object.values(errs).some(Boolean)) return;

    setLoading(true);
    try {
      if (role === 'student') {
        await registerStudent({ fullName, email, contactNumber, password, enrollmentNo, department, programTitle });
      } else {
        await registerExternal({ fullName, email, contactNumber, password, institutionName, designation });
      }
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.body.error : 'Could not create the account. Try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={s.page}>
      <RegisterStyles />
      <div style={s.glowA} aria-hidden />
      <div style={s.glowB} aria-hidden />

      <div style={s.card} className="register-card-mq">
        {/* Left — brand / image panel, identical to the landing page */}
        <div style={s.leftPanel} className="register-left-panel">
          <div style={s.leftOverlay} />
          <div style={s.leftContent}>
            <span style={s.leftEyebrow}>Bahria University</span>
            <h1 style={s.leftTitle}>BUKC Sports</h1>
            <p style={s.leftText} className="register-left-text">
              The campus sports management portal — reserve venues, borrow
              equipment, and keep every game, court, and booking running
              smoothly from one place.
            </p>
          </div>
        </div>

        {/* Right — registration form, styled with the landing page's
           right-panel theme (white background, navy/slate ink, one accent) */}
        <div style={s.rightPanel} className="register-right-panel">
          <div style={s.rightTop}>
            <img src="/landing/bu_logo.png" alt="Bahria University" style={s.logo} />
            <div>
              <div style={s.logoWordmark}>Bahria University</div>
              <div style={s.logoTag}>Sports Management Portal</div>
            </div>
          </div>

          <span style={s.portalChip}>{cfg.portalLabel}</span>

          {done ? (
            <>
              <h2 style={s.title}>Account created</h2>
              <div style={s.successBanner}>
                <CheckIcon />
                <div>
                  <strong style={s.successTitle}>Awaiting administrator verification.</strong>
                  <p style={s.successBody}>
                    An administrator reviews new accounts before they can sign in. You&apos;ll
                    receive an email once your account is active.
                  </p>
                </div>
              </div>
              <button type="button" style={s.backLink} onClick={() => navigate('/')}>
                ← Back to home page
              </button>
            </>
          ) : (
            <>
              <h2 style={s.title}>{cfg.title}</h2>
              <p style={s.subhead}>{cfg.subhead}</p>

              <form onSubmit={onSubmit} noValidate>
                {error && <div style={s.errorBanner}>{error}</div>}

                <Field label="Full Name" error={fieldErrors.fullName}>
                  <input
                    style={s.input} value={fullName} onChange={(e) => setFullName(e.target.value)}
                    placeholder="Full name" required maxLength={50}
                  />
                </Field>

                <Field label="Email" error={fieldErrors.email}>
                  <input
                    type="email" style={s.input} value={email} onChange={(e) => setEmail(e.target.value)}
                    placeholder="someone@example.com" required maxLength={254}
                  />
                </Field>

                <Field label="Contact Number" error={fieldErrors.contactNumber} hint="Format: 03XXXXXXXXX or 03XX-XXXXXXX">
                  <input
                    style={s.input} value={contactNumber} onChange={(e) => setContactNumber(e.target.value)}
                    placeholder="Enter contact number" required maxLength={12}
                  />
                </Field>

                {role === 'student' ? (
                  <>
                    <Field label="Enrollment" error={fieldErrors.enrollmentNo} hint="Format: XX-XXXXXX-XXX">
                      <input
                        style={s.input} value={enrollmentNo} onChange={(e) => setEnrollmentNo(e.target.value)}
                        placeholder="e.g. 84-024000-123" required
                      />
                    </Field>
                    <Field label="Department" error={fieldErrors.department}>
                      <select
                        style={s.input} value={department}
                        onChange={(e) => { setDepartment(e.target.value); setProgramTitle(''); }} required
                      >
                        <option value="">Select</option>
                        {DEPARTMENTS.map((d) => <option key={d.name} value={d.name}>{d.name}</option>)}
                      </select>
                    </Field>
                    <Field label="Program Title" error={fieldErrors.programTitle}>
                      <select
                        style={s.input} value={programTitle} onChange={(e) => setProgramTitle(e.target.value)}
                        disabled={!department} required
                      >
                        <option value="">{department ? 'Select' : 'Select a department first'}</option>
                        {programs.map((p) => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </Field>
                  </>
                ) : (
                  <>
                    <Field label="Institution" error={fieldErrors.institutionName}>
                      <select
                        style={s.input} value={institutionChoice}
                        onChange={(e) => { setInstitutionChoice(e.target.value); setCustomInstitution(''); }} required
                      >
                        <option value="">Select</option>
                        {EXTERNAL_UNIVERSITIES.map((u) => <option key={u} value={u}>{u}</option>)}
                        <option value={OTHER}>Other…</option>
                      </select>
                      {institutionChoice === OTHER && (
                        <input
                          style={{ ...s.input, marginTop: 8 }} value={customInstitution}
                          onChange={(e) => setCustomInstitution(e.target.value)}
                          placeholder="Enter institution name" required maxLength={100}
                        />
                      )}
                    </Field>
                    <Field label="Designation" error={fieldErrors.designation}>
                      <input
                        style={s.input} value={designation} onChange={(e) => setDesignation(e.target.value)}
                        placeholder="e.g. Sports Coordinator" required maxLength={50}
                      />
                    </Field>
                  </>
                )}

                <Field label="Password" error={fieldErrors.password} hint="8–64 characters, at least one letter and one number">
                  <div style={s.passwordWrap}>
                    <input
                      type={showPassword ? 'text' : 'password'} style={s.inputWithToggle}
                      value={password} onChange={(e) => setPassword(e.target.value)}
                      placeholder="Create a password" required
                    />
                    <button type="button" onClick={() => setShowPassword((v) => !v)} style={s.showToggle}>
                      {showPassword ? 'Hide' : 'Show'}
                    </button>
                  </div>
                </Field>

                <button type="submit" disabled={loading} style={{ ...s.submitBtn, ...(loading ? s.submitBtnDisabled : {}) }}>
                  {loading ? 'Registering…' : 'Register'}
                  {!loading && <ArrowIcon />}
                </button>

                <p style={s.helperNote}>
                  Already have an account?{' '}
                  <Link to="/" style={s.inlineLink}>Sign in</Link>
                </p>
              </form>
            </>
          )}
        </div>
      </div>

      <footer style={s.footer}>2026 © Bahria University — Sports Management Portal</footer>
    </div>
  );
}

/* ---------- small local primitives ---------- */

function Field({
  label, hint, error, children,
}: { label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <div style={s.formGroup}>
      <label style={s.formLabel}>{label}</label>
      {children}
      {error ? <small style={s.fieldError}>{error}</small> : hint ? <small style={s.fieldHint}>{hint}</small> : null}
    </div>
  );
}

function ArrowIcon() {
  return <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function CheckIcon() {
  return (
    <span style={{ flexShrink: 0, marginTop: 1 }}>
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <circle cx="10" cy="10" r="10" fill={palette.accent} />
        <path d="M6 10.5l2.5 2.5L14 7.5" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

function RegisterStyles() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
      * { font-family: 'Inter', system-ui, sans-serif; box-sizing: border-box; }

      .register-right-panel { scrollbar-width: none; }         /* Firefox */
      .register-right-panel::-webkit-scrollbar { display: none; } /* Chrome/Safari */

      .register-right-panel input::placeholder, .register-right-panel select { color: ${palette.navy900}; }
      .register-right-panel input::placeholder { color: ${palette.slate400}; }
      .register-right-panel input:focus, .register-right-panel select:focus {
        outline: none;
        border-color: ${palette.accent} !important;
        box-shadow: 0 0 0 3px ${palette.accentSoft};
      }

      /* Compact spacing on short viewports (e.g. Nest Hub, 1024x600) */
      @media (max-height: 700px) {
        .register-card-mq { height: min(100%, 560px) !important; }
        .register-right-panel { padding: 18px 32px 16px !important; }
      }

      @media (max-width: 860px) {
        .register-card-mq { grid-template-columns: 1fr !important; max-width: 460px !important; height: auto !important; max-height: calc(100vh - 30px) !important; }
        .register-card-mq .register-left-panel { height: 160px !important; min-height: 0 !important; padding: 16px 24px !important; }
        .register-card-mq .register-left-panel h1 { font-size: 28px !important; margin: 0 0 4px !important; }
        .register-card-mq .register-left-panel .register-left-text { display: none !important; }
        .register-card-mq .register-right-panel { padding: 22px 22px 18px !important; }
      }
    `}</style>
  );
}

/* ---------- styles (mirrors LandingScreen's `s` object) ---------- */

const s = {
  page: {
  height: '100vh',              // was minHeight: '100vh'
  width: '100%', display: 'flex', flexDirection: 'column',
  alignItems: 'center', justifyContent: 'center', position: 'relative',
  overflow: 'hidden',            // add this — kills the page-level scrollbar
  background: `radial-gradient(1100px 700px at 15% 0%, ${palette.navy800}aa 0%, transparent 60%),
               radial-gradient(900px 600px at 100% 100%, ${palette.accent}22 0%, transparent 55%),
               ${palette.navy900}`,
  padding: '20px 20px 10px',     // slightly tighter for short screens
} as const,
  glowA: { position: 'absolute', width: 420, height: 420, borderRadius: '50%', background: `${palette.accent}1a`, top: -160, left: -140, filter: 'blur(30px)', pointerEvents: 'none' } as const,
  glowB: { position: 'absolute', width: 380, height: 380, borderRadius: '50%', background: `${palette.slate600}22`, bottom: -160, right: -120, filter: 'blur(30px)', pointerEvents: 'none' } as const,

  card: {
  position: 'relative', width: '100%', maxWidth: 1100,
  height: 'min(100%, 700px)',     // was minHeight: 100
  borderRadius: 28, overflow: 'hidden', display: 'grid',
  gridTemplateColumns: '1.05fr 1fr',
  boxShadow: `0 40px 80px -30px ${palette.navyDeep}dd, 0 0 0 1px ${palette.slate600}33`,
} as const,

  leftPanel: {
    position: 'relative', backgroundImage: `url('/landing/sports.png')`, backgroundSize: 'cover',
    backgroundPosition: 'center', display: 'flex', alignItems: 'flex-end', padding: '40px',
    overflow: 'hidden',
  } as const,
  leftOverlay: {
    position: 'absolute', inset: 0,
    background: `linear-gradient(180deg, transparent 45%, ${palette.navyDeep}f0 100%)`,
  } as const,
  leftContent: { position: 'relative', zIndex: 1 } as const,
  leftEyebrow: {
    display: 'inline-block', fontSize: 12, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase',
    color: palette.slate100, background: `${palette.navy800}88`, border: `1px solid ${palette.slate400}55`,
    padding: '6px 12px', borderRadius: 999, marginBottom: 16,
  } as const,
  leftTitle: { fontSize: 42, fontWeight: 800, color: palette.white, margin: '0 0 12px', letterSpacing: -0.5 } as const,
  leftText: { fontSize: 14.5, lineHeight: 1.65, color: `${palette.slate100}dd`, margin: 0, maxWidth: 380 } as const,

  rightPanel: {
  position: 'relative', background: palette.white,
  padding: '28px 36px 24px', display: 'flex', flexDirection: 'column',
  overflowY: 'auto',             // scrolls internally if content is tall
  minHeight: 0,                  // required so overflow works inside a grid item
} as const,

  rightTop: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 } as const,
  logo: { width: 42, height: 42, borderRadius: 10, objectFit: 'contain', background: palette.slate50, padding: 4, border: `1px solid ${palette.slate300}` } as const,
  logoWordmark: { fontSize: 14.5, fontWeight: 700, color: palette.navy900 } as const,
  logoTag: { fontSize: 11.5, color: palette.slate500, marginTop: 1 } as const,

  portalChip: {
    alignSelf: 'flex-start', fontSize: 12, fontWeight: 700, letterSpacing: 0.2, color: palette.accent,
    background: palette.accentWash, border: `1px solid ${palette.accent}33`, padding: '5px 12px',
    borderRadius: 999, marginBottom: 14,
  } as const,

  title: { fontSize: 23, fontWeight: 700, color: palette.navy900, margin: '0 0 6px' } as const,
  subhead: { fontSize: 13.5, lineHeight: 1.55, color: palette.slate500, margin: '0 0 20px', maxWidth: 440 } as const,

  formGroup: { marginTop: 0, marginBottom: 14 } as const,
  formLabel: { display: 'block', fontSize: 12.5, fontWeight: 600, color: palette.slate600, marginBottom: 6 } as const,
  input: {
    width: '100%', padding: '11px 14px', borderRadius: 10, border: `1.5px solid ${palette.slate300}`,
    background: palette.slate50, color: palette.navy900, fontSize: 13.5,
  } as const,
  passwordWrap: { position: 'relative' } as const,
  inputWithToggle: {
    width: '100%', padding: '11px 56px 11px 14px', borderRadius: 10, border: `1.5px solid ${palette.slate300}`,
    background: palette.slate50, color: palette.navy900, fontSize: 13.5,
  } as const,
  showToggle: {
    position: 'absolute', top: '50%', right: 12, transform: 'translateY(-50%)', background: 'none',
    border: 'none', color: palette.accent, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', padding: 0,
  } as const,
  fieldError: { display: 'block', color: palette.errorText, fontSize: 11.5, marginTop: 5 } as const,
  fieldHint: { display: 'block', color: palette.slate500, fontSize: 11.5, marginTop: 5 } as const,

  errorBanner: {
    background: palette.errorBg, color: palette.errorText, border: `1px solid ${palette.errorBorder}`,
    borderRadius: 10, padding: '11px 14px', fontSize: 13, marginBottom: 16,
  } as const,

  successBanner: {
    display: 'flex', gap: 12, alignItems: 'flex-start', background: palette.accentWash, color: palette.navy900,
    border: `1px solid ${palette.accent}33`, borderRadius: 14, padding: '16px 18px', marginBottom: 18,
  } as const,
  successTitle: { display: 'block', marginBottom: 4, fontSize: 14, color: palette.navy900 } as const,
  successBody: { margin: 0, fontSize: 13, lineHeight: 1.6, color: palette.slate500 } as const,

  submitBtn: {
    width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
    padding: '14px 18px', borderRadius: 14, fontSize: 14.5, fontWeight: 700, border: 'none', cursor: 'pointer',
    background: palette.accent, color: palette.white, marginTop: 4,
  } as const,
  submitBtnDisabled: { opacity: 0.7, cursor: 'not-allowed' } as const,

  helperNote: { marginTop: 14, fontSize: 12.5, color: palette.slate500, textAlign: 'center' } as const,
  inlineLink: { color: palette.accent, fontWeight: 700, textDecoration: 'none' } as const,

  backLink: {
    background: 'none', border: 'none', padding: 0, color: palette.accent, fontWeight: 700,
    fontSize: 13.5, cursor: 'pointer',
  } as const,

  footer: { marginTop: 8, fontSize: 11, color: palette.slate500, textAlign: 'center', position: 'relative' } as const,
};
