const CACHE_NAME = 'pornwrld-v104';
const PRECACHE_URLS = [
  '/',
  '/styles.css',
  '/assets/images/face.png',
  '/manifest.json',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  // Only cache same-origin GET requests
  if (event.request.method !== 'GET' || url.origin !== location.origin) return;
  // Don't cache API calls or media
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/media') || url.pathname.startsWith('/preview-media') || url.pathname.startsWith('/thumbnail') || url.pathname.startsWith('/admin')) return;
  // HTML navigations (/checkout, /, …): network-first so deploys always pick up fresh index.html + new /assets/* hashes (avoids stale shells in cache).
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).then((response) => {
        if (response.ok && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => caches.match(event.request))
    );
    return;
  }
  // Vite hashed bundles — network-first; cache populated on successful fetch below
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      fetch(event.request).then((response) => {
        if (response.ok && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => caches.match(event.request))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached => {
      const fetchPromise = fetch(event.request).then(response => {
        if (response.ok && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
