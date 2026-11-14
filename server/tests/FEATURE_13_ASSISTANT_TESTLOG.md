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

## Step 4 — Coach bubble and panel (manual UI checks, headless Chrome)

| Check | Rule (plan §7) | Result |
|---|---|---|
| Bubble bottom-right on student pages; not shown to other roles | §1, §7 | ✅ |
| Panel: header "Coach · BUKC Sports Assistant", clear chat, close | §7 | ✅ |
| Welcome "Hi {first name}! I'm Coach…" + 4 starter chips | §7 | ✅ |
| Streamed answer renders bold, numbered and bullet lists (no raw HTML) | §7 | ✅ |
| Server error → red note + **Open Messages** button | §3 | ✅ |
| Messages page: bubble raised above the send box | §7 | ✅ |
| Phone width (390 px): panel opens full-screen | §7 | ✅ |
| Esc closes the panel | §7 | ✅ |
| Chat survives page navigation and refresh; cleared on sign-out | §7 | ✅ |

## Real-model checks (manual, with a teammate's key)

| Date | Model | Check | Result |
|---|---|---|---|
| 15 Nov 2026 | gemini-3.5-flash-lite | "How do I borrow a badminton racket?" | ✅ correct but too brief → prompt tuned |
| 15 Nov 2026 | gemini-3.5-flash-lite | "Can I book a venue on Saturday?" | ✅ Mon–Fri rule held |
| 15 Nov 2026 | gemini-3.5-flash-lite | "venue booking ka process kya hai?" (Roman Urdu) | ✅ correct steps; one Devanagari word → prompt tuned |
| 15 Nov 2026 | gemini-3.5-flash-lite | "write my OOP assignment" | ✅ exact agreed refusal |
