import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi } from './syncApi.js';

const who = { role: 'field_worker', actor: 'Selam' };
const reply = (status, body) => ({ status, json: async () => body });

test('sends JSON with identity headers to the right URL (trailing slash tolerated)', async () => {
  let seen;
  const api = createApi({ baseUrl: 'https://api.example.com/', fetchImpl: async (url, init) => { seen = { url, init }; return reply(201, { id: 'x' }); } });
  const res = await api.createReport({ id: 'x' }, who);
  assert.deepEqual(res, { status: 201, body: { id: 'x' } });
  assert.equal(seen.url, 'https://api.example.com/reports');
  assert.equal(seen.init.method, 'POST');
  assert.equal(seen.init.headers['X-Role'], 'field_worker');
  assert.equal(seen.init.headers['X-Actor'], 'Selam');
  assert.deepEqual(JSON.parse(seen.init.body), { id: 'x' });
});

test('actor names in any script are safe in a header and decode back', async () => {
  let header;
  const api = createApi({ baseUrl: 'http://x', fetchImpl: async (u, init) => { header = init.headers['X-Actor']; return reply(200, {}); } });
  await api.editReport('id1', {}, { role: 'field_worker', actor: 'ሰላም ተስፋዬ' });
  assert.match(header, /^[\x20-\x7e]+$/); // plain ASCII, so fetch accepts it
  assert.equal(decodeURIComponent(header), 'ሰላም ተስፋዬ');
});

test('HTTP errors are returned, not thrown; unreadable bodies become null', async () => {
  const api = createApi({ baseUrl: 'http://x', fetchImpl: async () => ({ status: 502, json: async () => { throw new Error('html'); } }) });
  assert.deepEqual(await api.postEvents('id1', [], who), { status: 502, body: null });
});

test('network failures and timeouts throw', async () => {
  const down = createApi({ baseUrl: 'http://x', fetchImpl: async () => { throw new TypeError('fetch failed'); } });
  await assert.rejects(down.getReport('id1', who), /fetch failed/);
  const hang = createApi({
    baseUrl: 'http://x', timeoutMs: 20,
    fetchImpl: (u, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')))),
  });
  await assert.rejects(hang.getReport('id1', who), /aborted/);
});

test('list filters become a query string and empty ones are skipped', async () => {
  let url;
  const api = createApi({ baseUrl: 'http://x', fetchImpl: async (u) => { url = u; return reply(200, []); } });
  await api.listReports({ status: 'Submitted', priority: '' }, who);
  assert.equal(url, 'http://x/reports?status=Submitted');
  await api.listReports({}, who);
  assert.equal(url, 'http://x/reports');
});
