# Plan: Honor Kind 10006 Blocked Relay Lists

## Context

Grimoire fetches kind 10006 (blocked relay list) for the logged-in user and displays it in Settings, but it has **no runtime effect**. Blocked relays are never filtered from queries, publishing, or event loading. This plan implements full enforcement: blocked relays are excluded everywhere, logged in the event log, and shown in the ReqViewer relay dropdown.

Kind 10007 (search relays) is **out of scope** for this plan — can be a follow-up.

## Design Decisions

1. **`filter()` returns `{ allowed, blocked }`** — every caller needs both (for logging and UI display)
2. **Blocked relays flow through `RelaySelectionResult.blockedRelays`** — existing data path from `selectRelaysForFilter` → `useOutboxRelays` → ReqViewer, zero new plumbing
3. **BLOCK log deduplication**: per-relay+context, 60-second cooldown to prevent spam during rapid selection cycles
4. **Filter at selection time, NOT at pool level** — pool-level blocking would break NIP-29 groups (group IS the relay) and create confusing behavior
5. **Fail open** — if kind 10006 hasn't loaded yet when first queries fire, nothing gets blocked until the event arrives

## Implementation

### 1. Add BLOCK type to Event Log

**File: `src/services/event-log.ts`**

- Add `"BLOCK"` to `EventLogType` union
- Add `BlockLogEntry` interface: `{ type: "BLOCK", relay: string, context: "relay-selection" | "event-loader" | "publish" | "interaction" }`
- Add to `LogEntry` union and `AddEntryInput`
- Add public `logBlock(relay, context)` method on `EventLogService` (since `addEntry` is private)

### 2. Add `blockedRelays` to RelaySelectionResult

**File: `src/types/relay-selection.ts`**

- Add `blockedRelays?: string[]` field to `RelaySelectionResult`

### 3. Create BlockedRelayService

**New file: `src/services/blocked-relays.ts`**

Singleton following `RelayListCache` pattern:

```ts
class BlockedRelayService {
  blockedUrls$: BehaviorSubject<Set<string>>;

  isBlocked(url: string): boolean;        // Sync check, normalizes URL
  filter(relays: string[]): { allowed: string[]; blocked: string[] };  // Pure filter
  filterAndLog(relays: string[], context: string): { allowed: string[]; blocked: string[] };  // Filter + emit BLOCK log entries
  setAccount(pubkey: string | undefined): void;  // Account lifecycle
  destroy(): void;
}
```

Implementation:
- `setAccount()` subscribes to `eventStore.replaceable(10006, pubkey, "")` via RxJS
- Parses `["relay", url]` tags, normalizes via `normalizeRelayURL()`, stores in `Set<string>`
- `filterAndLog()` calls `filter()` then `eventLog.logBlock()` for each blocked relay (with 60s cooldown per relay+context)
- **Fail open**: if kind 10006 hasn't loaded yet, nothing is blocked

### 4. Wire into account lifecycle

**File: `src/hooks/useAccountSync.ts`**

- Import `blockedRelays` singleton
- Add `useEffect` calling `blockedRelays.setAccount(activeAccount?.pubkey)` on account change

### 5. Wire into relay selection

**File: `src/services/relay-selection.ts`**

- In `getOutboxRelaysForPubkey()` and `getInboxRelaysForPubkey()`: after `liveness.filter()`, apply `blockedRelays.filter()` (no logging — outer function logs)
- In `selectRelaysForFilter()`: after `mergeRelaySets()`, apply `blockedRelays.filterAndLog(relays, "relay-selection")`, return `blockedRelays` in result
- In `selectRelaysForPublish()`: apply `blockedRelays.filterAndLog(merged, "publish")`
- In `selectRelaysForInteraction()`: apply `blockedRelays.filterAndLog(relays, "interaction")`
- In `createFallbackResult()`: apply `blockedRelays.filter()` to fallback relays too

### 6. Wire into event loader

**File: `src/services/loaders.ts`**

- In `eventLoader()`: after `mergeRelaySets()` (line ~163), apply `blockedRelays.filterAndLog(allRelays, "event-loader")`

### 7. Wire into publishing

**File: `src/services/hub.ts`**

- `publishEvent()` already calls `selectRelaysForPublish()` which will filter internally — no change needed
- In `publishEventToRelays()` (explicit relays): apply `blockedRelays.filterAndLog(relays, "publish")`, throw if all blocked

### 8. EventLogViewer BLOCK rendering

**File: `src/components/EventLogViewer.tsx`**

- Import `BlockLogEntry` type
- Add `"BLOCK"` to the `connect` tab filter: `connect: ["CONNECT", "DISCONNECT", "ERROR", "BLOCK"]`
- Add `BlockEntry` component: shield/ban icon + `RelayLink` + context label
- Add case to log entry renderer switch

### 9. ReqViewer blocked relay section

**File: `src/components/ReqViewer.tsx`**

The `blockedRelays` field flows automatically: `selectRelaysForFilter` → `useOutboxRelays` (via `RelaySelectionResult` spread) → ReqViewer destructure.

- Destructure `blockedRelays` from `useOutboxRelays` result
- Add "Blocked" section after "Disconnected" in relay dropdown (lines ~1430-1438):
  - Strikethrough text, reduced opacity, shield/ban icon
  - Not interactive (no tooltip — we never connected)

### 10. Tests

**New file: `src/services/blocked-relays.test.ts`**

- `isBlocked()` returns false when no account set (fail open)
- `isBlocked()` returns true for blocked URLs after kind 10006 loaded
- URL normalization works (`relay.example.com` → `wss://relay.example.com/`)
- `filter()` correctly splits allowed/blocked
- `setAccount(undefined)` clears blocked set
- Deduplication cooldown works for `filterAndLog()`

## Edge Cases

- **NIP-29 chat groups**: NOT filtered — the group IS the relay
- **Explicit `-r` relay args in REQ**: Still filtered. User can unblock in Settings.
- **Race on login**: Fail open until kind 10006 loads
- **Publishing kind 10006 itself**: No special handling — outbox relays won't include blocked ones

## File Change Summary

| File | Change |
|------|--------|
| `src/services/blocked-relays.ts` | **NEW** — Singleton service |
| `src/services/blocked-relays.test.ts` | **NEW** — Tests |
| `src/services/event-log.ts` | Add BLOCK type + `logBlock()` method |
| `src/types/relay-selection.ts` | Add `blockedRelays?` field |
| `src/hooks/useAccountSync.ts` | Wire service to account lifecycle |
| `src/services/relay-selection.ts` | Apply filtering in all exported functions |
| `src/services/loaders.ts` | Filter in `eventLoader()` |
| `src/services/hub.ts` | Filter in `publishEventToRelays()` |
| `src/components/EventLogViewer.tsx` | Add BlockEntry renderer + tab filter |
| `src/components/ReqViewer.tsx` | Add blocked relay section to dropdown |

## Implementation Order

1. `event-log.ts` — BLOCK type (foundation for logging)
2. `relay-selection.ts` types — `blockedRelays?` field
3. `blocked-relays.ts` + tests — core service
4. `useAccountSync.ts` — lifecycle wiring
5. `relay-selection.ts` — filtering integration
6. `loaders.ts` — event loader filtering
7. `hub.ts` — publish filtering
8. `EventLogViewer.tsx` — BLOCK entry rendering
9. `ReqViewer.tsx` — blocked relay UI section

## Verification

1. `npm run test:run` — all tests pass (including new blocked-relays tests)
2. `npm run lint` — no new lint errors
3. `npm run build` — build succeeds
4. Manual: Add a relay to kind 10006 blocked list in Settings → verify it no longer appears in REQ subscription relays → verify BLOCK entry in event log → verify it shows in ReqViewer relay dropdown as "Blocked"
