# Feature 5 (Third Pass) — Event Equipment Allocation · Test Log

**Status:** ✅ 11 / 11 equipment allocation tests pass · 99 / 99 total (all features) · verified against live PostgreSQL 16, and end-to-end over real HTTP
**Scope:** completes Feature 5 entirely. Coordinator equipment planning, the shortfall confirmation round-trip (same `booking_id` throughout, per explicit product decision), atomic materialization at approval, the T-24hr lock with its silence-is-confirmation behavior, article swaps, and post-event release.
**Rules covered:** VENUE-13, VENUE-15, VENUE-16, VENUE-17, VENUE-32, VENUE-33, EQUIP-AVAIL-11 through EQUIP-AVAIL-21, APPR-06

---

## What this feature does

- **Planning (VENUE-13)** — the Coordinator allocates equipment per session while a booking is still `PENDING`, checked against live availability.
- **Shortfall (VENUE-15/16/17)** — if a plan exceeds what's available, the booking moves to a new `SHORTFALL_PENDING` status and the requester gets an email asking whether they can supply the equipment themselves. **The same booking_id carries the whole round-trip** — confirming returns it to `PENDING` for the Coordinator to forward as normal; declining rejects it. No second booking is ever created, exactly as specified.
- **Materialization at approval** — every planned line becomes a real `event_equipment_allocation` row in the same atomic transaction as the sessions themselves.
- **T-24hr lock (EQUIP-AVAIL-11/12/13/19)** — a background poll (same pattern as Feature 3's overdue-borrow check) locks allocations as their session's 24-hour boundary arrives. If there's enough stock, nothing happens — silence is confirmation. If there isn't, the Coordinator gets an alert.
- **Swaps (EQUIP-AVAIL-14/15)** — the Coordinator can swap a locked allocation's article for an available one; reuses the `article_swap` table and its integrity constraints, which were built and tested in the original schema rounds but never had an API wired to them until now.
- **Post-event release (EQUIP-AVAIL-18/20, VENUE-32/33)** — once a session ends, its equipment releases automatically, the Coordinator gets a review notification, and the parent booking completes once every one of its sessions has.

---

## Two real defects found and fixed while building this

**1. My own planning-stage stock guard was backwards.** I initially wrote a trigger that *blocked* a Coordinator from planning more equipment than is currently available. That's exactly the shortfall scenario this feature exists to handle — the guard would have made the feature impossible to use as designed. Removed it; shortfall detection belongs in the service layer, which compares against live availability and routes to the confirmation workflow rather than rejecting outright.

**2. `fn_allocation_stock_guard` (built in an earlier session) didn't exempt self-managed lines.** The existing trigger on the real `event_equipment_allocation` table checked every row against our own physical stock — including lines the client had explicitly agreed to bring themselves. A self-managed quantity of 5 against our 1 unit of actual stock would have been incorrectly blocked at the exact moment of approval. Patched the trigger to skip the check when `is_self_managed = true`, and proved it live: the E2E walkthrough below shows a quantity of 5 materializing successfully against a type with only 1 unit in stock, specifically because it's self-managed.

**3. A genuine, correctly-caught bug in the decline path.** My first version of `confirmShortfall`'s decline branch attributed the resulting `REJECT` action to the declining student. The pre-existing `fn_approval_actor_guard` trigger (APPR-06: only Coordinator or Super Admin may REJECT) correctly refused this — a student declining isn't a staff review decision. Fixed by using the trigger's own `actor_id IS NULL` exemption, which exists precisely for system-driven state changes like this one; the requester's identity is preserved in the action's note instead.

---

## Tests (11 / 11)

| ID | Rule | Proves | Result |
|---|---|---|---|
| T-801 | VENUE-13 | Planning within available stock — no shortfall, booking stays `PENDING` | ✅ |
| T-802 | VENUE-15 | Planning beyond stock — shortfall detected, `SHORTFALL_PENDING`, requester notified | ✅ |
| T-803 | VENUE-16 | Requester confirms self-managing — **same booking_id**, returns to `PENDING` | ✅ |
| T-804 | VENUE-17 | Requester declines — **same booking_id**, `REJECTED` | ✅ |
| T-805 | VENUE-13 | Approval materializes a real allocation matching the plan exactly | ✅ |
| T-806 | VENUE-16 | A self-managed line materializes despite exceeding our own stock, and is excluded from the stock guard | ✅ |
| T-807 | EQUIP-AVAIL-19 | A due, sufficiently-stocked allocation locks **silently** — no alert | ✅ |
| T-808 | EQUIP-AVAIL-13 | A due, understocked allocation locks **and** alerts the Coordinator | ✅ |
| T-809 | EQUIP-AVAIL-14/15 | A swap is recorded and the Super Admin is automatically notified | ✅ |
| T-810 | EQUIP-AVAIL-14 | Swapping in an unavailable article is rejected (the original schema-round DB guard, now exercised through a real endpoint for the first time) | ✅ |
| T-811 | EQUIP-AVAIL-18/20, VENUE-32/33 | An ended session releases its equipment, notifies the Coordinator, and completes the parent booking once every session has | ✅ |

Run: `cd server && TEST_DATABASE_URL=... npx vitest run equipment-allocation`

---

## Verified end-to-end (live server, real HTTP, not the test framework)

Full shortfall round-trip over `curl` against a running server with a fresh database, migration `010` applying cleanly on boot: student submits a booking → Coordinator plans 5 units against an equipment type with **only 1 in stock** → shortfall detected and flagged → student sees `SHORTFALL_PENDING` and confirms self-managing → **the same booking_id** returns to `PENDING` → Coordinator forwards → Super Admin approves → the materialized allocation shows quantity 5, `is_self_managed: true` — correctly bypassing our own 1-unit stock limit because the client is bringing their own equipment, exactly as specified.

---

## Frontend

- **Venue Queue** (Coordinator) — equipment planning panel added to the booking review flow: add equipment-type lines with quantities per session, submit the plan, see shortfall results inline.
- **My Bookings** (Student/External) — a `SHORTFALL_PENDING` booking shows inline confirm/decline actions.
- **Equipment Alerts** (Coordinator, new screen `/equipment-alerts`) — lists allocations that locked with insufficient stock and lets the Coordinator swap in an available article. Reading this screen also opportunistically runs the lock-check and post-event-release polls server-side, so it's never more stale than the last page load — the same pattern used elsewhere in this codebase for background-job freshness.

All reachable from the signed-in home screen for the Coordinator role.

---

## Not in this feature

Feature 5 is now complete across all three passes (single-session, multi-session + academic events, equipment allocation). Nothing deferred within venue booking itself. The next natural dependency this unblocks is Feature 6 (Calendar) surfacing equipment-lock status inline, and Feature 8 (Notifications) giving all these alert/notification types an in-app inbox — both already have their data model in place from this and earlier passes.
