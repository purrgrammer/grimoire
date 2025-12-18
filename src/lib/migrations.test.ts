import { describe, it, expect } from "vitest";
import { migrateState, validateState, CURRENT_VERSION } from "./migrations";

describe("migrations", () => {
  describe("v6 to v8 migration (v6→v7→v8)", () => {
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

      // Should migrate to v8
      expect(migrated.__version).toBe(CURRENT_VERSION);

      // v6→v7: numeric labels converted to number
      expect(migrated.workspaces.ws1.number).toBe(1);
      expect(migrated.workspaces.ws1.label).toBeUndefined();
      expect(migrated.workspaces.ws2.number).toBe(2);
      expect(migrated.workspaces.ws2.label).toBeUndefined();

      // v7→v8: global layoutConfig added
      expect(migrated.layoutConfig).toEqual({
        insertionMode: "smart",
        splitPercentage: 50,
        insertionPosition: "second",
        autoPreset: undefined,
      });
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

      // v7→v8: global layoutConfig added
      expect(migrated.layoutConfig).toBeDefined();
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

      // v7→v8: global layoutConfig added
      expect(migrated.layoutConfig).toBeDefined();
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
