import type { NostrEvent } from "@/types/nostr";
import { getTagValue, getOrComputeCachedValue } from "applesauce-core/helpers";
import {
  getNsitePaths,
  getNsiteServers,
  getNsiteAggregateHash,
  type NsitePath,
} from "./nip5a-helpers";

/**
 * NIP-5D helpers for napplet manifests (kinds 5129 / 15129 / 35129).
 *
 * NIP-5D adopts NIP-5A's tag schema, so `path`, `server` and `x` delegate to
 * the nsite helpers rather than being reimplemented. These read tags for
 * display only — they verify nothing. Verification is `resolveNapplet`'s job in
 * `src/services/napplet-host.ts`, and the UI must never imply a manifest shown
 * here has been checked.
 */

const NappletRequiresSymbol = Symbol("nappletRequires");
const NappletArchetypesSymbol = Symbol("nappletArchetypes");

export type { NsitePath as NappletPath };

export interface NappletArchetype {
  slug: string;
  convention: string;
  params: string[];
}

export function getNappletTitle(event: NostrEvent): string | undefined {
  return getTagValue(event, "title");
}

export function getNappletDescription(event: NostrEvent): string | undefined {
  return getTagValue(event, "description");
}

export function getNappletSource(event: NostrEvent): string | undefined {
  return getTagValue(event, "source");
}

export function getNappletIdentifier(event: NostrEvent): string | undefined {
  return getTagValue(event, "d");
}

/** File path to sha256 mappings, from `path` tags. */
export function getNappletPaths(event: NostrEvent): NsitePath[] {
  return getNsitePaths(event);
}

/** Blossom server hints, from `server` tags. */
export function getNappletServers(event: NostrEvent): string[] {
  return getNsiteServers(event);
}

/** The declared content address, from the `x` tag. Unverified. */
export function getNappletAggregateHash(event: NostrEvent): string | undefined {
  return getNsiteAggregateHash(event);
}

/** Required domains from current R tags or legacy requires tags. */
export function getNappletRequires(event: NostrEvent): string[] {
  return getOrComputeCachedValue(event, NappletRequiresSymbol, () => [
    ...new Set(
      event.tags
        .filter((t) => (t[0] === "R" || t[0] === "requires") && t[1])
        .map((t) => t[1]),
    ),
  ]);
}

/** Current z/i routing tags, with legacy archetype pairs for older manifests. */
export function getNappletArchetypes(event: NostrEvent): NappletArchetype[] {
  return getOrComputeCachedValue(event, NappletArchetypesSymbol, () => {
    const roles = new Set(
      event.tags.filter((t) => t[0] === "z" && t.length === 2).map((t) => t[1]),
    );
    if (event.tags.some((t) => t[0] === "z" || t[0] === "i")) {
      return event.tags.flatMap(([tag, convention, ...params]) => {
        const match =
          tag === "i" && typeof convention === "string"
            ? /^napplet:([a-z0-9][a-z0-9-]*)\/[^/?#\s]+$/.exec(convention)
            : null;
        return match &&
          roles.has(match[1]) &&
          params.every((p) => p && !/\s/.test(p))
          ? [{ slug: match[1], convention, params }]
          : [];
      });
    }
    return event.tags
      .filter((t) => t[0] === "archetype" && t[1])
      .map((t) => ({ slug: t[1], convention: t[2] ?? "", params: [] }));
  });
}
