/**
 * Minimal service worker. Its only job is making the shell installable and
 * usable when the connection drops — API responses are cached separately in
 * localStorage by lib/api.js, which is where the real data-saving happens.
 */
const SHELL = 'utgc-shell-v1';
const PAGES = ['/', '/market', '/me', '/manifest.webmanifest', '/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(PAGES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Never intercept the API — conditional requests and auth headers belong to
  // the app layer, not to this cache.
  if (url.pathname.startsWith('/api/') || url.origin !== location.origin) return;

  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ||
        fetch(request)
          .then((res) => {
            const copy = res.clone();
            caches.open(SHELL).then((c) => c.put(request, copy));
            return res;
          })
          .catch(() => caches.match('/')),
    ),
  );
});
