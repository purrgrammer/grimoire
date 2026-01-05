import { describe, it, expect, vi, beforeEach } from "vitest";
import { PublishSpellbook } from "./publish-spellbook";
import type { ActionContext } from "applesauce-actions";
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

// Track published events
const publishedEvents: NostrEvent[] = [];

const mockSign = vi.fn(async (draft: any) => ({
  ...draft,
  sig: "test-signature",
}));

// v5: publish accepts (event | events, relays?)
const mockPublish = vi.fn(
  async (event: NostrEvent | NostrEvent[], _relays?: string[]) => {
    if (Array.isArray(event)) {
      publishedEvents.push(...event);
    } else {
      publishedEvents.push(event);
    }
  },
);

const mockContext: ActionContext = {
  factory: mockFactory as any,
  events: {} as any,
  self: "test-pubkey",
  user: {} as any,
  signer: mockSigner as any,
  sign: mockSign,
  publish: mockPublish,
  run: vi.fn(),
};

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

// Helper to run action with context (v5 - async function, not generator)
async function runAction(
  options: Parameters<typeof PublishSpellbook>[0],
): Promise<NostrEvent[]> {
  // Clear published events before each run
  publishedEvents.length = 0;

  const action = PublishSpellbook(options);
  await action(mockContext);

  return [...publishedEvents];
}

describe("PublishSpellbook action", () => {
  beforeEach(async () => {
    vi.clearAllMocks();

    // Set up accountManager mock
    const accountManager = await import("@/services/accounts");
    (accountManager.default as any).active = mockAccount;
  });

  describe("validation", () => {
    it("should throw error if title is empty", async () => {
      await expect(
        runAction({
          state: mockState,
          title: "",
        }),
      ).rejects.toThrow("Title is required");
    });

    it("should throw error if title is only whitespace", async () => {
      await expect(
        runAction({
          state: mockState,
          title: "   ",
        }),
      ).rejects.toThrow("Title is required");
    });

    it("should throw error if no active account", async () => {
      const accountManager = await import("@/services/accounts");
      (accountManager.default as any).active = null;

      await expect(
        runAction({
          state: mockState,
          title: "Test Spellbook",
        }),
      ).rejects.toThrow("No active account");

      // Restore for other tests
      (accountManager.default as any).active = mockAccount;
    });

    it("should throw error if no signer available", async () => {
      const accountManager = await import("@/services/accounts");
      const accountWithoutSigner = { ...mockAccount, signer: null };
      (accountManager.default as any).active = accountWithoutSigner;

      await expect(
        runAction({
          state: mockState,
          title: "Test Spellbook",
        }),
      ).rejects.toThrow("No signer available");

      // Restore for other tests
      (accountManager.default as any).active = mockAccount;
    });
  });

  describe("event creation", () => {
    it("should yield properly formatted spellbook event", async () => {
      const events = await runAction({
        state: mockState,
        title: "Test Spellbook",
        description: "Test description",
      });

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
      const events = await runAction({
        state: mockState,
        title: "My Dashboard",
      });

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

      const events = await runAction({
        state: mockState,
        title: "Custom Spellbook",
        content: explicitContent,
      });

      expect(events).toHaveLength(1);
      const event = events[0];

      const content = JSON.parse(event.content);
      expect(content).toEqual(explicitContent);
    });

    it("should not include description tag when description is empty", async () => {
      const events = await runAction({
        state: mockState,
        title: "No Description",
      });

      const event = events[0];
      const tags = event.tags as [string, string, ...string[]][];
      const descTag = tags.find((t) => t[0] === "description");

      expect(descTag).toBeUndefined();
    });
  });

  describe("slug generation", () => {
    it("should generate slug from title", async () => {
      const events = await runAction({
        state: mockState,
        title: "My Awesome Dashboard!",
      });

      const dTag = (events[0].tags as [string, string][]).find(
        (t) => t[0] === "d",
      );
      expect(dTag?.[1]).toBe("my-awesome-dashboard");
    });

    it("should handle special characters in title", async () => {
      const events = await runAction({
        state: mockState,
        title: "Test@123#Special$Characters",
      });

      const dTag = (events[0].tags as [string, string][]).find(
        (t) => t[0] === "d",
      );
      expect(dTag?.[1]).toMatch(/^test123specialcharacters$/);
    });
  });

  describe("factory integration", () => {
    it("should call factory.build with correct props", async () => {
      await runAction({
        state: mockState,
        title: "Test",
      });

      expect(mockFactory.build).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 30777,
          content: expect.any(String),
          tags: expect.arrayContaining([
            ["d", expect.any(String)],
            ["title", "Test"],
          ]),
        }),
      );
    });

    it("should call sign with draft", async () => {
      await runAction({
        state: mockState,
        title: "Test",
      });

      expect(mockSign).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 30777,
        }),
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

      const events = await runAction({
        state: multiWorkspaceState,
        title: "Multi Workspace",
      });

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

      const events = await runAction({
        state: multiWorkspaceState,
        title: "Single Workspace",
        workspaceIds: ["ws-1"],
      });

      const content = JSON.parse(events[0].content);
      expect(Object.keys(content.workspaces).length).toBe(1);
      expect(content.workspaces["ws-1"]).toBeDefined();
    });
  });
});
