import { describe, it, expect } from "vitest";
import {
  buildSystemPrompt,
  buildCompactSystemPrompt,
  getCommandsReference,
  getNipsReference,
  getKindsReference,
  getNostrBasics,
  getCommandQuickReference,
  getCommandDoc,
  getNipTitles,
  getEventKindsInfo,
} from "./system-prompt";

describe("system-prompt", () => {
  describe("buildSystemPrompt", () => {
    it("should build a complete system prompt with all sections", () => {
      const prompt = buildSystemPrompt();

      // Should include header
      expect(prompt).toContain("Grimoire Nostr Assistant");

      // Should include Nostr basics
      expect(prompt).toContain("Nostr Protocol Fundamentals");
      expect(prompt).toContain("Events are the only data type");
      expect(prompt).toContain("npub");
      expect(prompt).toContain("NIP-19");

      // Should include commands
      expect(prompt).toContain("Grimoire Commands Reference");
      expect(prompt).toContain("req");
      expect(prompt).toContain("profile");
      expect(prompt).toContain("open");

      // Should include natural language examples
      expect(prompt).toContain("Natural Language to Command Translation");
      expect(prompt).toContain("Show me recent posts");

      // Should include NIPs reference
      expect(prompt).toContain("NIPs Reference");
      expect(prompt).toContain("NIP-01");

      // Should include kinds reference
      expect(prompt).toContain("Event Kinds Reference");
      expect(prompt).toContain("Kind 1");
    });

    it("should respect options to exclude sections", () => {
      const prompt = buildSystemPrompt({
        includeCommands: false,
        includeNips: false,
        includeKinds: false,
        includeExamples: false,
        includeNostrBasics: false,
      });

      // Should only have header
      expect(prompt).toContain("Grimoire Nostr Assistant");
      expect(prompt).not.toContain("Nostr Protocol Fundamentals");
      expect(prompt).not.toContain("Grimoire Commands Reference");
      expect(prompt).not.toContain("NIPs Reference");
      expect(prompt).not.toContain("Event Kinds Reference");
    });

    it("should limit examples per command", () => {
      const promptWith1 = buildSystemPrompt({ maxExamplesPerCommand: 1 });
      const promptWithAll = buildSystemPrompt({ maxExamplesPerCommand: 100 });

      // Prompt with more examples should be longer
      expect(promptWithAll.length).toBeGreaterThan(promptWith1.length);
    });
  });

  describe("buildCompactSystemPrompt", () => {
    it("should build a shorter prompt than full version", () => {
      const compact = buildCompactSystemPrompt();
      const full = buildSystemPrompt();

      expect(compact.length).toBeLessThan(full.length);
      // Should still have essential content
      expect(compact).toContain("Grimoire Nostr Assistant");
      expect(compact).toContain("req");
    });
  });

  describe("getCommandsReference", () => {
    it("should return command documentation", () => {
      const ref = getCommandsReference();

      expect(ref).toContain("Grimoire Commands Reference");
      expect(ref).toContain("req");
      expect(ref).toContain("profile");
      expect(ref).toContain("nip");
    });
  });

  describe("getNipsReference", () => {
    it("should return NIPs documentation", () => {
      const ref = getNipsReference();

      expect(ref).toContain("NIP-01");
      expect(ref).toContain("Basic protocol");
      expect(ref).toContain("NIP-19");
      expect(ref).toContain("bech32");
    });

    it("should mark deprecated NIPs", () => {
      const ref = getNipsReference();

      expect(ref).toContain("NIP-04");
      expect(ref).toContain("deprecated");
    });
  });

  describe("getKindsReference", () => {
    it("should return event kinds documentation", () => {
      const ref = getKindsReference();

      expect(ref).toContain("Event Kinds Reference");
      expect(ref).toContain("Kind 0");
      expect(ref).toContain("Kind 1");
      expect(ref).toContain("Profile");
      expect(ref).toContain("Note");
    });

    it("should respect maxKinds option", () => {
      const limited = getKindsReference(5);
      const full = getKindsReference();

      expect(limited.length).toBeLessThan(full.length);
    });
  });

  describe("getNostrBasics", () => {
    it("should return Nostr fundamentals", () => {
      const basics = getNostrBasics();

      expect(basics).toContain("Nostr Protocol Fundamentals");
      expect(basics).toContain("Events");
      expect(basics).toContain("pubkey");
      expect(basics).toContain("kind");
      expect(basics).toContain("Relays");
      expect(basics).toContain("WebSocket");
      expect(basics).toContain("$me");
      expect(basics).toContain("$contacts");
    });
  });

  describe("getCommandQuickReference", () => {
    it("should return all commands with name, synopsis, and description", () => {
      const commands = getCommandQuickReference();

      expect(commands.length).toBeGreaterThan(0);

      const reqCmd = commands.find((c) => c.name === "req");
      expect(reqCmd).toBeDefined();
      expect(reqCmd?.synopsis).toContain("req");
      expect(reqCmd?.description).toBeDefined();

      const profileCmd = commands.find((c) => c.name === "profile");
      expect(profileCmd).toBeDefined();
    });
  });

  describe("getCommandDoc", () => {
    it("should return documentation for a valid command", () => {
      const doc = getCommandDoc("req");

      expect(doc).not.toBeNull();
      expect(doc).toContain("req");
      expect(doc).toContain("Synopsis");
      expect(doc).toContain("Options");
      expect(doc).toContain("-k");
    });

    it("should return null for invalid command", () => {
      const doc = getCommandDoc("nonexistent-command");

      expect(doc).toBeNull();
    });

    it("should be case-insensitive", () => {
      const docLower = getCommandDoc("req");
      const docUpper = getCommandDoc("REQ");

      expect(docLower).toEqual(docUpper);
    });
  });

  describe("getNipTitles", () => {
    it("should return a map of NIP IDs to titles", () => {
      const titles = getNipTitles();

      expect(titles["01"]).toBeDefined();
      expect(titles["01"]).toContain("protocol");
      expect(titles["19"]).toContain("bech32");
      expect(titles["65"]).toContain("Relay");
    });
  });

  describe("getEventKindsInfo", () => {
    it("should return event kind information", () => {
      const kinds = getEventKindsInfo();

      expect(kinds[0]).toBeDefined();
      expect(kinds[0].name).toBe("Profile");
      expect(kinds[1]).toBeDefined();
      expect(kinds[1].name).toBe("Note");
      expect(kinds[7]).toBeDefined();
      expect(kinds[7].name).toBe("Reaction");
    });
  });
});
