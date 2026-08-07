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

/** Bare NAP domain names the napplet declares it needs, from `requires` tags. */
export function getNappletRequires(event: NostrEvent): string[] {
  return getOrComputeCachedValue(event, NappletRequiresSymbol, () => [
    ...new Set(
      event.tags.filter((t) => t[0] === "requires" && t[1]).map((t) => t[1]),
    ),
  ]);
}

/** Convention contracts the napplet fulfills, from `archetype` tags. */
export function getNappletArchetypes(event: NostrEvent): NappletArchetype[] {
  return getOrComputeCachedValue(event, NappletArchetypesSymbol, () =>
    event.tags
      .filter((t) => t[0] === "archetype" && t[1])
      .map((t) => ({ slug: t[1], convention: t[2] ?? "" })),
  );
}
