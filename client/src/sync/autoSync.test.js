import test from 'node:test';
import assert from 'node:assert/strict';
import { startAutoSync } from './autoSync.js';

const tick = () => new Promise((r) => setImmediate(r));

function fakeEnv({ locks = null } = {}) {
  const handlers = {};
  const timers = [];
  const target = () => ({
    addEventListener: (t, fn) => { (handlers[t] ||= new Set()).add(fn); },
    removeEventListener: (t, fn) => { handlers[t]?.delete(fn); },
  });
  const doc = { ...target(), visibilityState: 'visible' };
  return {
    env: { window: target(), document: doc, locks, setInterval: (fn) => { timers.push(fn); return timers.length; }, clearInterval: (id) => { timers[id - 1] = null; } },
    emit: (t) => { for (const fn of [...(handlers[t] || [])]) fn(); },
    tickTimer: () => timers.forEach((fn) => fn && fn()),
    doc,
    listeners: () => Object.values(handlers).reduce((n, s) => n + s.size, 0),
  };
}
const engineOf = (impl) => { const e = { calls: 0, syncOnce: async () => { e.calls++; if (impl) await impl(e.calls); } }; return e; };

test('syncs once at start, then on online, on visible (not hidden), and on the timer', async () => {
  const f = fakeEnv();
  const engine = engineOf();
  const sync = startAutoSync({ engine, env: f.env });
  await tick();
  assert.equal(engine.calls, 1);
  f.emit('online'); await tick();
  assert.equal(engine.calls, 2);
  f.doc.visibilityState = 'hidden'; f.emit('visibilitychange'); await tick();
  assert.equal(engine.calls, 2);
  f.doc.visibilityState = 'visible'; f.emit('visibilitychange'); await tick();
  assert.equal(engine.calls, 3);
  f.tickTimer(); await tick();
  assert.equal(engine.calls, 4);
  sync.stop();
});

test('triggers during a run collapse into exactly one more run', async () => {
  const f = fakeEnv();
  let release;
  const gate = new Promise((r) => { release = r; });
  const engine = engineOf(async (n) => { if (n === 1) await gate; });
  const sync = startAutoSync({ engine, env: f.env });
  await tick();
  sync.trigger(); sync.trigger(); sync.trigger();
  release();
  await tick(); await tick();
  assert.equal(engine.calls, 2);
  sync.stop();
});

test('a Web Lock held by another tab means this tab does not sync', async () => {
  const held = { request: async (name, opts, cb) => cb(null) }; // lock not available
  const free = { request: async (name, opts, cb) => cb({}) };
  const a = engineOf();
  startAutoSync({ engine: a, env: fakeEnv({ locks: held }).env }).stop();
  await tick();
  assert.equal(a.calls, 0);
  const b = engineOf();
  startAutoSync({ engine: b, env: fakeEnv({ locks: free }).env }).stop();
  await tick();
  assert.equal(b.calls, 1);
});

test('stop removes listeners and the timer', async () => {
  const f = fakeEnv();
  const engine = engineOf();
  const sync = startAutoSync({ engine, env: f.env });
  await tick();
  sync.stop();
  assert.equal(f.listeners(), 0);
  f.emit('online'); f.tickTimer(); await sync.trigger(); await tick();
  assert.equal(engine.calls, 1);
});

test('a failing run does not stop the scheduler', async (t) => {
  t.mock.method(console, 'error', () => {});
  const f = fakeEnv();
  const engine = engineOf(async (n) => { if (n === 1) throw new Error('boom'); });
  const sync = startAutoSync({ engine, env: f.env });
  await tick();
  f.emit('online'); await tick();
  assert.equal(engine.calls, 2);
  sync.stop();
});
