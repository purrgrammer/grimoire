import { useMemo, useState, useCallback, useRef } from "react";
import { use$ } from "applesauce-react/hooks";
import {
  getEventPointerFromETag,
  getAddressPointerFromATag,
  getTagValue,
} from "applesauce-core/helpers";
import { getSeenRelays } from "applesauce-core/helpers/relays";
import { EventFactory } from "applesauce-core/event-factory";
import eventStore from "@/services/event-store";
import accountManager from "@/services/accounts";
import settingsManager from "@/services/settings";
import { publishEvent } from "@/services/hub";
import { useAccount } from "@/hooks/useAccount";
import { isAddressableKind } from "@/lib/nostr-kinds";
import { GRIMOIRE_CLIENT_TAG } from "@/constants/app";
import type { FavoriteListConfig } from "@/config/favorite-lists";
import type { NostrEvent } from "@/types/nostr";
import type { EventPointer, AddressPointer } from "nostr-tools/nip19";

/** Compute the identity key for an event based on tag type */
function getItemKey(event: NostrEvent, tagType: "e" | "a"): string {
  if (tagType === "a") {
    const dTag = getTagValue(event, "d") || "";
    return `${event.kind}:${event.pubkey}:${dTag}`;
  }
  return event.id;
}

/** Extract pointers from tags of a given type */
export function getListPointers(
  event: NostrEvent,
  tagType: "e",
): EventPointer[];
export function getListPointers(
  event: NostrEvent,
  tagType: "a",
): AddressPointer[];
export function getListPointers(
  event: NostrEvent,
  tagType: "e" | "a",
): EventPointer[] | AddressPointer[];
export function getListPointers(
  event: NostrEvent,
  tagType: "e" | "a",
): (EventPointer | AddressPointer)[] {
  const pointers: (EventPointer | AddressPointer)[] = [];
  for (const tag of event.tags) {
    if (tag[0] === tagType && tag[1]) {
      if (tagType === "e") {
        const pointer = getEventPointerFromETag(tag);
        if (pointer) pointers.push(pointer);
      } else {
        const pointer = getAddressPointerFromATag(tag);
        if (pointer) pointers.push(pointer);
      }
    }
  }
  return pointers;
}

/** Build a tag for adding an item to a favorite list */
function buildTag(event: NostrEvent, tagType: "e" | "a"): string[] {
  const seenRelays = getSeenRelays(event);
  const relayHint = seenRelays ? Array.from(seenRelays)[0] || "" : "";

  if (tagType === "a") {
    const dTag = getTagValue(event, "d") || "";
    const coordinate = `${event.kind}:${event.pubkey}:${dTag}`;
    return relayHint ? ["a", coordinate, relayHint] : ["a", coordinate];
  }

  return relayHint ? ["e", event.id, relayHint] : ["e", event.id];
}

/**
 * Generic hook to read and manage a NIP-51-style favorite list.
 *
 * Tag type ("e" vs "a") is derived from the element kind using isAddressableKind().
 */
export function useFavoriteList(config: FavoriteListConfig) {
  const { pubkey, canSign } = useAccount();
  const [isUpdating, setIsUpdating] = useState(false);
  const isUpdatingRef = useRef(false);

  const tagType = isAddressableKind(config.elementKind) ? "a" : "e";

  // Subscribe to the user's replaceable list event
  const event = use$(
    () =>
      pubkey ? eventStore.replaceable(config.listKind, pubkey, "") : undefined,
    [pubkey, config.listKind],
  );

  // Extract pointers from matching tags
  const items = useMemo(
    () => (event ? getListPointers(event, tagType) : []),
    [event, tagType],
  );

  // Quick lookup set of item identity keys
  const itemIds = useMemo(() => {
    if (!event) return new Set<string>();
    const ids = new Set<string>();
    for (const tag of event.tags) {
      if (tag[0] === tagType && tag[1]) {
        ids.add(tag[1]);
      }
    }
    return ids;
  }, [event, tagType]);

  const isFavorite = useCallback(
    (targetEvent: NostrEvent) => {
      const key = getItemKey(targetEvent, tagType);
      return itemIds.has(key);
    },
    [tagType, itemIds],
  );

  const toggleFavorite = useCallback(
    async (targetEvent: NostrEvent) => {
      if (!canSign || isUpdatingRef.current) return;

      const account = accountManager.active;
      if (!account?.signer) return;

      isUpdatingRef.current = true;
      setIsUpdating(true);
      try {
        const currentTags = event ? event.tags.map((t) => [...t]) : [];
        const currentContent = event?.content ?? "";

        const itemKey = getItemKey(targetEvent, tagType);
        const alreadyFavorited = currentTags.some(
          (t) => t[0] === tagType && t[1] === itemKey,
        );

        let newTags: string[][];
        if (alreadyFavorited) {
          newTags = currentTags.filter(
            (t) => !(t[0] === tagType && t[1] === itemKey),
          );
        } else {
          newTags = [...currentTags, buildTag(targetEvent, tagType)];
        }

        if (settingsManager.getSetting("post", "includeClientTag")) {
          newTags = newTags.filter((t) => t[0] !== "client");
          newTags.push(GRIMOIRE_CLIENT_TAG);
        }

        const factory = new EventFactory({ signer: account.signer });
        const built = await factory.build({
          kind: config.listKind,
          content: currentContent,
          tags: newTags,
        });
        const signed = await factory.sign(built);
        await publishEvent(signed);
      } catch (err) {
        console.error(
          `[useFavoriteList] Failed to toggle favorite (list kind ${config.listKind}):`,
          err,
        );
      } finally {
        isUpdatingRef.current = false;
        setIsUpdating(false);
      }
    },
    [canSign, config, event, tagType],
  );

  return {
    items,
    itemIds,
    isFavorite,
    toggleFavorite,
    isUpdating,
    event,
  };
}
