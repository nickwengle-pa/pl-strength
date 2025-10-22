const CACHE_NAME = 'pl-strength-cache-v3';
const ASSETS = ['/', '/index.html', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(k => k !== CACHE_NAME ? caches.delete(k) : null)))
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Only handle safe, same-origin GET requests
  if (req.method !== 'GET') return;
  if (url.origin !== location.origin) return;

  // Only cache navigations and static assets
  const isNav = req.mode === 'navigate';
  const isAsset = /\.(css|js|png|jpg|jpeg|svg|webp|ico|woff2?)$/i.test(url.pathname);
  if (!isNav && !isAsset) return;

  event.respondWith(
    caches.match(req).then((cached) =>
      cached ||
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(req, copy));
        return res;
      }).catch(() => cached)
    )
  );
});
