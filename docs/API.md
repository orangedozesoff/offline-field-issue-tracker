# API Contract

Source of truth for the Express server. All bodies and responses are JSON.
Identity is simulated with two headers on every write: `X-Role` (`field_worker` or `coordinator`) and `X-Actor` (a name, 2 to 60 characters).

## Endpoints

| Method | Path | Who | Success | Purpose |
| --- | --- | --- | --- | --- |
| GET | `/` | anyone | 200 | Health check |
| GET | `/reports?status=&priority=&category=` | anyone | 200 | List reports, newest received first (max 200) |
| GET | `/reports/:id` | anyone | 200 | One report |
| GET | `/reports/:id/events` | anyone | 200 | Activity history, oldest first |
| POST | `/reports` | field worker | 201 or 200 | Idempotent create (see below) |
| PATCH | `/reports/:id` | worker (Submitted only) or coordinator | 200 | Edit with version check |
| POST | `/reports/:id/status` | coordinator | 200 | Change workflow status |

## Create: `POST /reports`

Body: `id` (UUID made on the device), `category`, `description`, `location_text`, `latitude?`, `longitude?`, `priority`, `reporter_name`, `reported_at`, `events?` (device events).

- New id: insert with status `Submitted`, `version` 1. Returns **201**.
- Id exists, `version` is 1 and content is identical: returns **200** with the stored report (a retry after a lost response).
- Id exists, `version` is 1 and content differs: **409** `ID_CONFLICT`.
- Id exists, `version` above 1: **200** with the stored report (the create already succeeded earlier).
- Uploaded `events` are inserted with `ON CONFLICT (id) DO NOTHING`.
- If no created event is uploaded, the server writes one.

## Edit: `PATCH /reports/:id`

Body: `base_version` (required) plus any of `description`, `location_text`, `latitude`, `longitude`, `priority`, and optional `events`.

- Field worker: allowed only while status is `Submitted`, otherwise **409** `LOCKED`.
- Coordinator: may change `priority` at any status; other fields follow the same lock.
- `base_version` must equal the stored `version`, otherwise **409** `VERSION_CONFLICT` with the current report in `current`. 
- Success increments `version`, writes an `edited` event unless the request already carries one, and returns the updated report.
## Status change: `POST /reports/:id/status`

Body: `to` plus `assigned_to`, `reason` or `resolution_note` as the move requires (see `domain/transitions.js`).

- Checked against the **current server status**, not what the client last saw.
- Invalid move: **409** `INVALID_TRANSITION` with `from`, `to`, `allowed`.
- Missing required field: **400** `MISSING_FIELD` with `fields`.
- Success: update + `version` + 1 + one event (`status_changed`, `rejected` or `reopened`, with the reason in `message`) in **one transaction**.

## Errors

| Status | Shape | When |
| --- | --- | --- |
| 400 | `{ error, fields }` | Validation failed, bad id, missing headers |
| 404 | `{ error }` | Unknown report |
| 409 | `{ error, code, ... }` | Invalid transition, version conflict, locked, id conflict |
| 500 | `{ error }` | Generic message; real error logged on the server |

Report object: `id, category, description, location_text, latitude, longitude, priority, status, reporter_name, assigned_to, resolution_note, reported_at, received_at, updated_at, version`.
Event object: `id, report_id, type, from_status, to_status, actor, message, occurred_at`.
