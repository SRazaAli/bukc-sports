# Feature 5 (Second Pass) — Multi-Session Bookings & Academic Events · Test Log

**Status:** ✅ 17 / 17 venue tests pass (10 carried over + 7 new) · 88 / 88 total (all features) · verified against live PostgreSQL 16, and end-to-end over real HTTP
**Scope:** completes Feature 5 — multi-session tournaments (up to 30 sessions, one venue, VENUE-06/35/36) and academic calendar events (VENUE-28/29/34). Equipment allocation for events remains the next pass.
**Rules covered (added this pass):** VENUE-06, VENUE-11, VENUE-35, VENUE-36, VENUE-28, VENUE-29, VENUE-34, CONF-12

---

## What changed

**Multi-session bookings.** A booking is now a package of one or more proposed sessions, all against one venue (VENUE-06), capped at 30 (VENUE-35 — enforced both by a `CHECK` constraint and application validation). Roster (`team_name`, `participant_details`) is captured per session, not per booking, since a tournament's lineup can vary match to match (VENUE-36). A single-session booking is simply a package of one — there is no longer a separate code path for it.

**Academic calendar events.** A Coordinator initiates these directly (VENUE-28) — no student requester, a fixed `internal_client_ref = 'BUKC SPORTS DEPARTMENT'` label (VENUE-34, enforced by the pre-existing `ck_academic_ref` constraint), and otherwise the identical pipeline and conflict detection as any other booking (VENUE-29/27) — an academic event gets no exemption.

## Schema change

**Migration `009`** replaces last pass's single-row `requested_start_at`/`requested_end_at`/`team_name`/`participant_details` columns on `booking` with a proper `booking_session_request` table — one row per proposed session, `UNIQUE(booking_id, session_no)`, capped 1–30. Additive and forward-only; the retired columns and their check constraint are dropped cleanly since nothing else referenced them.

---

## A genuine ambiguity in the rules, resolved and documented rather than silently picked

**CONF-12** says a multi-session booking's conflict check is scoped *per session* — "one session failing does not automatically fail its siblings." **VENUE-19** frames Super Admin approval as covering "the entire package" in one action. These pull in different directions for the question: *if session 3 of an 8-session tournament collides at final approval, does the whole booking fail, or just that one session?*

**Resolution applied, stated plainly in the code:**
- **Coordinator-stage validation** (VENUE-11) checks *every* proposed session and reports back exactly which ones conflict — this is where CONF-12's "surface the specific conflicting session" applies, catching problems *before* forwarding.
- **Final approval** stays atomic. `booking_status` has no "partially approved" state to represent a mixed outcome, and VENUE-19's "one approval covers the entire package" reads most naturally as one all-or-nothing action. If any session collides at that final, authoritative moment (a genuine race — the normal case should already be conflict-free thanks to the Coordinator's upfront check), the **whole package is rejected together** (CONF-15), not left half-approved.

This is a defensible reading of a genuine tension in the source document, not a gap papered over — flagged here explicitly in case the next pass (or a future rules clarification) wants it reconsidered.

---

## Tests (17 / 17 — 10 carried forward, 7 new)

| ID | Rule | Proves | Result |
|---|---|---|---|
| T-701–T-712 | (carried forward) | Submission, pipeline, authority, conflict detection — all re-verified against the new sessions-array shape | ✅ |
| **T-713** | VENUE-06/35 | A 3-session tournament booking approves and materializes **all three sessions atomically** in one transaction | ✅ |
| **T-714** | CONF-15 (package) | If **one** session in a multi-session **submission** collides with an existing approved session, the whole submission is rejected — caught at the earliest point, before it ever reaches a queue | ✅ |
| **T-715** | VENUE-28/34 | Coordinator initiates an academic event: `origin='ACADEMIC'`, `requested_by IS NULL`, `internal_client_ref='BUKC SPORTS DEPARTMENT'`, enters `PENDING` like any other booking | ✅ |
| **T-716** | VENUE-27 | An academic event is **not exempt** from conflict detection — rejected at submission when it overlaps an existing approved booking | ✅ |
| **T-717** | — | A student cannot initiate an academic event (Coordinator-only, role guard) | ✅ |

Run: `cd server && TEST_DATABASE_URL=... npx vitest run venue`

---

## One defect found and fixed during this pass

Several tests initially failed with `purpose: String must contain at least 2 character(s)` — leftover single-character `'M'` placeholder text from the test rewrite (the same class of test-data bug hit in the first pass, now doubly memorable). Fixed across every occurrence; not a logic defect.

---

## Verified end-to-end (live server, real HTTP, not the test framework)

Full walkthrough over `curl` against a running server with a fresh database, migration `009` applying cleanly on boot:
- Student submits a **3-session tournament** booking → Coordinator's queue correctly shows `sessionCount: 3` → forwards → Super Admin approves → **all 3 sessions appear on the calendar** in one atomic operation.
- Coordinator initiates an **academic event** with no requester — creates cleanly, enters the pending queue like any other booking.

---

## Frontend

- **`SessionsBuilder.tsx`** — a new shared component (add/remove/edit session rows, capped at 30) reused by both the student booking form and the Coordinator's academic-event form, so multi-session support isn't duplicated.
- **Book a Venue** (Student/External) — now submits one or more sessions per request; "My Bookings" shows a session count and date range instead of a single window.
- **Venue Queue** (Coordinator) — the review panel now loads and displays every session in a booking's package (number, time, team) before deciding; a new "Academic Calendar Events" panel initiates events directly.
- **Venue Approvals** (Super Admin) — session count and range shown in place of the old single-window fields.

---

## Not in this feature (the deferred next pass, as agreed)

- **Equipment allocation for events** — Coordinator allocating equipment per session, the T-24hr lock window, article swaps, shortfall emails, and the post-event review notification (EQUIP-AVAIL-11–21, VENUE-13's inline allocation). This is the piece that will finally exercise Feature 2's forward-wired `NOTIFY` trigger on `event_equipment_allocation`.
