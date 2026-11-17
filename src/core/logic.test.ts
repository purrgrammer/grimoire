import { describe, it, expect } from "vitest";
import type { MosaicNode } from "react-mosaic-component";
import {
  findLowestAvailableWorkspaceNumber,
  addWindow,
  adoptWindow,
  addWindowAlongside,
  removeWindow,
  reorderWorkspaces,
  updateWindow,
} from "./logic";
import type { GrimoireState, LayoutConfig, WindowInstance } from "@/types/app";

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

describe("reorderWorkspaces", () => {
  const createTestState = (workspaces: Record<string, any>): GrimoireState => ({
    __version: 8,
    windows: {},
    activeWorkspaceId: "default",
    layoutConfig: {
      insertionMode: "smart",
      splitPercentage: 50,
      insertionPosition: "second",
    },
    workspaces: workspaces,
  });

  it("should reorder workspaces based on provided IDs", () => {
    const state = createTestState({
      w1: { id: "w1", number: 1 },
      w2: { id: "w2", number: 2 },
      w3: { id: "w3", number: 3 },
    });

    const result = reorderWorkspaces(state, ["w3", "w1", "w2"]);

    expect(result.workspaces["w3"].number).toBe(1);
    expect(result.workspaces["w1"].number).toBe(2);
    expect(result.workspaces["w2"].number).toBe(3);
  });

  it("should handle partial reordering by appending remaining workspaces", () => {
    const state = createTestState({
      w1: { id: "w1", number: 1 },
      w2: { id: "w2", number: 2 },
      w3: { id: "w3", number: 3 },
      w4: { id: "w4", number: 4 },
    });

    const result = reorderWorkspaces(state, ["w3", "w1"]);

    expect(result.workspaces["w3"].number).toBe(1);
    expect(result.workspaces["w1"].number).toBe(2);
    // Remaining should be sorted by original number (w2, w4)
    expect(result.workspaces["w2"].number).toBe(3);
    expect(result.workspaces["w4"].number).toBe(4);
  });

  it("should ignore invalid IDs", () => {
    const state = createTestState({
      w1: { id: "w1", number: 1 },
      w2: { id: "w2", number: 2 },
    });

    const result = reorderWorkspaces(state, ["w2", "w1", "invalid"]);

    expect(result.workspaces["w2"].number).toBe(1);
    expect(result.workspaces["w1"].number).toBe(2);
  });
});

describe("updateWindow", () => {
  const stateWith = (windows: GrimoireState["windows"]): GrimoireState => ({
    __version: 8,
    windows,
    activeWorkspaceId: "ws",
    layoutConfig: {
      insertionMode: "smart",
      splitPercentage: 50,
      insertionPosition: "second",
    },
    workspaces: {
      ws: {
        id: "ws",
        number: 1,
        windowIds: Object.keys(windows),
        layout: null,
      },
    },
  });

  const window = (id: string, props: Record<string, unknown>) => ({
    id,
    appId: "concord" as const,
    props,
  });

  it("REPLACES props wholesale rather than merging them", () => {
    // The contract every caller has to compensate for: an update that names
    // `props` without spreading the old ones drops whatever it did not mention.
    // `buildConcordWindowUpdate` exists because of this line.
    const state = stateWith({
      a: window("a", { communityId: "aa", channelId: "bb", view: "compact" }),
    });

    const result = updateWindow(state, "a", { props: { communityId: "cc" } });

    expect(result.windows["a"].props).toEqual({ communityId: "cc" });
  });

  it("keeps the fields the update did not name", () => {
    const state = stateWith({ a: window("a", { communityId: "aa" }) });
    const result = updateWindow(state, "a", { commandString: "concord aa" });
    expect(result.windows["a"].props).toEqual({ communityId: "aa" });
    expect(result.windows["a"].appId).toBe("concord");
  });

  it("leaves every other window alone", () => {
    const state = stateWith({
      a: window("a", { communityId: "aa" }),
      b: window("b", { communityId: "bb" }),
    });

    const result = updateWindow(state, "a", { props: { communityId: "cc" } });

    expect(result.windows["b"]).toBe(state.windows["b"]);
    expect(result.workspaces).toBe(state.workspaces);
  });

  it("is a no-op for a window that is not there", () => {
    const state = stateWith({ a: window("a", { communityId: "aa" }) });
    expect(updateWindow(state, "gone", { props: {} })).toBe(state);
  });
});

describe("adoptWindow / addWindowAlongside (single-window routes, #313)", () => {
  const ROW: LayoutConfig = {
    insertionMode: "row",
    splitPercentage: 50,
    insertionPosition: "second",
  };

  // A persisted dashboard with two windows already laid out side by side, and
  // a second workspace holding a third.
  const existingLayout: MosaicNode<string> = {
    direction: "column",
    first: "w-a",
    second: "w-b",
    splitPercentage: 30,
  };
  const persisted = (): GrimoireState => ({
    __version: 8,
    windows: {
      "w-a": { id: "w-a", appId: "man", props: { cmd: "req" } },
      "w-b": { id: "w-b", appId: "nip", props: { number: "01" } },
      "w-c": { id: "w-c", appId: "kind", props: { number: "1" } },
    },
    activeWorkspaceId: "ws-1",
    layoutConfig: ROW,
    workspaces: {
      "ws-1": {
        id: "ws-1",
        number: 1,
        windowIds: ["w-a", "w-b"],
        layout: existingLayout,
      },
      "ws-2": { id: "ws-2", number: 2, windowIds: ["w-c"], layout: "w-c" },
    },
  });

  const runWindow: WindowInstance = {
    id: "pop-out:man kind",
    appId: "man",
    props: { cmd: "kind" },
    commandString: "man kind",
  };
  const requested = {
    id: "new-window",
    appId: "nip",
    props: { number: "19" },
    commandString: "nip 19",
  };

  it("keeps every existing window and the existing layout as a subtree", () => {
    const before = persisted();
    const next = addWindowAlongside(before, runWindow, requested);
    const ws = next.workspaces["ws-1"];

    expect(ws.windowIds).toEqual(["w-a", "w-b", runWindow.id, "new-window"]);
    // Row insertion wraps the previous tree whole: nothing in it was touched.
    expect(ws.layout).toEqual({
      direction: "row",
      first: {
        direction: "row",
        first: existingLayout,
        second: runWindow.id,
        splitPercentage: 50,
      },
      second: "new-window",
      splitPercentage: 50,
    });
    expect(next.windows["w-a"]).toBe(before.windows["w-a"]);
    expect(next.windows["w-b"]).toBe(before.windows["w-b"]);
    // The other workspace is not touched at all.
    expect(next.workspaces["ws-2"]).toBe(before.workspaces["ws-2"]);
    expect(next.activeWorkspaceId).toBe("ws-1");
  });

  it("keeps the run window's id, so state keyed by it carries over", () => {
    const next = addWindowAlongside(persisted(), runWindow, requested);
    expect(next.windows[runWindow.id]).toEqual(runWindow);
    expect(next.windows["new-window"]).toMatchObject({
      appId: "nip",
      props: { number: "19" },
      commandString: "nip 19",
    });
  });

  it("does not add the run window twice when it is already in the workspace", () => {
    const once = addWindowAlongside(persisted(), runWindow, requested);
    const twice = addWindowAlongside(once, runWindow, {
      ...requested,
      id: "another-window",
    });
    const ids = twice.workspaces["ws-1"].windowIds;
    expect(ids.filter((id) => id === runWindow.id)).toHaveLength(1);
    expect(ids).toEqual([
      "w-a",
      "w-b",
      runWindow.id,
      "new-window",
      "another-window",
    ]);
    expect(adoptWindow(once, runWindow)).toBe(once);
  });

  it("moves the run window out of another workspace rather than duplicating it", () => {
    const elsewhere = addWindowAlongside(
      { ...persisted(), activeWorkspaceId: "ws-2" },
      { ...runWindow, customTitle: "renamed" },
      requested,
    );
    const back = adoptWindow(
      { ...elsewhere, activeWorkspaceId: "ws-1" },
      runWindow,
    );
    expect(back.workspaces["ws-2"].windowIds).toEqual(["w-c", "new-window"]);
    expect(back.workspaces["ws-1"].windowIds).toContain(runWindow.id);
    // The placed record (with its edits) wins over the standalone copy.
    expect(back.windows[runWindow.id].customTitle).toBe("renamed");
  });

  describe("popped out of a workspace window (sourceId)", () => {
    // `w-a` is `man req` on the dashboard; its pop-out tab shows the same
    // window under a command-derived id.
    const popped: WindowInstance = {
      id: "pop-out:man req",
      appId: "man",
      props: { cmd: "req" },
      commandString: "man req",
    };

    it("adds only the requested window while the source is on screen", () => {
      const next = addWindowAlongside(persisted(), popped, requested, "w-a");
      expect(next.workspaces["ws-1"].windowIds).toEqual([
        "w-a",
        "w-b",
        "new-window",
      ]);
      expect(next.windows[popped.id]).toBeUndefined();
    });

    it("adopts the copy when the source was closed meanwhile", () => {
      const next = addWindowAlongside(persisted(), popped, requested, "gone");
      expect(next.workspaces["ws-1"].windowIds).toEqual([
        "w-a",
        "w-b",
        popped.id,
        "new-window",
      ]);
    });

    it("adopts the copy when the source sits in another workspace", () => {
      const next = addWindowAlongside(persisted(), popped, requested, "w-c");
      expect(next.workspaces["ws-1"].windowIds).toContain(popped.id);
      // The user's window in the other workspace is left where it is.
      expect(next.workspaces["ws-2"].windowIds).toEqual(["w-c"]);
    });

    it("does not trust a source id that names a different app", () => {
      const next = addWindowAlongside(persisted(), popped, requested, "w-b");
      expect(next.workspaces["ws-1"].windowIds).toContain(popped.id);
    });

    it("never matches by command: a same-command window without a source stays separate", () => {
      const sameCommand = {
        ...persisted(),
        windows: {
          ...persisted().windows,
          "w-a": { ...persisted().windows["w-a"], commandString: "man req" },
        },
      };
      const next = addWindowAlongside(sameCommand, popped, requested);
      expect(next.workspaces["ws-1"].windowIds).toEqual([
        "w-a",
        "w-b",
        popped.id,
        "new-window",
      ]);
    });
  });

  it("replaces a stale record no workspace places", () => {
    const stale = {
      ...persisted(),
      windows: {
        ...persisted().windows,
        [runWindow.id]: { ...runWindow, props: { cmd: "stale" } },
      },
    };
    const next = adoptWindow(stale, runWindow);
    expect(next.windows[runWindow.id]).toEqual(runWindow);
  });

  it("adds only the requested window when there is no run window", () => {
    const next = addWindowAlongside(persisted(), null, requested);
    expect(next.workspaces["ws-1"].windowIds).toEqual([
      "w-a",
      "w-b",
      "new-window",
    ]);
  });

  it("lands in an empty dashboard as the two windows side by side", () => {
    const empty: GrimoireState = {
      ...persisted(),
      windows: {},
      workspaces: {
        "ws-1": { id: "ws-1", number: 1, windowIds: [], layout: null },
      },
    };
    const next = addWindowAlongside(empty, runWindow, requested);
    expect(next.workspaces["ws-1"].layout).toEqual({
      direction: "row",
      first: runWindow.id,
      second: "new-window",
      splitPercentage: 50,
    });
  });

  it("leaves a closed run window closed for good", () => {
    const opened = addWindowAlongside(persisted(), runWindow, requested);
    const closed = removeWindow(opened, runWindow.id);
    expect(closed.windows[runWindow.id]).toBeUndefined();
    expect(closed.workspaces["ws-1"].windowIds).not.toContain(runWindow.id);
  });
});

describe("addWindow with a caller-supplied id", () => {
  it("uses the id instead of minting one", () => {
    const state: GrimoireState = {
      __version: 8,
      windows: {},
      activeWorkspaceId: "ws",
      layoutConfig: {
        insertionMode: "row",
        splitPercentage: 50,
        insertionPosition: "second",
      },
      workspaces: { ws: { id: "ws", number: 1, windowIds: [], layout: null } },
    };
    const next = addWindow(state, { id: "chosen", appId: "nip", props: {} });
    expect(next.workspaces.ws.windowIds).toEqual(["chosen"]);
    expect(next.windows.chosen.id).toBe("chosen");
  });
});
