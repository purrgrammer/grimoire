import { useState, useEffect } from "react";
import type { NostrEvent } from "@/types/nostr";
import {
  getNsiteTitle,
  getNsiteDescription,
  getNsiteIndexHash,
  getNsiteServers,
  getNsiteGatewayUrl,
} from "@/lib/nip5a-helpers";
import { getBlobUrl } from "@/services/blossom";
import { blossomServerCache } from "@/services/blossom-server-cache";
import db from "@/services/db";

export interface NsiteMetadata {
  title?: string;
  description?: string;
  faviconUrl?: string;
}

// In-memory fast layer (populated from Dexie on first access)
const memoryCache = new Map<string, NsiteMetadata>();

// Track in-flight fetches to avoid duplicate requests
const pendingFetches = new Map<string, Promise<NsiteMetadata | null>>();

async function getCachedMetadata(hash: string): Promise<NsiteMetadata | null> {
  // Memory first
  const mem = memoryCache.get(hash);
  if (mem) return mem;

  // Then Dexie
  try {
    const cached = await db.nsiteMetadata.get(hash);
    if (cached) {
      const metadata: NsiteMetadata = {
        title: cached.title,
        description: cached.description,
        faviconUrl: cached.faviconUrl,
      };
      memoryCache.set(hash, metadata);
      return metadata;
    }
  } catch {
    // Dexie error, continue to fetch
  }

  return null;
}

async function persistMetadata(
  hash: string,
  metadata: NsiteMetadata,
): Promise<void> {
  memoryCache.set(hash, metadata);
  try {
    await db.nsiteMetadata.put({ hash, ...metadata });
  } catch {
    // Non-critical, memory cache is enough
  }
}

async function fetchAndParseIndexHtml(
  hash: string,
  servers: string[],
  baseUrl: string,
  signal: AbortSignal,
): Promise<NsiteMetadata | null> {
  for (const server of servers) {
    try {
      const url = getBlobUrl(server, hash);
      const response = await fetch(url, { signal });
      if (!response.ok) continue;

      const html = await response.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, "text/html");

      // Resolve favicon: try <link rel="icon">, then <link rel="shortcut icon">
      let faviconUrl: string | undefined;
      const iconLink =
        doc.querySelector('link[rel="icon"]') ??
        doc.querySelector('link[rel="shortcut icon"]');
      const iconHref = iconLink?.getAttribute("href");
      if (iconHref) {
        if (iconHref.startsWith("data:")) {
          faviconUrl = iconHref;
        } else {
          try {
            faviconUrl = new URL(iconHref, baseUrl).href;
          } catch {
            // Invalid URL, skip
          }
        }
      }

      const metadata: NsiteMetadata = {
        title: doc.querySelector("title")?.textContent?.trim() || undefined,
        description:
          doc
            .querySelector('meta[name="description"]')
            ?.getAttribute("content")
            ?.trim() || undefined,
        faviconUrl,
      };

      return metadata;
    } catch {
      if (signal.aborted) return null;
      // Try next server
    }
  }
  return null;
}

/**
 * Hook that returns site metadata for an nsite manifest event.
 *
 * Strategy (progressive):
 * 1. Use title/description tags from the event if present
 * 2. Check in-memory cache, then Dexie (persistent across sessions)
 * 3. Fetch index.html from Blossom, parse <head> for title/description/favicon
 * 4. Persist to both caches (keyed by sha256 hash — immutable, no TTL)
 */
export function useNsiteMetadata(event: NostrEvent): {
  title?: string;
  description?: string;
  faviconUrl?: string;
  loading: boolean;
} {
  const tagTitle = getNsiteTitle(event);
  const tagDescription = getNsiteDescription(event);
  const gatewayUrl = getNsiteGatewayUrl(event);

  const [fetched, setFetched] = useState<NsiteMetadata | null>(() => {
    // Sync init from memory cache
    const indexHash = getNsiteIndexHash(event);
    return indexHash ? (memoryCache.get(indexHash) ?? null) : null;
  });
  const [loading, setLoading] = useState(false);

  const indexHash = getNsiteIndexHash(event);
  const needsFetch = !!indexHash;

  useEffect(() => {
    if (!needsFetch || !indexHash) return;

    // Already have it in memory
    const mem = memoryCache.get(indexHash);
    if (mem) {
      setFetched(mem);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;
    setLoading(true);

    (async () => {
      // Check Dexie
      const cached = await getCachedMetadata(indexHash);
      if (cached) {
        if (!cancelled) {
          setFetched(cached);
          setLoading(false);
        }
        return;
      }

      // Deduplicate in-flight fetches
      let fetchPromise = pendingFetches.get(indexHash);
      if (!fetchPromise) {
        fetchPromise = (async () => {
          const eventServers = getNsiteServers(event);
          const authorServers =
            (await blossomServerCache.getServers(event.pubkey)) ?? [];
          const allServers = [...new Set([...eventServers, ...authorServers])];

          if (allServers.length === 0) return null;

          return fetchAndParseIndexHtml(
            indexHash,
            allServers,
            gatewayUrl,
            controller.signal,
          );
        })();
        pendingFetches.set(indexHash, fetchPromise);
      }

      try {
        const result = await fetchPromise;
        pendingFetches.delete(indexHash);
        if (cancelled) return;
        if (result) {
          await persistMetadata(indexHash, result);
          setFetched(result);
        }
      } catch {
        pendingFetches.delete(indexHash);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [needsFetch, indexHash, event, gatewayUrl]);

  if (tagTitle) {
    return {
      title: tagTitle,
      description: tagDescription,
      faviconUrl: fetched?.faviconUrl,
      loading: false,
    };
  }

  return {
    title: fetched?.title,
    description: tagDescription ?? fetched?.description,
    faviconUrl: fetched?.faviconUrl,
    loading,
  };
}
