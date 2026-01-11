import { describe, it, expect } from "vitest";
import {
  getAppName,
  getAppIdentifier,
  getAppSummary,
  getAppRepository,
  getAppIcon,
  getAppImages,
  getAppLicense,
  getAppPlatforms,
  getAppReleases,
  getCurationSetName,
  getCurationSetIdentifier,
  getAppReferences,
  parseAddressPointer,
} from "./zapstore-helpers";
import { NostrEvent } from "@/types/nostr";

// Helper to create a minimal kind 32267 event (App Metadata)
function createAppEvent(overrides?: Partial<NostrEvent>): NostrEvent {
  return {
    id: "test-id",
    pubkey: "test-pubkey",
    created_at: 1234567890,
    kind: 32267,
    tags: [],
    content: "",
    sig: "test-sig",
    ...overrides,
  };
}

// Helper to create a minimal kind 30267 event (App Curation Set)
function createCurationSetEvent(overrides?: Partial<NostrEvent>): NostrEvent {
  return {
    id: "test-id",
    pubkey: "test-pubkey",
    created_at: 1234567890,
    kind: 30267,
    tags: [],
    content: "",
    sig: "test-sig",
    ...overrides,
  };
}

describe("Kind 32267 (App Metadata) Helpers", () => {
  describe("getAppName", () => {
    it("should extract name from name tag", () => {
      const event = createAppEvent({
        tags: [
          ["name", "0xchat"],
          ["d", "com.oxchat.nostr"],
        ],
      });
      expect(getAppName(event)).toBe("0xchat");
    });

    it("should fallback to d tag if no name tag", () => {
      const event = createAppEvent({
        tags: [["d", "com.example.app"]],
      });
      expect(getAppName(event)).toBe("com.example.app");
    });

    it("should return 'Unknown App' if no name and no d tag", () => {
      const event = createAppEvent({
        tags: [],
      });
      expect(getAppName(event)).toBe("Unknown App");
    });

    it("should return empty string for non-32267 events", () => {
      const event = createAppEvent({
        kind: 1,
        tags: [["name", "Test"]],
      });
      expect(getAppName(event)).toBe("");
    });
  });

  describe("getAppIdentifier", () => {
    it("should extract d tag value", () => {
      const event = createAppEvent({
        tags: [["d", "com.oxchat.nostr"]],
      });
      expect(getAppIdentifier(event)).toBe("com.oxchat.nostr");
    });

    it("should return undefined if no d tag", () => {
      const event = createAppEvent({
        tags: [],
      });
      expect(getAppIdentifier(event)).toBeUndefined();
    });

    it("should return undefined for non-32267 events", () => {
      const event = createAppEvent({
        kind: 1,
        tags: [["d", "test"]],
      });
      expect(getAppIdentifier(event)).toBeUndefined();
    });
  });

  describe("getAppSummary", () => {
    it("should extract summary from summary tag", () => {
      const event = createAppEvent({
        tags: [["summary", "A secure chat app built on Nostr"]],
      });
      expect(getAppSummary(event)).toBe("A secure chat app built on Nostr");
    });

    it("should fallback to content if no summary tag", () => {
      const event = createAppEvent({
        content: "Fallback description from content",
        tags: [],
      });
      expect(getAppSummary(event)).toBe("Fallback description from content");
    });

    it("should return undefined if no summary and empty content", () => {
      const event = createAppEvent({
        content: "",
        tags: [],
      });
      expect(getAppSummary(event)).toBeUndefined();
    });

    it("should prefer summary tag over content", () => {
      const event = createAppEvent({
        content: "Content description",
        tags: [["summary", "Summary description"]],
      });
      expect(getAppSummary(event)).toBe("Summary description");
    });
  });

  describe("getAppRepository", () => {
    it("should extract repository URL", () => {
      const event = createAppEvent({
        tags: [["repository", "https://github.com/0xchat-app/0xchat-app-main"]],
      });
      expect(getAppRepository(event)).toBe(
        "https://github.com/0xchat-app/0xchat-app-main",
      );
    });

    it("should return undefined if no repository tag", () => {
      const event = createAppEvent({
        tags: [],
      });
      expect(getAppRepository(event)).toBeUndefined();
    });
  });

  describe("getAppIcon", () => {
    it("should extract icon URL", () => {
      const event = createAppEvent({
        tags: [["icon", "https://cdn.zapstore.dev/icon.png"]],
      });
      expect(getAppIcon(event)).toBe("https://cdn.zapstore.dev/icon.png");
    });

    it("should return undefined if no icon tag", () => {
      const event = createAppEvent({
        tags: [],
      });
      expect(getAppIcon(event)).toBeUndefined();
    });
  });

  describe("getAppImages", () => {
    it("should extract all image URLs", () => {
      const event = createAppEvent({
        tags: [
          ["image", "https://cdn.zapstore.dev/image1.png"],
          ["image", "https://cdn.zapstore.dev/image2.png"],
          ["image", "https://cdn.zapstore.dev/image3.png"],
          ["name", "App"],
        ],
      });
      expect(getAppImages(event)).toEqual([
        "https://cdn.zapstore.dev/image1.png",
        "https://cdn.zapstore.dev/image2.png",
        "https://cdn.zapstore.dev/image3.png",
      ]);
    });

    it("should return empty array if no image tags", () => {
      const event = createAppEvent({
        tags: [["name", "App"]],
      });
      expect(getAppImages(event)).toEqual([]);
    });

    it("should return empty array for non-32267 events", () => {
      const event = createAppEvent({
        kind: 1,
        tags: [["image", "test.png"]],
      });
      expect(getAppImages(event)).toEqual([]);
    });
  });

  describe("getAppLicense", () => {
    it("should extract license", () => {
      const event = createAppEvent({
        tags: [["license", "MIT"]],
      });
      expect(getAppLicense(event)).toBe("MIT");
    });

    it("should return undefined if no license tag", () => {
      const event = createAppEvent({
        tags: [],
      });
      expect(getAppLicense(event)).toBeUndefined();
    });
  });

  describe("getAppPlatforms", () => {
    it("should extract all platform/architecture values from f tags", () => {
      const event = createAppEvent({
        tags: [
          ["f", "android-arm64-v8a"],
          ["f", "android-armeabi-v7a"],
          ["name", "App"],
        ],
      });
      expect(getAppPlatforms(event)).toEqual([
        "android-arm64-v8a",
        "android-armeabi-v7a",
      ]);
    });

    it("should return empty array if no f tags", () => {
      const event = createAppEvent({
        tags: [["name", "App"]],
      });
      expect(getAppPlatforms(event)).toEqual([]);
    });

    it("should return empty array for non-32267 events", () => {
      const event = createAppEvent({
        kind: 1,
        tags: [["f", "test"]],
      });
      expect(getAppPlatforms(event)).toEqual([]);
    });
  });

  describe("getAppReleases", () => {
    it("should extract release references from a tags", () => {
      const event = createAppEvent({
        tags: [
          [
            "a",
            "30063:5eca50a04afaefe55659fb74810b42654e2268c1acca6e53801b9862db74a83a:com.oxchat.nostr@v1.5.1-release",
          ],
        ],
      });
      const releases = getAppReleases(event);
      expect(releases).toHaveLength(1);
      expect(releases[0]).toEqual({
        kind: 30063,
        pubkey:
          "5eca50a04afaefe55659fb74810b42654e2268c1acca6e53801b9862db74a83a",
        identifier: "com.oxchat.nostr@v1.5.1-release",
      });
    });

    it("should handle multiple release references", () => {
      const event = createAppEvent({
        tags: [
          ["a", "30063:pubkey1:release1"],
          ["a", "30063:pubkey2:release2"],
        ],
      });
      const releases = getAppReleases(event);
      expect(releases).toHaveLength(2);
    });

    it("should filter out invalid a tags", () => {
      const event = createAppEvent({
        tags: [
          ["a", "30063:pubkey1:release1"],
          ["a", "invalid"],
          ["a", "30063:pubkey2:release2"],
        ],
      });
      const releases = getAppReleases(event);
      expect(releases).toHaveLength(2);
    });

    it("should return empty array if no a tags", () => {
      const event = createAppEvent({
        tags: [["name", "App"]],
      });
      expect(getAppReleases(event)).toEqual([]);
    });
  });
});

describe("Kind 30267 (App Curation Set) Helpers", () => {
  describe("getCurationSetName", () => {
    it("should extract name from name tag", () => {
      const event = createCurationSetEvent({
        tags: [
          ["name", "Nostr Social"],
          ["d", "nostr-social"],
        ],
      });
      expect(getCurationSetName(event)).toBe("Nostr Social");
    });

    it("should fallback to d tag if no name tag", () => {
      const event = createCurationSetEvent({
        tags: [["d", "my-collection"]],
      });
      expect(getCurationSetName(event)).toBe("my-collection");
    });

    it("should return 'Unnamed Collection' if no name and no d tag", () => {
      const event = createCurationSetEvent({
        tags: [],
      });
      expect(getCurationSetName(event)).toBe("Unnamed Collection");
    });

    it("should return empty string for non-30267 events", () => {
      const event = createCurationSetEvent({
        kind: 1,
        tags: [["name", "Test"]],
      });
      expect(getCurationSetName(event)).toBe("");
    });
  });

  describe("getCurationSetIdentifier", () => {
    it("should extract d tag value", () => {
      const event = createCurationSetEvent({
        tags: [["d", "nostr-social"]],
      });
      expect(getCurationSetIdentifier(event)).toBe("nostr-social");
    });

    it("should return undefined if no d tag", () => {
      const event = createCurationSetEvent({
        tags: [],
      });
      expect(getCurationSetIdentifier(event)).toBeUndefined();
    });

    it("should return undefined for non-30267 events", () => {
      const event = createCurationSetEvent({
        kind: 1,
        tags: [["d", "test"]],
      });
      expect(getCurationSetIdentifier(event)).toBeUndefined();
    });
  });

  describe("getAppReferences", () => {
    it("should extract app references from a tags", () => {
      const event = createCurationSetEvent({
        tags: [
          ["d", "nostr-social"],
          [
            "a",
            "32267:4523be58d395b1b196a9b8c82b038b6895cb02b683d0c253a955068dba1facd0:to.iris",
            "wss://relay.com",
          ],
          [
            "a",
            "32267:b090908101cc6498893cc7f14d745dcea0b2ab6842cc4b512515643d272a375c:net.primal.android",
          ],
        ],
      });
      const refs = getAppReferences(event);
      expect(refs).toHaveLength(2);
      expect(refs[0].address).toEqual({
        kind: 32267,
        pubkey:
          "4523be58d395b1b196a9b8c82b038b6895cb02b683d0c253a955068dba1facd0",
        identifier: "to.iris",
      });
      expect(refs[0].relayHint).toBe("wss://relay.com");
      expect(refs[1].relayHint).toBeUndefined();
    });

    it("should only include kind 32267 references", () => {
      const event = createCurationSetEvent({
        tags: [
          ["d", "collection"],
          ["a", "32267:pubkey1:app1"],
          ["a", "30023:pubkey2:article1"],
          ["a", "32267:pubkey3:app2"],
        ],
      });
      const refs = getAppReferences(event);
      expect(refs).toHaveLength(2);
      expect(refs[0].address.kind).toBe(32267);
      expect(refs[1].address.kind).toBe(32267);
    });

    it("should filter out invalid a tags", () => {
      const event = createCurationSetEvent({
        tags: [
          ["d", "collection"],
          ["a", "32267:pubkey1:app1"],
          ["a", "invalid-format"],
          ["a", "32267:pubkey2:app2"],
        ],
      });
      const refs = getAppReferences(event);
      expect(refs).toHaveLength(2);
    });

    it("should return empty array if no a tags", () => {
      const event = createCurationSetEvent({
        tags: [["d", "collection"]],
      });
      expect(getAppReferences(event)).toEqual([]);
    });

    it("should return empty array for non-30267 events", () => {
      const event = createCurationSetEvent({
        kind: 1,
        tags: [["a", "32267:pubkey:app"]],
      });
      expect(getAppReferences(event)).toEqual([]);
    });
  });
});

describe("Shared Helpers", () => {
  describe("parseAddressPointer", () => {
    it("should parse valid address pointer", () => {
      const result = parseAddressPointer("32267:abcd1234:com.example.app");
      expect(result).toEqual({
        kind: 32267,
        pubkey: "abcd1234",
        identifier: "com.example.app",
      });
    });

    it("should handle empty identifier", () => {
      const result = parseAddressPointer("30267:abcd1234:");
      expect(result).toEqual({
        kind: 30267,
        pubkey: "abcd1234",
        identifier: "",
      });
    });

    it("should return null for invalid format", () => {
      expect(parseAddressPointer("invalid")).toBeNull();
      expect(parseAddressPointer("32267:abcd")).toBeNull();
      expect(parseAddressPointer("not-a-kind:pubkey:id")).toBeNull();
    });

    it("should handle long pubkeys and identifiers", () => {
      const longPubkey =
        "5eca50a04afaefe55659fb74810b42654e2268c1acca6e53801b9862db74a83a";
      const longId = "com.oxchat.nostr@v1.5.1-release";
      const result = parseAddressPointer(`30063:${longPubkey}:${longId}`);
      expect(result).toEqual({
        kind: 30063,
        pubkey: longPubkey,
        identifier: longId,
      });
    });
  });
});
