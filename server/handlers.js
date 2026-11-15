// HTTP behaviour without Express: each handler takes { params, query, headers, body }
// and returns { status, body }. Unexpected errors are thrown and become a generic 500
// in app.js. Check order for writes: id (400) -> identity headers (400) -> role (403)
// -> body (400) -> repository.

const {
  validateCreate, validateEdit, validateStatusInput, validateActor, validateDeviceEvents, isUuid, CATEGORIES, PRIORITIES,
} = require('./domain/validation');
const { STATUSES } = require('./domain/transitions');

const reply = (status, body) => ({ status, body });
const invalid = (fields, error = 'Validation failed') => reply(400, { error, fields });
const notFound = () => reply(404, { error: 'Report not found' });
const badId = () => invalid({ id: 'Must be a valid UUID' }, 'Invalid report id');
const ROLE_LABEL = { field_worker: 'field worker', coordinator: 'coordinator' };

// Returns { response } to stop, or { actor, role } to continue.
function authenticate(headers, requiredRole) {
  const a = validateActor(headers);
  if (!a.ok) return { response: invalid(a.fields, 'Missing or invalid identity headers') };
  if (requiredRole && a.value.role !== requiredRole) {
    return { response: reply(403, { error: `Only a ${ROLE_LABEL[requiredRole]} can do this`, code: 'FORBIDDEN' }) };
  }
  return { actor: a.value.actor, role: a.value.role };
}

function createHandlers(repo) {
  return {
    async health() {
      return reply(200, { status: 'ok' });
    },

    async listReports({ query = {} }) {
      const fields = {};
      const filters = {};
      for (const [key, list] of [['status', STATUSES], ['priority', PRIORITIES], ['category', CATEGORIES]]) {
        const v = query[key];
        if (v === undefined || v === '') continue;
        if (typeof v !== 'string' || !list.includes(v)) fields[key] = 'Must be one of: ' + list.join(', ');
        else filters[key] = v;
      }
      if (Object.keys(fields).length) return invalid(fields);
      return reply(200, await repo.listReports(filters));
    },

    async getReport({ params }) {
      if (!isUuid(params.id)) return badId();
      const report = await repo.getReport(params.id);
      return report ? reply(200, report) : notFound();
    },

    async listEvents({ params }) {
      if (!isUuid(params.id)) return badId();
      const report = await repo.getReport(params.id);
      if (!report) return notFound();
      return reply(200, await repo.listEvents(params.id));
    },

    // Device uploads history events on their own (idempotent: known event ids are ignored).
    async postEvents({ params, headers, body }) {
      if (!isUuid(params.id)) return badId();
      const who = authenticate(headers);
      if (who.response) return who.response;
      if (body === null || typeof body !== 'object' || !Array.isArray(body.events) || body.events.length === 0) {
        return invalid({ events: 'Provide a non-empty list of events' });
      }
      const ev = validateDeviceEvents(body.events);
      if (!ev.ok) return invalid(ev.fields);
      const r = await repo.appendEvents(params.id, ev.value, who.actor);
      if (r.result === 'not_found') return notFound();
      return reply(200, { received: ev.value.length });
    },

    async createReport({ headers, body }) {
      const who = authenticate(headers, 'field_worker');
      if (who.response) return who.response;
      const c = validateCreate(body);
      if (!c.ok) return invalid(c.fields);
      const r = await repo.createReport(c.value, who.actor);
      if (r.result === 'created') return reply(201, r.report);
      if (r.result === 'exists') return reply(200, r.report);
      return reply(409, {
        error: 'A different report already uses this id', code: 'ID_CONFLICT', current: r.report,
      });
    },

    async editReport({ params, headers, body }) {
      if (!isUuid(params.id)) return badId();
      const who = authenticate(headers);
      if (who.response) return who.response;
      const e = validateEdit(body);
      if (!e.ok) return invalid(e.fields);
      const r = await repo.editReport(params.id, e.value, who.actor, who.role);
      if (r.result === 'ok') return reply(200, r.report);
      if (r.result === 'not_found') return notFound();
      if (r.result === 'locked') return reply(409, { error: r.message, code: 'LOCKED', current: r.current });
      return reply(409, {
        error: 'The report was changed by someone else. Review the current version and try again.',
        code: 'VERSION_CONFLICT',
        current: r.current,
      });
    },

    async changeStatus({ params, headers, body }) {
      if (!isUuid(params.id)) return badId();
      const who = authenticate(headers, 'coordinator');
      if (who.response) return who.response;
      const s = validateStatusInput(body);
      if (!s.ok) return invalid(s.fields);
      const r = await repo.changeStatus(params.id, s.value, who.actor);
      if (r.result === 'ok') return reply(200, r.report);
      if (r.result === 'not_found') return notFound();
      const err = r.error;
      if (err.httpStatus === 400) return reply(400, { error: err.message, code: err.code, fields: err.fields });
      return reply(409, { error: err.message, code: err.code, from: err.from, to: err.to, allowed: err.allowed });
    },
  };
}

module.exports = { createHandlers };
