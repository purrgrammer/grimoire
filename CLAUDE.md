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

**Nostr Query State Machine** (`src/lib/req-state-machine.ts` + `src/hooks/useReqTimelineEnhanced.ts`):
- Accurate tracking of REQ subscriptions across multiple relays
- Distinguishes between `LIVE`, `LOADING`, `PARTIAL`, `OFFLINE`, `CLOSED`, and `FAILED` states
- Solves "LIVE with 0 relays" bug by tracking per-relay connection state and event counts
- Pattern: Subscribe to relays individually to detect per-relay EOSE and errors

**Critical**: Don't create new EventStore, RelayPool, or RelayLiveness instances - use the singletons in `src/services/`

**Event Loading** (`src/services/loaders.ts`):
- Unified loader auto-fetches missing events when queried via `eventStore.event()` or `eventStore.replaceable()`
- Custom `eventLoader()` with smart relay hint merging for explicit loading with context
- `addressLoader` and `profileLoader` for replaceable events with batching
- `createTimelineLoader` for paginated feeds

**Action System** (`src/services/hub.ts`):
- `ActionRunner` (v5) executes actions with signing and publishing
- Actions are async functions: `async ({ factory, sign, publish }) => { ... }`
- Use `await publish(event)` to publish (not generators/yield)

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

**The `use$` Hook** (applesauce v5):
```typescript
import { use$ } from "applesauce-react/hooks";

// Direct observable (for BehaviorSubjects - never undefined)
const account = use$(accounts.active$);

// Factory with deps (for dynamic observables)
const event = use$(() => eventStore.event(eventId), [eventId]);
const timeline = use$(() => eventStore.timeline(filters), [filters]);
```

### Applesauce Helpers & Caching

**Critical Performance Insight**: Applesauce helpers cache computed values internally using symbols. **You don't need `useMemo` when calling applesauce helpers.**

```typescript
// ❌ WRONG - Unnecessary memoization
const title = useMemo(() => getArticleTitle(event), [event]);
const text = useMemo(() => getHighlightText(event), [event]);

// ✅ CORRECT - Helpers cache internally
const title = getArticleTitle(event);
const text = getHighlightText(event);
```

**How it works**: Helpers use `getOrComputeCachedValue(event, symbol, compute)` to cache results on the event object. The first call computes and caches, subsequent calls return the cached value instantly.

**Available Helpers** (split between packages in applesauce v5):

*From `applesauce-core/helpers` (protocol-level):*
- **Tags**: `getTagValue(event, name)` - get single tag value (searches hidden tags first)
- **Profile**: `getProfileContent(event)`, `getDisplayName(metadata, fallback)`
- **Pointers**: `parseCoordinate(aTag)`, `getEventPointerFromETag`, `getAddressPointerFromATag`, `getProfilePointerFromPTag`
- **Filters**: `isFilterEqual(a, b)`, `matchFilter(filter, event)`, `mergeFilters(...filters)`
- **Relays**: `getSeenRelays`, `mergeRelaySets`, `getInboxes`, `getOutboxes`
- **URL**: `normalizeURL`

*From `applesauce-common/helpers` (social/NIP-specific):*
- **Article**: `getArticleTitle`, `getArticleSummary`, `getArticleImage`, `getArticlePublished`
- **Highlight**: `getHighlightText`, `getHighlightSourceUrl`, `getHighlightSourceEventPointer`, `getHighlightSourceAddressPointer`, `getHighlightContext`, `getHighlightComment`
- **Threading**: `getNip10References(event)` - parses NIP-10 thread tags
- **Comment**: `getCommentReplyPointer(event)` - parses NIP-22 comment replies
- **Zap**: `getZapAmount`, `getZapSender`, `getZapRecipient`, `getZapComment`
- **Reactions**: `getReactionEventPointer(event)`, `getReactionAddressPointer(event)`
- **Lists**: `getRelaysFromList`

**Custom Grimoire Helpers** (not in applesauce):
- `getTagValues(event, name)` - plural version to get array of tag values (src/lib/nostr-utils.ts)
- `resolveFilterAliases(filter, pubkey, contacts)` - resolves `$me`/`$contacts` aliases (src/lib/nostr-utils.ts)
- `getDisplayName(pubkey, metadata)` - enhanced version with pubkey fallback (src/lib/nostr-utils.ts)
- NIP-34 git helpers (src/lib/nip34-helpers.ts) - wraps `getTagValue` for repository, issue, patch metadata
- NIP-C0 code snippet helpers (src/lib/nip-c0-helpers.ts) - wraps `getTagValue` for code metadata

**When to use `useMemo`**:
- ✅ Complex transformations not using applesauce helpers (sorting, filtering, mapping)
- ✅ Creating objects/arrays for dependency tracking (options, configurations)
- ✅ Expensive computations that don't call applesauce helpers
- ❌ Direct calls to applesauce helpers (they cache internally)
- ❌ Grimoire helpers that wrap `getTagValue` (caching propagates)

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
- **Naming Convention**: Use human-friendly names for renderers (e.g., `LiveActivityRenderer` instead of `Kind30311Renderer`) to make code understandable without memorizing kind numbers
  - Feed renderer: `[Name]Renderer.tsx` (e.g., `LiveActivityRenderer.tsx`)
  - Detail renderer: `[Name]DetailRenderer.tsx` (e.g., `LiveActivityDetailRenderer.tsx`)

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

## Verification Requirements

**CRITICAL**: Before marking any task complete, verify changes work correctly:

1. **For any code change**: Run `npm run test:run` - tests must pass
2. **For UI changes**: Run `npm run build` - build must succeed
3. **For style/lint changes**: Run `npm run lint` - no new errors

**Quick verification command**:
```bash
npm run lint && npm run test:run && npm run build
```

If tests fail, fix the issues before proceeding. Never leave broken tests or a failing build.

### Slash Commands

Use these commands for common workflows:
- `/verify` - Run full verification suite (lint + test + build)
- `/test` - Run tests and report results
- `/lint-fix` - Auto-fix lint and formatting issues
- `/commit-push-pr` - Create a commit and PR with proper formatting
- `/review` - Review changes for quality and Nostr best practices

## Critical Notes

- React 19 features in use (ensure compatibility)
- LocalStorage persistence has quota handling built-in
- Dark mode is default (controlled via HTML class)
- EventStore handles event deduplication and replaceability automatically
- Run tests before committing changes to parsers or core logic
- Always run `/verify` before creating a PR
