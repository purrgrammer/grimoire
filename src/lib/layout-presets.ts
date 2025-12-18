import type { MosaicNode } from "react-mosaic-component";

/**
 * A layout preset that can be applied to arrange windows
 */
export interface LayoutPreset {
  /** Unique identifier for the preset */
  id: string;
  /** Display name for the preset */
  name: string;
  /** Description of the layout arrangement */
  description: string;
  /** Minimum number of windows required */
  minSlots: number;
  /** Maximum number of windows (undefined = no limit) */
  maxSlots?: number;
  /** Function to generate layout for given window IDs */
  generate: (windowIds: string[]) => MosaicNode<string>;
}

/**
 * Builds a horizontal row of windows with equal splits
 */
function buildHorizontalRow(windowIds: string[]): MosaicNode<string> {
  if (windowIds.length === 0) {
    throw new Error("Cannot build row with zero windows");
  }
  if (windowIds.length === 1) {
    return windowIds[0];
  }

  // Calculate percentage for first window to make equal splits
  const splitPercent = (100 / windowIds.length);

  return {
    direction: "row",
    first: windowIds[0],
    second: buildHorizontalRow(windowIds.slice(1)),
    splitPercentage: splitPercent,
  };
}

/**
 * Builds a vertical stack of windows with equal splits
 */
function buildVerticalStack(windowIds: string[]): MosaicNode<string> {
  if (windowIds.length === 0) {
    throw new Error("Cannot build stack with zero windows");
  }
  if (windowIds.length === 1) {
    return windowIds[0];
  }

  // Calculate percentage for first window to make equal splits
  const splitPercent = (100 / windowIds.length);

  return {
    direction: "column",
    first: windowIds[0],
    second: buildVerticalStack(windowIds.slice(1)),
    splitPercentage: splitPercent,
  };
}

/**
 * Calculates best grid dimensions for N windows
 * Prefers square-ish grids, slightly favoring more columns than rows
 */
function calculateGridDimensions(windowCount: number): { rows: number; cols: number } {
  const sqrt = Math.sqrt(windowCount);
  const rows = Math.floor(sqrt);
  const cols = Math.ceil(windowCount / rows);
  return { rows, cols };
}

/**
 * Chunks an array into groups of specified size
 */
function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

/**
 * Builds a grid layout from window IDs
 */
function buildGridLayout(windowIds: string[]): MosaicNode<string> {
  if (windowIds.length === 0) {
    throw new Error("Cannot build grid with zero windows");
  }
  if (windowIds.length === 1) {
    return windowIds[0];
  }

  const { rows, cols } = calculateGridDimensions(windowIds.length);

  // Split windows into rows
  const rowChunks = chunkArray(windowIds, cols);

  // Build each row as a horizontal split
  const rowNodes = rowChunks.map(chunk => buildHorizontalRow(chunk));

  // Stack rows vertically
  return buildVerticalStack(rowNodes);
}

/**
 * Built-in layout presets
 */
export const BUILT_IN_PRESETS: Record<string, LayoutPreset> = {
  "side-by-side": {
    id: "side-by-side",
    name: "Side by Side",
    description: "All windows in a single row (max 4)",
    minSlots: 2,
    maxSlots: 4,
    generate: (windowIds: string[]) => {
      if (windowIds.length > 4) {
        throw new Error("Side-by-side layout supports maximum 4 windows");
      }
      return buildHorizontalRow(windowIds);
    },
  },

  "main-sidebar": {
    id: "main-sidebar",
    name: "Main + Sidebar",
    description: "Large main window with sidebar windows stacked",
    minSlots: 2,
    generate: (windowIds: string[]) => {
      const [main, ...sidebars] = windowIds;

      if (sidebars.length === 0) {
        return main;
      }

      return {
        direction: "row",
        first: main,
        second: buildVerticalStack(sidebars),
        splitPercentage: 70,
      };
    },
  },

  grid: {
    id: "grid",
    name: "Grid",
    description: "All windows in an adaptive grid layout",
    minSlots: 2,
    generate: (windowIds: string[]) => {
      return buildGridLayout(windowIds);
    },
  },
};

/**
 * Collects window IDs from a layout tree in depth-first order
 */
export function collectWindowIds(
  layout: MosaicNode<string> | null
): string[] {
  if (layout === null) {
    return [];
  }

  if (typeof layout === "string") {
    return [layout];
  }

  return [...collectWindowIds(layout.first), ...collectWindowIds(layout.second)];
}

/**
 * Applies a preset layout to existing windows
 * Uses ALL windows in the adaptive layout
 */
export function applyPresetToLayout(
  currentLayout: MosaicNode<string> | null,
  preset: LayoutPreset
): MosaicNode<string> {
  // Collect all window IDs from current layout
  const windowIds = collectWindowIds(currentLayout);

  // Check minimum requirement
  if (windowIds.length < preset.minSlots) {
    throw new Error(
      `Preset "${preset.name}" requires at least ${preset.minSlots} windows but only ${windowIds.length} available`
    );
  }

  // Check maximum limit if defined
  if (preset.maxSlots && windowIds.length > preset.maxSlots) {
    throw new Error(
      `Preset "${preset.name}" supports maximum ${preset.maxSlots} windows but ${windowIds.length} available`
    );
  }

  // Generate layout using all windows
  return preset.generate(windowIds);
}

/**
 * Get a preset by ID
 */
export function getPreset(presetId: string): LayoutPreset | undefined {
  return BUILT_IN_PRESETS[presetId];
}

/**
 * Get all available presets
 */
export function getAllPresets(): LayoutPreset[] {
  return Object.values(BUILT_IN_PRESETS);
}
