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

    accent: "270 80% 60%",
    accentForeground: "0 0% 100%",

    muted: "210 40% 96.1%",
    mutedForeground: "215.4 16.3% 46.9%",

    destructive: "0 84.2% 60.2%",
    destructiveForeground: "210 40% 98%",

    border: "214.3 31.8% 91.4%",
    input: "214.3 31.8% 91.4%",
    ring: "222.2 84% 4.9%",

    // Status colors
    success: "142 76% 36%",
    warning: "45 93% 47%",
    info: "199 89% 48%",
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
    color1: "234 179 8", // yellow-500 (darker for light bg)
    color2: "249 115 22", // orange-500
    color3: "147 51 234", // purple-600
    color4: "6 182 212", // cyan-500
  },
};
