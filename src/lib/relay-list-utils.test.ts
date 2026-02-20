import { describe, it, expect } from "vitest";
import type { NostrEvent } from "nostr-tools";
import {
  parseRelayEntries,
  buildRelayListTags,
  sanitizeRelayInput,
  relayEntriesEqual,
  getRelayMode,
  modeToFlags,
  type RelayEntry,
  type RelayListKindConfig,
} from "./relay-list-utils";

// --- Fixtures ---

const NIP65_CONFIG: Pick<RelayListKindConfig, "tagName" | "hasMarkers"> = {
  tagName: "r",
  hasMarkers: true,
};

const NIP51_CONFIG: Pick<RelayListKindConfig, "tagName" | "hasMarkers"> = {
  tagName: "relay",
  hasMarkers: false,
};

function makeEvent(
  kind: number,
  tags: string[][],
  overrides?: Partial<NostrEvent>,
): NostrEvent {
  return {
    id: "abc123",
    pubkey: "pubkey123",
    created_at: 1700000000,
    kind,
    tags,
    content: "",
    sig: "sig123",
    ...overrides,
  };
}

// --- parseRelayEntries ---

describe("parseRelayEntries", () => {
  it("should return empty array for undefined event", () => {
    expect(parseRelayEntries(undefined, NIP65_CONFIG)).toEqual([]);
  });

  it("should return empty array for event with no matching tags", () => {
    const event = makeEvent(10002, [
      ["p", "somepubkey"],
      ["e", "someeventid"],
    ]);
    expect(parseRelayEntries(event, NIP65_CONFIG)).toEqual([]);
  });

  describe("NIP-65 (kind 10002) with markers", () => {
    it("should parse relay with no marker as read+write", () => {
      const event = makeEvent(10002, [["r", "wss://relay.example.com/"]]);
      const result = parseRelayEntries(event, NIP65_CONFIG);
      expect(result).toEqual([
        { url: "wss://relay.example.com/", read: true, write: true },
      ]);
    });

    it("should parse relay with read marker", () => {
      const event = makeEvent(10002, [
        ["r", "wss://relay.example.com/", "read"],
      ]);
      const result = parseRelayEntries(event, NIP65_CONFIG);
      expect(result).toEqual([
        { url: "wss://relay.example.com/", read: true, write: false },
      ]);
    });

    it("should parse relay with write marker", () => {
      const event = makeEvent(10002, [
        ["r", "wss://relay.example.com/", "write"],
      ]);
      const result = parseRelayEntries(event, NIP65_CONFIG);
      expect(result).toEqual([
        { url: "wss://relay.example.com/", read: false, write: true },
      ]);
    });

    it("should parse mixed markers", () => {
      const event = makeEvent(10002, [
        ["r", "wss://both.example.com/"],
        ["r", "wss://read.example.com/", "read"],
        ["r", "wss://write.example.com/", "write"],
      ]);
      const result = parseRelayEntries(event, NIP65_CONFIG);
      expect(result).toEqual([
        { url: "wss://both.example.com/", read: true, write: true },
        { url: "wss://read.example.com/", read: true, write: false },
        { url: "wss://write.example.com/", read: false, write: true },
      ]);
    });

    it("should normalize relay URLs", () => {
      const event = makeEvent(10002, [["r", "wss://RELAY.Example.COM"]]);
      const result = parseRelayEntries(event, NIP65_CONFIG);
      expect(result[0].url).toBe("wss://relay.example.com/");
    });

    it("should deduplicate relay URLs after normalization", () => {
      const event = makeEvent(10002, [
        ["r", "wss://relay.example.com/"],
        ["r", "wss://relay.example.com"],
        ["r", "wss://RELAY.EXAMPLE.COM/"],
      ]);
      const result = parseRelayEntries(event, NIP65_CONFIG);
      expect(result).toHaveLength(1);
    });

    it("should skip tags with empty URL", () => {
      const event = makeEvent(10002, [
        ["r", ""],
        ["r", "wss://valid.example.com/"],
      ]);
      const result = parseRelayEntries(event, NIP65_CONFIG);
      expect(result).toHaveLength(1);
      expect(result[0].url).toBe("wss://valid.example.com/");
    });

    it("should skip invalid relay URLs gracefully", () => {
      const event = makeEvent(10002, [
        ["r", "not a valid url at all!!!"],
        ["r", "wss://valid.example.com/"],
      ]);
      const result = parseRelayEntries(event, NIP65_CONFIG);
      expect(result).toHaveLength(1);
      expect(result[0].url).toBe("wss://valid.example.com/");
    });

    it("should ignore non-r tags", () => {
      const event = makeEvent(10002, [
        ["relay", "wss://ignored.example.com/"],
        ["r", "wss://included.example.com/"],
        ["p", "somepubkey"],
      ]);
      const result = parseRelayEntries(event, NIP65_CONFIG);
      expect(result).toHaveLength(1);
      expect(result[0].url).toBe("wss://included.example.com/");
    });
  });

  describe("NIP-51 (relay tag) without markers", () => {
    it("should parse relay tags as read+write", () => {
      const event = makeEvent(10006, [["relay", "wss://blocked.example.com/"]]);
      const result = parseRelayEntries(event, NIP51_CONFIG);
      expect(result).toEqual([
        { url: "wss://blocked.example.com/", read: true, write: true },
      ]);
    });

    it("should ignore markers on NIP-51 lists", () => {
      const event = makeEvent(10007, [
        ["relay", "wss://search.example.com/", "read"],
      ]);
      const result = parseRelayEntries(event, NIP51_CONFIG);
      expect(result).toEqual([
        { url: "wss://search.example.com/", read: true, write: true },
      ]);
    });

    it("should parse multiple relay tags", () => {
      const event = makeEvent(10050, [
        ["relay", "wss://dm1.example.com/"],
        ["relay", "wss://dm2.example.com/"],
      ]);
      const result = parseRelayEntries(event, NIP51_CONFIG);
      expect(result).toHaveLength(2);
    });

    it("should deduplicate NIP-51 relay URLs", () => {
      const event = makeEvent(10006, [
        ["relay", "wss://relay.example.com/"],
        ["relay", "wss://relay.example.com"],
      ]);
      const result = parseRelayEntries(event, NIP51_CONFIG);
      expect(result).toHaveLength(1);
    });

    it("should ignore r tags for NIP-51 config", () => {
      const event = makeEvent(10006, [
        ["r", "wss://ignored.example.com/"],
        ["relay", "wss://included.example.com/"],
      ]);
      const result = parseRelayEntries(event, NIP51_CONFIG);
      expect(result).toHaveLength(1);
      expect(result[0].url).toBe("wss://included.example.com/");
    });
  });
});

// --- buildRelayListTags ---

describe("buildRelayListTags", () => {
  describe("NIP-65 format (r tags with markers)", () => {
    it("should build r tag without marker for read+write", () => {
      const entries: RelayEntry[] = [
        { url: "wss://relay.example.com/", read: true, write: true },
      ];
      expect(buildRelayListTags(entries, NIP65_CONFIG)).toEqual([
        ["r", "wss://relay.example.com/"],
      ]);
    });

    it("should build r tag with read marker", () => {
      const entries: RelayEntry[] = [
        { url: "wss://relay.example.com/", read: true, write: false },
      ];
      expect(buildRelayListTags(entries, NIP65_CONFIG)).toEqual([
        ["r", "wss://relay.example.com/", "read"],
      ]);
    });

    it("should build r tag with write marker", () => {
      const entries: RelayEntry[] = [
        { url: "wss://relay.example.com/", read: false, write: true },
      ];
      expect(buildRelayListTags(entries, NIP65_CONFIG)).toEqual([
        ["r", "wss://relay.example.com/", "write"],
      ]);
    });

    it("should build mixed tags", () => {
      const entries: RelayEntry[] = [
        { url: "wss://both.com/", read: true, write: true },
        { url: "wss://read.com/", read: true, write: false },
        { url: "wss://write.com/", read: false, write: true },
      ];
      expect(buildRelayListTags(entries, NIP65_CONFIG)).toEqual([
        ["r", "wss://both.com/"],
        ["r", "wss://read.com/", "read"],
        ["r", "wss://write.com/", "write"],
      ]);
    });

    it("should return empty array for empty entries", () => {
      expect(buildRelayListTags([], NIP65_CONFIG)).toEqual([]);
    });
  });

  describe("NIP-51 format (relay tags)", () => {
    it("should build relay tags", () => {
      const entries: RelayEntry[] = [
        { url: "wss://relay.example.com/", read: true, write: true },
      ];
      expect(buildRelayListTags(entries, NIP51_CONFIG)).toEqual([
        ["relay", "wss://relay.example.com/"],
      ]);
    });

    it("should ignore read/write flags for NIP-51 tags", () => {
      const entries: RelayEntry[] = [
        { url: "wss://relay.example.com/", read: true, write: false },
      ];
      expect(buildRelayListTags(entries, NIP51_CONFIG)).toEqual([
        ["relay", "wss://relay.example.com/"],
      ]);
    });
  });

  describe("roundtrip: parse -> build -> parse", () => {
    it("should roundtrip NIP-65 events", () => {
      const originalTags = [
        ["r", "wss://both.example.com/"],
        ["r", "wss://read.example.com/", "read"],
        ["r", "wss://write.example.com/", "write"],
      ];
      const event = makeEvent(10002, originalTags);
      const entries = parseRelayEntries(event, NIP65_CONFIG);
      const rebuiltTags = buildRelayListTags(entries, NIP65_CONFIG);
      expect(rebuiltTags).toEqual(originalTags);
    });

    it("should roundtrip NIP-51 events", () => {
      const originalTags = [
        ["relay", "wss://relay1.example.com/"],
        ["relay", "wss://relay2.example.com/"],
      ];
      const event = makeEvent(10006, originalTags);
      const entries = parseRelayEntries(event, NIP51_CONFIG);
      const rebuiltTags = buildRelayListTags(entries, NIP51_CONFIG);
      expect(rebuiltTags).toEqual(originalTags);
    });
  });
});

// --- sanitizeRelayInput ---

describe("sanitizeRelayInput", () => {
  it("should return null for empty string", () => {
    expect(sanitizeRelayInput("")).toBeNull();
  });

  it("should return null for whitespace-only string", () => {
    expect(sanitizeRelayInput("   ")).toBeNull();
  });

  it("should normalize a valid wss:// URL", () => {
    expect(sanitizeRelayInput("wss://relay.example.com")).toBe(
      "wss://relay.example.com/",
    );
  });

  it("should add wss:// scheme if missing", () => {
    expect(sanitizeRelayInput("relay.example.com")).toBe(
      "wss://relay.example.com/",
    );
  });

  it("should preserve ws:// scheme", () => {
    const result = sanitizeRelayInput("ws://localhost:8080");
    expect(result).toBe("ws://localhost:8080/");
  });

  it("should trim whitespace", () => {
    expect(sanitizeRelayInput("  wss://relay.example.com  ")).toBe(
      "wss://relay.example.com/",
    );
  });

  it("should lowercase the URL", () => {
    expect(sanitizeRelayInput("wss://RELAY.EXAMPLE.COM")).toBe(
      "wss://relay.example.com/",
    );
  });

  it("should add trailing slash", () => {
    expect(sanitizeRelayInput("wss://relay.example.com")).toBe(
      "wss://relay.example.com/",
    );
  });

  it("should handle URLs with paths", () => {
    const result = sanitizeRelayInput("wss://relay.example.com/custom");
    expect(result).toBe("wss://relay.example.com/custom");
  });

  it("should return null for completely invalid input", () => {
    expect(sanitizeRelayInput("not a url at all!!!")).toBeNull();
  });

  it("should handle bare hostname with port", () => {
    const result = sanitizeRelayInput("relay.example.com:8080");
    expect(result).toBe("wss://relay.example.com:8080/");
  });

  it("should strip default wss port 443", () => {
    const result = sanitizeRelayInput("relay.example.com:443");
    expect(result).toBe("wss://relay.example.com/");
  });
});

// --- relayEntriesEqual ---

describe("relayEntriesEqual", () => {
  it("should return true for two empty arrays", () => {
    expect(relayEntriesEqual([], [])).toBe(true);
  });

  it("should return true for identical entries", () => {
    const a: RelayEntry[] = [
      { url: "wss://a.com/", read: true, write: true },
      { url: "wss://b.com/", read: true, write: false },
    ];
    const b: RelayEntry[] = [
      { url: "wss://a.com/", read: true, write: true },
      { url: "wss://b.com/", read: true, write: false },
    ];
    expect(relayEntriesEqual(a, b)).toBe(true);
  });

  it("should return false for different lengths", () => {
    const a: RelayEntry[] = [{ url: "wss://a.com/", read: true, write: true }];
    const b: RelayEntry[] = [];
    expect(relayEntriesEqual(a, b)).toBe(false);
  });

  it("should return false for different URLs", () => {
    const a: RelayEntry[] = [{ url: "wss://a.com/", read: true, write: true }];
    const b: RelayEntry[] = [{ url: "wss://b.com/", read: true, write: true }];
    expect(relayEntriesEqual(a, b)).toBe(false);
  });

  it("should return false for different read flags", () => {
    const a: RelayEntry[] = [{ url: "wss://a.com/", read: true, write: true }];
    const b: RelayEntry[] = [{ url: "wss://a.com/", read: false, write: true }];
    expect(relayEntriesEqual(a, b)).toBe(false);
  });

  it("should return false for different write flags", () => {
    const a: RelayEntry[] = [{ url: "wss://a.com/", read: true, write: true }];
    const b: RelayEntry[] = [{ url: "wss://a.com/", read: true, write: false }];
    expect(relayEntriesEqual(a, b)).toBe(false);
  });

  it("should be order-sensitive", () => {
    const a: RelayEntry[] = [
      { url: "wss://a.com/", read: true, write: true },
      { url: "wss://b.com/", read: true, write: true },
    ];
    const b: RelayEntry[] = [
      { url: "wss://b.com/", read: true, write: true },
      { url: "wss://a.com/", read: true, write: true },
    ];
    expect(relayEntriesEqual(a, b)).toBe(false);
  });
});

// --- getRelayMode ---

describe("getRelayMode", () => {
  it("should return readwrite for read+write", () => {
    expect(getRelayMode({ url: "wss://a.com/", read: true, write: true })).toBe(
      "readwrite",
    );
  });

  it("should return read for read-only", () => {
    expect(
      getRelayMode({ url: "wss://a.com/", read: true, write: false }),
    ).toBe("read");
  });

  it("should return write for write-only", () => {
    expect(
      getRelayMode({ url: "wss://a.com/", read: false, write: true }),
    ).toBe("write");
  });

  it("should return write for neither read nor write", () => {
    // Edge case: both false defaults to "write" (last branch)
    expect(
      getRelayMode({ url: "wss://a.com/", read: false, write: false }),
    ).toBe("write");
  });
});

// --- modeToFlags ---

describe("modeToFlags", () => {
  it("should return both true for readwrite", () => {
    expect(modeToFlags("readwrite")).toEqual({ read: true, write: true });
  });

  it("should return read=true, write=false for read", () => {
    expect(modeToFlags("read")).toEqual({ read: true, write: false });
  });

  it("should return read=false, write=true for write", () => {
    expect(modeToFlags("write")).toEqual({ read: false, write: true });
  });

  it("should roundtrip with getRelayMode", () => {
    for (const mode of ["readwrite", "read", "write"] as const) {
      const flags = modeToFlags(mode);
      const entry = { url: "wss://test.com/", ...flags };
      expect(getRelayMode(entry)).toBe(mode);
    }
  });
});
