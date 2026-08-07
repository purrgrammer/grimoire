import type { NostrEvent } from "@/types/nostr";
import { getTagValue, getOrComputeCachedValue } from "applesauce-core/helpers";
import { nip19 } from "nostr-tools";

/**
 * NIP-5A Helper Functions
 * Utility functions for parsing NIP-5A pubkey static website events
 *
 * All helper functions use applesauce's getOrComputeCachedValue to cache
 * computed values on the event object itself. This means you don't need
 * useMemo when calling these functions.
 */

export const DEFAULT_NSITE_GATEWAY = "nsite.lol";

// Cache symbols
const NsitePathsSymbol = Symbol("nsitePaths");
const NsiteServersSymbol = Symbol("nsiteServers");
const NsiteRelaysSymbol = Symbol("nsiteRelays");

export interface NsitePath {
  path: string;
  hash: string;
}

/** A parsed `a`/`A` lineage coordinate (`<kind>:<pubkey>:<d>`) */
export interface NsiteLineage {
  coordinate: string;
  kind: number;
  pubkey: string;
  identifier: string;
  relay?: string;
}

function parseLineageTag(tag: string[]): NsiteLineage | undefined {
  const coordinate = tag[1];
  if (!coordinate) return undefined;
  const [kindStr, pubkey, ...rest] = coordinate.split(":");
  const kind = Number(kindStr);
  if (!Number.isInteger(kind) || !pubkey) return undefined;
  return {
    coordinate,
    kind,
    pubkey,
    identifier: rest.join(":"),
    relay: tag[2] || undefined,
  };
}

/**
 * Get the site title from a site manifest event
 */
export function getNsiteTitle(event: NostrEvent): string | undefined {
  return getTagValue(event, "title");
}

/**
 * Get the site description from a site manifest event
 */
export function getNsiteDescription(event: NostrEvent): string | undefined {
  return getTagValue(event, "description");
}

/**
 * Get the source code URL from a site manifest event
 */
export function getNsiteSource(event: NostrEvent): string | undefined {
  return getTagValue(event, "source");
}

/**
 * Get all path-to-hash mappings from a site manifest event
 */
export function getNsitePaths(event: NostrEvent): NsitePath[] {
  return getOrComputeCachedValue(event, NsitePathsSymbol, () =>
    event.tags
      .filter((t) => t[0] === "path" && t[1] && t[2])
      .map((t) => ({ path: t[1], hash: t[2] })),
  );
}

/**
 * Get all blossom server hints from a site manifest event
 */
export function getNsiteServers(event: NostrEvent): string[] {
  return getOrComputeCachedValue(event, NsiteServersSymbol, () => [
    ...new Set(
      event.tags.filter((t) => t[0] === "server" && t[1]).map((t) => t[1]),
    ),
  ]);
}

/**
 * Get relay hints from a site manifest event
 */
export function getNsiteRelays(event: NostrEvent): string[] {
  return getOrComputeCachedValue(event, NsiteRelaysSymbol, () => [
    ...new Set(
      event.tags.filter((t) => t[0] === "relay" && t[1]).map((t) => t[1]),
    ),
  ]);
}

/**
 * Get the sha256 hash for /index.html from the site manifest
 */
export function getNsiteIndexHash(event: NostrEvent): string | undefined {
  const paths = getNsitePaths(event);
  return paths.find((p) => p.path === "/index.html")?.hash;
}

/**
 * Get the sha256 hash for /favicon.ico from the site manifest
 */
export function getNsiteFaviconHash(event: NostrEvent): string | undefined {
  const paths = getNsitePaths(event);
  return paths.find((p) => p.path === "/favicon.ico")?.hash;
}

/**
 * Get the site identifier (d tag) for named sites (kind 35128)
 */
export function getNsiteIdentifier(event: NostrEvent): string | undefined {
  return getTagValue(event, "d");
}

/**
 * Get the aggregate hash of the manifest (`x` tag), which identifies the site
 * version independently of who published it
 */
export function getNsiteAggregateHash(event: NostrEvent): string | undefined {
  return event.tags.find((t) => t[0] === "x" && t[1])?.[1];
}

/**
 * Get the immediate parent nsite of a copied site (`a` tag)
 */
export function getNsiteParent(event: NostrEvent): NsiteLineage | undefined {
  const tag = event.tags.find((t) => t[0] === "a" && t[1]);
  return tag ? parseLineageTag(tag) : undefined;
}

/**
 * Get the origin nsite of a copied site's lineage (`A` tag)
 */
export function getNsiteOrigin(event: NostrEvent): NsiteLineage | undefined {
  const tag = event.tags.find((t) => t[0] === "A" && t[1]);
  return tag ? parseLineageTag(tag) : undefined;
}

/**
 * Convert a raw 32-byte hex value to base36, lowercase, exactly 50 characters.
 * Used for nsite subdomain construction per NIP-5A.
 */
function hexToBase36(hex: string): string {
  const num = BigInt("0x" + hex);
  return num.toString(36).padStart(50, "0");
}

/**
 * Get the gateway URL to view this site
 * Root sites (15128): https://<npub>.nsite.lol
 * Named sites (35128): https://<pubkeyB36><dTag>.nsite.lol
 * Snapshots (5128):    https://v<snapshotIdB36>.nsite.lol
 *
 * Not memoized: callers may pass different gateways for the same event, and
 * the whole computation is one bech32 encode.
 */
export function getNsiteGatewayUrl(
  event: NostrEvent,
  gateway: string = DEFAULT_NSITE_GATEWAY,
): string {
  if (event.kind === 5128) {
    return `https://v${hexToBase36(event.id)}.${gateway}`;
  }
  if (event.kind === 35128) {
    const dTag = getNsiteIdentifier(event);
    if (dTag) {
      return `https://${hexToBase36(event.pubkey)}${dTag}.${gateway}`;
    }
  }
  const npub = nip19.npubEncode(event.pubkey);
  return `https://${npub}.${gateway}`;
}
