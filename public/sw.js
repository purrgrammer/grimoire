// Grimoire Service Worker - v2.0.0
// Bump BOTH names to invalidate: activate deletes every cache not named here.
const CACHE_NAME = "grimoire-v2";
const RUNTIME_CACHE = "grimoire-runtime-v2";

/*
 * Two jobs, one worker, because a registration is keyed by SCOPE: two scripts
 * cannot both hold `/`, and registering a second would replace this one.
 *
 * The second job is serving verified NIP-5A nsites, and it needs scope `/`
 * rather than something narrower. A site asks for `/assets/index-abc.js` — an
 * absolute path from the origin root — so a worker scoped to `/_nsite/` never
 * sees the request, the server answers it with grimoire's own index.html, and
 * the browser refuses to run HTML as JavaScript. The site never mounts.
 *
 * `?mode=dev` turns the CACHING half off entirely, which is the whole reason
 * `main.tsx` kept this worker out of development: it would cache Vite's hashed
 * module URLs, which die on the next dependency change and break dynamic
 * imports. In dev this worker caches nothing, precaches nothing and deletes
 * nothing — it answers for nsite frames and lets every other request fall
 * through untouched, exactly as if no worker were installed.
 */
const DEV = new URL(self.location.href).searchParams.get("mode") === "dev";

const NSITE_PREFIX = "/_nsite/";
const NSITE_CACHE_NAME = "nsite-artifacts";
const NSITE_BLOB_CACHE_NAME = "nsite-blobs";

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
  if (!DEV) {
    event.waitUntil(
      caches.open(CACHE_NAME).then((cache) => {
        return cache.addAll(PRECACHE_URLS);
      }),
    );
  }
  // Activate immediately
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener("activate", (event) => {
  if (!DEV) {
    event.waitUntil(
      caches.keys().then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter(
              (name) =>
                name !== CACHE_NAME &&
                name !== RUNTIME_CACHE &&
                // Not ours to clear. These hold verified nsite bytes, and
                // dropping them would silently unserve every running site.
                name !== NSITE_CACHE_NAME &&
                name !== NSITE_BLOB_CACHE_NAME,
            )
            .map((name) => caches.delete(name)),
        );
      }),
    );
  }
  // Take control immediately
  self.clients.claim();
});

// Fetch event - network first, fallback to cache
self.addEventListener("fetch", (event) => {
  // Skip non-GET requests
  if (event.request.method !== "GET") return;

  // Skip cross-origin requests
  if (!event.request.url.startsWith(self.location.origin)) return;

  // A running nsite's own request, wherever it points. Answered only from
  // bytes that were signature- and hash-checked before being cached.
  if (isNsiteRequest(event)) {
    event.respondWith(serveNsite(event));
    return;
  }

  // In development that is the ONLY thing this worker does.
  if (DEV) return;

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

/* -------------------------------------------------------------------------- */
/*  nsites                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Whether this request belongs to a running nsite.
 *
 * Two ways in. Either the URL is already under `/_nsite/` — the entry document,
 * and anything resolved relative to it — or the request came FROM a document
 * under `/_nsite/`, which is what makes `/assets/index-abc.js` recognisable as
 * that site's asset rather than one of grimoire's.
 *
 * The referrer is not a trust decision. Everything answered below comes out of
 * a cache whose bytes were verified before they were written, so the worst a
 * forged referrer achieves is reading a file the requester could have asked for
 * by its own `/_nsite/` path anyway.
 */
function isNsiteRequest(event) {
  if (new URL(event.request.url).pathname.startsWith(NSITE_PREFIX)) return true;
  return nsiteBaseOf(event.request.referrer) !== null;
}

/** The `/_nsite/<aggregate>/` prefix a URL belongs to, or null. */
function nsiteBaseOf(url) {
  if (!url) return null;
  try {
    const { pathname } = new URL(url, self.location.origin);
    const match = pathname.match(/^(\/_nsite\/[0-9a-f]{64}\/)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

async function serveNsite(event) {
  const url = new URL(event.request.url);
  const cache = await caches.open(NSITE_CACHE_NAME);

  // Already absolute within a site.
  const direct = await cache.match(url.pathname);
  if (direct) return direct;

  // Root-absolute, from a site's own document: re-root it under that site.
  const base = nsiteBaseOf(event.request.referrer);
  if (base) {
    const rerooted = await cache.match(
      `${base}${url.pathname.replace(/^\//, "")}`,
    );
    if (rerooted) return rerooted;
  }

  // A client-routed path the site never shipped a file for. Its entry document
  // is what a static host would answer, and what a single-page app expects.
  const site = base ?? nsiteBaseOf(url.href);
  if (site && !looksLikeAsset(url.pathname)) {
    const index = await cache.match(`${site}index.html`);
    if (index) return index;
  }

  return new Response("Not found in this nsite.", {
    status: 404,
    headers: { "content-type": "text/plain" },
  });
}

/** A missing asset must 404, or a broken script tag silently becomes HTML. */
function looksLikeAsset(pathname) {
  return /\.[a-z0-9]{1,8}$/i.test(pathname) && !/\.html?$/i.test(pathname);
}
