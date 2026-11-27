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
| WebMCP (tools for the browser's own agent) | `docs/webmcp.md` |
| Napplets (NIP-5D, Kehto runtime, capability consent) | `docs/napplets.md` |
| Android app (Capacitor), release contract, CI, Zapstore, owner gates | `docs/android-zapstore.md` |
| POST composer: tagged people, inbox relays (NIP-65), drafts | `docs/post-composer.md` |

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

> **Exception 1: Concord plane traffic** (`src/services/concord-relay-pool.ts`).
> applesauce arms `receivedAuthRequiredForReq` per-`Relay`, before the
> `!waitForAuth` early return, so a plane REQ that opts out of the auth gate
> still wedges grimoire's ordinary reads on a shared socket — and the auth
> manager then re-prompts the signer in a loop. Plane reads therefore get their
> own pool, and `concord-stream-auth.ts` watches that one. The kind-13302
> Community List stays on the singleton.
>
> **Exception 2: publishing NIP-17 gift wraps**
> (`src/services/dm-publish-pool.ts`). A gift wrap is signed by a throwaway key
> so the relay cannot tell who sent it; a socket that has NIP-42 AUTHed as the
> sender hands over exactly that. `relayAuthManager` is wired to the singleton
> pool and auto-auths, so a peer's wrap is published on a pool no auth manager
> watches, and a relay that answers `auth-required` is reported undeliverable
> rather than satisfied. Reads (`{kinds:[1059],"#p":[self]}` on the user's own
> inbox) stay on the singleton pool, authenticated — that is your own mailbox.
>
> **Exception 3: NWC** (`src/services/nwc.ts`). Assigned to
> `WalletConnect.pool`, isolated so relay liveness cannot deprioritize or skip
> the wallet relay.
>
> **Exception 4: a scroll execution** (`src/lib/scroll-runtime.ts`). A private
> pool and EventStore per run, torn down with the run.
>
> Nothing else may spawn a pool — and every pool must be a
> **`BlockingRelayPool`** (`src/services/blocking-relay-pool.ts`), never a bare
> `RelayPool`, or it honours no blocked-relay list. An eslint rule enforces both.

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
  top-level `import type`. And no `import()` inside a function body either:
  `grimoire/no-inline-dynamic-import` (eslint.config.js) errors on it. Lazy
  loading for a reason is fine — `lazy(() => import(...))`, a loader thunk
  `() => import("x")`, a `vi.mock` factory, or the top level of a test — and
  a deliberate code split elsewhere carries an eslint-disable naming the
  chunk it keeps out of the entry bundle or the cycle it breaks. An
  `await import()` inside a test case once put the whole kinds registry
  inside that case's 5s budget and timed out on a cold run.
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

**Which primitive to reach for:**

| Need | Use |
| --- | --- |
| One-shot fetch | `requestEvents()` / `requestEvent()` — `pool.request()` completes itself |
| One-shot fetch where "empty" must differ from "never answered" (pagination) | `requestEventsWithOutcome()` + `assertReadComplete()` |
| Stream, don't care about EOSE | `pool.subscription(relays, filters, { eventStore })` |
| Stream and need the EOSE boundary | `streamWithEose()` (`src/lib/relay-subscription.ts`) |
| Per-relay state tracking | subscribe to each `relay.subscription()` individually |

Never hand-roll "collect events until EOSE, with a timeout" again — that's what
`requestEvents()` is for.

**A silent relay is not a finished relay.** One that answers `auth-required`
without sending a NIP-42 `AUTH` frame emits no EVENT, EOSE, CLOSED or ERROR at
all — it blocks. Don't treat absence of messages as completion.

**Chat rendering is gated on EOSE deliberately.** The list needs a stable bottom
anchor before it can render as events stream in; `eventStore.timeline()` emits
growing subsets, so removing the gate renders messages offscreen.

**Blocked relays (NIP-51 kind 10006) are enforced in `group()`.** Every
multi-relay op in applesauce funnels through `RelayPool.group()`, so
`BlockingRelayPool` filters there — one chokepoint that also covers the loaders,
which resolve relay hints internally where no call-site filter could reach.
`src/services/blocked-relays.ts` holds the set; it imports nothing but URL
helpers, because the obvious `accountManager` import closes a cycle through the
pool and would silently yield an empty blocklist at startup. Account wiring lives
in `blocked-relays-sync.ts`.

- `pool.relay(url)` bypasses `group()` **and** registers the relay. Nine call
  sites need it; each carries an eslint-disable and an `isRelayBlocked()` guard.
- **Filtering at the pool alone breaks EOSE.** `streamWithEose` counts settled
  relays against the caller's list, so a relay the pool dropped can never settle
  and EOSE waits out the 15s backstop — which, since chat is gated on EOSE, is a
  blank conversation. It filters before computing `expected`.
- **An empty group does not complete for reads.** `relays$` is a BehaviorSubject
  that never completes, so `pool.request([])` hangs until the caller's timeout
  (10s default). `requestEvents`/`requestEvent` short-circuit on an empty target
  list. `publish` differs — `take(1)` makes it complete `[]` at once, which is
  why a fully blocked publish needed an explicit undeliverable path.
- Blocking is not liveness. Pruning a blocked relay does **not** record a
  failure: `pool.remove()` emits `remove$` synchronously, detaching liveness's
  `close$` watcher before the async WebSocket `onclose` can land.

**Discovery relays and content relays are different sets.** `INDEXER_RELAYS`
(`src/services/loaders.ts`) resolves replaceable events — kinds 0, 3, 10002 and
the other lists — for pubkeys we hold no hint for; `FALLBACK_RELAYS` is a
content and publish fallback. They were one list until a blocked-relay report
showed why they must not be: blocking spammy content relays is a statement about
content, and while discovery shared the list it took relay-list resolution down
with it — measured as Connected (2), no contact list, and no query sent.

- The three `createAddressLoader` instances use indexers. `createEventLoader`
  (by id) uses aggregators; indexers do not hold arbitrary events.
  `createEventLoaderForStore` answers both, so it gets both.
- Indexers are **not** exempt from the kind-10006 block. The claim is only that
  the default discovery set is disjoint from a typical blocklist.

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

**A green local build is not a green CI build.** `node_modules` here carries
hoisted versions a clean install never produces, so a package imported directly
but never declared type-checks locally and breaks CI. `nostr-tools` used to be
the example and is now declared (`^2.24.1`, plus an `overrides` pin); the live
ones are `@noble/curves`, `@scure/base` and `@scure/bip32`, which resolve only
while something else hoists them. `@noble/hashes`, `@noble/ciphers` and
`@scure/btc-signer` ARE declared. Before pushing a change that imports a new
module or a new API from an undeclared one, verify against a clean install:

```bash
git ls-files -z | xargs -0 tar cf - | (mkdir -p /tmp/cleanbuild && cd /tmp/cleanbuild && tar xf -)
cd /tmp/cleanbuild && npm ci && npm run build
```

**Passing all three does not mean the app works.** These failures all shipped
green: a duplicate React crashed at module init, chat rendered no messages, and
timelines hung in `LOADING`. Nothing here executes the app. So also **run it**
(`/run`, or `npm run dev` and drive the UI) whenever a change touches:

- relay subscriptions, EOSE handling, or the event store
- dependencies (a single `npm install` can nest a second React)
- the React tree, providers, or lazily-imported windows
- the service worker or anything that caches modules

Check the browser console, not just the screen — a shell can render while every
subscription underneath it is dead. `/smoke` walks the paths that have caught
real bugs.

When you verify something by hand, leave a test behind. `src/test/mock-relay.ts`
serves the relay behaviours that break clients — `auth-required`, `silent`,
`close-after-eose` — so cases that used to need a live misbehaving relay now run
in milliseconds (`src/lib/relay-subscription.test.ts`). If the compiler can't
see the invariant, add a `no-restricted-syntax` rule; the two already in
`eslint.config.js` each came from a shipped bug, and one caught a second
occurrence immediately.

Lint must report **0 errors**. It does report warnings: a set of rules newly
promoted by eslint 10 and `eslint-plugin-react-hooks` 7 (the React Compiler set:
`set-state-in-effect`, `error-boundaries`, `refs`, `purity`, …) is pinned to
`warn` in `eslint.config.js`, with the reasoning inline there. Don't add new
violations — the current count is the ceiling.

### Visual evidence on every PR

Every PR description carries a **Visual evidence** section that a reviewer can
check against the PR's head commit. It is a merge requirement, in addition to
everything above — green checks do not replace it.

- **Source and commit.** Screenshots come from the Vercel preview of the head
  commit, or from a production build of that same commit served locally
  (`npm run build && npm run preview`). State which, and the SHA. The preview
  sits behind Vercel Authentication, so without team access use the local
  build. If the head moves in a way that touches what was captured, recapture.
- **Flows, states, viewports.** Capture every flow and state the change adds or
  alters — loading, empty, error and partial states included — at a desktop
  (≥1280px wide) and a mobile (~390px wide) viewport.
- **No regression.** Also capture the neighbouring states the change must not
  alter (a chat with messages, an empty chat). When behaviour changes, pair the
  new capture with the same state on `main`.
- **Clean, isolated session.** Capture in a fresh browser profile, not anyone's
  logged-in session. Relay edge cases come from `src/test/mock-relay.ts`, not a
  live relay. NIP-29 chat will not open without an active account; a read-only
  account (`type: "readonly"`) has no signer, so it reads but can neither AUTH
  nor sign. Quote a mock group — `chat "ws://localhost:<port>'group"` —
  because `parseGroupArgs` only rejoins `host'group` when the host has a dot.
  Say which captures used mocks and which reached a real relay.
- **Attach screenshots to the PR; never commit them.** Upload captures with
  the `--attach` flag of `gh pr create`, `gh pr edit` or `gh pr comment`
  (gh ≥ 2.105), e.g. `gh pr comment <PR> --body-file evidence.md --attach
  './pr-feed-mobile.png#Feed, 390px, this PR'`. A body reference such as
  `![alt](./pr-feed-mobile.png)` is rewritten to the uploaded asset. Keep
  the captures outside the repository (e.g. `/tmp`), and keep the text
  provenance — build SHA, viewports, mocks, frame counts, steps to
  reproduce — in the PR body or comment. Check that the images render on
  the PR page before calling the evidence delivered; if an upload fails,
  report it — don't fall back to committing images. `docs/evidence/` holds
  captures from earlier PRs; leave them, but add no new ones.
- **Not evidence:** a unit render (`renderToStaticMarkup`), a description of
  what the screen should show, or a capture from another commit.
- **No UI change:** write `Visual evidence: N/A — <reason>` (docs, CI config,
  tests only). A relay, subscription or state change that a window consumes is
  not N/A: capture the window that consumes it.

## Slash Commands

`/verify` · `/test` · `/lint-fix` · `/commit-push-pr` · `/review [PR#|branch]` · `/sync-nips`

`/smoke` — drive the running app; use it whenever the verification section says a
green pipeline isn't enough.
`/adversarial-review [PR#|branch]` — spawn a reviewer tuned to report only
merge blockers.

## Critical Notes

- React 19 — ensure compatibility
- Node ≥ 24 (`.nvmrc` pins 26; CI reads it)
- Dark mode is the default, set via a class on `<html>`
- `.agents/` holds vendored agent skills, symlinked into `.claude/skills/`.
  It's excluded from eslint, prettier, and vitest — don't lint or test it.
- **Exactly one copy of React and react-dom.** Deps with peers capped at React
  18 (e.g. `react-dnd-multi-backend` via `react-mosaic-component`) make npm nest
  a second copy; the old one reaches for internals React 19 removed and the app
  dies at module init. Guarded by an npm `override` and `resolve.dedupe` in
  `vite.config.ts`. After adding a dependency, check:
  `find node_modules -path "*/node_modules/react-dom/package.json"` — any hit is
  a bug.
- **Android app** (`android/`, Capacitor 8, `rocks.grimoire.app`): the same
  `dist/` bundled into an APK and served from `https://localhost`. Anything
  that differs between web and app goes through `src/lib/native/` — use
  `publicUrl()` for links people share (never `location.origin`),
  `openExternal()` for links that leave the app, `saveBlob()` for downloads.
  Build, release contract and owner gates: `docs/android-zapstore.md`.
- **The service worker registers in production only** (`src/main.tsx`). In dev it
  caches Vite's hashed module URLs, which die on the next dependency change and
  break dynamic imports. Don't make registration unconditional.
- **Vite can't statically analyze template-literal dynamic imports.**
  ``import(`pkg/${name}.mjs`)`` warns and is never bundled, so it fails in
  production while appearing to work in dev. Use the library's own lazy registry
  or `import.meta.glob`.
