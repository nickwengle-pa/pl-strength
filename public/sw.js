const CACHE_NAME = "pl-strength-v4";
const PRECACHE_URLS = ["/", "/index.html", "/manifest.webmanifest"];

// Broadcast channel for communicating with the app
const broadcast = new BroadcastChannel('sw-updates');

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  // Immediately activate the new service worker
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Clear all old caches
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      );
      // Take control of all clients immediately
      await self.clients.claim();
      // Notify all clients that an update is available
      broadcast.postMessage({ type: 'SW_UPDATED', version: CACHE_NAME });
    })()
  );
});

// Listen for skip waiting message from the app
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

const handleNetworkRequest = async (request) => {
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) {
    return fetch(request);
  }

  // For navigation requests and HTML, always try network first
  const isNavigationOrHtml = request.mode === "navigate" || 
    request.destination === "document" ||
    url.pathname.endsWith(".html") ||
    url.pathname === "/";

  const cache = await caches.open(CACHE_NAME);

  if (isNavigationOrHtml) {
    try {
      const response = await fetch(request, { cache: "no-cache" });
      if (response && response.status === 200) {
        cache.put(request, response.clone());
      }
      return response;
    } catch (err) {
      const cached = await cache.match(request);
      if (cached) return cached;
      return cache.match("/");
    }
  }

  // For other assets, use stale-while-revalidate
  const cached = await cache.match(request);

  const fetchPromise = fetch(request).then((response) => {
    if (response && response.status === 200) {
      cache.put(request, response.clone());
    }
    return response;
  }).catch(() => null);

  // Return cached if available, otherwise wait for network
  if (cached) {
    // Revalidate in the background
    fetchPromise;
    return cached;
  }

  const response = await fetchPromise;
  if (response) return response;

  if (request.mode === "navigate") {
    return cache.match("/");
  }
  throw new Error("No cached response and network unavailable");
};

self.addEventListener("fetch", (event) => {
  event.respondWith(handleNetworkRequest(event.request));
});
