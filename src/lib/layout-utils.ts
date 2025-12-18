import type { MosaicNode } from "react-mosaic-component";
import type { LayoutConfig } from "@/types/app";

/**
 * Statistics about the layout tree structure
 */
export interface LayoutStats {
  /** Number of horizontal splits in the tree */
  rowSplits: number;
  /** Number of vertical splits in the tree */
  columnSplits: number;
  /** Maximum depth of the tree */
  depth: number;
  /** Total number of windows (leaf nodes) */
  windowCount: number;
}

/**
 * Analyzes the layout tree and returns statistics
 * Used by smart direction algorithm to balance splits
 */
export function analyzeLayoutStats(
  node: MosaicNode<string> | null
): LayoutStats {
  if (node === null) {
    return { rowSplits: 0, columnSplits: 0, depth: 0, windowCount: 0 };
  }

  if (typeof node === "string") {
    // Leaf node (window ID)
    return { rowSplits: 0, columnSplits: 0, depth: 0, windowCount: 1 };
  }

  // Branch node - recursively analyze children
  const firstStats = analyzeLayoutStats(node.first);
  const secondStats = analyzeLayoutStats(node.second);

  return {
    rowSplits:
      firstStats.rowSplits +
      secondStats.rowSplits +
      (node.direction === "row" ? 1 : 0),
    columnSplits:
      firstStats.columnSplits +
      secondStats.columnSplits +
      (node.direction === "column" ? 1 : 0),
    depth: Math.max(firstStats.depth, secondStats.depth) + 1,
    windowCount: firstStats.windowCount + secondStats.windowCount,
  };
}

/**
 * Calculates the optimal split direction to balance the layout tree
 * Returns 'column' if there are more horizontal splits (to balance)
 * Returns 'row' if there are more vertical splits or equal (default to horizontal)
 */
export function calculateSmartDirection(
  layout: MosaicNode<string> | null
): "row" | "column" {
  if (layout === null) {
    return "row"; // Default to horizontal for first split
  }

  const stats = analyzeLayoutStats(layout);

  // If more horizontal splits, add vertical to balance
  if (stats.rowSplits > stats.columnSplits) {
    return "column";
  }

  // Otherwise, default to horizontal (including when equal)
  return "row";
}

/**
 * Inserts a new window into the layout tree according to the layout configuration
 *
 * @param currentLayout - The current layout tree (null if no windows yet)
 * @param newWindowId - The ID of the new window to insert
 * @param config - Layout configuration specifying how to insert the window
 * @returns The new layout tree with the window inserted
 */
export function insertWindow(
  currentLayout: MosaicNode<string> | null,
  newWindowId: string,
  config: LayoutConfig
): MosaicNode<string> {
  // First window - just return the window ID as leaf node
  if (currentLayout === null) {
    return newWindowId;
  }

  // Determine split direction based on insertion mode
  let direction: "row" | "column";

  if (config.insertionMode === "row") {
    direction = "row";
  } else if (config.insertionMode === "column") {
    direction = "column";
  } else {
    // smart mode - calculate balanced direction
    direction = calculateSmartDirection(currentLayout);
  }

  // Determine which side gets the new window
  const [firstNode, secondNode] =
    config.insertionPosition === "first"
      ? [newWindowId, currentLayout] // New window on left/top
      : [currentLayout, newWindowId]; // New window on right/bottom (default)

  // Create split node with new window
  return {
    direction,
    first: firstNode,
    second: secondNode,
    splitPercentage: config.splitPercentage,
  };
}
