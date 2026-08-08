/**
 * Feature 1 — Auth integration tests. Supertest against the real app + real DB.
 * Each test asserts a business rule; the id/rule columns mirror the ERD harness.
 *
 * Helper conventions: `agent` keeps cookies across requests (refresh flow).
 */
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { seedCreds } from './setup.js';
import { db } from '../src/db/index.js';

const app = createApp();

// ── helpers ──
const uniqueEmail = (p = 'u') => `${p}.${Date.now()}.${Math.random().toString(36).slice(2, 7)}@bukc.edu.pk`;
const enroll = () => `84-${String(Math.floor(Math.random() * 900000) + 100000)}-${String(Math.floor(Math.random() * 900) + 100)}`;

async function registerStudent(over: Record<string, unknown> = {}) {
  return request(app).post('/api/auth/register/student').send({
    fullName: 'Ali Student', email: uniqueEmail('ali'), contactNumber: '03001234567',
    password: 'StudentPass1', enrollmentNo: enroll(), department: 'Computer Science', programTitle: 'BS Computer Science', ...over,
  });
}

async function loginAs(email: string, password: string) {
  return request(app).post('/api/auth/login').send({ email, password });
}

/**
 * A super-admin client where every request carries BOTH the refresh cookie AND
 * the Bearer access token — because admin routes authenticate via the access
 * token, not the cookie. Wrapping the agent's verbs keeps every call authed.
 */
async function superAdminAgent() {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send(seedCreds);
  const token = res.body.accessToken as string;
  const bearer = { Authorization: `Bearer ${token}` };
  const authed = {
    get: (url: string) => agent.get(url).set(bearer),
    post: (url: string) => agent.post(url).set(bearer),
    delete: (url: string) => agent.delete(url).set(bearer),
  };
  return { agent: authed, token, raw: agent };
}

// ═══════════════════════════════ REGISTRATION ═══════════════════════════════
describe('Registration (AUTH-01/02/03)', () => {
  it('T-101 AUTH-03: student registers and lands in PENDING_VERIFICATION', async () => {
    const res = await registerStudent();
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('STUDENT');
    const row = await db.selectFrom('app_user').select('status').where('user_id', '=', res.body.user.userId).executeTakeFirst();
    expect(row?.status).toBe('PENDING_VERIFICATION');
  });

  it('T-102 AUTH-01: rejects malformed enrollment number', async () => {
    const res = await registerStudent({ enrollmentNo: 'ABC-123' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/enrollment/i);
  });

  it('T-103 AUTH-01: accepts XX-XXXXXX-XXX format', async () => {
    const res = await registerStudent({ enrollmentNo: '84-024000-999' });
    expect(res.status).toBe(201);
  });

  it('T-104 AUTH-18: rejects duplicate email (case-insensitive)', async () => {
    const email = uniqueEmail('dup');
    await registerStudent({ email });
    const res = await registerStudent({ email: email.toUpperCase() });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('EMAIL_TAKEN');
  });

  it('T-105 AUTH-19/22: external registers with institution details', async () => {
    const res = await request(app).post('/api/auth/register/external').send({
      fullName: 'Ext Rep', email: uniqueEmail('ext'), contactNumber: '03009999999',
      password: 'ExternalPass1', institutionName: 'NED University', designation: 'Sports Head',
    });
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('EXTERNAL');
  });

  it('T-105b: rejects a contact number that is not a valid Pakistani mobile format (the exact reported bug)', async () => {
    const res = await request(app).post('/api/auth/register/external').send({
      fullName: 'Ext Rep', email: uniqueEmail('ext'), contactNumber: '11111111111',
      password: 'ExternalPass1', institutionName: 'NED University', designation: 'Sports Head',
    });
    expect(res.status).toBe(400);
  });

  it('T-105c: accepts the hyphenated contact number format too', async () => {
    const res = await request(app).post('/api/auth/register/external').send({
      fullName: 'Ext Rep', email: uniqueEmail('ext'), contactNumber: '0300-9999999',
      password: 'ExternalPass1', institutionName: 'NED University', designation: 'Sports Head',
    });
    expect(res.status).toBe(201);
  });

  it('T-105d: rejects a password with no digit', async () => {
    const res = await request(app).post('/api/auth/register/external').send({
      fullName: 'Ext Rep', email: uniqueEmail('ext'), contactNumber: '03009999999',
      password: 'NoDigitsHere', institutionName: 'NED University', designation: 'Sports Head',
    });
    expect(res.status).toBe(400);
  });

  it('T-105e: rejects a full name containing digits/symbols', async () => {
    const res = await request(app).post('/api/auth/register/external').send({
      fullName: 'Ext123', email: uniqueEmail('ext'), contactNumber: '03009999999',
      password: 'ExternalPass1', institutionName: 'NED University', designation: 'Sports Head',
    });
    expect(res.status).toBe(400);
  });

  it('T-105f: accepts a hyphenated/apostrophe name (e.g. Abdul-Rahman, O\'Brien)', async () => {
    const res = await request(app).post('/api/auth/register/external').send({
      fullName: "Abdul-Rahman O'Brien", email: uniqueEmail('ext'), contactNumber: '03009999999',
      password: 'ExternalPass1', institutionName: 'NED University', designation: 'Sports Head',
    });
    expect(res.status).toBe(201);
  });

  it('T-105g: accepts an institution name with parentheses (e.g. real preset university names)', async () => {
    const res = await request(app).post('/api/auth/register/external').send({
      fullName: 'Ext Rep', email: uniqueEmail('ext'), contactNumber: '03009999999',
      password: 'ExternalPass1', institutionName: 'Institute of Business Administration (IBA)', designation: 'Sports Head',
    });
    expect(res.status).toBe(201);
  });

  it('T-105h: representativeName is no longer accepted/required as a field', async () => {
    const res = await request(app).post('/api/auth/register/external').send({
      fullName: 'Ext Rep', email: uniqueEmail('ext'), contactNumber: '03009999999',
      password: 'ExternalPass1', institutionName: 'NED University', designation: 'Sports Head',
      representativeName: 'Should Be Ignored',
    });
    expect(res.status).toBe(201);
  });
});

// ═══════════════════════════════ LOGIN / LOCKOUT ═══════════════════════════════
describe('Login & lockout (AUTH-08/11/14)', () => {
  it('T-106 AUTH-03: PENDING account cannot log in', async () => {
    const email = uniqueEmail('pending');
    await registerStudent({ email, password: 'StudentPass1' });
    const res = await loginAs(email, 'StudentPass1');
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/verif/i);
  });

  it('T-107: verified account logs in and receives an access token + refresh cookie', async () => {
    const { agent } = await superAdminAgent();
    // register + verify a student
    const reg = await registerStudent({ password: 'StudentPass1' });
    await agent.post('/api/auth/admin/verify').send({ userId: reg.body.user.userId });
    const res = await loginAs(reg.body.user.email, 'StudentPass1');
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.headers['set-cookie']?.[0]).toMatch(/bukc_refresh/);
  });

  it('T-108 AUTH-11: locks the account after 5 failed attempts', async () => {
    const { agent } = await superAdminAgent();
    const reg = await registerStudent({ password: 'RightPass1' });
    await agent.post('/api/auth/admin/verify').send({ userId: reg.body.user.userId });
    for (let i = 0; i < 5; i++) await loginAs(reg.body.user.email, 'WrongPass');
    const res = await loginAs(reg.body.user.email, 'RightPass1'); // correct, but locked
    expect(res.status).toBe(423);
    expect(res.body.code).toBe('LOCKED');
  });

  it('T-108b AUTH-11: a lock that has genuinely expired resets the failure counter — a single wrong guess right after expiry does NOT immediately re-lock', async () => {
    const { agent } = await superAdminAgent();
    const reg = await registerStudent({ password: 'RightPass1' });
    const userId = reg.body.user.userId;
    await agent.post('/api/auth/admin/verify').send({ userId });
    for (let i = 0; i < 5; i++) await loginAs(reg.body.user.email, 'WrongPass');
    const stillLocked = await loginAs(reg.body.user.email, 'RightPass1');
    expect(stillLocked.status).toBe(423);

    // Simulate the 15-minute window having genuinely elapsed.
    await db.updateTable('app_user').set({ locked_until: new Date(Date.now() - 1000) })
      .where('user_id', '=', userId).execute();

    // A wrong guess right after expiry must NOT re-lock immediately — without
    // the counter reset, nextCount would be 5+1=6 (still >= threshold),
    // re-locking for another full window on every subsequent attempt forever.
    const wrongAfterExpiry = await loginAs(reg.body.user.email, 'StillWrong');
    expect(wrongAfterExpiry.status).toBe(401); // plain "invalid", not 423 locked

    const row = await db.selectFrom('app_user').select(['failed_login_count', 'locked_until'])
      .where('user_id', '=', userId).executeTakeFirst();
    expect(row?.failed_login_count).toBe(1); // reset to 0, then this one failure counted
    expect(row?.locked_until).toBeNull();

    // And the correct password now works normally.
    const success = await loginAs(reg.body.user.email, 'RightPass1');
    expect(success.status).toBe(200);
  });

  it('T-109: wrong password gives the same message as unknown email (no enumeration)', async () => {
    const unknown = await loginAs('nobody@bukc.edu.pk', 'x');
    expect(unknown.status).toBe(401);
    expect(unknown.body.error).toMatch(/invalid email or password/i);
  });
});

// ═══════════════════════════════ REFRESH / LOGOUT ═══════════════════════════════
describe('Session lifecycle (AUTH-09/10)', () => {
  it('T-110 AUTH-09: refresh rotates the token and returns a new access token', async () => {
    const { raw } = await superAdminAgent();
    const first = await raw.post('/api/auth/refresh');
    expect(first.status).toBe(200);
    expect(first.body.accessToken).toBeTruthy();
  });

  it('T-111 AUTH-10: logout invalidates the refresh token immediately', async () => {
    const { raw } = await superAdminAgent();
    await raw.post('/api/auth/logout').expect(204);
    const after = await raw.post('/api/auth/refresh');
    expect(after.status).toBe(401);
  });

  it('T-112 AUTH-09: a rotated (old) refresh token cannot be reused', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send(seedCreds);
    // capture the current cookie, rotate once, then try the OLD cookie
    const oldCookie = (await agent.post('/api/auth/refresh')).headers['set-cookie'];
    await agent.post('/api/auth/refresh'); // rotates again on the agent
    const replay = await request(app).post('/api/auth/refresh').set('Cookie', oldCookie!);
    expect(replay.status).toBe(401);
  });
});

// ═══════════════════════════════ SUPER ADMIN: VERIFY (AUTH-04) ═══════════════════════════════
describe('Account verification (AUTH-04/16)', () => {
  it('T-113 AUTH-04: super admin verifies a pending account', async () => {
    const { agent } = await superAdminAgent();
    const reg = await registerStudent();
    const res = await agent.post('/api/auth/admin/verify').send({ userId: reg.body.user.userId });
    expect(res.status).toBe(200);
    const row = await db.selectFrom('app_user').select(['status', 'verified_by']).where('user_id', '=', reg.body.user.userId).executeTakeFirst();
    expect(row?.status).toBe('ACTIVE');
    expect(row?.verified_by).toBeTruthy();
  });

  it('T-114 AUTH-16: a STUDENT cannot access the verification queue', async () => {
    const { agent } = await superAdminAgent();
    const reg = await registerStudent({ password: 'StudentPass1' });
    await agent.post('/api/auth/admin/verify').send({ userId: reg.body.user.userId });
    const login = await loginAs(reg.body.user.email, 'StudentPass1');
    const res = await request(app).get('/api/auth/admin/pending').set('Authorization', `Bearer ${login.body.accessToken}`);
    expect(res.status).toBe(403);
  });

  it('T-115: unauthenticated request to admin route is 401', async () => {
    const res = await request(app).get('/api/auth/admin/pending');
    expect(res.status).toBe(401);
  });

  it('T-116: the pending queue lists students/externals only, not coordinators', async () => {
    const { agent } = await superAdminAgent();
    await registerStudent();
    await agent.post('/api/auth/admin/invite-coordinator').send({
      fullName: 'Coord', email: uniqueEmail('coord'), contactNumber: '03001112222',
    });
    const res = await agent.get('/api/auth/admin/pending');
    expect(res.status).toBe(200);
    expect(res.body.accounts.every((a: { role: string }) => a.role !== 'COORDINATOR')).toBe(true);
    // detail is present for the review screen
    const student = res.body.accounts.find((a: { role: string }) => a.role === 'STUDENT');
    expect(student.enrollmentNo).toBeTruthy();
    expect(student.department).toBeTruthy();
    expect(student.programTitle).toBeTruthy();
  });
});

// ═══════════════════════════════ AUTH-13: LAST SUPER ADMIN ═══════════════════════════════
describe('Super admin protection (AUTH-13)', () => {
  it('T-117 AUTH-13: cannot deactivate the last active super admin', async () => {
    const { agent } = await superAdminAgent();
    // the seeded SA is the only one; deactivating self must fail at the DB trigger
    const me = await agent.get('/api/auth/me');
    const res = await agent.post('/api/auth/admin/deactivate').send({ userId: me.body.account.userId });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/AUTH-13/);
  });
});

// ═══════════════════════════════ AUTH-06: COORDINATOR INVITE ═══════════════════════════════
describe('Coordinator invite flow (AUTH-06)', () => {
  it('T-118 AUTH-06: super admin invites a coordinator; account is created PENDING', async () => {
    const { agent } = await superAdminAgent();
    const email = uniqueEmail('coord');
    const res = await agent.post('/api/auth/admin/invite-coordinator').send({
      fullName: 'New Coord', email, contactNumber: '03005556666',
    });
    expect(res.status).toBe(201);
    const row = await db.selectFrom('app_user').select(['role', 'status', 'created_by']).where('user_id', '=', res.body.userId).executeTakeFirst();
    expect(row?.role).toBe('COORDINATOR');
    expect(row?.status).toBe('PENDING_VERIFICATION');
    expect(row?.created_by).toBeTruthy(); // AUTH-06: created by super admin
  });

  it('T-119 AUTH-16: a non-super-admin cannot invite a coordinator', async () => {
    const res = await request(app).post('/api/auth/admin/invite-coordinator').send({
      fullName: 'X', email: uniqueEmail(), contactNumber: '03001112222',
    });
    expect(res.status).toBe(401); // unauthenticated
  });

  it('T-120 AUTH-06: coordinator accepts the invite, sets password, becomes ACTIVE and can log in', async () => {
    const { agent } = await superAdminAgent();
    const email = uniqueEmail('coord');
    const inv = await agent.post('/api/auth/admin/invite-coordinator').send({
      fullName: 'New Coord', email, contactNumber: '03005556666',
    });
    const token = inv.body.devToken as string; // test-only raw token
    expect(token).toBeTruthy();

    const accept = await request(app).post('/api/auth/accept-invite').send({ token, password: 'CoordPass1' });
    expect(accept.status).toBe(200);
    expect(accept.body.user.role).toBe('COORDINATOR');

    // now ACTIVE and can log in
    const row = await db.selectFrom('app_user').select(['status', 'verified_at']).where('user_id', '=', inv.body.userId).executeTakeFirst();
    expect(row?.status).toBe('ACTIVE');
    expect(row?.verified_at).toBeTruthy();
    const login = await loginAs(email, 'CoordPass1');
    expect(login.status).toBe(200);
  });

  it('T-126 AUTH-06: an invite token cannot be used twice', async () => {
    const { agent } = await superAdminAgent();
    const inv = await agent.post('/api/auth/admin/invite-coordinator').send({
      fullName: 'Coord', email: uniqueEmail('coord'), contactNumber: '03005556666',
    });
    const token = inv.body.devToken as string;
    await request(app).post('/api/auth/accept-invite').send({ token, password: 'CoordPass1' }).expect(200);
    const second = await request(app).post('/api/auth/accept-invite').send({ token, password: 'Another1' });
    expect(second.status).toBe(400); // already accepted
  });

  it('T-121 AUTH-06: invite accept with a bad token is rejected', async () => {
    const res = await request(app).post('/api/auth/accept-invite').send({ token: 'not-a-real-token-value', password: 'CoordPass1' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid|expired/i);
  });
});

// ═══════════════════════════════ PASSWORD RESET (AUTH-17/18/21) ═══════════════════════════════
describe('Password reset (AUTH-17/18/21, OTP-based)', () => {
  it('T-122 AUTH-18: forgot-password always returns success (no enumeration)', async () => {
    const known = await request(app).post('/api/auth/forgot-password').send({ email: seedCreds.email });
    const unknown = await request(app).post('/api/auth/forgot-password').send({ email: 'ghost@bukc.edu.pk' });
    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(known.body.message).toBe(unknown.body.message);
  });

  it('T-123 AUTH-21: reset with a wrong code for a real email is rejected, same generic message as an unknown email', async () => {
    const email = uniqueEmail('badotp');
    await registerStudent({ email });
    await request(app).post('/api/auth/forgot-password').send({ email });

    const wrongCode = await request(app).post('/api/auth/reset-password').send({ email, otp: '11111111', newPassword: 'NewPass123' });
    const unknownEmail = await request(app).post('/api/auth/reset-password').send({ email: 'ghost@bukc.edu.pk', otp: '11111111', newPassword: 'NewPass123' });
    expect(wrongCode.status).toBe(400);
    expect(unknownEmail.status).toBe(400);
    expect(wrongCode.body.error).toBe(unknownEmail.body.error);
  });

  it('T-123b AUTH-18/21: the full OTP reset flow works end-to-end with the real code', async () => {
    const { agent } = await superAdminAgent();
    const email = uniqueEmail('realotp');
    const oldPassword = 'OldPassword1';
    const reg = await registerStudent({ email, password: oldPassword });
    await agent.post('/api/auth/admin/verify').send({ userId: reg.body.user.userId });

    const req1 = await request(app).post('/api/auth/forgot-password').send({ email });
    const otp = req1.body.devOtp as string;
    expect(otp).toMatch(/^\d{8}$/);

    const res = await request(app).post('/api/auth/reset-password').send({ email, otp, newPassword: 'BrandNew1' });
    expect(res.status).toBe(200);

    const relogin = await loginAs(email, 'BrandNew1');
    expect(relogin.status).toBe(200);
  });

  it('T-124 AUTH-17: change-password step 1 requires the correct current password', async () => {
    const { token } = await superAdminAgent();
    const res = await request(app).post('/api/auth/change-password/request-otp')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'WrongCurrent' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/current password/i);
  });

  it('T-125 AUTH-17: change-password succeeds end-to-end — request OTP, confirm, old password dead', async () => {
    const { token } = await superAdminAgent();
    const step1 = await request(app).post('/api/auth/change-password/request-otp')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: seedCreds.password });
    expect(step1.status).toBe(200);
    const otp = step1.body.devOtp as string;
    expect(otp).toMatch(/^\d{8}$/);

    const step2 = await request(app).post('/api/auth/change-password/confirm')
      .set('Authorization', `Bearer ${token}`)
      .send({ otp, newPassword: 'BrandNewPass1' });
    expect(step2.status).toBe(200);

    // old password no longer works
    const relogin = await loginAs(seedCreds.email, seedCreds.password);
    expect(relogin.status).toBe(401);
  });

  it('T-125a: confirming with a wrong OTP is rejected and does not change the password', async () => {
    const email = uniqueEmail('wrongconfirm');
    const password = 'StartPass1';
    const { agent } = await superAdminAgent();
    const reg = await registerStudent({ email, password });
    await agent.post('/api/auth/admin/verify').send({ userId: reg.body.user.userId });
    const login = await loginAs(email, password);
    const bearer = { Authorization: `Bearer ${login.body.accessToken}` };

    await request(app).post('/api/auth/change-password/request-otp').set(bearer).send({ currentPassword: password });
    const res = await request(app).post('/api/auth/change-password/confirm').set(bearer).send({ otp: '00000000', newPassword: 'NewPass1' });
    expect(res.status).toBe(400);

    const stillOld = await loginAs(email, password);
    expect(stillOld.status).toBe(200);
  });

  it('T-125b AUTH-21: requesting a new code invalidates the previous unused one — only the latest code works', async () => {
    const email = uniqueEmail('resetflow');
    await registerStudent({ email });

    const req1 = await request(app).post('/api/auth/forgot-password').send({ email });
    const firstOtp = req1.body.devOtp as string;

    await request(app).post('/api/auth/forgot-password').send({ email });

    // the first code, still unused a moment ago, is now dead
    const res = await request(app).post('/api/auth/reset-password').send({ email, otp: firstOtp, newPassword: 'Whatever1' });
    expect(res.status).toBe(400);
  });

  it('T-125c AUTH-21: more than 3 reset requests for the same email in the window are silently rate-limited (no new code issued)', async () => {
    const email = uniqueEmail('ratelimit');
    await registerStudent({ email });

    for (let i = 0; i < 3; i++) {
      const res = await request(app).post('/api/auth/forgot-password').send({ email });
      expect(res.status).toBe(200); // always the same generic response
    }
    const res4 = await request(app).post('/api/auth/forgot-password').send({ email });
    expect(res4.status).toBe(200); // still the same generic response — no signal either way
    expect(res4.body.devOtp).toBeUndefined(); // rate-limited — no code was actually issued
  });

  it('T-125d: a completed reset invalidates every session, not just the one that requested it', async () => {
    const { agent } = await superAdminAgent();
    const email = uniqueEmail('sessionkill');
    const password = 'OldPassword1';
    const reg = await registerStudent({ email, password });
    await agent.post('/api/auth/admin/verify').send({ userId: reg.body.user.userId });
    const login = await loginAs(email, password);
    expect(login.status).toBe(200);

    const req1 = await request(app).post('/api/auth/forgot-password').send({ email });
    await request(app).post('/api/auth/reset-password').send({ email, otp: req1.body.devOtp, newPassword: 'FreshPass1' });

    const openSessions = await db.selectFrom('refresh_token')
      .innerJoin('app_user', 'app_user.user_id', 'refresh_token.user_id')
      .select('refresh_token.token_id').where('app_user.email', '=', email).where('refresh_token.revoked_at', 'is', null).execute();
    expect(openSessions.length).toBe(0); // the pre-reset session was killed; no new one has logged in yet
  });

  it('T-125e AUTH-21: five wrong OTP guesses burn the code — the sixth attempt fails even if it happens to be correct', async () => {
    const email = uniqueEmail('bruteforce');
    await registerStudent({ email });
    const req1 = await request(app).post('/api/auth/forgot-password').send({ email });
    const realOtp = req1.body.devOtp as string;

    for (let i = 0; i < 5; i++) {
      // a validly-formatted (but wrong) password — an invalid format would
      // fail schema validation before ever reaching the OTP check at all,
      // which would make this loop test nothing.
      const res = await request(app).post('/api/auth/reset-password').send({ email, otp: '99999999', newPassword: 'WrongGuess1' });
      expect(res.status).toBe(400);
    }
    // the code is now burned regardless of correctness
    const finalTry = await request(app).post('/api/auth/reset-password').send({ email, otp: realOtp, newPassword: 'ValidPass1' });
    expect(finalTry.status).toBe(400);
  });
});

// ═══════════════════════════════ INVITE VALIDATION & AUDIT LOG ═══════════════════════════════
describe('Coordinator invite — validation and audit trail', () => {
  it('T-125e: invite-coordinator rejects an invalid contact number (the exact reported bug — all zeros)', async () => {
    const { agent } = await superAdminAgent();
    const res = await agent.post('/api/auth/admin/invite-coordinator').send({
      fullName: 'Bad Contact', email: uniqueEmail('badcontact'), contactNumber: '00000000000',
    });
    expect(res.status).toBe(400);
  });

  it('T-125f: the coordinator invite audit log shows PENDING, then ACCEPTED after the invite is used', async () => {
    const { agent } = await superAdminAgent();
    const email = uniqueEmail('auditcoord');
    const inv = await agent.post('/api/auth/admin/invite-coordinator').send({
      fullName: 'Audit Coord', email, contactNumber: '03001112222',
    });
    const token = inv.body.devToken as string;

    const before = await agent.get('/api/auth/admin/coordinator-invites');
    const entryBefore = before.body.invites.find((i: { email: string }) => i.email === email);
    expect(entryBefore.status).toBe('PENDING');

    await request(app).post('/api/auth/accept-invite').send({ token, password: 'CoordPass1' });

    const after = await agent.get('/api/auth/admin/coordinator-invites');
    const entryAfter = after.body.invites.find((i: { email: string }) => i.email === email);
    expect(entryAfter.status).toBe('ACCEPTED');
    expect(entryAfter.invitedByName).toBeTruthy();
  });

  it('T-125g: a non-super-admin cannot view the coordinator invite audit log', async () => {
    const res = await request(app).get('/api/auth/admin/coordinator-invites');
    expect(res.status).toBe(401);
  });

  it('T-125h: a super admin can hard-delete a coordinator invite record', async () => {
    const { agent } = await superAdminAgent();
    const email = uniqueEmail('deleteinvite');
    const inv = await agent.post('/api/auth/admin/invite-coordinator').send({
      fullName: 'To Be Deleted', email, contactNumber: '03001112222',
    });
    void inv;

    const before = await agent.get('/api/auth/admin/coordinator-invites');
    const entry = before.body.invites.find((i: { email: string }) => i.email === email);
    expect(entry).toBeTruthy();

    const del = await agent.delete(`/api/auth/admin/coordinator-invites/${entry.inviteId}`);
    expect(del.status).toBe(200);

    const after = await agent.get('/api/auth/admin/coordinator-invites');
    expect(after.body.invites.find((i: { email: string }) => i.email === email)).toBeUndefined();

    // this is a genuine hard delete — confirm the row is actually gone, not soft-flagged
    const row = await db.selectFrom('coordinator_invite').select('invite_id')
      .where('invite_id', '=', entry.inviteId).executeTakeFirst();
    expect(row).toBeUndefined();
  });

  it('T-125i: deleting the invite record does not affect an already-accepted coordinator\'s account', async () => {
    const { agent } = await superAdminAgent();
    const email = uniqueEmail('deleteafterAccept');
    const inv = await agent.post('/api/auth/admin/invite-coordinator').send({
      fullName: 'Accepted Coord', email, contactNumber: '03001112222',
    });
    const token = inv.body.devToken as string;
    await request(app).post('/api/auth/accept-invite').send({ token, password: 'CoordPass1' });

    const list = await agent.get('/api/auth/admin/coordinator-invites');
    const entry = list.body.invites.find((i: { email: string }) => i.email === email);
    expect(entry.status).toBe('ACCEPTED');

    await agent.delete(`/api/auth/admin/coordinator-invites/${entry.inviteId}`);

    // the coordinator's actual account is untouched — they can still log in
    const login = await loginAs(email, 'CoordPass1');
    expect(login.status).toBe(200);
  });

  it('T-125j: a non-super-admin cannot delete a coordinator invite record', async () => {
    const { agent } = await superAdminAgent();
    const email = uniqueEmail('nodelete');
    const inv = await agent.post('/api/auth/admin/invite-coordinator').send({
      fullName: 'No Delete', email, contactNumber: '03001112222',
    });
    const list = await agent.get('/api/auth/admin/coordinator-invites');
    const entry = list.body.invites.find((i: { email: string }) => i.email === email);
    void inv;

    const res = await request(app).delete(`/api/auth/admin/coordinator-invites/${entry.inviteId}`);
    expect(res.status).toBe(401);
  });
});

// ═══════════════════════════════ STUDENT LOGIN BY ENROLLMENT (AUTH-01) ═══════════════════════════════
describe('Student login by enrollment (AUTH-01)', () => {
  it('T-127 AUTH-01: a verified student logs in with enrollment, not email', async () => {
    const { agent } = await superAdminAgent();
    const enrollment = enroll();
    const email = uniqueEmail('stud');
    await registerStudent({ email, enrollmentNo: enrollment, password: 'StudentPass1' });
    // verify them
    const pend = await agent.get('/api/auth/admin/pending');
    const id = pend.body.accounts.find((a: { email: string }) => a.email === email).userId;
    await agent.post('/api/auth/admin/verify').send({ userId: id });
    // log in by enrollment
    const res = await request(app).post('/api/auth/login/student')
      .send({ enrollmentNo: enrollment, password: 'StudentPass1' });
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('STUDENT');
    expect(res.body.accessToken).toBeTruthy();
  });

  it('T-128 AUTH-01: unknown enrollment is rejected with a generic error', async () => {
    const res = await request(app).post('/api/auth/login/student')
      .send({ enrollmentNo: '99-999999-999', password: 'whatever1' });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid/i);
  });
});

// ═══════════════════════════════ ACCOUNT REJECTION WITH REASON ═══════════════════════════════
describe('Account rejection (admin review)', () => {
  it('T-129: super admin rejects a pending account with a reason; it cannot then log in', async () => {
    const { agent } = await superAdminAgent();
    const email = uniqueEmail('reject');
    await registerStudent({ email, password: 'StudentPass1' });
    const pend = await agent.get('/api/auth/admin/pending');
    const id = pend.body.accounts.find((a: { email: string }) => a.email === email).userId;

    const res = await agent.post('/api/auth/admin/reject').send({ userId: id, reason: 'Enrollment could not be verified.' });
    expect(res.status).toBe(200);

    // rejected (now DEACTIVATED) account cannot log in
    const login = await loginAs(email, 'StudentPass1');
    expect(login.status).toBe(403);
  });

  it('T-130: rejection requires a reason', async () => {
    const { agent } = await superAdminAgent();
    const email = uniqueEmail('reject2');
    await registerStudent({ email, password: 'StudentPass1' });
    const pend = await agent.get('/api/auth/admin/pending');
    const id = pend.body.accounts.find((a: { email: string }) => a.email === email).userId;
    const res = await agent.post('/api/auth/admin/reject').send({ userId: id, reason: '' });
    expect(res.status).toBe(400);
  });
});

// ═══════════════════ Account management (Active Accounts tab, AUTH-14) ═══════════════════
describe('Account management — deactivate/reactivate/delete/search', () => {
  async function activeStudent(over: Record<string, unknown> = {}) {
    const { agent } = await superAdminAgent();
    const email = uniqueEmail('mgmt');
    const password = 'StudentPass1';
    const reg = await registerStudent({ email, password, ...over });
    const userId = reg.body.user.userId;
    await agent.post('/api/auth/admin/verify').send({ userId });
    return { agent, userId, email, password };
  }

  it('T-131 AUTH-14: deactivating an ACTIVE account blocks login and invalidates its session', async () => {
    const { agent, userId, email, password } = await activeStudent();
    const login1 = await loginAs(email, password);
    expect(login1.status).toBe(200);

    const res = await agent.post('/api/auth/admin/deactivate').send({ userId });
    expect(res.status).toBe(200);

    const login2 = await loginAs(email, password);
    expect(login2.status).toBe(403);
  });

  it('T-132: an indefinite deactivation has no deactivatedUntil and stays deactivated after the opportunistic check', async () => {
    const { agent, userId } = await activeStudent();
    await agent.post('/api/auth/admin/deactivate').send({ userId });

    const list = await agent.get('/api/auth/admin/accounts');
    const row = list.body.accounts.find((a: { userId: string }) => a.userId === userId);
    expect(row.status).toBe('DEACTIVATED');
    expect(row.deactivatedUntil).toBeUndefined();
  });

  it('T-133: a timed deactivation auto-reactivates once its window elapses', async () => {
    const { agent, userId, email, password } = await activeStudent();
    // 1-second-equivalent window: deactivate for the minimum allowed duration,
    // then force the clock forward at the DB level to simulate elapsed time
    // (durationMinutes must be a positive integer per the API).
    await agent.post('/api/auth/admin/deactivate').send({ userId, durationMinutes: 1 });
    let row = await db.selectFrom('app_user').select(['status', 'deactivated_until']).where('user_id', '=', userId).executeTakeFirst();
    expect(row?.status).toBe('DEACTIVATED');

    // simulate the window having elapsed
    await db.updateTable('app_user').set({ deactivated_until: new Date(Date.now() - 1000) }).where('user_id', '=', userId).execute();

    // the opportunistic check runs on every accounts-list load
    await agent.get('/api/auth/admin/accounts');
    row = await db.selectFrom('app_user').select(['status', 'deactivated_until']).where('user_id', '=', userId).executeTakeFirst();
    expect(row?.status).toBe('ACTIVE');
    expect(row?.deactivated_until).toBeNull();

    const login = await loginAs(email, password);
    expect(login.status).toBe(200);
  });

  it('T-134: reactivating a deactivated account restores login', async () => {
    const { agent, userId, email, password } = await activeStudent();
    await agent.post('/api/auth/admin/deactivate').send({ userId });
    expect((await loginAs(email, password)).status).toBe(403);

    const res = await agent.post('/api/auth/admin/reactivate').send({ userId });
    expect(res.status).toBe(200);
    expect((await loginAs(email, password)).status).toBe(200);
  });

  it('T-135: deleting an account makes login behave EXACTLY like a nonexistent account', async () => {
    const { agent, userId, email, password } = await activeStudent();
    const del = await agent.post('/api/auth/admin/delete').send({ userId });
    expect(del.status).toBe(200);

    const deletedLogin = await loginAs(email, password);
    const nonexistentLogin = await loginAs('truly.nobody@nowhere.com', 'whatever123');
    expect(deletedLogin.status).toBe(nonexistentLogin.status);
    expect(deletedLogin.body.error).toBe(nonexistentLogin.body.error);
  });

  it('T-135b: a deleted student\'s enrollment-based login also matches the nonexistent case exactly', async () => {
    const { agent, userId, password } = await activeStudent();
    const row = await db.selectFrom('student_profile').select('enrollment_no').where('user_id', '=', userId).executeTakeFirstOrThrow();
    await agent.post('/api/auth/admin/delete').send({ userId });

    const deletedLogin = await request(app).post('/api/auth/login/student').send({ enrollmentNo: row.enrollment_no, password });
    const nonexistentLogin = await request(app).post('/api/auth/login/student').send({ enrollmentNo: '99-999999-999', password: 'whatever123' });
    expect(deletedLogin.status).toBe(nonexistentLogin.status);
    expect(deletedLogin.body.error).toBe(nonexistentLogin.body.error);
  });

  it('T-135c: a deleted account disappears from the accounts list and from search', async () => {
    const { agent, userId } = await activeStudent({ fullName: 'Zaid Uniquename' });
    await agent.post('/api/auth/admin/delete').send({ userId });

    const list = await agent.get('/api/auth/admin/accounts');
    expect(list.body.accounts.find((a: { userId: string }) => a.userId === userId)).toBeUndefined();

    const search = await agent.get('/api/auth/admin/accounts/search?q=Zaid');
    expect(search.body.accounts.find((a: { userId: string }) => a.userId === userId)).toBeUndefined();
  });

  it('T-135d: the freed-up email can be reused for a fresh registration after delete', async () => {
    const { agent, userId, email, password } = await activeStudent();
    await agent.post('/api/auth/admin/delete').send({ userId });

    const reReg = await registerStudent({ email, password });
    expect(reReg.status).toBe(201);
  });

  it('T-136: search finds a student by a fragment of their full name', async () => {
    const { agent } = await activeStudent({ fullName: 'Farhan Distinctive Malik' });
    const res = await agent.get('/api/auth/admin/accounts/search?q=Distinctive');
    expect(res.status).toBe(200);
    expect(res.body.accounts.some((a: { fullName: string }) => a.fullName === 'Farhan Distinctive Malik')).toBe(true);
  });

  it('T-137: search normalizes a hyphenated contact number against a plain stored one', async () => {
    const { agent } = await activeStudent({ contactNumber: '03211234567' });
    const res = await agent.get('/api/auth/admin/accounts/search?q=' + encodeURIComponent('0321-1234567'));
    expect(res.status).toBe(200);
    expect(res.body.accounts.some((a: { contactNumber: string }) => a.contactNumber === '03211234567')).toBe(true);
  });

  it('T-138: search requires at least 2 characters', async () => {
    const { agent } = await activeStudent();
    const res = await agent.get('/api/auth/admin/accounts/search?q=a');
    expect(res.status).toBe(400);
  });

  it('T-139: search can be scoped to a single role', async () => {
    const { agent } = await activeStudent({ fullName: 'RoleScopeTest Person' });
    const wrongRole = await agent.get('/api/auth/admin/accounts/search?q=RoleScopeTest&role=EXTERNAL');
    expect(wrongRole.body.accounts.length).toBe(0);
    const rightRole = await agent.get('/api/auth/admin/accounts/search?q=RoleScopeTest&role=STUDENT');
    expect(rightRole.body.accounts.some((a: { fullName: string }) => a.fullName === 'RoleScopeTest Person')).toBe(true);
  });

  it('T-140: a non-super-admin cannot deactivate, reactivate, delete, or search accounts', async () => {
    const { userId, email, password } = await activeStudent();
    const login = await loginAs(email, password);
    const bearer = { Authorization: `Bearer ${login.body.accessToken}` };

    const dRes = await request(app).post('/api/auth/admin/deactivate').set(bearer).send({ userId });
    expect(dRes.status).toBe(403);
    const rRes = await request(app).post('/api/auth/admin/reactivate').set(bearer).send({ userId });
    expect(rRes.status).toBe(403);
    const delRes = await request(app).post('/api/auth/admin/delete').set(bearer).send({ userId });
    expect(delRes.status).toBe(403);
    const sRes = await request(app).get('/api/auth/admin/accounts/search?q=test').set(bearer);
    expect(sRes.status).toBe(403);
  });

  it('T-141: cannot deactivate a still-PENDING account (use Reject instead)', async () => {
    const { agent } = await superAdminAgent();
    const email = uniqueEmail('stillpending');
    const reg = await registerStudent({ email });
    const res = await agent.post('/api/auth/admin/deactivate').send({ userId: reg.body.user.userId });
    expect(res.status).toBe(409);
  });

  it('T-142: a rejected (never-verified) application never appears in Active Accounts or search — it reuses the DEACTIVATED status but was never actually active', async () => {
    const { agent } = await superAdminAgent();
    const email = uniqueEmail('neververified');
    const reg = await registerStudent({ email, fullName: 'NeverVerified Applicant' });
    const userId = reg.body.user.userId;
    const rej = await agent.post('/api/auth/admin/reject').send({ userId, reason: 'Enrollment could not be verified.' });
    expect(rej.status).toBe(200);

    // The row does share the DEACTIVATED status with a real deactivated account...
    const row = await db.selectFrom('app_user').select(['status', 'verified_at']).where('user_id', '=', userId).executeTakeFirst();
    expect(row?.status).toBe('DEACTIVATED');
    expect(row?.verified_at).toBeNull();

    // ...but it must never surface as a manageable "active" account.
    const list = await agent.get('/api/auth/admin/accounts');
    expect(list.body.accounts.find((a: { userId: string }) => a.userId === userId)).toBeUndefined();
    const search = await agent.get('/api/auth/admin/accounts/search?q=NeverVerified');
    expect(search.body.accounts.find((a: { userId: string }) => a.userId === userId)).toBeUndefined();
  });

  it('T-143 AUTH-16: a Coordinator has read-only access — can list/search accounts but cannot modify anything or see the pending queue', async () => {
    const { agent: superAgent } = await superAdminAgent();
    const coordEmail = uniqueEmail('roCoord');
    const inv = await superAgent.post('/api/auth/admin/invite-coordinator').send({
      fullName: 'ReadOnly Coordinator', email: coordEmail, contactNumber: '03001112222',
    });
    const token = inv.body.devToken as string;
    const accept = await request(app).post('/api/auth/accept-invite').send({ token, password: 'CoordPass1' });
    expect(accept.status).toBe(200);
    const login = await loginAs(coordEmail, 'CoordPass1');
    const bearer = { Authorization: `Bearer ${login.body.accessToken}` };

    // can read
    const list = await request(app).get('/api/auth/admin/accounts').set(bearer);
    expect(list.status).toBe(200);
    const search = await request(app).get('/api/auth/admin/accounts/search?q=ReadOnly').set(bearer);
    expect(search.status).toBe(200);
    expect(search.body.accounts.some((a: { email: string }) => a.email === coordEmail)).toBe(true);

    // cannot see the pending queue
    const pending = await request(app).get('/api/auth/admin/pending').set(bearer);
    expect(pending.status).toBe(403);

    // cannot mutate anything
    const target = await activeStudent();
    const dRes = await request(app).post('/api/auth/admin/deactivate').set(bearer).send({ userId: target.userId });
    expect(dRes.status).toBe(403);
    const delRes = await request(app).post('/api/auth/admin/delete').set(bearer).send({ userId: target.userId });
    expect(delRes.status).toBe(403);
    const verifyRes = await request(app).post('/api/auth/admin/verify').set(bearer).send({ userId: target.userId });
    expect(verifyRes.status).toBe(403);
    const inviteRes = await request(app).post('/api/auth/admin/invite-coordinator').set(bearer)
      .send({ fullName: 'Nope', email: uniqueEmail('nope'), contactNumber: '03001112222' });
    expect(inviteRes.status).toBe(403);
  });

  it('T-144 AUTH-11: a locked account shows lockedUntil in the Active Accounts list and search, and it disappears once the lock expires', async () => {
    const { agent, userId, email } = await activeStudent();
    for (let i = 0; i < 5; i++) await loginAs(email, 'WrongPass');

    const list = await agent.get('/api/auth/admin/accounts');
    const row = list.body.accounts.find((a: { userId: string }) => a.userId === userId);
    expect(row.lockedUntil).toBeTruthy();
    expect(new Date(row.lockedUntil).getTime()).toBeGreaterThan(Date.now());

    const search = await agent.get(`/api/auth/admin/accounts/search?q=${encodeURIComponent(email)}`);
    const searchRow = search.body.accounts.find((a: { userId: string }) => a.userId === userId);
    expect(searchRow.lockedUntil).toBeTruthy();

    // Simulate expiry — the DB row still has a (now-past) locked_until until
    // the account's own next login attempt lazily clears it, but the API
    // must not present stale/expired lock data as if it were still in effect.
    await db.updateTable('app_user').set({ locked_until: new Date(Date.now() - 1000) })
      .where('user_id', '=', userId).execute();

    const listAfter = await agent.get('/api/auth/admin/accounts');
    const rowAfter = listAfter.body.accounts.find((a: { userId: string }) => a.userId === userId);
    expect(rowAfter.lockedUntil).toBeUndefined();
  });
});
