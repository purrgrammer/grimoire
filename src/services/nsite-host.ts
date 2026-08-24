/**
 * NIP-5A nsites, verified and served from a worker-backed origin.
 *
 * An nsite manifest carries the same `path`/`x`/`server` tags a napplet
 * manifest does — a napplet is an nsite with capability tags on top — so the
 * verification is the same walk: check the signature, fetch every blob from
 * Blossom, re-hash each one, then check the aggregate over the whole set.
 *
 * What differs is the serving, and it is the whole difference. A napplet is one
 * `index.html` handed to a `srcdoc` frame, which is why it needs no origin. An
 * nsite is a *site*: it asks for `/_next/static/…` at runtime, calls `fetch()`
 * against its own root, and builds URLs its HTML never names. Rewriting the
 * markup cannot reach any of that, so the files go into a cache the service
 * worker in `public/nsite-sw.js` answers from, and the frame is pointed at a
 * real same-origin URL under `/_nsite/<aggregate>/`.
 *
 * That scope is also the safety argument for registering a worker in dev at
 * all. `main.tsx` refuses to register grimoire's own worker outside production
 * because it would cache Vite's hashed module URLs and break dynamic imports;
 * a worker whose scope is `/_nsite/` cannot see those URLs, so the hazard the
 * rule exists for does not apply to it.
 */

import {
  fetchBlob,
  verifyManifestSignature,
  verifyBlobHash,
  verifyAggregate,
  pathEntriesFromTags,
} from "./kehto";
import type { NostrEvent } from "@/types/nostr";
import {
  getNsiteTitle,
  getNsiteDescription,
  getNsiteServers,
  getNsiteAggregateHash,
  getNsiteIdentifier,
} from "@/lib/nip5a-helpers";

/** Where a running nsite lives, and the scope the worker claims. */
export const NSITE_SCOPE = "/_nsite/";

/** The Cache Storage bucket the worker reads. Never grimoire's own caches. */
export const NSITE_CACHE_NAME = "nsite-artifacts";

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
  /** The verified content address. Also the URL segment it is served under. */
  aggregateHash: string;
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
 * Verify an nsite manifest into its file set.
 *
 * Nothing is trusted until the aggregate matches: a blob server can return any
 * bytes it likes, and the per-file hash only proves the file is the one the
 * manifest named — the aggregate is what proves the manifest names the set the
 * author signed.
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
  if (!verifyAggregate(event.tags)) {
    throw new NsiteResolutionError(
      "bad-aggregate",
      "The manifest's `x` aggregate does not cover the paths it lists.",
    );
  }

  const entries = pathEntriesFromTags(event.tags);
  const servers = getNsiteServers(event);
  const files = new Map<string, Uint8Array>();
  const tried = new Set<string>();
  let done = 0;

  for (const entry of entries) {
    let bytes: Uint8Array;
    try {
      for (const server of servers) tried.add(server);
      // `fetchBlob` re-hashes whatever a server returns, so a lying server is
      // a miss rather than a compromise; this checks again anyway, because the
      // cost is nothing and the file is about to be served from our origin.
      bytes = await fetchBlob(servers, entry.sha256, async (url) => {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) throw new Error(`blob ${url}: ${res.status}`);
        return new Uint8Array(await res.arrayBuffer());
      });
    } catch (error) {
      throw new NsiteResolutionError(
        "blob-unavailable",
        `No server returned ${entry.path}. Tried ${[...tried].join(", ") || "nothing"}. (${String(error)})`,
      );
    }
    if (!verifyBlobHash(bytes, entry.sha256)) {
      throw new NsiteResolutionError(
        "bad-blob-hash",
        `${entry.path} did not hash to what the manifest declared.`,
      );
    }
    files.set(entry.path, bytes);
    onProgress?.({ done: ++done, total: entries.length });
  }

  if (!INDEX_PATHS.some((path) => files.has(path))) {
    throw new NsiteResolutionError(
      "missing-index",
      "The manifest lists no index.html, so there is nothing to open.",
    );
  }

  const aggregateHash = getNsiteAggregateHash(event);
  if (!aggregateHash) {
    // `verifyAggregate` passed, so this cannot happen — but the type says it
    // can, and a content address invented here would be a lie.
    throw new NsiteResolutionError(
      "bad-aggregate",
      "The manifest carries no `x` aggregate tag.",
    );
  }

  return {
    aggregateHash,
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
