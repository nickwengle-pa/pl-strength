const CACHE_NAME = "pl-strength-v2";
const PRECACHE_URLS = ["/", "/index.html", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

const handleNetworkRequest = async (request) => {
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) {
    return fetch(request);
  }

  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  try {
    const response = await fetch(request);
    if (response && response.status === 200) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    if (cached) return cached;
    if (request.mode === "navigate") {
      return cache.match("/");
    }
    throw err;
  }
};

self.addEventListener("fetch", (event) => {
  event.respondWith(handleNetworkRequest(event.request));
});
