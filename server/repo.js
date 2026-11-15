// All SQL lives here. Every query is parameterized, never SELECT *, and every
// state change plus its event is written in ONE transaction on a row-locked report.
// Functions return plain { result, ... } objects; routes map them to HTTP codes.

const crypto = require('node:crypto');
const { validateTransition } = require('./domain/transitions');
const { checkEditAllowed } = require('./domain/edit-rules');

const REPORT_COLUMNS =
  'id, category, description, location_text, latitude, longitude, priority, status, reporter_name, ' +
  'assigned_to, resolution_note, reported_at, received_at, updated_at, version';
const EVENT_COLUMNS = 'id, report_id, type, from_status, to_status, actor, message, occurred_at';
const EDIT_COLUMNS = ['description', 'location_text', 'latitude', 'longitude', 'priority']; // fixed whitelist
const LIST_FILTERS = ['status', 'priority', 'category']; // fixed whitelist
const LIST_LIMIT = 200;

async function withTransaction(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {
      /* keep the original error */
    }
    throw err;
  } finally {
    client.release();
  }
}

function serverEvent(type, fields = {}) {
  return {
    id: crypto.randomUUID(),
    type,
    from_status: fields.from_status || null,
    to_status: fields.to_status || null,
    message: fields.message || null,
    occurred_at: fields.occurred_at || new Date().toISOString(),
  };
}

// Duplicate ids are ignored, so re-uploading a device event never doubles history.
async function insertEvents(client, reportId, actor, events) {
  for (const e of events) {
    await client.query(
      `INSERT INTO report_events (id, report_id, type, from_status, to_status, actor, message, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO NOTHING`,
      [e.id, reportId, e.type, e.from_status || null, e.to_status || null, actor, e.message || null, e.occurred_at]
    );
  }
}

const sameNumber = (a, b) => (a === null || a === undefined ? null : Number(a)) === (b === null || b === undefined ? null : Number(b));

// Content the device sent at creation, compared with what is stored.
function sameContent(row, input) {
  return (
    row.category === input.category &&
    row.description === input.description &&
    row.location_text === input.location_text &&
    row.priority === input.priority &&
    row.reporter_name === input.reporter_name &&
    new Date(row.reported_at).getTime() === new Date(input.reported_at).getTime() &&
    sameNumber(row.latitude, input.latitude) &&
    sameNumber(row.longitude, input.longitude)
  );
}

function createRepo(pool) {
  async function getReport(id) {
    try {
      const r = await pool.query(`SELECT ${REPORT_COLUMNS} FROM reports WHERE id = $1`, [id]);
      return r.rows[0] || null;
    } catch (err) {
      if (err.code === '22P02') return null; // not a valid UUID
      throw err;
    }
  }

  async function listEvents(reportId) {
    try {
      const r = await pool.query(
        `SELECT ${EVENT_COLUMNS} FROM report_events WHERE report_id = $1 ORDER BY occurred_at, recorded_at, id`,
        [reportId]
      );
      return r.rows;
    } catch (err) {
      if (err.code === '22P02') return [];
      throw err;
    }
  }

  async function listReports(filters = {}) {
    const where = [];
    const params = [];
    for (const key of LIST_FILTERS) {
      if (filters[key]) {
        params.push(filters[key]);
        where.push(`${key} = $${params.length}`);
      }
    }
    const sql =
      `SELECT ${REPORT_COLUMNS} FROM reports` +
      (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
      ` ORDER BY received_at DESC, id LIMIT ${LIST_LIMIT}`;
    return (await pool.query(sql, params)).rows;
  }

  // Idempotent create keyed on the client-made UUID.
  function createReport(input, actor) {
    return withTransaction(pool, async (client) => {
      const ins = await client.query(
        `INSERT INTO reports (id, category, description, location_text, latitude, longitude, priority, reporter_name, reported_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (id) DO NOTHING
         RETURNING ${REPORT_COLUMNS}`,
        [input.id, input.category, input.description, input.location_text, input.latitude, input.longitude,
          input.priority, input.reporter_name, input.reported_at]
      );
      if (ins.rowCount === 1) {
        const events = input.events.some((e) => e.type === 'created')
          ? input.events
          : [serverEvent('created', { occurred_at: input.reported_at }), ...input.events];
        await insertEvents(client, input.id, actor, events);
        return { result: 'created', report: ins.rows[0] };
      }
      const cur = await client.query(`SELECT ${REPORT_COLUMNS} FROM reports WHERE id = $1`, [input.id]);
      const existing = cur.rows[0];
      if (!existing) throw new Error('Report vanished during idempotent create');
      if (existing.version === 1 && !sameContent(existing, input)) {
        return { result: 'id_conflict', report: existing };
      }
      await insertEvents(client, input.id, actor, input.events);
      return { result: 'exists', report: existing };
    });
  }

  // Edit with a version check. Lock rule first, then version, so a report that
  // moved on reports LOCKED rather than a vague version mismatch.
  function editReport(id, input, actor, role) {
    return withTransaction(pool, async (client) => {
      const cur = await client.query(`SELECT ${REPORT_COLUMNS} FROM reports WHERE id = $1 FOR UPDATE`, [id]);
      const existing = cur.rows[0];
      if (!existing) return { result: 'not_found' };

      const changed = EDIT_COLUMNS.filter((k) => k in input);
      const allowed = checkEditAllowed(role, existing.status, changed);
      if (!allowed.ok) return { result: 'locked', message: allowed.message, current: existing };
      if (existing.version !== input.base_version) return { result: 'version_conflict', current: existing };

      const sets = changed.map((k, i) => `${k} = $${i + 1}`);
      const params = changed.map((k) => input[k]);
      params.push(id);
      const upd = await client.query(
        `UPDATE reports SET ${sets.join(', ')}, version = version + 1, updated_at = now()
         WHERE id = $${params.length}
         RETURNING ${REPORT_COLUMNS}`,
        params
      );
      // Log the change once: the server writes an 'edited' event only if the device did not.
      const events = input.events.some((e) => e.type === 'edited')
        ? input.events
        : [serverEvent('edited', { message: `Changed: ${changed.join(', ')}` }), ...input.events];
      await insertEvents(client, id, actor, events);
      return { result: 'ok', report: upd.rows[0] };
    });
  }

  // Workflow change checked against the CURRENT row, then applied with its event.
  function changeStatus(id, input, actor) {
    return withTransaction(pool, async (client) => {
      const cur = await client.query(`SELECT ${REPORT_COLUMNS} FROM reports WHERE id = $1 FOR UPDATE`, [id]);
      const existing = cur.rows[0];
      if (!existing) return { result: 'not_found' };

      const verdict = validateTransition(existing.status, input.to, input);
      if (!verdict.ok) return { result: 'invalid_transition', error: verdict, current: existing };

      const sets = ['status = $1', 'version = version + 1', 'updated_at = now()'];
      const params = [input.to];
      if (input.to === 'Assigned') {
        params.push(input.assigned_to);
        sets.push(`assigned_to = $${params.length}`);
      }
      if (input.to === 'Resolved') {
        params.push(input.resolution_note);
        sets.push(`resolution_note = $${params.length}`);
      }
      params.push(id);
      const upd = await client.query(
        `UPDATE reports SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING ${REPORT_COLUMNS}`,
        params
      );

      let message = null;
      if (verdict.eventType !== 'status_changed') message = input.reason; // rejected or reopened
      else if (input.to === 'Assigned') message = `Assigned to ${input.assigned_to}`;
      else if (input.to === 'Resolved') message = input.resolution_note;
      const event = serverEvent(verdict.eventType, { from_status: existing.status, to_status: input.to, message });
      await insertEvents(client, id, actor, [event]);
      return { result: 'ok', report: upd.rows[0], event };
    });
  }

  // Device events uploaded on their own (e.g. 'synced' after the last operation).
  function appendEvents(id, events, actor) {
    return withTransaction(pool, async (client) => {
      const cur = await client.query('SELECT id FROM reports WHERE id = $1', [id]);
      if (cur.rowCount === 0) return { result: 'not_found' };
      await insertEvents(client, id, actor, events);
      return { result: 'ok' };
    });
  }

  return { getReport, listEvents, listReports, createReport, editReport, changeStatus, appendEvents };
}

module.exports = { createRepo, REPORT_COLUMNS, EVENT_COLUMNS };
