/*
 * YieldX service worker.
 * - App pages: network first, cached copy when offline (analysis runs in the browser,
 *   so the dashboard keeps working offline with manually entered data).
 * - Build assets (/_next/static), the local font and logos: cache first — they are content-hashed or static.
 * - /api/*: never cached; market data must be live. Offline, the UI labels what it shows as saved data, never as live.
 */
const VERSION = 'yieldx-v3';
const PAGES = ['/opportunities', '/dashboard', '/portfolio', '/history', '/guide'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(PAGES))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const isFont = (url) => url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok || response.type === 'opaque') {
    const cache = await caches.open(VERSION);
    cache.put(request, response.clone());
  }
  return response;
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(VERSION);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = (await caches.match(request, { ignoreSearch: true })) || (await caches.match('/dashboard'));
    return cached || Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (isFont(url)) {
    event.respondWith(cacheFirst(request));
    return;
  }
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  const immutable = ['/_next/static/', '/pwa-icon/', '/fonts/', '/logos/'].some((p) => url.pathname.startsWith(p));
  event.respondWith(immutable ? cacheFirst(request) : networkFirst(request));
});
