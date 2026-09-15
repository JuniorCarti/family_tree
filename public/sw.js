const CACHE = 'lineage-shell-v16-firebase-auth';
const ASSETS = [
  '/',
  '/style.css',
  '/app.js',
  '/boot-state.js',
  '/explorer.js',
  '/tree-layout.js',
  '/archive.js',
  '/evidence.js',
  '/memories.js',
  '/quality-collab.js',
  '/discovery-localization.js',
  '/release13.js',
  '/manifest.webmanifest',
  '/favicon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key.startsWith('lineage-shell-') && key !== CACHE)
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.open(CACHE).then((cache) => cache.match('/'))));
    return;
  }

  if (!ASSETS.includes(url.pathname)) return;
  event.respondWith(
    caches.open(CACHE).then((cache) => cache.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
      if (response.ok) cache.put(event.request, response.clone());
      return response;
    })))
  );
});
