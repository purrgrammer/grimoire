import { describe, it, expect, vi, beforeEach } from "vitest";
import { PublishSpellbook } from "./publish-spellbook";
import type { ActionHub } from "applesauce-actions";
import type { GrimoireState } from "@/types/app";
import type { NostrEvent } from "nostr-tools/core";

// Mock accountManager
vi.mock("@/services/accounts", () => ({
  default: {
    active: null, // Will be set in tests
  },
}));

// Mock implementations
const mockSigner = {
  getPublicKey: vi.fn(async () => "test-pubkey"),
  signEvent: vi.fn(async (event: any) => ({ ...event, sig: "test-signature" })),
};

const mockAccount = {
  pubkey: "test-pubkey",
  signer: mockSigner,
};

const mockFactory = {
  build: vi.fn(async (props: any) => ({
    ...props,
    pubkey: mockAccount.pubkey,
    created_at: Math.floor(Date.now() / 1000),
    id: "test-event-id",
  })),
  sign: vi.fn(async (draft: any) => ({
    ...draft,
    sig: "test-signature",
  })),
};

const mockHub: ActionHub = {
  factory: mockFactory,
} as any;

const mockState: GrimoireState = {
  windows: {
    "win-1": {
      id: "win-1",
      appId: "req",
      props: { filter: { kinds: [1] } },
      commandString: "req -k 1",
    },
  },
  workspaces: {
    "ws-1": {
      id: "ws-1",
      number: 1,
      label: "Main",
      layout: "win-1",
      windowIds: ["win-1"],
    },
  },
  activeWorkspaceId: "ws-1",
  layoutConfig: { direction: "row" },
  workspaceOrder: ["ws-1"],
} as any;

describe("PublishSpellbook action", () => {
  beforeEach(async () => {
    vi.clearAllMocks();

    // Set up accountManager mock
    const accountManager = await import("@/services/accounts");
    (accountManager.default as any).active = mockAccount;
  });

  describe("validation", () => {
    it("should throw error if title is empty", async () => {
      await expect(async () => {
        for await (const event of PublishSpellbook(mockHub, {
          state: mockState,
          title: "",
        })) {
          // Should not reach here
        }
      }).rejects.toThrow("Title is required");
    });

    it("should throw error if title is only whitespace", async () => {
      await expect(async () => {
        for await (const event of PublishSpellbook(mockHub, {
          state: mockState,
          title: "   ",
        })) {
          // Should not reach here
        }
      }).rejects.toThrow("Title is required");
    });

    it("should throw error if no active account", async () => {
      const accountManager = await import("@/services/accounts");
      (accountManager.default as any).active = null;

      await expect(async () => {
        for await (const event of PublishSpellbook(mockHub, {
          state: mockState,
          title: "Test Spellbook",
        })) {
          // Should not reach here
        }
      }).rejects.toThrow("No active account");

      // Restore for other tests
      (accountManager.default as any).active = mockAccount;
    });

    it("should throw error if no signer available", async () => {
      const accountManager = await import("@/services/accounts");
      const accountWithoutSigner = { ...mockAccount, signer: null };
      (accountManager.default as any).active = accountWithoutSigner;

      await expect(async () => {
        for await (const event of PublishSpellbook(mockHub, {
          state: mockState,
          title: "Test Spellbook",
        })) {
          // Should not reach here
        }
      }).rejects.toThrow("No signer available");

      // Restore for other tests
      (accountManager.default as any).active = mockAccount;
    });
  });

  describe("event creation", () => {
    it("should yield properly formatted spellbook event", async () => {
      const events: NostrEvent[] = [];

      for await (const event of PublishSpellbook(mockHub, {
        state: mockState,
        title: "Test Spellbook",
        description: "Test description",
      })) {
        events.push(event);
      }

      expect(events).toHaveLength(1);
      const event = events[0];

      expect(event.kind).toBe(30777);
      expect(event.pubkey).toBe("test-pubkey");
      expect(event.sig).toBe("test-signature");

      // Check tags
      const tags = event.tags as [string, string, ...string[]][];
      const dTag = tags.find((t) => t[0] === "d");
      const titleTag = tags.find((t) => t[0] === "title");
      const descTag = tags.find((t) => t[0] === "description");
      const clientTag = tags.find((t) => t[0] === "client");
      const altTag = tags.find((t) => t[0] === "alt");

      expect(dTag).toBeDefined();
      expect(dTag?.[1]).toBe("test-spellbook"); // slugified title
      expect(titleTag).toBeDefined();
      expect(titleTag?.[1]).toBe("Test Spellbook");
      expect(descTag).toBeDefined();
      expect(descTag?.[1]).toBe("Test description");
      expect(clientTag).toBeDefined();
      expect(clientTag?.[1]).toBe("grimoire");
      expect(altTag).toBeDefined();
      expect(altTag?.[1]).toBe("Grimoire Spellbook: Test Spellbook");
    });

    it("should create event from state when no content provided", async () => {
      const events: NostrEvent[] = [];

      for await (const event of PublishSpellbook(mockHub, {
        state: mockState,
        title: "My Dashboard",
      })) {
        events.push(event);
      }

      expect(events).toHaveLength(1);
      const event = events[0];

      // Verify content contains workspace and window data
      const content = JSON.parse(event.content);
      expect(content.version).toBe(1);
      expect(content.workspaces).toBeDefined();
      expect(content.windows).toBeDefined();
      expect(Object.keys(content.workspaces).length).toBeGreaterThan(0);
    });

    it("should use provided content when explicitly passed", async () => {
      const explicitContent = {
        version: 1,
        workspaces: { "custom-ws": {} as any },
        windows: { "custom-win": {} as any },
      };

      const events: NostrEvent[] = [];

      for await (const event of PublishSpellbook(mockHub, {
        state: mockState,
        title: "Custom Spellbook",
        content: explicitContent,
      })) {
        events.push(event);
      }

      expect(events).toHaveLength(1);
      const event = events[0];

      const content = JSON.parse(event.content);
      expect(content).toEqual(explicitContent);
    });

    it("should not include description tag when description is empty", async () => {
      const events: NostrEvent[] = [];

      for await (const event of PublishSpellbook(mockHub, {
        state: mockState,
        title: "No Description",
      })) {
        events.push(event);
      }

      const event = events[0];
      const tags = event.tags as [string, string, ...string[]][];
      const descTag = tags.find((t) => t[0] === "description");

      expect(descTag).toBeUndefined();
    });
  });

  describe("slug generation", () => {
    it("should generate slug from title", async () => {
      const events: NostrEvent[] = [];

      for await (const event of PublishSpellbook(mockHub, {
        state: mockState,
        title: "My Awesome Dashboard!",
      })) {
        events.push(event);
      }

      const dTag = (events[0].tags as [string, string][]).find((t) => t[0] === "d");
      expect(dTag?.[1]).toBe("my-awesome-dashboard");
    });

    it("should handle special characters in title", async () => {
      const events: NostrEvent[] = [];

      for await (const event of PublishSpellbook(mockHub, {
        state: mockState,
        title: "Test@123#Special$Characters",
      })) {
        events.push(event);
      }

      const dTag = (events[0].tags as [string, string][]).find((t) => t[0] === "d");
      expect(dTag?.[1]).toMatch(/^test123specialcharacters$/);
    });
  });

  describe("factory integration", () => {
    it("should call factory.build with correct props", async () => {
      for await (const event of PublishSpellbook(mockHub, {
        state: mockState,
        title: "Test",
      })) {
        // Event yielded
      }

      expect(mockFactory.build).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 30777,
          content: expect.any(String),
          tags: expect.arrayContaining([
            ["d", expect.any(String)],
            ["title", "Test"],
          ]),
          signer: mockSigner,
        })
      );
    });

    it("should call factory.sign with draft and signer", async () => {
      for await (const event of PublishSpellbook(mockHub, {
        state: mockState,
        title: "Test",
      })) {
        // Event yielded
      }

      expect(mockFactory.sign).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 30777,
        }),
        mockSigner
      );
    });
  });

  describe("workspace selection", () => {
    it("should include all workspaces when no workspaceIds specified", async () => {
      const multiWorkspaceState: GrimoireState = {
        ...mockState,
        workspaces: {
          "ws-1": mockState.workspaces["ws-1"],
          "ws-2": {
            id: "ws-2",
            number: 2,
            label: "Secondary",
            layout: null,
            windowIds: [],
          },
        },
      };

      const events: NostrEvent[] = [];

      for await (const event of PublishSpellbook(mockHub, {
        state: multiWorkspaceState,
        title: "Multi Workspace",
      })) {
        events.push(event);
      }

      const content = JSON.parse(events[0].content);
      expect(Object.keys(content.workspaces).length).toBe(2);
    });

    it("should include only specified workspaces", async () => {
      const multiWorkspaceState: GrimoireState = {
        ...mockState,
        workspaces: {
          "ws-1": mockState.workspaces["ws-1"],
          "ws-2": {
            id: "ws-2",
            number: 2,
            label: "Secondary",
            layout: null,
            windowIds: [],
          },
        },
      };

      const events: NostrEvent[] = [];

      for await (const event of PublishSpellbook(mockHub, {
        state: multiWorkspaceState,
        title: "Single Workspace",
        workspaceIds: ["ws-1"],
      })) {
        events.push(event);
      }

      const content = JSON.parse(events[0].content);
      expect(Object.keys(content.workspaces).length).toBe(1);
      expect(content.workspaces["ws-1"]).toBeDefined();
    });
  });
});
