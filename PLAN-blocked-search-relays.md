# Plan: Honor Blocked Relay List (10006) & Search Relay List (10007)

## Context

Grimoire now fetches and displays kinds 10006 (blocked relays) and 10007 (search relays) in Settings, but these lists have **no runtime effect**. This plan adds two behaviors:

1. **Blocked relays (kind 10006)**: Never connect to relays the user has explicitly blocked
2. **Search relays (kind 10007)**: Use the user's search relays for NIP-50 search queries when no relays are explicitly provided

## Architecture Analysis

### Where relay connections originate

| Code Path | File | How relays are selected |
|-----------|------|------------------------|
| NIP-65 outbox selection | `relay-selection.ts` → `selectRelaysForFilter()` | Fetches kind 10002 for authors, applies health filter |
| Event loader hints | `loaders.ts` → `eventLoader()` | Merges relay hints from pointers, seen-at, outbox, fallback |
| REQ viewer (explicit relays) | `ReqViewer.tsx` | User-provided relay list from command args |
| REQ viewer (auto) | `ReqViewer.tsx` → `useOutboxRelays()` | Calls `selectRelaysForFilter()` |
| useReqTimelineEnhanced | `useReqTimelineEnhanced.ts` | Receives relay list from caller, subscribes per-relay |
| Chat adapters | `nip-29-adapter.ts`, etc. | Group-specific relay (not filterable — group IS the relay) |
| Publishing | `hub.ts` → `publishEvent()` | Author's outbox relays from `relayListCache` |
| Address loader | `loaders.ts` → `addressLoader()` | Internal applesauce loader, uses pool directly |
| Live timeline | `useLiveTimeline.ts` | Receives relay list from caller |

### Key insight: Two filtering points

1. **`relay-selection.ts`** — The central relay selection function. Most automated queries flow through here. This is where blocked relays should be filtered for query paths.
2. **`relay-pool.ts`** — The singleton pool. Adding a filter here would catch ALL connections including explicit ones. This is the nuclear option.

## Implementation Plan

### Part 1: Blocked Relay List Service

**New file: `src/services/blocked-relays.ts`**

A lightweight singleton that reads the user's kind 10006 from EventStore and exposes:

```ts
class BlockedRelayService {
  // Reactive set updated when kind 10006 changes in EventStore
  blockedUrls$: BehaviorSubject<Set<string>>;

  // Sync check - for hot path filtering
  isBlocked(url: string): boolean;

  // Filter helper - remove blocked relays from a list
  filter(relays: string[]): string[];

  // Start watching for the active account's kind 10006
  setAccount(pubkey: string | undefined): void;
}

export const blockedRelays = new BlockedRelayService();
```

**Why a singleton service?** Same pattern as `relayListCache` and `relayLiveness`. Needs to be accessible from non-React code (relay-selection.ts, loaders.ts, hub.ts) without prop drilling.

**Implementation details:**
- Subscribe to `eventStore.replaceable(10006, pubkey, "")` when account changes
- Parse `["relay", url]` tags, normalize URLs, store in a `Set<string>`
- `filter()` returns `relays.filter(url => !this.isBlocked(url))`
- Must handle the case where kind 10006 hasn't loaded yet (don't block anything — fail open)

### Part 2: Wire blocked relay filtering into relay selection

**File: `src/services/relay-selection.ts`**

In `selectRelaysForFilter()`, after the existing health filter (`liveness.filter()`), add:

```ts
// Existing flow:
const healthy = liveness.filter(sanitized);

// Add after:
const allowed = blockedRelays.filter(healthy);
```

This catches the main query path (REQ viewer auto-relay, outbox selection, etc.).

**File: `src/services/loaders.ts`**

In `eventLoader()`, filter the merged relay hints before subscribing:

```ts
const relays = blockedRelays.filter(mergedRelayHints);
```

**File: `src/services/hub.ts`**

In `publishEvent()`, filter outbox relays:

```ts
let relays = await relayListCache.getOutboxRelays(event.pubkey);
relays = blockedRelays.filter(relays ?? []);
```

This prevents publishing to blocked relays.

### Part 3: Account lifecycle integration

**File: `src/hooks/useAccountSync.ts`**

When the active account changes, update the blocked relay service:

```ts
import { blockedRelays } from "@/services/blocked-relays";

// In the account sync effect:
useEffect(() => {
  blockedRelays.setAccount(activeAccount?.pubkey);
}, [activeAccount?.pubkey]);
```

### Part 4: Search Relay List (kind 10007)

**Simpler scope** — search relays only apply when a filter has `.search` set.

**File: `src/services/relay-selection.ts`**

Add a new exported function:

```ts
export async function getSearchRelays(pubkey: string | undefined): Promise<string[] | undefined> {
  if (!pubkey) return undefined;

  // Check EventStore for kind 10007
  const event = eventStore.getReplaceable(10007, pubkey, "");
  if (!event) return undefined;

  const relays = getRelaysFromList(event, "all");
  if (relays.length === 0) return undefined;

  return blockedRelays.filter(relays);
}
```

**File: `src/components/ReqViewer.tsx`**

In the relay selection logic (around line 795-812), when no explicit relays are provided and the filter has `.search`:

```ts
// If search query and user has search relays configured, use those
if (filter.search && !explicitRelays) {
  const searchRelays = await getSearchRelays(pubkey);
  if (searchRelays?.length) {
    return searchRelays;
  }
  // Fall through to normal relay selection if no search relays configured
}
```

This also applies to `useOutboxRelays` or wherever REQ relay selection happens — need to check if the filter contains a search term and short-circuit to search relays.

### Part 5: Testing

**New test file: `src/services/blocked-relays.test.ts`**

- `isBlocked()` returns false when no account is set
- `isBlocked()` correctly identifies blocked URLs after event loaded
- `filter()` removes blocked relays from a list
- URL normalization: blocking `relay.example.com` also blocks `wss://relay.example.com/`
- Handles empty/missing kind 10006 gracefully (fail open)

**New test file: `src/services/relay-selection.test.ts`** (additions)

- `selectRelaysForFilter()` excludes blocked relays
- `getSearchRelays()` returns search relays when kind 10007 exists
- `getSearchRelays()` returns undefined when no kind 10007

## Edge Cases & Considerations

### Blocked relays
- **NIP-29 chat groups**: Do NOT filter group relay — the group IS the relay. If user blocks a relay that hosts a group, they simply won't join that group.
- **Explicit relay args in REQ command**: Should we honor the block? Recommendation: YES, still filter. If the user explicitly types `req -r wss://blocked.relay`, we should warn them but respect the block. They can unblock in settings.
- **Race condition on login**: Kind 10006 may not be loaded yet when first queries fire. Fail open (don't block anything until the event is loaded). This is the safe default.
- **Publishing own kind 10006**: When saving the blocked relay list itself, we publish to the user's outbox relays — which won't include blocked relays (they wouldn't be in kind 10002 typically). No special handling needed.

### Search relays
- **No search relays configured**: Fall through to normal NIP-65 relay selection. The user's regular relays may support NIP-50 search.
- **Search relays + explicit relays**: If user provides `-r` flag in REQ command, respect explicit relays over search relays.
- **Non-search queries**: Kind 10007 only applies when `filter.search` is set. Normal queries are unaffected.

## File Change Summary

| File | Change |
|------|--------|
| `src/services/blocked-relays.ts` | **NEW** — Singleton service for blocked relay filtering |
| `src/services/blocked-relays.test.ts` | **NEW** — Tests |
| `src/services/relay-selection.ts` | Add blocked relay filter + `getSearchRelays()` |
| `src/services/loaders.ts` | Filter relay hints through blocked list |
| `src/services/hub.ts` | Filter publish relays through blocked list |
| `src/hooks/useAccountSync.ts` | Wire blocked relay service to account lifecycle |
| `src/components/ReqViewer.tsx` | Use search relays for NIP-50 queries |

## Order of Implementation

1. `blocked-relays.ts` service + tests (foundation)
2. Wire into `useAccountSync.ts` (lifecycle)
3. Filter in `relay-selection.ts` (main query path)
4. Filter in `loaders.ts` (event loading)
5. Filter in `hub.ts` (publishing)
6. `getSearchRelays()` + ReqViewer integration (search)
7. Full integration test
