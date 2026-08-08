# Feature 1 — Authentication & Roles · Test Log

**Status:** ✅ 26 / 26 API tests pass · verified against live PostgreSQL 16
**Rules covered:** all 22 AUTH rules (AUTH-01 … AUTH-22)
**Delivery:** backend + frontend, tested end to end over HTTP.

---

## 1. What this feature does

The identity layer every other feature builds on:

- **Registration** — students (`XX-XXXXXX-XXX` enrollment) and external coordinators self-register into `PENDING_VERIFICATION`.
- **Verification** — only a Super Admin activates a pending account (AUTH-04).
- **Login** — bcrypt, JWT access token (in memory) + rotating refresh token (HTTP-only cookie), 5-attempt lockout.
- **Coordinator onboarding** — Super Admin sends an **email invite**; the coordinator sets their own password. The admin never handles a coordinator's password.
- **Password self-service** — change password, and a 15-minute single-use reset link with no account enumeration.

---

## 2. Endpoints

| Method | Path | Auth | Rule |
|---|---|---|---|
| POST | `/api/auth/register/student` | public | AUTH-01/02/03 |
| POST | `/api/auth/register/external` | public | AUTH-19/22 |
| POST | `/api/auth/login` | public | AUTH-08/09/11 |
| POST | `/api/auth/refresh` | cookie | AUTH-09 |
| POST | `/api/auth/logout` | cookie | AUTH-10 |
| POST | `/api/auth/change-password` | user | AUTH-17 |
| POST | `/api/auth/forgot-password` | public | AUTH-18 |
| POST | `/api/auth/reset-password` | token | AUTH-21 |
| GET | `/api/auth/me` | user | AUTH-12 |
| GET | `/api/auth/admin/pending` | Super Admin | AUTH-04/16 |
| POST | `/api/auth/admin/verify` | Super Admin | AUTH-04 |
| POST | `/api/auth/admin/deactivate` | Super Admin | AUTH-13/14 |
| POST | `/api/auth/admin/invite-coordinator` | Super Admin | AUTH-06 |
| POST | `/api/auth/accept-invite` | token | AUTH-06 |

Role checks are enforced **twice** — once in Express middleware (`requireRole`) and again by the database triggers (`fn_verifier_guard`, `fn_protect_last_superadmin`, `fn_invite_inviter_guard`). Defense in depth: a route that forgets the check still can't write an illegal row.

---

## 3. Test results (26 / 26)

| ID | Rule | What it proves | Result |
|---|---|---|---|
| T-101 | AUTH-03 | Student registers → `PENDING_VERIFICATION` | ✅ |
| T-102 | AUTH-01 | Malformed enrollment rejected | ✅ |
| T-103 | AUTH-01 | `XX-XXXXXX-XXX` accepted | ✅ |
| T-104 | AUTH-18 | Duplicate email rejected (case-insensitive via `citext`) | ✅ |
| T-105 | AUTH-19/22 | External registers with institution details | ✅ |
| T-106 | AUTH-03 | `PENDING` account cannot log in | ✅ |
| T-107 | AUTH-08 | Verified account logs in; gets access token + refresh cookie | ✅ |
| T-108 | AUTH-11 | Account locks after 5 failed attempts | ✅ |
| T-110 | AUTH-09 | Refresh **rotates** the token | ✅ |
| T-111 | AUTH-10 | Logout invalidates refresh immediately | ✅ |
| T-112 | AUTH-09 | A rotated (old) refresh token can't be reused | ✅ |
| T-113 | AUTH-04 | Super Admin verifies a pending account | ✅ |
| T-114 | AUTH-16 | A student **cannot** reach the verify queue | ✅ |
| T-115 | AUTH-12 | Unauthenticated admin request → 401 | ✅ |
| T-116 | AUTH-06 | Queue lists students/externals only, not coordinators | ✅ |
| T-117 | AUTH-13 | Cannot deactivate the last active Super Admin | ✅ |
| T-118 | AUTH-06 | Super Admin invites a coordinator | ✅ |
| T-119 | AUTH-16 | Non-admin cannot invite | ✅ |
| T-120 | AUTH-06 | Coordinator accepts, sets password, logs in as `COORDINATOR` | ✅ |
| T-121 | AUTH-06 | Bad invite token rejected | ✅ |
| T-122 | AUTH-18 | Forgot-password identical for known/unknown email (no enumeration) | ✅ |
| T-123 | AUTH-21 | Reset with invalid token rejected | ✅ |
| T-124 | AUTH-17 | Change-password needs the correct current password | ✅ |
| T-125 | AUTH-17 | Change-password succeeds with correct current password | ✅ |
| T-126 | AUTH-06 | Invite token is single-use | ✅ |

Run them: `cd server && TEST_DATABASE_URL=... npx vitest run`

---

## 4. One defect found and fixed during this build

**T-122 (AUTH-18 no-enumeration)** initially failed: forgot-password for a *known* email returned 500, not 200. The `requestPasswordReset` insert omitted `expires_at`, relying on a DB default that doesn't exist — and the table has `CHECK (expires_at = issued_at + interval '15 minutes')`. Computing the time in JS would fail the check on any app/DB clock skew, so the fix sets it with a SQL expression (`now() + interval '15 minutes'`) evaluated in DB time. This is the same class of "a comment assumed a default that wasn't there" issue we caught in the schema rounds — only visible against a real database.

---

## 5. Frontend screens

All against the real API, with loading / empty / error states in the interface's voice:

- **Sign in** (`/login`)
- **Register** (`/register`) — student / external tabs
- **Forgot password** (`/forgot-password`) and **Reset** (`/reset-password?token=…`)
- **Accept invitation** (`/accept-invite?token=…`)
- **Accounts** (`/admin/accounts`, Super Admin) — verify queue + invite a coordinator (shows the dev invite link when email is in console mode)

---

## 6. Files in this feature

**New — backend**
- `db/migrations/003_coordinator_invite.sql`
- `server/src/lib/tokens.ts`
- `server/src/middleware/async.ts`
- `server/src/features/auth/{validators,service,router}.ts`
- `server/tests/{setup,auth.test}.ts`
- `server/vitest.config.ts`, `server/tsconfig.test.json`

**New — frontend**
- `client/src/components/ui.tsx`
- `client/src/features/auth/{api,LoginScreen,RegisterScreen,PasswordResetScreens,AcceptInviteScreen,AdminAccountsScreen}.tsx`

**Changed**
- `server/src/app.ts` — mounts `authRouter` at `/api/auth`
- `client/src/App.tsx` — wires the auth routes

---

## 7. Not in this feature (by design)

- **Email delivery** runs in `console` mode in dev (logs the link). Set `EMAIL_PROVIDER=resend` + `RESEND_API_KEY` for real email.
- **In-system notifications** (the notification inbox) are Feature 8. Feature 1 sends the AUTH emails (verification, invite, reset) directly; the inbox UI comes later.

---

## 8. UI Redesign + Admin Review (update)

The frontend was rebuilt to match the BUKC portal design, and the admin flow gained a full review-and-decide step.

### Navigation model
- **Landing page** is a tile grid of four portals: Student, External, Coordinator, Administration Staff. No role dropdown — the tiles are the role picker.
- Each tile opens its **own login page**:
  - **Student** — Enrollment + Password + Institute dropdown (Karachi Campus preselected, all other campuses shown but disabled). Logs in **by enrollment number**, not email (AUTH-01). Has a "New Student" link.
  - **External** — Email + Password. Has a "New External" link.
  - **Coordinator** — Email + Password. **No** register link (invite-only, AUTH-06).
  - **Administration Staff** (Super Admin) — Email + Password. No register link (seeded).

### Registration (students & externals)
- Student form has cascading **Department → Program Title** dropdowns (pick Computer Science → programs narrow to BS CS, BS AI, BS IT, etc.). Both are stored (`student_profile.department`, `student_profile.program_title`).
- On success: green **"Account created. Awaiting administrator verification."** banner.
- No CAPTCHA anywhere (per project decision).

### Admin review & decide (new)
- The pending queue lists applicants; **Review** opens a detail panel showing every registration field (enrollment, department, program for students; institution, representative, designation for externals).
- **Accept & Activate** → verifies the account (AUTH-04) and emails the applicant that their account is active.
- **Reject…** → requires a typed reason, which is stored (`app_user.rejection_reason`) and **emailed to the applicant**. A rejected account cannot log in.

### Database changes (migration `004_registration_details.sql`)
- `student_profile.program_title` — the specific degree program.
- `app_user.rejection_reason` — retained on rejected accounts, emailed to the applicant.
- Both additive and forward-only; the verified `001` schema is untouched, and the 128 DB rule tests still hold.

### Tests (30 / 30)
Four tests were added for the redesign:
| ID | What it proves | Result |
|---|---|---|
| T-127 | AUTH-01 — a verified student logs in with **enrollment**, not email | ✅ |
| T-129 | Super Admin rejects a pending account with a reason; it then cannot log in | ✅ |
| T-130 | Rejection requires a reason | ✅ |

Verified end to end over HTTP: register-with-program → admin sees full detail → reject-with-reason (email fired) → rejected login blocked → second student approved → **login by enrollment** succeeds → approval + rejection emails both generated.

### Email
Runs in `console` mode in dev (logs the message). With your Resend key in `server/.env` (`EMAIL_PROVIDER=resend`), approval/rejection/invite/reset emails go to real inboxes. On Resend's free tier without a verified domain, delivery is limited to your own account email until you verify a domain — a one-line `EMAIL_FROM` change, no code impact.
