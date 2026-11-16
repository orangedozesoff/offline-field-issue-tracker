// Service worker: keeps the app shell available offline so the app opens (and reports
// stay readable) with no connection. Only same-origin GET requests are handled; API calls
// go straight to the network and are managed by the sync engine, never by this file.
const CACHE = 'field-tracker-shell-v1';

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Cache the page and the scripts/styles it references, so the very first visit works offline too.
    try {
      const html = await (await fetch('/index.html', { cache: 'reload' })).text();
      const assets = [...html.matchAll(/(?:src|href)="(\/[^"]+)"/g)].map((m) => m[1]);
      await cache.addAll(['/', '/index.html', ...assets]);
    } catch (_) {
      /* installing while offline is not possible; ignore */
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req);
    const network = fetch(req)
      .then((res) => { if (res.ok) cache.put(req, res.clone()); return res; })
      .catch(() => null);
    if (cached) return cached; // stale-while-revalidate: instant, refreshed in the background
    const res = await network;
    if (res) return res;
    if (req.mode === 'navigate') {
      const shell = (await cache.match('/index.html')) || (await cache.match('/'));
      if (shell) return shell;
    }
    return Response.error();
  })());
});
