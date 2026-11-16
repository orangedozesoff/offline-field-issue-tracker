// Decides WHEN to sync: at start, when the browser says it is online, when the tab becomes
// visible, every 30 seconds, and whenever the app asks (after a local change). Runs never
// overlap in this tab, and a Web Lock keeps other open tabs from syncing at the same time.

const LOCK_NAME = 'field-tracker-sync';

export function startAutoSync({ engine, intervalMs = 30000, env = {} }) {
  const win = 'window' in env ? env.window : globalThis.window;
  const doc = 'document' in env ? env.document : globalThis.document;
  const locks = 'locks' in env ? env.locks : globalThis.navigator?.locks;
  const setTimer = env.setInterval ?? setInterval;
  const clearTimer = env.clearInterval ?? clearInterval;
  let running = false;
  let again = false;
  let stopped = false;
  let forceNext = false;

  const execute = (force) => (locks?.request
    ? locks.request(LOCK_NAME, { ifAvailable: true }, (lock) => (lock ? engine.syncOnce({ force }) : null))
    : engine.syncOnce({ force }));

  // force: skip the retry delay (connection came back, tab became visible, user tapped Sync now).
  async function trigger({ force = false } = {}) {
    if (stopped) return;
    if (force) forceNext = true;
    if (running) {
      again = true; // something changed during a run: go once more afterwards
      return;
    }
    running = true;
    try {
      do {
        again = false;
        const force = forceNext;
        forceNext = false;
        try {
          await execute(force);
        } catch (err) {
          console.error('Sync run failed:', err);
        }
      } while (again && !stopped);
    } finally {
      running = false;
    }
  }

  const onOnline = () => { trigger({ force: true }); };
  const onVisible = () => { if (!doc || doc.visibilityState === 'visible') trigger({ force: true }); };
  win?.addEventListener?.('online', onOnline);
  doc?.addEventListener?.('visibilitychange', onVisible);
  const timer = setTimer(() => { trigger(); }, intervalMs);
  trigger();

  return {
    trigger,
    stop() {
      stopped = true;
      clearTimer(timer);
      win?.removeEventListener?.('online', onOnline);
      doc?.removeEventListener?.('visibilitychange', onVisible);
    },
  };
}
