import { getTagValue } from "applesauce-core/helpers";
import { getSeenRelays } from "applesauce-core/helpers/relays";
import { normalizeRelayURL } from "@/lib/relay-url";
import type { NostrEvent } from "@/types/nostr";

/** Abstracts tag format so useFavoriteList works with e, a, group, or future tag types. */
export interface TagStrategy {
  /** The tag name used in the list event (e.g., "e", "a", "group") */
  tagName: string;
  /** Compute an identity key for the given event (used in the membership set) */
  getItemKey(event: NostrEvent): string;
  /** Build a complete tag array for adding an event to the list */
  buildTag(event: NostrEvent): string[];
  /** Check if a stored tag matches a given identity key */
  matchesKey(tag: string[], key: string): boolean;
  /** Extract the identity key directly from a stored tag (for building itemIds set) */
  keyFromTag(tag: string[]): string | undefined;
}

function firstSeenRelay(event: NostrEvent): string {
  const relays = getSeenRelays(event);
  return relays ? Array.from(relays)[0] || "" : "";
}

/** Strategy for "e" tags — regular (non-addressable) events. */
export const eTagStrategy: TagStrategy = {
  tagName: "e",
  getItemKey(event) {
    return event.id;
  },
  buildTag(event) {
    const relay = firstSeenRelay(event);
    return relay ? ["e", event.id, relay] : ["e", event.id];
  },
  matchesKey(tag, key) {
    return eTagStrategy.keyFromTag(tag) === key;
  },
  keyFromTag(tag) {
    return tag[0] === "e" && tag[1] ? tag[1] : undefined;
  },
};

/** Strategy for "a" tags — addressable (parameterized replaceable) events. */
export const aTagStrategy: TagStrategy = {
  tagName: "a",
  getItemKey(event) {
    const dTag = getTagValue(event, "d") || "";
    return `${event.kind}:${event.pubkey}:${dTag}`;
  },
  buildTag(event) {
    const dTag = getTagValue(event, "d") || "";
    const coordinate = `${event.kind}:${event.pubkey}:${dTag}`;
    const relay = firstSeenRelay(event);
    return relay ? ["a", coordinate, relay] : ["a", coordinate];
  },
  matchesKey(tag, key) {
    return aTagStrategy.keyFromTag(tag) === key;
  },
  keyFromTag(tag) {
    return tag[0] === "a" && tag[1] ? tag[1] : undefined;
  },
};

/**
 * Strategy for "group" tags — NIP-29 relay-based groups (kind 10009 lists).
 *
 * Identity is `normalizedRelayUrl'groupId` to match the pattern used by
 * useNip29GroupList and the NIP-29 adapter.
 */
export const groupTagStrategy: TagStrategy = {
  tagName: "group",
  getItemKey(event) {
    const groupId = getTagValue(event, "d") || "";
    const relay = firstSeenRelay(event);
    if (!relay) return "";
    try {
      return `${normalizeRelayURL(relay)}'${groupId}`;
    } catch {
      return "";
    }
  },
  buildTag(event) {
    const groupId = getTagValue(event, "d") || "";
    const relay = firstSeenRelay(event);
    if (!relay) {
      console.warn(
        "[useFavoriteList] Cannot build group tag: no seen relay for event",
        event.id,
      );
      return ["group", groupId];
    }
    try {
      return ["group", groupId, normalizeRelayURL(relay)];
    } catch {
      return ["group", groupId, relay];
    }
  },
  matchesKey(tag, key) {
    return groupTagStrategy.keyFromTag(tag) === key;
  },
  keyFromTag(tag) {
    if (tag[0] !== "group" || !tag[1] || !tag[2]) return undefined;
    try {
      return `${normalizeRelayURL(tag[2])}'${tag[1]}`;
    } catch {
      return undefined;
    }
  },
};
