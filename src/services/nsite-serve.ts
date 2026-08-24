/**
 * Putting a verified nsite where the worker can serve it, and giving it a
 * `window.nostr`.
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
 * Register the nsite worker, once.
 *
 * Registered in development as well as production — see the scope argument in
 * `nsite-host.ts`. `main.tsx` tears down leftover workers in dev, so it skips
 * this one by scope; if that ever stops matching, an nsite simply 404s rather
 * than serving anything unverified.
 */
export function ensureNsiteWorker(): Promise<ServiceWorkerRegistration | null> {
  registration ??= (async () => {
    if (!("serviceWorker" in navigator)) return null;
    try {
      const existing =
        await navigator.serviceWorker.getRegistration(NSITE_SCOPE);
      if (existing?.active && existing.scope.endsWith(NSITE_SCOPE)) {
        return existing;
      }
      const registered = await navigator.serviceWorker.register(
        "/nsite-sw.js",
        { scope: NSITE_SCOPE },
      );
      // A registration that is installing cannot answer a fetch yet, and the
      // frame is about to make one. NOT `navigator.serviceWorker.ready`: that
      // waits for a worker controlling THIS page, and one scoped to `/_nsite/`
      // never will — awaiting it hangs forever, which it did.
      await activated(registered);
      return registered;
    } catch {
      return null;
    }
  })();
  return registration;
}

/**
 * The NIP-07 bridge, injected into the served entry document.
 *
 * An nsite gets `window.nostr` where a napplet gets the Kehto bridge: it is an
 * ordinary web page that happens to be verified, and NIP-07 is the interface an
 * ordinary web page already knows how to use. Every call is a `postMessage` the
 * host answers — the frame never sees a key, and `getPublicKey` is as much as
 * it can learn without the user approving a signature.
 *
 * Injected at cache-write time rather than by the worker, so the worker stays a
 * cache lookup and this stays testable as a string.
 */
export function nostrBridgeScript(): string {
  return `<script>(() => {
  const pending = new Map();
  let seq = 0;
  addEventListener("message", (e) => {
    const d = e.data;
    if (!d || d.__nsite !== "reply") return;
    const entry = pending.get(d.id);
    if (!entry) return;
    pending.delete(d.id);
    d.error ? entry.reject(new Error(d.error)) : entry.resolve(d.result);
  });
  const call = (method, params) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    parent.postMessage({ __nsite: "call", id, method, params }, "*");
  });
  window.nostr = {
    getPublicKey: () => call("getPublicKey"),
    signEvent: (event) => call("signEvent", { event }),
    getRelays: () => call("getRelays"),
    nip04: {
      encrypt: (pubkey, plaintext) => call("nip04.encrypt", { pubkey, plaintext }),
      decrypt: (pubkey, ciphertext) => call("nip04.decrypt", { pubkey, ciphertext }),
    },
    nip44: {
      encrypt: (pubkey, plaintext) => call("nip44.encrypt", { pubkey, plaintext }),
      decrypt: (pubkey, ciphertext) => call("nip44.decrypt", { pubkey, ciphertext }),
    },
  };
})();</script>`;
}

/** Put the bridge before anything the page ships, so it exists on first script. */
function injectBridge(html: string): string {
  const script = nostrBridgeScript();
  const head = html.match(/<head[^>]*>/i);
  if (head) {
    const at = html.indexOf(head[0]) + head[0].length;
    return html.slice(0, at) + script + html.slice(at);
  }
  // No <head>: a bare fragment still parses, and the bridge must come first.
  return script + html;
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
    const isIndex = path === index;

    const body: BodyInit = isIndex
      ? injectBridge(new TextDecoder().decode(bytes))
      : // A fresh copy: a Uint8Array view over a pooled buffer would hand the
        // cache more bytes than the file.
        (bytes.slice() as Uint8Array<ArrayBuffer>);

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
