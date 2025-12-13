import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  formatEventIds,
  formatDTags,
  formatTimeRange,
  formatTimeRangeCompact,
  formatGenericTag,
  formatPubkeysWithProfiles,
  formatHashtags,
  formatProfileNames,
} from "./filter-formatters";
import type { ProfileMetadata } from "@/types/profile";

// Mock the useLocale module
vi.mock("@/hooks/useLocale", () => ({
  formatTimestamp: vi.fn((timestamp: number, style: string) => {
    const now = Math.floor(Date.now() / 1000);
    const diff = now - timestamp;

    if (style === "relative") {
      const days = Math.floor(diff / 86400);
      const hours = Math.floor(diff / 3600);
      const minutes = Math.floor(diff / 60);

      if (days > 0) return `${days}d ago`;
      if (hours > 0) return `${hours}h ago`;
      if (minutes > 0) return `${minutes}m ago`;
      return "just now";
    }

    if (style === "absolute") {
      const date = new Date(timestamp * 1000);
      return date.toISOString().slice(0, 16).replace("T", " ");
    }

    return new Date(timestamp * 1000).toISOString();
  }),
}));

describe("formatEventIds", () => {
  it("should return empty string for empty array", () => {
    expect(formatEventIds([])).toBe("");
  });

  it("should format single event ID to truncated note1", () => {
    const id = "a".repeat(64); // Valid 64-char hex
    const result = formatEventIds([id]);

    expect(result).toContain("note1");
    expect(result).toContain("...");
    expect(result.length).toBeLessThan(25); // Truncated
  });

  it("should format two event IDs with comma", () => {
    const id1 = "a".repeat(64);
    const id2 = "b".repeat(64);
    const result = formatEventIds([id1, id2]);

    expect(result).toContain("note1");
    expect(result).toContain(",");
    expect(result.split(",")).toHaveLength(2);
  });

  it("should truncate when more than maxDisplay", () => {
    const ids = ["a".repeat(64), "b".repeat(64), "c".repeat(64)];
    const result = formatEventIds(ids, 2);

    expect(result).toContain("& 1 more");
  });

  it("should handle invalid event IDs gracefully", () => {
    const invalidId = "not-a-valid-hex-string-that-is-too-long";
    const result = formatEventIds([invalidId]);

    expect(result).toBeTruthy();
    expect(result).toContain("...");
  });

  it("should handle short invalid IDs without truncation", () => {
    const shortInvalidId = "short";
    const result = formatEventIds([shortInvalidId]);

    expect(result).toBe("short");
  });

  it("should respect custom maxDisplay", () => {
    const ids = Array(5).fill("a".repeat(64));
    const result = formatEventIds(ids, 3);

    expect(result).toContain("& 2 more");
  });
});

describe("formatDTags", () => {
  it("should return empty string for empty array", () => {
    expect(formatDTags([])).toBe("");
  });

  it("should wrap single tag in quotes", () => {
    const result = formatDTags(["note-1"]);
    expect(result).toBe('"note-1"');
  });

  it("should format multiple tags with commas", () => {
    const result = formatDTags(["note-1", "note-2"]);
    expect(result).toBe('"note-1", "note-2"');
  });

  it("should truncate when more than maxDisplay", () => {
    const tags = ["tag1", "tag2", "tag3", "tag4"];
    const result = formatDTags(tags, 2);

    expect(result).toBe('"tag1", "tag2" & 2 more');
  });

  it("should handle tags with special characters", () => {
    const result = formatDTags(['tag-with-"quotes"', "tag:with:colons"]);
    expect(result).toContain('"tag-with-"quotes""');
    expect(result).toContain('"tag:with:colons"');
  });
});

describe("formatTimeRange", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-12-13T12:00:00Z"));
  });

  it("should return empty string when no timestamps", () => {
    expect(formatTimeRange()).toBe("");
  });

  it("should format only since timestamp", () => {
    const threeDaysAgo = Math.floor(Date.now() / 1000) - 3 * 86400;
    const result = formatTimeRange(threeDaysAgo);

    expect(result).toContain("(3d ago)");
  });

  it("should format only until timestamp", () => {
    const twoDaysAgo = Math.floor(Date.now() / 1000) - 2 * 86400;
    const result = formatTimeRange(undefined, twoDaysAgo);

    expect(result).toContain("(2d ago)");
  });

  it("should format both since and until", () => {
    const threeDaysAgo = Math.floor(Date.now() / 1000) - 3 * 86400;
    const oneDayAgo = Math.floor(Date.now() / 1000) - 1 * 86400;
    const result = formatTimeRange(threeDaysAgo, oneDayAgo);

    expect(result).toContain("→");
    expect(result).toContain("(3d ago)");
    expect(result).toContain("(1d ago)");
  });

  it("should show 'now' for until timestamp within 60 seconds", () => {
    const now = Math.floor(Date.now() / 1000);
    const result = formatTimeRange(undefined, now);

    expect(result).toBe("now");
  });

  it("should handle future timestamps", () => {
    const future = Math.floor(Date.now() / 1000) + 3600;
    const result = formatTimeRange(undefined, future);

    expect(result).toBeTruthy();
  });
});

describe("formatTimeRangeCompact", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-12-13T12:00:00Z"));
  });

  it("should return empty string when no timestamps", () => {
    expect(formatTimeRangeCompact()).toBe("");
  });

  it("should format 'last Xd' when since provided and until is now", () => {
    const threeDaysAgo = Math.floor(Date.now() / 1000) - 3 * 86400;
    const now = Math.floor(Date.now() / 1000);
    const result = formatTimeRangeCompact(threeDaysAgo, now);

    expect(result).toBe("last 3d");
  });

  it("should format 'since Xd ago' when only since provided", () => {
    const twoDaysAgo = Math.floor(Date.now() / 1000) - 2 * 86400;
    const result = formatTimeRangeCompact(twoDaysAgo);

    expect(result).toBe("since 2d ago");
  });

  it("should format 'until now' when only until provided and is now", () => {
    const now = Math.floor(Date.now() / 1000);
    const result = formatTimeRangeCompact(undefined, now);

    expect(result).toBe("until now");
  });

  it("should format with arrow when both timestamps differ", () => {
    const threeDaysAgo = Math.floor(Date.now() / 1000) - 3 * 86400;
    const twoDaysAgo = Math.floor(Date.now() / 1000) - 2 * 86400;
    const result = formatTimeRangeCompact(threeDaysAgo, twoDaysAgo);

    expect(result).toContain("→");
  });
});

describe("formatGenericTag", () => {
  it("should return empty string for empty values", () => {
    expect(formatGenericTag("a", [])).toBe("");
  });

  it("should format tag with single value", () => {
    const result = formatGenericTag("a", ["value1"]);
    expect(result).toBe("#a: value1");
  });

  it("should format tag with multiple values", () => {
    const result = formatGenericTag("r", ["url1", "url2"]);
    expect(result).toBe("#r: url1, url2");
  });

  it("should handle uppercase letters", () => {
    const result = formatGenericTag("A", ["value1", "value2"]);
    expect(result).toBe("#A: value1, value2");
  });

  it("should handle lowercase letters", () => {
    const result = formatGenericTag("z", ["value1"]);
    expect(result).toBe("#z: value1");
  });

  it("should truncate long values", () => {
    const longValue = "a".repeat(50);
    const result = formatGenericTag("a", [longValue]);

    expect(result).toContain("...");
    expect(result.length).toBeLessThan(50);
  });

  it("should truncate when more than maxDisplay", () => {
    const values = ["val1", "val2", "val3", "val4"];
    const result = formatGenericTag("g", values, 2);

    expect(result).toBe("#g: val1, val2 & 2 more");
  });
});

describe("formatPubkeysWithProfiles", () => {
  const mockProfile: ProfileMetadata = {
    name: "Alice",
    display_name: "Alice in Wonderland",
    about: "Test user",
    picture: "",
    banner: "",
    nip05: "alice@example.com",
    lud06: "",
    lud16: "",
    website: "",
  };

  it("should return empty string for empty array", () => {
    expect(formatPubkeysWithProfiles([], [])).toBe("");
  });

  it("should format pubkey with profile name", () => {
    const pubkey = "a".repeat(64);
    const result = formatPubkeysWithProfiles([pubkey], [mockProfile]);

    expect(result).toContain("npub1");
    expect(result).toContain("(Alice)");
  });

  it("should format pubkey without profile", () => {
    const pubkey = "a".repeat(64);
    const result = formatPubkeysWithProfiles([pubkey], [null]);

    expect(result).toContain("npub1");
    expect(result).not.toContain("(");
  });

  it("should format multiple pubkeys with mixed profiles", () => {
    const pubkey1 = "a".repeat(64);
    const pubkey2 = "b".repeat(64);
    const result = formatPubkeysWithProfiles(
      [pubkey1, pubkey2],
      [mockProfile, null],
    );

    expect(result).toContain("(Alice)");
    expect(result).toContain(",");
  });

  it("should truncate when more than maxDisplay", () => {
    const pubkeys = Array(4).fill("a".repeat(64));
    const profiles = Array(4).fill(null);
    const result = formatPubkeysWithProfiles(pubkeys, profiles, 2);

    expect(result).toContain("& 2 more");
  });
});

describe("formatHashtags", () => {
  it("should return empty string for empty array", () => {
    expect(formatHashtags([])).toBe("");
  });

  it("should add # prefix to single tag", () => {
    const result = formatHashtags(["bitcoin"]);
    expect(result).toBe("#bitcoin");
  });

  it("should format multiple tags with commas", () => {
    const result = formatHashtags(["bitcoin", "nostr"]);
    expect(result).toBe("#bitcoin, #nostr");
  });

  it("should truncate when more than maxDisplay", () => {
    const tags = ["bitcoin", "nostr", "lightning", "web3"];
    const result = formatHashtags(tags, 2);

    expect(result).toBe("#bitcoin, #nostr & 2 more");
  });
});

describe("formatProfileNames", () => {
  it("should return empty string for empty array", () => {
    expect(formatProfileNames([])).toBe("");
  });

  it("should use name from profile", () => {
    const profile: ProfileMetadata = {
      name: "Alice",
      display_name: "",
      about: "",
      picture: "",
      banner: "",
      nip05: "",
      lud06: "",
      lud16: "",
      website: "",
    };
    const result = formatProfileNames([profile]);
    expect(result).toBe("Alice");
  });

  it("should use display_name if name is empty", () => {
    const profile: ProfileMetadata = {
      name: "",
      display_name: "Alice Display",
      about: "",
      picture: "",
      banner: "",
      nip05: "",
      lud06: "",
      lud16: "",
      website: "",
    };
    const result = formatProfileNames([profile]);
    expect(result).toBe("Alice Display");
  });

  it("should use 'Unknown' if both name and display_name are empty", () => {
    const profile: ProfileMetadata = {
      name: "",
      display_name: "",
      about: "",
      picture: "",
      banner: "",
      nip05: "",
      lud06: "",
      lud16: "",
      website: "",
    };
    const result = formatProfileNames([profile]);
    expect(result).toBe("Unknown");
  });

  it("should format multiple profiles", () => {
    const profile1: ProfileMetadata = {
      name: "Alice",
      display_name: "",
      about: "",
      picture: "",
      banner: "",
      nip05: "",
      lud06: "",
      lud16: "",
      website: "",
    };
    const profile2: ProfileMetadata = {
      name: "Bob",
      display_name: "",
      about: "",
      picture: "",
      banner: "",
      nip05: "",
      lud06: "",
      lud16: "",
      website: "",
    };
    const result = formatProfileNames([profile1, profile2]);
    expect(result).toBe("Alice, Bob");
  });

  it("should truncate when more than maxDisplay", () => {
    const profiles = Array(5)
      .fill(null)
      .map(
        (_, i): ProfileMetadata => ({
          name: `User${i}`,
          display_name: "",
          about: "",
          picture: "",
          banner: "",
          nip05: "",
          lud06: "",
          lud16: "",
          website: "",
        }),
      );
    const result = formatProfileNames(profiles, 2);

    expect(result).toBe("User0, User1 & 3 more");
  });
});
