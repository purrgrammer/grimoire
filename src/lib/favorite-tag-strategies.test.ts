import { describe, it, expect } from "vitest";
import { SeenRelaysSymbol } from "applesauce-core/helpers/relays";
import {
  eTagStrategy,
  aTagStrategy,
  groupTagStrategy,
} from "./favorite-tag-strategies";
import type { NostrEvent } from "@/types/nostr";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(overrides: Partial<NostrEvent> = {}): NostrEvent {
  return {
    id: "abc123def456",
    pubkey: "pub123",
    created_at: 1700000000,
    kind: 1,
    tags: [],
    content: "",
    sig: "sig",
    ...overrides,
  };
}

function withSeenRelays(event: NostrEvent, relays: string[]): NostrEvent {
  (event as any)[SeenRelaysSymbol] = new Set(relays);
  return event;
}

// ===========================================================================
// eTagStrategy
// ===========================================================================

describe("eTagStrategy", () => {
  describe("getItemKey", () => {
    it("returns the event id", () => {
      const event = makeEvent({ id: "deadbeef" });
      expect(eTagStrategy.getItemKey(event)).toBe("deadbeef");
    });
  });

  describe("buildTag", () => {
    it("returns [e, id] when no seen relays", () => {
      const event = makeEvent({ id: "deadbeef" });
      expect(eTagStrategy.buildTag(event)).toEqual(["e", "deadbeef"]);
    });

    it("includes relay hint from seen relays", () => {
      const event = withSeenRelays(makeEvent({ id: "deadbeef" }), [
        "wss://relay.example.com/",
      ]);
      expect(eTagStrategy.buildTag(event)).toEqual([
        "e",
        "deadbeef",
        "wss://relay.example.com/",
      ]);
    });
  });

  describe("matchesKey", () => {
    it("matches when tag[0]=e and tag[1]=key", () => {
      expect(eTagStrategy.matchesKey(["e", "abc"], "abc")).toBe(true);
    });

    it("does not match different key", () => {
      expect(eTagStrategy.matchesKey(["e", "abc"], "xyz")).toBe(false);
    });

    it("does not match different tag type", () => {
      expect(eTagStrategy.matchesKey(["a", "abc"], "abc")).toBe(false);
    });
  });

  describe("keyFromTag", () => {
    it("returns tag[1] for e tags", () => {
      expect(eTagStrategy.keyFromTag(["e", "abc", "relay"])).toBe("abc");
    });

    it("returns undefined for non-e tags", () => {
      expect(eTagStrategy.keyFromTag(["a", "abc"])).toBeUndefined();
    });

    it("returns undefined for empty e tag", () => {
      expect(eTagStrategy.keyFromTag(["e"])).toBeUndefined();
    });
  });
});

// ===========================================================================
// aTagStrategy
// ===========================================================================

describe("aTagStrategy", () => {
  describe("getItemKey", () => {
    it("returns kind:pubkey:d-tag coordinate", () => {
      const event = makeEvent({
        kind: 30023,
        pubkey: "author1",
        tags: [["d", "my-article"]],
      });
      expect(aTagStrategy.getItemKey(event)).toBe("30023:author1:my-article");
    });

    it("handles missing d-tag gracefully", () => {
      const event = makeEvent({ kind: 30023, pubkey: "author1" });
      expect(aTagStrategy.getItemKey(event)).toBe("30023:author1:");
    });
  });

  describe("buildTag", () => {
    it("returns [a, coordinate] when no seen relays", () => {
      const event = makeEvent({
        kind: 30617,
        pubkey: "pub1",
        tags: [["d", "repo-id"]],
      });
      expect(aTagStrategy.buildTag(event)).toEqual(["a", "30617:pub1:repo-id"]);
    });

    it("includes relay hint from seen relays", () => {
      const event = withSeenRelays(
        makeEvent({
          kind: 30617,
          pubkey: "pub1",
          tags: [["d", "repo-id"]],
        }),
        ["wss://relay.example.com/"],
      );
      expect(aTagStrategy.buildTag(event)).toEqual([
        "a",
        "30617:pub1:repo-id",
        "wss://relay.example.com/",
      ]);
    });
  });

  describe("matchesKey", () => {
    it("matches when tag[0]=a and tag[1]=key", () => {
      expect(
        aTagStrategy.matchesKey(
          ["a", "30617:pub1:repo-id"],
          "30617:pub1:repo-id",
        ),
      ).toBe(true);
    });

    it("does not match different coordinate", () => {
      expect(
        aTagStrategy.matchesKey(
          ["a", "30617:pub1:repo-id"],
          "30617:pub1:other",
        ),
      ).toBe(false);
    });

    it("does not match different tag type", () => {
      expect(
        aTagStrategy.matchesKey(
          ["e", "30617:pub1:repo-id"],
          "30617:pub1:repo-id",
        ),
      ).toBe(false);
    });
  });

  describe("keyFromTag", () => {
    it("returns tag[1] for a tags", () => {
      expect(aTagStrategy.keyFromTag(["a", "30617:pub1:repo"])).toBe(
        "30617:pub1:repo",
      );
    });

    it("returns undefined for non-a tags", () => {
      expect(aTagStrategy.keyFromTag(["e", "abc"])).toBeUndefined();
    });
  });
});

// ===========================================================================
// groupTagStrategy
// ===========================================================================

describe("groupTagStrategy", () => {
  describe("getItemKey", () => {
    it("returns normalizedRelayUrl'groupId", () => {
      const event = withSeenRelays(
        makeEvent({
          kind: 39000,
          tags: [["d", "bitcoin-dev"]],
        }),
        ["wss://groups.nostr.com/"],
      );
      expect(groupTagStrategy.getItemKey(event)).toBe(
        "wss://groups.nostr.com/'bitcoin-dev",
      );
    });

    it("normalizes relay URL without protocol", () => {
      const event = withSeenRelays(
        makeEvent({
          kind: 39000,
          tags: [["d", "test-group"]],
        }),
        ["groups.nostr.com"],
      );
      expect(groupTagStrategy.getItemKey(event)).toBe(
        "wss://groups.nostr.com/'test-group",
      );
    });

    it("returns empty string when no seen relays", () => {
      const event = makeEvent({
        kind: 39000,
        tags: [["d", "bitcoin-dev"]],
      });
      expect(groupTagStrategy.getItemKey(event)).toBe("");
    });

    it("handles missing d-tag", () => {
      const event = withSeenRelays(makeEvent({ kind: 39000 }), [
        "wss://groups.nostr.com/",
      ]);
      expect(groupTagStrategy.getItemKey(event)).toBe(
        "wss://groups.nostr.com/'",
      );
    });
  });

  describe("buildTag", () => {
    it("returns [group, groupId, normalizedRelay]", () => {
      const event = withSeenRelays(
        makeEvent({
          kind: 39000,
          tags: [["d", "bitcoin-dev"]],
        }),
        ["wss://groups.nostr.com/"],
      );
      expect(groupTagStrategy.buildTag(event)).toEqual([
        "group",
        "bitcoin-dev",
        "wss://groups.nostr.com/",
      ]);
    });

    it("normalizes relay URL in built tag", () => {
      const event = withSeenRelays(
        makeEvent({
          kind: 39000,
          tags: [["d", "test-group"]],
        }),
        ["Groups.Nostr.COM"],
      );
      const tag = groupTagStrategy.buildTag(event);
      expect(tag[2]).toBe("wss://groups.nostr.com/");
    });

    it("returns tag without relay when no seen relays", () => {
      const event = makeEvent({
        kind: 39000,
        tags: [["d", "bitcoin-dev"]],
      });
      const tag = groupTagStrategy.buildTag(event);
      expect(tag).toEqual(["group", "bitcoin-dev"]);
    });
  });

  describe("matchesKey", () => {
    it("matches with normalized relay URL", () => {
      expect(
        groupTagStrategy.matchesKey(
          ["group", "bitcoin-dev", "wss://groups.nostr.com/"],
          "wss://groups.nostr.com/'bitcoin-dev",
        ),
      ).toBe(true);
    });

    it("normalizes relay URL in tag for comparison", () => {
      expect(
        groupTagStrategy.matchesKey(
          ["group", "bitcoin-dev", "groups.nostr.com"],
          "wss://groups.nostr.com/'bitcoin-dev",
        ),
      ).toBe(true);
    });

    it("handles wss:// vs no-protocol mismatch", () => {
      expect(
        groupTagStrategy.matchesKey(
          ["group", "test", "wss://relay.example.com/"],
          "wss://relay.example.com/'test",
        ),
      ).toBe(true);
    });

    it("handles ws:// protocol", () => {
      // ws:// stays as ws:// after normalization
      expect(
        groupTagStrategy.matchesKey(
          ["group", "test", "ws://relay.example.com/"],
          "ws://relay.example.com/'test",
        ),
      ).toBe(true);
    });

    it("does not match different group id", () => {
      expect(
        groupTagStrategy.matchesKey(
          ["group", "bitcoin-dev", "wss://groups.nostr.com/"],
          "wss://groups.nostr.com/'other-group",
        ),
      ).toBe(false);
    });

    it("does not match different relay", () => {
      expect(
        groupTagStrategy.matchesKey(
          ["group", "bitcoin-dev", "wss://groups.nostr.com/"],
          "wss://other-relay.com/'bitcoin-dev",
        ),
      ).toBe(false);
    });

    it("does not match non-group tags", () => {
      expect(
        groupTagStrategy.matchesKey(
          ["e", "bitcoin-dev", "wss://groups.nostr.com/"],
          "wss://groups.nostr.com/'bitcoin-dev",
        ),
      ).toBe(false);
    });

    it("returns false when tag has no relay", () => {
      expect(
        groupTagStrategy.matchesKey(
          ["group", "bitcoin-dev"],
          "wss://groups.nostr.com/'bitcoin-dev",
        ),
      ).toBe(false);
    });
  });

  describe("keyFromTag", () => {
    it("returns normalizedRelayUrl'groupId", () => {
      expect(
        groupTagStrategy.keyFromTag([
          "group",
          "bitcoin-dev",
          "wss://groups.nostr.com/",
        ]),
      ).toBe("wss://groups.nostr.com/'bitcoin-dev");
    });

    it("normalizes relay URL in tag", () => {
      expect(
        groupTagStrategy.keyFromTag([
          "group",
          "bitcoin-dev",
          "groups.nostr.com",
        ]),
      ).toBe("wss://groups.nostr.com/'bitcoin-dev");
    });

    it("returns undefined for non-group tags", () => {
      expect(groupTagStrategy.keyFromTag(["e", "abc"])).toBeUndefined();
    });

    it("returns undefined for group tag without relay", () => {
      expect(
        groupTagStrategy.keyFromTag(["group", "bitcoin-dev"]),
      ).toBeUndefined();
    });

    it("returns undefined for group tag without groupId", () => {
      expect(groupTagStrategy.keyFromTag(["group"])).toBeUndefined();
    });
  });
});
