import { describe, it, expect } from "vitest";
import {
  loadSchema,
  getKindSchema,
  getAllKinds,
  formatTag,
  parseTagStructure,
  getContentTypeDescription,
} from "./nostr-schema";

describe("nostr-schema", () => {
  describe("loadSchema", () => {
    it("should load and parse the schema", () => {
      const schema = loadSchema();
      expect(schema).toBeDefined();
      expect(Object.keys(schema).length).toBeGreaterThan(0);
    });

    it("should parse kind numbers correctly", () => {
      const schema = loadSchema();
      expect(schema[0]).toBeDefined(); // Metadata
      expect(schema[1]).toBeDefined(); // Note
      expect(schema[3]).toBeDefined(); // Contacts
    });
  });

  describe("getKindSchema", () => {
    it("should get schema for kind 1", () => {
      const schema = getKindSchema(1);
      expect(schema).toBeDefined();
      expect(schema?.description).toBe("Short text note");
      expect(schema?.in_use).toBe(true);
      expect(schema?.content?.type).toBe("free");
    });

    it("should return undefined for unknown kind", () => {
      const schema = getKindSchema(999999);
      expect(schema).toBeUndefined();
    });

    it("should have tags for kind 1", () => {
      const schema = getKindSchema(1);
      expect(schema?.tags).toBeDefined();
      expect(Array.isArray(schema?.tags)).toBe(true);
      expect(schema?.tags && schema.tags.length > 0).toBe(true);
    });
  });

  describe("getAllKinds", () => {
    it("should return sorted array of kind numbers", () => {
      const kinds = getAllKinds();
      expect(Array.isArray(kinds)).toBe(true);
      expect(kinds.length).toBeGreaterThan(0);

      // Check if sorted
      for (let i = 1; i < kinds.length; i++) {
        expect(kinds[i]).toBeGreaterThan(kinds[i - 1]);
      }
    });
  });

  describe("formatTag", () => {
    it("should format simple tag", () => {
      const result = formatTag({
        name: "e",
        next: {
          type: "id",
          required: true,
        },
      });
      expect(result).toBe("#e <id>");
    });

    it("should format tag with multiple values", () => {
      const result = formatTag({
        name: "p",
        next: {
          type: "pubkey",
          required: true,
          next: {
            type: "relay",
          },
        },
      });
      expect(result).toBe("#p <pubkey> <relay>");
    });

    it("should indicate variadic tags", () => {
      const result = formatTag({
        name: "t",
        variadic: true,
        next: {
          type: "free",
          required: true,
        },
      });
      expect(result).toBe("#t <text> (multiple)");
    });

    it("should format constrained types", () => {
      const result = formatTag({
        name: "status",
        next: {
          type: "constrained",
          either: ["accepted", "declined"],
        },
      });
      expect(result).toBe("#status <accepted|declined>");
    });

    it("should convert 'free' type to 'text'", () => {
      const result = formatTag({
        name: "subject",
        next: {
          type: "free",
          required: true,
        },
      });
      expect(result).toBe("#subject <text>");
    });
  });

  describe("parseTagStructure", () => {
    it("should parse single value tag", () => {
      const result = parseTagStructure({
        name: "e",
        next: {
          type: "id",
          required: true,
        },
      });
      expect(result.primaryValue).toBe("id");
      expect(result.otherParameters).toEqual([]);
    });

    it("should parse tag with multiple parameters", () => {
      const result = parseTagStructure({
        name: "p",
        next: {
          type: "pubkey",
          required: true,
          next: {
            type: "relay",
            next: {
              type: "free",
            },
          },
        },
      });
      expect(result.primaryValue).toBe("pubkey");
      expect(result.otherParameters).toEqual([
        "relay (e.g. wss://grimoire.rocks)",
        "text",
      ]);
    });

    it("should parse tag with constrained values", () => {
      const result = parseTagStructure({
        name: "status",
        next: {
          type: "constrained",
          either: ["accepted", "declined", "tentative"],
        },
      });
      expect(result.primaryValue).toBe("accepted | declined | tentative");
      expect(result.otherParameters).toEqual([]);
    });

    it("should handle tag with no parameters", () => {
      const result = parseTagStructure({
        name: "t",
      });
      expect(result.primaryValue).toBe("");
      expect(result.otherParameters).toEqual([]);
    });

    it("should show grimoire.rocks example for url parameters", () => {
      const result = parseTagStructure({
        name: "r",
        next: {
          type: "url",
          required: true,
        },
      });
      expect(result.primaryValue).toBe("url (e.g. https://grimoire.rocks)");
      expect(result.otherParameters).toEqual([]);
    });

    it("should show grimoire.rocks example for relay parameters", () => {
      const result = parseTagStructure({
        name: "relay",
        next: {
          type: "relay",
          required: true,
        },
      });
      expect(result.primaryValue).toBe("relay (e.g. wss://grimoire.rocks)");
      expect(result.otherParameters).toEqual([]);
    });
  });

  describe("getContentTypeDescription", () => {
    it("should describe free content", () => {
      expect(getContentTypeDescription("free")).toBe(
        "Free-form text or markdown"
      );
    });

    it("should describe json content", () => {
      expect(getContentTypeDescription("json")).toBe("JSON object");
    });

    it("should describe empty content", () => {
      expect(getContentTypeDescription("empty")).toBe(
        "Empty (no content field)"
      );
    });
  });
});
