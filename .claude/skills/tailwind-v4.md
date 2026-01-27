# Skill: Tailwind CSS v4

This document provides guidance for writing CSS and using Tailwind in Grimoire after the v4 migration.

## Quick Reference

### Import Syntax
```css
/* v4 - Single import replaces @tailwind directives */
@import "tailwindcss";
```

### Defining Theme Variables
```css
@theme {
  --color-brand: oklch(0.72 0.11 221.19);
  --font-display: "Satoshi", sans-serif;
  --animate-fade: fade 0.3s ease-out;

  @keyframes fade {
    from { opacity: 0; }
    to { opacity: 1; }
  }
}
```

### Custom Utilities
```css
/* v4 - Use @utility instead of @layer utilities */
@utility content-auto {
  content-visibility: auto;
}

/* With nested selectors */
@utility scrollbar-hidden {
  scrollbar-width: none;
  -ms-overflow-style: none;

  &::-webkit-scrollbar {
    display: none;
  }
}
```

### Custom Variants
```css
/* Simple variant */
@custom-variant theme-dark (&:where(.dark, .dark *));

/* Complex variant */
@custom-variant any-hover {
  @media (any-hover: hover) {
    &:hover {
      @slot;
    }
  }
}
```

---

## Grimoire Theme System

Grimoire uses a **two-level CSS variable system** for runtime theming:

### Level 1: Runtime Variables (set by ThemeProvider)
These are HSL values WITHOUT the `hsl()` wrapper:
```css
:root {
  --background: 222.2 84% 4.9%;
  --foreground: 210 40% 98%;
  --primary: 210 40% 98%;
  /* ... */
}
```

### Level 2: Tailwind Color Mapping (in @theme)
These reference the runtime variables with `hsl()`:
```css
@theme {
  --color-background: hsl(var(--background));
  --color-foreground: hsl(var(--foreground));
  --color-primary: hsl(var(--primary));
}
```

### Using Colors in Components

**In Tailwind classes:**
```tsx
<div className="bg-background text-foreground border-border">
<button className="bg-primary text-primary-foreground">
<span className="text-muted-foreground">
```

**In custom CSS with opacity:**
```css
.my-element {
  background: hsl(var(--primary) / 0.1);
  border: 1px solid hsl(var(--border) / 0.5);
}
```

### Available Color Tokens

| Token | Usage |
|-------|-------|
| `background` / `foreground` | Page background and text |
| `card` / `card-foreground` | Card surfaces |
| `popover` / `popover-foreground` | Dropdowns, tooltips |
| `primary` / `primary-foreground` | Primary buttons, links |
| `secondary` / `secondary-foreground` | Secondary actions |
| `accent` / `accent-foreground` | Highlights, emphasis |
| `muted` / `muted-foreground` | Subdued elements |
| `destructive` / `destructive-foreground` | Delete, error actions |
| `border` | Borders |
| `input` | Form input borders |
| `ring` | Focus rings |
| `success` / `warning` / `info` | Status indicators |
| `zap` | Lightning zap color (gold) |
| `live` | Live indicator (red) |
| `highlight` | Active user highlight (orange) |
| `tooltip` / `tooltip-foreground` | Tooltip background/text |

---

## Container Queries (Built-in)

No plugin needed in v4. Use for component-relative responsiveness:

```tsx
// Parent defines container
<div className="@container">
  // Children respond to container width
  <div className="grid grid-cols-1 @sm:grid-cols-2 @lg:grid-cols-3">
    {items.map(item => <Card key={item.id} />)}
  </div>
</div>
```

### Container Query Breakpoints
| Variant | Width |
|---------|-------|
| `@xs:` | 20rem (320px) |
| `@sm:` | 24rem (384px) |
| `@md:` | 28rem (448px) |
| `@lg:` | 32rem (512px) |
| `@xl:` | 36rem (576px) |
| `@2xl:` | 42rem (672px) |

### Max-width Queries
```tsx
<div className="@container">
  <div className="flex-row @max-sm:flex-col">
    {/* Row on larger containers, column on smaller */}
  </div>
</div>
```

### Named Containers
```tsx
<div className="@container/sidebar">
  <nav className="@sm/sidebar:flex-col">
```

---

## Renamed Utilities (v3 → v4)

| v3 | v4 | Notes |
|----|----| ------|
| `shadow-sm` | `shadow-xs` | Smallest shadow |
| `shadow` | `shadow-sm` | Default shadow |
| `rounded-sm` | `rounded-xs` | Smallest radius |
| `rounded` | `rounded-sm` | Default radius |
| `blur-sm` | `blur-xs` | Smallest blur |
| `blur` | `blur-sm` | Default blur |
| `ring` | `ring-3` | Default ring width |

**Important:** Always use the named size, not bare utilities.

---

## CSS Variable Syntax in Classes

**v4 uses parentheses instead of brackets:**

```tsx
// ❌ v3 syntax (deprecated)
<div className="bg-[--my-color]" />
<div className="fill-[--icon-color]" />

// ✅ v4 syntax
<div className="bg-(--my-color)" />
<div className="fill-(--icon-color)" />
```

---

## Important Modifier Position

**v4 moves `!` to the end:**

```tsx
// ❌ v3 syntax
<div className="!flex !mt-0" />

// ✅ v4 syntax
<div className="flex! mt-0!" />
```

---

## New Useful Variants

### not-* Variant
Style when condition is NOT met:
```tsx
<div className="not-hover:opacity-75">Dims when not hovered</div>
<div className="not-first:mt-4">Margin except first child</div>
<div className="not-disabled:cursor-pointer">Clickable when enabled</div>
```

### @starting-style for Animations
CSS-only enter animations without JS:
```tsx
<dialog className="
  transition-all duration-300
  open:opacity-100 open:scale-100
  starting:open:opacity-0 starting:open:scale-95
">
```

### inert Variant
Style non-interactive elements:
```tsx
<div className="inert:opacity-50 inert:pointer-events-none">
```

---

## 3D Transforms

```tsx
<div className="perspective-distant">
  <div className="rotate-x-12 rotate-y-6 transform-3d hover:rotate-y-12">
    3D card effect
  </div>
</div>
```

Available utilities:
- `rotate-x-*`, `rotate-y-*`, `rotate-z-*`
- `translate-z-*`, `scale-z-*`
- `perspective-normal` (500px), `perspective-distant` (1200px)
- `transform-3d` (enables 3D space)

---

## Gradients

### Linear Gradients
```tsx
// Angle-based
<div className="bg-linear-45 from-red-500 to-blue-500" />

// Direction-based
<div className="bg-linear-to-r from-primary to-accent" />

// With color interpolation (more vivid colors)
<div className="bg-linear-to-r/oklch from-red-500 to-blue-500" />
```

### Radial & Conic
```tsx
<div className="bg-radial from-white to-transparent" />
<div className="bg-conic from-red-500 via-yellow-500 to-red-500" />
```

---

## Writing Custom CSS

### In @layer base
For global resets and element defaults:
```css
@layer base {
  * {
    @apply border-border;
  }

  body {
    @apply bg-background text-foreground font-mono;
  }

  button:focus-visible {
    outline: 2px solid hsl(var(--ring));
    outline-offset: 2px;
  }
}
```

### With @utility
For reusable utility classes:
```css
@utility text-balance {
  text-wrap: balance;
}

@utility glass {
  background: hsl(var(--background) / 0.8);
  backdrop-filter: blur(8px);
}
```

### Plain CSS (non-Tailwind)
For third-party component overrides (like Mosaic):
```css
/* No @layer needed - uses native cascade */
.mosaic-window .mosaic-window-toolbar {
  background: hsl(var(--muted));
  border-bottom: 1px solid hsl(var(--border));
}
```

---

## Best Practices

### DO:
- Use semantic color tokens (`bg-primary`) not raw colors
- Use container queries for component responsiveness
- Use `@utility` for custom utilities
- Use HSL variable pattern with opacity: `hsl(var(--color) / 0.5)`
- Keep custom CSS minimal - prefer Tailwind classes

### DON'T:
- Hardcode colors (`bg-blue-500`) - use theme tokens
- Use viewport queries when container queries work better
- Use `@layer utilities` (v3 syntax) - use `@utility`
- Use bracket syntax for CSS vars (`[--var]`) - use parentheses `(--var)`
- Put `!` at the start (`!flex`) - put at end (`flex!`)

---

## File Structure

```
src/
├── index.css           # Main CSS: @import "tailwindcss", @theme, @utility, custom CSS
├── styles/
│   └── prism-theme.css # Syntax highlighting (uses CSS variables)
├── components/
│   └── command-launcher.css  # Command palette styles
└── lib/themes/
    ├── types.ts        # Theme TypeScript types
    ├── apply.ts        # Runtime theme application
    └── builtin/        # Built-in theme definitions
```

---

## Theme Development

When creating or modifying themes, edit files in `src/lib/themes/builtin/`:

```typescript
// src/lib/themes/builtin/my-theme.ts
import type { Theme } from "../types";

export const myTheme: Theme = {
  id: "my-theme",
  name: "My Theme",
  colors: {
    background: "220 20% 10%",  // HSL without wrapper
    foreground: "220 10% 90%",
    // ... all required colors
  },
  syntax: { /* ... */ },
  scrollbar: { /* ... */ },
  gradient: { /* ... */ },
};
```

Register in `src/lib/themes/builtin/index.ts`.

---

## Quick Debugging

Check what CSS variables are set:
```javascript
// In browser console
getComputedStyle(document.documentElement).getPropertyValue('--background')
```

List all theme variables:
```javascript
import { getThemeVariables } from '@/lib/themes/apply';
console.log(getThemeVariables());
```
