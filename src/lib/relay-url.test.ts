import { describe, it, expect } from "vitest";
import { normalizeRelayURL } from "./relay-url";

describe("normalizeRelayURL", () => {
  it("should add trailing slash to URL without one", () => {
    const result = normalizeRelayURL("wss://relay.example.com");
    expect(result).toBe("wss://relay.example.com/");
  });

  it("should preserve trailing slash", () => {
    const result = normalizeRelayURL("wss://relay.example.com/");
    expect(result).toBe("wss://relay.example.com/");
  });

  it("should normalize URLs with and without trailing slash to the same value", () => {
    const withTrailingSlash = normalizeRelayURL("wss://theforest.nostr1.com/");
    const withoutTrailingSlash = normalizeRelayURL(
      "wss://theforest.nostr1.com",
    );
    expect(withTrailingSlash).toBe(withoutTrailingSlash);
  });

  it("should add wss:// protocol when missing", () => {
    const result = normalizeRelayURL("relay.example.com");
    expect(result).toBe("wss://relay.example.com/");
  });

  it("should lowercase the URL", () => {
    const result = normalizeRelayURL("wss://Relay.Example.COM");
    expect(result).toBe("wss://relay.example.com/");
  });

  it("should handle URLs with paths", () => {
    const result = normalizeRelayURL("wss://relay.example.com/path");
    expect(result).toBe("wss://relay.example.com/path");
  });

  it("should handle URLs with ports", () => {
    const result = normalizeRelayURL("wss://relay.example.com:8080");
    expect(result).toBe("wss://relay.example.com:8080/");
  });

  it("should trim whitespace", () => {
    const result = normalizeRelayURL("  wss://relay.example.com  ");
    expect(result).toBe("wss://relay.example.com/");
  });

  it("should handle mixed case with missing protocol and trailing slash", () => {
    const result = normalizeRelayURL("RELAY.EXAMPLE.COM");
    expect(result).toBe("wss://relay.example.com/");
  });

  it("should handle URLs with query strings", () => {
    const result = normalizeRelayURL("wss://relay.example.com?key=value");
    expect(result).toBe("wss://relay.example.com/?key=value");
  });

  it("should handle URLs with fragments", () => {
    const result = normalizeRelayURL("wss://relay.example.com#section");
    expect(result).toBe("wss://relay.example.com/#section");
  });

  it("should preserve ws:// protocol", () => {
    const result = normalizeRelayURL("ws://relay.example.com");
    expect(result).toBe("ws://relay.example.com/");
  });

  it("should handle complex URLs with path, port, and query", () => {
    const result = normalizeRelayURL(
      "wss://relay.example.com:8080/path?key=value",
    );
    expect(result).toBe("wss://relay.example.com:8080/path?key=value");
  });

  it("should normalize duplicate slashes to single slash", () => {
    const result = normalizeRelayURL("wss://relay.example.com//");
    expect(result).toBe("wss://relay.example.com/");
  });

  describe("Error Handling", () => {
    it("should throw on empty string", () => {
      expect(() => normalizeRelayURL("")).toThrow("Relay URL cannot be empty");
    });

    it("should throw on whitespace-only string", () => {
      expect(() => normalizeRelayURL("   ")).toThrow(
        "Relay URL cannot be empty",
      );
    });

    it("should throw TypeError on null input", () => {
      expect(() => normalizeRelayURL(null as any)).toThrow(TypeError);
      expect(() => normalizeRelayURL(null as any)).toThrow("must be a string");
    });

    it("should throw TypeError on undefined input", () => {
      expect(() => normalizeRelayURL(undefined as any)).toThrow(TypeError);
      expect(() => normalizeRelayURL(undefined as any)).toThrow(
        "must be a string",
      );
    });

    it("should throw TypeError on non-string input (number)", () => {
      expect(() => normalizeRelayURL(123 as any)).toThrow(TypeError);
      expect(() => normalizeRelayURL(123 as any)).toThrow("must be a string");
    });

    it("should throw TypeError on non-string input (object)", () => {
      expect(() => normalizeRelayURL({} as any)).toThrow(TypeError);
      expect(() => normalizeRelayURL({} as any)).toThrow("must be a string");
    });

    it("should handle very long URLs without crashing", () => {
      const longPath = "a".repeat(5000);
      const longUrl = `wss://relay.example.com/${longPath}`;
      const result = normalizeRelayURL(longUrl);
      expect(result).toContain("wss://relay.example.com/");
      expect(result.length).toBeGreaterThan(5000);
    });

    it("should handle URLs with special characters in query", () => {
      const result = normalizeRelayURL(
        "wss://relay.example.com?key=<script>alert('xss')</script>",
      );
      expect(result).toContain("wss://relay.example.com/");
      // Note: URL encoding is handled by browser's URL parsing
    });
  });
});
