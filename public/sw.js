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
  //
  // The map is consulted after an awaited read, because a service worker is
  // killed when it goes idle and comes back with nothing in memory — a lazily
  // imported route chunk minutes later hit exactly that, and failed with the
  // file sitting in the cache the whole time. So the decision is async, and
  // anything that is not an nsite's request is passed straight through.
  if (mightBeNsite(event)) {
    event.respondWith(
      nsiteFor(event).then((base) =>
        base ? serveNsite(event, base) : fetch(event.request),
      ),
    );
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
 * Which site a frame is running, keyed by its client id.
 *
 * This is the trick that makes a site's own router work. Served under
 * `/_nsite/<hash>/`, a site reads that as the current path and renders its 404
 * — Armada and ditto both did. A site has to believe it is at the root, so its
 * frame is pointed at `/?nsite=<hash>`: the pathname is `/`, which is what the
 * router sees, and the query says which site, once.
 *
 * The query only has to survive the first request. After that the frame has a
 * client id and every later request is matched on that — including requests
 * made after the app has pushState'd the URL somewhere else entirely. A
 * referrer can be rewritten by the page and a pathname is the app's to change;
 * a client id is neither.
 */
const siteByClient = new Map();

/** Ids mean nothing once their client is gone; do not grow forever. */
async function forgetDeadClients() {
  if (siteByClient.size < 32) return;
  const alive = new Set((await self.clients.matchAll()).map((c) => c.id));
  for (const id of siteByClient.keys()) {
    if (!alive.has(id)) siteByClient.delete(id);
  }
}

/**
 * Cheap synchronous filter: could this request possibly be an nsite's?
 *
 * Anything that is not is left completely alone, which is what keeps grimoire's
 * own requests — and Vite's — on exactly the path they were on before. A frame
 * running a site is a client we have seen navigate, so `clientId` is the test;
 * a navigation carrying `?nsite=` is the one request that has no client yet.
 */
function mightBeNsite(event) {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith(NSITE_PREFIX)) return true;
  if (url.searchParams.get("nsite")) return true;
  if (nsiteClientIds.has(event.clientId)) return true;
  return nsiteBaseOf(event.request.referrer) !== null;
}

/**
 * Every client id that has ever navigated to a site, across restarts.
 *
 * The memory map is not enough on its own: a service worker is killed when it
 * goes idle, and Armada's lazily imported route chunk arrived minutes later at
 * a worker that had forgotten the frame entirely — the import failed with the
 * file sitting in the cache the whole time. So the ids are persisted, and the
 * synchronous filter above reads this set rather than the map.
 */
const nsiteClientIds = new Set();

/** Where the map survives a worker being killed. A cache is the only store. */
const CLIENTS_KEY = "/_nsite-clients";
let loaded = null;

async function loadClients() {
  loaded ??= (async () => {
    try {
      const cache = await caches.open(NSITE_CACHE_NAME);
      const stored = await cache.match(CLIENTS_KEY);
      if (!stored) return;
      for (const [id, hash] of Object.entries(await stored.json())) {
        siteByClient.set(id, hash);
        nsiteClientIds.add(id);
      }
    } catch {
      // An unreadable map only costs the referrer fallback below.
    }
  })();
  return loaded;
}

async function saveClients() {
  try {
    const cache = await caches.open(NSITE_CACHE_NAME);
    await cache.put(
      CLIENTS_KEY,
      new Response(JSON.stringify(Object.fromEntries(siteByClient)), {
        headers: { "content-type": "application/json" },
      }),
    );
  } catch {
    // Losing the map costs a reload, not correctness.
  }
}

/**
 * Which site this request belongs to, or null.
 *
 * Not a trust decision in any form. Everything it can answer with comes out of
 * a cache whose bytes were signature- and hash-checked before they were
 * written, so the worst a forged referrer or guessed id achieves is reading a
 * file that could have been requested by its own `/_nsite/` path anyway.
 */
async function nsiteFor(event) {
  const url = new URL(event.request.url);

  // The entry navigation — the only request that carries the hash.
  const requested = url.searchParams.get("nsite");
  if (requested && /^[0-9a-f]{64}$/.test(requested)) {
    // A navigation has no `clientId` yet; it names the client it will create.
    const id = event.resultingClientId || event.clientId;
    if (id) {
      await loadClients();
      siteByClient.set(id, requested);
      nsiteClientIds.add(id);
      void forgetDeadClients();
      void saveClients();
    }
    return `${NSITE_PREFIX}${requested}/`;
  }

  // Everything the site asks for afterwards, at whatever path it invents.
  await loadClients();
  const known = siteByClient.get(event.clientId);
  if (known) return `${NSITE_PREFIX}${known}/`;

  // Direct `/_nsite/…` URLs still resolve, and a referrer covers the rest.
  return nsiteBaseOf(url.href) ?? nsiteBaseOf(event.request.referrer);
}

/** The `/_nsite/<aggregate>/` prefix a URL belongs to, or null. */
function nsiteBaseOf(url) {
  if (!url) return null;
  try {
    const { pathname, searchParams } = new URL(url, self.location.origin);
    const inPath = pathname.match(/^(\/_nsite\/[0-9a-f]{64}\/)/);
    if (inPath) return inPath[1];
    const inQuery = searchParams.get("nsite");
    return inQuery && /^[0-9a-f]{64}$/.test(inQuery)
      ? `${NSITE_PREFIX}${inQuery}/`
      : null;
  } catch {
    return null;
  }
}

async function serveNsite(event, base) {
  const url = new URL(event.request.url);
  const cache = await caches.open(NSITE_CACHE_NAME);

  // The entry navigation itself.
  if (url.searchParams.get("nsite")) {
    const index = await cache.match(`${base}index.html`);
    if (index) return index;
  }

  // Already absolute within a site.
  const direct = await cache.match(url.pathname);
  if (direct) return direct;

  // Root-absolute, which is how a built site names its own bundle.
  const rerooted = await cache.match(
    `${base}${url.pathname.replace(/^\//, "")}`,
  );
  if (rerooted) return rerooted;

  // A client-routed path the site never shipped a file for. Its entry document
  // is what a static host would answer, and what a single-page app expects.
  if (!looksLikeAsset(url.pathname)) {
    const index = await cache.match(`${base}index.html`);
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
