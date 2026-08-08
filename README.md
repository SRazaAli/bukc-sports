# BUKC Sports Platform

A centralized web platform for Bahria University Karachi Campus's sports department:
venue booking, equipment borrowing, and records management. Final Year Project.

**Stack:** PostgreSQL · Express · React · Node — TypeScript throughout.
**Schema:** verified with 128 rule tests (see `db/test-harness`).

---

## Prerequisites

- Node 22 (`.nvmrc`)
- Docker (for local Postgres) — or a Neon connection string

## First-time setup

```bash
# 1. clone, then install each workspace
cd db && npm install && cd ..
cd server && npm install && cd ..
cd client && npm install && cd ..

# 2. start local Postgres (Docker) — Postgres 16 with the needed extensions
docker compose up -d

# 3. configure env
cp .env.example server/.env       # edit secrets
cp .env.example db/.env           # DATABASE_URL only is needed here
cp client/.env.example client/.env

# 4. create the schema and seed the super admin
cd db
DATABASE_URL=postgresql://bukc:bukc@localhost:5433/bukc npm run migrate
DATABASE_URL=postgresql://bukc:bukc@localhost:5433/bukc npm run seed
cd ..
```

## Running (two terminals)

```bash
cd server && npm run dev      # API on :4000
cd client && npm run dev      # web on :5173 (proxies /api to :4000)
```

Open http://localhost:5173. Health check: http://localhost:4000/health.

Default super admin (from `.env`): `admin@bukc.edu.pk` / the seed password. Change it on first login.

## Testing

```bash
cd server && npm test         # API integration tests (Supertest vs test DB)
cd db && npm run test         # database rule harness (the 128 tests)
```

---

## Architecture

- **`db/`** — canonical schema as ordered migrations, a small forward-only runner
  (not an ORM engine — an ORM would fight the 41 triggers and the exclusion
  constraint the schema relies on), seed, and the rule-test harness.
- **`server/`** — Express + Kysely. Kysely is a typed query builder that does not
  own the schema; the database remains the final arbiter of every business rule.
  Role checks exist at both the API layer (`middleware/auth`) and the DB layer
  (triggers) — defense in depth.
- **`client/`** — Vite + React. Access token in memory, refresh token in an
  HTTP-only cookie; the API client refreshes transparently on 401.

Features are built one at a time, backend-first, each tested before the next.
See `DEVELOPMENT_PLAN.md`.

---

## Hosting

- **Frontend** → Render static site (free, persistent).
- **Backend** → Render web service. The free tier sleeps after 15 min, which
  drops the SSE connection; fine for demos, but move to Fly.io or a $7/mo Render
  instance for always-on real-time. Code is host-agnostic (`DATABASE_URL`), so
  this is a config change, not a code change.
- **Database** → Neon (free tier is persistent and supports `citext`,
  `btree_gist`, `pgcrypto`). Set `DATABASE_URL` to the Neon string.

`render.yaml` is a Blueprint for the two Render services. Set `DATABASE_URL`,
`CLIENT_ORIGIN`, `VITE_API_BASE`, and `RESEND_API_KEY` in the dashboard.

### Neon setup

1. Create a Neon project, copy the connection string (with `?sslmode=require`).
2. Run migrations against it: `DATABASE_URL=<neon-url> npm --prefix db run migrate`
3. Seed: `DATABASE_URL=<neon-url> npm --prefix db run seed`
