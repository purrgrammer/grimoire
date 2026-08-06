# Applesauce Reference (v6)

Grimoire is built on applesauce v6. For anything not covered here, use the
official `applesauce` skill (`.claude/skills/applesauce`) or the applesauce MCP
server configured in `.mcp.json` — both are authoritative and version-current.

## Singletons — never construct your own

- `src/services/event-store.ts` — the single `EventStore`
- `src/services/relay-pool.ts` — the single `RelayPool`
- `src/services/relay-liveness.ts` — the single `RelayLiveness`

## Reactive data flow

Events arrive from relays → land in the EventStore → components subscribe to
EventStore observables → re-render automatically. Replaceable events (kind 0, 3,
10000–19999, 30000–39999) auto-replace older versions.

### The `use$` hook

```typescript
import { use$ } from "applesauce-react/hooks";

// Direct observable (for BehaviorSubjects — never undefined)
const account = use$(accounts.active$);

// Factory with deps (for dynamic observables)
const event = use$(() => eventStore.event(eventId), [eventId]);
const timeline = use$(() => eventStore.timeline(filters), [filters]);
```

## Event creation: factory classes

v6 removed the legacy `EventFactory` class, `blueprint()`, `buildEvent`,
`modifyEvent`, and `createEvent`. Event creation now uses **kind-specific
factory classes** that extend a Promise-based `EventFactory`.

```typescript
import { NoteFactory, ReactionFactory } from "applesauce-common/factories";

// Chainable, awaitable, signs at the end
const event = await NoteFactory.create(content, { emojis }).sign(signer);

// Replies
const reply = await NoteFactory.reply(parent, content).sign(signer);

// Reactions
const reaction = await ReactionFactory.create(target, "+").sign(signer);
```

**Adding tags the factory doesn't generate** — use `modifyPublicTags`, not
post-hoc mutation of a draft:

```typescript
const event = await ReactionFactory.create(target, emoji)
  .modifyPublicTags((tags) => [...tags, ["h", groupId]])
  .sign(signer);
```

**Kinds with no typed factory** — sign a plain template directly:

```typescript
const event = await signer.signEvent({
  kind: 30777,
  content,
  tags,
  created_at: Math.floor(Date.now() / 1000),
});
```

Available factories live in `applesauce-common/factories` (social/NIP kinds),
`applesauce-core/factories` (`EventFactory`, `DeleteFactory`, `ProfileFactory`,
mailboxes), plus `applesauce-wallet/factories`.

## Action system (`src/services/hub.ts`)

`ActionRunner(eventStore, signer, publishEvent)` — note the second argument is an
**`EventSigner`**, not a factory (v6 change). Grimoire passes a delegating signer
that always resolves to the active account, so the hub follows account switches
without reassignment.

Action context provides `{ events, self, user, signer, sign, publish, run }`.
There is no `factory` on the context anymore — build a template and call `sign`.

```typescript
export function MyAction(options: Options) {
  return async function ({ sign, publish }: ActionContext): Promise<void> {
    const draft = { kind, content, tags, created_at: nowInSeconds() };
    await publish(await sign(draft));
  };
}
```

## Relay `req` semantics (v6 change)

- `RelayPool`/`RelayGroup` no longer emit a **virtual** EOSE on `req`/`subscription`
- `eoseTimeout` was removed from `Relay`; use completion operators instead
  (`RelayGroup.completeOnAny`, `completeOnAllEose`, `completeAfterFirstRelay`)
- `CLOSED` messages now **complete** subscriptions rather than erroring
- `markFromRelay`, `toEventStore`, and the `IRelay`/`IPool`/`IGroup` interfaces
  were removed — use the concrete `Relay` class type

Grimoire uses the **high-level** `.request()` / `.subscription()` methods, which
still emit `NostrEvent | "EOSE"`. The low-level `.req()` emits structured
`{ type: "OPEN" | "EVENT" | "EOSE" | "NOTICE" | "CLOSED" }` messages.

## Event loading (`src/services/loaders.ts`)

- The unified loader auto-fetches missing events queried via `eventStore.event()`
  or `eventStore.replaceable()`
- Custom `eventLoader()` merges relay hints for explicit loading with context
- `addressLoader` / `profileLoader` batch replaceable events
- `createTimelineLoader` for paginated feeds

## Helpers cache internally — do not `useMemo` them

Applesauce helpers cache computed values on the event object via symbols.

```typescript
// ❌ WRONG — unnecessary memoization
const title = useMemo(() => getArticleTitle(event), [event]);

// ✅ CORRECT — the helper caches internally
const title = getArticleTitle(event);
```

`useMemo` **is** warranted for: complex transformations that don't call
applesauce helpers (sorting, filtering, mapping), and objects/arrays created for
dependency tracking (filters, options, relay arrays).

### Where helpers live

**`applesauce-core/helpers`** (protocol-level)

- Tags: `getTagValue(event, name)` — first match only
- Profile: `getProfileContent`, `getDisplayName`
- Pointers: `parseReplaceableAddress` (from `applesauce-core/helpers/pointers`),
  `getEventPointerFromETag`, `getAddressPointerFromATag`, `getProfilePointerFromPTag`
- Filters: `isFilterEqual`, `matchFilter`, `mergeFilters`
- Relays: `getSeenRelays`, `mergeRelaySets`, `getInboxes`, `getOutboxes`
- Caching: `getOrComputeCachedValue(event, symbol, compute)`
- URL: `normalizeURL`

**`applesauce-common/helpers`** (social / NIP-specific)

- Article: `getArticleTitle`, `getArticleSummary`, `getArticleImage`, `getArticlePublished`
- Highlight: `getHighlightText`, `getHighlightSourceUrl`, `getHighlightContext`, …
- Threading: `getNip10References(event)`
- Comment: `getCommentReplyPointer(event)` (NIP-22)
- Zap: `getZapAmount`, `getZapSender`, `getZapRecipient`, `getZapComment`
- Reactions: `getReactionEventPointer`, `getReactionAddressPointer`
- Lists: `getRelaysFromList`
- Emoji: `Emoji` type — note `address` is an **`AddressPointer`**, not a string

### Grimoire's own helpers

- `getTagValues(event, name)` — **all** values for a tag name (`src/lib/nostr-utils.ts`).
  Applesauce only ships the singular `getTagValue`.
- `resolveFilterAliases(filter, pubkey, contacts)` — resolves `$me` / `$contacts`
- `getDisplayName(pubkey, metadata)` — enhanced, with pubkey fallback
- `toApplesauceEmoji` / `toApplesauceEmojis` (`src/lib/emoji-helpers.ts`) — converts
  Grimoire's `EmojiTag` (address as a `"30030:pubkey:id"` string) to applesauce's
  `Emoji` (address as a parsed `AddressPointer`)
- NIP-34 git helpers (`src/lib/nip34-helpers.ts`)
- NIP-C0 code snippet helpers (`src/lib/nip-c0-helpers.ts`)

## Writing new helpers

Always cache with `getOrComputeCachedValue`, with the symbol at module scope:

```typescript
import { getOrComputeCachedValue } from "applesauce-core/helpers";

const MyValueSymbol = Symbol("myValue");

export function getMyValue(event: NostrEvent): string[] {
  return getOrComputeCachedValue(event, MyValueSymbol, () =>
    event.tags.filter((t) => t[0] === "myTag" && t[1]).map((t) => t[1]),
  );
}
```

Rules of thumb:

1. Cache anything that iterates tags, parses content, or runs a regex
2. Symbols at module scope, never inside the function
3. A bare `getTagValue()` call needs no caching wrapper
4. Group helpers into NIP-specific files (`nip34-helpers.ts`, `nip88-helpers.ts`)
