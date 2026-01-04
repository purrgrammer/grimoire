import { describe, it, expect } from "vitest";
import {
  getAppName,
  getAppDescription,
  getAppImage,
  getSupportedKinds,
  getPlatformUrls,
  getAvailablePlatforms,
  getHandlerIdentifier,
  getRecommendedKind,
  parseAddressPointer,
  getHandlerReferences,
  getHandlersByPlatform,
  getRecommendedPlatforms,
  substituteTemplate,
  hasPlaceholder,
  formatAddressPointer,
} from "./nip89-helpers";
import { NostrEvent } from "@/types/nostr";

// Helper to create a minimal kind 31990 event
function createHandlerEvent(
  overrides?: Partial<NostrEvent>
): NostrEvent {
  return {
    id: "test-id",
    pubkey: "test-pubkey",
    created_at: 1234567890,
    kind: 31990,
    tags: [],
    content: "",
    sig: "test-sig",
    ...overrides,
  };
}

// Helper to create a minimal kind 31989 event
function createRecommendationEvent(
  overrides?: Partial<NostrEvent>
): NostrEvent {
  return {
    id: "test-id",
    pubkey: "test-pubkey",
    created_at: 1234567890,
    kind: 31989,
    tags: [],
    content: "",
    sig: "test-sig",
    ...overrides,
  };
}

describe("Kind 31990 (Application Handler) Helpers", () => {
  describe("getAppName", () => {
    it("should extract name from content JSON", () => {
      const event = createHandlerEvent({
        content: JSON.stringify({ name: "My Nostr App" }),
        tags: [["d", "my-app"]],
      });
      expect(getAppName(event)).toBe("My Nostr App");
    });

    it("should fallback to d tag if no content", () => {
      const event = createHandlerEvent({
        content: "",
        tags: [["d", "my-app-identifier"]],
      });
      expect(getAppName(event)).toBe("my-app-identifier");
    });

    it("should fallback to d tag if content is not valid JSON", () => {
      const event = createHandlerEvent({
        content: "not json",
        tags: [["d", "fallback-name"]],
      });
      expect(getAppName(event)).toBe("fallback-name");
    });

    it("should return 'Unknown App' if no name and no d tag", () => {
      const event = createHandlerEvent({
        content: "",
        tags: [],
      });
      expect(getAppName(event)).toBe("Unknown App");
    });
  });

  describe("getAppDescription", () => {
    it("should extract description from content JSON", () => {
      const event = createHandlerEvent({
        content: JSON.stringify({ description: "A great app" }),
      });
      expect(getAppDescription(event)).toBe("A great app");
    });

    it("should return undefined if no content", () => {
      const event = createHandlerEvent({ content: "" });
      expect(getAppDescription(event)).toBeUndefined();
    });

    it("should return undefined if content is not valid JSON", () => {
      const event = createHandlerEvent({ content: "not json" });
      expect(getAppDescription(event)).toBeUndefined();
    });
  });

  describe("getAppImage", () => {
    it("should extract image from content JSON", () => {
      const event = createHandlerEvent({
        content: JSON.stringify({ image: "https://example.com/logo.png" }),
      });
      expect(getAppImage(event)).toBe("https://example.com/logo.png");
    });

    it("should extract picture field as fallback", () => {
      const event = createHandlerEvent({
        content: JSON.stringify({ picture: "https://example.com/pic.png" }),
      });
      expect(getAppImage(event)).toBe("https://example.com/pic.png");
    });

    it("should prefer image over picture", () => {
      const event = createHandlerEvent({
        content: JSON.stringify({
          image: "https://example.com/logo.png",
          picture: "https://example.com/pic.png",
        }),
      });
      expect(getAppImage(event)).toBe("https://example.com/logo.png");
    });
  });

  describe("getSupportedKinds", () => {
    it("should extract all k tag values as numbers", () => {
      const event = createHandlerEvent({
        tags: [
          ["k", "1"],
          ["k", "3"],
          ["k", "9802"],
          ["d", "my-app"],
        ],
      });
      expect(getSupportedKinds(event)).toEqual([1, 3, 9802]);
    });

    it("should sort kinds numerically", () => {
      const event = createHandlerEvent({
        tags: [
          ["k", "9802"],
          ["k", "1"],
          ["k", "30023"],
          ["k", "3"],
        ],
      });
      expect(getSupportedKinds(event)).toEqual([1, 3, 9802, 30023]);
    });

    it("should filter out invalid kind numbers", () => {
      const event = createHandlerEvent({
        tags: [
          ["k", "1"],
          ["k", "not-a-number"],
          ["k", "3"],
        ],
      });
      expect(getSupportedKinds(event)).toEqual([1, 3]);
    });

    it("should return empty array if no k tags", () => {
      const event = createHandlerEvent({
        tags: [["d", "my-app"]],
      });
      expect(getSupportedKinds(event)).toEqual([]);
    });
  });

  describe("getPlatformUrls", () => {
    it("should extract known platform URLs", () => {
      const event = createHandlerEvent({
        tags: [
          ["web", "https://app.example.com/<bech32>"],
          ["ios", "myapp://view/<bech32>"],
          ["android", "myapp://view/<bech32>"],
          ["d", "my-app"],
        ],
      });
      const urls = getPlatformUrls(event);
      expect(urls.web).toBe("https://app.example.com/<bech32>");
      expect(urls.ios).toBe("myapp://view/<bech32>");
      expect(urls.android).toBe("myapp://view/<bech32>");
    });

    it("should return empty object if no platform tags", () => {
      const event = createHandlerEvent({
        tags: [["d", "my-app"]],
      });
      expect(getPlatformUrls(event)).toEqual({});
    });
  });

  describe("getAvailablePlatforms", () => {
    it("should return array of available platform names", () => {
      const event = createHandlerEvent({
        tags: [
          ["web", "https://app.example.com/<bech32>"],
          ["ios", "myapp://view/<bech32>"],
          ["d", "my-app"],
        ],
      });
      const platforms = getAvailablePlatforms(event);
      expect(platforms).toContain("web");
      expect(platforms).toContain("ios");
      expect(platforms).toHaveLength(2);
    });
  });

  describe("getHandlerIdentifier", () => {
    it("should extract d tag value", () => {
      const event = createHandlerEvent({
        tags: [["d", "my-unique-id"]],
      });
      expect(getHandlerIdentifier(event)).toBe("my-unique-id");
    });

    it("should return undefined if no d tag", () => {
      const event = createHandlerEvent({
        tags: [],
      });
      expect(getHandlerIdentifier(event)).toBeUndefined();
    });
  });
});

describe("Kind 31989 (Handler Recommendation) Helpers", () => {
  describe("getRecommendedKind", () => {
    it("should extract kind number from d tag", () => {
      const event = createRecommendationEvent({
        tags: [["d", "9802"]],
      });
      expect(getRecommendedKind(event)).toBe(9802);
    });

    it("should return undefined if d tag is not a valid number", () => {
      const event = createRecommendationEvent({
        tags: [["d", "not-a-number"]],
      });
      expect(getRecommendedKind(event)).toBeUndefined();
    });

    it("should return undefined if no d tag", () => {
      const event = createRecommendationEvent({
        tags: [],
      });
      expect(getRecommendedKind(event)).toBeUndefined();
    });
  });

  describe("parseAddressPointer", () => {
    it("should parse valid address pointer", () => {
      const result = parseAddressPointer("31990:abcd1234:my-handler");
      expect(result).toEqual({
        kind: 31990,
        pubkey: "abcd1234",
        identifier: "my-handler",
      });
    });

    it("should return null for invalid format", () => {
      expect(parseAddressPointer("invalid")).toBeNull();
      expect(parseAddressPointer("31990:abcd")).toBeNull();
      expect(parseAddressPointer("not-a-kind:pubkey:id")).toBeNull();
    });

    it("should handle empty identifier", () => {
      const result = parseAddressPointer("31990:abcd1234:");
      expect(result).toEqual({
        kind: 31990,
        pubkey: "abcd1234",
        identifier: "",
      });
    });
  });

  describe("getHandlerReferences", () => {
    it("should extract handler references from a tags", () => {
      const event = createRecommendationEvent({
        tags: [
          ["d", "9802"],
          ["a", "31990:pubkey1:handler1", "wss://relay.com", "web"],
          ["a", "31990:pubkey2:handler2", "", "ios"],
        ],
      });
      const refs = getHandlerReferences(event);
      expect(refs).toHaveLength(2);
      expect(refs[0].address).toEqual({
        kind: 31990,
        pubkey: "pubkey1",
        identifier: "handler1",
      });
      expect(refs[0].relayHint).toBe("wss://relay.com");
      expect(refs[0].platform).toBe("web");
      expect(refs[1].platform).toBe("ios");
    });

    it("should handle a tags without relay hint or platform", () => {
      const event = createRecommendationEvent({
        tags: [
          ["d", "9802"],
          ["a", "31990:pubkey1:handler1"],
        ],
      });
      const refs = getHandlerReferences(event);
      expect(refs).toHaveLength(1);
      expect(refs[0].relayHint).toBeUndefined();
      expect(refs[0].platform).toBeUndefined();
    });

    it("should filter out invalid a tags", () => {
      const event = createRecommendationEvent({
        tags: [
          ["d", "9802"],
          ["a", "31990:pubkey1:handler1"],
          ["a", "invalid-format"],
          ["a", "31990:pubkey2:handler2"],
        ],
      });
      const refs = getHandlerReferences(event);
      expect(refs).toHaveLength(2);
    });

    it("should return empty array if no a tags", () => {
      const event = createRecommendationEvent({
        tags: [["d", "9802"]],
      });
      expect(getHandlerReferences(event)).toEqual([]);
    });
  });

  describe("getHandlersByPlatform", () => {
    it("should filter handlers by platform", () => {
      const event = createRecommendationEvent({
        tags: [
          ["d", "9802"],
          ["a", "31990:pubkey1:handler1", "", "web"],
          ["a", "31990:pubkey2:handler2", "", "ios"],
          ["a", "31990:pubkey3:handler3", "", "web"],
        ],
      });
      const webHandlers = getHandlersByPlatform(event, "web");
      expect(webHandlers).toHaveLength(2);
      expect(webHandlers[0].platform).toBe("web");
      expect(webHandlers[1].platform).toBe("web");

      const iosHandlers = getHandlersByPlatform(event, "ios");
      expect(iosHandlers).toHaveLength(1);
      expect(iosHandlers[0].platform).toBe("ios");
    });

    it("should return all handlers if no platform specified", () => {
      const event = createRecommendationEvent({
        tags: [
          ["d", "9802"],
          ["a", "31990:pubkey1:handler1", "", "web"],
          ["a", "31990:pubkey2:handler2", "", "ios"],
        ],
      });
      const allHandlers = getHandlersByPlatform(event);
      expect(allHandlers).toHaveLength(2);
    });
  });

  describe("getRecommendedPlatforms", () => {
    it("should return unique platforms from handler references", () => {
      const event = createRecommendationEvent({
        tags: [
          ["d", "9802"],
          ["a", "31990:pubkey1:handler1", "", "web"],
          ["a", "31990:pubkey2:handler2", "", "ios"],
          ["a", "31990:pubkey3:handler3", "", "web"],
          ["a", "31990:pubkey4:handler4", "", "android"],
        ],
      });
      const platforms = getRecommendedPlatforms(event);
      expect(platforms).toEqual(["android", "ios", "web"]);
    });

    it("should return empty array if no platforms specified", () => {
      const event = createRecommendationEvent({
        tags: [
          ["d", "9802"],
          ["a", "31990:pubkey1:handler1"],
        ],
      });
      expect(getRecommendedPlatforms(event)).toEqual([]);
    });
  });
});

describe("URL Template Utilities", () => {
  describe("substituteTemplate", () => {
    it("should replace <bech32> placeholder with entity", () => {
      const template = "https://app.com/view/<bech32>";
      const result = substituteTemplate(template, "nevent1abc123");
      expect(result).toBe("https://app.com/view/nevent1abc123");
    });

    it("should replace multiple occurrences", () => {
      const template = "https://app.com/<bech32>/view/<bech32>";
      const result = substituteTemplate(template, "note1xyz");
      expect(result).toBe("https://app.com/note1xyz/view/note1xyz");
    });

    it("should return unchanged if no placeholder", () => {
      const template = "https://app.com/view";
      const result = substituteTemplate(template, "nevent1abc");
      expect(result).toBe("https://app.com/view");
    });
  });

  describe("hasPlaceholder", () => {
    it("should return true if template contains <bech32>", () => {
      expect(hasPlaceholder("https://app.com/<bech32>")).toBe(true);
    });

    it("should return false if template does not contain <bech32>", () => {
      expect(hasPlaceholder("https://app.com/view")).toBe(false);
    });
  });

  describe("formatAddressPointer", () => {
    it("should format address pointer as string", () => {
      const pointer = {
        kind: 31990,
        pubkey: "abcd1234",
        identifier: "my-handler",
      };
      expect(formatAddressPointer(pointer)).toBe("31990:abcd1234:my-handler");
    });
  });
});
