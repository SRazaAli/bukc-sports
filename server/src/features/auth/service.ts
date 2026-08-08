/**
 * Auth service — business logic for Feature 1.
 *
 * Rule coverage (AUTH-01…22). The DB is the final gate on identity invariants
 * (AUTH-04/05/06/13 are enforced by triggers/constraints too); this layer adds
 * the flows, hashing, tokens, and lockout the DB can't express.
 */
import bcrypt from 'bcryptjs';
import { sql } from 'kysely';
import { db, isPgError, type UserRole } from '../../db/index.js';
import { config } from '../../config/index.js';
import { generateToken, hashToken, generateOtp, hashOtp } from '../../lib/tokens.js';
import { sendEmail } from '../../lib/email.js';
import { notify } from '../notifications/service.js';
import { signAccessToken } from '../../middleware/auth.js';
import { AppError, badRequest, unauthorized, conflict, notFound, forbidden } from '../../middleware/errors.js';

const LOCKOUT_THRESHOLD = 5; // AUTH-11
const LOCKOUT_COOLDOWN_MIN = 15;

export interface PublicUser {
  userId: string;
  role: UserRole;
  fullName: string;
  email: string;
}

function toPublic(row: {
  user_id: string;
  role: UserRole;
  full_name: string;
  email: string;
}): PublicUser {
  return { userId: row.user_id, role: row.role, fullName: row.full_name, email: row.email };
}

// ── Registration (AUTH-01/02/03/19) ──

export async function registerStudent(input: {
  fullName: string; email: string; contactNumber: string;
  password: string; enrollmentNo: string; department: string; programTitle: string;
}): Promise<PublicUser> {
  const hash = await bcrypt.hash(input.password, config.BCRYPT_ROUNDS); // AUTH-08
  try {
    return await db.transaction().execute(async (trx) => {
      // AUTH-03: created in PENDING_VERIFICATION (the column default)
      const user = await trx
        .insertInto('app_user')
        .values({
          role: 'STUDENT',
          full_name: input.fullName,
          email: input.email,
          contact_number: input.contactNumber,
          password_hash: hash,
        })
        .returning(['user_id', 'role', 'full_name', 'email'])
        .executeTakeFirstOrThrow();

      // AUTH-01: enrollment format enforced by DB CHECK; AUTH-05 subtype by trigger
      await trx
        .insertInto('student_profile')
        .values({
          user_id: user.user_id,
          enrollment_no: input.enrollmentNo,
          department: input.department,
          program_title: input.programTitle,
        })
        .execute();

      return toPublic(user);
    });
  } catch (e) {
    throw mapAuthDbError(e, input.email, input.enrollmentNo);
  }
}

export async function registerExternal(input: {
  fullName: string; email: string; contactNumber: string; password: string;
  institutionName: string; designation: string;
}): Promise<PublicUser> {
  const hash = await bcrypt.hash(input.password, config.BCRYPT_ROUNDS);
  try {
    return await db.transaction().execute(async (trx) => {
      const user = await trx
        .insertInto('app_user')
        .values({
          role: 'EXTERNAL',
          full_name: input.fullName,
          email: input.email,
          contact_number: input.contactNumber,
          password_hash: hash,
        })
        .returning(['user_id', 'role', 'full_name', 'email'])
        .executeTakeFirstOrThrow();

      await trx
        .insertInto('external_profile')
        .values({
          user_id: user.user_id,
          institution_name: input.institutionName,
          designation: input.designation,
        })
        .execute();

      return toPublic(user);
    });
  } catch (e) {
    throw mapAuthDbError(e, input.email);
  }
}

// ── Login (AUTH-08/09/11/14) ──

export interface LoginResult {
  user: PublicUser;
  accessToken: string;
  refreshToken: string; // raw — caller sets it as an HTTP-only cookie
}

/**
 * Student login uses the enrollment number as the identifier (AUTH-01), not
 * email. We resolve enrollment -> the account's email, then run the normal login
 * path so all the lockout / attempt-logging / status checks apply identically.
 * A missing enrollment yields the same generic error as a wrong password, so the
 * form never reveals whether an enrollment exists.
 */
export async function loginByEnrollment(enrollmentNo: string, password: string, ip?: string): Promise<LoginResult> {
  const row = await db
    .selectFrom('student_profile')
    .innerJoin('app_user', 'app_user.user_id', 'student_profile.user_id')
    .select(['app_user.email', 'app_user.deleted_at'])
    .where('student_profile.enrollment_no', '=', enrollmentNo)
    .executeTakeFirst();

  // A deleted account behaves exactly like one that never existed — same
  // message, same path, no distinguishing signal either way.
  if (!row || row.deleted_at) {
    await db.insertInto('login_attempt')
      .values({ email_attempted: enrollmentNo, user_id: null, succeeded: false, ip_address: ip ?? null })
      .execute();
    throw unauthorized('Invalid enrollment or password');
  }
  return login(row.email, password, ip);
}

export async function login(email: string, password: string, ip?: string): Promise<LoginResult> {
  const user = await db
    .selectFrom('app_user')
    .select(['user_id', 'role', 'full_name', 'email', 'password_hash', 'status', 'failed_login_count', 'locked_until', 'deleted_at'])
    .where('email', '=', email)
    .executeTakeFirst();

  // Record the attempt regardless of outcome (AUTH-11 forensic trail)
  const recordAttempt = (succeeded: boolean) =>
    db.insertInto('login_attempt')
      .values({ email_attempted: email, user_id: user?.user_id ?? null, succeeded, ip_address: ip ?? null })
      .execute();

  // A deleted account is treated exactly like one that never existed —
  // same message, checked before the password comparison, no signal leaked.
  if (!user || user.deleted_at) {
    await recordAttempt(false);
    throw unauthorized('Invalid email or password'); // don't reveal which
  }

  // AUTH-11: locked out?
  let effectiveFailedCount = user.failed_login_count;
  if (user.locked_until) {
    if (new Date(user.locked_until) > new Date()) {
      await recordAttempt(false);
      throw new AppError(423, 'Account temporarily locked. Try again later.', 'LOCKED');
    }
    // The lock has genuinely expired. Without this reset, a single wrong
    // guess on the very next attempt would compute nextCount = 5 + 1 = 6,
    // which is still >= LOCKOUT_THRESHOLD — re-locking for another full
    // window immediately, and again after that, indefinitely, since
    // failed_login_count was otherwise only ever cleared on a SUCCESSFUL
    // login. An expired lock is a fresh start, not a continuation.
    await db.updateTable('app_user').set({ failed_login_count: 0, locked_until: null })
      .where('user_id', '=', user.user_id).execute();
    effectiveFailedCount = 0;
  }

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    await recordAttempt(false);
    const nextCount = effectiveFailedCount + 1;
    // AUTH-11: 5 consecutive failures -> lockout with cooldown
    if (nextCount >= LOCKOUT_THRESHOLD) {
      await db.updateTable('app_user')
        .set({ failed_login_count: nextCount, locked_until: sql`now() + interval '${sql.raw(String(LOCKOUT_COOLDOWN_MIN))} minutes'` })
        .where('user_id', '=', user.user_id).execute();
    } else {
      await db.updateTable('app_user').set({ failed_login_count: nextCount })
        .where('user_id', '=', user.user_id).execute();
    }
    throw unauthorized('Invalid email or password');
  }

  // AUTH-14: deactivated cannot log in; AUTH-03: pending cannot access
  if (user.status === 'DEACTIVATED') {
    await recordAttempt(false);
    throw forbidden('This account has been deactivated.');
  }
  if (user.status === 'PENDING_VERIFICATION') {
    await recordAttempt(false);
    throw forbidden('Your account is awaiting verification by an administrator.');
  }

  // success: reset the counter, clear any lock
  await db.updateTable('app_user')
    .set({ failed_login_count: 0, locked_until: null })
    .where('user_id', '=', user.user_id).execute();
  await recordAttempt(true);

  const accessToken = signAccessToken({ sub: user.user_id, role: user.role });
  const refreshToken = await issueRefreshToken(user.user_id);

  return { user: toPublic(user), accessToken, refreshToken };
}

// ── Refresh tokens (AUTH-09/10) ──

async function issueRefreshToken(userId: string): Promise<string> {
  const raw = generateToken();
  const expiresAt = new Date(Date.now() + config.REFRESH_TOKEN_TTL_DAYS * 86_400_000);
  await db.insertInto('refresh_token')
    .values({ user_id: userId, token_hash: hashToken(raw), expires_at: expiresAt })
    .execute();
  return raw;
}

/** AUTH-09: rotate — validate the presented refresh token, revoke it, issue a new pair. */
export async function refresh(rawToken: string): Promise<LoginResult> {
  const tokenHash = hashToken(rawToken);
  const row = await db
    .selectFrom('refresh_token')
    .innerJoin('app_user', 'app_user.user_id', 'refresh_token.user_id')
    .select([
      'refresh_token.token_id', 'refresh_token.expires_at', 'refresh_token.revoked_at',
      'app_user.user_id', 'app_user.role', 'app_user.full_name', 'app_user.email', 'app_user.status',
    ])
    .where('refresh_token.token_hash', '=', tokenHash)
    .executeTakeFirst();

  if (!row || row.revoked_at || new Date(row.expires_at) < new Date()) {
    throw unauthorized('Session expired');
  }
  if (row.status !== 'ACTIVE') {
    throw forbidden('Account is not active.');
  }

  // rotate: revoke the used token, issue a fresh one
  await db.updateTable('refresh_token').set({ revoked_at: new Date() })
    .where('token_id', '=', row.token_id).execute();

  const accessToken = signAccessToken({ sub: row.user_id, role: row.role });
  const refreshToken = await issueRefreshToken(row.user_id);
  return { user: toPublic(row), accessToken, refreshToken };
}

/** AUTH-10: logout invalidates the refresh token immediately. */
export async function logout(rawToken: string | undefined): Promise<void> {
  if (!rawToken) return;
  await db.updateTable('refresh_token').set({ revoked_at: new Date() })
    .where('token_hash', '=', hashToken(rawToken))
    .where('revoked_at', 'is', null)
    .execute();
}

// ── Password change & reset (AUTH-17/18/21) ──

const RESET_RATE_LIMIT_WINDOW_MIN = 15;
const RESET_RATE_LIMIT_PER_EMAIL = 3; // per 15-minute window
const RESET_RATE_LIMIT_PER_IP = 10; // per 15-minute window, across any emails
const OTP_MAX_ATTEMPTS = 5; // wrong-guess limit on a single issued code

// Kysely's typed builder chokes on `>=` comparisons against this table's
// Generated<Timestamp> column (a pre-existing quirk — the same thing fails
// identically on the older login_attempt table, which nobody had tried an
// inequality comparison on before this). A fully-raw parameterized query
// sidesteps it cleanly; still no string concatenation, still fully bound.
async function countRecentAttempts(field: 'email_attempted' | 'ip_address', value: string, sinceMinutes: number): Promise<number> {
  const rows = await sql<{ n: string }>`
    SELECT count(*) as n FROM password_reset_attempt
    WHERE ${sql.raw(field)} = ${value} AND attempted_at >= now() - make_interval(mins => ${sinceMinutes})
  `.execute(db);
  return Number(rows.rows[0]?.n ?? 0);
}

// Issues an OTP for the given purpose, invalidating any earlier still-live
// code of the SAME purpose for that user first (AUTH-21: "only the latest
// code works"). Shared by both the forgot-password and change-password-
// confirmation flows — same security shape, different context.
async function issueOtp(userId: string, purpose: 'RESET' | 'CHANGE_CONFIRM'): Promise<string> {
  await db.updateTable('password_reset_token')
    .set({ used_at: sql<Date>`now()` })
    .where('user_id', '=', userId).where('purpose', '=', purpose).where('used_at', 'is', null)
    .execute();

  const otp = generateOtp();
  // AUTH-21: 15 minutes, single-use. expires_at is derived from the DB's own
  // now() in the same row (the table's CHECK requires it) so app/DB clock
  // skew can't matter.
  await db.insertInto('password_reset_token')
    .values({
      user_id: userId,
      token_hash: hashOtp(otp),
      purpose,
      expires_at: sql<Date>`now() + interval '15 minutes'`,
    })
    .execute();
  return otp;
}

// Verifies an OTP for the given purpose against the newest issued code for
// that user, with a wrong-guess limit independent of the request-issuing
// rate limit — an 8-digit code has far less entropy than the old 256-bit
// token, so guessing needs its own ceiling per issued code, not just a cap
// on how many codes get sent. A burned/exceeded code requires a fresh
// request; that's intentional, not a bug.
async function verifyOtp(userId: string, purpose: 'RESET' | 'CHANGE_CONFIRM', otp: string): Promise<void> {
  const tok = await db.selectFrom('password_reset_token')
    .select(['token_id', 'token_hash', 'expires_at', 'used_at', 'failed_attempts'])
    .where('user_id', '=', userId).where('purpose', '=', purpose)
    .where('used_at', 'is', null)
    .orderBy('issued_at', 'desc')
    .executeTakeFirst();

  if (!tok || new Date(tok.expires_at) < new Date() || tok.failed_attempts >= OTP_MAX_ATTEMPTS) {
    throw badRequest('This code is invalid or has expired. Request a new one.');
  }
  if (tok.token_hash !== hashOtp(otp)) {
    await db.updateTable('password_reset_token').set({ failed_attempts: tok.failed_attempts + 1 })
      .where('token_id', '=', tok.token_id).execute();
    throw badRequest('This code is invalid or has expired. Request a new one.');
  }
  await db.updateTable('password_reset_token').set({ used_at: sql<Date>`now()` })
    .where('token_id', '=', tok.token_id).execute();
}

async function alertPasswordChanged(email: string, fullName: string): Promise<void> {
  await sendEmail({
    to: email,
    subject: 'Your BUKC Sports password was changed',
    html: `<p>Hello ${fullName}, your password was just changed. If this wasn't you, contact the sports office immediately.</p>`,
    text: `Hello ${fullName}, your password was just changed. If this wasn't you, contact the sports office immediately.`,
  }).catch((e) => console.error('password-changed alert email failed:', e));
}

// ── AUTH-17, step 1: verify current password, then email an OTP to confirm ──
export async function requestChangePasswordOtp(userId: string, currentPassword: string, ip?: string): Promise<{ devOtp?: string }> {
  const user = await db.selectFrom('app_user').select(['password_hash', 'email'])
    .where('user_id', '=', userId).executeTakeFirst();
  if (!user) throw notFound('User not found');

  await db.insertInto('password_reset_attempt')
    .values({ email_attempted: user.email, ip_address: ip ?? null }).execute();
  const count = await countRecentAttempts('email_attempted', user.email, RESET_RATE_LIMIT_WINDOW_MIN);
  if (count > RESET_RATE_LIMIT_PER_EMAIL) {
    throw conflict('Too many password attempts on this account. Try again in a few minutes.', 'RATE_LIMITED');
  }

  const ok = await bcrypt.compare(currentPassword, user.password_hash);
  if (!ok) throw badRequest('Current password is incorrect');

  const otp = await issueOtp(userId, 'CHANGE_CONFIRM');
  await sendEmail({
    to: user.email,
    subject: 'Confirm your BUKC Sports password change',
    html: `<p>Here is your confirmation code:</p><p style="font-size:24px;font-weight:700;letter-spacing:2px;">${otp}</p><p>This code expires in 15 minutes and can only be used once. If you didn't request this, you can ignore it — your password won't change without it.</p>`,
    text: `Your confirmation code: ${otp} (expires in 15 minutes, single use)`,
  }).catch((e) => console.error('change-otp email failed:', e));

  // Same dev-mode convenience as inviteCoordinator's devToken — never exposed
  // in production, since EMAIL_PROVIDER=console can't be inspected by a test/
  // dev client the way a real inbox can.
  return config.NODE_ENV === 'production' ? {} : { devOtp: otp };
}

// ── AUTH-17, step 2: confirm with the emailed OTP, actually change it ──
export async function confirmChangePassword(userId: string, otp: string, newPassword: string): Promise<void> {
  await verifyOtp(userId, 'CHANGE_CONFIRM', otp);

  const user = await db.selectFrom('app_user').select(['email', 'full_name'])
    .where('user_id', '=', userId).executeTakeFirstOrThrow();
  const hash = await bcrypt.hash(newPassword, config.BCRYPT_ROUNDS);
  await db.updateTable('app_user').set({ password_hash: hash }).where('user_id', '=', userId).execute();

  // AUTH-10 spirit: invalidate existing sessions on password change
  await db.updateTable('refresh_token').set({ revoked_at: new Date() })
    .where('user_id', '=', userId).where('revoked_at', 'is', null).execute();

  await alertPasswordChanged(user.email, user.full_name);
}

// ── AUTH-18, step 1: email an OTP (not a link — see migration 018). Always
// returns success; never reveals whether the email exists. ──
export async function requestPasswordReset(email: string, ip?: string): Promise<{ devOtp?: string }> {
  // Log the attempt unconditionally — this is pure rate-limit bookkeeping,
  // never exposed to the caller, so it can't leak whether the email exists.
  await db.insertInto('password_reset_attempt')
    .values({ email_attempted: email, ip_address: ip ?? null }).execute();

  const emailCount = await countRecentAttempts('email_attempted', email, RESET_RATE_LIMIT_WINDOW_MIN);
  if (emailCount > RESET_RATE_LIMIT_PER_EMAIL) return {}; // rate-limited — same silent return as "no such account"

  if (ip) {
    const ipCount = await countRecentAttempts('ip_address', ip, RESET_RATE_LIMIT_WINDOW_MIN);
    if (ipCount > RESET_RATE_LIMIT_PER_IP) return {};
  }

  const user = await db.selectFrom('app_user').select(['user_id']).where('email', '=', email).executeTakeFirst();
  if (!user) return {}; // silent — no account enumeration

  const otp = await issueOtp(user.user_id, 'RESET');
  await sendEmail({
    to: email,
    subject: 'Your BUKC Sports password reset code',
    html: `<p>Here is your password reset code:</p><p style="font-size:24px;font-weight:700;letter-spacing:2px;">${otp}</p><p>This code expires in 15 minutes and can only be used once. If you didn't request this, you can ignore it.</p>`,
    text: `Your password reset code: ${otp} (expires in 15 minutes, single use)`,
  }).catch((e) => console.error('reset-otp email failed:', e)); // NOTIF-03 best-effort

  return config.NODE_ENV === 'production' ? {} : { devOtp: otp };
}

// ── AUTH-18, step 2: consume the OTP, set the new password ──
export async function resetPassword(email: string, otp: string, newPassword: string): Promise<void> {
  const user = await db.selectFrom('app_user').select(['user_id', 'full_name']).where('email', '=', email).executeTakeFirst();
  // Same generic error whether the email is unknown or the code is wrong —
  // no enumeration signal from this endpoint either.
  if (!user) throw badRequest('This code is invalid or has expired. Request a new one.');

  await verifyOtp(user.user_id, 'RESET', otp);

  const hash = await bcrypt.hash(newPassword, config.BCRYPT_ROUNDS);
  await db.updateTable('app_user').set({ password_hash: hash }).where('user_id', '=', user.user_id).execute();
  // invalidate ALL sessions on a completed reset
  await db.updateTable('refresh_token').set({ revoked_at: new Date() })
    .where('user_id', '=', user.user_id).where('revoked_at', 'is', null).execute();

  await alertPasswordChanged(email, user.full_name);
}

// ── Super Admin: verify accounts (AUTH-04/20) ──

export interface PendingAccountDetail {
  userId: string;
  role: UserRole;
  fullName: string;
  email: string;
  contactNumber: string;
  createdAt: string;
  // student
  enrollmentNo?: string;
  department?: string;
  programTitle?: string;
  // external
  institutionName?: string;
  designation?: string;
}

export async function listPendingAccounts(): Promise<PendingAccountDetail[]> {
  const rows = await db.selectFrom('app_user')
    .leftJoin('student_profile', 'student_profile.user_id', 'app_user.user_id')
    .leftJoin('external_profile', 'external_profile.user_id', 'app_user.user_id')
    .select([
      'app_user.user_id', 'app_user.role', 'app_user.full_name', 'app_user.email',
      'app_user.contact_number', 'app_user.created_at',
      'student_profile.enrollment_no', 'student_profile.department', 'student_profile.program_title',
      'external_profile.institution_name', 'external_profile.designation',
    ])
    .where('app_user.status', '=', 'PENDING_VERIFICATION')
    // AUTH-06: coordinators activate via invite acceptance, not the verify queue
    .where('app_user.role', 'in', ['STUDENT', 'EXTERNAL'])
    .orderBy('app_user.created_at', 'asc')
    .execute();

  return rows.map((r) => ({
    userId: r.user_id,
    role: r.role,
    fullName: r.full_name,
    email: r.email,
    contactNumber: r.contact_number,
    createdAt: new Date(r.created_at as unknown as string).toISOString(),
    enrollmentNo: r.enrollment_no ?? undefined,
    department: r.department ?? undefined,
    programTitle: r.program_title ?? undefined,
    institutionName: r.institution_name ?? undefined,
    designation: r.designation ?? undefined,
  }));
}

// ── Coordinator invite audit log (for the record — every invite ever sent) ──
export interface CoordinatorInviteRecord {
  inviteId: string;
  fullName: string;
  email: string;
  invitedByName: string;
  issuedAt: string;
  expiresAt: string;
  acceptedAt: string | null;
  status: 'PENDING' | 'ACCEPTED' | 'EXPIRED';
}

export async function listCoordinatorInvites(): Promise<CoordinatorInviteRecord[]> {
  const rows = await db.selectFrom('coordinator_invite as ci')
    .innerJoin('app_user as invitee', 'invitee.user_id', 'ci.user_id')
    .innerJoin('app_user as inviter', 'inviter.user_id', 'ci.invited_by')
    .select([
      'ci.invite_id', 'invitee.full_name', 'invitee.email', 'inviter.full_name as invited_by_name',
      'ci.issued_at', 'ci.expires_at', 'ci.accepted_at',
    ])
    .orderBy('ci.issued_at', 'desc')
    .execute();

  const now = Date.now();
  return rows.map((r) => {
    const expiresAt = new Date(r.expires_at as unknown as string);
    const status: CoordinatorInviteRecord['status'] = r.accepted_at
      ? 'ACCEPTED'
      : expiresAt.getTime() < now ? 'EXPIRED' : 'PENDING';
    return {
      inviteId: r.invite_id,
      fullName: r.full_name,
      email: r.email,
      invitedByName: r.invited_by_name,
      issuedAt: new Date(r.issued_at as unknown as string).toISOString(),
      expiresAt: expiresAt.toISOString(),
      acceptedAt: r.accepted_at ? new Date(r.accepted_at as unknown as string).toISOString() : null,
      status,
    };
  });
}

// Hard delete — nothing else in the schema references coordinator_invite
// (unlike app_user, which is why THAT needs the soft-delete dance instead).
// Deleting the invite record here doesn't touch the invited user's account
// at all, whether they accepted, are still pending, or the invite expired
// unused — this is purely trimming the audit log itself.
export async function deleteCoordinatorInvite(inviteId: string): Promise<void> {
  const res = await db.deleteFrom('coordinator_invite')
    .where('invite_id', '=', inviteId).executeTakeFirst();
  if (!res.numDeletedRows) throw notFound('Invite not found.');
}

// ── Active Accounts tab: list + search across all three self/invited roles ──

export interface ManagedAccount {
  userId: string;
  role: UserRole;
  status: 'ACTIVE' | 'DEACTIVATED';
  fullName: string;
  email: string;
  contactNumber: string;
  createdAt: string;
  deactivatedAt?: string;
  deactivatedUntil?: string; // absent = indefinite, present = auto-reactivates then
  lockedUntil?: string; // AUTH-11: present + still in the future = temporarily locked out from repeated failed logins
  enrollmentNo?: string;
  department?: string;
  programTitle?: string;
  institutionName?: string;
  designation?: string;
}

function mapManagedAccountRow(r: {
  user_id: string; role: UserRole; status: string; full_name: string; email: string;
  contact_number: string; created_at: unknown; deactivated_at: unknown; deactivated_until: unknown;
  locked_until?: unknown;
  enrollment_no: string | null; department: string | null; program_title: string | null;
  institution_name: string | null; designation: string | null;
}): ManagedAccount {
  const lockedUntilDate = r.locked_until ? new Date(r.locked_until as string) : null;
  return {
    userId: r.user_id, role: r.role, status: r.status as 'ACTIVE' | 'DEACTIVATED',
    fullName: r.full_name, email: r.email, contactNumber: r.contact_number,
    createdAt: new Date(r.created_at as string).toISOString(),
    deactivatedAt: r.deactivated_at ? new Date(r.deactivated_at as string).toISOString() : undefined,
    deactivatedUntil: r.deactivated_until ? new Date(r.deactivated_until as string).toISOString() : undefined,
    // Only surface it while it's still actually in effect — an expired
    // lock is stale data (cleared lazily on the account's next login
    // attempt, not proactively), so treat it the same as "not locked"
    // here rather than showing a misleading permanent-looking timestamp.
    lockedUntil: lockedUntilDate && lockedUntilDate.getTime() > Date.now() ? lockedUntilDate.toISOString() : undefined,
    enrollmentNo: r.enrollment_no ?? undefined,
    department: r.department ?? undefined,
    programTitle: r.program_title ?? undefined,
    institutionName: r.institution_name ?? undefined,
    designation: r.designation ?? undefined,
  };
}

// Default (no search term) view for the Active Accounts tab: every account
// that was genuinely activated at some point (verified_at IS NOT NULL) and
// isn't deleted, optionally filtered by role. This deliberately excludes
// rejected applications — rejectAccount() reuses the DEACTIVATED status
// (with a rejection_reason) for a PENDING account that was never actually
// verified, so verified_at is the correct signal to distinguish "was once a
// real active account, now deactivated" from "never got past review".
export async function listActiveAccounts(role?: UserRole): Promise<ManagedAccount[]> {
  await checkExpiredDeactivations();

  let q = db.selectFrom('app_user as u')
    .leftJoin('student_profile as sp', 'sp.user_id', 'u.user_id')
    .leftJoin('external_profile as ep', 'ep.user_id', 'u.user_id')
    .select([
      'u.user_id', 'u.role', 'u.status', 'u.full_name', 'u.email', 'u.contact_number',
      'u.created_at', 'u.deactivated_at', 'u.deactivated_until', 'u.locked_until',
      'sp.enrollment_no', 'sp.department', 'sp.program_title',
      'ep.institution_name', 'ep.designation',
    ])
    .where('u.deleted_at', 'is', null)
    .where('u.verified_at', 'is not', null)
    .where('u.status', 'in', ['ACTIVE', 'DEACTIVATED']);
  if (role) q = q.where('u.role', '=', role);

  const rows = await q.orderBy('u.full_name').execute();
  return rows.map(mapManagedAccountRow);
}

// Any authenticated user's own full profile — the Profile screen's details
// section. Unlike listActiveAccounts, this has no verified_at/status gate:
// a user can always see their own data regardless of state (there's no
// "hide yourself from yourself" case that makes sense).
export async function getMyProfile(userId: string): Promise<ManagedAccount> {
  const row = await db.selectFrom('app_user as u')
    .leftJoin('student_profile as sp', 'sp.user_id', 'u.user_id')
    .leftJoin('external_profile as ep', 'ep.user_id', 'u.user_id')
    .select([
      'u.user_id', 'u.role', 'u.status', 'u.full_name', 'u.email', 'u.contact_number',
      'u.created_at', 'u.deactivated_at', 'u.deactivated_until', 'u.locked_until',
      'sp.enrollment_no', 'sp.department', 'sp.program_title',
      'ep.institution_name', 'ep.designation',
    ])
    .where('u.user_id', '=', userId)
    .executeTakeFirst();
  if (!row) throw notFound('Account not found');
  return mapManagedAccountRow(row);
}
// '%...%' — otherwise a literal % or _ in the search term would itself act
// as a wildcard rather than being matched literally.
function escapeLikeTerm(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

// Cross-role account search (Full Name, Email, Contact Number common to all
// three; Enrollment/Department/Program for students; Institution/Designation
// for externals). Ranked exact(0) -> starts-with(1) -> contains(2), each row
// takes its best rank across every field it matched on. Contact-number
// comparisons strip non-digits from both sides so "0301-2345678" and
// "03012345678" hit the same row regardless of how either was typed/stored.
// All user input reaches SQL only via Kysely's sql`` parameter binding —
// never string-concatenated — so this is immune to injection regardless of
// the LIKE-wildcard escaping above (which is a correctness fix, not a
// security one).
export async function searchAccounts(term: string, role: UserRole | undefined, limit: number): Promise<ManagedAccount[]> {
  const raw = term.trim();
  const escaped = escapeLikeTerm(raw);
  const containsPattern = `%${escaped}%`;
  const prefixPattern = `${escaped}%`;
  const digits = raw.replace(/\D/g, '');
  const digitsContains = digits ? `%${digits}%` : null;
  const digitsPrefix = digits ? `${digits}%` : null;

  const rows = await sql<{
    user_id: string; role: UserRole; status: string; full_name: string; email: string;
    contact_number: string; created_at: string; deactivated_at: string | null; deactivated_until: string | null;
    locked_until: string | null;
    enrollment_no: string | null; department: string | null; program_title: string | null;
    institution_name: string | null; designation: string | null; match_rank: number;
  }>`
    SELECT * FROM (
      SELECT
        u.user_id, u.role, u.status, u.full_name, u.email, u.contact_number,
        u.created_at, u.deactivated_at, u.deactivated_until, u.locked_until,
        sp.enrollment_no, sp.department, sp.program_title,
        NULL::text AS institution_name, NULL::text AS designation,
        LEAST(
          CASE WHEN lower(u.full_name) = lower(${raw}) OR lower(u.email) = lower(${raw})
                 OR sp.enrollment_no = ${raw}
                 OR (${digits} <> '' AND regexp_replace(u.contact_number, '[^0-9]', '', 'g') = ${digits})
               THEN 0 ELSE 99 END,
          CASE WHEN u.email ILIKE ${prefixPattern} OR sp.enrollment_no ILIKE ${prefixPattern}
                 OR (${digitsPrefix}::text IS NOT NULL AND regexp_replace(u.contact_number, '[^0-9]', '', 'g') LIKE ${digitsPrefix})
               THEN 1 ELSE 99 END,
          CASE WHEN u.full_name ILIKE ${containsPattern} OR sp.department ILIKE ${containsPattern}
                 OR sp.program_title ILIKE ${containsPattern} OR u.email ILIKE ${containsPattern}
               THEN 2 ELSE 99 END
        ) AS match_rank
      FROM app_user u
      JOIN student_profile sp ON sp.user_id = u.user_id
      WHERE u.deleted_at IS NULL AND u.verified_at IS NOT NULL AND u.status IN ('ACTIVE','DEACTIVATED')
        AND (
          u.full_name ILIKE ${containsPattern} OR u.email ILIKE ${containsPattern}
          OR sp.enrollment_no ILIKE ${containsPattern}
          OR sp.department ILIKE ${containsPattern} OR sp.program_title ILIKE ${containsPattern}
          OR (${digitsContains}::text IS NOT NULL AND regexp_replace(u.contact_number, '[^0-9]', '', 'g') LIKE ${digitsContains})
        )

      UNION ALL

      SELECT
        u.user_id, u.role, u.status, u.full_name, u.email, u.contact_number,
        u.created_at, u.deactivated_at, u.deactivated_until, u.locked_until,
        NULL::text, NULL::text, NULL::text,
        ep.institution_name, ep.designation,
        LEAST(
          CASE WHEN lower(u.full_name) = lower(${raw}) OR lower(u.email) = lower(${raw})
                 OR (${digits} <> '' AND regexp_replace(u.contact_number, '[^0-9]', '', 'g') = ${digits})
               THEN 0 ELSE 99 END,
          CASE WHEN u.email ILIKE ${prefixPattern}
                 OR (${digitsPrefix}::text IS NOT NULL AND regexp_replace(u.contact_number, '[^0-9]', '', 'g') LIKE ${digitsPrefix})
               THEN 1 ELSE 99 END,
          CASE WHEN u.full_name ILIKE ${containsPattern} OR ep.institution_name ILIKE ${containsPattern}
                 OR ep.designation ILIKE ${containsPattern} OR u.email ILIKE ${containsPattern}
               THEN 2 ELSE 99 END
        ) AS match_rank
      FROM app_user u
      JOIN external_profile ep ON ep.user_id = u.user_id
      WHERE u.deleted_at IS NULL AND u.verified_at IS NOT NULL AND u.status IN ('ACTIVE','DEACTIVATED')
        AND (
          u.full_name ILIKE ${containsPattern} OR u.email ILIKE ${containsPattern}
          OR ep.institution_name ILIKE ${containsPattern} OR ep.designation ILIKE ${containsPattern}
          OR (${digitsContains}::text IS NOT NULL AND regexp_replace(u.contact_number, '[^0-9]', '', 'g') LIKE ${digitsContains})
        )

      UNION ALL

      SELECT
        u.user_id, u.role, u.status, u.full_name, u.email, u.contact_number,
        u.created_at, u.deactivated_at, u.deactivated_until, u.locked_until,
        NULL::text, NULL::text, NULL::text, NULL::text, NULL::text,
        LEAST(
          CASE WHEN lower(u.full_name) = lower(${raw}) OR lower(u.email) = lower(${raw})
                 OR (${digits} <> '' AND regexp_replace(u.contact_number, '[^0-9]', '', 'g') = ${digits})
               THEN 0 ELSE 99 END,
          CASE WHEN u.email ILIKE ${prefixPattern}
                 OR (${digitsPrefix}::text IS NOT NULL AND regexp_replace(u.contact_number, '[^0-9]', '', 'g') LIKE ${digitsPrefix})
               THEN 1 ELSE 99 END,
          CASE WHEN u.full_name ILIKE ${containsPattern} OR u.email ILIKE ${containsPattern}
               THEN 2 ELSE 99 END
        ) AS match_rank
      FROM app_user u
      WHERE u.role = 'COORDINATOR' AND u.deleted_at IS NULL AND u.verified_at IS NOT NULL AND u.status IN ('ACTIVE','DEACTIVATED')
        AND (
          u.full_name ILIKE ${containsPattern} OR u.email ILIKE ${containsPattern}
          OR (${digitsContains}::text IS NOT NULL AND regexp_replace(u.contact_number, '[^0-9]', '', 'g') LIKE ${digitsContains})
        )
    ) combined
    ${role ? sql`WHERE role = ${role}` : sql``}
    ORDER BY match_rank ASC, full_name ASC
    LIMIT ${limit}
  `.execute(db);

  return rows.rows.map(mapManagedAccountRow);
}
export async function verifyAccount(userId: string, superAdminId: string): Promise<void> {
  const target = await db.selectFrom('app_user').select(['status', 'role', 'email', 'full_name'])
    .where('user_id', '=', userId).executeTakeFirst();
  if (!target) throw notFound('Account not found');
  if (target.status !== 'PENDING_VERIFICATION') throw conflict('Account is not pending verification');

  try {
    await db.updateTable('app_user')
      .set({ status: 'ACTIVE', verified_by: superAdminId, verified_at: new Date() })
      .where('user_id', '=', userId).execute();
  } catch (e) {
    throw mapAuthDbError(e);
  }

  // AUTH-20: email + in-system notification, both on verification.
  await sendEmail({
    to: target.email,
    subject: 'Your BUKC Sports account is active',
    html: `<p>Hello ${target.full_name}, your account has been verified. You can now sign in.</p>`,
    text: `Hello ${target.full_name}, your account has been verified. You can now sign in.`,
  }).catch((e) => console.error('verify email failed:', e));

  await notify({
    recipientId: userId, type: 'ACCOUNT_VERIFIED',
    title: 'Your account is active', body: 'Your account has been verified. You can now sign in.',
  }).catch((e) => console.error('verify notification failed:', e));
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  if (minutes < 1440) {
    const h = Math.round(minutes / 60);
    return `${h} hour${h === 1 ? '' : 's'}`;
  }
  const d = Math.round(minutes / 1440);
  return `${d} day${d === 1 ? '' : 's'}`;
}

// Deactivate for a fixed duration (auto-reactivates once it elapses — checked
// opportunistically by checkExpiredDeactivations, same pattern as BORROW-18's
// overdue check) or indefinitely (durationMinutes omitted — "until an admin
// reactivates it"). AUTH-14: sessions are invalidated immediately either way.
export async function deactivateAccount(
  userId: string, actorId: string, durationMinutes?: number,
): Promise<void> {
  const target = await db.selectFrom('app_user')
    .select(['email', 'full_name', 'status']).where('user_id', '=', userId).executeTakeFirst();
  if (!target) throw notFound('Account not found');
  if (target.status === 'PENDING_VERIFICATION') {
    throw conflict('This account is still pending verification — use Reject instead.');
  }

  const until = durationMinutes
    ? sql<Date>`now() + make_interval(mins => ${durationMinutes})`
    : null;

  try {
    await db.updateTable('app_user')
      .set({
        status: 'DEACTIVATED', deactivated_at: new Date(), deactivated_by: actorId,
        deactivated_until: until,
      })
      .where('user_id', '=', userId).execute();
  } catch (e) {
    throw mapAuthDbError(e); // AUTH-13: last super admin protection is a DB trigger
  }

  // invalidate sessions of the deactivated user (AUTH-14)
  await db.updateTable('refresh_token').set({ revoked_at: new Date() })
    .where('user_id', '=', userId).where('revoked_at', 'is', null).execute();

  const untilText = durationMinutes
    ? `for approximately ${formatDuration(durationMinutes)}, after which it will automatically reactivate`
    : 'until an administrator reactivates it';
  await sendEmail({
    to: target.email,
    subject: 'Your BUKC Sports account has been deactivated',
    html: `<p>Hello ${target.full_name}, your account has been deactivated ${untilText}. You will not be able to sign in while it is deactivated.</p>`,
    text: `Hello ${target.full_name}, your account has been deactivated ${untilText}. You will not be able to sign in while it is deactivated.`,
  }).catch((e) => console.error('deactivation email failed:', e));

  await notify({
    recipientId: userId, type: 'ACCOUNT_DEACTIVATED',
    title: 'Your account has been deactivated', body: `Your account was deactivated ${untilText}.`,
  }).catch((e) => console.error('deactivation notification failed:', e));
}

export async function reactivateAccount(userId: string): Promise<void> {
  const target = await db.selectFrom('app_user')
    .select(['email', 'full_name', 'status', 'deleted_at']).where('user_id', '=', userId).executeTakeFirst();
  if (!target) throw notFound('Account not found');
  if (target.deleted_at) throw conflict('This account has been deleted and cannot be reactivated.');
  if (target.status !== 'DEACTIVATED') throw conflict('This account is not currently deactivated.');

  await db.updateTable('app_user')
    .set({ status: 'ACTIVE', deactivated_at: null, deactivated_until: null, deactivated_by: null })
    .where('user_id', '=', userId).execute();

  await sendEmail({
    to: target.email,
    subject: 'Your BUKC Sports account has been reactivated',
    html: `<p>Hello ${target.full_name}, your account has been reactivated. You can now sign in.</p>`,
    text: `Hello ${target.full_name}, your account has been reactivated. You can now sign in.`,
  }).catch((e) => console.error('reactivation email failed:', e));

  await notify({
    recipientId: userId, type: 'ACCOUNT_REACTIVATED',
    title: 'Your account has been reactivated', body: 'Your account has been reactivated. You can now sign in.',
  }).catch((e) => console.error('reactivation notification failed:', e));
}

// Opportunistic auto-reactivation for timed deactivations whose window has
// elapsed — called before the account list loads, same pattern as
// checkOverdueBorrows for BORROW-18. Never touches a deleted account.
export async function checkExpiredDeactivations(): Promise<void> {
  await db.updateTable('app_user')
    .set({ status: 'ACTIVE', deactivated_at: null, deactivated_until: null, deactivated_by: null })
    .where('status', '=', 'DEACTIVATED')
    .where('deactivated_until', 'is not', null)
    .where('deactivated_until', '<=', sql<Date>`now()`)
    .where('deleted_at', 'is', null)
    .execute();
}

// A UI-level "delete" — app_user rows can never be hard-deleted (they're
// referenced by articles entered, borrows, damage flags, approvals...), so
// this permanently deactivates the account, hides it from every admin
// listing, and frees its email for reuse by renaming it. login() and
// loginByEnrollment() both check deleted_at and return the exact same
// "not found" message a truly nonexistent account would — indistinguishable
// either way. enrollment_no is left untouched (it has a strict format CHECK
// and is a real-world persistent identifier, not something to free up for
// reuse the way a login email is).
export async function deleteAccountPermanently(userId: string, actorId: string): Promise<void> {
  const target = await db.selectFrom('app_user')
    .select(['email', 'full_name', 'status']).where('user_id', '=', userId).executeTakeFirst();
  if (!target) throw notFound('Account not found');

  // send to the real address before it gets freed up for reuse below
  await sendEmail({
    to: target.email,
    subject: 'Your BUKC Sports account has been deleted',
    html: `<p>Hello ${target.full_name}, your BUKC Sports account has been permanently deleted by an administrator. If you believe this was a mistake, contact the sports office.</p>`,
    text: `Hello ${target.full_name}, your BUKC Sports account has been permanently deleted by an administrator. If you believe this was a mistake, contact the sports office.`,
  }).catch((e) => console.error('deletion email failed:', e));

  const freedEmail = `deleted+${userId}@bukc-sports.invalid`;
  try {
    await db.updateTable('app_user')
      .set({
        status: 'DEACTIVATED', deactivated_at: new Date(), deactivated_by: actorId, deactivated_until: null,
        deleted_at: new Date(), deleted_by: actorId, email: freedEmail,
      })
      .where('user_id', '=', userId).execute();
  } catch (e) {
    throw mapAuthDbError(e); // AUTH-13: last super admin protection is a DB trigger
  }

  await db.updateTable('refresh_token').set({ revoked_at: new Date() })
    .where('user_id', '=', userId).where('revoked_at', 'is', null).execute();
}

/**
 * Reject a PENDING account. Distinct from deactivating an active one: it stores
 * the reason, moves the account to DEACTIVATED, and emails the applicant so they
 * know why. Used by the admin review screen's Reject action.
 */
export async function rejectAccount(userId: string, reason: string): Promise<void> {
  const target = await db.selectFrom('app_user').select(['status', 'email', 'full_name'])
    .where('user_id', '=', userId).executeTakeFirst();
  if (!target) throw notFound('Account not found');
  if (target.status !== 'PENDING_VERIFICATION') throw conflict('Account is not pending verification');

  try {
    await db.updateTable('app_user')
      .set({ status: 'DEACTIVATED', deactivated_at: new Date(), rejection_reason: reason })
      .where('user_id', '=', userId).execute();
  } catch (e) {
    throw mapAuthDbError(e);
  }

  await sendEmail({
    to: target.email,
    subject: 'Your BUKC Sports account request',
    html: `<p>Hello ${target.full_name}, we were unable to approve your account request at this time.</p><p><strong>Reason:</strong> ${reason}</p><p>You may register again with corrected details.</p>`,
    text: `Hello ${target.full_name}, we were unable to approve your account request.\nReason: ${reason}\nYou may register again with corrected details.`,
  }).catch((e) => console.error('rejection email failed:', e));
}

// ── Super Admin: invite a Coordinator (AUTH-06) ──

export async function inviteCoordinator(input: {
  fullName: string; email: string; contactNumber: string;
}, superAdminId: string, origin: string): Promise<{ userId: string; devToken?: string }> {
  // placeholder hash — the coordinator sets their real password on accept
  const placeholder = await bcrypt.hash(generateToken(), config.BCRYPT_ROUNDS);
  const raw = generateToken();
  const expiresAt = new Date(Date.now() + 7 * 86_400_000); // 7-day invite window

  try {
    const userId = await db.transaction().execute(async (trx) => {
      const user = await trx.insertInto('app_user')
        .values({
          role: 'COORDINATOR',
          full_name: input.fullName,
          email: input.email,
          contact_number: input.contactNumber,
          password_hash: placeholder,
          created_by: superAdminId, // AUTH-06: created by Super Admin (DB CHECK requires this)
        })
        .returning('user_id')
        .executeTakeFirstOrThrow();

      await trx.insertInto('coordinator_invite')
        .values({ user_id: user.user_id, token_hash: hashToken(raw), invited_by: superAdminId, expires_at: expiresAt })
        .execute();

      return user.user_id;
    });

    const link = `${origin}/accept-invite?token=${raw}`;
    await sendEmail({
      to: input.email,
      subject: 'You have been invited as a BUKC Sports coordinator',
      html: `<p>Hello ${input.fullName}, you've been invited to coordinate BUKC Sports. Set your password to activate your account. This link expires in 7 days.</p><p><a href="${link}">Accept invitation</a></p>`,
      text: `Set your password to activate your coordinator account (expires in 7 days): ${link}`,
    }).catch((e) => console.error('invite email failed:', e));

    // In dev/test only, return the raw token so the accept flow is testable
    // without parsing a real email. Never leaked in production.
    return config.NODE_ENV === 'production' ? { userId } : { userId, devToken: raw };
  } catch (e) {
    throw mapAuthDbError(e, input.email);
  }
}

/** AUTH-06: coordinator accepts invite, sets password, account goes ACTIVE. */
export async function acceptInvite(rawToken: string, password: string): Promise<PublicUser> {
  const tokenHash = hashToken(rawToken);
  const hash = await bcrypt.hash(password, config.BCRYPT_ROUNDS);

  return db.transaction().execute(async (trx) => {
    const invite = await trx.selectFrom('coordinator_invite')
      .select(['invite_id', 'user_id', 'expires_at', 'accepted_at', 'invited_by'])
      .where('token_hash', '=', tokenHash)
      .executeTakeFirst();

    if (!invite || invite.accepted_at || new Date(invite.expires_at) < new Date()) {
      throw badRequest('This invitation is invalid or has expired.');
    }

    await trx.updateTable('coordinator_invite').set({ accepted_at: new Date() })
      .where('invite_id', '=', invite.invite_id).execute();

    // accepting the invite both sets the password and verifies the account.
    // AUTH-04 verifier is the inviting Super Admin.
    await trx.updateTable('app_user')
      .set({ password_hash: hash, status: 'ACTIVE', verified_by: invite.invited_by, verified_at: new Date() })
      .where('user_id', '=', invite.user_id).execute();

    const user = await trx.selectFrom('app_user')
      .select(['user_id', 'role', 'full_name', 'email'])
      .where('user_id', '=', invite.user_id).executeTakeFirstOrThrow();
    return toPublic(user);
  });
}

// ── DB error mapping ──

function mapAuthDbError(e: unknown, email?: string, enrollment?: string): AppError {
  if (isPgError(e)) {
    if (e.code === '23505') {
      if (e.constraint?.includes('email')) return conflict('An account with that email already exists.', 'EMAIL_TAKEN');
      if (e.constraint?.includes('enrollment')) return conflict('That enrollment number is already registered.', 'ENROLLMENT_TAKEN');
      return conflict('That value is already in use.');
    }
    if (e.code === '23514' && e.constraint?.includes('enroll')) {
      return badRequest('Enrollment number must look like 84-024000-123.');
    }
    if (e.code === 'P0001') {
      // trigger RAISE — message carries the rule tag (AUTH-04/05/06/13)
      return new AppError(422, e.message.replace(/^ERROR:\s*/i, ''), 'RULE');
    }
  }
  return e instanceof AppError ? e : new AppError(500, 'Unexpected error');
}
