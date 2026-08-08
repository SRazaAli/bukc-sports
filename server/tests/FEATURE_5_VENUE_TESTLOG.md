# Feature 5 — Venue Booking & Conflict Detection · Test Log

**Status:** ✅ 12 / 12 venue tests pass · 83 / 83 total (all five features) · verified against live PostgreSQL 16, and end-to-end over real HTTP
**Scope:** single-session bookings, full conflict detection, and the complete Coordinator→Super Admin approval pipeline — per the agreed first pass. Multi-session tournaments, academic calendar events, and event equipment allocation are the deferred fast-follow.
**Rules covered:** VENUE-01 through VENUE-27 (single-session subset), CONF-01 through CONF-16

---

## What this feature does

- **Submission** — a Student or External user requests a venue, date/time window, purpose, team, and participant count. A preliminary overlap check runs immediately (CONF-09); a genuinely conflicting request is rejected at submission rather than left to fail later.
- **Coordinator review** — sees the pending queue, forwards feasible requests to the Super Admin with an optional note, or rejects directly with a reason (VENUE-12).
- **Super Admin decision** — approves (which is the moment a real calendar slot is created — see below), rejects, or **returns the booking to the Coordinator for re-evaluation** (VENUE-22), which is a distinct action from rejection, tracked in the `approval_action` audit table.
- **Conflict detection** — the database's own exclusion constraint is the single authoritative gate (CONF-08). The preliminary check at submission is a courtesy early-warning; it is not what actually prevents double-booking.
- **Calendar** — read-only, all roles, shows only approved sessions (CAL-01), reusing the `v_calendar` view built during the original schema work.

---

## The central architectural question, and how it was resolved

The schema is deliberately built so a `booking_session` row can only exist as `SCHEDULED` once its parent booking is already `APPROVED` (`fn_session_parent_guard`) — that is what makes CAL-01/CAL-02 true: the calendar can never show a pending or unresolved slot. But a student's *request* still needs to carry a proposed date/time before any approval happens.

**Resolution:** for this single-session pass, the requested window lives directly on `booking` (`requested_start_at`, `requested_end_at`, `team_name`, `participant_details` — migration `008`). The Super Admin's **approval** is the exact moment that data gets materialized into a real `booking_session` (+ `session_participant`) row — which is also, not coincidentally, the moment the exclusion constraint gives its final word. Multi-session tournaments will need a richer structure (a JSON list or a dedicated pre-approval table) in the fast-follow pass, since one row per booking isn't enough once a booking can propose several dates at once.

---

## Two real bugs found and fixed, not routed around

**1. Insert ordering inside the approval transaction.** I initially inserted the `booking_session` row *before* updating `booking.status` to `APPROVED` — but `fn_session_parent_guard` requires the parent already be `APPROVED` at that exact moment. The fix was a straightforward reorder within the same transaction (update status first, insert session second), still fully atomic.

**2. `decided_by`/`decided_at` are Super-Admin-only fields by trigger design.** `fn_booking_authority_guard` requires that whenever those two columns are set, the actor must be a Super Admin — full stop, regardless of the booking's status. But VENUE-12 explicitly allows a **Coordinator** to reject a request directly at the PENDING stage, before it ever reaches a Super Admin. My first version tried to set `decided_by` for a Coordinator's rejection and the DB correctly refused it. The fix: a Coordinator's PENDING-stage rejection leaves `decided_by`/`decided_at` null and relies on the `approval_action` audit row (`verb='REJECT'`, `actor_id=coordinator`) as the record of who acted — which is precisely what that audit table exists for. `decided_by` on the `booking` row itself is reserved for the Super Admin's final word.

---

## Tests (12 / 12)

| ID | Rule | Proves | Result |
|---|---|---|---|
| T-701 | — | Student submits a booking; appears in Coordinator queue | ✅ |
| T-702 | CONF-09 | Preliminary conflict against an existing approved session rejected at submission | ✅ |
| T-703 | VENUE-07 | A requester with an active (PENDING) request can't submit a second one | ✅ |
| T-704 | — | End time before start time rejected | ✅ |
| T-705 | VENUE-13..19 | Full path: forward → approve → calendar reflects the session | ✅ |
| T-706 | APPR-07/VENUE-19 | A Coordinator cannot approve — Super Admin only | ✅ |
| T-707 | — | A student cannot forward or approve (role guard) | ✅ |
| T-708 | VENUE-22 | Super Admin returns a booking for re-evaluation; it goes back to PENDING | ✅ |
| T-709 | VENUE-12 | Coordinator rejects at PENDING with a reason; requester notified | ✅ |
| T-710 | CONF-02/03 | A partial time overlap is treated as a full conflict | ✅ |
| T-711 | CONF-06 | Different venues never contend, even at the exact same time | ✅ |
| **T-712** | **CONF-08/15** | **The core guarantee**: two FORWARDED bookings racing for the same slot — the first approval succeeds, the second is rejected automatically with `SLOT_CONFLICT`, and its status is set to `REJECTED` (not left dangling) | ✅ |

Run: `cd server && TEST_DATABASE_URL=... npx vitest run venue`

---

## Verified end-to-end (live server, real HTTP, not the test framework)

Full pipeline over `curl` against a running server with a fresh database: invite a Coordinator → create a venue → register and verify a student → submit a booking → Coordinator sees it and forwards → Super Admin sees it in their queue and approves → **the calendar shows the new `SCHEDULED` session** → a second overlapping request from the same student is rejected at submission.

One honest detail from that run, worth recording plainly: the second request was rejected with `PRELIMINARY_CONFLICT` rather than `ACTIVE_REQUEST`, because the app-layer "you already have an active request" pre-check only looks at `PENDING`/`FORWARDED` status, not an `APPROVED` booking still holding a future slot. This isn't a gap in enforcement — the database's `uq_one_active_booking` index (built during the original schema work, scoped by `holds_future_slot`) is the true authoritative backstop for VENUE-07 and would have caught it regardless — but it means the app-layer pre-check is a convenience shortcut, not the actual guarantee. Worth tightening in the fast-follow pass for a more precise error message; not a correctness issue today.

---

## Frontend

- **Book a Venue** (`/book-venue`, Student + External) — submit a request, track status and rejection reasons.
- **Venue Queue** (`/venue-queue`, Coordinator) — review, forward with a feasibility note, or reject with a reason.
- **Venue Approvals** (`/venue-approvals`, Super Admin) — approve, reject, or return for re-evaluation; also basic venue management (add venues), since something has to create the rows this feature depends on.
- **Calendar** (`/calendar`, all roles) — read-only, approved sessions only.

All reachable from the signed-in home screen, role-appropriately.

---

## Not in this feature (by design — the agreed second pass)

- **Multi-session bookings** (tournaments, up to 30 sessions per VENUE-35) — needs a richer pre-approval data structure than the single-row fields added here.
- **Academic calendar events** (VENUE-28/29) — recurring annual events via the same pipeline with a fixed internal client reference.
- **Equipment allocation for events** (VENUE-13's inline allocation, the T-24hr lock rules EQUIP-AVAIL-11–21) — this is the piece that will finally exercise Feature 2's forward-wired `NOTIFY` trigger on `event_equipment_allocation`.
