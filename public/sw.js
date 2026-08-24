// Grimoire Service Worker - v2.0.0
// Bump BOTH names to invalidate: activate deletes every cache not named here.
const CACHE_NAME = "grimoire-v2";
const RUNTIME_CACHE = "grimoire-runtime-v2";

// Core assets to cache on install
const PRECACHE_URLS = [
  "/",
  "/index.html",
  "/favicon.ico",
  "/favicon-192x192.png",
  "/favicon-512x512.png",
];

// Install event - precache core assets
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_URLS);
    }),
  );
  // Activate immediately
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME && name !== RUNTIME_CACHE)
          .map((name) => caches.delete(name)),
      );
    }),
  );
  // Take control immediately
  self.clients.claim();
});

// Fetch event - network first, fallback to cache
self.addEventListener("fetch", (event) => {
  // Skip non-GET requests
  if (event.request.method !== "GET") return;

  // Skip cross-origin requests
  if (!event.request.url.startsWith(self.location.origin)) return;

  // Never cache dev-server URLs; their hashes change and cached copies rot.
  const { pathname } = new URL(event.request.url);
  if (
    pathname.startsWith("/@vite") ||
    pathname.startsWith("/@react-refresh") ||
    pathname.startsWith("/@fs") ||
    pathname.startsWith("/@id") ||
    pathname.startsWith("/node_modules/") ||
    pathname.startsWith("/src/")
  ) {
    return;
  }

  // Network first strategy for app shell and assets
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Clone the response before caching
        const responseClone = response.clone();

        // Cache successful responses
        if (response.status === 200) {
          caches.open(RUNTIME_CACHE).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }

        return response;
      })
      .catch(() => {
        // Fallback to cache if network fails
        return caches.match(event.request).then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }

          // If no cache, return offline page for navigation requests
          if (event.request.mode === "navigate") {
            return caches.match("/index.html");
          }

          // For other requests, just fail
          return new Response("Offline", {
            status: 503,
            statusText: "Service Unavailable",
          });
        });
      }),
  );
});
