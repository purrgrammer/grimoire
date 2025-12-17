import { describe, it, expect } from "vitest";
import { extractGlobalFlagsFromTokens, isGlobalFlag } from "./global-flags";

describe("extractGlobalFlagsFromTokens", () => {
  describe("basic extraction", () => {
    it("should extract --title flag at end", () => {
      const result = extractGlobalFlagsFromTokens([
        "profile",
        "alice",
        "--title",
        "My Window",
      ]);
      expect(result.globalFlags.windowProps?.title).toBe("My Window");
      expect(result.remainingTokens).toEqual(["profile", "alice"]);
    });

    it("should extract --title flag at start", () => {
      const result = extractGlobalFlagsFromTokens([
        "--title",
        "My Window",
        "profile",
        "alice",
      ]);
      expect(result.globalFlags.windowProps?.title).toBe("My Window");
      expect(result.remainingTokens).toEqual(["profile", "alice"]);
    });

    it("should extract --title flag in middle", () => {
      const result = extractGlobalFlagsFromTokens([
        "profile",
        "--title",
        "My Window",
        "alice",
      ]);
      expect(result.globalFlags.windowProps?.title).toBe("My Window");
      expect(result.remainingTokens).toEqual(["profile", "alice"]);
    });

    it("should handle command with no global flags", () => {
      const result = extractGlobalFlagsFromTokens(["profile", "alice"]);
      expect(result.globalFlags).toEqual({});
      expect(result.remainingTokens).toEqual(["profile", "alice"]);
    });

    it("should handle empty token array", () => {
      const result = extractGlobalFlagsFromTokens([]);
      expect(result.globalFlags).toEqual({});
      expect(result.remainingTokens).toEqual([]);
    });
  });

  describe("duplicate flags", () => {
    it("should use last value when --title specified multiple times", () => {
      const result = extractGlobalFlagsFromTokens([
        "--title",
        "First",
        "profile",
        "alice",
        "--title",
        "Second",
      ]);
      expect(result.globalFlags.windowProps?.title).toBe("Second");
      expect(result.remainingTokens).toEqual(["profile", "alice"]);
    });
  });

  describe("error handling", () => {
    it("should error when --title has no value", () => {
      expect(() =>
        extractGlobalFlagsFromTokens(["profile", "--title"]),
      ).toThrow("Flag --title requires a value");
    });

    it("should error when --title value is another flag", () => {
      expect(() =>
        extractGlobalFlagsFromTokens(["--title", "--other-flag", "profile"]),
      ).toThrow("Flag --title requires a value");
    });
  });

  describe("sanitization", () => {
    it("should strip control characters", () => {
      const result = extractGlobalFlagsFromTokens([
        "--title",
        "My\nWindow\tTitle",
        "profile",
      ]);
      expect(result.globalFlags.windowProps?.title).toBe("MyWindowTitle");
    });

    it("should strip null bytes", () => {
      const result = extractGlobalFlagsFromTokens([
        "--title",
        "My\x00Window",
        "profile",
      ]);
      expect(result.globalFlags.windowProps?.title).toBe("MyWindow");
    });

    it("should preserve Unicode characters", () => {
      const result = extractGlobalFlagsFromTokens([
        "--title",
        "Profile 👤 Alice",
        "profile",
      ]);
      expect(result.globalFlags.windowProps?.title).toBe("Profile 👤 Alice");
    });

    it("should preserve emoji", () => {
      const result = extractGlobalFlagsFromTokens([
        "--title",
        "🎯 Important",
        "profile",
      ]);
      expect(result.globalFlags.windowProps?.title).toBe("🎯 Important");
    });

    it("should preserve CJK characters", () => {
      const result = extractGlobalFlagsFromTokens([
        "--title",
        "日本語タイトル",
        "profile",
      ]);
      expect(result.globalFlags.windowProps?.title).toBe("日本語タイトル");
    });

    it("should preserve Arabic/RTL characters", () => {
      const result = extractGlobalFlagsFromTokens([
        "--title",
        "محمد",
        "profile",
      ]);
      expect(result.globalFlags.windowProps?.title).toBe("محمد");
    });

    it("should trim whitespace", () => {
      const result = extractGlobalFlagsFromTokens([
        "--title",
        "  My Window  ",
        "profile",
      ]);
      expect(result.globalFlags.windowProps?.title).toBe("My Window");
    });

    it("should fallback when title is empty after sanitization", () => {
      const result = extractGlobalFlagsFromTokens([
        "--title",
        "   ",
        "profile",
      ]);
      expect(result.globalFlags.windowProps?.title).toBeUndefined();
    });

    it("should fallback when title is only control characters", () => {
      const result = extractGlobalFlagsFromTokens([
        "--title",
        "\n\t\r",
        "profile",
      ]);
      expect(result.globalFlags.windowProps?.title).toBeUndefined();
    });

    it("should limit title to 200 characters", () => {
      const longTitle = "a".repeat(300);
      const result = extractGlobalFlagsFromTokens([
        "--title",
        longTitle,
        "profile",
      ]);
      expect(result.globalFlags.windowProps?.title).toHaveLength(200);
    });
  });

  describe("complex command scenarios", () => {
    it("should preserve command flags", () => {
      const result = extractGlobalFlagsFromTokens([
        "req",
        "-k",
        "1",
        "-a",
        "alice@nostr.com",
        "--title",
        "My Feed",
      ]);
      expect(result.globalFlags.windowProps?.title).toBe("My Feed");
      expect(result.remainingTokens).toEqual([
        "req",
        "-k",
        "1",
        "-a",
        "alice@nostr.com",
      ]);
    });

    it("should handle command with many flags", () => {
      const result = extractGlobalFlagsFromTokens([
        "req",
        "-k",
        "1,3,7",
        "-a",
        "npub...",
        "-l",
        "50",
        "--title",
        "Timeline",
      ]);
      expect(result.globalFlags.windowProps?.title).toBe("Timeline");
      expect(result.remainingTokens).toEqual([
        "req",
        "-k",
        "1,3,7",
        "-a",
        "npub...",
        "-l",
        "50",
      ]);
    });

    it("should not interfere with command-specific --title (if any)", () => {
      // If a future command uses --title for something else, this test would catch it
      // For now, just verify tokens are preserved
      const result = extractGlobalFlagsFromTokens([
        "somecommand",
        "arg1",
        "--title",
        "Global Title",
        "arg2",
      ]);
      expect(result.globalFlags.windowProps?.title).toBe("Global Title");
      expect(result.remainingTokens).toEqual(["somecommand", "arg1", "arg2"]);
    });
  });

  describe("real-world examples", () => {
    it("profile with custom title", () => {
      const result = extractGlobalFlagsFromTokens([
        "profile",
        "npub1abc...",
        "--title",
        "Alice (Competitor)",
      ]);
      expect(result.globalFlags.windowProps?.title).toBe("Alice (Competitor)");
      expect(result.remainingTokens).toEqual(["profile", "npub1abc..."]);
    });

    it("req with custom title", () => {
      const result = extractGlobalFlagsFromTokens([
        "req",
        "-k",
        "1",
        "-a",
        "$me",
        "--title",
        "My Notes",
      ]);
      expect(result.globalFlags.windowProps?.title).toBe("My Notes");
      expect(result.remainingTokens).toEqual(["req", "-k", "1", "-a", "$me"]);
    });

    it("nip with custom title", () => {
      const result = extractGlobalFlagsFromTokens([
        "nip",
        "01",
        "--title",
        "Basic Protocol",
      ]);
      expect(result.globalFlags.windowProps?.title).toBe("Basic Protocol");
      expect(result.remainingTokens).toEqual(["nip", "01"]);
    });
  });
});

describe("isGlobalFlag", () => {
  it("should recognize --title as global flag", () => {
    expect(isGlobalFlag("--title")).toBe(true);
  });

  it("should not recognize command flags", () => {
    expect(isGlobalFlag("-k")).toBe(false);
    expect(isGlobalFlag("--kind")).toBe(false);
  });

  it("should not recognize regular arguments", () => {
    expect(isGlobalFlag("profile")).toBe(false);
    expect(isGlobalFlag("alice")).toBe(false);
  });
});
