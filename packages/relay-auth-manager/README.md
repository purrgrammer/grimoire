# relay-auth-manager

Generic NIP-42 relay authentication manager for Nostr clients. Handles auth challenges, user preferences, and auto-auth — framework and storage agnostic.

## Install

This is a workspace package. It has a single peer dependency on `rxjs >= 7`.

## Quick Start

```typescript
import { RelayAuthManager } from "relay-auth-manager";

const manager = new RelayAuthManager({
  pool,       // relay pool (applesauce-relay compatible)
  signer$,    // Observable<AuthSigner | null>
  storage: localStorage, // optional persistence
});

// React to pending challenges (need user interaction)
manager.pendingChallenges$.subscribe((challenges) => {
  for (const c of challenges) {
    showAuthPrompt(c.relayUrl, c.challenge);
  }
});

// User accepts
await manager.authenticate("wss://relay.example.com");

// User rejects (optionally remember for session)
manager.reject("wss://relay.example.com", true);

// Set a persistent preference
manager.setPreference("wss://relay.example.com", "always");
```

## Constructor Options

```typescript
new RelayAuthManager(options: RelayAuthManagerOptions)
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `pool` | `AuthRelayPool` | *required* | Relay pool to monitor. Relays are auto-monitored on `add$` and cleaned up on `remove$`. |
| `signer$` | `Observable<AuthSigner \| null>` | *required* | Current signer. Emit `null` when logged out or read-only. |
| `storage` | `AuthPreferenceStorage` | `undefined` | Persistent storage for preferences. Anything with `getItem`/`setItem` works. |
| `storageKey` | `string` | `"relay-auth-preferences"` | Key used in storage. |
| `challengeTTL` | `number` | `300000` (5 min) | How long a challenge stays pending before being filtered out. |
| `initialRelays` | `Iterable<AuthRelay>` | `[]` | Relays already in the pool at creation time. |

## Observables

### `states$: BehaviorSubject<ReadonlyMap<string, RelayAuthState>>`

All relay auth states. Emits a new Map on any state change.

```typescript
manager.states$.subscribe((states) => {
  for (const [url, state] of states) {
    console.log(url, state.status, state.connected);
  }
});
```

### `pendingChallenges$: BehaviorSubject<PendingAuthChallenge[]>`

Challenges that need user interaction. Already filtered — only includes relays where:
- Status is `"challenge_received"`
- A signer is available
- Challenge hasn't expired
- Preference isn't `"never"`
- User hasn't rejected this session

## Methods

### Authentication

| Method | Description |
|--------|-------------|
| `authenticate(relayUrl)` | Accept a pending challenge. Signs and sends AUTH. Returns a Promise that resolves on success. Throws if no challenge, no signer, or relay not monitored. |
| `reject(relayUrl, rememberForSession?)` | Reject a challenge. If `rememberForSession` is `true`, suppresses future prompts for this relay until page reload. |

### Preferences

| Method | Description |
|--------|-------------|
| `setPreference(url, pref)` | Set `"always"`, `"never"`, or `"ask"` for a relay. Persisted to storage. |
| `getPreference(url)` | Get preference for a relay, or `undefined`. |
| `getAllPreferences()` | `ReadonlyMap<string, AuthPreference>` of all preferences. |

### Relay Monitoring

| Method | Description |
|--------|-------------|
| `monitorRelay(relay)` | Start monitoring a relay for challenges. Idempotent. Called automatically for pool relays. |
| `unmonitorRelay(url)` | Stop monitoring. Called automatically on pool `remove$`. |

### State Queries

| Method | Description |
|--------|-------------|
| `getRelayState(url)` | Get `RelayAuthState` for a single relay. |
| `getAllStates()` | Same as `states$.value`. |
| `hasSignerAvailable()` | Whether a signer is currently available. |

### Lifecycle

| Method | Description |
|--------|-------------|
| `destroy()` | Unsubscribe everything, complete observables. Safe to call multiple times. |

## Auth Lifecycle

Each relay progresses through these states:

```
none ──challenge──▶ challenge_received ──accept──▶ authenticating ──success──▶ authenticated
  ▲                       │                              │
  │                    reject                          failed
  │                       ▼                              ▼
  └──── disconnect ──── rejected                      failed
```

Disconnect from any state resets to `none`.

## Preferences

Preferences control what happens when a challenge arrives:

| Preference | Behavior |
|------------|----------|
| `"always"` | Auto-authenticate (no user prompt). Waits for signer if unavailable. |
| `"never"` | Auto-reject (no user prompt). |
| `"ask"` | Show in `pendingChallenges$` for user to decide. This is the default. |

## Storage

Pass any object with `getItem(key): string | null` and `setItem(key, value): void`. Both `localStorage` and `sessionStorage` work out of the box.

Preferences are stored as JSON:

```json
{
  "wss://relay.example.com": "always",
  "wss://other.relay.com": "never"
}
```

Custom storage backends (IndexedDB, SQLite, etc.) can be used by wrapping them in the sync interface — e.g., using an in-memory cache with async write-through.

## State Machine

The auth state machine is exported as a pure function for direct use or testing:

```typescript
import { transitionAuthState } from "relay-auth-manager";

const result = transitionAuthState("none", {
  type: "CHALLENGE_RECEIVED",
  challenge: "abc123",
  preference: "always",
});
// { newStatus: "authenticating", shouldAutoAuth: true, clearChallenge: false }
```

## Interfaces

The package defines minimal interfaces for its dependencies so it doesn't import `applesauce-relay` directly:

- **`AuthRelayPool`** — `relay(url)`, `add$`, `remove$`
- **`AuthRelay`** — `url`, `connected$`, `challenge$`, `authenticated$`, `authenticate(signer)`
- **`AuthSigner`** — `signEvent(event)`

These are compatible with applesauce-relay but any implementation that satisfies the shapes will work.
