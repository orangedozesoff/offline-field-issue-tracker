-- Offline Field Issue Tracker schema (run once in the Supabase SQL Editor)
-- Drafts never reach the server, so 'Draft' is not a valid server status.

CREATE TABLE IF NOT EXISTS reports (
  id              UUID PRIMARY KEY,  -- generated on the device; makes retries idempotent
  category        TEXT NOT NULL CHECK (category IN
                    ('Water point','Equipment','Service interruption','Safety','Maintenance','Other')),
  description     TEXT NOT NULL CHECK (char_length(description) BETWEEN 5 AND 1000),
  location_text   TEXT NOT NULL CHECK (char_length(location_text) BETWEEN 2 AND 200),
  latitude        DOUBLE PRECISION CHECK (latitude BETWEEN -90 AND 90),
  longitude       DOUBLE PRECISION CHECK (longitude BETWEEN -180 AND 180),
  priority        TEXT NOT NULL CHECK (priority IN ('Low','Medium','High','Critical')),
  status          TEXT NOT NULL DEFAULT 'Submitted' CHECK (status IN
                    ('Submitted','Assigned','In Progress','Resolved','Rejected')),
  reporter_name   TEXT NOT NULL CHECK (char_length(reporter_name) BETWEEN 2 AND 60),
  assigned_to     TEXT,
  resolution_note TEXT,
  reported_at     TIMESTAMPTZ NOT NULL,                 -- device clock
  received_at     TIMESTAMPTZ NOT NULL DEFAULT now(),   -- server clock
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  version         INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  CHECK ((latitude IS NULL) = (longitude IS NULL)),
  CHECK (status NOT IN ('Assigned','In Progress','Resolved') OR assigned_to IS NOT NULL),
  CHECK (status <> 'Resolved' OR resolution_note IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS report_events (
  id          UUID PRIMARY KEY,  -- device events bring their own id, so re-uploads are ignored
  report_id   UUID NOT NULL REFERENCES reports(id) ON DELETE RESTRICT, -- a report with history cannot be deleted
  type        TEXT NOT NULL CHECK (type IN
                ('created','edited','synced','sync_failed','status_changed','reopened','rejected')),
  from_status TEXT,
  to_status   TEXT,
  actor       TEXT NOT NULL,
  message     TEXT,
  occurred_at TIMESTAMPTZ NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- The reason for a rejection or a reopen lives here, in message.
  CHECK (type NOT IN ('rejected','reopened') OR (message IS NOT NULL AND btrim(message) <> ''))
);

CREATE INDEX IF NOT EXISTS reports_status_idx ON reports (status);
CREATE INDEX IF NOT EXISTS reports_received_idx ON reports (received_at DESC);
CREATE INDEX IF NOT EXISTS report_events_report_idx ON report_events (report_id, occurred_at);

-- Append-only history. A trigger is used because the Express server connects as
-- the table owner, and REVOKE does not bind an owner; a trigger does.
CREATE OR REPLACE FUNCTION report_events_block_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'report_events is append-only: % is not allowed', TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS report_events_no_update_delete ON report_events;
CREATE TRIGGER report_events_no_update_delete
  BEFORE UPDATE OR DELETE ON report_events
  FOR EACH ROW EXECUTE FUNCTION report_events_block_mutation();

DROP TRIGGER IF EXISTS report_events_no_truncate ON report_events;
CREATE TRIGGER report_events_no_truncate
  BEFORE TRUNCATE ON report_events
  FOR EACH STATEMENT EXECUTE FUNCTION report_events_block_mutation();

-- Defense in depth for the public Supabase roles (skipped where they do not exist).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE UPDATE, DELETE, TRUNCATE ON report_events FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE UPDATE, DELETE, TRUNCATE ON report_events FROM authenticated;
  END IF;
END $$;

-- The Express server connects directly; keep the public Supabase REST API locked.
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_events ENABLE ROW LEVEL SECURITY;
