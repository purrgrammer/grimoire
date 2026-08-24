// Serves one verified NIP-5A nsite, on that nsite's own origin.
//
// It is scoped to `/` and it is the only thing running there, because the
// origin belongs to a single site: `<aggregate>.localhost` in development, a
// wildcard subdomain in production. That isolation is the entire point —
// grimoire's localStorage, its IndexedDB and its own worker are on a different
// origin and unreachable from here, which was not true when a site was served
// from a path on grimoire's own origin.
//
// Deliberately dumb. Every byte it serves was checked against a signed manifest
// by `nsite-host.ts` on grimoire's side before being handed over, so there is no
// verification here to get wrong: a fetch is a cache lookup or a 404.

const CACHE = "nsite-files";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  // Claim immediately: the boot page navigates the moment this activates, and
  // an unclaimed worker would let that navigation fall through to the network.
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  // The boot page is grimoire's, not the site's, and must keep working.
  if (url.pathname === "/_nsite-boot.html") return;

  event.respondWith(serve(url));
});

async function serve(url) {
  const cache = await caches.open(CACHE);

  const direct = await cache.match(url.pathname);
  if (direct) return direct;

  // A client-routed path the site never shipped a file for. Its entry document
  // is what a static host would answer, and what a single-page app expects.
  if (!looksLikeAsset(url.pathname)) {
    const index = await cache.match("/index.html");
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
