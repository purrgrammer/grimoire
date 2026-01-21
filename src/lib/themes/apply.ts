import type { Theme } from "./types";

/**
 * Apply a theme by setting CSS custom properties on the document root.
 * This updates all theme variables at runtime without requiring a page reload.
 */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;

  // Apply core colors
  root.style.setProperty("--background", theme.colors.background);
  root.style.setProperty("--foreground", theme.colors.foreground);

  root.style.setProperty("--card", theme.colors.card);
  root.style.setProperty("--card-foreground", theme.colors.cardForeground);

  root.style.setProperty("--popover", theme.colors.popover);
  root.style.setProperty(
    "--popover-foreground",
    theme.colors.popoverForeground,
  );

  root.style.setProperty("--primary", theme.colors.primary);
  root.style.setProperty(
    "--primary-foreground",
    theme.colors.primaryForeground,
  );

  root.style.setProperty("--secondary", theme.colors.secondary);
  root.style.setProperty(
    "--secondary-foreground",
    theme.colors.secondaryForeground,
  );

  root.style.setProperty("--accent", theme.colors.accent);
  root.style.setProperty("--accent-foreground", theme.colors.accentForeground);

  root.style.setProperty("--muted", theme.colors.muted);
  root.style.setProperty("--muted-foreground", theme.colors.mutedForeground);

  root.style.setProperty("--destructive", theme.colors.destructive);
  root.style.setProperty(
    "--destructive-foreground",
    theme.colors.destructiveForeground,
  );

  root.style.setProperty("--border", theme.colors.border);
  root.style.setProperty("--input", theme.colors.input);
  root.style.setProperty("--ring", theme.colors.ring);

  // Status colors
  root.style.setProperty("--success", theme.colors.success);
  root.style.setProperty("--warning", theme.colors.warning);
  root.style.setProperty("--info", theme.colors.info);

  // Nostr-specific colors
  root.style.setProperty("--zap", theme.colors.zap);
  root.style.setProperty("--live", theme.colors.live);

  // UI highlight color
  root.style.setProperty("--highlight", theme.colors.highlight);

  // Tooltip colors
  root.style.setProperty("--tooltip", theme.colors.tooltip);
  root.style.setProperty(
    "--tooltip-foreground",
    theme.colors.tooltipForeground,
  );

  // Syntax highlighting
  root.style.setProperty("--syntax-comment", theme.syntax.comment);
  root.style.setProperty("--syntax-punctuation", theme.syntax.punctuation);
  root.style.setProperty("--syntax-property", theme.syntax.property);
  root.style.setProperty("--syntax-string", theme.syntax.string);
  root.style.setProperty("--syntax-keyword", theme.syntax.keyword);
  root.style.setProperty("--syntax-function", theme.syntax.function);
  root.style.setProperty("--syntax-variable", theme.syntax.variable);
  root.style.setProperty("--syntax-operator", theme.syntax.operator);

  // Diff colors
  root.style.setProperty("--diff-inserted", theme.syntax.diffInserted);
  root.style.setProperty("--diff-inserted-bg", theme.syntax.diffInsertedBg);
  root.style.setProperty("--diff-deleted", theme.syntax.diffDeleted);
  root.style.setProperty("--diff-deleted-bg", theme.syntax.diffDeletedBg);
  root.style.setProperty("--diff-meta", theme.syntax.diffMeta);
  root.style.setProperty("--diff-meta-bg", theme.syntax.diffMetaBg);

  // Scrollbar
  root.style.setProperty("--scrollbar-thumb", theme.scrollbar.thumb);
  root.style.setProperty("--scrollbar-thumb-hover", theme.scrollbar.thumbHover);
  root.style.setProperty("--scrollbar-track", theme.scrollbar.track);

  // Gradient
  root.style.setProperty("--gradient-1", theme.gradient.color1);
  root.style.setProperty("--gradient-2", theme.gradient.color2);
  root.style.setProperty("--gradient-3", theme.gradient.color3);
  root.style.setProperty("--gradient-4", theme.gradient.color4);
}

/**
 * Get all CSS variable names used by the theme system.
 * Useful for debugging or documentation.
 */
export function getThemeVariables(): string[] {
  return [
    // Core colors
    "--background",
    "--foreground",
    "--card",
    "--card-foreground",
    "--popover",
    "--popover-foreground",
    "--primary",
    "--primary-foreground",
    "--secondary",
    "--secondary-foreground",
    "--accent",
    "--accent-foreground",
    "--muted",
    "--muted-foreground",
    "--destructive",
    "--destructive-foreground",
    "--border",
    "--input",
    "--ring",
    // Status
    "--success",
    "--warning",
    "--info",
    // Nostr-specific
    "--zap",
    "--live",
    // UI highlight
    "--highlight",
    // Tooltip
    "--tooltip",
    "--tooltip-foreground",
    // Syntax
    "--syntax-comment",
    "--syntax-punctuation",
    "--syntax-property",
    "--syntax-string",
    "--syntax-keyword",
    "--syntax-function",
    "--syntax-variable",
    "--syntax-operator",
    // Diff
    "--diff-inserted",
    "--diff-inserted-bg",
    "--diff-deleted",
    "--diff-deleted-bg",
    "--diff-meta",
    "--diff-meta-bg",
    // Scrollbar
    "--scrollbar-thumb",
    "--scrollbar-thumb-hover",
    "--scrollbar-track",
    // Gradient
    "--gradient-1",
    "--gradient-2",
    "--gradient-3",
    "--gradient-4",
  ];
}
