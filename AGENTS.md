# AGENTS.md

This file contains guidelines for agentic coding agents working in the Grimoire repository.

## Quick Reference

For detailed project architecture, patterns, and conventions, see **[CLAUDE.md](./CLAUDE.md)**.

## Build Commands

### Development
```bash
npm run dev          # Start development server with HMR
npm run build        # TypeScript check + production build
npm run preview      # Preview production build locally
```

### Code Quality
```bash
npm run lint         # Run ESLint (fails on errors)
npm run lint:fix     # Auto-fix ESLint issues + formatting
npm run format       # Format with Prettier
npm run format:check # Check formatting without changes
```

### Testing
```bash
npm test             # Run tests in watch mode
npm run test:ui      # Visual test explorer
npm run test:run     # Single test run (CI mode)
```

**Single Test**: Use `vitest run` with file pattern:
```bash
npm run test:run src/lib/nostr-utils.test.ts
```

### Verification
Always run before committing:
```bash
npm run lint && npm run test:run && npm run build
```

## Code Style Guidelines

### Imports & Dependencies
- **Path Alias**: Use `@/` for `src/` directory (configured in Vite & Vitest)
- **Import Order**: External libs → Applesauce → Local `@/` modules → Relative imports
- **Applesauce**: Prefer helpers from `applesauce-core/helpers` and `applesauce-common/helpers`
- **No Default Exports**: Use named exports for better tree-shaking

```typescript
// ✅ Correct import order
import { useState } from "react";
import { use$ } from "applesauce-react/hooks";
import { getProfileContent } from "applesauce-core/helpers";
import { cn } from "@/lib/utils";
import { UserName } from "./components/UserName";
```

### TypeScript & Types
- **Strict Mode**: Project uses strict TypeScript configuration
- **No `any`**: ESLint rule disabled, but prefer proper types
- **Applesauce Types**: Use types from `applesauce-core` and `nostr-tools`
- **Local Types**: Extend in `src/types/` when needed

```typescript
// ✅ Use proper types from Applesauce
import type { NostrEvent, ProfileContent } from "applesauce-core/helpers";
import type { EventPointer } from "nostr-tools/nip19";
```

### React Patterns
- **React 19**: Use latest features (hooks, concurrent rendering)
- **No Default Exports**: Components use named exports
- **Props Interface**: Always define props interface with JSDoc comments
- **Destructured Props**: Destructure props in function signature

```typescript
// ✅ Component pattern
interface QuotedEventProps {
  /** EventPointer with optional relay hints */
  eventPointer?: EventPointer;
  /** Depth level for nesting */
  depth?: number;
}

export function QuotedEvent({ eventPointer, depth = 0 }: QuotedEventProps) {
  // Component logic
}
```

### Performance & Caching
- **Applesauce Helpers**: Cache internally - NO `useMemo` needed
- **Custom Helpers**: Use `useMemo` for complex transformations
- **Stable References**: Use `useStableValue`/`useStableArray` for filters/options

```typescript
// ❌ WRONG - Unnecessary memoization
const title = useMemo(() => getArticleTitle(event), [event]);

// ✅ CORRECT - Helpers cache internally
const title = getArticleTitle(event);
```

### Styling
- **TailwindCSS**: Primary styling approach
- **CSS Variables**: Theme tokens in HSL format (see `index.css`)
- **Utility Function**: Use `cn()` from `@/lib/utils` for class merging
- **Dark Mode**: Default (controlled via HTML class)

```typescript
// ✅ Styling pattern
import { cn } from "@/lib/utils";

const className = cn(
  "flex items-center gap-2 p-2 rounded-lg",
  isActive && "bg-primary text-primary-foreground",
  className
);
```

### File Organization
- **By Domain**: Group files by feature/domain (`nostr/`, `ui/`, `services/`, `hooks/`)
- **Colocated Tests**: Test files next to source files (`*.test.ts`)
- **Barrel Exports**: Use `index.ts` for clean imports
- **Pure Functions**: Business logic in `src/core/logic.ts`

### Naming Conventions
- **Components**: PascalCase with descriptive names (`LiveActivityRenderer`)
- **Hooks**: camelCase with `use` prefix (`useAccount`, `useProfile`)
- **Utilities**: camelCase with descriptive names (`getDisplayName`, `canAccountSign`)
- **Constants**: UPPER_SNAKE_CASE for exports
- **Files**: kebab-case for utilities, PascalCase for components

## Testing Guidelines

### Test Environment
- **Vitest**: Test framework with Node environment
- **Polyfills**: IndexedDB, WebSocket, localStorage pre-configured
- **Setup File**: `src/test/setup.ts` contains browser API polyfills

### What to Test
- **Parsers**: All argument parsing logic and edge cases
- **Pure Functions**: State mutations and business logic
- **Utilities**: Helper functions and data transformations
- **Not UI Components**: React components tested manually

### Test Structure
```typescript
describe("parseReqCommand", () => {
  describe("kind flag (-k, --kind)", () => {
    it("should parse single kind", () => {
      const result = parseReqCommand(["-k", "1"]);
      expect(result.filter.kinds).toEqual([1]);
    });
  });
});
```

## Critical Rules

1. **Singleton Services**: Never create new EventStore, RelayPool, or RelayLiveness instances
2. **Verification**: Always run full verification before committing changes
3. **Applesauce Caching**: Don't use `useMemo` with Applesauce helpers
4. **Account Signing**: Always check `canSign` before signing operations
5. **Error Boundaries**: Wrap event renderers in error boundaries
6. **Path Alias**: Use `@/` for all internal imports

## Project Context

Grimoire is a Nostr protocol explorer with a tiling window manager interface. Each window is a Nostr "app" (profile viewer, event feed, NIP documentation, etc.). Commands are launched Unix-style via Cmd+K palette.

**Stack**: React 19 + TypeScript + Vite + TailwindCSS + Jotai + Dexie + Applesauce

---

*See [CLAUDE.md](./CLAUDE.md) for detailed architecture, patterns, hooks, and conventions.*