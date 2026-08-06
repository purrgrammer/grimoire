# Tailwind CSS v4

Grimoire uses Tailwind CSS v4 with CSS-first configuration — there is no
`tailwind.config.js`. The theme lives in `src/index.css`.

## Import

```css
@import "tailwindcss";
```

## Custom utilities

```css
@utility my-utility {
  /* styles */
}
```

## Always use semantic theme tokens

```tsx
<div className="bg-background text-foreground">
<button className="bg-primary text-primary-foreground">
<span className="text-muted-foreground">
```

## Container queries (built in — no plugin)

```tsx
<div className="@container">
  <div className="@sm:grid-cols-2 @lg:grid-cols-3">
</div>
```

## Syntax changes from v3

| v3                  | v4                |
| ------------------- | ----------------- |
| `bg-[--my-var]`     | `bg-(--my-var)`   |
| `!flex`             | `flex!`           |
| `shadow-sm`         | `shadow-xs`       |
| `shadow`            | `shadow-sm`       |

## Runtime theming

Colors use two levels of CSS variables:

1. Runtime vars, HSL without the wrapper: `--background: 222.2 84% 4.9%`
2. Tailwind mapping: `--color-background: hsl(var(--background))`

This indirection is what lets `applyTheme()` switch themes at runtime. Dark mode
is the default, controlled via a class on `<html>`.
