import { describe, it, expect } from "vitest";
import type { MosaicNode } from "react-mosaic-component";
import { findLowestAvailableWorkspaceNumber, addWindow } from "./logic";
import type { GrimoireState, LayoutConfig } from "@/types/app";

describe("findLowestAvailableWorkspaceNumber", () => {
  describe("basic number assignment", () => {
    it("should return 1 when no workspaces exist", () => {
      const result = findLowestAvailableWorkspaceNumber({});
      expect(result).toBe(1);
    });

    it("should return 2 when only workspace 1 exists", () => {
      const workspaces = {
        id1: { number: 1 },
      };
      const result = findLowestAvailableWorkspaceNumber(workspaces);
      expect(result).toBe(2);
    });

    it("should return 4 when workspaces 1, 2, 3 exist", () => {
      const workspaces = {
        id1: { number: 1 },
        id2: { number: 2 },
        id3: { number: 3 },
      };
      const result = findLowestAvailableWorkspaceNumber(workspaces);
      expect(result).toBe(4);
    });
  });

  describe("gap detection", () => {
    it("should return 2 when workspaces 1, 3, 4 exist", () => {
      const workspaces = {
        id1: { number: 1 },
        id3: { number: 3 },
        id4: { number: 4 },
      };
      const result = findLowestAvailableWorkspaceNumber(workspaces);
      expect(result).toBe(2);
    });

    it("should return 1 when workspaces 2, 3, 4 exist", () => {
      const workspaces = {
        id2: { number: 2 },
        id3: { number: 3 },
        id4: { number: 4 },
      };
      const result = findLowestAvailableWorkspaceNumber(workspaces);
      expect(result).toBe(1);
    });

    it("should return 3 when workspaces 1, 2, 4, 5 exist", () => {
      const workspaces = {
        id1: { number: 1 },
        id2: { number: 2 },
        id4: { number: 4 },
        id5: { number: 5 },
      };
      const result = findLowestAvailableWorkspaceNumber(workspaces);
      expect(result).toBe(3);
    });

    it("should return 2 when workspaces 1, 3 exist", () => {
      const workspaces = {
        id1: { number: 1 },
        id3: { number: 3 },
      };
      const result = findLowestAvailableWorkspaceNumber(workspaces);
      expect(result).toBe(2);
    });

    it("should return first gap when multiple gaps exist", () => {
      const workspaces = {
        id1: { number: 1 },
        id5: { number: 5 },
        id10: { number: 10 },
      };
      const result = findLowestAvailableWorkspaceNumber(workspaces);
      expect(result).toBe(2);
    });
  });

  describe("large numbers", () => {
    it("should return 3 when workspaces 1, 2, 100 exist", () => {
      const workspaces = {
        id1: { number: 1 },
        id2: { number: 2 },
        id100: { number: 100 },
      };
      const result = findLowestAvailableWorkspaceNumber(workspaces);
      expect(result).toBe(3);
    });

    it("should handle large sequential numbers correctly", () => {
      const workspaces = {
        id100: { number: 100 },
        id101: { number: 101 },
        id102: { number: 102 },
      };
      const result = findLowestAvailableWorkspaceNumber(workspaces);
      expect(result).toBe(1);
    });
  });

  describe("unordered workspaces", () => {
    it("should handle workspaces in random order", () => {
      const workspaces = {
        id5: { number: 5 },
        id1: { number: 1 },
        id3: { number: 3 },
        id7: { number: 7 },
      };
      const result = findLowestAvailableWorkspaceNumber(workspaces);
      expect(result).toBe(2);
    });

    it("should find lowest gap regardless of insertion order", () => {
      const workspaces = {
        id10: { number: 10 },
        id2: { number: 2 },
        id8: { number: 8 },
        id1: { number: 1 },
      };
      const result = findLowestAvailableWorkspaceNumber(workspaces);
      expect(result).toBe(3);
    });
  });
});

describe("addWindow", () => {
  // Helper to create minimal test state
  const createTestState = (
    layoutConfig: LayoutConfig,
    existingLayout: MosaicNode<string> | null = null,
  ): GrimoireState => ({
    __version: 8,
    windows: {},
    activeWorkspaceId: "test-workspace",
    layoutConfig, // Global layout config
    workspaces: {
      "test-workspace": {
        id: "test-workspace",
        number: 1,
        windowIds: [],
        layout: existingLayout,
      },
    },
  });

  describe("first window", () => {
    it("should create first window with row config", () => {
      const state = createTestState({
        insertionMode: "row",
        splitPercentage: 50,
        insertionPosition: "second",
      });

      const result = addWindow(state, {
        appId: "profile",
        props: { npub: "test" },
      });

      const workspace = result.workspaces["test-workspace"];
      expect(workspace.windowIds).toHaveLength(1);
      expect(workspace.layout).toBe(workspace.windowIds[0]); // Single window = leaf node
      expect(result.windows[workspace.windowIds[0]]).toEqual({
        id: workspace.windowIds[0],
        appId: "profile",
        customTitle: undefined,
        props: { npub: "test" },
        commandString: undefined,
      });
    });

    it("should create first window with column config", () => {
      const state = createTestState({
        insertionMode: "column",
        splitPercentage: 50,
        insertionPosition: "second",
      });

      const result = addWindow(state, {
        appId: "nip",
        props: { number: "01" },
      });

      const workspace = result.workspaces["test-workspace"];
      expect(workspace.windowIds).toHaveLength(1);
      expect(workspace.layout).toBe(workspace.windowIds[0]);
    });

    it("should create first window with smart config", () => {
      const state = createTestState({
        insertionMode: "smart",
        splitPercentage: 50,
        insertionPosition: "second",
      });

      const result = addWindow(state, {
        appId: "kinds",
        props: {},
      });

      const workspace = result.workspaces["test-workspace"];
      expect(workspace.windowIds).toHaveLength(1);
      expect(workspace.layout).toBe(workspace.windowIds[0]);
    });
  });

  describe("second window with row config", () => {
    it("should create horizontal split", () => {
      const state = createTestState(
        {
          insertionMode: "row",
          splitPercentage: 50,
          insertionPosition: "second",
        },
        "window-1",
      );
      state.windows["window-1"] = {
        id: "window-1",
        appId: "profile",
        props: {},
      };
      state.workspaces["test-workspace"].windowIds = ["window-1"];

      const result = addWindow(state, {
        appId: "nip",
        props: { number: "01" },
      });

      const workspace = result.workspaces["test-workspace"];
      expect(workspace.windowIds).toHaveLength(2);
      expect(workspace.layout).toMatchObject({
        direction: "row",
        splitPercentage: 50,
      });
    });

    it("should respect custom split percentage", () => {
      const state = createTestState(
        {
          insertionMode: "row",
          splitPercentage: 70,
          insertionPosition: "second",
        },
        "window-1",
      );
      state.windows["window-1"] = {
        id: "window-1",
        appId: "profile",
        props: {},
      };
      state.workspaces["test-workspace"].windowIds = ["window-1"];

      const result = addWindow(state, {
        appId: "nip",
        props: { number: "01" },
      });

      const workspace = result.workspaces["test-workspace"];
      expect(workspace.layout).toMatchObject({
        direction: "row",
        splitPercentage: 70,
      });
    });

    it("should place new window on right when position is second", () => {
      const state = createTestState(
        {
          insertionMode: "row",
          splitPercentage: 50,
          insertionPosition: "second",
        },
        "window-1",
      );
      state.windows["window-1"] = {
        id: "window-1",
        appId: "profile",
        props: {},
      };
      state.workspaces["test-workspace"].windowIds = ["window-1"];

      const result = addWindow(state, {
        appId: "nip",
        props: { number: "01" },
      });

      const workspace = result.workspaces["test-workspace"];
      const layout = workspace.layout as any;
      expect(layout.first).toBe("window-1");
      expect(layout.second).toBe(workspace.windowIds[1]);
    });

    it("should place new window on left when position is first", () => {
      const state = createTestState(
        {
          insertionMode: "row",
          splitPercentage: 50,
          insertionPosition: "first",
        },
        "window-1",
      );
      state.windows["window-1"] = {
        id: "window-1",
        appId: "profile",
        props: {},
      };
      state.workspaces["test-workspace"].windowIds = ["window-1"];

      const result = addWindow(state, {
        appId: "nip",
        props: { number: "01" },
      });

      const workspace = result.workspaces["test-workspace"];
      const layout = workspace.layout as any;
      expect(layout.first).toBe(workspace.windowIds[1]); // New window
      expect(layout.second).toBe("window-1"); // Old window
    });
  });

  describe("second window with column config", () => {
    it("should create vertical split", () => {
      const state = createTestState(
        {
          insertionMode: "column",
          splitPercentage: 50,
          insertionPosition: "second",
        },
        "window-1",
      );
      state.windows["window-1"] = {
        id: "window-1",
        appId: "profile",
        props: {},
      };
      state.workspaces["test-workspace"].windowIds = ["window-1"];

      const result = addWindow(state, {
        appId: "nip",
        props: { number: "01" },
      });

      const workspace = result.workspaces["test-workspace"];
      expect(workspace.windowIds).toHaveLength(2);
      expect(workspace.layout).toMatchObject({
        direction: "column",
        splitPercentage: 50,
      });
    });

    it("should place new window on bottom when position is second", () => {
      const state = createTestState(
        {
          insertionMode: "column",
          splitPercentage: 50,
          insertionPosition: "second",
        },
        "window-1",
      );
      state.windows["window-1"] = {
        id: "window-1",
        appId: "profile",
        props: {},
      };
      state.workspaces["test-workspace"].windowIds = ["window-1"];

      const result = addWindow(state, {
        appId: "nip",
        props: { number: "01" },
      });

      const workspace = result.workspaces["test-workspace"];
      const layout = workspace.layout as any;
      expect(layout.first).toBe("window-1");
      expect(layout.second).toBe(workspace.windowIds[1]);
    });

    it("should place new window on top when position is first", () => {
      const state = createTestState(
        {
          insertionMode: "column",
          splitPercentage: 50,
          insertionPosition: "first",
        },
        "window-1",
      );
      state.windows["window-1"] = {
        id: "window-1",
        appId: "profile",
        props: {},
      };
      state.workspaces["test-workspace"].windowIds = ["window-1"];

      const result = addWindow(state, {
        appId: "nip",
        props: { number: "01" },
      });

      const workspace = result.workspaces["test-workspace"];
      const layout = workspace.layout as any;
      expect(layout.first).toBe(workspace.windowIds[1]); // New window
      expect(layout.second).toBe("window-1"); // Old window
    });
  });

  describe("second window with smart config", () => {
    it("should create horizontal split for first split", () => {
      const state = createTestState(
        {
          insertionMode: "smart",
          splitPercentage: 50,
          insertionPosition: "second",
        },
        "window-1",
      );
      state.windows["window-1"] = {
        id: "window-1",
        appId: "profile",
        props: {},
      };
      state.workspaces["test-workspace"].windowIds = ["window-1"];

      const result = addWindow(state, {
        appId: "nip",
        props: { number: "01" },
      });

      const workspace = result.workspaces["test-workspace"];
      expect(workspace.layout).toMatchObject({
        direction: "row", // Smart defaults to row for first split
      });
    });
  });

  describe("third window with smart config", () => {
    it("should balance by adding vertical split when horizontal exists", () => {
      // Start with horizontal split (window-1 | window-2)
      const existingLayout: MosaicNode<string> = {
        direction: "row",
        first: "window-1",
        second: "window-2",
        splitPercentage: 50,
      };
      const state = createTestState(
        {
          insertionMode: "smart",
          splitPercentage: 50,
          insertionPosition: "second",
        },
        existingLayout,
      );
      state.windows["window-1"] = {
        id: "window-1",
        appId: "profile",
        props: {},
      };
      state.windows["window-2"] = { id: "window-2", appId: "nip", props: {} };
      state.workspaces["test-workspace"].windowIds = ["window-1", "window-2"];

      const result = addWindow(state, {
        appId: "kinds",
        props: {},
      });

      const workspace = result.workspaces["test-workspace"];
      // NEW BEHAVIOR: Splits shallowest leaf (window-1 or window-2 at depth 1)
      // Root remains row, but creates column split at the leaf
      expect(workspace.layout).toMatchObject({
        direction: "row",
      });
      // The first child should now be a column split containing the original window and new window
      const layout = workspace.layout as any;
      expect(layout.first).toHaveProperty("direction", "column");
    });

    it("should balance by adding horizontal split when vertical exists", () => {
      // Start with vertical split (window-1 / window-2)
      const existingLayout: MosaicNode<string> = {
        direction: "column",
        first: "window-1",
        second: "window-2",
        splitPercentage: 50,
      };
      const state = createTestState(
        {
          insertionMode: "smart",
          splitPercentage: 50,
          insertionPosition: "second",
        },
        existingLayout,
      );
      state.windows["window-1"] = {
        id: "window-1",
        appId: "profile",
        props: {},
      };
      state.windows["window-2"] = { id: "window-2", appId: "nip", props: {} };
      state.workspaces["test-workspace"].windowIds = ["window-1", "window-2"];

      const result = addWindow(state, {
        appId: "kinds",
        props: {},
      });

      const workspace = result.workspaces["test-workspace"];
      // NEW BEHAVIOR: Splits shallowest leaf (window-1 or window-2 at depth 1)
      // Root remains column, but creates row split at the leaf
      expect(workspace.layout).toMatchObject({
        direction: "column",
      });
      // The first child should now be a row split containing the original window and new window
      const layout = workspace.layout as any;
      expect(layout.first).toHaveProperty("direction", "row");
    });
  });

  describe("window metadata", () => {
    it("should store commandString when provided", () => {
      const state = createTestState({
        insertionMode: "row",
        splitPercentage: 50,
        insertionPosition: "second",
      });

      const result = addWindow(state, {
        appId: "profile",
        props: { npub: "test" },
        commandString: "profile alice@nostr.com",
      });

      const workspace = result.workspaces["test-workspace"];
      const window = result.windows[workspace.windowIds[0]];
      expect(window.commandString).toBe("profile alice@nostr.com");
    });

    it("should store customTitle when provided", () => {
      const state = createTestState({
        insertionMode: "row",
        splitPercentage: 50,
        insertionPosition: "second",
      });

      const result = addWindow(state, {
        appId: "profile",
        props: { npub: "test" },
        customTitle: "Alice Profile",
      });

      const workspace = result.workspaces["test-workspace"];
      const window = result.windows[workspace.windowIds[0]];
      expect(window.customTitle).toBe("Alice Profile");
    });

    it("should store both commandString and customTitle", () => {
      const state = createTestState({
        insertionMode: "row",
        splitPercentage: 50,
        insertionPosition: "second",
      });

      const result = addWindow(state, {
        appId: "profile",
        props: { npub: "test" },
        commandString: "profile alice@nostr.com",
        customTitle: "Alice",
      });

      const workspace = result.workspaces["test-workspace"];
      const window = result.windows[workspace.windowIds[0]];
      expect(window.commandString).toBe("profile alice@nostr.com");
      expect(window.customTitle).toBe("Alice");
    });
  });

  describe("global windows object", () => {
    it("should add window to global windows object", () => {
      const state = createTestState({
        insertionMode: "row",
        splitPercentage: 50,
        insertionPosition: "second",
      });

      const result = addWindow(state, {
        appId: "profile",
        props: { npub: "test" },
      });

      const workspace = result.workspaces["test-workspace"];
      const windowId = workspace.windowIds[0];
      expect(result.windows[windowId]).toBeDefined();
      expect(result.windows[windowId].appId).toBe("profile");
    });

    it("should preserve existing windows when adding new one", () => {
      const state = createTestState(
        {
          insertionMode: "row",
          splitPercentage: 50,
          insertionPosition: "second",
        },
        "window-1",
      );
      state.windows["window-1"] = {
        id: "window-1",
        appId: "profile",
        props: {},
      };
      state.workspaces["test-workspace"].windowIds = ["window-1"];

      const result = addWindow(state, {
        appId: "nip",
        props: { number: "01" },
      });

      expect(result.windows["window-1"]).toBeDefined();
      expect(Object.keys(result.windows)).toHaveLength(2);
    });
  });
});
