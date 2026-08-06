# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project Overview

Grimoire is a Nostr protocol explorer and developer tool. It's a tiling window
manager where each window is a Nostr "app" (profile viewer, event feed, NIP
documentation, …). Commands are launched Unix-style via a Cmd+K palette.

**Stack**: React 19 + TypeScript + Vite + TailwindCSS v4 + Jotai + Dexie + Applesauce v6

## Reference docs

Load these when the task touches the area — they hold the detail this file
deliberately omits:

| Area | File |
| --- | --- |
| Applesauce v6 APIs, factories, helpers, relay semantics | `docs/applesauce.md` |
| Custom React hooks (`useAccount`, `useTimeline`, …) | `docs/hooks.md` |
| Chat protocol adapters (NIP-29) | `docs/chat-system.md` |
| Tailwind v4 conventions | `docs/tailwind-v4.md` |

The official **`applesauce` skill** (`.claude/skills/applesauce`) and the
applesauce + nostrbook **MCP servers** (`.mcp.json`) are authoritative for
library and protocol questions — prefer them over recalling API shapes.

## Core Architecture

### Dual state system

**UI state** (`src/core/state.ts` + `src/core/logic.ts`)

- A Jotai atom persisted to localStorage (with quota handling)
- All mutations go through pure functions in `logic.ts`: `(state, payload) => newState`
- Owns workspaces, windows, the layout tree, and the active account

**Nostr state** (`src/services/event-store.ts`)

- A singleton `EventStore` — the single source of truth for all Nostr events
- Reactive: components subscribe via hooks and update on new events
- Handles replaceable events and deduplication automatically

**Relay state** (`src/services/relay-liveness.ts`)

- A singleton `RelayLiveness` tracking relay health across sessions,
  persisted to the Dexie `relayLiveness` table
- Holds failure counts, backoff state, last success/failure — prevents
  repeated connection attempts to dead relays

**Never construct your own `EventStore`, `RelayPool`, or `RelayLiveness`** —
use the singletons in `src/services/`.

### Window system

Windows render in a recursive binary split layout via `react-mosaic-component`.
Each window has `id` (UUID), `appId` (type identifier), `title`, and `props`.
The layout is a tree: leaves are window IDs, branches split space. Workspaces are
virtual desktops, each with its own layout tree.

**Never manipulate the layout tree directly** — mutate via the `updateLayout()`
callback from mosaic; adding and removing windows goes through `logic.ts`.

> The layout tree is also a **wire format**: spellbooks are published to Nostr
> (kind 30777) with the tree serialized inside `content`. Changing its shape
> breaks every already-published spellbook, so treat it as a protocol concern.

### Command system

`src/types/man.ts` defines every command as a Unix man page. Each has an `appId`
(which app to open) and an `argParser` (CLI → props). Parsers may be async, e.g.
resolving NIP-05 addresses.

Flow: user types `profile alice@example.com` → parser resolves → opens
`ProfileViewer` with props.

**Global flags** (`src/lib/global-flags.ts`) are extracted before
command-specific parsing and work across all commands:

- `--title "Custom Title"` — override the window title; position independent
- Tokenization uses `shell-quote` for correct quote/whitespace handling
- Title priority: `customTitle` > `dynamicTitle` > `appId.toUpperCase()`

## Key Conventions

- **Path alias**: `@/` = `./src/`
- **Types**: prefer types from `applesauce-core`; extend in `src/types/`
- **No inline imports**: never `import("module").Type` in an annotation — use a
  top-level `import type`
- **nevent encoding**: always include `kind` (and `author`/`relays` when known) in
  `nip19.neventEncode()`. Kind metadata lets adapters dispatch correctly (NIP-10
  vs NIP-22) without fetching first. Never encode a bare `{ id }` when the kind is known.
- **File organization**: by domain (`nostr/`, `ui/`, `services/`, `hooks/`, `lib/`)
- **State logic**: all UI state mutations go through `src/core/logic.ts`

### Locale-aware formatting (`src/hooks/useLocale.ts`)

All date, time, number, and currency formatting must use the user's locale.
Never hardcode `"en-US"` or formats like `"MM/DD/YYYY"`.

Use `formatTimestamp(timestamp, style)` for timestamps:
`"relative"` ("2h ago") · `"long"` ("January 15, 2025") · `"date"` ("01/15/2025") ·
`"datetime"` · `"absolute"` ("2025-01-15 14:30") · `"time"` ("14:30").

Use `Intl.NumberFormat` for numbers and currencies.

### Shared components — use these instead of rolling your own

- **`UserName`** — for any pubkey. Shows display name, member badge, supporter
  flame; opens the profile on click. Accepts `relayHints`.
- **`RelayLink`** — for any relay URL. Shows favicon, insecure `ws://` warning,
  read/write badges; opens relay details on click. Never render a raw relay URL.
- **`RichText`** — for any event body. Parses mentions, hashtags, custom emoji,
  media embeds, and `nostr:` references. Never render `event.content` raw.
- **`CustomEmoji`** — inline NIP-30 emoji images with shortcode tooltip.
- **`Timestamp`** — locale-aware short time for chat/lists/logs.
- **`Label`** — dotted-border metadata tag (language, kind, status). Sizes `sm`/`md`.
- **`KindBadge`** — an event kind with icon, name, and number. Variants
  `default`/`compact`/`full`; `clickable` opens kind details.
- **`NIPBadge`** — a NIP reference; clickable to open the NIP document. Shows
  deprecation state.

## applesauce v6 relay gotchas

These bit us during the v6 upgrade and the compiler cannot catch them.

**`pool.subscription()` no longer emits `"EOSE"`.** In v5 it returned
`NostrEvent | "EOSE"`; in v6 it returns `NostrEvent` only, and
`Relay.eoseTimeout` was removed too. Any code doing
`typeof response === "string"` silently never fires — that check is valid
narrowing against `NostrEvent`, just always false, so nothing type-errors and
the UI just stops rendering.

- Need an end-of-stored-events signal? Use **`subscriptionWithEose()`**
  (`src/lib/relay-subscription.ts`), not `pool.subscription()`.
- Only consuming events? `pool.subscription()` is fine — don't switch it, or it
  will hand you an `"EOSE"` string to treat as an event.
- A single `relay.subscription()` **does** still emit `"EOSE"`. Only the
  pool/group lost it.

**Always pass `{ eventStore }` to `pool.subscription()`.** It defaults to a
throwaway in-memory store, so omitting it silently drops events and any
`eventStore.timeline()` you read afterwards stays empty.

**Never wait on all relays without a deadline.** Relays can accept a REQ and
never EOSE, which pins a timeline in `LOADING` forever. Treat `CLOSED` and
`ERROR` as settled, and keep a timeout backstop. EOSE can legitimately take
several seconds, so keep deadlines generous (≥15s) — events stream in well
before it.

**Event creation uses factory classes**, not the removed `EventFactory` /
`blueprint()`. See `docs/applesauce.md`.

## Important Patterns

### Adding a command

1. Add an entry to `manPages` in `src/types/man.ts`
2. Add a parser in `src/lib/*-parser.ts` if arguments need parsing
3. Create the viewer component for the `appId`
4. Wire the viewer into window rendering (`WindowTitle.tsx`)

### Event rendering

Two registries in `src/components/nostr/kinds/index.tsx` let you add kind
renderers without touching parent components:

- Feed: `KindRenderer` + `renderers` registry
- Detail: `DetailKindRenderer` + `detailRenderers` registry

Unregistered kinds fall back to `DefaultKindRenderer` or the feed renderer.

Name renderers for humans, not kind numbers — `LiveActivityRenderer.tsx`, not
`Kind30311Renderer.tsx`; detail variants get `[Name]DetailRenderer.tsx`.

All renderers are wrapped in `EventErrorBoundary`, so one malformed event can't
crash a feed. It auto-resets when the event changes.

### Working with Nostr data

Event data comes from the singleton EventStore (reactive). Metadata is cached in
Dexie (`src/services/db.ts`) for offline access. The active account lives in Jotai
state, synced by `useAccountSync`. Use the inbox/outbox relay pattern for user
relay lists.

## Testing

Vitest, node environment. Test files are `*.test.ts(x)` colocated with source.

```bash
npm test          # watch
npm run test:ui   # visual explorer
npm run test:run  # single run (CI)
```

Test parsers (`src/lib/*-parser.ts`), pure functions (`src/core/logic.ts`), and
utilities. React components are tested manually for now.

## Verification

Before finishing a change, run:

```bash
npm run lint && npm run test:run && npm run build
```

Or `/verify`. All three must pass — don't leave a failing build or broken tests.

Lint must report **0 errors**. It does report warnings: a set of rules newly
promoted by eslint 10 and `eslint-plugin-react-hooks` 7 (the React Compiler set:
`set-state-in-effect`, `error-boundaries`, `refs`, `purity`, …) is pinned to
`warn` in `eslint.config.js`, with the reasoning inline there. Don't add new
violations; clearing one rule's backlog and promoting it to `error` is a welcome
standalone change.

## Slash Commands

`/verify` · `/test` · `/lint-fix` · `/commit-push-pr` · `/review [PR#|branch]` · `/sync-nips`

## Critical Notes

- React 19 — ensure compatibility
- Node ≥ 24 (`.nvmrc` pins 26; CI reads it)
- Dark mode is the default, set via a class on `<html>`
- `.agents/` holds vendored agent skills, symlinked into `.claude/skills/`.
  It's excluded from eslint, prettier, and vitest — don't lint or test it.
