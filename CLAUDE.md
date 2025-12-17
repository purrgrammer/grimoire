# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Grimoire is a Nostr protocol explorer and developer tool. It's a tiling window manager interface where each window is a Nostr "app" (profile viewer, event feed, NIP documentation, etc.). Commands are launched Unix-style via Cmd+K palette.

**Stack**: React 19 + TypeScript + Vite + TailwindCSS + Jotai + Dexie + Applesauce

## Core Architecture

### Dual State System

**UI State** (`src/core/state.ts` + `src/core/logic.ts`):
- Jotai atom persisted to localStorage
- Pure functions for all mutations: `(state, payload) => newState`
- Manages workspaces, windows, layout tree, active account

**Nostr State** (`src/services/event-store.ts`):
- Singleton `EventStore` from applesauce-core
- Single source of truth for all Nostr events
- Reactive: components subscribe via hooks, auto-update on new events
- Handles replaceable events automatically (profiles, contact lists, etc.)

**Relay State** (`src/services/relay-liveness.ts`):
- Singleton `RelayLiveness` tracks relay health across sessions
- Persisted to Dexie `relayLiveness` table
- Maintains failure counts, backoff states, last success/failure times
- Prevents repeated connection attempts to dead relays

**Critical**: Don't create new EventStore, RelayPool, or RelayLiveness instances - use the singletons in `src/services/`

### Window System

Windows are rendered in a recursive binary split layout (via `react-mosaic-component`):
- Each window has: `id` (UUID), `appId` (type identifier), `title`, `props`
- Layout is a tree: leaf nodes are window IDs, branch nodes split space
- **Never manipulate layout tree directly** - use callbacks from mosaic

Workspaces are virtual desktops, each with its own layout tree.

### Command System

`src/types/man.ts` defines all commands as Unix man pages:
- Each command has an `appId` (which app to open) and `argParser` (CLI → props)
- Parsers can be async (e.g., resolving NIP-05 addresses)
- Command pattern: user types `profile alice@example.com` → parser resolves → opens ProfileViewer with props

**Global Flags** (`src/lib/global-flags.ts`):
- Global flags work across ALL commands and are extracted before command-specific parsing
- `--title "Custom Title"` - Override the window title (supports quotes, emoji, Unicode)
  - Example: `profile alice --title "👤 Alice"`
  - Example: `req -k 1 -a npub... --title "My Feed"`
  - Position independent: can appear before, after, or in the middle of command args
- Tokenization uses `shell-quote` library for proper quote/whitespace handling
- Display priority: `customTitle` > `dynamicTitle` (from DynamicWindowTitle) > `appId.toUpperCase()`

### Reactive Nostr Pattern

Applesauce uses RxJS observables for reactive data flow:
1. Events arrive from relays → added to EventStore
2. Queries/hooks subscribe to EventStore observables
3. Components re-render automatically when events update
4. Replaceable events (kind 0, 3, 10000-19999, 30000-39999) auto-replace older versions

Use hooks like `useProfile()`, `useNostrEvent()`, `useTimeline()` - they handle subscriptions.

## Key Conventions

- **Path Alias**: `@/` = `./src/`
- **Styling**: Tailwind + HSL CSS variables (theme tokens defined in `index.css`)
- **Types**: Prefer types from `applesauce-core`, extend in `src/types/` when needed
- **File Organization**: By domain (`nostr/`, `ui/`, `services/`, `hooks/`, `lib/`)
- **State Logic**: All UI state mutations go through `src/core/logic.ts` pure functions

## Important Patterns

**Adding New Commands**:
1. Add entry to `manPages` in `src/types/man.ts`
2. Create parser in `src/lib/*-parser.ts` if argument parsing needed
3. Create viewer component for the `appId`
4. Wire viewer into window rendering (`WindowTitle.tsx`)

**Working with Nostr Data**:
- Event data comes from singleton EventStore (reactive)
- Metadata cached in Dexie (`src/services/db.ts`) for offline access
- Active account stored in Jotai state, synced via `useAccountSync` hook
- Use inbox/outbox relay pattern for user relay lists

**Event Rendering**:
- Feed renderers: `KindRenderer` component with `renderers` registry in `src/components/nostr/kinds/index.tsx`
- Detail renderers: `DetailKindRenderer` component with `detailRenderers` registry
- Registry pattern allows adding new kind renderers without modifying parent components
- Falls back to `DefaultKindRenderer` or feed renderer for unregistered kinds

**Mosaic Layout**:
- Layout mutations via `updateLayout()` callback only
- Don't traverse or modify layout tree manually
- Adding/removing windows handled by `logic.ts` functions

**Error Boundaries**:
- All event renderers wrapped in `EventErrorBoundary` component
- Prevents one broken event from crashing entire feed or detail view
- Provides diagnostic UI with retry capability and error details
- Error boundaries auto-reset when event changes

## Testing

**Test Framework**: Vitest with node environment

**Running Tests**:
```bash
npm test          # Watch mode (auto-runs on file changes)
npm run test:ui   # Visual UI for test exploration
npm run test:run  # Single run (CI mode)
```

**Test Conventions**:
- Test files: `*.test.ts` or `*.test.tsx` colocated with source files
- Focus on testing pure functions and parsing logic
- Use descriptive test names that explain behavior
- Group related tests with `describe` blocks

**What to Test**:
- **Parsers** (`src/lib/*-parser.ts`): All argument parsing logic, edge cases, validation
- **Pure functions** (`src/core/logic.ts`): State mutations, business logic
- **Utilities** (`src/lib/*.ts`): Helper functions, data transformations
- **Not UI components**: React components tested manually (for now)

**Example Test Structure**:
```typescript
describe("parseReqCommand", () => {
  describe("kind flag (-k, --kind)", () => {
    it("should parse single kind", () => {
      const result = parseReqCommand(["-k", "1"]);
      expect(result.filter.kinds).toEqual([1]);
    });

    it("should deduplicate kinds", () => {
      const result = parseReqCommand(["-k", "1,3,1"]);
      expect(result.filter.kinds).toEqual([1, 3]);
    });
  });
});
```

## Critical Notes

- React 19 features in use (ensure compatibility)
- LocalStorage persistence has quota handling built-in
- Dark mode is default (controlled via HTML class)
- EventStore handles event deduplication and replaceability automatically
- Run tests before committing changes to parsers or core logic
