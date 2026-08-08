/**
 * Typed wrappers over the auth endpoints. Screens call these, never `api()`
 * directly, so request/response shapes live in one place and match the server.
 */
import { api, setAccessToken } from '../../lib/api.js';
import type { CurrentUser } from '../../lib/auth.js';

interface AuthResponse {
  user: CurrentUser;
  accessToken: string;
}

export interface StudentRegisterInput {
  fullName: string;
  email: string;
  contactNumber: string;
  password: string;
  enrollmentNo: string;
  department: string;
  programTitle: string;
}

export interface ExternalRegisterInput {
  fullName: string;
  email: string;
  contactNumber: string;
  password: string;
  institutionName: string;
  designation: string;
}

export interface PendingAccount {
  userId: string;
  role: 'STUDENT' | 'EXTERNAL';
  fullName: string;
  email: string;
  contactNumber: string;
  createdAt: string;
  enrollmentNo?: string;
  department?: string;
  programTitle?: string;
  institutionName?: string;
  designation?: string;
}

export interface ManagedAccount {
  userId: string;
  role: 'STUDENT' | 'EXTERNAL' | 'COORDINATOR';
  status: 'ACTIVE' | 'DEACTIVATED';
  fullName: string;
  email: string;
  contactNumber: string;
  createdAt: string;
  deactivatedAt?: string;
  deactivatedUntil?: string; // absent = indefinite ("until reactivated")
  lockedUntil?: string; // AUTH-11: present = temporarily locked from repeated failed logins
  enrollmentNo?: string;
  department?: string;
  programTitle?: string;
  institutionName?: string;
  designation?: string;
}

export async function login(email: string, password: string): Promise<CurrentUser> {
  const res = await api<AuthResponse>('/api/auth/login', {
    method: 'POST',
    body: { email, password },
  });
  setAccessToken(res.accessToken);
  return res.user;
}

export async function studentLogin(enrollmentNo: string, password: string): Promise<CurrentUser> {
  const res = await api<AuthResponse>('/api/auth/login/student', {
    method: 'POST',
    body: { enrollmentNo, password },
  });
  setAccessToken(res.accessToken);
  return res.user;
}

export function registerStudent(input: StudentRegisterInput) {
  return api<{ message: string }>('/api/auth/register/student', { method: 'POST', body: input });
}

export function registerExternal(input: ExternalRegisterInput) {
  return api<{ message: string }>('/api/auth/register/external', { method: 'POST', body: input });
}

export function forgotPassword(email: string) {
  return api<{ message: string }>('/api/auth/forgot-password', { method: 'POST', body: { email } });
}

export function resetPassword(email: string, otp: string, newPassword: string) {
  return api<{ message: string }>('/api/auth/reset-password', {
    method: 'POST',
    body: { email, otp, newPassword },
  });
}

// AUTH-17, two-step: verify current password + email an OTP, then confirm
// with that OTP to actually apply the change.
export function requestChangePasswordOtp(currentPassword: string) {
  return api<{ message: string }>('/api/auth/change-password/request-otp', {
    method: 'POST',
    body: { currentPassword },
  });
}
export function confirmChangePassword(otp: string, newPassword: string) {
  return api<{ message: string }>('/api/auth/change-password/confirm', {
    method: 'POST',
    body: { otp, newPassword },
  });
}

export function acceptInvite(token: string, password: string) {
  return api<{ user: CurrentUser; message: string }>('/api/auth/accept-invite', {
    method: 'POST',
    body: { token, password },
  });
}

// ── Super Admin ──
export function listPending() {
  return api<{ accounts: PendingAccount[] }>('/api/auth/admin/pending');
}
export function verifyAccount(userId: string) {
  return api<{ message: string }>('/api/auth/admin/verify', { method: 'POST', body: { userId } });
}
export function deactivateAccount(userId: string, durationMinutes?: number) {
  return api<{ message: string }>('/api/auth/admin/deactivate', {
    method: 'POST',
    body: durationMinutes ? { userId, durationMinutes } : { userId },
  });
}
export function reactivateAccount(userId: string) {
  return api<{ message: string }>('/api/auth/admin/reactivate', { method: 'POST', body: { userId } });
}
// UI-level delete — see the server's deleteAccountPermanently for why this
// isn't a hard DELETE. The account disappears from every listing and its
// login behaves exactly as if it never existed.
export function deleteAccountPermanently(userId: string) {
  return api<{ message: string }>('/api/auth/admin/delete', { method: 'POST', body: { userId } });
}
export function listActiveAccounts(role?: ManagedAccount['role']) {
  const qs = role ? `?role=${role}` : '';
  return api<{ accounts: ManagedAccount[] }>(`/api/auth/admin/accounts${qs}`);
}
export function searchAccounts(q: string, role: ManagedAccount['role'] | undefined, limit: number, signal?: AbortSignal) {
  const params = new URLSearchParams({ q, limit: String(limit) });
  if (role) params.set('role', role);
  return api<{ accounts: ManagedAccount[] }>(`/api/auth/admin/accounts/search?${params}`, { signal });
}
export function rejectAccount(userId: string, reason: string) {
  return api<{ message: string }>('/api/auth/admin/reject', {
    method: 'POST',
    body: { userId, reason },
  });
}
export function inviteCoordinator(input: { fullName: string; email: string; contactNumber: string }) {
  return api<{ userId: string; devToken?: string; message: string }>(
    '/api/auth/admin/invite-coordinator',
    { method: 'POST', body: input },
  );
}
export function getMyProfile() {
  return api<{ account: ManagedAccount }>('/api/auth/me');
}
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
export function listCoordinatorInvites() {
  return api<{ invites: CoordinatorInviteRecord[] }>('/api/auth/admin/coordinator-invites');
}
export function deleteCoordinatorInvite(inviteId: string) {
  return api<{ message: string }>(`/api/auth/admin/coordinator-invites/${inviteId}`, { method: 'DELETE' });
}
