/**
 * Registration, parameterized by role (student | external). Layout takes after
 * the Admissions "Candidate Registration" card in the screenshots. Student form
 * has cascading Department -> Program Title dropdowns. No CAPTCHA (per project).
 * On success, shows the "Awaiting administrator verification" banner.
 *
 * External form: Institution is a dropdown of known universities plus an
 * "Other" option that reveals a free-text field.
 *
 * Visual redesign only — validation, submission, and API calls are unchanged.
 */
import { useState, useMemo, type FormEvent } from 'react';
import {
  AuthSplit, FieldGroup, AuthInput, AuthSelect, AuthButton, AuthLinkRow, AuthLink,
  ErrorBanner, SuccessBanner, PersonIcon, LockIcon, MailIcon, PhoneIcon, BankIcon, BuildingIcon, BadgeIcon,
  type PortalKey,
} from './AuthUI.js';
import { registerStudent, registerExternal } from './api.js';
import { ApiRequestError } from '../../lib/api.js';
import { DEPARTMENTS, EXTERNAL_UNIVERSITIES } from './reference-data.js';
import {
  validateFullName, validateEmail, validateContactNumber,
  validateInstitution, validateDesignation, validatePassword,
} from './validation.js';

type Role = 'student' | 'external';

const CFG: Record<Role, { title: string; loginLink: string; headline: string; subhead: string; chip: string }> = {
  student: {
    title: 'Student Registration', loginLink: '/login/student',
    headline: 'Join the BUKC sports community.',
    subhead: 'Create your student account to book venues and borrow equipment. An administrator verifies every new account.',
    chip: 'For enrolled BUKC students',
  },
  external: {
    title: 'External Registration', loginLink: '/login/external',
    headline: 'Bring your organization to our courts.',
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
  const portal = role as PortalKey;
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
      <AuthSplit portal={portal} eyebrow={`${role === 'student' ? 'Student' : 'External'} Portal`}
        headline={cfg.headline} subhead={cfg.subhead} chip={cfg.chip} formMaxWidth={440}>
        <SuccessBanner title="Account created.">Awaiting administrator verification.</SuccessBanner>
        <p style={{ color: '#5C7180', marginTop: 16, fontSize: 14, lineHeight: 1.6 }}>
          An administrator reviews new accounts before they can sign in. You&apos;ll receive an email once your account is active.
        </p>
        <div style={{ marginTop: 18 }}>
          <AuthLink to={cfg.loginLink}>← Back to sign in</AuthLink>
        </div>
      </AuthSplit>
    );
  }

  return (
    <AuthSplit
      portal={portal}
      eyebrow={`${role === 'student' ? 'Student' : 'External'} Portal`}
      headline={cfg.headline}
      subhead={cfg.subhead}
      chip={cfg.chip}
      formMaxWidth={440}
    >
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ margin: '2px 0 4px', fontSize: 24, fontWeight: 700, color: '#0B3754' }}>{cfg.title}</h2>
        <p style={{ margin: 0, fontSize: 14, color: '#5C7180' }}>A few details, then an administrator verifies your account.</p>
      </div>

      <form onSubmit={onSubmit} noValidate>
        {error && <div style={{ marginBottom: 16 }}><ErrorBanner>{error}</ErrorBanner></div>}

        <FieldGroup label="Full Name" icon={<PersonIcon />} error={fieldErrors.fullName}>
          <AuthInput value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Full name" required maxLength={50} />
        </FieldGroup>

        <FieldGroup label="Email" icon={<MailIcon />} error={fieldErrors.email}>
          <AuthInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="someone@example.com" required maxLength={254} />
        </FieldGroup>

        <FieldGroup label="Contact Number" icon={<PhoneIcon />} error={fieldErrors.contactNumber} hint="Format: 03XXXXXXXXX or 03XX-XXXXXXX">
          <AuthInput value={contactNumber} onChange={(e) => setContactNumber(e.target.value)} placeholder="Enter contact number" required maxLength={12} />
        </FieldGroup>

        {role === 'student' ? (
          <>
            <FieldGroup label="Enrollment" icon={<BadgeIcon />} error={fieldErrors.enrollmentNo} hint="Format: XX-XXXXXX-XXX">
              <AuthInput value={enrollmentNo} onChange={(e) => setEnrollmentNo(e.target.value)} placeholder="e.g. 84-024000-123" required />
            </FieldGroup>
            <FieldGroup label="Department" icon={<BuildingIcon />} error={fieldErrors.department}>
              <AuthSelect value={department} onChange={(e) => { setDepartment(e.target.value); setProgramTitle(''); }} required>
                <option value="">Select</option>
                {DEPARTMENTS.map((d) => <option key={d.name} value={d.name}>{d.name}</option>)}
              </AuthSelect>
            </FieldGroup>
            <FieldGroup label="Program Title" icon={<BankIcon />} error={fieldErrors.programTitle}>
              <AuthSelect value={programTitle} onChange={(e) => setProgramTitle(e.target.value)} disabled={!department} required>
                <option value="">{department ? 'Select' : 'Select a department first'}</option>
                {programs.map((p) => <option key={p} value={p}>{p}</option>)}
              </AuthSelect>
            </FieldGroup>
          </>
        ) : (
          <>
            <FieldGroup label="Institution" icon={<BuildingIcon />} error={fieldErrors.institutionName}>
              <AuthSelect value={institutionChoice} onChange={(e) => { setInstitutionChoice(e.target.value); setCustomInstitution(''); }} required>
                <option value="">Select</option>
                {EXTERNAL_UNIVERSITIES.map((u) => <option key={u} value={u}>{u}</option>)}
                <option value={OTHER}>Other…</option>
              </AuthSelect>
              {institutionChoice === OTHER && (
                <div style={{ marginTop: 8 }}>
                  <AuthInput
                    hasIcon={false} value={customInstitution}
                    onChange={(e) => setCustomInstitution(e.target.value)}
                    placeholder="Enter institution name" required maxLength={100}
                  />
                </div>
              )}
            </FieldGroup>
            <FieldGroup label="Designation" icon={<BadgeIcon />} error={fieldErrors.designation}>
              <AuthInput value={designation} onChange={(e) => setDesignation(e.target.value)} placeholder="e.g. Sports Coordinator" required maxLength={50} />
            </FieldGroup>
          </>
        )}

        <FieldGroup label="Password" icon={<LockIcon />} error={fieldErrors.password} hint="8–64 characters, at least one letter and one number">
          <AuthInput type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Create a password" required />
        </FieldGroup>

        <div style={{ marginTop: 6 }}>
          <AuthButton type="submit" portal={portal} disabled={loading}>{loading ? 'Registering…' : 'Register'}</AuthButton>
        </div>

        <div style={{ marginTop: 16 }}>
          <AuthLinkRow>
            <AuthLink to={cfg.loginLink}>Already have an account? Sign in</AuthLink>
            <span />
          </AuthLinkRow>
        </div>
      </form>
    </AuthSplit>
  );
}
