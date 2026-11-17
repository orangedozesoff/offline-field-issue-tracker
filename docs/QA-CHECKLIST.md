# Manual QA checklist

Run against a production build (`npm run build && npm run preview` in `client/`, API running). Tick each box.

## Creating and offline

- [ ] Online: create and submit a report; it shows **Pending**, then **Synchronized** within a few seconds
- [ ] The row appears in Supabase (`reports`) with status `Submitted` and version 1
- [ ] Airplane mode: the pill says **Offline** and the banner appears
- [ ] Offline: create and submit a report; it shows **Pending** and a toast confirms it is saved on the device
- [ ] Offline: save an incomplete report as a **draft**; it shows "Draft · this device only"
- [ ] Offline: refresh the page; the app opens and every report is still there
- [ ] Close the browser tab and reopen the app; reports are still there
- [ ] Reconnect: the Pending report becomes **Synchronized** without any button press
- [ ] Check the database: the report exists exactly once
- [ ] Drafts never appear in the database

## Validation and duplicates

- [ ] Description of 3 characters shows an error and creates no draft
- [ ] Missing category / location shows field errors
- [ ] Latitude 95 shows an error
- [ ] Submitting the same category, location and description again within 24 h shows the duplicate warning; "Submit anyway" sends it

## Failure and retry

- [ ] Stop the server, create a report: it stays **Pending** (never Failed), however long you wait
- [ ] Start the server again: it syncs
- [ ] With the server running, send a rejected report (for example edit the API to refuse it): **Failed** appears with the reason and the text is still there
- [ ] "Fix and retry" lets you correct it and it then syncs
- [ ] "Sync now" in a Pending report's details sends it immediately

## Workflow (coordinator)

- [ ] Switch to Coordinator: the "New report" button is hidden
- [ ] Open a Synchronized report, move it to **Assigned** (assignee required)
- [ ] Move to **In Progress**, then **Resolved** (note required)
- [ ] **Reopen** a resolved report (reason required); it returns to In Progress
- [ ] **Rejected** needs a reason; a rejected report offers no further moves
- [ ] Status change while offline shows "You are offline" and changes nothing
- [ ] The activity history shows each step with its time and actor

## Editing and conflicts

- [ ] As a worker, edit a Submitted report; the change syncs and the version goes up
- [ ] After the coordinator assigns it, the worker's Edit button is gone
- [ ] Offline edit by the worker, then the coordinator assigns the report, then reconnect: the report shows **Failed** with the explanation; "Keep my text as a new draft" creates a draft and restores the server version
- [ ] "Discard my change" restores the server version

## Security and data safety

- [ ] The browser never shows `student_email`-style personal data (none is stored)
- [ ] `git ls-files | grep -i env` lists only the two `.env.example` files
- [ ] The API refuses a request from another origin (CORS) and one with a body over 10 KB
- [ ] In the database, `UPDATE report_events ...` fails with "append-only"
