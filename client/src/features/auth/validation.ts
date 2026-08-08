/**
 * Registration field validators — client-side mirror of the server's zod
 * schemas (server/src/features/auth/validators.ts). Client-side validation is
 * for immediate feedback only; the server is the actual source of truth and
 * re-validates everything identically.
 */

export const FULL_NAME_RE = /^[a-zA-Z\u00C0-\u017F]+([ '-][a-zA-Z\u00C0-\u017F]+)*$/;
export const EMAIL_RE = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
export const CONTACT_NUMBER_RE = /^03\d{2}-?\d{7}$/;
export const INSTITUTION_RE = /^[a-zA-Z0-9À-ÿ&.,'()-][a-zA-Z0-9À-ÿ&.,'()\- ]{1,99}$/;
export const DESIGNATION_RE = /^[a-zA-Z&.,'-][a-zA-Z&.,'\- ]{1,49}$/;
export const PASSWORD_RE = /^(?=.*[A-Za-z])(?=.*\d).{8,64}$/;

export function validateFullName(v: string): string | null {
  const t = v.trim();
  if (t.length < 2 || t.length > 50) return 'Full name must be 2–50 characters.';
  if (v !== t) return 'No leading or trailing spaces.';
  if (/ {2,}/.test(v)) return 'No consecutive spaces.';
  if (!FULL_NAME_RE.test(v)) return "Letters, spaces, hyphens, and apostrophes only.";
  return null;
}

export function validateEmail(v: string): string | null {
  if (v.length > 254) return 'Email is too long.';
  if (!EMAIL_RE.test(v)) return 'Enter a valid email address.';
  return null;
}

export function validateContactNumber(v: string): string | null {
  if (!CONTACT_NUMBER_RE.test(v)) return 'Enter a valid Pakistani mobile number, e.g. 03001234567.';
  return null;
}

export function validateInstitution(v: string): string | null {
  const t = v.trim();
  if (t.length < 2 || t.length > 100) return 'Institution name must be 2–100 characters.';
  if (!INSTITUTION_RE.test(v)) return 'Enter a valid institution name.';
  return null;
}

export function validateDesignation(v: string): string | null {
  const t = v.trim();
  if (t.length < 2 || t.length > 50) return 'Designation must be 2–50 characters.';
  if (!DESIGNATION_RE.test(v)) return 'Enter a valid designation.';
  return null;
}

export function validatePassword(v: string): string | null {
  if (!PASSWORD_RE.test(v)) return 'Password must be 8–64 characters with at least one letter and one number.';
  return null;
}
