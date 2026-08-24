/**
 * NIP-5A nsites: the verification half.
 *
 * An nsite manifest carries the same `path`/`x`/`server` tags a napplet
 * manifest does — a napplet is an nsite with capability tags on top — so the
 * check is the same walk: the author's signature over the tag list, then every
 * blob fetched from Blossom and hashed against the entry that list names.
 *
 * What differs is where it runs, and that is `nsite-serve.ts`. A napplet is one
 * `index.html` in a `srcdoc` frame and needs no origin. An nsite is a *site*: it
 * asks for `/assets/…` at runtime, calls `fetch()` against its own root, and
 * builds URLs its HTML never names — so it gets an origin of its own, which is
 * also what keeps it away from grimoire's storage and keys.
 */

import {
  fetchBlob,
  verifyManifestSignature,
  verifyBlobHash,
  verifyAggregate,
  pathEntriesFromTags,
  computeAggregateHash,
} from "./kehto";
import type { NostrEvent } from "@/types/nostr";
import {
  getNsiteTitle,
  getNsiteDescription,
  getNsiteServers,
  getNsiteAggregateHash,
  getNsiteIdentifier,
} from "@/lib/nip5a-helpers";

/**
 * Verified blobs, keyed by their own hash.
 *
 * A content address cannot go stale, so a hit is always valid — and re-running
 * a site is otherwise a full re-download of every file, which for a 500-file
 * site is a long wait for bytes already on disk. Bytes from here are hashed
 * again on the way out: cheap, and the cache is not a trust boundary.
 */
const BLOB_CACHE_NAME = "nsite-blobs";

let blobCache: Promise<Cache | null> | null = null;

function getBlobCache(): Promise<Cache | null> {
  // Cache Storage is unavailable in some contexts; an absent cache only costs
  // a re-fetch, so never fail a load over it.
  blobCache ??= caches.open(BLOB_CACHE_NAME).catch(() => null);
  return blobCache;
}

export class NsiteResolutionError extends Error {
  constructor(
    readonly code:
      | "bad-signature"
      | "bad-aggregate"
      | "blob-unavailable"
      | "bad-blob-hash"
      | "missing-index",
    message: string,
  ) {
    super(message);
    this.name = "NsiteResolutionError";
  }
}

export interface ResolvedNsite {
  /** Paths whose blob no server would serve. Absent from `files`. */
  missing: readonly string[];
  /** The computed content address. Also the URL segment it is served under. */
  aggregateHash: string;
  /**
   * What the manifest's own `x` tag says, and whether it agrees.
   *
   * `absent` and `mismatch` are both common in the wild and neither weakens
   * what was actually checked — see the note on `resolveNsiteFromEvent`.
   */
  aggregate: "verified" | "absent" | "mismatch";
  identifier: string;
  title?: string;
  description?: string;
  /** Verified bytes keyed by manifest path, e.g. `/index.html`. */
  files: Map<string, Uint8Array>;
  manifestEvent: NostrEvent;
}

/** The path a site's entry point lives at, in the order worth trying. */
const INDEX_PATHS = ["/index.html", "/index.htm", "index.html"];

/**
 * One verified blob: from the cache if it is there, otherwise from a server.
 *
 * Hashed on the way out either way — `fetchBlob` already checks what a server
 * returns, and the cache is not a trust boundary.
 */
async function fetchVerified(
  entry: { path: string; sha256: string },
  servers: readonly string[],
  tried: Set<string>,
): Promise<Uint8Array> {
  const cache = await getBlobCache();
  const cacheKey = `/_nsite-blob/${entry.sha256}`;

  const hit = await cache?.match(cacheKey);
  if (hit) {
    const cached = new Uint8Array(await hit.arrayBuffer());
    if (verifyBlobHash(cached, entry.sha256)) return cached;
  }

  for (const server of servers) tried.add(server);
  const bytes = await fetchBlob(servers, entry.sha256, async (url) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`blob ${url}: ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  });
  if (!verifyBlobHash(bytes, entry.sha256)) {
    throw new Error(`${entry.path} did not hash to what the manifest declared`);
  }

  await cache?.put(
    cacheKey,
    new Response(bytes.slice() as Uint8Array<ArrayBuffer>),
  );
  return bytes;
}

/**
 * Verify an nsite manifest into its file set.
 *
 * Two checks are load-bearing and both are hard failures:
 *
 *  - the **signature**, which is what makes the tag list the author's. Every
 *    `path`/`x`/`server` tag is inside the signed event, so a relay cannot add,
 *    drop or alter one.
 *  - the **per-file hash**, which is what makes each blob the one that list
 *    named. A Blossom server can return any bytes it likes; these are checked
 *    against a hash the author signed, so it cannot substitute content.
 *
 * The NIP-5A **aggregate is not a third gate**, and treating it as one was
 * wrong. It exists to catch a truncated path list — but the signature already
 * covers the whole tag list, so against a hostile relay it adds nothing the
 * signature has not already settled. What it really catches is a publisher
 * computing it differently, which is exactly what is out there: of four
 * manifests sampled live, two carried no `x` at all and two carried one that
 * disagreed with `computeAggregateHash`. Refusing those would refuse every
 * nsite that exists; claiming they verified would be a lie. So it is checked,
 * reported on the window, and never the reason a site will not run.
 *
 * The content address is always *computed*, never the declared `x`. A URL is
 * built from it, and a value a publisher got wrong must not become a path.
 */
export async function resolveNsiteFromEvent(
  event: NostrEvent,
  onProgress?: (progress: { done: number; total: number }) => void,
): Promise<ResolvedNsite> {
  if (!verifyManifestSignature(event)) {
    throw new NsiteResolutionError(
      "bad-signature",
      "The manifest's signature does not match its author.",
    );
  }
  const entries = pathEntriesFromTags(event.tags);
  if (entries.length === 0) {
    throw new NsiteResolutionError(
      "missing-index",
      "The manifest lists no files.",
    );
  }

  const servers = getNsiteServers(event);
  const files = new Map<string, Uint8Array>();
  const missing: string[] = [];
  const tried = new Set<string>();
  let done = 0;

  /*
   * One unavailable blob must not cost the whole site.
   *
   * A 225-file site with a dead 404.html is still a working site, and failing
   * it outright — which this used to do — meant a single unreachable asset on
   * one Blossom server made the whole thing unrunnable. Missing paths are
   * recorded and simply absent from the cache, so the worker 404s them exactly
   * as a static host would. The index is the one file that is not optional,
   * and that is checked below.
   *
   * Bounded concurrency rather than one at a time: sequential was minutes for
   * a few hundred files, and unbounded opens a few hundred sockets at once.
   */
  const CONCURRENCY = 8;
  let cursor = 0;
  const worker = async () => {
    while (cursor < entries.length) {
      const entry = entries[cursor++];
      try {
        files.set(entry.path, await fetchVerified(entry, servers, tried));
      } catch {
        missing.push(entry.path);
      }
      onProgress?.({ done: ++done, total: entries.length });
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, entries.length) }, worker),
  );

  if (!INDEX_PATHS.some((path) => files.has(path))) {
    throw new NsiteResolutionError(
      "missing-index",
      "The manifest lists no index.html, so there is nothing to open.",
    );
  }

  const declared = getNsiteAggregateHash(event);
  const aggregateHash = computeAggregateHash(entries);

  return {
    missing,
    aggregateHash,
    aggregate: !declared
      ? "absent"
      : verifyAggregate(event.tags)
        ? "verified"
        : "mismatch",
    identifier: getNsiteIdentifier(event) ?? "",
    title: getNsiteTitle(event),
    description: getNsiteDescription(event),
    files,
    manifestEvent: event,
  };
}

/** Which of the known index paths this site actually carries. */
export function indexPathOf(files: Map<string, Uint8Array>): string {
  return INDEX_PATHS.find((path) => files.has(path)) ?? "/index.html";
}
