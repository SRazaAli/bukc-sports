# Feature 13 — AI Assistant "Coach" — Test Log

Plan: `claude/ai-assistant-plan.md` (BUKC Sports project). Model calls are **mocked** in all
automated tests; no API key or quota is used. Real-model checks are recorded separately below.

Run: `TEST_DATABASE_URL=... npx vitest run tests/assistant.*.test.ts`

## Step 1 — Rulebook + system prompt (`assistant.prompt.test.ts`)

| Test | What it checks | Result |
|---|---|---|
| rulebook loads | `knowledge/student-rules.md` is read | ✅ |
| §10 rulings present | weekdays only, 6/10 participants, kit exemption | ✅ |
| core rules present | same day, 5:00 pm, 9–6, 1–30 sessions, no grace period | ✅ |
| campus time | prompt shows Asia/Karachi date/time | ✅ |
| first name only | surname never sent to the model | ✅ |
| refusal + rulebook | fixed refusal text and full rulebook embedded | ✅ |
| name sanitising | name can't carry instructions | ✅ |
| welcome text | "Hi {first name}! I'm Coach…" | ✅ |

## Step 2 — Chat endpoint, streaming, fallback (`assistant.chat.test.ts`, `assistant.llm.test.ts`)

| Test | Rule (plan §) | Result |
|---|---|---|
| T-1301 | no token → 401 (§1) | ✅ |
| T-1302 | Super Admin → 403, students only (§1) | ✅ |
| T-1303 | `/config`: welcome with first name, 4 starter chips (§7) | ✅ |
| T-1304 | no key → 503 "isn't set up yet… Messages" (§3) | ✅ |
| T-1305 | empty / >1,000 chars / last turn not student → 400 (§6) | ✅ |
| T-1306 | history trimmed to last 12 turns, starts with student (§6) | ✅ |
| T-1307 | SSE `delta…done`; prompt has rulebook + first name (§3) | ✅ |
| T-1308 | both models down → `error` UNAVAILABLE with agreed text (§3) | ✅ |
| T-1309 | failure mid-answer → partial text + INTERRUPTED (§3) | ✅ |
| T-1310 | 21st message in 10 min → 429 with wait minutes (§6) | ✅ |
| T-1320 | main model answers when healthy (§2) | ✅ |
| T-1321 | main model 429 before text → fallback answers silently (§2) | ✅ |
| T-1322 | both models fail → UNAVAILABLE (§2) | ✅ |
| T-1323 | failure after text → INTERRUPTED, no fallback mixing (§3) | ✅ |
| T-1324 | timeout → TIMEOUT (§6) | ✅ |

Regression: no existing test changed. The existing suite has failures on `main` that pre-date
this feature (venue/borrow tests); the team decided not to fix them as part of Feature 13.

## Real-model checks (manual, with a teammate's key)

| Date | Model | Check | Result |
|---|---|---|---|
| | | | |
