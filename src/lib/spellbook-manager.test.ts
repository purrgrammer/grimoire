import { describe, it, expect } from "vitest";
import {
  createSpellbook,
  parseSpellbook,
  loadSpellbook,
  slugify,
} from "./spellbook-manager";
import { GrimoireState, WindowInstance, Workspace } from "@/types/app";
import { SPELLBOOK_KIND, SpellbookEvent } from "@/types/spell";
import { GRIMOIRE_CLIENT_TAG } from "@/constants/app";

// Mock Data
const mockWindow1: WindowInstance = {
  id: "win-1",
  appId: "profile",
  props: { pubkey: "abc" },
  spellId: "spell-1",
};

const mockWindow2: WindowInstance = {
  id: "win-2",
  appId: "kind",
  props: { kind: 1 },
};

// REQ window with filter.kinds for k tag extraction
const mockReqWindow: WindowInstance = {
  id: "win-req",
  appId: "req",
  props: {
    filter: {
      kinds: [1, 6, 7, 30023],
      authors: ["abc"],
    },
  },
};

const mockReqWindow2: WindowInstance = {
  id: "win-req-2",
  appId: "req",
  props: {
    filter: {
      kinds: [1, 4], // kind 1 duplicated to test dedup
    },
  },
};

const mockWorkspace1: Workspace = {
  id: "ws-1",
  number: 1,
  layout: "win-1",
  windowIds: ["win-1"],
};

const mockWorkspace2: Workspace = {
  id: "ws-2",
  number: 2,
  layout: {
    direction: "row",
    first: "win-2",
    second: "win-1",
  },
  windowIds: ["win-1", "win-2"],
};

const mockWorkspaceWithReq: Workspace = {
  id: "ws-req",
  number: 3,
  layout: {
    direction: "row",
    first: "win-req",
    second: "win-req-2",
  },
  windowIds: ["win-req", "win-req-2"],
};

const mockState: GrimoireState = {
  __version: 6,
  windows: {
    "win-1": mockWindow1,
    "win-2": mockWindow2,
  },
  workspaces: {
    "ws-1": mockWorkspace1,
    "ws-2": mockWorkspace2,
  },
  activeWorkspaceId: "ws-1",
  layoutConfig: {
    insertionMode: "smart",
    splitPercentage: 50,
    insertionPosition: "second",
  },
};

const mockStateWithReq: GrimoireState = {
  __version: 6,
  windows: {
    "win-req": mockReqWindow,
    "win-req-2": mockReqWindow2,
  },
  workspaces: {
    "ws-req": mockWorkspaceWithReq,
  },
  activeWorkspaceId: "ws-req",
  layoutConfig: {
    insertionMode: "smart",
    splitPercentage: 50,
    insertionPosition: "second",
  },
};

describe("Spellbook Manager", () => {
  describe("slugify", () => {
    it("converts titles to slugs", () => {
      expect(slugify("Hello World")).toBe("hello-world");
      expect(slugify("My Cool Dashboard!")).toBe("my-cool-dashboard");
      expect(slugify("  Trim Me  ")).toBe("trim-me");
      expect(slugify("Mixed Case Title")).toBe("mixed-case-title");
    });
  });

  describe("createSpellbook", () => {
    it("creates a valid spellbook from state", () => {
      const result = createSpellbook({
        state: mockState,
        title: "My Backup",
        description: "Test description",
        workspaceIds: ["ws-1"],
      });

      const { eventProps, referencedSpells } = result;
      const content = JSON.parse(eventProps.content);

      // Check event props
      expect(eventProps.kind).toBe(SPELLBOOK_KIND);
      expect(eventProps.tags).toContainEqual(["d", "my-backup"]);
      expect(eventProps.tags).toContainEqual(["title", "My Backup"]);
      expect(eventProps.tags).toContainEqual([
        "description",
        "Test description",
      ]);
      expect(eventProps.tags).toContainEqual(GRIMOIRE_CLIENT_TAG);

      // Check referenced spells (e tags)
      expect(referencedSpells).toContain("spell-1");
      expect(eventProps.tags).toContainEqual(["e", "spell-1", "", "mention"]);

      // Check content structure
      expect(content.version).toBe(1);
      expect(Object.keys(content.workspaces)).toHaveLength(1);
      expect(content.workspaces["ws-1"]).toBeDefined();

      // Should only include windows referenced in the workspace
      expect(Object.keys(content.windows)).toHaveLength(1);
      expect(content.windows["win-1"]).toBeDefined();
      expect(content.windows["win-2"]).toBeUndefined();
    });

    it("includes all workspaces if no IDs provided", () => {
      const result = createSpellbook({
        state: mockState,
        title: "Full Backup",
      });

      const content = JSON.parse(result.eventProps.content);
      expect(Object.keys(content.workspaces)).toHaveLength(2);
      expect(Object.keys(content.windows)).toHaveLength(2);
    });

    it("extracts k tags from REQ windows and deduplicates", () => {
      const result = createSpellbook({
        state: mockStateWithReq,
        title: "REQ Dashboard",
      });

      const kTags = result.eventProps.tags.filter((t) => t[0] === "k");

      // Should have k tags for kinds: 1, 4, 6, 7, 30023 (deduped and sorted)
      expect(kTags).toContainEqual(["k", "1"]);
      expect(kTags).toContainEqual(["k", "4"]);
      expect(kTags).toContainEqual(["k", "6"]);
      expect(kTags).toContainEqual(["k", "7"]);
      expect(kTags).toContainEqual(["k", "30023"]);

      // Should be sorted by kind number
      expect(kTags).toHaveLength(5);
      expect(kTags[0]).toEqual(["k", "1"]);
      expect(kTags[kTags.length - 1]).toEqual(["k", "30023"]);
    });

    it("does not include k tags for non-REQ windows", () => {
      const result = createSpellbook({
        state: mockState,
        title: "No REQ",
        workspaceIds: ["ws-1"],
      });

      const kTags = result.eventProps.tags.filter((t) => t[0] === "k");
      expect(kTags).toHaveLength(0);
    });
  });

  describe("parseSpellbook", () => {
    it("parses a valid spellbook event", () => {
      const content = {
        version: 1,
        workspaces: { "ws-1": mockWorkspace1 },
        windows: { "win-1": mockWindow1 },
      };

      const event: SpellbookEvent = {
        id: "evt-1",
        pubkey: "pub-1",
        created_at: 123456,
        kind: SPELLBOOK_KIND,
        tags: [
          ["d", "my-slug"],
          ["title", "My Title"],
          ["description", "Desc"],
          ["e", "spell-1"],
        ],
        content: JSON.stringify(content),
        sig: "sig",
      };

      const parsed = parseSpellbook(event);

      expect(parsed.slug).toBe("my-slug");
      expect(parsed.title).toBe("My Title");
      expect(parsed.description).toBe("Desc");
      expect(parsed.content).toEqual(content);
      expect(parsed.referencedSpells).toContain("spell-1");
    });

    it("handles parsing errors gracefully", () => {
      const event = {
        kind: SPELLBOOK_KIND,
        content: "invalid json",
        tags: [],
      } as any;

      expect(() => parseSpellbook(event)).toThrow(
        "Failed to parse spellbook content",
      );
    });
  });

  describe("loadSpellbook", () => {
    it("replaces all workspaces with imported ones and regenerates IDs", () => {
      const spellbookContent = {
        version: 1,
        workspaces: { "ws-1": mockWorkspace1 },
        windows: { "win-1": mockWindow1 },
      };

      const parsed = {
        slug: "test",
        title: "Test",
        content: spellbookContent,
        referencedSpells: [],
        event: {} as any,
      };

      const newState = loadSpellbook(mockState, parsed);

      // Should have only 1 workspace (replaces all existing)
      expect(Object.keys(newState.workspaces)).toHaveLength(1);

      // Get the new workspace
      const newWs = Object.values(newState.workspaces)[0];

      // IDs should be regenerated
      expect(newWs.id).not.toBe("ws-1");

      // Number should be 1 (sequential assignment)
      expect(newWs.number).toBe(1);

      // Window IDs should be regenerated
      const newWinId = newWs.windowIds[0];
      expect(newWinId).not.toBe("win-1");
      expect(newState.windows[newWinId]).toBeDefined();
      expect(newState.windows[newWinId].appId).toBe("profile");

      // Layout should reference new window ID
      expect(newWs.layout).toBe(newWinId);
    });

    it("updates layout tree with new window IDs", () => {
      const spellbookContent = {
        version: 1,
        workspaces: { "ws-2": mockWorkspace2 },
        windows: { "win-1": mockWindow1, "win-2": mockWindow2 },
      };

      const parsed = {
        slug: "test",
        title: "Test",
        content: spellbookContent,
        referencedSpells: [],
        event: {} as any,
      };

      const newState = loadSpellbook(mockState, parsed);
      // Since loadSpellbook replaces all workspaces, the imported workspace gets number 1
      const newWs = Object.values(newState.workspaces).find(
        (w) => w.number === 1,
      )!;

      expect(typeof newWs.layout).toBe("object");
      if (typeof newWs.layout === "object" && newWs.layout !== null) {
        // Check that leaf nodes are new UUIDs, not old IDs
        expect(newWs.layout.first).not.toBe("win-2");
        expect(newWs.layout.second).not.toBe("win-1");

        // Check that they match the windowIds list
        expect(newWs.windowIds).toContain(newWs.layout.first);
        expect(newWs.windowIds).toContain(newWs.layout.second);
      }
    });

    it("sets activeSpellbook with source tracking from network event", () => {
      const spellbookContent = {
        version: 1,
        workspaces: { "ws-1": mockWorkspace1 },
        windows: { "win-1": mockWindow1 },
      };

      const event: SpellbookEvent = {
        id: "event-123",
        pubkey: "author-pubkey",
        created_at: 123456,
        kind: SPELLBOOK_KIND,
        tags: [["d", "test"]],
        content: JSON.stringify(spellbookContent),
        sig: "sig",
      };

      const parsed = {
        slug: "test",
        title: "Test Title",
        description: "Test Description",
        content: spellbookContent,
        referencedSpells: [],
        event,
        // Simulating network-loaded spellbook (no localId)
        source: "network" as const,
        isPublished: true,
      };

      const newState = loadSpellbook(mockState, parsed);

      // Check activeSpellbook has enhanced fields
      expect(newState.activeSpellbook).toBeDefined();
      expect(newState.activeSpellbook?.slug).toBe("test");
      expect(newState.activeSpellbook?.title).toBe("Test Title");
      expect(newState.activeSpellbook?.description).toBe("Test Description");
      expect(newState.activeSpellbook?.pubkey).toBe("author-pubkey");
      expect(newState.activeSpellbook?.source).toBe("network");
      expect(newState.activeSpellbook?.isPublished).toBe(true);
      expect(newState.activeSpellbook?.localId).toBeUndefined();
    });

    it("sets activeSpellbook with source tracking from local spellbook", () => {
      const spellbookContent = {
        version: 1,
        workspaces: { "ws-1": mockWorkspace1 },
        windows: { "win-1": mockWindow1 },
      };

      const parsed = {
        slug: "local-test",
        title: "Local Test",
        content: spellbookContent,
        referencedSpells: [],
        // Simulating local-loaded spellbook
        localId: "local-uuid-123",
        source: "local" as const,
        isPublished: false,
      };

      const newState = loadSpellbook(mockState, parsed);

      // Check activeSpellbook has enhanced fields
      expect(newState.activeSpellbook).toBeDefined();
      expect(newState.activeSpellbook?.slug).toBe("local-test");
      expect(newState.activeSpellbook?.source).toBe("local");
      expect(newState.activeSpellbook?.isPublished).toBe(false);
      expect(newState.activeSpellbook?.localId).toBe("local-uuid-123");
      expect(newState.activeSpellbook?.pubkey).toBeUndefined();
    });

    it("infers source from event presence when not provided", () => {
      const spellbookContent = {
        version: 1,
        workspaces: { "ws-1": mockWorkspace1 },
        windows: { "win-1": mockWindow1 },
      };

      const event: SpellbookEvent = {
        id: "event-abc",
        pubkey: "some-pubkey",
        created_at: 123456,
        kind: SPELLBOOK_KIND,
        tags: [],
        content: JSON.stringify(spellbookContent),
        sig: "sig",
      };

      const parsed = {
        slug: "inferred",
        title: "Inferred",
        content: spellbookContent,
        referencedSpells: [],
        event, // Has event, so should infer network
        // No source, localId, or isPublished provided
      };

      const newState = loadSpellbook(mockState, parsed);

      // Should infer source as "network" and isPublished as true from event presence
      expect(newState.activeSpellbook?.source).toBe("network");
      expect(newState.activeSpellbook?.isPublished).toBe(true);
    });
  });
});
