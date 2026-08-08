/**
 * Auth routes. Maps HTTP to the service, handles the refresh-token cookie, and
 * gates admin actions by role (mirroring the DB triggers — defense in depth).
 * Every async handler is wrapped so thrown errors reach the error middleware.
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import * as svc from './service.js';
import * as v from './validators.js';
import type { UserRole } from '../../db/index.js';
import { config, isProd } from '../../config/index.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { asyncHandler } from '../../middleware/async.js';
import { badRequest } from '../../middleware/errors.js';

const REFRESH_COOKIE = 'bukc_refresh';

function setRefreshCookie(res: Response, token: string) {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'none' : 'lax',
    path: '/api/auth',
    maxAge: config.REFRESH_TOKEN_TTL_DAYS * 86_400_000,
  });
}
function clearRefreshCookie(res: Response) {
  res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
}

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success) {
    const first = r.error.errors[0];
    throw badRequest(first ? `${first.path.join('.')}: ${first.message}` : 'Invalid request');
  }
  return r.data;
}

function clientOrigin(req: Request): string {
  return req.headers.origin ?? config.CLIENT_ORIGIN.split(',')[0]!;
}

export const authRouter = Router();

// ── Registration ──
authRouter.post('/register/student', asyncHandler(async (req, res) => {
  const input = parse(v.studentRegisterSchema, req.body);
  const user = await svc.registerStudent(input);
  res.status(201).json({ user, message: 'Account created. Awaiting administrator verification.' });
}));

authRouter.post('/register/external', asyncHandler(async (req, res) => {
  const input = parse(v.externalRegisterSchema, req.body);
  const user = await svc.registerExternal(input);
  res.status(201).json({ user, message: 'Account created. Awaiting administrator verification.' });
}));

// ── Login / refresh / logout ──
authRouter.post('/login', asyncHandler(async (req, res) => {
  const { email, password } = parse(v.loginSchema, req.body);
  const { user, accessToken, refreshToken } = await svc.login(email, password, req.ip);
  setRefreshCookie(res, refreshToken);
  res.json({ user, accessToken });
}));

// Student login uses enrollment (AUTH-01), not email.
authRouter.post('/login/student', asyncHandler(async (req, res) => {
  const { enrollmentNo, password } = parse(v.studentLoginSchema, req.body);
  const { user, accessToken, refreshToken } = await svc.loginByEnrollment(enrollmentNo, password, req.ip);
  setRefreshCookie(res, refreshToken);
  res.json({ user, accessToken });
}));

authRouter.post('/refresh', asyncHandler(async (req, res) => {
  const raw = req.cookies?.[REFRESH_COOKIE] as string | undefined;
  if (!raw) return res.status(401).json({ error: 'No session' });
  const { user, accessToken, refreshToken } = await svc.refresh(raw);
  setRefreshCookie(res, refreshToken);
  res.json({ user, accessToken });
}));

authRouter.post('/logout', asyncHandler(async (req, res) => {
  const raw = req.cookies?.[REFRESH_COOKIE] as string | undefined;
  await svc.logout(raw);
  clearRefreshCookie(res);
  res.status(204).end();
}));

// ── Self-service password (AUTH-17/18/21) — OTP-based, see migration 018 ──
authRouter.post('/change-password/request-otp', requireAuth, asyncHandler(async (req, res) => {
  const { currentPassword } = parse(v.requestChangeOtpSchema, req.body);
  const { devOtp } = await svc.requestChangePasswordOtp(req.user!.userId, currentPassword, req.ip);
  res.json({ devOtp, message: 'A confirmation code has been emailed to you.' });
}));

authRouter.post('/change-password/confirm', requireAuth, asyncHandler(async (req, res) => {
  const { otp, newPassword } = parse(v.confirmChangePasswordSchema, req.body);
  await svc.confirmChangePassword(req.user!.userId, otp, newPassword);
  res.json({ message: 'Password changed. Please sign in again.' });
}));

authRouter.post('/forgot-password', asyncHandler(async (req, res) => {
  const { email } = parse(v.forgotPasswordSchema, req.body);
  const { devOtp } = await svc.requestPasswordReset(email, req.ip);
  res.json({ devOtp, message: 'If that email is registered, a reset code is on its way.' });
}));

authRouter.post('/reset-password', asyncHandler(async (req, res) => {
  const { email, otp, newPassword } = parse(v.resetPasswordSchema, req.body);
  await svc.resetPassword(email, otp, newPassword);
  res.json({ message: 'Password reset. You can now sign in.' });
}));

// ── Current user's own full profile (Profile screen) ──
authRouter.get('/me', requireAuth, asyncHandler(async (req, res) => {
  res.json({ account: await svc.getMyProfile(req.user!.userId) });
}));

// ── Super Admin: verification queue (AUTH-04) ──
authRouter.get('/admin/pending', requireAuth, requireRole('SUPER_ADMIN'), asyncHandler(async (_req, res) => {
  res.json({ accounts: await svc.listPendingAccounts() });
}));

// Audit trail — every coordinator invite ever sent, for the record.
authRouter.get('/admin/coordinator-invites', requireAuth, requireRole('SUPER_ADMIN'), asyncHandler(async (_req, res) => {
  res.json({ invites: await svc.listCoordinatorInvites() });
}));

authRouter.delete('/admin/coordinator-invites/:id', requireAuth, requireRole('SUPER_ADMIN'), asyncHandler(async (req, res) => {
  const id = req.params.id;
  if (!id) throw badRequest('Missing id');
  await svc.deleteCoordinatorInvite(id);
  res.json({ message: 'Invite record deleted.' });
}));

// ── Super Admin: Active Accounts tab — list + search across roles ──
// AUTH-16: Coordinator has read-only access to all user profiles — so these
// two GET routes allow COORDINATOR too, while every mutation below (verify,
// deactivate, reactivate, delete, reject, invite) and the pending queue stay
// SUPER_ADMIN-only.
authRouter.get('/admin/accounts', requireAuth, requireRole('SUPER_ADMIN', 'COORDINATOR'), asyncHandler(async (req, res) => {
  const role = req.query.role as UserRole | undefined;
  res.json({ accounts: await svc.listActiveAccounts(role) });
}));

authRouter.get('/admin/accounts/search', requireAuth, requireRole('SUPER_ADMIN', 'COORDINATOR'), asyncHandler(async (req, res) => {
  const input = parse(v.accountSearchSchema, {
    q: req.query.q,
    role: req.query.role || undefined,
    limit: req.query.limit ? Number(req.query.limit) : undefined,
  });
  res.json({ accounts: await svc.searchAccounts(input.q, input.role, input.limit ?? 10) });
}));

authRouter.post('/admin/verify', requireAuth, requireRole('SUPER_ADMIN'), asyncHandler(async (req, res) => {
  const { userId } = parse(v.verifyAccountSchema, req.body);
  await svc.verifyAccount(userId, req.user!.userId);
  res.json({ message: 'Account verified and activated.' });
}));

authRouter.post('/admin/deactivate', requireAuth, requireRole('SUPER_ADMIN'), asyncHandler(async (req, res) => {
  const { userId, durationMinutes } = parse(v.deactivateAccountSchema, req.body);
  await svc.deactivateAccount(userId, req.user!.userId, durationMinutes);
  res.json({ message: 'Account deactivated.' });
}));

authRouter.post('/admin/reactivate', requireAuth, requireRole('SUPER_ADMIN'), asyncHandler(async (req, res) => {
  const { userId } = parse(v.verifyAccountSchema, req.body);
  await svc.reactivateAccount(userId);
  res.json({ message: 'Account reactivated.' });
}));

// UI-level delete — see deleteAccountPermanently for why this isn't a hard DELETE.
authRouter.post('/admin/delete', requireAuth, requireRole('SUPER_ADMIN'), asyncHandler(async (req, res) => {
  const { userId } = parse(v.verifyAccountSchema, req.body);
  await svc.deleteAccountPermanently(userId, req.user!.userId);
  res.json({ message: 'Account deleted.' });
}));

// Reject a pending account with a reason (emails the applicant).
authRouter.post('/admin/reject', requireAuth, requireRole('SUPER_ADMIN'), asyncHandler(async (req, res) => {
  const { userId, reason } = parse(v.rejectAccountSchema, req.body);
  await svc.rejectAccount(userId, reason);
  res.json({ message: 'Account rejected and applicant notified.' });
}));

// ── Super Admin: invite a Coordinator (AUTH-06) ──
authRouter.post('/admin/invite-coordinator', requireAuth, requireRole('SUPER_ADMIN'), asyncHandler(async (req, res) => {
  const input = parse(v.inviteCoordinatorSchema, req.body);
  const { userId, devToken } = await svc.inviteCoordinator(input, req.user!.userId, clientOrigin(req));
  res.status(201).json({ userId, devToken, message: 'Invitation sent.' });
}));

// ── Coordinator accepts invite (public — token-gated) ──
authRouter.post('/accept-invite', asyncHandler(async (req, res) => {
  const { token, password } = parse(v.acceptInviteSchema, req.body);
  const user = await svc.acceptInvite(token, password);
  res.json({ user, message: 'Account activated. You can now sign in.' });
}));
