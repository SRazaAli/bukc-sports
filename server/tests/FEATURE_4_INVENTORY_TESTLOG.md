# Feature 4 — Inventory Tracking · Test Log

**Status:** ✅ 16 / 16 inventory tests pass · 46 / 46 total (auth + inventory) · verified against live PostgreSQL 16
**Rules covered:** INV-02 … INV-24 (the MVP inventory surface)

---

## 1. What this feature does

Staff (Super Admin + Coordinator) manage the equipment inventory:

- **Equipment types** — create a type (sport, name, SINGLE/PAIR unit, low-stock threshold, max borrow duration, condition score bands); update thresholds later (INV-06).
- **Articles** — add one at a time by barcode with an entry health score (INV-02/03/04). A SINGLE-unit article enters `AVAILABLE`; a PAIR-unit article enters `UNPAIRED` (not lendable until paired, INV-08). A low entry score enters `DAMAGED`.
- **Health checks** — record scheduled/ad-hoc scans (INV-17). A scan in the DAMAGED band auto-raises a system damage flag and sets the article `DAMAGED` (INV-18).
- **Damage flags** — list open flags; clear a flag with an updated condition, returning the article to `AVAILABLE` (INV-20).
- **Pairs** — form a pair from two same-type `UNPAIRED` articles (INV-07/08); dissolve it, returning both to `UNPAIRED` (INV-09).
- **Decommission** — terminal; a decommissioned article leaves stock and cannot be revived (INV-23/24).
- **Availability** — live per-type available count with AVAILABLE / LOW_STOCK / CHECKED_OUT badges (INV-13).

The database owns the hard invariants (barcode immutable INV-05, same-type pairs INV-07, one-live-pair INV-08, decommission terminal INV-24, staff-only, scan auto-applies condition). The service orchestrates the multi-step operations; the API layer enforces staff-only again (defense in depth).

---

## 2. Endpoints

| Method | Path | Role | Rule |
|---|---|---|---|
| GET | `/api/inventory/sport-categories` | any auth | — |
| GET | `/api/inventory/types` | any auth | — |
| POST | `/api/inventory/types` | staff | INV-06 |
| PATCH | `/api/inventory/types/:id/thresholds` | staff | INV-06 |
| GET | `/api/inventory/status` | any auth | INV-13 |
| GET | `/api/inventory/articles` | staff | INV-27 |
| POST | `/api/inventory/articles` | staff | INV-02/03/04 |
| GET | `/api/inventory/articles/:id` | staff | INV-25/27 |
| POST | `/api/inventory/articles/:id/decommission` | staff | INV-23/24 |
| POST | `/api/inventory/articles/:id/scan` | staff | INV-17/18 |
| POST | `/api/inventory/articles/:id/condition` | staff | INV-19 |
| GET | `/api/inventory/damage-flags` | staff | INV-21 |
| POST | `/api/inventory/damage-flags/:id/clear` | staff | INV-20 |
| POST | `/api/inventory/pairs` | staff | INV-07/08 |
| POST | `/api/inventory/pairs/:id/dissolve` | staff | INV-09 |

---

## 3. Test results (16 / 16)

| ID | Rule | What it proves | Result |
|---|---|---|---|
| T-401 | INV-06 | Creates an equipment type | ✅ |
| T-402 | — | Rejects GOOD threshold ≤ WORN threshold | ✅ |
| T-403 | INV-06 | Updates thresholds after creation | ✅ |
| T-404 | INV-04 | SINGLE article enters AVAILABLE + GOOD from a high score; baseline ENTRY scan exists | ✅ |
| T-405 | INV-08 | PAIR article enters UNPAIRED | ✅ |
| T-406 | INV-04 | Low entry score → DAMAGED article | ✅ |
| T-407 | INV-05 | Duplicate barcode rejected | ✅ |
| T-408 | INV-18 | DAMAGED-range scan raises a system flag and DAMAGES the article | ✅ |
| T-409 | INV-20 | Clearing a flag returns the article to AVAILABLE with a new label | ✅ |
| T-410 | INV-07/08 | Forming a pair makes both AVAILABLE | ✅ |
| T-411 | INV-07 | Cannot pair different types | ✅ |
| T-412 | — | Cannot pair an article with itself | ✅ |
| T-413 | INV-09 | Dissolving a pair returns both to UNPAIRED | ✅ |
| T-414 | INV-23/24 | Decommission is terminal; second attempt 404s | ✅ |
| T-415 | INV-13 | Availability reflects stock + LOW_STOCK badge | ✅ |
| T-416 | — | A STUDENT cannot create equipment types (403) | ✅ |

Run: `cd server && TEST_DATABASE_URL=... npx vitest run inventory`

---

## 4. Bugs found & fixed during this build

- **`ck_pair_canonical`** — the schema requires `article_a_id < article_b_id`. `formPair` now orders the two IDs canonically before inserting (the DB rejected unordered pairs).
- **camelCase response shapes** — type/pair creation returned snake_case DB rows; the API now returns `equipmentTypeId` / `pairId`.
- **PG `count()` is a string** — the availability view's `available_units` came back as a string; coerced to a number in the service.
- **Zod `.refine` errors returned 500** — the validator error wasn't an `AppError`; the parse helper now throws `badRequest` so it maps to 400.
- **Duplicate-key message** — a unique violation always said "barcode"; now checks the constraint name and reports generically for type-name collisions.

All caught by running against a real database, not by review.

---

## 5. Frontend

Staff-only **Inventory console** at `/inventory` (linked from Home for Super Admin + Coordinator), three tabs:
- **Equipment** — types table with live availability badges; add a type.
- **Articles** — add articles (with entry scan), filter by type, scan, decommission, and form pairs from unpaired articles.
- **Damage Flags** — open flags with review-and-clear.

Client typechecks and builds clean.

---

## 6. Not in this feature (by design)

- **Weekly scheduled health-check alerts** (INV-15/29) and **overdue-scan alerts** are notification concerns — Feature 8.
- **CV-based scans** (`source = CV_MODEL`) are V2; MVP scans are `MANUAL`.
- **Event-lock availability** subtraction is wired in the view but exercised by the venue/booking features (5/6).

---

## Update — design & logic fixes (post-review)

Following review, several issues were fixed and the Feature 4 business rules (INV-01…INV-30) were re-checked against every change.

### Changes

| Area | Change | Schema impact |
|---|---|---|
| Equipment type form | Added **Indoor/Outdoor** (per type, not per sport — an attribute, not a parallel category tree), **Image URL** | Migration `005`: `equipment_type.is_indoor`, `equipment_type.image_url` |
| Low-stock threshold | Defaults to **5**; the "stuck zero" bug fixed — the field is a free-text-then-validated number, fully clearable | none |
| Max borrow duration | **Kept** (INV-06 requires it); form now uses an **Hours + Minutes** selector instead of raw minutes, converted to minutes on submit | none |
| Barcode | **Length-validated**: 6–48 chars, alphanumeric + hyphen (standard Code-128/EAN practice) | Migration `005`: `ck_article_barcode_length` CHECK |
| Pair entry | Pair-type articles are now entered **as a pair in one action** (`POST /articles/pair`) — both barcodes + scores together, stored already paired if both are clean. The old single-entry endpoint now **rejects** PAIR-type equipment. Standalone pairing (`POST /pairs`) is reserved for **re-pairing after a dissolution** (INV-09/30), relabeled "Re-pair Articles" in the UI. | none |
| Display | `DAMAGED` **state** now shows as **"Unavailable"** in the UI (was redundant against `DAMAGED` condition). The DB enum is unchanged — only the display label. | none |
| Filters | Articles list gained a **Condition** filter alongside Type and State | none |
| Damage flags | Now also raised when an article is **entered already damaged** (score or would-be manual damage), not only on later scans — closing the original gap where intake-damaged items were invisible to the damage queue | none |
| Pair display | Paired articles show as **one grouped row** ("Pair · BR-A0001 + BR-B0001") rather than two separate rows | none |

### New/changed tests (50 / 50 total)

- T-405 — single-entry now correctly **rejects** a PAIR-lending type
- T-405b — pair entry stores two articles pre-paired and AVAILABLE
- T-405c — a damaged half at pair entry stays unlinked (state DAMAGED, not paired)
- T-405d — barcode under 6 characters rejected
- T-410–T-413b — rewritten around the real INV-09/30 flow: pair-enter → dissolve → re-pair, plus a dedicated unpaired-articles listing test

### Verified end-to-end (live API)

New equipment type with indoor flag + image + hr/min duration → pair entered in one action (both AVAILABLE, grouped) → short barcode rejected (400) → single-add rejected for a PAIR type → a SINGLE-type article entered damaged automatically raises a damage flag → articles list carries pair-grouping data.
