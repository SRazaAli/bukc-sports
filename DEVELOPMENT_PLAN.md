# BUKC Sports Platform — Development Plan

**Stack:** PERN (PostgreSQL · Express · React · Node) · TypeScript both ends
**Schema:** `schema_v1_2.sql` (verified, 128/128 tests) — the source of truth
**Approach:** one feature at a time, backend-first, tested, then frontend, then next feature.

---

## 1. Locked decisions

| Area | Decision |
|---|---|
| Language | TypeScript, client and server |
| Auth | Access token in memory (short-lived JWT) + refresh token in HTTP-only cookie; bcrypt passwords |
| DB access | **Kysely** — typed query builder that does *not* own the schema, so it never fights our 41 triggers / exclusion constraint. Raw SQL where a query is trigger-adjacent. |
| Email | Resend (dev). Swap path documented for production (any SMTP/provider behind one interface). |
| Real-time | SSE + Postgres `LISTEN/NOTIFY` — built in MVP (Features 2, 3, 6, 8) |
| Migrations | Plain ordered `.sql` files run by a small runner — **not** an ORM migration engine, which would try to diff against and "fix" our triggers |
| Testing | (a) DB-level rule tests (port of the 128) + (b) API integration tests (Supertest vs test DB), rigorously. (c) Frontend component tests, lightly. |
| Local DB | `docker-compose.yml` with Postgres 16 + our extensions, so every teammate runs an identical database |
| Hosting | Web service + static frontend on **Render** (persistent SSE support); **database on Neon** (free tier does not self-delete, supports citext/btree_gist/pgcrypto). Code is `DATABASE_URL`-agnostic, so this is not locked in by any code. |

---

## 2. Why backend-first per feature

The schema is the source of truth and the hard correctness lives server-side (41 triggers, the exclusion constraint, the approval workflows). Building UI first means guessing the API shape and rebuilding when reality differs. So each feature flows:

```
schema slice (already done) -> API endpoints + validation -> API tests ->
frontend against the REAL working API -> frontend polish -> feature sign-off
```

The frontend is still where we iterate *visually* — it just sits on an endpoint that already passes tests.

---

## 3. Repository layout (monorepo)

```
bukc-sports/
  db/
    migrations/          ordered .sql files (schema split by domain)
    seed/                super admin, sport categories, system settings
    run-migrations.ts    tiny runner (no ORM engine)
    test-harness/        port of the 128-test suite, run in CI
  server/
    src/
      config/            env loading, typed config
      db/                Kysely instance + generated types
      middleware/        auth (JWT+role), error handler, request validation
      lib/               email (Resend behind an interface), sse hub, tokens
      features/
        auth/            router · service · validators · tests   <- Feature 1
        inventory/       ...                                       <- Feature 4
        ...              one folder per feature
      app.ts             express wiring
      server.ts          http + sse bootstrap
    tests/               integration tests (Supertest)
  client/
    src/
      lib/               api client, auth context, sse client
      components/        shared UI primitives
      features/          one folder per feature (screens + hooks)
      routes/            route tree, guards by role
      styles/            design tokens
  docker-compose.yml     local Postgres 16 + extensions
  .env.example
  README.md
```

---

## 4. Build order (dependency-respecting, demoable early)

| # | Feature | Depends on | Why here |
|---|---|---|---|
| 1 | **Auth & roles** | — | Everything needs a logged-in user with a role |
| 2 | **Inventory** (F4) | 1 | Nothing borrows without stock; articles, types, pairs, scans |
| 3 | **Equipment availability** (F2) | 2 | Read-only views + SSE over inventory |
| 4 | **Borrow & return** (F3) | 1,2 | The lending lifecycle |
| 5 | **Venue booking + conflict** (F5+F9) | 1 | Inseparable — the exclusion constraint |
| 6 | **Calendar** (F6) | 5 | Reads approved bookings + SSE |
| 7 | **Approval workflow** (F7) | 5 | Cross-cuts booking; unified queues |
| 8 | **Notifications** (F8) | all above | Cross-cuts; in-system + email |
| 9 | **Usage history** (F10) | 3,5 | Terminal states become immutable records |
| 10 | **Offline fallback** (F11) | 3,5 | Flags on existing tables |
| 11 | **Admin dashboard** (F12) | all | Views over everything |

*(Feature-1 mapping: F1=Auth, then the 11 features above cover all 12 MVP features; F9 conflict is folded into F5 since they share the constraint.)*

---

## 5. Definition of Done — per feature

A feature is not "done" until all of:

1. **Endpoints** implement every business rule in its BR section, validated at the boundary (Zod) *and* trusting the DB triggers as the final gate (defense in depth).
2. **Role enforcement** at the API layer mirrors the DB's role triggers — a request never reaches a query it isn't allowed to make.
3. **API integration tests** cover: happy path, every rejection the BR specifies, and the adversarial boundary cases we found in testing (e.g. "can't approve your own request").
4. **Frontend** implements the screens for each actor, against the real API, with loading/empty/error states written in the interface's voice.
5. **Feature test log** — a short markdown per feature listing each test case, its rule, and pass/fail — mirroring the ERD test report style.
6. **No regressions** — the DB harness still passes 128/128, and prior features' API tests still green.

---

## 6. What gets built first (this session)

The essentials, in order, ending with a running skeleton you can `npm run dev` on both ends:

1. Repo skeleton + `.gitignore` + `.env.example` + README
2. `docker-compose.yml` (Postgres 16 + extensions)
3. `db/migrations/` — schema split into ordered files + the migration runner
4. `db/seed/` — one Super Admin, sport categories, system settings
5. Server skeleton — Express + TS + Kysely + config + error/auth middleware (no feature logic yet)
6. Client skeleton — Vite + React + TS + routing + auth context + api client
7. Then **Feature 1 (Auth) end to end** as the template for all that follow.

Everything after that is feature-by-feature, one per working session, each meeting §5's Definition of Done before we move on.
