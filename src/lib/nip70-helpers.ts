import type { NostrEvent } from "@/types/nostr";
import { getOrComputeCachedValue } from "applesauce-core/helpers";

const IsProtectedSymbol = Symbol("isProtected");

/**
 * Check if an event is protected (NIP-70).
 * A protected event has a `["-"]` tag (single-item tag with value "-").
 * Cached on the event object via applesauce helpers.
 */
export function isProtectedEvent(event: NostrEvent): boolean {
  return getOrComputeCachedValue(event, IsProtectedSymbol, () =>
    event.tags.some((t) => t.length === 1 && t[0] === "-"),
  );
}
