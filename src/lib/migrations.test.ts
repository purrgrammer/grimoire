import { describe, it, expect } from "vitest";
import { migrateState, validateState, CURRENT_VERSION } from "./migrations";

describe("migrations", () => {
  describe("v6 to v9 migration (v6→v7→v8→v9)", () => {
    it("should convert numeric labels to number field and add global layoutConfig", () => {
      const oldState = {
        __version: 6,
        windows: {},
        activeWorkspaceId: "ws1",
        workspaces: {
          ws1: {
            id: "ws1",
            label: "1",
            layout: null,
            windowIds: [],
          },
          ws2: {
            id: "ws2",
            label: "2",
            layout: null,
            windowIds: [],
          },
        },
      };

      const migrated = migrateState(oldState);

      // Should migrate to v9
      expect(migrated.__version).toBe(CURRENT_VERSION);

      // v6→v7: numeric labels converted to number
      expect(migrated.workspaces.ws1.number).toBe(1);
      expect(migrated.workspaces.ws1.label).toBeUndefined();
      expect(migrated.workspaces.ws2.number).toBe(2);
      expect(migrated.workspaces.ws2.label).toBeUndefined();

      // v7→v8→v9: layoutConfig moved to global state
      expect(migrated.layoutConfig).toEqual({
        insertionMode: "smart",
        splitPercentage: 50,
        insertionPosition: "second",
        autoPreset: undefined,
      });
      // Workspaces should NOT have layoutConfig
      expect(migrated.workspaces.ws1.layoutConfig).toBeUndefined();
      expect(migrated.workspaces.ws2.layoutConfig).toBeUndefined();
    });

    it("should convert non-numeric labels to number with label and add global layoutConfig", () => {
      const oldState = {
        __version: 6,
        windows: {},
        activeWorkspaceId: "ws1",
        workspaces: {
          ws1: {
            id: "ws1",
            label: "Main",
            layout: null,
            windowIds: [],
          },
          ws2: {
            id: "ws2",
            label: "Development",
            layout: null,
            windowIds: [],
          },
        },
      };

      const migrated = migrateState(oldState);

      expect(migrated.__version).toBe(CURRENT_VERSION);

      // v6→v7: non-numeric labels preserved
      expect(migrated.workspaces.ws1.number).toBe(1);
      expect(migrated.workspaces.ws1.label).toBe("Main");
      expect(migrated.workspaces.ws2.number).toBe(2);
      expect(migrated.workspaces.ws2.label).toBe("Development");

      // v7→v8→v9: layoutConfig is global, not per-workspace
      expect(migrated.layoutConfig).toBeDefined();
      expect(migrated.workspaces.ws1.layoutConfig).toBeUndefined();
      expect(migrated.workspaces.ws2.layoutConfig).toBeUndefined();
    });

    it("should handle mixed numeric and text labels and add global layoutConfig", () => {
      const oldState = {
        __version: 6,
        windows: {},
        activeWorkspaceId: "ws1",
        workspaces: {
          ws1: {
            id: "ws1",
            label: "1",
            layout: null,
            windowIds: [],
          },
          ws2: {
            id: "ws2",
            label: "Main",
            layout: null,
            windowIds: [],
          },
          ws3: {
            id: "ws3",
            label: "3",
            layout: null,
            windowIds: [],
          },
        },
      };

      const migrated = migrateState(oldState);

      expect(migrated.__version).toBe(CURRENT_VERSION);

      // v6→v7: mixed labels handled correctly
      expect(migrated.workspaces.ws1.number).toBe(1);
      expect(migrated.workspaces.ws1.label).toBeUndefined();
      expect(migrated.workspaces.ws2.number).toBe(2);
      expect(migrated.workspaces.ws2.label).toBe("Main");
      expect(migrated.workspaces.ws3.number).toBe(3);
      expect(migrated.workspaces.ws3.label).toBeUndefined();

      // v7→v8→v9: layoutConfig is global
      expect(migrated.layoutConfig).toBeDefined();
      expect(migrated.workspaces.ws1.layoutConfig).toBeUndefined();
      expect(migrated.workspaces.ws2.layoutConfig).toBeUndefined();
      expect(migrated.workspaces.ws3.layoutConfig).toBeUndefined();
    });

    it("should validate migrated state", () => {
      const oldState = {
        __version: 6,
        windows: {},
        activeWorkspaceId: "ws1",
        workspaces: {
          ws1: {
            id: "ws1",
            label: "1",
            layout: null,
            windowIds: [],
          },
        },
      };

      const migrated = migrateState(oldState);
      expect(validateState(migrated)).toBe(true);
    });
  });

  describe("v8 to v9 migration", () => {
    it("should move layoutConfig from workspaces to global state", () => {
      const v8State = {
        __version: 8,
        windows: {
          w1: { id: "w1", appId: "profile", props: {} },
          w2: { id: "w2", appId: "nip", props: {} },
        },
        activeWorkspaceId: "ws1",
        workspaces: {
          ws1: {
            id: "ws1",
            number: 1,
            label: undefined,
            layout: null,
            windowIds: [],
            layoutConfig: {
              insertionMode: "smart",
              splitPercentage: 50,
              insertionPosition: "second",
              autoPreset: undefined,
            },
          },
          ws2: {
            id: "ws2",
            number: 2,
            label: "Development",
            layout: { direction: "row", first: "w1", second: "w2", splitPercentage: 50 },
            windowIds: ["w1", "w2"],
            layoutConfig: {
              insertionMode: "row",
              splitPercentage: 70,
              insertionPosition: "first",
              autoPreset: undefined,
            },
          },
        },
      };

      const migrated = migrateState(v8State);

      expect(migrated.__version).toBe(9);

      // layoutConfig should be at global level (from first workspace)
      expect(migrated.layoutConfig).toEqual({
        insertionMode: "smart",
        splitPercentage: 50,
        insertionPosition: "second",
        autoPreset: undefined,
      });

      // Workspaces should NOT have layoutConfig
      expect(migrated.workspaces.ws1.layoutConfig).toBeUndefined();
      expect(migrated.workspaces.ws2.layoutConfig).toBeUndefined();

      // Other fields should be preserved
      expect(migrated.workspaces.ws2.label).toBe("Development");
      expect(migrated.workspaces.ws2.layout).toEqual({
        direction: "row",
        first: "w1",
        second: "w2",
        splitPercentage: 50,
      });
    });

    it("should validate v8→v9 migrated state", () => {
      const v8State = {
        __version: 8,
        windows: { w1: { id: "w1", appId: "profile", props: {} } },
        activeWorkspaceId: "ws1",
        workspaces: {
          ws1: {
            id: "ws1",
            number: 1,
            layout: "w1",
            windowIds: ["w1"],
            layoutConfig: {
              insertionMode: "smart",
              splitPercentage: 50,
              insertionPosition: "second",
              autoPreset: undefined,
            },
          },
        },
      };

      const migrated = migrateState(v8State);
      expect(validateState(migrated)).toBe(true);
    });
  });

  describe("validateState", () => {
    it("should validate correct state structure", () => {
      const state = {
        __version: CURRENT_VERSION,
        windows: {},
        activeWorkspaceId: "default",
        layoutConfig: {
          insertionMode: "smart",
          splitPercentage: 50,
          insertionPosition: "second",
          autoPreset: undefined,
        },
        workspaces: {
          default: {
            id: "default",
            number: 1,
            layout: null,
            windowIds: [],
          },
        },
      };

      expect(validateState(state)).toBe(true);
    });

    it("should reject state without __version", () => {
      const state = {
        windows: {},
        activeWorkspaceId: "default",
        layoutConfig: {
          insertionMode: "smart",
          splitPercentage: 50,
          insertionPosition: "second",
        },
        workspaces: {
          default: {
            id: "default",
            number: 1,
            layout: null,
            windowIds: [],
          },
        },
      };

      expect(validateState(state)).toBe(false);
    });

    it("should reject state with missing workspaces", () => {
      const state = {
        __version: CURRENT_VERSION,
        windows: {},
        activeWorkspaceId: "default",
        layoutConfig: {
          insertionMode: "smart",
          splitPercentage: 50,
          insertionPosition: "second",
        },
      };

      expect(validateState(state)).toBe(false);
    });

    it("should reject state without layoutConfig", () => {
      const state = {
        __version: CURRENT_VERSION,
        windows: {},
        activeWorkspaceId: "default",
        workspaces: {
          default: {
            id: "default",
            number: 1,
            layout: null,
            windowIds: [],
          },
        },
      };

      expect(validateState(state)).toBe(false);
    });
  });
});
