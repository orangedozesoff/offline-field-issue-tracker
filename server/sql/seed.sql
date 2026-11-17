-- Demo data for the real schema (run in the Supabase SQL Editor after schema.sql).
-- Safe to run more than once: fixed ids and ON CONFLICT DO NOTHING.
-- Remove later with: DELETE is blocked on report_events, so to reset use
--   DROP TABLE report_events, reports CASCADE;  then run schema.sql again.

INSERT INTO reports
  (id, category, description, location_text, latitude, longitude, priority, status,
   reporter_name, assigned_to, resolution_note, reported_at, received_at, updated_at, version)
VALUES
  ('11111111-1111-4111-8111-111111111101', 'Water point',
   'Hand pump at the Kebele 04 well gives no water since Monday', 'Kebele 04 well', 9.0300, 38.7400, 'High', 'Submitted',
   'Selam Tesfaye', NULL, NULL, '2026-11-10T08:15:00Z', '2026-11-10T08:16:00Z', '2026-11-10T08:16:00Z', 1),
  ('11111111-1111-4111-8111-111111111102', 'Equipment',
   'Clinic generator does not start; the vaccine fridge is at risk', 'Dire Dawa health post', NULL, NULL, 'Critical', 'Assigned',
   'Abdi Mohammed', 'Dawit Bekele', NULL, '2026-11-10T09:00:00Z', '2026-11-10T09:01:00Z', '2026-11-10T09:30:00Z', 2),
  ('11111111-1111-4111-8111-111111111103', 'Safety',
   'Exposed wiring near the school water tank', 'Hawassa school yard', 7.0500, 38.4700, 'Medium', 'In Progress',
   'Meron Alemu', 'Dawit Bekele', NULL, '2026-11-09T14:20:00Z', '2026-11-09T14:21:00Z', '2026-11-10T07:00:00Z', 3),
  ('11111111-1111-4111-8111-111111111104', 'Maintenance',
   'Broken tap at the market stand pipe', 'Adama market', NULL, NULL, 'Low', 'Resolved',
   'Hana Girma', 'Yonas Alemu', 'Replaced the tap and sealed the joint', '2026-11-08T10:00:00Z', '2026-11-08T10:02:00Z', '2026-11-09T16:00:00Z', 4),
  ('11111111-1111-4111-8111-111111111105', 'Other',
   'Request for a new road sign at the junction', 'Bahir Dar junction', NULL, NULL, 'Low', 'Rejected',
   'Selam Tesfaye', NULL, NULL, '2026-11-07T11:30:00Z', '2026-11-07T11:31:00Z', '2026-11-08T08:00:00Z', 2)
ON CONFLICT (id) DO NOTHING;

INSERT INTO report_events (id, report_id, type, from_status, to_status, actor, message, occurred_at)
VALUES
  ('22222222-2222-4222-8222-000000000001', '11111111-1111-4111-8111-111111111101', 'created', NULL, NULL, 'Selam Tesfaye', NULL, '2026-11-10T08:15:00Z'),
  ('22222222-2222-4222-8222-000000000002', '11111111-1111-4111-8111-111111111102', 'created', NULL, NULL, 'Abdi Mohammed', NULL, '2026-11-10T09:00:00Z'),
  ('22222222-2222-4222-8222-000000000003', '11111111-1111-4111-8111-111111111102', 'status_changed', 'Submitted', 'Assigned', 'Hana Girma', 'Assigned to Dawit Bekele', '2026-11-10T09:30:00Z'),
  ('22222222-2222-4222-8222-000000000004', '11111111-1111-4111-8111-111111111103', 'created', NULL, NULL, 'Meron Alemu', NULL, '2026-11-09T14:20:00Z'),
  ('22222222-2222-4222-8222-000000000005', '11111111-1111-4111-8111-111111111103', 'status_changed', 'Submitted', 'Assigned', 'Hana Girma', 'Assigned to Dawit Bekele', '2026-11-09T15:00:00Z'),
  ('22222222-2222-4222-8222-000000000006', '11111111-1111-4111-8111-111111111103', 'status_changed', 'Assigned', 'In Progress', 'Dawit Bekele', NULL, '2026-11-10T07:00:00Z'),
  ('22222222-2222-4222-8222-000000000007', '11111111-1111-4111-8111-111111111104', 'created', NULL, NULL, 'Hana Girma', NULL, '2026-11-08T10:00:00Z'),
  ('22222222-2222-4222-8222-000000000008', '11111111-1111-4111-8111-111111111104', 'status_changed', 'Submitted', 'Assigned', 'Hana Girma', 'Assigned to Yonas Alemu', '2026-11-08T12:00:00Z'),
  ('22222222-2222-4222-8222-000000000009', '11111111-1111-4111-8111-111111111104', 'status_changed', 'Assigned', 'In Progress', 'Yonas Alemu', NULL, '2026-11-09T08:00:00Z'),
  ('22222222-2222-4222-8222-000000000010', '11111111-1111-4111-8111-111111111104', 'status_changed', 'In Progress', 'Resolved', 'Yonas Alemu', 'Replaced the tap and sealed the joint', '2026-11-09T16:00:00Z'),
  ('22222222-2222-4222-8222-000000000011', '11111111-1111-4111-8111-111111111105', 'created', NULL, NULL, 'Selam Tesfaye', NULL, '2026-11-07T11:30:00Z'),
  ('22222222-2222-4222-8222-000000000012', '11111111-1111-4111-8111-111111111105', 'rejected', 'Submitted', 'Rejected', 'Hana Girma', 'Not an infrastructure fault; forwarded to the municipality', '2026-11-08T08:00:00Z')
ON CONFLICT (id) DO NOTHING;
