import { describe, it, expect } from "vitest";
import {
  collectWindowIds,
  applyPresetToLayout,
  BUILT_IN_PRESETS,
} from "./layout-presets";
import type { MosaicNode } from "react-mosaic-component";

describe("layout-presets", () => {
  describe("collectWindowIds", () => {
    it("collects IDs from single window", () => {
      expect(collectWindowIds("w1")).toEqual(["w1"]);
    });

    it("collects IDs from binary tree", () => {
      const layout: MosaicNode<string> = {
        direction: "row",
        first: "w1",
        second: "w2",
        splitPercentage: 50,
      };
      expect(collectWindowIds(layout)).toEqual(["w1", "w2"]);
    });

    it("collects IDs in depth-first order", () => {
      const layout: MosaicNode<string> = {
        direction: "row",
        first: {
          direction: "column",
          first: "w1",
          second: "w2",
          splitPercentage: 50,
        },
        second: {
          direction: "column",
          first: "w3",
          second: "w4",
          splitPercentage: 50,
        },
        splitPercentage: 50,
      };
      expect(collectWindowIds(layout)).toEqual(["w1", "w2", "w3", "w4"]);
    });
  });

  describe("grid preset", () => {
    const gridPreset = BUILT_IN_PRESETS.grid;

    it("handles 2 windows (1x2 grid)", () => {
      const layout = gridPreset.generate(["w1", "w2"]);
      const windowIds = collectWindowIds(layout);
      expect(windowIds).toEqual(["w1", "w2"]);
      expect(windowIds.length).toBe(2);
    });

    it("handles 3 windows (1x3 single row)", () => {
      const layout = gridPreset.generate(["w1", "w2", "w3"]);
      const windowIds = collectWindowIds(layout);
      expect(windowIds).toEqual(["w1", "w2", "w3"]);
      expect(windowIds.length).toBe(3);
    });

    it("handles 4 windows (2x2 perfect grid)", () => {
      const layout = gridPreset.generate(["w1", "w2", "w3", "w4"]);
      const windowIds = collectWindowIds(layout);
      expect(windowIds).toEqual(["w1", "w2", "w3", "w4"]);
      expect(windowIds.length).toBe(4);
    });

    it("handles 5 windows (2x3 with expanded last row)", () => {
      const layout = gridPreset.generate(["w1", "w2", "w3", "w4", "w5"]);
      const windowIds = collectWindowIds(layout);
      expect(windowIds).toEqual(["w1", "w2", "w3", "w4", "w5"]);
      expect(windowIds.length).toBe(5);
      // Should create 2 rows: [w1,w2,w3] and [w4,w5]
      // Last row windows expand to fill space (no empty slots)
    });

    it("handles 7 windows (2x4 with expanded last row)", () => {
      const layout = gridPreset.generate([
        "w1",
        "w2",
        "w3",
        "w4",
        "w5",
        "w6",
        "w7",
      ]);
      const windowIds = collectWindowIds(layout);
      expect(windowIds).toEqual(["w1", "w2", "w3", "w4", "w5", "w6", "w7"]);
      expect(windowIds.length).toBe(7);
      // Should create 2 rows: [w1,w2,w3,w4] and [w5,w6,w7]
    });

    it("handles 9 windows (3x3 perfect grid)", () => {
      const layout = gridPreset.generate([
        "w1",
        "w2",
        "w3",
        "w4",
        "w5",
        "w6",
        "w7",
        "w8",
        "w9",
      ]);
      const windowIds = collectWindowIds(layout);
      expect(windowIds.length).toBe(9);
    });

    it("handles 11 windows (3x4 with expanded last row)", () => {
      const layout = gridPreset.generate([
        "w1",
        "w2",
        "w3",
        "w4",
        "w5",
        "w6",
        "w7",
        "w8",
        "w9",
        "w10",
        "w11",
      ]);
      const windowIds = collectWindowIds(layout);
      expect(windowIds.length).toBe(11);
      // Should create 3 rows: [w1-4], [w5-8], [w9-11]
    });

    it("preserves window order in depth-first traversal", () => {
      const original = ["a", "b", "c", "d", "e"];
      const layout = gridPreset.generate(original);
      const collected = collectWindowIds(layout);
      expect(collected).toEqual(original);
    });
  });

  describe("side-by-side preset", () => {
    const sideBySidePreset = BUILT_IN_PRESETS["side-by-side"];

    it("handles 2 windows (50/50)", () => {
      const layout = sideBySidePreset.generate(["w1", "w2"]);
      const windowIds = collectWindowIds(layout);
      expect(windowIds).toEqual(["w1", "w2"]);
    });

    it("handles 3 windows (equal splits)", () => {
      const layout = sideBySidePreset.generate(["w1", "w2", "w3"]);
      const windowIds = collectWindowIds(layout);
      expect(windowIds).toEqual(["w1", "w2", "w3"]);
    });

    it("handles 4 windows (max allowed)", () => {
      const layout = sideBySidePreset.generate(["w1", "w2", "w3", "w4"]);
      const windowIds = collectWindowIds(layout);
      expect(windowIds).toEqual(["w1", "w2", "w3", "w4"]);
    });

    it("throws error for 5+ windows", () => {
      expect(() =>
        sideBySidePreset.generate(["w1", "w2", "w3", "w4", "w5"])
      ).toThrow("maximum 4 windows");
    });
  });

  describe("main-sidebar preset", () => {
    const mainSidebarPreset = BUILT_IN_PRESETS["main-sidebar"];

    it("handles 2 windows (main + 1 sidebar)", () => {
      const layout = mainSidebarPreset.generate(["w1", "w2"]);
      const windowIds = collectWindowIds(layout);
      expect(windowIds).toEqual(["w1", "w2"]);
    });

    it("handles 5 windows (main + 4 sidebars)", () => {
      const layout = mainSidebarPreset.generate([
        "w1",
        "w2",
        "w3",
        "w4",
        "w5",
      ]);
      const windowIds = collectWindowIds(layout);
      expect(windowIds).toEqual(["w1", "w2", "w3", "w4", "w5"]);
      // First window is main, rest are stacked vertically
    });

    it("handles 10 windows (main + 9 sidebars)", () => {
      const windows = Array.from({ length: 10 }, (_, i) => `w${i + 1}`);
      const layout = mainSidebarPreset.generate(windows);
      const windowIds = collectWindowIds(layout);
      expect(windowIds).toEqual(windows);
    });
  });

  describe("applyPresetToLayout", () => {
    it("throws error if too few windows", () => {
      const layout: MosaicNode<string> = "w1";
      expect(() =>
        applyPresetToLayout(layout, BUILT_IN_PRESETS.grid)
      ).toThrow("at least 2 windows");
    });

    it("throws error if too many windows for side-by-side", () => {
      const layout: MosaicNode<string> = {
        direction: "row",
        first: {
          direction: "row",
          first: "w1",
          second: "w2",
          splitPercentage: 50,
        },
        second: {
          direction: "row",
          first: {
            direction: "row",
            first: "w3",
            second: "w4",
            splitPercentage: 50,
          },
          second: "w5",
          splitPercentage: 50,
        },
        splitPercentage: 50,
      };
      expect(() =>
        applyPresetToLayout(layout, BUILT_IN_PRESETS["side-by-side"])
      ).toThrow("maximum 4 windows");
    });

    it("applies grid preset to existing layout", () => {
      const existingLayout: MosaicNode<string> = {
        direction: "row",
        first: "w1",
        second: "w2",
        splitPercentage: 50,
      };
      const result = applyPresetToLayout(existingLayout, BUILT_IN_PRESETS.grid);
      const windowIds = collectWindowIds(result);
      expect(windowIds).toEqual(["w1", "w2"]);
    });

    it("preserves all windows when applying preset", () => {
      const originalWindows = ["w1", "w2", "w3", "w4", "w5", "w6", "w7"];
      // Create a simple layout
      let layout: MosaicNode<string> = originalWindows[0];
      for (let i = 1; i < originalWindows.length; i++) {
        layout = {
          direction: "row",
          first: layout,
          second: originalWindows[i],
          splitPercentage: 50,
        };
      }

      const result = applyPresetToLayout(layout, BUILT_IN_PRESETS.grid);
      const windowIds = collectWindowIds(result);
      expect(windowIds).toEqual(originalWindows);
    });
  });
});
