# Feature 2 — Equipment Availability Checker · Test Log

**Status:** ✅ 7 / 7 availability tests pass · 57 / 57 total (auth + inventory + availability) · verified against live PostgreSQL 16, with a real SSE push proven over live HTTP (not just the test harness)
**Rules covered:** EQUIP-AVAIL-01 through EQUIP-AVAIL-10 (the event-lock rules, EQUIP-AVAIL-11–21, activate automatically once Feature 5 populates `event_equipment_allocation` — the schema, view, and NOTIFY trigger are already wired for it)

---

## What this feature does

A read-only, real-time equipment status checker open to every authenticated role:

- **Live status** — available units + a status badge (Available / Low Stock / Checked Out) per equipment type, computed from the same math the staff Inventory console uses, so the two views never disagree.
- **Real-time push (EQUIP-AVAIL-07)** — Server-Sent Events. Any change to an article (added, scanned, decommissioned, paired/dissolved) or an event equipment lock pushes a fresh snapshot to every open connection within moments, no polling, no refresh.
- **Role-aware fields (EQUIP-AVAIL-05)** — Super Admin and Coordinator additionally see total stock; Students and External users see only the available count and badge.
- **Filters (EQUIP-AVAIL-08)** — by sport category and indoor/outdoor.
- **Read-only (EQUIP-AVAIL-09)** — no borrow action here; that's Feature 3.
- **Decommissioned articles excluded (EQUIP-AVAIL-10)** automatically, via the same view Feature 4 already established.

---

## Architecture

- **Migration `006`** — a `pg_notify('equipment_availability', equipment_type_id)` trigger on `article` and on `event_equipment_allocation`. The allocation trigger is added now even though nothing writes to that table yet (Feature 5 doesn't exist), so venue-booking locks will push live updates the moment that feature lands — no further work needed there.
- **`server/src/lib/sse.ts`** — a dedicated `pg.Client` (deliberately *not* from the Kysely pool, which would silently drop a `LISTEN`) holds the subscription for the process lifetime. On every notification it re-queries the full status list and pushes the correctly-shaped snapshot to each connected client based on their role.
- **`GET /api/availability/status`** — plain JSON, any authenticated role, filterable.
- **`GET /api/availability/stream`** — the SSE endpoint. Token travels as a query parameter rather than an `Authorization` header, because the browser's native `EventSource` cannot set custom headers — this is the one endpoint where that's true, and it's documented in the code as such.

## A real bug found and fixed here

Testing this feature surfaced two genuine issues, not test artifacts:

1. **A registration race in the SSE handler itself.** The server wrote the initial snapshot to the response *before* registering the connection in the broadcast map. In principle a client could observe that first byte before the server had finished subscribing it — closed by registering the client first, writing second.
2. **Idle-connection staleness on the dedicated LISTEN connection under sustained load.** After many minutes of continuous database activity, the long-lived `LISTEN` connection could stop reliably receiving notifications until it was given a fresh round-trip. This is the same class of risk a production deployment faces from cloud database proxies or NAT gateways that quietly degrade idle connections — not just a quirk of the test run. Fixed with an active keepalive (a `SELECT 1` every 15 seconds) and reconnect-on-`end` in addition to reconnect-on-`error`, since a dead connection doesn't always announce itself with an error event.

Chasing this took real diagnostic work — isolating the raw NOTIFY/LISTEN mechanism with a standalone script (worked), proving the connection was genuinely registered via `pg_stat_activity` at the moment of failure (it was), and testing the keepalive fix across 7+ consecutive full-suite runs before trusting it.

---

## Tests (7 / 7)

| ID | Rule | Proves | Result |
|---|---|---|---|
| T-501 | EQUIP-AVAIL-01 | Any authenticated role (tested with a student) can view availability | ✅ |
| T-502 | EQUIP-AVAIL-05 | Staff sees `totalStock`; a student's response omits it entirely | ✅ |
| T-503 | EQUIP-AVAIL-03 | Available count and status badge shown together; badge matches the low-stock threshold | ✅ |
| T-504 | EQUIP-AVAIL-08 | Filters correctly by sport category and indoor/outdoor | ✅ |
| T-505 | EQUIP-AVAIL-10 | A decommissioned article drops out of the available count | ✅ |
| T-506 | — | Unauthenticated request is refused (401) | ✅ |
| T-507 | EQUIP-AVAIL-07 | A real database mutation triggers a real SSE push, received over a live HTTP connection, with the updated count | ✅ |

Run: `cd server && TEST_DATABASE_URL=... npx vitest run availability`

---

## Verified end-to-end (live server, real `curl`, not the test framework)

- Opened a real SSE connection with `curl -N`, mutated the database from a second terminal, and captured **two** snapshot events on the stream — the initial one, and a second one pushed automatically after the mutation, showing the updated `availableUnits`.
- Confirmed the role split live: the Super Admin's JSON response includes `totalStock`; a freshly registered and verified student's response for the identical equipment type does not contain that key at all.

---

## Frontend

**Equipment Availability** screen (`/availability`, all roles) — a live-updating card grid per equipment type, each showing an image (or an initial-letter placeholder), sport, indoor/outdoor, lending unit, the available count, and a colored status badge. A "Live" indicator confirms the SSE connection is active. Filters for sport category and indoor/outdoor. Staff additionally see "X available of Y total". No borrow action anywhere on this screen, per EQUIP-AVAIL-09.

Reachable from the signed-in home screen ("Equipment Availability" button, shown to every role) and from the Inventory console for staff.

---

## Not in this feature (by design)

- **Event equipment locking (EQUIP-AVAIL-11–21)** — T-24hr locks, article swaps, Coordinator alerts. The schema (`event_equipment_allocation`), the availability math (already subtracting locked units in `v_article_availability`), and the NOTIFY trigger are all in place. There's simply nothing to lock until Feature 5 (venue booking) exists and starts writing to that table — at which point this feature requires no changes to reflect it live.
- **Borrowing** (Feature 3) — this checker is read-only by design (EQUIP-AVAIL-09).
