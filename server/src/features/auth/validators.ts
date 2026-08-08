/**
 * Request validators. First line of defense — the DB triggers/constraints are
 * the final gate, but validating here gives clean 400s with helpful messages
 * instead of raw constraint errors.
 */
import { z } from 'zod';

// AUTH-01: student enrollment format XX-XXXXXX-XXX
const enrollmentRe = /^[0-9]{2}-[0-9]{6}-[0-9]{3}$/;

// Full name: letters (incl. accented) and spaces, hyphens/apostrophes allowed
// mid-name (e.g. "Abdul-Rahman", "O'Brien"). No leading/trailing/consecutive
// spaces — enforced by .trim() equality plus the regex itself.
const fullNameRe = /^[a-zA-Z\u00C0-\u017F]+([ '-][a-zA-Z\u00C0-\u017F]+)*$/;

// RFC 5322-ish email pattern, same shape browsers use for <input type="email">.
const emailRe = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

// Pakistani mobile: 03 + 2-digit operator code + 7-digit subscriber number,
// with or without the customary hyphen (03XX-XXXXXXX or 03XXXXXXXXX).
const contactNumberRe = /^03\d{2}-?\d{7}$/;

// Institution: letters/numbers/spaces plus punctuation common in org names —
// widened to include parentheses (real names like "IBA" abbreviations use them).
const institutionRe = /^[a-zA-Z0-9À-ÿ&.,'()-][a-zA-Z0-9À-ÿ&.,'()\- ]{1,99}$/;

// Designation: letters/spaces/hyphens/ampersands (e.g. "Head of IT & Operations").
const designationRe = /^[a-zA-Z&.,'-][a-zA-Z&.,'\- ]{1,49}$/;

// 8–64 chars, at least one letter and one digit. Length over composition
// rules per current NIST guidance; this keeps a light floor without pushing
// users toward predictable "Password1!" patterns.
const passwordRe = /^(?=.*[A-Za-z])(?=.*\d).{8,64}$/;

const fullNameSchema = z.string()
  .min(2, 'Name must be at least 2 characters').max(50, 'Name must be at most 50 characters')
  .regex(fullNameRe, 'Letters, spaces, hyphens, and apostrophes only')
  .refine((v) => v === v.trim(), 'No leading or trailing spaces')
  .refine((v) => !/ {2,}/.test(v), 'No consecutive spaces');

const emailSchema = z.string()
  .max(254, 'Email is too long')
  .regex(emailRe, 'Enter a valid email address');

const contactNumberSchema = z.string()
  .regex(contactNumberRe, 'Enter a valid Pakistani mobile number, e.g. 03001234567');

const institutionSchema = z.string()
  .min(2).max(100)
  .regex(institutionRe, 'Enter a valid institution name');

const designationSchema = z.string()
  .min(2).max(50)
  .regex(designationRe, 'Enter a valid designation');

const passwordSchema = z
  .string()
  .regex(passwordRe, 'Password must be 8–64 characters with at least one letter and one number');

export const studentRegisterSchema = z.object({
  fullName: fullNameSchema,
  email: emailSchema,
  contactNumber: contactNumberSchema,
  password: passwordSchema,
  enrollmentNo: z.string().regex(enrollmentRe, 'Enrollment must look like 84-024000-123'),
  department: z.string().min(1).max(120),
  programTitle: z.string().min(1).max(160),
});

// representativeName removed — it duplicated fullName (the account holder is
// the representative; there's no separate "on behalf of" identity here).
export const externalRegisterSchema = z.object({
  fullName: fullNameSchema,
  email: emailSchema,
  contactNumber: contactNumberSchema,
  password: passwordSchema,
  institutionName: institutionSchema,
  designation: designationSchema,
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const studentLoginSchema = z.object({
  enrollmentNo: z.string().min(1),
  password: z.string().min(1),
});

export const rejectAccountSchema = z.object({
  userId: z.string().uuid(),
  reason: z.string().min(3, 'Give a brief reason').max(500),
});

const otpSchema = z.string().regex(/^\d{8}$/, 'Enter the 8-digit code from your email');

export const requestChangeOtpSchema = z.object({
  currentPassword: z.string().min(1),
});
export const confirmChangePasswordSchema = z.object({
  otp: otpSchema,
  newPassword: passwordSchema,
});

export const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

export const resetPasswordSchema = z.object({
  email: z.string().email(),
  otp: otpSchema,
  newPassword: passwordSchema,
});

// AUTH-06: Super Admin invites a Coordinator by email
export const inviteCoordinatorSchema = z.object({
  fullName: fullNameSchema,
  email: emailSchema,
  contactNumber: contactNumberSchema,
});

export const acceptInviteSchema = z.object({
  token: z.string().min(10),
  password: passwordSchema,
});

export const verifyAccountSchema = z.object({
  userId: z.string().uuid(),
});

// Duration is in minutes, admin-facing presets (10 min .. 30 days) collapse
// to a minute count client-side; omitted entirely means indefinite.
export const deactivateAccountSchema = z.object({
  userId: z.string().uuid(),
  durationMinutes: z.number().int().positive().max(43200).optional(), // cap 30 days
});

export const accountSearchSchema = z.object({
  q: z.string().trim().min(2).max(100),
  role: z.enum(['STUDENT', 'EXTERNAL', 'COORDINATOR']).optional(),
  limit: z.number().int().positive().max(100).default(10),
});
