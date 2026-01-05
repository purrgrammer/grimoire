# Multi-Account Architecture Diagram

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                          User Interface Layer                        │
├─────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │
│  │  User Menu   │  │ Login Dialog │  │  Account Manager Window  │  │
│  │              │  │              │  │                          │  │
│  │ • Avatar     │  │ • Method     │  │ • List all accounts      │  │
│  │ • Accounts   │  │   selection  │  │ • Switch / Remove        │  │
│  │ • Switch     │  │ • Smart      │  │ • Labels / Status        │  │
│  │ • Add        │  │   input      │  │ • Connection indicators  │  │
│  └──────────────┘  └──────────────┘  └──────────────────────────┘  │
│                                                                       │
└───────────────────────────────┬───────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        Command Layer                                 │
├─────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  /login [identifier]     /accounts          /logout [--all]          │
│       │                       │                    │                 │
│       ▼                       ▼                    ▼                 │
│  parseLoginCommand    (opens window)     parseLogoutCommand          │
│                                                                       │
└───────────────────────────────┬───────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      Account Management Layer                        │
├─────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │            AccountManager (applesauce-accounts)              │   │
│  │                                                              │   │
│  │  • accounts$: Observable<Account[]>                          │   │
│  │  • active$: Observable<Account | null>                       │   │
│  │  • addAccount(account)                                       │   │
│  │  • removeAccount(account)                                    │   │
│  │  • setActive(account)                                        │   │
│  │  • toJSON() / fromJSON()                                     │   │
│  └────────────────────────┬────────────────────────────────────┘   │
│                           │                                          │
│              ┌────────────┼────────────┬────────────┐               │
│              ▼            ▼            ▼            ▼               │
│   ┌────────────────┐ ┌─────────┐ ┌─────────┐ ┌──────────┐         │
│   │ ReadOnlyAccount│ │Extension│ │ Remote  │ │ Android  │         │
│   │                │ │ Account │ │ Signer  │ │ Signer   │         │
│   │ • pubkey       │ │         │ │ Account │ │ Account  │         │
│   │ • signer=null  │ │ NIP-07  │ │ NIP-46  │ │ NIP-55   │         │
│   │ • metadata     │ └─────────┘ └─────────┘ └──────────┘         │
│   │   - source     │       │           │            │              │
│   │   - nip05      │       │           │            │              │
│   └────────────────┘       │           │            │              │
│                            ▼           ▼            ▼              │
│                    ┌────────────────────────────────────┐          │
│                    │         Signer Layer               │          │
│                    │  (applesauce-signers)              │          │
│                    │                                    │          │
│                    │  • getPublicKey()                  │          │
│                    │  • signEvent(event)                │          │
│                    │  • nip04/nip44 encrypt/decrypt     │          │
│                    └────────────┬───────────────────────┘          │
│                                 │                                   │
└─────────────────────────────────┼────────────────────────────────────┘
                                  │
                 ┌────────────────┼────────────────┐
                 ▼                ▼                ▼
      ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
      │ window.nostr │  │  Relay Pool  │  │Android Intent│
      │              │  │              │  │              │
      │  (NIP-07)    │  │  (NIP-46)    │  │  (NIP-55)    │
      └──────────────┘  └──────────────┘  └──────────────┘
```

## Data Flow

### 1. Login Flow

```
User Input (npub, nip05, bunker://, etc.)
         │
         ▼
detectLoginInputType()
         │
         ▼
createAccountFromInput()
         │
         ├─ npub ────────────────────► ReadOnlyAccount.fromNpub()
         ├─ nip05 ───────────────────► ReadOnlyAccount.fromNip05()
         ├─ hex ─────────────────────► ReadOnlyAccount.fromHex()
         ├─ nprofile ────────────────► ReadOnlyAccount.fromNprofile()
         ├─ bunker:// ───────────────► RemoteSignerAccount.fromBunkerUrl()
         └─ (empty) ─────────────────► Show LoginDialog
                                                │
                                                ▼
                                        User selects method
                                                │
                                                ▼
                                        Create appropriate account
                                                │
                                                ▼
                                      accountManager.addAccount()
                                                │
                                                ▼
                                      accountManager.setActive()
                                                │
                                                ▼
                                      active$ emits new account
                                                │
                                                ▼
                                      useAccountSync() receives update
                                                │
                                                ▼
                                      Update GrimoireState.activeAccount
```

### 2. Account Switching Flow

```
User clicks account in menu
         │
         ▼
accountManager.setActive(account)
         │
         ▼
active$ emits account
         │
         ▼
useAccountSync() hook listens
         │
         ▼
Load relays for account (NIP-65 or cache)
         │
         ▼
setActiveAccount({
  pubkey,
  relays,
  accountType,
  label
})
         │
         ▼
Jotai state updates
         │
         ▼
UI re-renders with new active account
```

### 3. Event Signing Flow

```
User wants to publish event
         │
         ▼
Get active account from accountManager
         │
         ├─ No account ──────────────► Show login prompt
         │
         ▼
Check if account has signer
         │
         ├─ No signer (read-only) ───► Show error + upgrade prompt
         │
         ▼
account.signer.signEvent(event)
         │
         ├─ ExtensionSigner ─────────► window.nostr.signEvent()
         ├─ Nip46Signer ─────────────► Send request via relay
         └─ Nip55Signer ─────────────► Send Android intent
                  │
                  ▼
           User approves (if needed)
                  │
                  ▼
           Signed event returned
                  │
                  ▼
           Publish to relays
```

### 4. NIP-46 Connection Flow

```
RemoteSignerAccount.fromBunkerUrl(url)
         │
         ▼
Parse bunker:// URL
  • pubkey (remote signer)
  • relays
  • secret (optional)
         │
         ▼
Create Nip46Signer({
  remotePubkey,
  relays,
  pool: RelayPool (singleton)
})
         │
         ▼
signer.connect()
         │
         ├─ Connect to relays
         ├─ Subscribe to response events
         └─ Send connect request
                  │
                  ▼
         Remote signer responds
                  │
                  ▼
         Connection established
                  │
                  ▼
         signer.getPublicKey()
                  │
                  ▼
         Create RemoteSignerAccount
                  │
                  ▼
         Monitor connection status
           (connected/disconnected/connecting)
```

## State Management

### Jotai State (UI State)

```typescript
GrimoireState {
  activeAccount?: {
    pubkey: string,
    relays: RelayInfo[],
    accountType: 'readonly' | 'extension' | 'remote' | 'android',
    label?: string
  }
}
```

### AccountManager State (Account State)

```typescript
AccountManager {
  accounts$: Observable<Account[]>,      // All accounts
  active$: Observable<Account | null>    // Active account
}
```

### Sync Hook (Bridge)

```typescript
useAccountSync() {
  // Listens to: accountManager.active$
  // Updates:    grimoireState.activeAccount
  // Loads:      relays from NIP-65 or cache
}
```

## Persistence

### LocalStorage Keys

```
┌───────────────────────────────────────────────┐
│  localStorage                                 │
├───────────────────────────────────────────────┤
│                                               │
│  "nostr-accounts": {                          │
│    accounts: [                                │
│      {                                        │
│        id: "readonly:abc123...",              │
│        pubkey: "abc123...",                   │
│        metadata: {                            │
│          type: "readonly",                    │
│          source: "npub",                      │
│          originalInput: "npub1..."            │
│        }                                      │
│      },                                       │
│      {                                        │
│        id: "remote:def456...",                │
│        pubkey: "def456...",                   │
│        metadata: {                            │
│          type: "remote",                      │
│          relays: ["wss://..."],               │
│          remotePubkey: "xyz789..."            │
│        }                                      │
│      }                                        │
│    ]                                          │
│  }                                            │
│                                               │
│  "active-account": "readonly:abc123..."       │
│                                               │
└───────────────────────────────────────────────┘
```

### Initialization Sequence

```
1. App starts
      ▼
2. Load AccountManager from localStorage
      ▼
3. Register all account types
      ▼
4. Deserialize accounts from JSON
      ▼
5. For each RemoteSignerAccount:
   • Recreate Nip46Signer
   • Connect to relays (async)
      ▼
6. Set active account from localStorage
      ▼
7. useAccountSync() hook activates
      ▼
8. Load relays for active account
      ▼
9. Update GrimoireState
      ▼
10. UI renders with active account
```

## Component Hierarchy

```
App
 │
 ├─ UserMenu
 │   ├─ AccountList (dropdown)
 │   │   ├─ AccountItem (active)
 │   │   ├─ AccountItem
 │   │   └─ AccountItem
 │   ├─ AddAccountButton
 │   └─ LogoutButton
 │
 ├─ LoginDialog (modal)
 │   ├─ MethodSelector
 │   │   ├─ ExtensionButton
 │   │   ├─ ReadOnlyButton
 │   │   ├─ RemoteSignerButton
 │   │   └─ AndroidButton
 │   └─ SmartInput (auto-detect format)
 │
 └─ Windows
     └─ AccountManager (window app)
         ├─ AccountList
         │   ├─ AccountCard
         │   │   ├─ Avatar
         │   │   ├─ Info (name, type, status)
         │   │   └─ Actions (switch, remove, edit)
         │   └─ ...
         └─ AddAccountButton
```

## Error Handling Strategy

```
┌──────────────────────────────────────────────────────┐
│  Error Type           │  Handler                     │
├──────────────────────────────────────────────────────┤
│  Invalid input        │  Toast + suggest valid format│
│  NIP-05 failed        │  Toast + retry option        │
│  Extension not found  │  Toast + install link        │
│  NIP-46 connect fail  │  Toast + retry + manual      │
│  Read-only sign       │  Toast + upgrade prompt      │
│  Signer rejected      │  Toast + info                │
│  Network error        │  Toast + retry               │
└──────────────────────────────────────────────────────┘
```

## Security Boundaries

```
                    ┌─────────────────────┐
                    │   Grimoire App      │
                    │   (Trusted)         │
                    └──────────┬──────────┘
                               │
         ┌─────────────────────┼─────────────────────┐
         │                     │                     │
         ▼                     ▼                     ▼
┌────────────────┐   ┌────────────────┐   ┌────────────────┐
│ Browser Ext    │   │ Remote Signer  │   │ Android App    │
│ (Semi-Trusted) │   │ (Trusted)      │   │ (Trusted)      │
│                │   │                │   │                │
│ • Has keys     │   │ • Has keys     │   │ • Has keys     │
│ • User approves│   │ • User approves│   │ • User approves│
│ • Sandboxed    │   │ • Remote       │   │ • Separate dev │
└────────────────┘   └────────────────┘   └────────────────┘
         │                     │                     │
         │                     │                     │
         └─────────────────────┴─────────────────────┘
                               │
                    Never stored in Grimoire
                    (except read-only pubkeys)
```

## Performance Considerations

### Optimization Points

1. **Account List Rendering**:
   - Use virtual scrolling for 100+ accounts
   - Memoize account components
   - Lazy load profile metadata

2. **NIP-46 Connections**:
   - Maintain persistent connections
   - Connection pooling for multiple accounts
   - Reconnect with exponential backoff

3. **Profile Loading**:
   - Cache profile metadata in Dexie
   - Batch profile requests
   - Use stale-while-revalidate pattern

4. **Account Switching**:
   - Instant UI update (optimistic)
   - Load relays in background
   - Cancel in-flight requests from previous account

## Observability

### Events to Log

```javascript
// Account lifecycle
logger.info("account.added", { accountId, type });
logger.info("account.removed", { accountId });
logger.info("account.switched", { fromId, toId });

// NIP-46 connection
logger.info("nip46.connecting", { accountId, relays });
logger.info("nip46.connected", { accountId, duration });
logger.error("nip46.failed", { accountId, error });

// Signing
logger.info("sign.requested", { accountId, kind });
logger.info("sign.completed", { accountId, eventId });
logger.error("sign.rejected", { accountId, reason });
```

### Metrics to Track

- Account count by type
- Active account switch frequency
- NIP-46 connection success rate
- Sign request success rate
- Average connection duration

## Migration Path

### Existing Users

Current state (v1):
```json
{
  "active-account": "abc123...",
  "nostr-accounts": {
    "accounts": [
      {
        "id": "abc123...",
        "pubkey": "abc123...",
        "type": "extension"  // Old format
      }
    ]
  }
}
```

After migration (v2):
```json
{
  "active-account": "extension:abc123...",
  "nostr-accounts": {
    "accounts": [
      {
        "id": "extension:abc123...",  // New ID format
        "pubkey": "abc123...",
        "metadata": {
          "type": "extension"  // New metadata format
        }
      }
    ]
  }
}
```

Migration code in `src/services/accounts.ts`:
```typescript
// Detect old format and migrate
if (!account.metadata && account.type) {
  account.metadata = { type: account.type };
  delete account.type;
}
```

---

This architecture provides a clean separation of concerns, maintains security boundaries, and scales to support multiple login methods while keeping the implementation straightforward.
