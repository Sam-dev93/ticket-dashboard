/*
 * Ticket Father — service worker
 *
 * Updating the app:
 *   • index.html is always fetched from the network first, so any change you
 *     upload shows the next time the app is opened (cache is only the offline fallback).
 *   • The page re-checks this file every time the app is opened or brought back
 *     to the front. Bump VERSION below whenever you deploy — the browser sees the
 *     byte change, installs this worker, and the page reloads itself onto it.
 *   • Google Sheets data is never cached.
 */
const VERSION = '2026.09.24-4';
const CACHE = `ticket-father-${VERSION}`;
const SHELL = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      // One missing file (e.g. an icon) shouldn't stop the install
      Promise.allSettled(SHELL.map((url) => cache.add(new Request(url, { cache: 'reload' }))))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    const isUpgrade = keys.some((k) => k !== CACHE); // an older version was installed
    // Wipe every older cache — including the old 'ticket-father-v2'
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
    // On an upgrade, reload any open windows straight onto the new version.
    // This matters when the page on screen is an old one with no auto-update code of its own.
    if (isUpgrade) {
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      await Promise.all(wins.map((w) => (w.navigate ? w.navigate(w.url).catch(() => {}) : null)));
    }
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Google Sheets API → always network (never serve stale ticket data)
  if (url.hostname === 'sheets.googleapis.com') {
    event.respondWith(
      fetch(req).catch(() => new Response(JSON.stringify({ error: 'offline' }), { headers: { 'Content-Type': 'application/json' } }))
    );
    return;
  }
  if (url.origin !== self.location.origin) return; // let the browser handle anything else external (jsPDF CDN)
  if (url.pathname.endsWith('/sw.js')) return;     // never serve the worker from cache

  const isPage = req.mode === 'navigate' || url.pathname.endsWith('/') || url.pathname.endsWith('.html');

  if (isPage) {
    // Network first: always the latest HTML when online, cached copy when offline
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' });
        if (fresh && fresh.ok && !url.search) {
          const cache = await caches.open(CACHE);
          cache.put('./index.html', fresh.clone());
        }
        return fresh;
      } catch (e) {
        return (await caches.match('./index.html')) || (await caches.match('./')) ||
          new Response('<h1 style="font-family:system-ui;color:#F7F4EC;background:#08151C">Offline</h1>', { headers: { 'Content-Type': 'text/html' } });
      }
    })());
    return;
  }

  // Everything else (icons, manifest): serve cached, refresh in the background
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req);
    const network = fetch(req).then((res) => {
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    }).catch(() => null);
    return cached || (await network) || new Response('', { status: 504 });
  })());
});
