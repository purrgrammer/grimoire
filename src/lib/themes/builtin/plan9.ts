import type { Theme } from "../types";

/**
 * Plan 9 theme - inspired by the Plan 9 from Bell Labs operating system
 *
 * Characteristics:
 * - Pale yellow/cream backgrounds (#ffffe0)
 * - Light blue-green window chrome (#eaffea)
 * - Black text for high contrast
 * - Bright yellow selections
 * - Dark blue accents
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

    // Dark blue for interactive elements
    primary: "220 100% 25%",
    primaryForeground: "60 100% 94%",

    // Muted green secondary
    secondary: "120 30% 88%",
    secondaryForeground: "0 0% 0%",

    // Bright yellow accent (Plan9 signature selection color)
    accent: "60 100% 50%",
    accentForeground: "0 0% 0%",

    // Muted yellow for subdued elements
    muted: "60 30% 88%",
    mutedForeground: "0 0% 35%",

    // Red for destructive
    destructive: "0 70% 45%",
    destructiveForeground: "0 0% 100%",

    // Dark blue borders
    border: "220 40% 50%",
    input: "60 30% 92%",
    ring: "220 100% 25%",

    // Status colors
    success: "120 60% 30%",
    warning: "45 90% 45%",
    info: "200 80% 40%",
  },

  syntax: {
    // Acme-inspired syntax colors
    comment: "0 0% 45%", // Gray
    punctuation: "0 0% 25%", // Dark gray
    property: "220 100% 25%", // Dark blue
    string: "120 60% 28%", // Forest green
    keyword: "280 60% 35%", // Purple
    function: "220 100% 25%", // Dark blue
    variable: "0 0% 0%", // Black
    operator: "0 0% 15%", // Near black

    // Diff colors - subtle on yellow background
    diffInserted: "120 60% 25%",
    diffInsertedBg: "120 50% 85%",
    diffDeleted: "0 65% 40%",
    diffDeletedBg: "0 50% 90%",
    diffMeta: "200 70% 35%",
    diffMetaBg: "200 50% 88%",
  },

  scrollbar: {
    thumb: "220 30% 55%",
    thumbHover: "220 40% 45%",
    track: "60 30% 90%",
  },

  gradient: {
    // Muted gradient for Plan9 aesthetic
    color1: "180 140 20", // Olive/mustard
    color2: "200 120 50", // Burnt orange
    color3: "100 60 180", // Muted purple
    color4: "40 160 180", // Teal
  },
};
