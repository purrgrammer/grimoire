import { useMemo, useState, useCallback, useRef } from "react";
import { use$ } from "applesauce-react/hooks";
import {
  getEventPointerFromETag,
  getAddressPointerFromATag,
} from "applesauce-core/helpers";
import { EventFactory } from "applesauce-core/event-factory";
import eventStore from "@/services/event-store";
import accountManager from "@/services/accounts";
import { settingsManager } from "@/services/settings";
import { publishEvent } from "@/services/hub";
import { useAccount } from "@/hooks/useAccount";
import { isAddressableKind } from "@/lib/nostr-kinds";
import { eTagStrategy, aTagStrategy } from "@/lib/favorite-tag-strategies";
import { GRIMOIRE_CLIENT_TAG } from "@/constants/app";
import type { TagStrategy } from "@/lib/favorite-tag-strategies";
import type { FavoriteListConfig } from "@/config/favorite-lists";
import type { NostrEvent } from "@/types/nostr";
import type { EventPointer, AddressPointer } from "nostr-tools/nip19";

export function resolveStrategy(config: FavoriteListConfig): TagStrategy {
  if (config.tagStrategy) return config.tagStrategy;
  return isAddressableKind(config.elementKind) ? aTagStrategy : eTagStrategy;
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

/**
 * Generic hook to read and manage a NIP-51-style favorite list.
 *
 * Tag format is determined by the config's tagStrategy (defaults to "e"/"a"
 * based on isAddressableKind). Pass a custom TagStrategy for non-standard
 * tag formats like NIP-29 "group" tags.
 */
export function useFavoriteList(config: FavoriteListConfig) {
  const { pubkey, canSign } = useAccount();
  const [isUpdating, setIsUpdating] = useState(false);
  const isUpdatingRef = useRef(false);

  const strategy = resolveStrategy(config);

  // Subscribe to the user's replaceable list event
  const event = use$(
    () =>
      pubkey ? eventStore.replaceable(config.listKind, pubkey, "") : undefined,
    [pubkey, config.listKind],
  );

  // Extract pointers from matching tags (only meaningful for e/a strategies)
  const items = useMemo(() => {
    if (!event) return [];
    if (strategy.tagName === "e") return getListPointers(event, "e");
    if (strategy.tagName === "a") return getListPointers(event, "a");
    return [];
  }, [event, strategy.tagName]);

  // Quick lookup set of item identity keys
  const itemIds = useMemo(() => {
    if (!event) return new Set<string>();
    const ids = new Set<string>();
    for (const tag of event.tags) {
      if (tag[0] === strategy.tagName && tag[1]) {
        const key = strategy.keyFromTag(tag);
        if (key) ids.add(key);
      }
    }
    return ids;
  }, [event, strategy]);

  const isFavorite = useCallback(
    (targetEvent: NostrEvent) => {
      const key = strategy.getItemKey(targetEvent);
      return key !== "" && itemIds.has(key);
    },
    [strategy, itemIds],
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

        const itemKey = strategy.getItemKey(targetEvent);
        if (!itemKey) return;

        const alreadyFavorited = currentTags.some((t) =>
          strategy.matchesKey(t, itemKey),
        );

        let newTags: string[][];
        if (alreadyFavorited) {
          newTags = currentTags.filter((t) => !strategy.matchesKey(t, itemKey));
        } else {
          newTags = [...currentTags, strategy.buildTag(targetEvent)];
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
    [canSign, config, event, strategy],
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
