// @vitest-environment happy-dom
/**
 * The bug this file exists for: `req -p $me -k 1` opened a REQ against
 * wss://relay.primal.net, a relay the user never listed anywhere.
 *
 * Nothing in relay selection is wrong about a single `#p` — it uses the
 * p-tagged user's inbox relays. What was wrong is *when* it asked.
 * `selectRelaysForFilter` gives each kind:10002 one second; on a cold start it
 * loses that race, every pointer comes back with no relays, and the result is
 * FALLBACK_RELAYS. The hook then committed that result — phase "ready" — and
 * never looked again, because its effect only keyed on the filter's pubkeys.
 * The relay list arriving two seconds later changed nothing, and the window
 * queried fallback relays for the rest of its life.
 *
 * So there are two invariants here, and neither is visible to the compiler:
 * a pure-fallback selection must not be reported ready straight away, and a
 * kind:10002 reaching the EventStore must re-run the selection.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { EventStore } from "applesauce-core";
import { EventStoreProvider } from "applesauce-react/providers";
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  type NostrEvent,
} from "nostr-tools";
import type { PropsWithChildren } from "react";
import type { Filter } from "nostr-tools";
import type { RelaySelectionResult } from "@/types/relay-selection";

const FALLBACK = ["wss://nos.lol/", "wss://relay.primal.net/"];
const INBOX = ["wss://inbox.example.com/"];

const selectRelaysForFilter = vi.fn();

vi.mock("@/services/relay-selection", () => ({
  selectRelaysForFilter: (...args: unknown[]) => selectRelaysForFilter(...args),
}));

const { useOutboxRelays } = await import("./useOutboxRelays");

const secretKey = generateSecretKey();
const pubkey = getPublicKey(secretKey);

function relayListEvent(): NostrEvent {
  return finalizeEvent(
    {
      kind: 10002,
      created_at: Math.floor(Date.now() / 1000),
      tags: [["r", INBOX[0], "read"]],
      content: "",
    },
    secretKey,
  );
}

/** What the service returns while the relay list is still unknown. */
function fallbackResult(): RelaySelectionResult {
  return {
    relays: FALLBACK,
    reasoning: FALLBACK.map((relay) => ({
      relay,
      writers: [],
      readers: [],
      isFallback: true,
    })),
    isOptimized: false,
    blocked: [],
  };
}

function inboxResult(): RelaySelectionResult {
  return {
    relays: INBOX,
    reasoning: [
      { relay: INBOX[0], writers: [], readers: [pubkey], isFallback: false },
    ],
    isOptimized: true,
    blocked: [],
  };
}

describe("useOutboxRelays", () => {
  let eventStore: EventStore;
  const filter: Filter = { kinds: [1], "#p": [pubkey] };
  const options = { fallbackRelays: FALLBACK, timeout: 1000, maxRelays: 42 };

  function wrapper({ children }: PropsWithChildren) {
    return (
      <EventStoreProvider eventStore={eventStore}>
        {children}
      </EventStoreProvider>
    );
  }

  beforeEach(() => {
    eventStore = new EventStore();
    selectRelaysForFilter.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not report a pure-fallback selection as ready", async () => {
    selectRelaysForFilter.mockResolvedValue(fallbackResult());

    const { result } = renderHook(() => useOutboxRelays(filter, options), {
      wrapper,
    });

    await waitFor(() => expect(selectRelaysForFilter).toHaveBeenCalled());

    // The caller (ReqViewer) subscribes only once the phase is "ready", so
    // holding here is what keeps the REQ off the fallback relays.
    expect(result.current.phase).not.toBe("ready");
  });

  it("re-selects when the relay list arrives after the fetch timeout", async () => {
    selectRelaysForFilter.mockResolvedValue(fallbackResult());

    const { result } = renderHook(() => useOutboxRelays(filter, options), {
      wrapper,
    });

    await waitFor(() => expect(selectRelaysForFilter).toHaveBeenCalledTimes(1));

    // The kind:10002 lands late — via useAccountSync, a loader, the cache sync.
    selectRelaysForFilter.mockResolvedValue(inboxResult());
    act(() => {
      eventStore.add(relayListEvent());
    });

    await waitFor(
      () => {
        expect(result.current.phase).toBe("ready");
        expect(result.current.relays).toEqual(INBOX);
      },
      { timeout: 4000 },
    );
  });

  it("keeps serving a committed selection while it revalidates", async () => {
    selectRelaysForFilter.mockResolvedValue(inboxResult());

    const { result } = renderHook(() => useOutboxRelays(filter, options), {
      wrapper,
    });

    await waitFor(() => expect(result.current.phase).toBe("ready"));
    const committed = result.current.relays;

    // A relay list edit lands mid-session. The caller reads an unready phase as
    // "no relays" and unsubscribes everything, so the phase must hold — and an
    // unchanged relay set must not even change identity.
    act(() => {
      eventStore.add(relayListEvent());
    });

    await waitFor(
      () => expect(selectRelaysForFilter).toHaveBeenCalledTimes(2),
      { timeout: 4000 },
    );

    expect(result.current.phase).toBe("ready");
    expect(result.current.relays).toBe(committed);
  });

  it("commits the fallback once the grace period expires", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    selectRelaysForFilter.mockResolvedValue(fallbackResult());

    const { result } = renderHook(() => useOutboxRelays(filter, options), {
      wrapper,
    });

    await waitFor(() => expect(selectRelaysForFilter).toHaveBeenCalledTimes(1));

    // A user who really has no kind:10002 must still get an answer.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });

    await waitFor(() => {
      expect(result.current.phase).toBe("ready");
      expect(result.current.relays).toEqual(FALLBACK);
    });
  });

  it("reports ready immediately when the selection is optimized", async () => {
    selectRelaysForFilter.mockResolvedValue(inboxResult());

    const { result } = renderHook(() => useOutboxRelays(filter, options), {
      wrapper,
    });

    await waitFor(() => {
      expect(result.current.phase).toBe("ready");
      expect(result.current.relays).toEqual(INBOX);
    });
    expect(result.current.relays).not.toContain("wss://relay.primal.net/");
  });
});
