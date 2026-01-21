/**
 * Theme System Types
 *
 * All color values are HSL without the hsl() wrapper.
 * Format: "hue saturation% lightness%" (e.g., "220 70% 50%")
 *
 * For Nostr publishing:
 * - kind: 30078 (NIP-78 arbitrary app data)
 * - d tag: "grimoire-theme"
 * - name tag: theme display name
 */

/** HSL color value without wrapper (e.g., "220 70% 50%") */
export type HSLValue = string;

/** RGB color for gradients (e.g., "250 204 21") */
export type RGBValue = string;

/** Core semantic colors for UI components */
export interface ThemeColors {
  // Core backgrounds and text
  background: HSLValue;
  foreground: HSLValue;

  // Card/panel surfaces
  card: HSLValue;
  cardForeground: HSLValue;

  // Popover/dropdown surfaces
  popover: HSLValue;
  popoverForeground: HSLValue;

  // Primary interactive elements
  primary: HSLValue;
  primaryForeground: HSLValue;

  // Secondary interactive elements
  secondary: HSLValue;
  secondaryForeground: HSLValue;

  // Accent/highlight color
  accent: HSLValue;
  accentForeground: HSLValue;

  // Subdued/muted elements
  muted: HSLValue;
  mutedForeground: HSLValue;

  // Destructive/error states
  destructive: HSLValue;
  destructiveForeground: HSLValue;

  // Form elements
  border: HSLValue;
  input: HSLValue;
  ring: HSLValue;

  // Status indicators (replacing hardcoded Tailwind colors)
  success: HSLValue;
  warning: HSLValue;
  info: HSLValue;

  // Nostr-specific colors
  zap: HSLValue; // Lightning zaps (typically yellow/gold)
  live: HSLValue; // Live streaming indicator (typically red)

  // UI highlight color (for active user, self-references, etc.)
  highlight: HSLValue;

  // Tooltip colors (for proper contrast across all themes)
  tooltip: HSLValue;
  tooltipForeground: HSLValue;
}

/** Syntax highlighting colors for code blocks */
export interface ThemeSyntax {
  // General tokens
  comment: HSLValue;
  punctuation: HSLValue;
  property: HSLValue;
  string: HSLValue;
  keyword: HSLValue;
  function: HSLValue;
  variable: HSLValue;
  operator: HSLValue;

  // Diff-specific tokens
  diffInserted: HSLValue;
  diffInsertedBg: HSLValue;
  diffDeleted: HSLValue;
  diffDeletedBg: HSLValue;
  diffMeta: HSLValue;
  diffMetaBg: HSLValue;
}

/** Scrollbar styling */
export interface ThemeScrollbar {
  thumb: HSLValue;
  thumbHover: HSLValue;
  track: HSLValue;
}

/** Gradient colors (RGB values for CSS rgb() function) */
export interface ThemeGradient {
  // Grimoire brand gradient (4 color stops)
  color1: RGBValue; // Top - yellow
  color2: RGBValue; // Upper-middle - orange
  color3: RGBValue; // Lower-middle - purple
  color4: RGBValue; // Bottom - cyan
}

/** Complete theme definition */
export interface Theme {
  /** Unique identifier (e.g., "plan9", "dark", "light") */
  id: string;

  /** Display name shown in UI */
  name: string;

  /** Theme author (npub or display name) */
  author?: string;

  /** Semantic version */
  version?: string;

  /** Theme description */
  description?: string;

  /** Core UI colors */
  colors: ThemeColors;

  /** Syntax highlighting colors */
  syntax: ThemeSyntax;

  /** Scrollbar colors */
  scrollbar: ThemeScrollbar;

  /** Gradient colors */
  gradient: ThemeGradient;
}

/** Theme metadata for listings (without full color data) */
export interface ThemeMeta {
  id: string;
  name: string;
  author?: string;
  version?: string;
  description?: string;
}

/** Built-in theme IDs */
export type BuiltinThemeId = "dark" | "light" | "plan9";

/** Check if a theme ID is a built-in theme */
export function isBuiltinTheme(id: string): id is BuiltinThemeId {
  return id === "dark" || id === "light" || id === "plan9";
}
