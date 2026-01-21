import type { Theme } from "../types";

/**
 * Light theme - clean white background
 * Based on the original shadcn/ui light mode values
 */
export const lightTheme: Theme = {
  id: "light",
  name: "Light",
  description: "Clean light theme for daytime use",

  colors: {
    background: "0 0% 100%",
    foreground: "222.2 84% 4.9%",

    card: "0 0% 100%",
    cardForeground: "222.2 84% 4.9%",

    popover: "0 0% 100%",
    popoverForeground: "222.2 84% 4.9%",

    primary: "222.2 47.4% 11.2%",
    primaryForeground: "210 40% 98%",

    secondary: "210 40% 96.1%",
    secondaryForeground: "222.2 47.4% 11.2%",

    accent: "270 70% 55%",
    accentForeground: "0 0% 100%",

    muted: "210 40% 96.1%",
    mutedForeground: "215.4 16.3% 40%",

    destructive: "0 72% 51%",
    destructiveForeground: "0 0% 100%",

    border: "214.3 31.8% 85%",
    input: "214.3 31.8% 91.4%",
    ring: "222.2 84% 4.9%",

    // Status colors (darker for better contrast)
    success: "142 70% 30%",
    warning: "38 92% 40%",
    info: "199 80% 40%",

    // Nostr-specific colors (darker for light background)
    zap: "45 93% 40%", // Darker gold for contrast on light
    live: "0 72% 45%", // Dark red for live indicator

    // UI highlight (darker for light background)
    highlight: "25 90% 35%", // Dark amber/brown

    // Tooltip colors (dark tooltip for visibility on light background)
    tooltip: "222.2 47.4% 11.2%", // Very dark blue-gray (same as primary)
    tooltipForeground: "210 40% 98%", // Light text
  },

  syntax: {
    comment: "215.4 16.3% 46.9%",
    punctuation: "222.2 84% 30%",
    property: "222.2 47.4% 11.2%",
    string: "142 60% 30%",
    keyword: "270 80% 50%",
    function: "222.2 47.4% 11.2%",
    variable: "222.2 84% 4.9%",
    operator: "222.2 84% 20%",

    // Diff colors
    diffInserted: "142 60% 30%",
    diffInsertedBg: "142 60% 50% / 0.15",
    diffDeleted: "0 70% 45%",
    diffDeletedBg: "0 70% 50% / 0.15",
    diffMeta: "199 80% 40%",
    diffMetaBg: "199 80% 50% / 0.1",
  },

  scrollbar: {
    thumb: "222.2 84% 4.9% / 0.2",
    thumbHover: "222.2 84% 4.9% / 0.3",
    track: "0 0% 0% / 0",
  },

  gradient: {
    color1: "161 98 7", // yellow-700 (darker for light bg)
    color2: "154 52 18", // orange-800 (even darker)
    color3: "126 34 206", // purple-700
    color4: "8 145 178", // cyan-600
  },
};
