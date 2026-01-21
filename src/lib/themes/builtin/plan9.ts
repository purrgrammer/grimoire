import type { Theme } from "../types";

/**
 * Plan 9 theme - inspired by the Plan 9 from Bell Labs operating system
 *
 * Characteristics:
 * - Pale yellow/cream backgrounds (#ffffe0)
 * - Light blue-green window chrome (#eaffea)
 * - Black text for high contrast
 * - Purple accents for good contrast on pale yellow
 * - Muted blue interactive elements
 */
export const plan9Theme: Theme = {
  id: "plan9",
  name: "Plan 9",
  description: "Inspired by Plan 9 from Bell Labs",

  colors: {
    // Characteristic pale yellow background
    background: "60 100% 94%", // #ffffe0
    foreground: "0 0% 0%", // Pure black

    // Window chrome - pale green (acme editor style)
    card: "120 100% 95%", // #eaffea
    cardForeground: "0 0% 0%",

    popover: "60 100% 97%",
    popoverForeground: "0 0% 0%",

    // Muted blue for interactive elements (subtler than before)
    primary: "220 50% 35%",
    primaryForeground: "60 100% 96%",

    // Muted green secondary
    secondary: "120 30% 88%",
    secondaryForeground: "0 0% 0%",

    // Purple accent (good contrast on pale yellow)
    accent: "280 60% 45%",
    accentForeground: "0 0% 100%",

    // Muted yellow for subdued elements
    muted: "60 30% 88%",
    mutedForeground: "0 0% 25%",

    // Red for destructive
    destructive: "0 70% 40%",
    destructiveForeground: "0 0% 100%",

    // Subtle borders
    border: "60 20% 75%",
    input: "60 30% 92%",
    ring: "220 50% 35%",

    // Status colors (darker for contrast)
    success: "120 60% 25%",
    warning: "35 90% 35%",
    info: "200 70% 35%",

    // Nostr-specific colors (dark for contrast on pale yellow)
    zap: "35 90% 35%", // Dark amber/gold for zaps
    live: "0 70% 40%", // Dark red for live indicator

    // UI highlight (dark for contrast on pale yellow)
    highlight: "25 85% 30%", // Dark brown/amber

    // Tooltip colors (strong contrast against pale yellow background)
    tooltip: "220 50% 25%", // Dark blue (darker than primary for tooltips)
    tooltipForeground: "60 100% 97%", // Very pale yellow (matches popover)
  },

  syntax: {
    // Acme-inspired syntax colors
    comment: "0 0% 45%", // Gray
    punctuation: "0 0% 25%", // Dark gray
    property: "220 50% 35%", // Muted blue
    string: "120 60% 28%", // Forest green
    keyword: "280 50% 35%", // Muted purple
    function: "220 50% 35%", // Muted blue
    variable: "0 0% 0%", // Black
    operator: "0 0% 15%", // Near black

    // Diff colors - subtle on yellow background
    diffInserted: "120 60% 25%",
    diffInsertedBg: "120 40% 85%",
    diffDeleted: "0 60% 40%",
    diffDeletedBg: "0 40% 90%",
    diffMeta: "200 50% 35%",
    diffMetaBg: "200 40% 88%",
  },

  scrollbar: {
    thumb: "60 20% 70%",
    thumbHover: "60 25% 60%",
    track: "60 30% 92%",
  },

  gradient: {
    // Darker gradient for contrast on pale yellow background
    color1: "120 90 15", // Darker olive/mustard
    color2: "140 60 25", // Darker burnt orange
    color3: "80 50 140", // Dark muted purple
    color4: "30 120 130", // Dark teal
  },
};
