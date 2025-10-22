self.addEventListener('install', (event) => {
  event.waitUntil(caches.open('pl-strength-v1').then(cache => cache.addAll(['/'])));
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  event.respondWith(
    caches.match(req).then(cached => {
      const fetchPromise = fetch(req).then(networkResp => {
        try {
          const url = new URL(req.url);
          if (networkResp && networkResp.status === 200 && url.origin === location.origin) {
            const copy = networkResp.clone();
            caches.open('pl-strength-v1').then(cache => cache.put(req, copy));
          }
        } catch {}
        return networkResp;
      }).catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
