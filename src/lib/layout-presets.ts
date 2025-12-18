import type { MosaicNode } from "react-mosaic-component";

/**
 * A layout preset template with null values that get filled with window IDs
 */
export interface LayoutPreset {
  /** Unique identifier for the preset */
  id: string;
  /** Display name for the preset */
  name: string;
  /** Description of the layout arrangement */
  description: string;
  /** Template structure with null values to be replaced by window IDs */
  template: MosaicNode<null>;
  /** Number of windows required for this preset */
  slots: number;
}

/**
 * Built-in layout presets
 */
export const BUILT_IN_PRESETS: Record<string, LayoutPreset> = {
  "side-by-side": {
    id: "side-by-side",
    name: "Side by Side",
    description: "Two windows side-by-side (50/50 horizontal split)",
    template: {
      direction: "row",
      first: null,
      second: null,
      splitPercentage: 50,
    },
    slots: 2,
  },

  "main-sidebar": {
    id: "main-sidebar",
    name: "Main + Sidebar",
    description: "Large main window with sidebar (70/30 horizontal split)",
    template: {
      direction: "row",
      first: null,
      second: null,
      splitPercentage: 70,
    },
    slots: 2,
  },

  grid: {
    id: "grid",
    name: "Grid",
    description: "Four windows in 2×2 grid layout",
    template: {
      direction: "row",
      first: {
        direction: "column",
        first: null,
        second: null,
        splitPercentage: 50,
      },
      second: {
        direction: "column",
        first: null,
        second: null,
        splitPercentage: 50,
      },
      splitPercentage: 50,
    },
    slots: 4,
  },
};

/**
 * Fills a layout template with actual window IDs
 * Uses depth-first traversal to assign window IDs to null slots
 */
export function fillLayoutTemplate(
  template: MosaicNode<null>,
  windowIds: string[]
): MosaicNode<string> {
  let windowIndex = 0;

  const fill = (node: MosaicNode<null>): MosaicNode<string> => {
    // Leaf node - replace null with next window ID
    if (node === null) {
      if (windowIndex >= windowIds.length) {
        throw new Error("Not enough window IDs to fill template");
      }
      return windowIds[windowIndex++];
    }

    // Branch node - recursively fill children
    return {
      ...node,
      first: fill(node.first),
      second: fill(node.second),
    };
  };

  const result = fill(template);

  // Verify all windows were used
  if (windowIndex !== windowIds.length) {
    throw new Error(
      `Template requires ${windowIndex} windows but ${windowIds.length} were provided`
    );
  }

  return result;
}

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
 * Takes the first N windows from the current layout and arranges them according to the preset
 * Preserves any remaining windows by adding them to the right side of the preset
 */
export function applyPresetToLayout(
  currentLayout: MosaicNode<string> | null,
  preset: LayoutPreset
): MosaicNode<string> {
  // Collect all window IDs from current layout
  const windowIds = collectWindowIds(currentLayout);

  // Check if we have enough windows
  if (windowIds.length < preset.slots) {
    throw new Error(
      `Preset "${preset.name}" requires ${preset.slots} windows but only ${windowIds.length} available`
    );
  }

  // Split windows: first N for preset, rest to preserve
  const presetWindows = windowIds.slice(0, preset.slots);
  const remainingWindows = windowIds.slice(preset.slots);

  // Fill template with preset windows
  let result = fillLayoutTemplate(preset.template, presetWindows);

  // If there are remaining windows, add them to the right side
  if (remainingWindows.length > 0) {
    // Create a vertical stack for remaining windows
    let remainingStack: MosaicNode<string> = remainingWindows[0];
    for (let i = 1; i < remainingWindows.length; i++) {
      remainingStack = {
        direction: "column",
        first: remainingStack,
        second: remainingWindows[i],
        splitPercentage: 50,
      };
    }

    // Put preset on left, remaining on right (70/30 split)
    result = {
      direction: "row",
      first: result,
      second: remainingStack,
      splitPercentage: 70, // Give more space to the preset layout
    };
  }

  return result;
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
