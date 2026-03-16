import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NostrEvent } from "@/types/nostr";
import {
  getAmbCreators,
  getAmbRelatedResources,
  getAmbIsAccessibleForFree,
  getAmbDescription,
} from "./amb-helpers";

// Mock locale-utils so we can control getBrowserLanguage without relying on navigator
vi.mock("@/lib/locale-utils", () => ({
  getBrowserLanguage: vi.fn(() => "en"),
}));

import { getBrowserLanguage } from "@/lib/locale-utils";
const mockGetBrowserLanguage = vi.mocked(getBrowserLanguage);

// Helper to build a minimal event with specific tags
function makeEvent(tags: string[][], content = ""): NostrEvent {
  return {
    id: "test",
    pubkey: "test",
    created_at: 0,
    kind: 30142,
    tags,
    content,
    sig: "test",
  };
}

describe("amb-helpers", () => {
  beforeEach(() => {
    mockGetBrowserLanguage.mockReturnValue("en");
  });

  describe("findPrefLabel (via getAmbLearningResourceType)", () => {
    it("should return browser language label when available", async () => {
      mockGetBrowserLanguage.mockReturnValue("de");
      const { getAmbLearningResourceType } = await import("./amb-helpers.ts");

      const event = makeEvent([
        ["learningResourceType:id", "https://example.org/type/1"],
        ["learningResourceType:prefLabel:en", "Course"],
        ["learningResourceType:prefLabel:de", "Kurs"],
      ]);

      const result = getAmbLearningResourceType(event);
      expect(result?.label).toBe("Kurs");
    });

    it("should fall back to English when browser language not available", async () => {
      mockGetBrowserLanguage.mockReturnValue("fr");
      const { getAmbEducationalLevel } = await import("./amb-helpers.ts");

      const event = makeEvent([
        ["educationalLevel:id", "https://example.org/level/1"],
        ["educationalLevel:prefLabel:de", "Grundschule"],
        ["educationalLevel:prefLabel:en", "Primary School"],
      ]);

      const result = getAmbEducationalLevel(event);
      expect(result?.label).toBe("Primary School");
    });

    it("should fall back to first available when neither browser lang nor en exists", async () => {
      mockGetBrowserLanguage.mockReturnValue("ja");
      const { getAmbAudience } = await import("./amb-helpers.ts");

      const event = makeEvent([
        ["audience:id", "https://example.org/audience/1"],
        ["audience:prefLabel:de", "Lernende"],
        ["audience:prefLabel:es", "Estudiantes"],
      ]);

      const result = getAmbAudience(event);
      expect(result?.label).toBe("Lernende");
    });

    it("should return undefined when no labels exist", async () => {
      mockGetBrowserLanguage.mockReturnValue("en");
      const { getAmbLearningResourceType } = await import("./amb-helpers.ts");

      const event = makeEvent([
        ["learningResourceType:id", "https://example.org/type/1"],
      ]);

      const result = getAmbLearningResourceType(event);
      expect(result?.label).toBeUndefined();
    });
  });

  describe("getAmbSubjects", () => {
    it("should pair ids with labels from preferred language only", async () => {
      mockGetBrowserLanguage.mockReturnValue("de");
      const { getAmbSubjects } = await import("./amb-helpers.ts");

      const event = makeEvent([
        ["about:id", "https://example.org/subject/math"],
        ["about:id", "https://example.org/subject/physics"],
        ["about:prefLabel:de", "Mathematik"],
        ["about:prefLabel:de", "Physik"],
        ["about:prefLabel:en", "Mathematics"],
        ["about:prefLabel:en", "Physics"],
      ]);

      const subjects = getAmbSubjects(event);
      expect(subjects).toHaveLength(2);
      expect(subjects[0]).toEqual({
        id: "https://example.org/subject/math",
        label: "Mathematik",
      });
      expect(subjects[1]).toEqual({
        id: "https://example.org/subject/physics",
        label: "Physik",
      });
    });

    it("should fall back to English labels", async () => {
      mockGetBrowserLanguage.mockReturnValue("ja");
      const { getAmbSubjects } = await import("./amb-helpers.ts");

      const event = makeEvent([
        ["about:id", "https://example.org/subject/math"],
        ["about:prefLabel:de", "Mathematik"],
        ["about:prefLabel:en", "Mathematics"],
      ]);

      const subjects = getAmbSubjects(event);
      expect(subjects).toHaveLength(1);
      expect(subjects[0].label).toBe("Mathematics");
    });

    it("should handle single language correctly", async () => {
      mockGetBrowserLanguage.mockReturnValue("en");
      const { getAmbSubjects } = await import("./amb-helpers.ts");

      const event = makeEvent([
        ["about:id", "https://example.org/subject/art"],
        ["about:prefLabel:de", "Kunst"],
      ]);

      const subjects = getAmbSubjects(event);
      expect(subjects).toHaveLength(1);
      expect(subjects[0].label).toBe("Kunst");
    });

    it("should handle no labels gracefully", async () => {
      mockGetBrowserLanguage.mockReturnValue("en");
      const { getAmbSubjects } = await import("./amb-helpers.ts");

      const event = makeEvent([
        ["about:id", "https://example.org/subject/math"],
        ["about:id", "https://example.org/subject/physics"],
      ]);

      const subjects = getAmbSubjects(event);
      expect(subjects).toHaveLength(2);
      expect(subjects[0]).toEqual({
        id: "https://example.org/subject/math",
        label: undefined,
      });
    });

    it("should handle more labels than ids", async () => {
      mockGetBrowserLanguage.mockReturnValue("en");
      const { getAmbSubjects } = await import("./amb-helpers.ts");

      const event = makeEvent([
        ["about:id", "https://example.org/subject/math"],
        ["about:prefLabel:en", "Mathematics"],
        ["about:prefLabel:en", "Physics"],
      ]);

      const subjects = getAmbSubjects(event);
      expect(subjects).toHaveLength(2);
      expect(subjects[1]).toEqual({
        id: undefined,
        label: "Physics",
      });
    });
  });

  describe("getAmbCreators", () => {
    it("should extract a p-tag only creator", () => {
      const event = makeEvent([
        ["p", "abc123", "wss://relay.example.com", "creator"],
      ]);

      const creators = getAmbCreators(event);
      expect(creators).toEqual([
        { pubkey: "abc123", relayHint: "wss://relay.example.com" },
      ]);
    });

    it("should extract a flattened-tag only creator", () => {
      const event = makeEvent([
        ["creator:name", "Alice"],
        ["creator:type", "Person"],
        ["creator:affiliation:name", "MIT"],
        ["creator:id", "https://orcid.org/0000-0001"],
      ]);

      const creators = getAmbCreators(event);
      expect(creators).toEqual([
        {
          name: "Alice",
          type: "Person",
          affiliationName: "MIT",
          id: "https://orcid.org/0000-0001",
        },
      ]);
    });

    it("should merge flattened tags into the first p-tag creator", () => {
      const event = makeEvent([
        ["p", "abc123", "wss://relay.example.com", "creator"],
        ["creator:name", "Alice"],
        ["creator:type", "Person"],
      ]);

      const creators = getAmbCreators(event);
      expect(creators).toHaveLength(1);
      expect(creators[0]).toEqual({
        pubkey: "abc123",
        relayHint: "wss://relay.example.com",
        name: "Alice",
        type: "Person",
        affiliationName: undefined,
        id: undefined,
      });
    });

    it("should only merge into the first p-tag creator", () => {
      const event = makeEvent([
        ["p", "abc123", "", "creator"],
        ["p", "def456", "wss://relay2.example.com", "creator"],
        ["creator:name", "Alice"],
      ]);

      const creators = getAmbCreators(event);
      expect(creators).toHaveLength(2);
      // First creator gets the merged name
      expect(creators[0].pubkey).toBe("abc123");
      expect(creators[0].name).toBe("Alice");
      // Second creator has no name
      expect(creators[1].pubkey).toBe("def456");
      expect(creators[1].name).toBeUndefined();
    });

    it("should ignore p tags without creator role", () => {
      const event = makeEvent([
        ["p", "abc123", "", "mention"],
        ["p", "def456"],
      ]);

      const creators = getAmbCreators(event);
      expect(creators).toEqual([]);
    });

    it("should handle p-tag with empty relay hint", () => {
      const event = makeEvent([["p", "abc123", "", "creator"]]);

      const creators = getAmbCreators(event);
      expect(creators).toEqual([{ pubkey: "abc123", relayHint: undefined }]);
    });

    it("should return empty array for event with no creator tags", () => {
      const event = makeEvent([
        ["t", "education"],
        ["type", "LearningResource"],
      ]);

      const creators = getAmbCreators(event);
      expect(creators).toEqual([]);
    });
  });

  describe("getAmbRelatedResources", () => {
    it("should extract a related resource with all fields", () => {
      const event = makeEvent([
        ["a", "30142:pubkey123:d-tag", "wss://relay.example.com", "isPartOf"],
      ]);

      const resources = getAmbRelatedResources(event);
      expect(resources).toEqual([
        {
          address: "30142:pubkey123:d-tag",
          relayHint: "wss://relay.example.com",
          relationship: "isPartOf",
        },
      ]);
    });

    it("should exclude non-30142 a tags", () => {
      const event = makeEvent([
        ["a", "30142:pubkey123:d-tag", "", "isPartOf"],
        ["a", "30023:pubkey456:d-tag", "wss://relay.example.com"],
        ["a", "10002:pubkey789:"],
      ]);

      const resources = getAmbRelatedResources(event);
      expect(resources).toHaveLength(1);
      expect(resources[0].address).toBe("30142:pubkey123:d-tag");
    });

    it("should handle missing relay hint and relationship", () => {
      const event = makeEvent([["a", "30142:pubkey123:d-tag"]]);

      const resources = getAmbRelatedResources(event);
      expect(resources).toEqual([
        {
          address: "30142:pubkey123:d-tag",
          relayHint: undefined,
          relationship: undefined,
        },
      ]);
    });

    it("should return empty array when no a tags exist", () => {
      const event = makeEvent([["t", "education"]]);

      const resources = getAmbRelatedResources(event);
      expect(resources).toEqual([]);
    });
  });

  describe("getAmbIsAccessibleForFree", () => {
    it("should return true for 'true'", () => {
      const event = makeEvent([["isAccessibleForFree", "true"]]);
      expect(getAmbIsAccessibleForFree(event)).toBe(true);
    });

    it("should return false for 'false'", () => {
      const event = makeEvent([["isAccessibleForFree", "false"]]);
      expect(getAmbIsAccessibleForFree(event)).toBe(false);
    });

    it("should return undefined when tag is missing", () => {
      const event = makeEvent([["t", "education"]]);
      expect(getAmbIsAccessibleForFree(event)).toBeUndefined();
    });
  });

  describe("getAmbDescription", () => {
    it("should use event.content when present", () => {
      const event = makeEvent(
        [["description", "tag description"]],
        "content description",
      );
      expect(getAmbDescription(event)).toBe("content description");
    });

    it("should fall back to description tag when content is empty", () => {
      const event = makeEvent([["description", "tag description"]], "");
      expect(getAmbDescription(event)).toBe("tag description");
    });

    it("should return undefined when both content and tag are missing", () => {
      const event = makeEvent([["t", "education"]], "");
      expect(getAmbDescription(event)).toBeUndefined();
    });
  });
});
