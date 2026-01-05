/**
 * Tests for NIP-65 Relay Selection
 */

import { describe, it, expect, beforeEach } from "vitest";
import { selectRelaysForFilter } from "./relay-selection";
import { EventStore } from "applesauce-core";
import type { NostrEvent } from "nostr-tools";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools";
import relayListCache from "./relay-list-cache";

// Helper to create valid test events
function createRelayListEvent(
  secretKey: Uint8Array,
  tags: string[][],
): NostrEvent {
  return finalizeEvent(
    {
      kind: 10002,
      created_at: Math.floor(Date.now() / 1000),
      tags,
      content: "",
    },
    secretKey,
  );
}

// Generate valid test keys using generateSecretKey
const testSecretKeys: Uint8Array[] = [];
const testPubkeys: string[] = [];
for (let i = 0; i < 15; i++) {
  const secretKey = generateSecretKey();
  testSecretKeys.push(secretKey);
  testPubkeys.push(getPublicKey(secretKey));
}

describe("selectRelaysForFilter", () => {
  let eventStore: EventStore;

  beforeEach(async () => {
    eventStore = new EventStore();
    // Clear the relay list cache to ensure test isolation
    await relayListCache.clear();
  });

  describe("fallback behavior", () => {
    it("should return fallback relays when no authors or #p tags", async () => {
      const result = await selectRelaysForFilter(eventStore, {
        kinds: [1],
        limit: 50,
      });

      expect(result.isOptimized).toBe(false);
      expect(result.relays.length).toBeGreaterThan(0);
      expect(result.reasoning.every((r) => r.isFallback)).toBe(true);
    });

    it("should use custom fallback relays when provided", async () => {
      const customFallback = ["wss://custom.relay.com"];

      const result = await selectRelaysForFilter(
        eventStore,
        { kinds: [1] },
        { fallbackRelays: customFallback },
      );

      expect(result.relays).toEqual(customFallback);
    });
  });

  describe("author relay selection", () => {
    it("should select write relays for authors", async () => {
      const authorPubkey = testPubkeys[0];

      // Create valid kind:10002 event with write relays
      const relayListEvent = createRelayListEvent(testSecretKeys[0], [
        ["r", "wss://relay.damus.io"],
        ["r", "wss://nos.lol"],
        ["r", "wss://relay.nostr.band", "read"],
      ]);

      // Add to event store
      eventStore.add(relayListEvent);

      const result = await selectRelaysForFilter(
        eventStore,
        {
          authors: [authorPubkey],
          kinds: [1],
        },
        { timeout: 100 }, // Short timeout since event is already in store
      );

      expect(result.isOptimized).toBe(true);
      expect(result.relays.length).toBeGreaterThan(0);
      // Should include at least one write relay - selectOptimalRelays may pick subset
      const hasWriteRelay =
        result.relays.includes("wss://relay.damus.io/") ||
        result.relays.includes("wss://nos.lol/");
      expect(hasWriteRelay).toBe(true);
      // Should NOT include read-only relay
      expect(result.relays).not.toContain("wss://relay.nostr.band/");
    });

    it("should handle multiple authors", async () => {
      const author1 = testPubkeys[0];
      const author2 = testPubkeys[1];

      // Create valid relay lists for both authors
      eventStore.add(
        createRelayListEvent(testSecretKeys[0], [
          ["r", "wss://relay.damus.io"],
        ]),
      );

      eventStore.add(
        createRelayListEvent(testSecretKeys[1], [["r", "wss://nos.lol"]]),
      );

      const result = await selectRelaysForFilter(
        eventStore,
        {
          authors: [author1, author2],
          kinds: [1],
        },
        { timeout: 100 },
      );

      expect(result.isOptimized).toBe(true);
      expect(result.relays).toContain("wss://relay.damus.io/");
      expect(result.relays).toContain("wss://nos.lol/");
      expect(result.reasoning.every((r) => r.writers.length > 0)).toBe(true);
    });
  });

  describe("p-tag relay selection", () => {
    it("should select read relays for #p tags", async () => {
      const mentionedPubkey = testPubkeys[2];

      // Create valid kind:10002 event with read relays
      const relayListEvent = createRelayListEvent(testSecretKeys[2], [
        ["r", "wss://relay.damus.io", "write"],
        ["r", "wss://nos.lol", "read"],
        ["r", "wss://relay.nostr.band", "read"],
      ]);

      eventStore.add(relayListEvent);

      const result = await selectRelaysForFilter(
        eventStore,
        {
          "#p": [mentionedPubkey],
          kinds: [1],
        },
        { timeout: 100 },
      );

      expect(result.isOptimized).toBe(true);
      expect(result.relays.length).toBeGreaterThan(0);
      // Should include at least one read relay - selectOptimalRelays may pick subset
      const hasReadRelay =
        result.relays.includes("wss://nos.lol/") ||
        result.relays.includes("wss://relay.nostr.band/");
      expect(hasReadRelay).toBe(true);
      // Should NOT include write-only relay
      expect(result.relays).not.toContain("wss://relay.damus.io/");
    });
  });

  describe("mixed authors and #p tags", () => {
    it("should combine outbox and inbox relays", async () => {
      const author = testPubkeys[3];
      const mentioned = testPubkeys[4];

      // Author has write relays
      eventStore.add(
        createRelayListEvent(testSecretKeys[3], [
          ["r", "wss://author-relay.com"],
        ]),
      );

      // Mentioned user has read relays
      eventStore.add(
        createRelayListEvent(testSecretKeys[4], [
          ["r", "wss://mention-relay.com", "read"],
        ]),
      );

      const result = await selectRelaysForFilter(
        eventStore,
        {
          authors: [author],
          "#p": [mentioned],
          kinds: [1],
        },
        { timeout: 100 },
      );

      expect(result.isOptimized).toBe(true);
      expect(result.relays).toContain("wss://author-relay.com/");
      expect(result.relays).toContain("wss://mention-relay.com/");

      // Check reasoning types
      const authorReasoning = result.reasoning.find((r) =>
        r.relay.includes("author-relay"),
      );
      const mentionReasoning = result.reasoning.find((r) =>
        r.relay.includes("mention-relay"),
      );

      expect(authorReasoning?.writers.length).toBeGreaterThan(0);
      expect(authorReasoning?.readers.length).toBe(0);
      expect(mentionReasoning?.readers.length).toBeGreaterThan(0);
      expect(mentionReasoning?.writers.length).toBe(0);
    });

    it("should maintain diversity with multiple authors and p-tags", async () => {
      const author1 = testPubkeys[5];
      const author2 = testPubkeys[6];
      const mentioned1 = testPubkeys[7];
      const mentioned2 = testPubkeys[8];

      // Authors have write relays
      eventStore.add(
        createRelayListEvent(testSecretKeys[5], [
          ["r", "wss://author1-relay.com"],
        ]),
      );

      eventStore.add(
        createRelayListEvent(testSecretKeys[6], [
          ["r", "wss://author2-relay.com"],
        ]),
      );

      // Mentioned users have read relays
      eventStore.add(
        createRelayListEvent(testSecretKeys[7], [
          ["r", "wss://mention1-relay.com", "read"],
        ]),
      );

      eventStore.add(
        createRelayListEvent(testSecretKeys[8], [
          ["r", "wss://mention2-relay.com", "read"],
        ]),
      );

      const result = await selectRelaysForFilter(
        eventStore,
        {
          authors: [author1, author2],
          "#p": [mentioned1, mentioned2],
          kinds: [1],
        },
        { timeout: 100, maxRelays: 10 },
      );

      expect(result.isOptimized).toBe(true);

      // Should have relays from both groups
      const outboxRelays = result.reasoning.filter((r) => r.writers.length > 0);
      const inboxRelays = result.reasoning.filter((r) => r.readers.length > 0);

      expect(outboxRelays.length).toBeGreaterThan(0);
      expect(inboxRelays.length).toBeGreaterThan(0);

      // Should include at least some relays from each category
      const hasAuthorRelays =
        result.relays.some((r) => r.includes("author1-relay")) ||
        result.relays.some((r) => r.includes("author2-relay"));
      const hasMentionRelays =
        result.relays.some((r) => r.includes("mention1-relay")) ||
        result.relays.some((r) => r.includes("mention2-relay"));

      expect(hasAuthorRelays).toBe(true);
      expect(hasMentionRelays).toBe(true);
    });
  });

  describe("relay limits", () => {
    it("should respect maxRelays limit", async () => {
      // Create many authors with different relays (use first 10 test keys)
      const authors = Array.from({ length: 10 }, (_, i) => ({
        secretKey: testSecretKeys[i],
        pubkey: testPubkeys[i],
        relay: `wss://relay${i}.com`,
      }));

      authors.forEach(({ secretKey, relay }) => {
        eventStore.add(createRelayListEvent(secretKey, [["r", relay]]));
      });

      const result = await selectRelaysForFilter(
        eventStore,
        {
          authors: authors.map((a) => a.pubkey),
          kinds: [1],
        },
        { maxRelays: 5, timeout: 100 },
      );

      expect(result.relays.length).toBeLessThanOrEqual(5);
    });
  });

  describe("edge cases", () => {
    it("should handle users with no relay lists", async () => {
      // Use a pubkey that doesn't have a relay list added
      const pubkeyWithoutList = testPubkeys[14];

      const result = await selectRelaysForFilter(
        eventStore,
        {
          authors: [pubkeyWithoutList],
          kinds: [1],
        },
        { timeout: 100, fallbackRelays: ["wss://fallback.com"] },
      );

      expect(result.relays).toContain("wss://fallback.com");
    });

    it("should handle invalid relay URLs gracefully", async () => {
      const pubkey = testPubkeys[10];

      // Add relay list with invalid URL
      eventStore.add(
        createRelayListEvent(testSecretKeys[10], [
          ["r", "not-a-valid-url"],
          ["r", "wss://valid-relay.com"],
        ]),
      );

      const result = await selectRelaysForFilter(
        eventStore,
        {
          authors: [pubkey],
          kinds: [1],
        },
        { timeout: 100 },
      );

      // Should only include valid relay - normalized with trailing slash
      expect(result.relays).toContain("wss://valid-relay.com/");
      expect(result.relays).not.toContain("not-a-valid-url");
    });
  });
});
