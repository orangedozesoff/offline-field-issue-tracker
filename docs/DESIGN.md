# Offline Field Issue Tracker: Design Document

Nov 12, 2026 ·&#32;

## Scope and assumptions

The app lets field workers record infrastructure problems on a phone with no signal, syncs them safely later, and lets a coordinator move each report through a fixed workflow. Every ambiguity in the brief is resolved below, so the code and tests follow these numbered decisions.

1. **Two simulated roles.** A role switcher (Field worker / Coordinator) replaces login. Field workers create and edit their own reports; coordinators change status and assignment. The reporter's name is typed once and stored on the device.
2. **Workflow status and sync state are separate.** Status is the business state (Draft, Submitted, Assigned, In Progress, Resolved, Rejected). Sync state (Pending, Synchronized, Failed) describes only whether the device and server agree.
3. **Drafts stay on the device.** A Draft never leaves the phone. Pressing Submit sets status to Submitted and queues the report for sync.
4. **Coordinator actions are online-only.** Status changes and assignment need a live connection, so the server is the single authority for workflow. Only report creation and pre-assignment edits work offline.
5. **Two clocks are kept.** `reported_at` is the device time when the worker created the report; the server also stores `received_at`. Device clocks can be wrong, so neither replaces the other.
6. **Location is text plus optional coordinates.** Text is required (a worker may not have GPS); latitude and longitude are saved when the browser provides them, which works offline.
7. **Fixed lists.** Categories: Water point, Equipment, Service interruption, Safety, Maintenance, Other. Priorities: Low, Medium, High, Critical.
8. **Out of scope:** authentication, photo uploads, push notifications, multi-device accounts, and real-time server push. Deployment is optional and done only if time remains.

## Architecture

A React client stores everything in IndexedDB first, and a separate sync engine delivers it to an Express API backed by Supabase PostgreSQL.

&#91;embedded content: architecture · device, sync engine, API, database\]

Field-worker data reaches the server only through the sync engine; coordinator actions go straight to the API and need a connection.

The stack follows Day 3: React + Vite (JavaScript), Express (CommonJS), PostgreSQL through the Supabase session pooler, Node's built-in test runner and supertest for tests. Only `api.js` and the sync engine call `fetch`, so the rest of the UI never depends on the network.

## Data model

The server owns two tables, `reports` and `report_events`; the device mirrors them in IndexedDB and adds a sync outbox. Report IDs are UUIDs generated on the device, which is what makes retries safe.

| Store | Field | Purpose |
| --- | --- | --- |
| `reports` (server) | `id` (uuid, client-made) | Primary key and idempotency key |
| `reports` (server) | `category`, `description`, `location_text`, `latitude`, `longitude`, `priority` | Report content, validated by CHECK constraints |
| `reports` (server) | `status`, `assigned_to`, `resolution_note` | Workflow state set only through the transition rules |
| `reports` (server) | `reported_at`, `received_at`, `updated_at` | Device time, server arrival time, last change |
| `reports` (server) | `version` (integer) | Incremented on every change; used to detect conflicts |
| `report_events` (server) | `id` (uuid, client-made for device events), `report_id`, `type`, `from_status`, `to_status`, `actor`, `message`, `occurred_at` | Append-only activity history; a duplicate `id` is ignored |
| `reports` (IndexedDB) | all report fields + `sync_state`, `attempts`, `next_retry_at`, `last_error`, `base_version` | Local copy that survives refresh and restart |
| `outbox` (IndexedDB) | `op_id`, `report_id`, `type` (create / edit), `payload`, `lease_until` | Queue of changes not yet confirmed by the server |
| `events` (IndexedDB) | same shape as the server table + `uploaded` flag | Local history, uploaded with the next successful sync |

## Status workflow

Only the transitions below are valid; the server rejects everything else with `409 { error, code: "INVALID_TRANSITION", from, to, allowed }`. The rules live in one pure function shared by the API and the tests.

| From | To | Who | Condition |
| --- | --- | --- | --- |
| Draft | Submitted | Field worker | Passes full validation |
| Draft | (deleted) | Field worker | Local only; never reached the server |
| Submitted | Assigned | Coordinator | `assigned_to` required |
| Submitted | Rejected | Coordinator | Reason required |
| Assigned | In Progress | Coordinator | None |
| Assigned | Rejected | Coordinator | Reason required |
| In Progress | Resolved | Coordinator | `resolution_note` required |
| Resolved | In Progress | Coordinator | Reopen; reason required, logged as `reopened` |

Rejected is terminal: a worker who disagrees creates a new report. Every other pair, such as Submitted to Resolved or Resolved to Submitted, is invalid. A change request that arrives from an out-of-date screen is also checked against the current server status, not the status the client saw.

## Sync strategy

Every change is written to a local outbox first and removed only after the server confirms it, so nothing is lost and retries are harmless. The server treats each create as idempotent on the report's UUID.

1. **Save locally.** One IndexedDB transaction writes the report and its outbox entry together, sets `sync_state = Pending`, and records a `created` event.
2. **Trigger.** Sync runs on app start, on the browser `online` event, after every save, and every 30 seconds while anything is pending. `navigator.onLine` is not trusted; a failed request is the real signal.
3. **One syncer at a time.** The Web Locks API stops two open tabs from sending the same entry. Each entry gets a short lease so a crash mid-send is detected and the entry is reset to pending on next start.
4. **Send.** `POST /reports` carries the client UUID as `id`. The server inserts with `ON CONFLICT (id) DO NOTHING`; if the row exists with identical content it returns 200 with the stored report, so a retry after a lost response succeeds quietly.
5. **Success (200/201).** The entry leaves the outbox, `sync_state = Synchronized`, and a `synced` event is recorded.
6. **Temporary failure** (network error, timeout, 5xx). The report stays Pending, `attempts` increases, and the next try waits 2s, 4s, 8s and so on up to 60s, with random jitter. Timeouts allow about 30 seconds because the free Render host can take up to a minute to wake.
7. **Permanent failure.** A 400 or 409 marks the report Failed at once, stores the server's `fields` or conflict message in `last_error`, and writes a `sync_failed` event. After 8 temporary failures the report also becomes Failed. A Failed report is never deleted; the user can fix it and press Retry.

| Sync state | Meaning | Leaves the state when |
| --- | --- | --- |
| Pending | Saved on device, server not yet confirmed | Server confirms, or retries run out |
| Synchronized | Server confirmed the latest local change | The user edits it again |
| Failed | Server refused it, or retries ran out | The user edits and retries, or discards it |

To reduce the risk of the browser clearing stored data, the app asks for persistent storage with `navigator.storage.persist()` and shows a notice if it is denied.

## Duplicates, conflicts, edits and reopening

Retries can never create a duplicate, and a conflicting change is never overwritten silently: the loser is kept on the device and shown as Failed with an explanation.

- **Retry duplicates.** Prevented by the client UUID plus `ON CONFLICT DO NOTHING`. The same UUID with different content returns 409, because that signals a bug rather than a retry.
- **Accidental double entry.** If a worker saves a report with the same category, location and description as one from the last 24 hours, the app warns and asks to confirm. The server does not merge by content, since two real faults can look alike.
- **Editing after submission.** A worker can edit description, location and priority while the status is Submitted. Each edit is an outbox entry carrying `base_version`. Once the report is Assigned, content is locked on the server; extra information goes in a new report. A coordinator can change priority at any status, and the change is logged.
- **Local versus server conflicts.** The server accepts an edit only if `base_version` equals the stored `version`; otherwise it returns 409 with the current server copy. Workflow fields (status, assignment) are always server-authoritative. If a worker's edit arrives after the report was assigned, the report becomes Failed with a conflict message, the worker's text is preserved, and the worker can discard it or copy it into a new report.
- **Reopening.** Only a coordinator can move Resolved back to In Progress, with a required reason. The change is logged as `reopened` and the resolution note is kept in history, not erased.

## Validation, errors and activity history

The server is the authority on validity; the client repeats the same rules only to give instant feedback. History is an append-only event log that records what happened on the device as well as on the server.

**Validation rules**

- `description` 5 to 1000 characters; `location_text` 2 to 200 characters, both trimmed.
- `category` and `priority` must come from the fixed lists; `status` only through the transition rules.
- `latitude` between -90 and 90, `longitude` between -180 and 180, both or neither.
- `reported_at` must be a valid timestamp and no more than 5 minutes in the future.
- `id` must be a valid UUID.

**Error handling.** All queries are parameterized. Request bodies are limited to 10 KB. Responses use `400 { error, fields }` for validation, `404` for unknown reports, `409` for invalid transitions and version conflicts, and a generic `500` that hides internals while the real error is logged. The client turns each of these into a readable message on the affected report.

**Activity history**

| Event type | Written by | When |
| --- | --- | --- |
| `created` | Device | Report saved locally |
| `edited` | Device, confirmed by server | Content edited |
| `synced` | Device | Server confirmed a change |
| `sync_failed` | Device | A send failed, with the reason |
| `status_changed` | Server | Any valid transition |
| `reopened` / `rejected` | Server | Those transitions, with the reason |

Device events carry their own UUID and an `occurred_at` time, and are uploaded with the next successful sync; the server ignores any event ID it already has, so history is never doubled. Server events are written in the same database transaction as the change they describe. The report detail view shows the full timeline.

## Testing priorities and QA

Tests go where a bug would silently lose or corrupt a report, in this order. Pure logic is tested without a database; API tests run against a separate `test` schema in the same Supabase project (via `TEST_DATABASE_URL`), cleared before each run.

1. **Sync engine** (Vitest + `fake-indexeddb`, fake API): an offline save stays Pending and survives a simulated reload; a lost response followed by a retry gives one record; a crash mid-send is recovered; a 400 becomes Failed and keeps the data; backoff caps at 60s.
2. **Idempotent create** (supertest): the same POST twice returns one row; same ID with different content returns 409.
3. **Transition rules** (unit): every valid pair passes, every other pair is rejected, required reasons and notes are enforced.
4. **Conflict handling** (supertest): an edit with a stale `base_version` returns 409 and changes nothing.
5. **Validation** (unit + supertest): boundaries for each field, bad UUIDs, malformed JSON, oversized bodies.
6. **Event log** (supertest): each change writes exactly one event; re-uploading a device event adds none.

UI rendering is deliberately tested least; a bug there is visible and recoverable, while a sync bug may not be.

**Manual QA checklist (full version goes in the README)**

- [ ] Create a report in airplane mode, refresh, confirm it is still there as Pending
- [ ] Reconnect and confirm it becomes Synchronized without pressing anything
- [ ] Switch the network off mid-sync and confirm no report is lost or doubled
- [ ] Submit invalid data and confirm field-level errors on both client and server
- [ ] Try an invalid status change as coordinator and confirm the message
- [ ] Edit a report that was assigned meanwhile and confirm the conflict message
- [ ] Check the activity timeline after each step above

## Known limitations and build plan

The design deliberately trades breadth for correctness in the offline path. The plan below fits about 19 hours of work before the deadline, with commits after every phase.

**Known limitations**

- Roles are simulated; anyone can switch to Coordinator.
- Coordinator actions need a connection (assumption 4).
- Device clock errors affect `reported_at`; the server's `received_at` is the reliable time.
- Browsers may clear IndexedDB under storage pressure; persistent storage is requested but not guaranteed.
- Sync polls every 30 seconds; the coordinator view refreshes on load and on a refresh button, not in real time.
- No attachments, and no merge of content-level duplicates.

**Build plan**

| Phase | Hours | Output (commit after each) |
| --- | --- | --- |
| Repository, scaffold, schema | 1.5 | Client and server folders, SQL, `.gitignore`, env examples |
| Server API and transition rules | 3 | Endpoints, validation, event log |
| Offline store and create/view UI | 4 | IndexedDB stores, report form, list with badges |
| Sync engine | 3 | Outbox, retries, states, conflict handling |
| Coordinator view and history timeline | 2 | Status actions, timeline |
| Tests | 2 | Priorities 1 to 6 above |
| README, QA list, AI disclosure | 1.5 | Final documentation |
| Buffer and submission | 2 | Fixes, optional deployment, submit |
