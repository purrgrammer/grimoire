import { useEffect } from "react";
import type { EventPointer, AddressPointer } from "nostr-tools/nip19";
import { useEventStore, use$ } from "applesauce-react/hooks";
import { eventLoader, addressLoader } from "@/services/loaders";
import type { NostrEvent } from "@/types/nostr";

/**
 * Type guard to check if pointer is an EventPointer
 */
function isEventPointer(
  pointer: EventPointer | AddressPointer,
): pointer is EventPointer {
  return "id" in pointer;
}

/**
 * Type guard to check if pointer is an AddressPointer
 */
function isAddressPointer(
  pointer: EventPointer | AddressPointer,
): pointer is AddressPointer {
  return "kind" in pointer && "pubkey" in pointer;
}

/**
 * Unified hook for fetching Nostr events by pointer
 * Supports string ID, EventPointer, and AddressPointer
 * @param pointer - string ID, EventPointer, or AddressPointer
 * @param context - Optional context for relay hints:
 *   - string: pubkey of event author (backward compatible)
 *   - NostrEvent: full reply event with r/e/p tags (comprehensive relay selection)
 * @returns Event or undefined
 */
export function useNostrEvent(
  pointer:
    | string
    | EventPointer
    | AddressPointer
    | { kind: number; pubkey: string; identifier: string }
    | undefined,
  context?: string | NostrEvent,
): NostrEvent | undefined {
  const eventStore = useEventStore();

  // Watch event store for the specific event
  const event = use$(() => {
    if (!pointer) return undefined;

    // Handle string ID
    if (typeof pointer === "string") {
      return eventStore.event(pointer);
    }

    if (isEventPointer(pointer)) {
      // For EventPointer, query by ID
      return eventStore.event(pointer.id);
    } else if (isAddressPointer(pointer)) {
      // For AddressPointer, query replaceable event
      return eventStore.replaceable(
        pointer.kind,
        pointer.pubkey,
        pointer.identifier || "",
      );
    }
    return undefined;
  }, [pointer]);

  // Trigger event loading with appropriate loader
  // Use JSON.stringify for dependency to handle object changes
  const pointerKey = pointer
    ? typeof pointer === "string"
      ? pointer
      : JSON.stringify(pointer)
    : null;

  useEffect(() => {
    if (!pointer) return;

    // Handle string ID
    if (typeof pointer === "string") {
      console.log("[useNostrEvent] Loading event by ID:", pointer);
      const subscription = eventLoader({ id: pointer }, context).subscribe();
      return () => subscription.unsubscribe();
    }

    if (isEventPointer(pointer)) {
      console.log("[useNostrEvent] Loading event by EventPointer:", pointer);
      const subscription = eventLoader(pointer, context).subscribe();
      return () => subscription.unsubscribe();
    } else if (isAddressPointer(pointer)) {
      console.log("[useNostrEvent] Loading event by AddressPointer:", pointer);
      const subscription = addressLoader(pointer).subscribe({
        next: (event) =>
          console.log("[useNostrEvent] Received event:", event.id),
        error: (err) => console.error("[useNostrEvent] Error loading:", err),
        complete: () => console.log("[useNostrEvent] Loading complete"),
      });
      return () => {
        console.log("[useNostrEvent] Unsubscribing from addressLoader");
        subscription.unsubscribe();
      };
    } else {
      console.warn("[useNostrEvent] Unknown pointer type:", pointer);
    }
  }, [pointer, pointerKey, context]);

  return event;
}

/**
 * Convenience hook for fetching events by ID only
 * @param eventId - Event ID to fetch
 * @param relayUrl - Optional relay URL hint
 * @returns Event or undefined
 */
export function useEventById(
  eventId: string | undefined,
  relayUrl?: string,
): NostrEvent | undefined {
  const pointer = eventId
    ? ({
        id: eventId,
        relays: relayUrl ? [relayUrl] : undefined,
      } as EventPointer)
    : undefined;

  return useNostrEvent(pointer);
}
