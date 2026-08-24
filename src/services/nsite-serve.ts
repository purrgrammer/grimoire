/**
 * Handing a verified nsite to its own origin.
 *
 * A site does not run on grimoire's origin. It runs on one of its own —
 * `<aggregate>.localhost:<port>` in development, a wildcard subdomain in
 * production — and that is a security boundary, not a tidiness preference. On
 * grimoire's origin an iframe with `allow-same-origin` can read `localStorage`,
 * which holds `accountManager.toJSON()` and therefore a secret key for an nsec
 * login; it can read the Dexie database; and it can register a service worker
 * over grimoire's own. Verification does not help there, because it proves an
 * author signed the code, not that the author is honest.
 *
 * A separate origin makes all of that unreachable by construction, and it comes
 * with a bonus: the site is genuinely at `/`, so its router works, its absolute
 * asset paths resolve, and none of the re-rooting this used to need exists.
 *
 * The handshake, since a cross-origin child cannot be scripted:
 *
 *   1. the frame loads `_nsite-boot.html` — the one file grimoire serves there
 *   2. it registers the worker for that origin and posts `ready`
 *   3. this sends the verified files, transferring the buffers
 *   4. it caches them and replaces itself with `/`
 */

import { indexPathOf, type ResolvedNsite } from "./nsite-host";

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

/**
 * Where a production build serves nsites from.
 *
 * Deliberately a different registrable domain rather than a subdomain of
 * grimoire's own: subdomains share cookies and can be reached by a `document
 * .domain` relaxation, and an isolation boundary that a site can talk its way
 * across is not one. Unset means nsites do not run — a missing origin must fail
 * closed, never quietly fall back to grimoire's.
 */
const PRODUCTION_ORIGIN = import.meta.env.VITE_NSITE_ORIGIN as
  string | undefined;

/**
 * The aggregate hash as a hostname label.
 *
 * A DNS label may be 63 characters and a hex hash is 64, which the browser
 * rejects outright — `DNS_PROBE_FINISHED_NXDOMAIN`, before anything of ours
 * runs. Base36 of the same 256 bits is 50, so the whole content address still
 * fits and no two sites can share a label.
 */
export function nsiteLabel(aggregateHash: string): string {
  return BigInt(`0x${aggregateHash}`).toString(36);
}

/**
 * The origin one site gets to itself.
 *
 * `*.localhost` needs no DNS and no certificate — Chrome and Firefox resolve
 * every label to loopback, and each is a distinct origin and a secure context,
 * which is what service workers require. Vite serves it because the port is
 * what it listens on; `server.allowedHosts` in `vite.config.ts` is what lets
 * the host header through.
 */
export function nsiteOrigin(aggregateHash: string): string | null {
  const label = nsiteLabel(aggregateHash);
  if (import.meta.env.DEV) {
    return `${location.protocol}//${label}.localhost:${location.port}`;
  }
  if (!PRODUCTION_ORIGIN) return null;
  const { protocol, host } = new URL(PRODUCTION_ORIGIN);
  return `${protocol}//${label}.${host}`;
}

/** The boot document's URL on a site's own origin. */
export function nsiteBootUrl(aggregateHash: string): string | null {
  const origin = nsiteOrigin(aggregateHash);
  return origin ? `${origin}/_nsite-boot.html` : null;
}

interface WireFile {
  bytes: ArrayBuffer;
  type: string;
}

/**
 * Hand a verified site to its own origin, and resolve once it has taken it.
 *
 * The frame is the caller's — this only talks to it. Buffers are transferred
 * rather than copied, so a 500-file site does not exist twice in memory, which
 * also means `resolved.files` must not be read again afterwards.
 */
export function serveNsiteToFrame(
  frame: HTMLIFrameElement,
  resolved: ResolvedNsite,
): Promise<void> {
  const origin = nsiteOrigin(resolved.aggregateHash);
  if (!origin) {
    return Promise.reject(
      new Error(
        "No origin is configured to run nsites on, so this one was not run.",
      ),
    );
  }

  const index = indexPathOf(resolved.files);
  const files: Record<string, WireFile> = {};
  const transfer: ArrayBuffer[] = [];

  for (const [path, bytes] of resolved.files) {
    const normalised = path.startsWith("/") ? path : `/${path}`;
    // A fresh copy: a view over a pooled buffer would hand the other origin
    // more bytes than the file, and a transferred view must own its buffer.
    const copy = bytes.slice().buffer as ArrayBuffer;
    files[normalised] = { bytes: copy, type: contentTypeFor(path) };
    transfer.push(copy);
  }

  // Served at a stable name whatever the manifest called its entry document.
  if (index !== "/index.html" && files[index]) {
    files["/index.html"] = files[index];
  }

  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("The nsite origin never answered."));
    }, 30_000);

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== origin) return;
      if (event.source !== frame.contentWindow) return;

      if (event.data?.nsite === "ready") {
        frame.contentWindow?.postMessage(
          { nsite: "files", files },
          origin,
          transfer,
        );
        cleanup();
        resolve();
        return;
      }
      if (event.data?.nsite === "error") {
        cleanup();
        reject(new Error(String(event.data.message)));
      }
    };

    function cleanup() {
      clearTimeout(timer);
      window.removeEventListener("message", onMessage);
    }

    window.addEventListener("message", onMessage);
  });
}
