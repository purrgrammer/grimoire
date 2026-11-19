import { defer, filter, map, merge, of, type Observable } from "rxjs";
import { use$, useEventStore } from "applesauce-react/hooks";
import type { IEventStore } from "applesauce-core";
import type { NostrEvent } from "@/types/nostr";

/** The part of the EventStore this needs: a lookup and the two streams. */
export type StoredEventSource = Pick<
  IEventStore,
  "getEvent" | "insert$" | "remove$"
>;

/**
 * Watch one event id in the EventStore without ever loading it.
 *
 * `eventStore.event(id)` looks like this and is not: when the event is
 * missing it calls the store's fallback loader, which `services/loaders.ts`
 * wires to every indexer and fallback relay. A list that called it per row
 * sent an `ids` REQ to seven relays for the rows on screen, which was caught
 * only by counting frames in the browser. This reads the store, then listens
 * for the event being inserted or removed, and that is all.
 */
export function watchStoredEvent(
  store: StoredEventSource,
  id: string,
): Observable<NostrEvent | undefined> {
  return merge(
    defer(() => of(store.getEvent(id))),
    store.insert$.pipe(filter((event) => event.id === id)),
    store.remove$.pipe(
      filter((event) => event.id === id),
      map(() => undefined),
    ),
  );
}

/**
 * An event that is already in the EventStore, or `undefined`. Reactive: it
 * fills in if the event arrives later through any subscription. It never asks
 * a relay — use `useNostrEvent` when the event is worth a request.
 */
export function useStoredEvent(id: string | undefined): NostrEvent | undefined {
  const eventStore = useEventStore();
  return use$(
    () => (id ? watchStoredEvent(eventStore, id) : undefined),
    [id, eventStore],
  );
}
