// Grimoire nsite worker — serves verified NIP-5A sites, and nothing else.
//
// Scope is `/_nsite/`, which is the entire safety argument for registering a
// worker in development at all. Grimoire's own `sw.js` is production-only
// because it would cache Vite's hashed module URLs and break dynamic imports on
// the next dependency change; a worker that can only ever see `/_nsite/*` is
// structurally incapable of touching them.
//
// It is deliberately dumb. Every byte it serves was hashed and aggregate-checked
// by `src/services/nsite-host.ts` before being written to the cache, so there is
// no verification here to get wrong — a fetch is a cache lookup or a 404.

const NSITE_CACHE_NAME = "nsite-artifacts";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  // Claim immediately: the frame that triggered the install is already loading,
  // and an unclaimed worker would let its first request fall through to the
  // network, where `/_nsite/…` is a 404 from grimoire's own server.
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith("/_nsite/")) return;

  event.respondWith(serve(url));
});

async function serve(url) {
  const cache = await caches.open(NSITE_CACHE_NAME);

  const direct = await cache.match(url.pathname);
  if (direct) return direct;

  // A site routing client-side asks for paths it never shipped a file for, and
  // the honest answer for a single-page app is its entry document rather than a
  // 404 — the same thing a static host does. Only within one site's own prefix.
  const site = url.pathname.match(/^(\/_nsite\/[0-9a-f]{64}\/)/);
  if (site) {
    const index = await cache.match(`${site[1]}index.html`);
    if (index && !looksLikeAsset(url.pathname)) return index;
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
