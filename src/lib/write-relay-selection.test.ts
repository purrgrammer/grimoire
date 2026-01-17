import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  sanitizeRelays,
  normalizeAndDedupe,
  getWriteRelaysForPubkey,
  getRelaysWhereEventSeen,
  combineRelayStrategies,
  getOptimalWriteRelays,
  FALLBACK_RELAYS,
  type WriteRelaySelectionResult,
} from "./write-relay-selection";
import type { NostrEvent } from "@/types/nostr";
import eventStore from "@/services/event-store";

// Mock modules
vi.mock("@/services/event-store", () => ({
  default: {
    getReplaceable: vi.fn(),
  },
}));

vi.mock("applesauce-core/helpers/relays", () => ({
  getSeenRelays: vi.fn(),
}));

vi.mock("applesauce-core/helpers", () => ({
  getOutboxes: vi.fn(),
  normalizeURL: vi.fn((url: string) => {
    // Simple normalization for testing
    const normalized = url.toLowerCase().replace(/\/+$/, "");
    if (!normalized.startsWith("ws://") && !normalized.startsWith("wss://")) {
      throw new Error("Invalid URL");
    }
    return normalized;
  }),
}));

// Import mocked functions for type safety
import { getSeenRelays } from "applesauce-core/helpers/relays";
import { getOutboxes } from "applesauce-core/helpers";

describe("sanitizeRelays", () => {
  it("should remove localhost relays", () => {
    const input = [
      "wss://relay.damus.io",
      "ws://localhost:7777",
      "wss://127.0.0.1:8080",
      "ws://[::1]:9000",
    ];
    const result = sanitizeRelays(input);
    expect(result).toEqual(["wss://relay.damus.io"]);
  });

  it("should remove TOR relays", () => {
    const input = [
      "wss://relay.damus.io",
      "wss://something.onion",
      "ws://test.ONION",
    ];
    const result = sanitizeRelays(input);
    expect(result).toEqual(["wss://relay.damus.io"]);
  });

  it("should keep normal relays", () => {
    const input = [
      "wss://relay.damus.io",
      "wss://nos.lol",
      "wss://relay.nostr.band",
    ];
    const result = sanitizeRelays(input);
    expect(result).toEqual(input);
  });

  it("should handle empty array", () => {
    expect(sanitizeRelays([])).toEqual([]);
  });
});

describe("normalizeAndDedupe", () => {
  it("should normalize URLs", () => {
    const input = ["wss://relay.damus.io/", "wss://relay.damus.io"];
    const result = normalizeAndDedupe(input);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe("wss://relay.damus.io");
  });

  it("should remove duplicates after normalization", () => {
    const input = [
      "wss://relay.damus.io",
      "wss://relay.damus.io/",
      "wss://nos.lol",
      "wss://nos.lol/",
    ];
    const result = normalizeAndDedupe(input);
    expect(result).toHaveLength(2);
    expect(result).toContain("wss://relay.damus.io");
    expect(result).toContain("wss://nos.lol");
  });

  it("should skip invalid URLs", () => {
    const input = ["wss://relay.damus.io", "not-a-url", "wss://nos.lol"];
    const result = normalizeAndDedupe(input);
    // Result may include valid URLs only - exact count depends on normalizeURL implementation
    expect(result.length).toBeGreaterThan(0);
    expect(result).toContain("wss://relay.damus.io");
    expect(result).toContain("wss://nos.lol");
    // Should not contain invalid URL
    expect(
      result.every(
        (url) => url.startsWith("wss://") || url.startsWith("ws://"),
      ),
    ).toBe(true);
  });

  it("should handle empty array", () => {
    expect(normalizeAndDedupe([])).toEqual([]);
  });
});

describe("getWriteRelaysForPubkey", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return relays from NIP-65 relay list", () => {
    const pubkey = "abc123";
    const mockRelayList = {
      kind: 10002,
      pubkey,
      tags: [
        ["r", "wss://relay1.com", "write"],
        ["r", "wss://relay2.com", "write"],
      ],
    } as unknown as NostrEvent;

    vi.mocked(eventStore.getReplaceable).mockReturnValue(mockRelayList);
    vi.mocked(getOutboxes).mockReturnValue(
      new Set(["wss://relay1.com", "wss://relay2.com"]),
    );

    const result = getWriteRelaysForPubkey(pubkey);

    expect(result.relays).toContain("wss://relay1.com");
    expect(result.relays).toContain("wss://relay2.com");
    expect(result.strategy).toBe("pubkey-outbox");
    expect(result.sources).toEqual([pubkey]);
  });

  it("should use fallback when no relay list found", () => {
    const pubkey = "abc123";
    vi.mocked(eventStore.getReplaceable).mockReturnValue(undefined);

    const result = getWriteRelaysForPubkey(pubkey);

    expect(result.relays).toEqual(FALLBACK_RELAYS.slice(0, 5));
    expect(result.strategy).toBe("fallback");
    expect(result.sources).toEqual([]);
  });

  it("should respect maxRelays option", () => {
    const pubkey = "abc123";
    const mockRelayList = {
      kind: 10002,
      pubkey,
      tags: [],
    } as unknown as NostrEvent;

    vi.mocked(eventStore.getReplaceable).mockReturnValue(mockRelayList);
    vi.mocked(getOutboxes).mockReturnValue(
      new Set([
        "wss://relay1.com",
        "wss://relay2.com",
        "wss://relay3.com",
        "wss://relay4.com",
        "wss://relay5.com",
      ]),
    );

    const result = getWriteRelaysForPubkey(pubkey, { maxRelays: 2 });

    expect(result.relays).toHaveLength(2);
  });

  it("should sanitize relays when requested", () => {
    const pubkey = "abc123";
    const mockRelayList = {
      kind: 10002,
      pubkey,
      tags: [],
    } as unknown as NostrEvent;

    vi.mocked(eventStore.getReplaceable).mockReturnValue(mockRelayList);
    vi.mocked(getOutboxes).mockReturnValue(
      new Set(["wss://relay1.com", "ws://localhost:7777", "wss://test.onion"]),
    );

    const result = getWriteRelaysForPubkey(pubkey, { sanitize: true });

    expect(result.relays).toContain("wss://relay1.com");
    expect(result.relays).not.toContain("ws://localhost:7777");
    expect(result.relays).not.toContain("wss://test.onion");
  });

  it("should add fallback when insufficient relays", () => {
    const pubkey = "abc123";
    const mockRelayList = {
      kind: 10002,
      pubkey,
      tags: [],
    } as unknown as NostrEvent;

    vi.mocked(eventStore.getReplaceable).mockReturnValue(mockRelayList);
    vi.mocked(getOutboxes).mockReturnValue(new Set(["wss://relay1.com"]));

    const result = getWriteRelaysForPubkey(pubkey, { includeFallback: true });

    expect(result.relays.length).toBeGreaterThan(1);
    expect(result.relays).toContain("wss://relay1.com");
    // Should include some fallback relays
    const hasFallback = result.relays.some((r) =>
      FALLBACK_RELAYS.includes(r as any),
    );
    expect(hasFallback).toBe(true);
  });

  it("should not add fallback when includeFallback is false", () => {
    const pubkey = "abc123";
    const mockRelayList = {
      kind: 10002,
      pubkey,
      tags: [],
    } as unknown as NostrEvent;

    vi.mocked(eventStore.getReplaceable).mockReturnValue(mockRelayList);
    vi.mocked(getOutboxes).mockReturnValue(new Set(["wss://relay1.com"]));

    const result = getWriteRelaysForPubkey(pubkey, { includeFallback: false });

    expect(result.relays).toEqual(["wss://relay1.com"]);
  });
});

describe("getRelaysWhereEventSeen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return relays where event was seen", () => {
    const event = {
      id: "event123",
      pubkey: "abc123",
      kind: 1,
      content: "test",
      tags: [],
      created_at: 123456,
      sig: "sig",
    } as NostrEvent;

    vi.mocked(getSeenRelays).mockReturnValue(
      new Set(["wss://relay1.com", "wss://relay2.com"]),
    );

    const result = getRelaysWhereEventSeen(event);

    expect(result.relays).toContain("wss://relay1.com");
    expect(result.relays).toContain("wss://relay2.com");
    expect(result.strategy).toBe("event-seen");
    expect(result.sources).toEqual([event.pubkey]);
  });

  it("should use fallback when no seen relays", () => {
    const event = {
      id: "event123",
      pubkey: "abc123",
      kind: 1,
      content: "test",
      tags: [],
      created_at: 123456,
      sig: "sig",
    } as NostrEvent;

    vi.mocked(getSeenRelays).mockReturnValue(undefined);

    const result = getRelaysWhereEventSeen(event);

    expect(result.relays).toEqual(FALLBACK_RELAYS.slice(0, 5));
  });

  it("should respect maxRelays option", () => {
    const event = {
      id: "event123",
      pubkey: "abc123",
      kind: 1,
      content: "test",
      tags: [],
      created_at: 123456,
      sig: "sig",
    } as NostrEvent;

    vi.mocked(getSeenRelays).mockReturnValue(
      new Set([
        "wss://relay1.com",
        "wss://relay2.com",
        "wss://relay3.com",
        "wss://relay4.com",
      ]),
    );

    const result = getRelaysWhereEventSeen(event, { maxRelays: 2 });

    expect(result.relays).toHaveLength(2);
  });
});

describe("combineRelayStrategies", () => {
  it("should merge relays from multiple sources", () => {
    const source1: WriteRelaySelectionResult = {
      relays: ["wss://relay1.com", "wss://relay2.com"],
      strategy: "event-seen",
      sources: ["pubkey1"],
    };

    const source2: WriteRelaySelectionResult = {
      relays: ["wss://relay3.com", "wss://relay4.com"],
      strategy: "pubkey-outbox",
      sources: ["pubkey2"],
    };

    const result = combineRelayStrategies([source1, source2]);

    expect(result.relays).toContain("wss://relay1.com");
    expect(result.relays).toContain("wss://relay2.com");
    expect(result.relays).toContain("wss://relay3.com");
    expect(result.relays).toContain("wss://relay4.com");
    expect(result.strategy).toBe("combined");
    expect(result.sources).toContain("pubkey1");
    expect(result.sources).toContain("pubkey2");
  });

  it("should deduplicate relays", () => {
    const source1: WriteRelaySelectionResult = {
      relays: ["wss://relay1.com", "wss://relay2.com"],
      strategy: "event-seen",
      sources: ["pubkey1"],
    };

    const source2: WriteRelaySelectionResult = {
      relays: ["wss://relay2.com", "wss://relay3.com"],
      strategy: "pubkey-outbox",
      sources: ["pubkey2"],
    };

    const result = combineRelayStrategies([source1, source2]);

    expect(result.relays).toHaveLength(3);
    expect(result.relays.filter((r) => r === "wss://relay2.com")).toHaveLength(
      1,
    );
  });

  it("should preserve order (event-seen first)", () => {
    const source1: WriteRelaySelectionResult = {
      relays: ["wss://relay1.com"],
      strategy: "event-seen",
      sources: ["pubkey1"],
    };

    const source2: WriteRelaySelectionResult = {
      relays: ["wss://relay2.com"],
      strategy: "pubkey-outbox",
      sources: ["pubkey2"],
    };

    const result = combineRelayStrategies([source1, source2]);

    expect(result.relays[0]).toBe("wss://relay1.com");
    expect(result.relays[1]).toBe("wss://relay2.com");
  });

  it("should respect maxRelays option", () => {
    const source1: WriteRelaySelectionResult = {
      relays: ["wss://relay1.com", "wss://relay2.com"],
      strategy: "event-seen",
      sources: ["pubkey1"],
    };

    const source2: WriteRelaySelectionResult = {
      relays: ["wss://relay3.com", "wss://relay4.com"],
      strategy: "pubkey-outbox",
      sources: ["pubkey2"],
    };

    const result = combineRelayStrategies([source1, source2], {
      maxRelays: 2,
    });

    expect(result.relays).toHaveLength(2);
  });
});

describe("getOptimalWriteRelays", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should prioritize event-seen over pubkey relays", () => {
    const pubkey = "abc123";
    const relatedEvent = {
      id: "event123",
      pubkey: "other123",
      kind: 1,
      content: "test",
      tags: [],
      created_at: 123456,
      sig: "sig",
    } as NostrEvent;

    vi.mocked(getSeenRelays).mockReturnValue(
      new Set(["wss://event-relay.com"]),
    );

    const mockRelayList = {
      kind: 10002,
      pubkey,
      tags: [],
    } as unknown as NostrEvent;
    vi.mocked(eventStore.getReplaceable).mockReturnValue(mockRelayList);
    vi.mocked(getOutboxes).mockReturnValue(new Set(["wss://pubkey-relay.com"]));

    const result = getOptimalWriteRelays(pubkey, [relatedEvent], {
      maxRelays: 10,
      includeFallback: false,
    });

    // Event-seen relay should come first
    expect(result.relays[0]).toBe("wss://event-relay.com");
    expect(result.relays).toContain("wss://pubkey-relay.com");
    expect(result.strategy).toBe("combined");
  });

  it("should work with no related events", () => {
    const pubkey = "abc123";

    const mockRelayList = {
      kind: 10002,
      pubkey,
      tags: [],
    } as unknown as NostrEvent;
    vi.mocked(eventStore.getReplaceable).mockReturnValue(mockRelayList);
    vi.mocked(getOutboxes).mockReturnValue(
      new Set(["wss://relay1.com", "wss://relay2.com"]),
    );

    const result = getOptimalWriteRelays(pubkey, [], {
      includeFallback: false,
    });

    expect(result.relays).toContain("wss://relay1.com");
    expect(result.relays).toContain("wss://relay2.com");
  });

  it("should combine multiple related events", () => {
    const pubkey = "abc123";
    const event1 = {
      id: "event1",
      pubkey: "other1",
      kind: 1,
      content: "test",
      tags: [],
      created_at: 123456,
      sig: "sig",
    } as NostrEvent;

    const event2 = {
      id: "event2",
      pubkey: "other2",
      kind: 1,
      content: "test",
      tags: [],
      created_at: 123456,
      sig: "sig",
    } as NostrEvent;

    vi.mocked(getSeenRelays)
      .mockReturnValueOnce(new Set(["wss://relay1.com"]))
      .mockReturnValueOnce(new Set(["wss://relay2.com"]));

    const mockRelayList = {
      kind: 10002,
      pubkey,
      tags: [],
    } as unknown as NostrEvent;
    vi.mocked(eventStore.getReplaceable).mockReturnValue(mockRelayList);
    vi.mocked(getOutboxes).mockReturnValue(new Set(["wss://relay3.com"]));

    const result = getOptimalWriteRelays(pubkey, [event1, event2], {
      maxRelays: 10,
      includeFallback: false,
    });

    expect(result.relays).toContain("wss://relay1.com");
    expect(result.relays).toContain("wss://relay2.com");
    expect(result.relays).toContain("wss://relay3.com");
  });

  it("should add fallback when enabled", () => {
    const pubkey = "abc123";

    vi.mocked(eventStore.getReplaceable).mockReturnValue(undefined);

    const result = getOptimalWriteRelays(pubkey, [], {
      maxRelays: 3,
      includeFallback: true,
    });

    expect(result.relays.length).toBeGreaterThan(0);
    const hasFallback = result.relays.some((r) =>
      FALLBACK_RELAYS.includes(r as any),
    );
    expect(hasFallback).toBe(true);
  });
});
