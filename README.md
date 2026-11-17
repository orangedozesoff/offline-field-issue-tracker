# Offline Field Issue Tracker

A small full-stack app for field workers to report infrastructure problems (broken water points, damaged equipment, service interruptions, safety concerns, maintenance needs) **with no internet connection**. Reports are saved on the device, synchronized automatically when the connection returns, and reviewed by a coordinator who moves them through a status workflow.

> Built for the NilePixel Technologies Cohort 1 graduation project.

- **Live demo:** Not deployed
- **Time spent:** About 21 hours and 30 minutes

## Tech stack

React + Vite (JavaScript) · Express · PostgreSQL on Supabase · IndexedDB (via `idb`) · Service Worker · Node's built-in test runner (`node:test`) with `supertest` and `fake-indexeddb`.

## Quick start

Needs Node 20+ and a Supabase (PostgreSQL) project.

```bash
# 1. Database: in the Supabase SQL Editor run server/sql/schema.sql once
#    (optional demo data: server/sql/seed.sql)

# 2. Server
cd server
npm install
cp .env.example .env        # then fill in DATABASE_URL (Session pooler string)
npm run dev                 # http://localhost:4000

# 3. Client (second terminal)
cd client
npm install
cp .env.example .env        # VITE_API_URL=http://localhost:4000
npm run dev                 # http://localhost:5173
```

`server/.env` needs `DATABASE_URL`, `CLIENT_URL` (the browser origin allowed by CORS, e.g. `http://localhost:5173`), `PORT`, and `TEST_DATABASE_URL` for the integration tests. **Never commit `.env`.**

To try offline behavior you need a production build, because the service worker only runs there:

```bash
cd client && npm run build && npm run preview     # http://localhost:4173
```

Open it once online, reload once, then go offline (browser DevTools, or airplane mode) and keep working.

### Using the app

Use the role switcher at the top: **Field worker** creates and edits reports; **Coordinator** reviews them and changes their status. There is no login (roles are simulated; see Assumptions).

## Running the tests

```bash
cd server && npm test      # 66 tests; the 18 repository tests need TEST_DATABASE_URL
cd client && npm test      # 67 tests
```

Server tests that need no database: `node --test "domain/*.test.js" handlers.test.js app.test.js`.

Integration tests run in a separate `test` schema (create it by running `schema.sql` after `CREATE SCHEMA test; SET search_path TO test;`). `report_events` is append-only, so those tests use fresh UUIDs instead of cleaning up; reset the schema with `DROP SCHEMA test CASCADE;` when you like.

### Testing priorities

Tests go where a bug would silently lose or corrupt a report, in this order:

1. **Sync engine** (client): offline save stays Pending across a restart; lost response then retry gives one record; crash mid-send recovers via an expiring lease; server refusal becomes Failed and keeps the data; being offline never becomes Failed; backoff; ordering of operations per report; forced sync on reconnect.
2. **Idempotent create** (server, real database): same id twice is one row; same id with different content is a 409.
3. **Workflow rules**: every valid transition passes and every other pair is rejected; required reasons and notes are enforced.
4. **Conflicts**: stale `base_version` returns 409 and changes nothing; edits after assignment are `LOCKED`.
5. **Validation**: boundaries for every field on both sides.
6. **History**: one event per change, written in the same transaction; re-uploaded events are ignored; the table refuses UPDATE, DELETE and TRUNCATE.
7. **Storage**: one shared contract suite run against both the memory store and IndexedDB, including "a commit that cannot be stored keeps nothing".

UI rendering is tested least on purpose: a UI bug is visible and recoverable, a sync bug may not be. The UI is covered by the manual QA checklist (`docs/QA-CHECKLIST.md`).

## Architecture

```
 Field device (browser, works offline)                 Cloud
 ┌───────────────────────────────────────┐        ┌──────────────────────────┐
 │ React UI                              │        │ Express API              │
 │   │  reads/writes                     │        │  validation, workflow    │
 │ IndexedDB: reports, outbox, events    │ HTTPS  │  rules, version checks,  │──► PostgreSQL (Supabase)
 │   ▲                                   │ ─────► │  activity log            │     reports, report_events
 │ Sync engine: outbox, retries, backoff │ online │                          │
 └───────────────────────────────────────┘ only   └──────────────────────────┘
```

Server (`server/`): `domain/` holds pure rules (workflow transitions, validation, edit locking) with no database or Express; `repo.js` holds all SQL; `handlers.js` maps results to HTTP codes without Express; `app.js` is only the Express wiring.

Client (`client/src/`): `sync/` holds the engine, local report operations, scheduler and app state; `storage/` has the IndexedDB and in-memory stores behind one interface; `ui/` has the React components.

Full details and decisions: `docs/DESIGN.md`, `docs/DESIGN-CHANGES.md`. API reference: `docs/API.md`.

## Synchronization strategy

Every change is saved locally first and removed from the outbox only after the server confirms it.

1. **Save locally.** One IndexedDB transaction writes the report, its outbox entry and its history event together; the report becomes **Pending**.
2. **When it runs.** At app start, on the browser `online` event, when the tab becomes visible, every 30 seconds, and right after any local change. Only one run at a time per tab; a Web Lock stops two open tabs syncing together.
3. **Idempotent create.** The device makes the report's UUID; the server inserts with `ON CONFLICT DO NOTHING`. A retry after a lost response returns 200 with the stored report instead of a duplicate.
4. **Ordered.** Operations for one report are sent in order (create, then each edit with its expected `base_version`). A later operation never overtakes an earlier one.
5. **Retries.** Network failure or timeout: stay Pending, retry with exponential backoff (2 s up to 60 s, with jitter). The retry delay is skipped when the connection returns or the user taps "Sync now". Offline never turns a report into Failed.
6. **Failures.** Server errors (5xx, 429, 408) become **Failed** after 8 attempts, with a Retry button. A rejection (400, 404, 409) becomes **Failed** at once, with the server's reason shown; the user's data is kept and never deleted.
7. **Crash recovery.** An operation being sent holds a 60-second lease; if the app died mid-send, the lease expires and it is retried.
8. **History.** Device events (created, edited, synced, sync_failed) travel with their operation or are flushed separately; the server ignores any event id it already has.

## Assumptions and design decisions

| Topic | Decision |
| --- | --- |
| Roles | Simulated with a role switcher and name, sent as `X-Role` / `X-Actor` headers. Only field workers create; only coordinators change status (403 otherwise). |
| Workflow | Draft → Submitted → Assigned → In Progress → Resolved; Rejected from Submitted or Assigned. Rejected is final. Resolved can be reopened to In Progress with a required reason. |
| Draft | Local only; never sent. Status and sync state are separate fields. |
| Status changes | Online only; the server is the authority and checks the move against the current status. |
| Duplicate detection | Exact retries are prevented by the UUID. The app also warns before submitting the same category, location and description within 24 hours; the server never merges by content. |
| Editing after submission | Allowed only while the status is Submitted. After that content is locked; a coordinator may still change priority. |
| Conflicts | Each report has a `version`. An edit carries `base_version`; if the report was assigned or changed meanwhile, the edit becomes Failed with the server copy, and the user chooses "Discard my change" or "Keep my text as a new draft". Nothing is overwritten silently. |
| Reopening | Coordinator only, reason required, logged as `reopened`; the resolution note is kept in history. |
| History | `report_events` is append-only (database trigger). Rejection and reopen reasons are stored in the event message, in the same transaction as the status change. |
| Clocks | The device time (`reported_at`) and the server time (`received_at`) are both kept. |
| Validation | Same rules on client (for feedback) and server (authority); invalid input never reaches SQL; all queries are parameterized. |

## Known limitations

- No real authentication; anyone can switch role.
- Coordinator status changes need a connection.
- Device clocks can be wrong; `received_at` is the reliable time.
- Browsers may clear IndexedDB under storage pressure; persistent storage is requested but not guaranteed.
- The offline app shell is cached by a service worker, so the app must be opened once online first.
- Sync is polling and events, not real-time push; a coordinator sees new reports on refresh or every 30 seconds.
- No photo attachments, no pagination (the list shows the latest 200), no Amharic interface (names in any script are supported).
- The free hosting tier may need up to a minute to wake; the first sync can take that long and will retry.

## Manual QA checklist

See `docs/QA-CHECKLIST.md`.

## Time spent

About 21 hours and 30 minutes in total, covering design, database and server setup, client implementation, testing, troubleshooting, documentation, and Git/GitHub work.

## What I would improve with more time

- Real authentication and per-worker report ownership.
- Let coordinators work offline too, with a conflict-aware merge screen showing both versions side by side.
- Background Sync API for syncing when the app is closed.
- End-to-end browser tests in CI (the manual checklist is currently the only UI test).
- Pagination and server-side search; photo attachments with resumable upload.
- Translated interface (Amharic and others).

## AI and development-tool disclosure

> Review every line below and correct anything that is not true for you. You are responsible for all of it.

**Tools used.** Claude (Anthropic) and ChatGPT (OpenAI), both through chat conversations. I used Claude for much of the application design, code, tests, and documentation, and ChatGPT for technical explanations, setup, troubleshooting, testing guidance, and Git/GitHub support. Development was done on an Android phone using Termux, Node.js, npm, Git, and GitHub CLI, with Supabase/PostgreSQL and Vite/React.

**What I used it for.** Planning and design decisions, writing most of the code and tests, finding bugs, and writing documentation drafts.

**What I accepted, and what I changed or asked for.** I accepted most generated code after reading and running it. Changes that came from my review or testing:
- I asked for rejection reasons to be stored with the status change in one transaction, and for the history table to be enforced as append-only; the schema was changed to add a database trigger.
- My test run found a bug in the IndexedDB store (unhandled aborted requests); it was fixed.
- My Termux build failed on CSS minification (a native library with no Android build); I disabled it in the Vite config.
- I reviewed the generated implementation, reported issues found during testing, requested corrections, simplified the UI styling for a more practical appearance, integrated the provided files, and managed testing, documentation, and Git/GitHub operations.

**How I verified it.** I ran the automated server tests on my phone, including 18 integration tests against PostgreSQL, and verified all 67 client tests passed. I also ran API smoke tests using curl and checked report creation, assignment, status transitions, rejection, reopening, and duplicate prevention. I manually tested offline report creation, refreshing while offline, and synchronization after reconnecting. Separately, Claude ran 13 browser-based scenarios during development; I did not write or run that browser-testing script, and it is not included in the repository.

**What I rejected.** I chose not to submit clarification questions and assumptions about their answers. I also rejected Claude's suggestion to use Python instead of JavaScript, keeping JavaScript as the project language.

I can explain every design decision above and walk through the code of every module.
