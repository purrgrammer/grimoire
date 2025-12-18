import { describe, it, expect } from "vitest";
import type { MosaicNode } from "react-mosaic-component";
import {
  analyzeLayoutStats,
  calculateSmartDirection,
  insertWindow,
  type LayoutStats,
} from "./layout-utils";
import type { LayoutConfig } from "@/types/app";

describe("analyzeLayoutStats", () => {
  describe("empty and single window layouts", () => {
    it("should return zeros for null layout", () => {
      const result = analyzeLayoutStats(null);
      expect(result).toEqual({
        rowSplits: 0,
        columnSplits: 0,
        depth: 0,
        windowCount: 0,
      });
    });

    it("should return single window stats for leaf node", () => {
      const result = analyzeLayoutStats("window-1");
      expect(result).toEqual({
        rowSplits: 0,
        columnSplits: 0,
        depth: 0,
        windowCount: 1,
      });
    });
  });

  describe("horizontal splits", () => {
    it("should count single horizontal split", () => {
      const layout: MosaicNode<string> = {
        direction: "row",
        first: "window-1",
        second: "window-2",
        splitPercentage: 50,
      };
      const result = analyzeLayoutStats(layout);
      expect(result).toEqual({
        rowSplits: 1,
        columnSplits: 0,
        depth: 1,
        windowCount: 2,
      });
    });

    it("should count nested horizontal splits", () => {
      const layout: MosaicNode<string> = {
        direction: "row",
        first: {
          direction: "row",
          first: "window-1",
          second: "window-2",
          splitPercentage: 50,
        },
        second: "window-3",
        splitPercentage: 50,
      };
      const result = analyzeLayoutStats(layout);
      expect(result).toEqual({
        rowSplits: 2,
        columnSplits: 0,
        depth: 2,
        windowCount: 3,
      });
    });
  });

  describe("vertical splits", () => {
    it("should count single vertical split", () => {
      const layout: MosaicNode<string> = {
        direction: "column",
        first: "window-1",
        second: "window-2",
        splitPercentage: 50,
      };
      const result = analyzeLayoutStats(layout);
      expect(result).toEqual({
        rowSplits: 0,
        columnSplits: 1,
        depth: 1,
        windowCount: 2,
      });
    });

    it("should count nested vertical splits", () => {
      const layout: MosaicNode<string> = {
        direction: "column",
        first: {
          direction: "column",
          first: "window-1",
          second: "window-2",
          splitPercentage: 50,
        },
        second: "window-3",
        splitPercentage: 50,
      };
      const result = analyzeLayoutStats(layout);
      expect(result).toEqual({
        rowSplits: 0,
        columnSplits: 2,
        depth: 2,
        windowCount: 3,
      });
    });
  });

  describe("mixed splits", () => {
    it("should count mixed horizontal and vertical splits", () => {
      const layout: MosaicNode<string> = {
        direction: "row",
        first: {
          direction: "column",
          first: "window-1",
          second: "window-2",
          splitPercentage: 50,
        },
        second: "window-3",
        splitPercentage: 50,
      };
      const result = analyzeLayoutStats(layout);
      expect(result).toEqual({
        rowSplits: 1,
        columnSplits: 1,
        depth: 2,
        windowCount: 3,
      });
    });

    it("should handle complex nested mixed splits", () => {
      // Layout: row split with column split on left and row split on right
      const layout: MosaicNode<string> = {
        direction: "row",
        first: {
          direction: "column",
          first: "window-1",
          second: "window-2",
          splitPercentage: 50,
        },
        second: {
          direction: "row",
          first: "window-3",
          second: "window-4",
          splitPercentage: 50,
        },
        splitPercentage: 50,
      };
      const result = analyzeLayoutStats(layout);
      expect(result).toEqual({
        rowSplits: 2,
        columnSplits: 1,
        depth: 2,
        windowCount: 4,
      });
    });

    it("should handle quad layout (2x2 grid)", () => {
      // Quad layout: row split, each side has column split
      const layout: MosaicNode<string> = {
        direction: "row",
        first: {
          direction: "column",
          first: "window-1",
          second: "window-2",
          splitPercentage: 50,
        },
        second: {
          direction: "column",
          first: "window-3",
          second: "window-4",
          splitPercentage: 50,
        },
        splitPercentage: 50,
      };
      const result = analyzeLayoutStats(layout);
      expect(result).toEqual({
        rowSplits: 1,
        columnSplits: 2,
        depth: 2,
        windowCount: 4,
      });
    });
  });

  describe("depth calculation", () => {
    it("should calculate correct depth for unbalanced tree", () => {
      // Deep on one side, shallow on other
      const layout: MosaicNode<string> = {
        direction: "row",
        first: {
          direction: "row",
          first: {
            direction: "row",
            first: "window-1",
            second: "window-2",
            splitPercentage: 50,
          },
          second: "window-3",
          splitPercentage: 50,
        },
        second: "window-4",
        splitPercentage: 50,
      };
      const result = analyzeLayoutStats(layout);
      expect(result.depth).toBe(3);
      expect(result.windowCount).toBe(4);
    });
  });
});

describe("calculateSmartDirection", () => {
  describe("null and empty layouts", () => {
    it("should default to row for null layout", () => {
      const result = calculateSmartDirection(null);
      expect(result).toBe("row");
    });

    it("should default to row for single window", () => {
      const result = calculateSmartDirection("window-1");
      expect(result).toBe("row");
    });
  });

  describe("balanced layouts", () => {
    it("should return row when splits are equal", () => {
      // 1 row split, 1 column split - equal, default to row
      const layout: MosaicNode<string> = {
        direction: "row",
        first: {
          direction: "column",
          first: "window-1",
          second: "window-2",
          splitPercentage: 50,
        },
        second: "window-3",
        splitPercentage: 50,
      };
      const result = calculateSmartDirection(layout);
      expect(result).toBe("row");
    });

    it("should return row when no splits exist yet", () => {
      // Just two windows with one split
      const layout: MosaicNode<string> = {
        direction: "row",
        first: "window-1",
        second: "window-2",
        splitPercentage: 50,
      };
      const result = calculateSmartDirection(layout);
      // 1 row split, 0 column splits -> row > column, should favor column
      expect(result).toBe("column");
    });
  });

  describe("unbalanced layouts", () => {
    it("should return column when more horizontal splits exist", () => {
      // 2 row splits, 0 column splits
      const layout: MosaicNode<string> = {
        direction: "row",
        first: {
          direction: "row",
          first: "window-1",
          second: "window-2",
          splitPercentage: 50,
        },
        second: "window-3",
        splitPercentage: 50,
      };
      const result = calculateSmartDirection(layout);
      expect(result).toBe("column");
    });

    it("should return row when more vertical splits exist", () => {
      // 0 row splits, 2 column splits
      const layout: MosaicNode<string> = {
        direction: "column",
        first: {
          direction: "column",
          first: "window-1",
          second: "window-2",
          splitPercentage: 50,
        },
        second: "window-3",
        splitPercentage: 50,
      };
      const result = calculateSmartDirection(layout);
      expect(result).toBe("row");
    });

    it("should favor column when significantly more horizontal splits", () => {
      // 5 row splits, 1 column split
      const layout: MosaicNode<string> = {
        direction: "row",
        first: {
          direction: "row",
          first: {
            direction: "row",
            first: {
              direction: "row",
              first: {
                direction: "row",
                first: "w1",
                second: "w2",
                splitPercentage: 50,
              },
              second: "w3",
              splitPercentage: 50,
            },
            second: "w4",
            splitPercentage: 50,
          },
          second: {
            direction: "column",
            first: "w5",
            second: "w6",
            splitPercentage: 50,
          },
          splitPercentage: 50,
        },
        second: "w7",
        splitPercentage: 50,
      };
      const result = calculateSmartDirection(layout);
      expect(result).toBe("column");
    });
  });
});

describe("insertWindow", () => {
  describe("first window insertion", () => {
    it("should return window ID for null layout", () => {
      const config: LayoutConfig = {
        insertionMode: "smart",
        splitPercentage: 50,
        insertionPosition: "second",
      };
      const result = insertWindow(null, "new-window", config);
      expect(result).toBe("new-window");
    });
  });

  describe("row mode insertion", () => {
    it("should create horizontal split in row mode", () => {
      const config: LayoutConfig = {
        insertionMode: "row",
        splitPercentage: 50,
        insertionPosition: "second",
      };
      const result = insertWindow("window-1", "window-2", config);
      expect(result).toEqual({
        direction: "row",
        first: "window-1",
        second: "window-2",
        splitPercentage: 50,
      });
    });

    it("should respect custom split percentage in row mode", () => {
      const config: LayoutConfig = {
        insertionMode: "row",
        splitPercentage: 70,
        insertionPosition: "second",
      };
      const result = insertWindow("window-1", "window-2", config);
      expect(result).toEqual({
        direction: "row",
        first: "window-1",
        second: "window-2",
        splitPercentage: 70,
      });
    });

    it("should place new window on left when position is first", () => {
      const config: LayoutConfig = {
        insertionMode: "row",
        splitPercentage: 50,
        insertionPosition: "first",
      };
      const result = insertWindow("window-1", "window-2", config);
      expect(result).toEqual({
        direction: "row",
        first: "window-2", // New window on left
        second: "window-1",
        splitPercentage: 50,
      });
    });
  });

  describe("column mode insertion", () => {
    it("should create vertical split in column mode", () => {
      const config: LayoutConfig = {
        insertionMode: "column",
        splitPercentage: 50,
        insertionPosition: "second",
      };
      const result = insertWindow("window-1", "window-2", config);
      expect(result).toEqual({
        direction: "column",
        first: "window-1",
        second: "window-2",
        splitPercentage: 50,
      });
    });

    it("should respect custom split percentage in column mode", () => {
      const config: LayoutConfig = {
        insertionMode: "column",
        splitPercentage: 30,
        insertionPosition: "second",
      };
      const result = insertWindow("window-1", "window-2", config);
      expect(result).toEqual({
        direction: "column",
        first: "window-1",
        second: "window-2",
        splitPercentage: 30,
      });
    });

    it("should place new window on top when position is first", () => {
      const config: LayoutConfig = {
        insertionMode: "column",
        splitPercentage: 50,
        insertionPosition: "first",
      };
      const result = insertWindow("window-1", "window-2", config);
      expect(result).toEqual({
        direction: "column",
        first: "window-2", // New window on top
        second: "window-1",
        splitPercentage: 50,
      });
    });
  });

  describe("smart mode insertion", () => {
    it("should use smart direction for single window", () => {
      const config: LayoutConfig = {
        insertionMode: "smart",
        splitPercentage: 50,
        insertionPosition: "second",
      };
      const result = insertWindow("window-1", "window-2", config);
      expect(result).toEqual({
        direction: "row", // Smart defaults to row for first split
        first: "window-1",
        second: "window-2",
        splitPercentage: 50,
      });
    });

    it("should balance horizontal splits by adding vertical", () => {
      // Existing layout: 2 horizontal splits
      const existingLayout: MosaicNode<string> = {
        direction: "row",
        first: {
          direction: "row",
          first: "window-1",
          second: "window-2",
          splitPercentage: 50,
        },
        second: "window-3",
        splitPercentage: 50,
      };
      const config: LayoutConfig = {
        insertionMode: "smart",
        splitPercentage: 50,
        insertionPosition: "second",
      };
      const result = insertWindow(existingLayout, "window-4", config);
      expect(result).toHaveProperty("direction", "column");
      expect(result).toHaveProperty("second", "window-4");
    });

    it("should balance vertical splits by adding horizontal", () => {
      // Existing layout: 2 vertical splits
      const existingLayout: MosaicNode<string> = {
        direction: "column",
        first: {
          direction: "column",
          first: "window-1",
          second: "window-2",
          splitPercentage: 50,
        },
        second: "window-3",
        splitPercentage: 50,
      };
      const config: LayoutConfig = {
        insertionMode: "smart",
        splitPercentage: 50,
        insertionPosition: "second",
      };
      const result = insertWindow(existingLayout, "window-4", config);
      expect(result).toHaveProperty("direction", "row");
      expect(result).toHaveProperty("second", "window-4");
    });
  });

  describe("complex layout insertion", () => {
    it("should handle insertion into complex nested layout", () => {
      // Quad layout (1 row, 2 column splits)
      const quadLayout: MosaicNode<string> = {
        direction: "row",
        first: {
          direction: "column",
          first: "window-1",
          second: "window-2",
          splitPercentage: 50,
        },
        second: {
          direction: "column",
          first: "window-3",
          second: "window-4",
          splitPercentage: 50,
        },
        splitPercentage: 50,
      };
      const config: LayoutConfig = {
        insertionMode: "smart",
        splitPercentage: 50,
        insertionPosition: "second",
      };
      const result = insertWindow(quadLayout, "window-5", config);
      // More column splits than row, should add row
      expect(result).toHaveProperty("direction", "row");
      expect(result).toHaveProperty("first", quadLayout);
      expect(result).toHaveProperty("second", "window-5");
    });
  });

  describe("split percentage edge cases", () => {
    it("should handle minimum split percentage", () => {
      const config: LayoutConfig = {
        insertionMode: "row",
        splitPercentage: 10,
        insertionPosition: "second",
      };
      const result = insertWindow("window-1", "window-2", config);
      expect(result).toHaveProperty("splitPercentage", 10);
    });

    it("should handle maximum split percentage", () => {
      const config: LayoutConfig = {
        insertionMode: "row",
        splitPercentage: 90,
        insertionPosition: "second",
      };
      const result = insertWindow("window-1", "window-2", config);
      expect(result).toHaveProperty("splitPercentage", 90);
    });
  });
});
