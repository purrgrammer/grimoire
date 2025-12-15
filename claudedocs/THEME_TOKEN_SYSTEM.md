# Grimoire Theme Token System

## Overview

Comprehensive design token system for Grimoire's visual styling. This system abstracts all visual properties into semantic tokens that can be applied to any theme (dark, light, or custom). Built on industry-standard design token patterns used by Tailwind, Radix, and Material Design.

**Status**: Design Complete - Ready for Implementation
**Approach**: Two-tier token system (Base + Semantic)
**Format**: HSL for colors, CSS length units for spacing/sizing
**Philosophy**: Theme-agnostic components, theme-specific values

---

## Token Categories

### 1. Colors (Surfaces & Interactive)
Semantic color tokens for backgrounds, text, and UI elements.

**Structure**:
```typescript
colors: {
  // Surfaces
  background: HSL;           // Main app background
  foreground: HSL;           // Main text color
  card: HSL;                 // Elevated surface
  "card-foreground": HSL;
  popover: HSL;              // Floating elements
  "popover-foreground": HSL;

  // Interactive Elements
  primary: HSL;              // Primary actions (buttons, links)
  "primary-foreground": HSL;
  secondary: HSL;            // Secondary actions
  "secondary-foreground": HSL;
  muted: HSL;                // Subtle backgrounds
  "muted-foreground": HSL;   // Secondary text
  accent: HSL;               // Highlight/emphasis (purple!)
  "accent-foreground": HSL;
  destructive: HSL;          // Errors, danger
  "destructive-foreground": HSL;

  // UI Elements
  border: HSL;               // Dividers, borders
  input: HSL;                // Input backgrounds
  ring: HSL;                 // Focus indicators
}
```

**Current Dark Theme Values**:
```typescript
colors: {
  background: "222.2 84% 4.9%",       // Deep blue-gray
  foreground: "210 40% 98%",          // Almost white
  accent: "270 100% 70%",             // Grimoire purple!
  // ... full definition in grimoire-dark.ts
}
```

**Light Theme Values**:
```typescript
colors: {
  background: "40 20% 97%",           // Warm off-white
  foreground: "222 84% 8%",           // Very dark
  accent: "270 100% 50%",             // Darker purple (contrast)
  // ... full definition in grimoire-light.ts
}
```

---

### 2. Gradients
Multi-stop gradient definitions for brand and decorative purposes.

**Structure**:
```typescript
gradients: {
  brand: [HSL, HSL, HSL, HSL];  // Grimoire 4-color brand gradient
}
```

**Current Values**:
```typescript
// Dark theme
gradients: {
  brand: [
    "43 100% 54%",    // Yellow
    "25 95% 61%",     // Orange
    "270 91% 65%",    // Purple
    "188 86% 53%",    // Cyan
  ],
}

// Light theme (adjusted for contrast)
gradients: {
  brand: [
    "43 100% 45%",    // Darker yellow
    "25 95% 50%",     // Darker orange
    "270 91% 50%",    // Darker purple
    "188 86% 40%",    // Darker cyan
  ],
}
```

**Usage**:
```css
.text-grimoire-gradient {
  background: linear-gradient(
    to bottom,
    hsl(var(--gradient-brand-1)),
    hsl(var(--gradient-brand-2)),
    hsl(var(--gradient-brand-3)),
    hsl(var(--gradient-brand-4))
  );
  background-clip: text;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}
```

---

### 3. Syntax Highlighting
Code syntax highlighting colors for Prism.js integration.

**Structure**:
```typescript
syntax: {
  // General syntax tokens
  comment: HSL;
  keyword: HSL;
  string: HSL;
  function: HSL;
  number: HSL;
  operator: HSL;
  "operator-opacity"?: Opacity;

  // Diff-specific tokens (git diffs in code blocks)
  deleted: HSL;                // Removed lines
  "deleted-bg": HSL;
  "deleted-bg-opacity": Opacity;

  inserted: HSL;               // Added lines
  "inserted-bg": HSL;
  "inserted-bg-opacity": Opacity;

  coord: HSL;                  // Hunk headers (@@ -1,5 +1,7 @@)
  "coord-bg": HSL;
  "coord-bg-opacity": Opacity;
}
```

**Current Values**:
```typescript
// Dark theme
syntax: {
  comment: "215 20.2% 70%",          // Medium gray
  keyword: "210 40% 98%",            // Bright
  deleted: "0 70% 75%",              // Light red
  "deleted-bg": "0 70% 60%",
  "deleted-bg-opacity": 0.1,
  // ... etc
}

// Light theme (inverted lightness)
syntax: {
  comment: "222 30% 35%",            // Dark gray
  keyword: "222 47% 11%",            // Very dark
  deleted: "0 70% 40%",              // Dark red
  "deleted-bg": "0 70% 60%",
  "deleted-bg-opacity": 0.1,
  // ... etc
}
```

**Usage**:
```css
.token.deleted {
  color: hsl(var(--syntax-deleted));
  background: hsl(var(--syntax-deleted-bg) / var(--syntax-deleted-bg-opacity));
}
```

---

### 4. Effects & Transparency
Visual effects like shadows, overlays, and opacity values.

**Structure**:
```typescript
effects: {
  "scrollbar-opacity": Opacity;        // Scrollbar thumb opacity
  "scrollbar-hover-opacity": Opacity;  // Hover state
  "overlay-opacity": Opacity;          // Modal/fullscreen overlays
  "preview-opacity": Opacity;          // Mosaic drag preview
  "shadow-color": HSL;                 // Shadow base color
  "shadow-blur": CSSLength;            // Shadow blur radius
}
```

**Current Values** (theme-agnostic):
```typescript
effects: {
  "scrollbar-opacity": 0.2,
  "scrollbar-hover-opacity": 0.3,
  "overlay-opacity": 0.92,
  "preview-opacity": 0.3,
  "shadow-color": "0 0% 0%",           // Black for shadows
  "shadow-blur": "40px",
}
```

**Usage**:
```css
*::-webkit-scrollbar-thumb {
  background-color: hsl(var(--foreground) / var(--scrollbar-opacity));
}

*::-webkit-scrollbar-thumb:hover {
  background-color: hsl(var(--foreground) / var(--scrollbar-hover-opacity));
}

[data-rmiz-modal-overlay] {
  background-color: hsl(var(--background) / var(--overlay-opacity)) !important;
}
```

---

### 5. Spacing & Sizing
Layout dimensions and component sizes.

**Structure**:
```typescript
spacing: {
  "toolbar-height": CSSLength;    // Mosaic window toolbar
  "split-width": CSSLength;       // Window split handle
  "scrollbar-width": CSSLength;   // Scrollbar thickness
}
```

**Current Values** (theme-agnostic):
```typescript
spacing: {
  "toolbar-height": "30px",
  "split-width": "4px",
  "scrollbar-width": "8px",
}
```

**Usage**:
```css
.mosaic-window .mosaic-window-toolbar {
  height: var(--toolbar-height);
}

.mosaic-split.-row {
  width: var(--split-width);
}
```

---

### 6. Typography
Font families, sizes, and line heights.

**Structure**:
```typescript
typography: {
  "font-family-mono": string;      // Monospace font stack
  "font-size-base": CSSLength;     // Base text size
  "font-size-code": CSSLength;     // Code block text size
  "line-height-base": string;      // Base line height
  "line-height-code": string;      // Code block line height
}
```

**Current Values** (theme-agnostic):
```typescript
typography: {
  "font-family-mono": "'Oxygen Mono', monospace",
  "font-size-base": "1rem",
  "font-size-code": "0.75rem",
  "line-height-base": "1.5",
  "line-height-code": "1.5",
}
```

**Usage**:
```css
body {
  font-family: var(--font-mono);
  font-size: var(--font-size-base);
  line-height: var(--line-height-base);
}

code {
  font-size: var(--font-size-code);
  line-height: var(--line-height-code);
}
```

---

### 7. Geometry
Border radius and shape properties.

**Structure**:
```typescript
geometry: {
  radius: CSSLength;    // Standard border radius
}
```

**Current Values** (theme-agnostic):
```typescript
geometry: {
  radius: "0.5rem",  // 8px at default font size
}
```

**Usage**:
```css
.button {
  border-radius: var(--radius);
}

/* Derived values */
.card {
  border-radius: calc(var(--radius) - 2px);  /* Slightly smaller */
}
```

---

### 8. Charts (Optional)
Data visualization color palette.

**Structure**:
```typescript
charts: {
  1: HSL;
  2: HSL;
  3: HSL;
  4: HSL;
  5: HSL;
}
```

**Current Values**:
```typescript
// Dark theme
charts: {
  1: "220 70% 50%",    // Blue
  2: "160 60% 45%",    // Green
  3: "30 80% 55%",     // Orange
  4: "280 65% 60%",    // Purple
  5: "340 75% 55%",    // Pink
}

// Light theme (adjusted)
charts: {
  1: "220 70% 45%",
  2: "160 60% 40%",
  3: "30 80% 50%",
  4: "280 65% 50%",
  5: "340 75% 50%",
}
```

---

## TypeScript Schema

Complete type definitions for theme system:

```typescript
// src/types/theme.ts

/**
 * HSL color format: "hue saturation% lightness%"
 * Example: "270 100% 70%"
 * Note: No hsl() wrapper - used as: hsl(var(--token))
 */
export type HSL = string;

/**
 * Opacity value between 0 and 1
 */
export type Opacity = number;

/**
 * CSS length value (px, rem, em, etc.)
 */
export type CSSLength = string;

/**
 * Complete Grimoire theme definition
 */
export interface GrimoireTheme {
  /** Unique identifier */
  id: string;

  /** Display name */
  name: string;

  /** Base type for contrast calculations */
  type: "light" | "dark";

  /** Optional metadata */
  author?: string;
  description?: string;
  version?: string;

  /** Color tokens */
  colors: {
    background: HSL;
    foreground: HSL;
    card: HSL;
    "card-foreground": HSL;
    popover: HSL;
    "popover-foreground": HSL;
    primary: HSL;
    "primary-foreground": HSL;
    secondary: HSL;
    "secondary-foreground": HSL;
    muted: HSL;
    "muted-foreground": HSL;
    accent: HSL;
    "accent-foreground": HSL;
    destructive: HSL;
    "destructive-foreground": HSL;
    border: HSL;
    input: HSL;
    ring: HSL;
  };

  /** Gradient definitions */
  gradients: {
    brand: [HSL, HSL, HSL, HSL];
  };

  /** Syntax highlighting */
  syntax: {
    comment: HSL;
    keyword: HSL;
    string: HSL;
    function: HSL;
    number: HSL;
    operator: HSL;
    "operator-opacity"?: Opacity;
    deleted: HSL;
    "deleted-bg": HSL;
    "deleted-bg-opacity": Opacity;
    inserted: HSL;
    "inserted-bg": HSL;
    "inserted-bg-opacity": Opacity;
    coord: HSL;
    "coord-bg": HSL;
    "coord-bg-opacity": Opacity;
  };

  /** Visual effects */
  effects: {
    "scrollbar-opacity": Opacity;
    "scrollbar-hover-opacity": Opacity;
    "overlay-opacity": Opacity;
    "preview-opacity": Opacity;
    "shadow-color": HSL;
    "shadow-blur": CSSLength;
  };

  /** Spacing & sizing */
  spacing: {
    "toolbar-height": CSSLength;
    "split-width": CSSLength;
    "scrollbar-width": CSSLength;
  };

  /** Typography */
  typography: {
    "font-family-mono": string;
    "font-size-base": CSSLength;
    "font-size-code": CSSLength;
    "line-height-base": string;
    "line-height-code": string;
  };

  /** Geometry */
  geometry: {
    radius: CSSLength;
  };
}

/**
 * Chart colors (optional, separate for flexibility)
 */
export interface ChartColors {
  1: HSL;
  2: HSL;
  3: HSL;
  4: HSL;
  5: HSL;
}

/**
 * Complete theme with chart colors
 */
export interface GrimoireThemeComplete extends GrimoireTheme {
  charts: ChartColors;
}
```

---

## Usage Guidelines

### HSL Format Requirements

**Correct Format**:
```typescript
"270 100% 70%"           // Basic color
"270 100% 70% / 0.5"     // With inline opacity
```

**❌ Wrong**:
```typescript
"hsl(270 100% 70%)"      // Don't wrap in hsl()
"270, 100%, 70%"         // Don't use commas
"#B388FF"                // Don't use hex
"rgb(179, 136, 255)"     // Don't use RGB
```

**Rationale**: CSS variables need unwrapped values for flexible composition:
```css
/* ✅ This works */
color: hsl(var(--accent));
background: hsl(var(--accent) / 0.1);

/* ❌ This doesn't */
color: var(--accent);  /* Missing hsl() */
```

### Token Naming Conventions

1. **Semantic over Visual**:
   - ✅ `accent` (semantic: highlight/emphasis)
   - ❌ `purple` (visual: describes appearance)

2. **Purpose over Position**:
   - ✅ `card-foreground` (purpose: text on cards)
   - ❌ `text-2` (position: arbitrary numbering)

3. **Component-Specific when Needed**:
   - ✅ `toolbar-height` (specific to toolbars)
   - ❌ `height-1` (generic, unclear usage)

### CSS Variable Usage

**Colors**:
```css
/* ✅ Correct */
color: hsl(var(--foreground));
background: hsl(var(--background));
border: 1px solid hsl(var(--border));

/* With opacity */
background: hsl(var(--accent) / 0.1);
color: hsl(var(--foreground) / var(--scrollbar-opacity));

/* ❌ Wrong */
color: var(--foreground);                    /* Missing hsl() */
background: hsl(var(--background), 0.9);     /* Wrong opacity syntax */
```

**Gradients**:
```css
/* ✅ Correct */
background: linear-gradient(
  to bottom,
  hsl(var(--gradient-brand-1)),
  hsl(var(--gradient-brand-2)),
  hsl(var(--gradient-brand-3)),
  hsl(var(--gradient-brand-4))
);

/* ❌ Wrong */
background: var(--gradient-brand);  /* No single gradient variable exists */
```

**Spacing & Sizing**:
```css
/* ✅ Correct - direct usage */
height: var(--toolbar-height);
width: var(--split-width);

/* ✅ Correct - with calc */
padding: calc(var(--toolbar-height) / 2);
```

### Contrast Requirements

**WCAG AA Standards** (minimum):
- **Normal text** (<18pt): 4.5:1 contrast ratio
- **Large text** (≥18pt or bold ≥14pt): 3:1 contrast ratio
- **UI components**: 3:1 contrast ratio

**Testing**:
```typescript
import { calculateContrast } from "@/lib/theme-utils";

// Check contrast
const ratio = calculateContrast(
  theme.colors.foreground,
  theme.colors.background
);

if (ratio < 4.5) {
  console.warn("Insufficient contrast for normal text");
}
```

**Common Fixes**:
- Light themes: Darken accent colors (50% instead of 70% lightness)
- Dark themes: Lighten accent colors (70% instead of 50% lightness)
- Always test with actual text, not just theory

---

## Theme Creation Workflow

### 1. Start from Existing Theme

```typescript
import { GRIMOIRE_DARK } from "@/lib/themes/grimoire-dark";

const MY_THEME: GrimoireThemeComplete = {
  ...GRIMOIRE_DARK,  // Start with dark theme
  id: "my-custom-theme",
  name: "My Custom Theme",
  // Override specific tokens...
};
```

### 2. Modify Colors

Focus on semantic tokens first:
```typescript
colors: {
  ...GRIMOIRE_DARK.colors,
  background: "210 30% 10%",    // Slightly different blue
  accent: "150 80% 60%",         // Green accent instead of purple
}
```

### 3. Adjust Syntax Highlighting

Match your color scheme:
```typescript
syntax: {
  ...GRIMOIRE_DARK.syntax,
  keyword: "150 80% 60%",        // Green keywords to match accent
  deleted: "0 80% 70%",          // Brighter red
}
```

### 4. Update Gradients

Keep brand consistency or create new:
```typescript
gradients: {
  brand: [
    "150 80% 60%",  // Green
    "180 70% 50%",  // Cyan
    "210 60% 50%",  // Blue
    "240 70% 60%",  // Purple
  ],
}
```

### 5. Validate Theme

```typescript
import { validateTheme } from "@/lib/theme-utils";

const validation = validateTheme(MY_THEME);

if (!validation.valid) {
  console.error("Theme validation failed:", validation.errors);
}

if (validation.warnings.length > 0) {
  console.warn("Theme warnings:", validation.warnings);
}
```

### 6. Test Visually

- Load theme in browser
- Check all UI components
- Test with real content
- Verify contrast with browser DevTools
- Test in different screen sizes

### 7. Export & Share

```typescript
import { exportTheme } from "@/lib/theme-utils";

const json = exportTheme(MY_THEME);
// Save to file or share with others
```

---

## File Structure

```
src/
├── types/
│   └── theme.ts                    TypeScript interfaces
│
├── lib/
│   ├── themes/
│   │   ├── index.ts                Theme registry & utilities
│   │   ├── grimoire-dark.ts        Dark theme definition (const)
│   │   └── grimoire-light.ts       Light theme definition (const)
│   │
│   └── theme-utils.ts              Utilities (validate, convert, etc.)
│
├── index.css                       CSS variables (all tokens)
└── styles/
    └── prism-theme.css             Syntax highlighting styles
```

---

## Implementation Phases

### Phase 1: Type System ✅
- [x] Create `src/types/theme.ts`
- [x] Define all interfaces
- [x] Document token types

### Phase 2: Theme Definitions
- [ ] Create `src/lib/themes/grimoire-dark.ts`
- [ ] Create `src/lib/themes/grimoire-light.ts`
- [ ] Create `src/lib/themes/index.ts` (registry)
- [ ] Add complete token values for both themes

### Phase 3: CSS Migration
- [ ] Add all tokens to `:root` in `src/index.css`
- [ ] Add all tokens to `.dark` in `src/index.css`
- [ ] Replace hardcoded colors with token references
- [ ] Update `src/styles/prism-theme.css` to use syntax tokens
- [ ] Update gradient usage in components

### Phase 4: Utilities
- [ ] Implement `themeToCSSVariables()` in `src/lib/theme-utils.ts`
- [ ] Implement `applyTheme()` for dynamic theme switching
- [ ] Implement `validateTheme()` with contrast checking
- [ ] Implement `exportTheme()` / `importTheme()` for sharing
- [ ] Implement `calculateContrast()` (WCAG compliance)

### Phase 5: Testing
- [ ] Unit tests for validation functions
- [ ] Unit tests for conversion utilities
- [ ] Visual testing in both themes
- [ ] Contrast testing with automated tools
- [ ] Cross-browser compatibility testing

---

## Benefits of This System

1. **Complete Abstraction**: All visual properties tokenized, no hardcoded values
2. **Type Safety**: TypeScript enforces token structure and catches errors
3. **Validation**: Automated checks for completeness and contrast
4. **Extensibility**: Easy to add new themes (just define tokens)
5. **Portability**: Import/export themes as JSON
6. **Maintainability**: Single source of truth for visual properties
7. **Consistency**: Enforced visual coherence across all components
8. **Accessibility**: Built-in contrast validation (WCAG compliance)
9. **Future-Proof**: Architecture supports user-defined themes
10. **Developer Experience**: IntelliSense, autocomplete, documentation built-in

---

## Next Steps

1. **Review this design** - Confirm token structure meets requirements
2. **Approve naming conventions** - Ensure token names are clear and semantic
3. **Begin Phase 2** - Create TypeScript theme definition files
4. **Validate with real data** - Test token system with actual component usage
5. **Iterate** - Refine token structure based on implementation feedback

---

## References

- **WCAG 2.1 Guidelines**: https://www.w3.org/WAI/WCAG21/Understanding/
- **Design Tokens W3C Community**: https://design-tokens.github.io/community-group/
- **HSL Color Model**: https://developer.mozilla.org/en-US/docs/Web/CSS/color_value/hsl
- **CSS Custom Properties**: https://developer.mozilla.org/en-US/docs/Web/CSS/Using_CSS_custom_properties
- **Tailwind Color System**: https://tailwindcss.com/docs/customizing-colors
- **Radix Themes**: https://www.radix-ui.com/themes/docs/theme/overview

---

**Document Version**: 1.0
**Created**: 2025-12-15
**Author**: Claude (ultrathink analysis)
**Status**: Design Complete - Ready for Implementation
