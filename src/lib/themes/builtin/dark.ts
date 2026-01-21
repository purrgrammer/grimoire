import type { Theme } from "../types";

/**
 * Dark theme - the original Grimoire theme
 * Deep blue-black background with bright purple accent
 */
export const darkTheme: Theme = {
  id: "dark",
  name: "Dark",
  description: "The original Grimoire dark theme",

  colors: {
    background: "222.2 84% 4.9%",
    foreground: "210 40% 98%",

    card: "222.2 84% 4.9%",
    cardForeground: "210 40% 98%",

    popover: "222.2 84% 4.9%",
    popoverForeground: "210 40% 98%",

    primary: "210 40% 98%",
    primaryForeground: "222.2 47.4% 11.2%",

    secondary: "217.2 32.6% 17.5%",
    secondaryForeground: "210 40% 98%",

    accent: "270 100% 70%",
    accentForeground: "222.2 84% 4.9%",

    muted: "217.2 32.6% 17.5%",
    mutedForeground: "215 20.2% 70%",

    destructive: "0 62.8% 30.6%",
    destructiveForeground: "210 40% 98%",

    border: "217.2 32.6% 17.5%",
    input: "217.2 32.6% 17.5%",
    ring: "212.7 26.8% 83.9%",

    // Status colors
    success: "142 76% 36%",
    warning: "45 93% 47%",
    info: "199 89% 48%",

    // Nostr-specific colors
    zap: "45 93% 58%", // Gold/yellow for zaps
    live: "0 72% 51%", // Red for live indicator

    // UI highlight (active user, self-references)
    highlight: "27 96% 61%", // orange-400 (original color)

    // Tooltip colors (lighter for visibility against dark background)
    tooltip: "217.2 32.6% 30%", // Medium blue-gray (lighter than secondary for contrast)
    tooltipForeground: "210 40% 98%", // Light (high contrast with tooltip)
  },

  syntax: {
    comment: "215 20.2% 70%",
    punctuation: "210 40% 70%",
    property: "210 40% 98%",
    string: "215 20.2% 70%",
    keyword: "210 40% 98%",
    function: "210 40% 98%",
    variable: "210 40% 98%",
    operator: "210 40% 98%",

    // Diff colors (converted from hardcoded RGB)
    diffInserted: "134 60% 76%",
    diffInsertedBg: "145 63% 42% / 0.1",
    diffDeleted: "0 100% 76%",
    diffDeletedBg: "0 100% 60% / 0.1",
    diffMeta: "190 77% 70%",
    diffMetaBg: "190 77% 70% / 0.08",
  },

  scrollbar: {
    thumb: "0 0% 100% / 0.2",
    thumbHover: "0 0% 100% / 0.3",
    track: "0 0% 0% / 0",
  },

  gradient: {
    color1: "250 204 21", // yellow-400
    color2: "251 146 60", // orange-400
    color3: "168 85 247", // purple-500
    color4: "34 211 238", // cyan-400
  },
};
