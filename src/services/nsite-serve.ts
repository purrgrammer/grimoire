/**
 * Putting a verified nsite where the worker can serve it.
 *
 * Nothing is injected into the bytes. An nsite is served from grimoire's own
 * origin, so a NIP-07 extension reaches it exactly as it reaches any other
 * page, and shimming `window.nostr` ourselves would either lose that race or
 * shadow the signer the user actually chose. The consequence is the honest
 * one: with no extension installed, an nsite has no signer — the same as
 * visiting it at a gateway.
 *
 * The worker (`public/nsite-sw.js`) is deliberately dumb: it answers from a
 * cache and never verifies anything. That is only safe because everything
 * written here has already been through `resolveNsiteFromEvent` — the author's
 * signature over the tag list, and every file hashed against the entry that
 * list names. **Never write to this cache from anywhere else.**
 *
 * The site is served under `/_nsite/<aggregateHash>/`, so the URL *is* the
 * content address: two sites cannot collide, a changed site is a different
 * prefix, and a stale cache entry can never be served for a different version.
 */

import {
  NSITE_CACHE_NAME,
  NSITE_SCOPE,
  indexPathOf,
  type ResolvedNsite,
} from "./nsite-host";

/** Guessed from the path, because a manifest declares no content types. */
const MIME: Record<string, string> = {
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  wasm: "application/wasm",
  txt: "text/plain; charset=utf-8",
  xml: "application/xml",
  webmanifest: "application/manifest+json",
};

function contentTypeFor(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return MIME[ext] ?? "application/octet-stream";
}

/** Resolve once this registration has a worker that can answer a fetch. */
function activated(registration: ServiceWorkerRegistration): Promise<void> {
  const worker =
    registration.active ?? registration.waiting ?? registration.installing;
  if (!worker || worker.state === "activated") return Promise.resolve();
  return new Promise((resolve) => {
    const onChange = () => {
      if (worker.state === "activated" || worker.state === "redundant") {
        worker.removeEventListener("statechange", onChange);
        resolve();
      }
    };
    worker.addEventListener("statechange", onChange);
  });
}

let registration: Promise<ServiceWorkerRegistration | null> | null = null;

/**
 * Make sure a worker that can serve nsites is running.
 *
 * It is grimoire's own `sw.js`, at scope `/`, because a registration is keyed
 * by scope: a second script at `/` would replace the first, and anything
 * narrower cannot see `/assets/…` — the root-absolute paths real sites are
 * built with. See the header of `public/sw.js`.
 *
 * In production that worker is already registered by `main.tsx` and this finds
 * it. In development `main.tsx` deliberately does not register it, so this does
 * — with `?mode=dev`, which turns off every caching path in the script. The
 * hazard that rule exists for is caching Vite's hashed module URLs; in dev mode
 * the worker caches nothing and answers only for nsite frames.
 */
export function ensureNsiteWorker(): Promise<ServiceWorkerRegistration | null> {
  registration ??= (async () => {
    if (!("serviceWorker" in navigator)) return null;
    try {
      const script = import.meta.env.DEV ? "/sw.js?mode=dev" : "/sw.js";

      /*
       * Adopt what is registered ONLY if it is the script we would register.
       *
       * Checking merely that something holds `/` is not enough, and cost a real
       * regression: a stale registration from an older build was adopted in
       * development, and being a non-dev worker it precached and cached exactly
       * the Vite URLs this whole arrangement exists to leave alone. A worker at
       * `/` that is not ours is replaced, which is what registering does.
       */
      const existing = await navigator.serviceWorker.getRegistration("/");
      const running = existing?.active ?? existing?.waiting;
      if (
        running &&
        new URL(running.scriptURL).search ===
          new URL(script, location.origin).search
      ) {
        return existing!;
      }

      const registered = await navigator.serviceWorker.register(script, {
        scope: "/",
      });
      // A registration that is installing cannot answer a fetch yet, and the
      // frame is about to make one.
      await activated(registered);
      return registered;
    } catch {
      return null;
    }
  })();
  return registration;
}

/** Where a resolved site's entry document is served from. */
export function nsiteUrl(aggregateHash: string): string {
  return `${NSITE_SCOPE}${aggregateHash}/index.html`;
}

/**
 * Write a verified site into the worker's cache and return its entry URL.
 *
 * Idempotent by content address: re-serving the same site overwrites identical
 * bytes at identical URLs, so a second run is a no-op rather than a duplicate.
 */
export async function serveNsite(resolved: ResolvedNsite): Promise<string> {
  await ensureNsiteWorker();

  const cache = await caches.open(NSITE_CACHE_NAME);
  const base = `${NSITE_SCOPE}${resolved.aggregateHash}`;
  const index = indexPathOf(resolved.files);

  for (const [path, bytes] of resolved.files) {
    const normalised = path.startsWith("/") ? path : `/${path}`;
    // A fresh copy: a Uint8Array view over a pooled buffer would hand the
    // cache more bytes than the file.
    const body: BodyInit = bytes.slice() as Uint8Array<ArrayBuffer>;

    await cache.put(
      `${base}${normalised}`,
      new Response(body, {
        headers: {
          "content-type": contentTypeFor(path),
          // The URL is a content address, so this can never go stale.
          "cache-control": "public, max-age=31536000, immutable",
        },
      }),
    );
  }

  // Served at a stable name whatever the manifest called its entry document.
  if (index !== "/index.html") {
    const entry = await cache.match(`${base}${index}`);
    if (entry) await cache.put(`${base}/index.html`, entry.clone());
  }

  return nsiteUrl(resolved.aggregateHash);
}

/** Drop one site's files. The cache is content-addressed, so this is exact. */
export async function forgetServedNsite(aggregateHash: string): Promise<void> {
  const cache = await caches.open(NSITE_CACHE_NAME);
  const keys = await cache.keys();
  await Promise.all(
    keys
      .filter((request) =>
        new URL(request.url).pathname.startsWith(
          `${NSITE_SCOPE}${aggregateHash}/`,
        ),
      )
      .map((request) => cache.delete(request)),
  );
}
