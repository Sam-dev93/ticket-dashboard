// ============ Ticket Father — Service Worker (auto-updating) ============
// Bump CACHE_VERSION any time you want a hard reset of cached assets.
// You normally WON'T need to: the app HTML is fetched network-first, so any
// change you push to index.html shows on the next load automatically.
const CACHE_VERSION = 'v2';
const CACHE_NAME = 'ticket-father-' + CACHE_VERSION;

const APP_SHELL = [
  './',
  './index.html',
  './icon-192.png',
  './icon-512.png',
  './manifest.json'
];

// ---- Install: pre-cache the shell, then take over ASAP ----
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

// ---- Activate: delete old version caches, then control all open pages ----
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// ---- Let the page tell us to activate a waiting worker immediately ----
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

// ---- Fetch strategy ----
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (e) { return; }

  // Google Sheets API → always network (never serve stale ticket data).
  if (url.hostname.indexOf('googleapis.com') !== -1) {
    event.respondWith(
      fetch(req).catch(() => new Response(
        JSON.stringify({ error: 'offline' }),
        { headers: { 'Content-Type': 'application/json' } }
      ))
    );
    return;
  }

  // App HTML / navigation → NETWORK-FIRST so updates appear immediately,
  // falling back to the cached copy when offline.
  const isHTML = req.mode === 'navigate' ||
                 url.pathname.endsWith('/') ||
                 url.pathname.endsWith('.html');
  if (isHTML) {
    event.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then(r => r || caches.match('./index.html')))
    );
    return;
  }

  // Everything else (icons, manifest, scripts) → cache-first, refresh in background.
  event.respondWith(
    caches.match(req).then(cached => {
      const network = fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then(c => c.put(req, copy));
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
