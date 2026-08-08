/**
 * Registration, parameterized by role (student | external). Layout takes after
 * the Admissions "Candidate Registration" card in the screenshots. Student form
 * has cascading Department -> Program Title dropdowns. No CAPTCHA (per project).
 * On success, shows the green "Awaiting administrator verification" banner.
 *
 * External form: Institution is a dropdown of known universities plus an
 * "Other" option that reveals a free-text field. Representative Name was
 * removed — it duplicated Full Name (the person filling the form types their
 * own name into both) with no real distinction in practice.
 */
import { useState, useMemo, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { PortalShell, PrimaryButton, type BarTint } from './PortalShell.js';
import { registerStudent, registerExternal } from './api.js';
import { ApiRequestError } from '../../lib/api.js';
import { DEPARTMENTS, EXTERNAL_UNIVERSITIES } from './reference-data.js';
import {
  validateFullName, validateEmail, validateContactNumber,
  validateInstitution, validateDesignation, validatePassword,
} from './validation.js';

type Role = 'student' | 'external';
const CFG: Record<Role, { title: string; tint: BarTint; loginLink: string }> = {
  student: { title: 'Student Registration', tint: 'sage', loginLink: '/login/student' },
  external: { title: 'External Registration', tint: 'blue', loginLink: '/login/external' },
};

const OTHER = '__other__';

type FieldErrors = Partial<Record<
  'fullName' | 'email' | 'contactNumber' | 'enrollmentNo' | 'department' | 'programTitle'
  | 'institutionName' | 'designation' | 'password', string
>>;

export default function RegisterScreen({ role }: { role: Role }) {
  const cfg = CFG[role];
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  // shared
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [contactNumber, setContactNumber] = useState('');
  const [password, setPassword] = useState('');
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

  if (done) {
    return (
      <PortalShell title={cfg.title} tint={cfg.tint}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <div style={successBanner}>
            <strong>Account created.</strong> Awaiting administrator verification.
          </div>
          <p style={{ color: '#555', marginTop: 16 }}>
            An administrator reviews new accounts before they can sign in. You'll receive an email once your account is active.
          </p>
          <Link to={cfg.loginLink} style={backLink}>Back to sign in</Link>
        </div>
      </PortalShell>
    );
  }

  return (
    <PortalShell title={cfg.title} tint={cfg.tint}>
      <div style={card}>
        <div style={cardHead}>Candidate Registration</div>
        <form onSubmit={onSubmit} noValidate style={{ padding: 24 }}>
          {error && <div style={errorBox}>{error}</div>}

          <Field label="Full Name:" error={fieldErrors.fullName}>
            <input style={inp} value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Full name" required maxLength={50} />
          </Field>
          <Field label="Email:" error={fieldErrors.email}>
            <input style={inp} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="someone@example.com" required maxLength={254} />
          </Field>
          <Field label="Contact Number:" error={fieldErrors.contactNumber} hint="Format: 03XXXXXXXXX or 03XX-XXXXXXX">
            <input style={inp} value={contactNumber} onChange={(e) => setContactNumber(e.target.value)} placeholder="Enter contact number" required maxLength={12} />
          </Field>

          {role === 'student' ? (
            <>
              <Field label="Enrollment:" error={fieldErrors.enrollmentNo} hint="Format: XX-XXXXXX-XXX ">
                <input style={inp} value={enrollmentNo} onChange={(e) => setEnrollmentNo(e.target.value)} placeholder="e.g. 84-024000-123" required />
              </Field>
              <Field label="Department:" error={fieldErrors.department}>
                <select style={inp} value={department} onChange={(e) => { setDepartment(e.target.value); setProgramTitle(''); }} required>
                  <option value="">Select</option>
                  {DEPARTMENTS.map((d) => <option key={d.name} value={d.name}>{d.name}</option>)}
                </select>
              </Field>
              <Field label="Program Title:" error={fieldErrors.programTitle}>
                <select style={inp} value={programTitle} onChange={(e) => setProgramTitle(e.target.value)} disabled={!department} required>
                  <option value="">{department ? 'Select' : 'Select a department first'}</option>
                  {programs.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </Field>
            </>
          ) : (
            <>
              <Field label="Institution:" error={fieldErrors.institutionName}>
                <select style={inp} value={institutionChoice} onChange={(e) => { setInstitutionChoice(e.target.value); setCustomInstitution(''); }} required>
                  <option value="">Select</option>
                  {EXTERNAL_UNIVERSITIES.map((u) => <option key={u} value={u}>{u}</option>)}
                  <option value={OTHER}>Other…</option>
                </select>
                {institutionChoice === OTHER && (
                  <input style={{ ...inp, marginTop: 8 }} value={customInstitution}
                    onChange={(e) => setCustomInstitution(e.target.value)}
                    placeholder="Enter institution name" required maxLength={100} />
                )}
              </Field>
              <Field label="Designation:" error={fieldErrors.designation}>
                <input style={inp} value={designation} onChange={(e) => setDesignation(e.target.value)} placeholder="e.g. Sports Coordinator" required maxLength={50} />
              </Field>
            </>
          )}

          <Field label="Password:" error={fieldErrors.password} hint="8–64 characters, at least one letter and one number">
            <input style={inp} type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Create a password" required />
          </Field>

          <div style={{ marginTop: 8 }}>
            <PrimaryButton type="submit" disabled={loading}>{loading ? 'Registering…' : 'Register'}</PrimaryButton>
          </div>
          <Link to={cfg.loginLink} style={greenBtn}>Already have an account?</Link>
        </form>
      </div>
    </PortalShell>
  );
}

function Field({ label, children, error, hint }: { label: string; children: React.ReactNode; error?: string; hint?: string }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: 'block', fontWeight: 700, fontSize: 14, color: '#333', marginBottom: 6 }}>{label}</label>
      {children}
      {error ? <small style={errHint}>{error}</small> : hint ? <small style={hintStyle}>{hint}</small> : null}
    </div>
  );
}

const card: React.CSSProperties = { maxWidth: 900, margin: '0 auto', border: '1px solid #e0e0e0', borderRadius: 4, background: '#fff' };
const cardHead: React.CSSProperties = { background: 'linear-gradient(#fafafa,#eee)', borderBottom: '1px solid #e0e0e0', padding: '14px 24px', fontSize: 17, color: '#444' };
const inp: React.CSSProperties = { width: '100%', fontSize: 15, padding: '9px 12px', border: '1px solid #ccc', borderRadius: 3, color: '#333', outline: 'none' };
const hintStyle: React.CSSProperties = { display: 'block', color: '#888', fontSize: 12, marginTop: 4 };
const errHint: React.CSSProperties = { display: 'block', color: '#b3352b', fontSize: 12, marginTop: 4 };
const errorBox: React.CSSProperties = { background: '#fdecec', color: '#8f2323', border: '1px solid #f3caca', borderRadius: 4, padding: '10px 12px', marginBottom: 16, fontSize: 14 };
const successBanner: React.CSSProperties = { background: '#dff0d8', color: '#3c763d', border: '1px solid #c3e0ab', borderRadius: 4, padding: '14px 16px', fontSize: 15 };
const greenBtn: React.CSSProperties = { display: 'block', textAlign: 'center', marginTop: 12, background: 'linear-gradient(#28a745,#1f8a3b)', color: '#fff', padding: '11px', borderRadius: 4, textDecoration: 'none', fontWeight: 600 };
const backLink: React.CSSProperties = { display: 'inline-block', marginTop: 16, color: '#0a6ebd', textDecoration: 'none' };
