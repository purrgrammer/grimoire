import { describe, expect, it, vi } from "vitest";
import { EventStore } from "applesauce-core";
import { NEVER } from "rxjs";
import type { NostrEvent } from "@/types/nostr";
import { watchStoredEvent } from "./useStoredEvent";
import { issue, pullRequest } from "@/test/git-fixtures";

/**
 * A real EventStore with a fallback loader attached, as the app's singleton
 * has. The loader is the thing under test: it must never be called.
 */
function storeWithLoader() {
  // Fixtures are unsigned, so the store is told not to check signatures.
  const store = new EventStore({ verifyEvent: () => true });
  const loader = vi.fn(() => NEVER);
  store.eventLoader = loader;
  return { store, loader };
}

function collect(store: EventStore, id: string) {
  const seen: (NostrEvent | undefined)[] = [];
  const subscription = watchStoredEvent(store, id).subscribe((event) =>
    seen.push(event),
  );
  return { seen, subscription };
}

describe("watchStoredEvent", () => {
  it("emits undefined for a missing event and does not load it", () => {
    const { store, loader } = storeWithLoader();
    const { seen, subscription } = collect(store, issue.id);
    expect(seen).toEqual([undefined]);
    expect(loader).not.toHaveBeenCalled();
    subscription.unsubscribe();
  });

  it("is the counter-example: eventStore.event() does call the loader", () => {
    const { store, loader } = storeWithLoader();
    const subscription = store.event(issue.id).subscribe();
    expect(loader).toHaveBeenCalledTimes(1);
    subscription.unsubscribe();
  });

  it("emits an event that is already stored", () => {
    const { store, loader } = storeWithLoader();
    store.add(issue);
    const { seen, subscription } = collect(store, issue.id);
    expect(seen.map((e) => e?.id)).toEqual([issue.id]);
    expect(loader).not.toHaveBeenCalled();
    subscription.unsubscribe();
  });

  it("fills in when the event arrives later, and ignores other events", () => {
    const { store, loader } = storeWithLoader();
    const { seen, subscription } = collect(store, issue.id);
    store.add(pullRequest);
    expect(seen).toEqual([undefined]);
    store.add(issue);
    expect(seen.map((e) => e?.id)).toEqual([undefined, issue.id]);
    expect(loader).not.toHaveBeenCalled();
    subscription.unsubscribe();
  });

  it("goes back to undefined when the event is removed", () => {
    const { store } = storeWithLoader();
    store.add(issue);
    const { seen, subscription } = collect(store, issue.id);
    store.remove(issue.id);
    expect(seen.map((e) => e?.id)).toEqual([issue.id, undefined]);
    subscription.unsubscribe();
  });
});
