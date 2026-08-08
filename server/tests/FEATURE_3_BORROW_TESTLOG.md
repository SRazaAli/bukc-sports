# Feature 3 — Borrow & Return · Test Log

**Status:** ✅ 14 / 14 borrow tests pass · 71 / 71 total (auth + inventory + availability + borrow) · verified against live PostgreSQL 16, and end-to-end over real HTTP
**Rules covered:** BORROW-01 through BORROW-25

---

## What this feature does

Both intake paths from BORROW-07, handled in one pass as requested:

- **Platform path** — a student submits a same-day request; a Coordinator reviews the queue, approves or rejects (with reason, 30-minute resubmit cooldown), then lends by selecting the physical article(s) to hand out.
- **Walk-in path** — a Coordinator lends directly to an unregistered guest, no prior request. (A "walk-in for a *registered* student" path was originally built and then removed — see below.)
- **Return processing** — three modes per BORROW-22: **scan** (health-check score → condition label, reusing Feature 4's scoring model), **manual** (direct Good/Worn/Damaged pick), or **dismiss** (skip the check; the article returns to available stock but its condition is left unverified, and a lingering warning notification is raised for staff).
- **Late tracking** — a return after the agreed time is `COMPLETED_LATE`; the Coordinator gets an in-app notification, the student gets an email (per your instruction — no in-app notification for students yet, that's Feature 8's inbox UI).
- **Bad-sport flag** — informational only, per BORROW-19 ("no automatic punitive action"). After a student's 3rd late return, staff get a notification. Nothing is blocked; it's visibility, not enforcement.
- **Overdue detection** — an `ACTIVE` transaction past its agreed return time flips to `OVERDUE` and notifies staff, checked opportunistically on every queue/active-borrows read and by a 5-minute background poll.

---

## Two real design corrections made while building this

**1. Role permissions.** I initially let both Super Admin and Coordinator approve/lend/return. The database triggers (`fn_borrow_decider_guard`, `fn_lent_by_guard`) correctly restrict this to **Coordinator only**, per BORROW-07. My router was wrong; the DB was right. Fixed the router to match, and gave the test suite a real Coordinator account (via the Feature 1 invite flow) instead of the seeded Super Admin.

**2. A path that shouldn't exist.** I built a "walk-in lending to a registered student" endpoint. The schema's `ck_path_walkin` constraint — and your Business Rules document's own actor table, which defines "Walk-in" as strictly the **unregistered** case — both say this path is invalid. A registered student always goes through the platform request→approve→lend flow; there is no "walk-in but registered" scenario. Removed the endpoint, service function, validator, and its test entirely, rather than working around the constraint.

**3. Reputation depends on Usage History, which didn't exist yet.** `v_client_reputation` (built in an earlier session) reads from the `usage_history` table — Feature 10's table, not yet built in the codebase. Rather than read reputation from `borrow_transaction` directly (which would contradict HIST-15/16's requirement that analytics derive solely from the immutable Usage History record), I pulled forward the minimal, HIST-compliant write: on every terminal return, a `usage_history` row is inserted matching the transaction's actual outcome, borrower, and equipment type exactly — the same coherence guards from the schema-testing rounds enforce this can't drift from the source. Feature 10 will build the full history *browsing* UI later; this is just the write path reputation needs now.

---

## Tests (14 / 14)

| ID | Rule | Proves | Result |
|---|---|---|---|
| T-601 | — | Student submits a request; appears in the Coordinator queue | ✅ |
| T-602 | BORROW-14 | Cannot request equipment with zero available units | ✅ |
| T-603 | BORROW-01 | Cross-day request window rejected | ✅ |
| T-604 | BORROW-07 | Approve then lend against the request; article goes `ON_LOAN` | ✅ |
| T-605 | BORROW-02 | A student with an active borrow can't start a second one | ✅ |
| T-606 | BORROW-13 | Resubmitting within 30 minutes of a rejection is blocked | ✅ |
| T-607 | — | A student cannot approve any request (role guard) | ✅ |
| T-608 | BORROW-25 | Two guest transactions with the same ID number are independent | ✅ |
| T-610 | BORROW-22 | Scan mode, high score → `GOOD`, article `AVAILABLE`, txn `COMPLETED` | ✅ |
| T-611 | BORROW-22/23 | Manual `DAMAGED` raises a damage flag, txn `COMPLETED_DAMAGED` | ✅ |
| T-612 | BORROW-22 | Dismiss mode: article returns `AVAILABLE`, condition untouched, staff warned | ✅ |
| T-613 | BORROW-18/19 | Late return is `COMPLETED_LATE`; both Coordinator (in-app) and student (email) notified | ✅ |
| T-614 | BORROW-19 | 3rd late return flags `BAD_SPORT_FLAGGED` for staff; nothing is blocked | ✅ |
| T-615 | BORROW-18 | An `ACTIVE` transaction past its due time auto-flips to `OVERDUE` | ✅ |

Run: `cd server && TEST_DATABASE_URL=... npx vitest run borrow`

---

## Verified end-to-end (live server, real HTTP, not the test framework)

Full lifecycle over `curl` against a running server with a fresh database: invite a Coordinator → create equipment → register and verify a student → submit a request → Coordinator sees it in the queue → approve → lend → **live availability drops to 0** → process the return (scan mode) → **reputation correctly shows the completed borrow** → **availability restores to 1**. Every step's actual HTTP response captured, not assumed.

---

## Frontend

- **My Borrows** (`/my-borrows`, Student) — submit a same-day request; track status and rejection reasons.
- **Borrow Queue** (`/borrow-queue`, Coordinator) — review pending requests, approve→select articles→hand out, reject with a reason, plus a walk-in guest lending form.
- **Active Borrows** (`/active-borrows`, Coordinator + Super Admin) — see everything currently out, process a return with the scan/manual/dismiss choice.

All reachable from the signed-in home screen, role-appropriately.

---

## Not in this feature (by design)

- **Usage History browsing/filtering UI** (Feature 10) — only the write path needed for reputation is here.
- **Student-facing in-app notifications** (Feature 8's inbox) — explicitly deferred per your instruction; the student gets email for late returns, not yet an in-app row rendered anywhere.
- **CV-based automatic scanning** (V2) — return condition checks are entered manually, same as Feature 4.
