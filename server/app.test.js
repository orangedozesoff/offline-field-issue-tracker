// HTTP-level tests through the real Express app with a fake repository (no database).
// Needs:  npm install -D supertest
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('./app');

const ID = '3f2b8c1e-5a4d-4e6f-9b7a-1c2d3e4f5a6b';
const ORIGIN = 'http://localhost:5173';
const REPORT = { id: ID, status: 'Submitted', version: 1 };
const WORKER = { 'X-Role': 'field_worker', 'X-Actor': 'Selam' };
const BODY = {
  id: ID, category: 'Water point', description: 'Pump handle is broken', location_text: 'Kebele 04 well',
  priority: 'High', reporter_name: 'Selam', reported_at: new Date().toISOString(),
};

function build(overrides = {}) {
  const repo = {
    getReport: async () => REPORT,
    listEvents: async () => [],
    listReports: async () => [REPORT],
    createReport: async () => ({ result: 'created', report: REPORT }),
    editReport: async () => ({ result: 'ok', report: REPORT }),
    changeStatus: async () => ({ result: 'ok', report: REPORT }),
    ...overrides,
  };
  return createApp({ repo, clientUrl: ORIGIN });
}

test('GET / is the health check and x-powered-by is hidden', async () => {
  const res = await request(build()).get('/');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { status: 'ok' });
  assert.equal(res.headers['x-powered-by'], undefined);
});

test('CORS: only the configured origin is allowed, never *', async () => {
  const app = build();
  const ok = await request(app).get('/reports').set('Origin', ORIGIN);
  assert.equal(ok.headers['access-control-allow-origin'], ORIGIN);
  const other = await request(app).get('/reports').set('Origin', 'https://evil.example');
  assert.notEqual(other.headers['access-control-allow-origin'], 'https://evil.example');
  assert.notEqual(other.headers['access-control-allow-origin'], '*');
});

test('CORS preflight allows the identity headers and PATCH', async () => {
  const res = await request(build())
    .options('/reports/' + ID)
    .set('Origin', ORIGIN)
    .set('Access-Control-Request-Method', 'PATCH')
    .set('Access-Control-Request-Headers', 'content-type,x-role,x-actor');
  assert.ok([200, 204].includes(res.status));
  assert.match(res.headers['access-control-allow-headers'].toLowerCase(), /x-role/);
  assert.match(res.headers['access-control-allow-methods'], /PATCH/);
});

test('createApp refuses to start without CLIENT_URL', () => {
  assert.throws(() => createApp({ repo: {}, clientUrl: '' }), /CLIENT_URL/);
});

test('POST /reports: 201 for a new report, 400 for bad body, 403 for a coordinator', async () => {
  const app = build();
  const created = await request(app).post('/reports').set(WORKER).send(BODY);
  assert.equal(created.status, 201);
  assert.equal(created.body.id, ID);
  const bad = await request(app).post('/reports').set(WORKER).send({ ...BODY, priority: 'Soon' });
  assert.equal(bad.status, 400);
  assert.ok(bad.body.fields.priority);
  const forbidden = await request(app).post('/reports').set({ 'X-Role': 'coordinator', 'X-Actor': 'Hana' }).send(BODY);
  assert.equal(forbidden.status, 403);
});

test('malformed JSON is 400 and an oversized body is 413', async () => {
  const app = build();
  const malformed = await request(app).post('/reports').set(WORKER).set('Content-Type', 'application/json').send('{"id": ');
  assert.equal(malformed.status, 400);
  const big = await request(app).post('/reports').set(WORKER).send({ ...BODY, description: 'x'.repeat(20000) });
  assert.equal(big.status, 413);
});

test('unknown routes return a JSON 404', async () => {
  const res = await request(build()).get('/nope');
  assert.equal(res.status, 404);
  assert.deepEqual(res.body, { error: 'Not found' });
});

test('database failures become a generic 500 with no details leaked', async (t) => {
  t.mock.method(console, 'error', () => {});
  const app = build({ listReports: async () => { throw new Error('password for user postgres is wrong'); } });
  const res = await request(app).get('/reports');
  assert.equal(res.status, 500);
  assert.deepEqual(res.body, { error: 'Something went wrong' });
  assert.doesNotMatch(JSON.stringify(res.body), /password|postgres/);
});

test('invalid id on any report route is 400', async () => {
  const res = await request(build()).get('/reports/not-a-uuid');
  assert.equal(res.status, 400);
});
