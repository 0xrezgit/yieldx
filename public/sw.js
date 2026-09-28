/*
 * YieldX service worker.
 * - App pages: network first, cached copy when offline (analysis runs in the browser,
 *   so the dashboard keeps working offline with manually entered data).
 * - Build assets (/_next/static) and fonts: cache first — they are content-hashed.
 * - /api/*: never cached; market data must be live.
 */
const VERSION = 'yieldx-v2';
const PAGES = ['/dashboard', '/portfolio', '/history', '/guide'];

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

  const immutable = url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/pwa-icon/');
  event.respondWith(immutable ? cacheFirst(request) : networkFirst(request));
});
