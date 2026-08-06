# Grimoire Hooks Reference

Custom React hooks for common Nostr operations. All handle cleanup automatically.

## Account & authentication

**`useAccount()`** (`src/hooks/useAccount.ts`)

Returns `{ account, pubkey, canSign, signer, isLoggedIn }`.

**Always check `canSign` before any signing operation** — read-only accounts have
`canSign: false` and no `signer`.

```typescript
const { canSign, signer, pubkey } = useAccount();
if (canSign) {
  await signer.signEvent(event);
} else {
  // show "log in to post"
}
```

## Nostr data fetching

**`useProfile(pubkey, relayHints?)`** — profile metadata (kind 0). Loads from
IndexedDB first, then network. Uses an AbortController to prevent race
conditions. Returns `ProfileContent | undefined`.

**`useNostrEvent(pointer, context?)`** — unified fetch by ID, `EventPointer`, or
`AddressPointer`. Accepts relay hints via context (a pubkey string or a full
event) and auto-loads missing events with smart relay selection.

**`useTimeline(id, filters, relays, options?)`** — subscribe to a filtered
timeline. Returns `{ events, loading, error }`. `id` is a stable cache key.

## Relay management

**`useRelayState()`** — global relay state and auth. Returns connection states,
pending auth challenges, and preferences; methods `authenticateRelay()`,
`rejectAuth()`, `setAuthPreference()`.

**`useRelayInfo(relayUrl)`** — NIP-11 relay info document, cached in IndexedDB
with a 24-hour TTL.

**`useOutboxRelays(pubkey)`** — outbox relays from the kind 10002 list, cached
via `RelayListCache`.

## Advanced

**`useReqTimelineEnhanced(filter, relays, options)`** — timeline with accurate
per-relay state tracking (EOSE and connection state per relay). Returns
`{ events, state, relayStates, stats }`. Use for the REQ viewer and advanced
timeline UIs.

**`useNip05(nip05Address)`** — resolve a NIP-05 identifier. 1-hour TTL cache.
Returns `{ pubkey, relays, loading, error }`.

**`useNip19Decode(nip19String)`** — decode nprofile/nevent/naddr/note/npub.
Returns `{ type, data, error }`.

## Utility

**`useStableValue(value)` / `useStableArray(array)`** — return a stable reference
when deep-equal. Use for filters, options, and relay arrays to avoid needless
re-renders.

**`useCopy()`** — clipboard copy with toast feedback. Returns `{ copy, copied }`.

**`useLocale()`** — returns `{ locale, language, region, timezone, timeFormat }`.

## Nostr query state machine

`src/lib/req-state-machine.ts` + `src/hooks/useReqTimelineEnhanced.ts`

Tracks REQ subscriptions across multiple relays, distinguishing `LIVE`,
`LOADING`, `PARTIAL`, `OFFLINE`, `CLOSED`, and `FAILED`. Solves the "LIVE with 0
relays" bug by tracking per-relay connection state and event counts.

Pattern: subscribe to relays **individually** so per-relay EOSE and errors are
observable.
