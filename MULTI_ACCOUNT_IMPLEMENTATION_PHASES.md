# Multi-Account Implementation Phases

Quick reference for implementing multi-account support in Grimoire.

## Phase 1: Read-Only Accounts (Week 1)

### Files to Create

1. **`src/lib/account-types.ts`** - Account class implementations
   ```typescript
   export class ReadOnlyAccount implements Account {
     // Factory methods: fromNpub, fromNip05, fromHex, fromNprofile
   }
   ```

2. **`src/lib/login-parser.ts`** - Input detection and parsing
   ```typescript
   export function detectLoginInputType(input: string): LoginInputType
   export async function createAccountFromInput(input: string)
   ```

3. **`src/components/LoginDialog.tsx`** - Login method selection UI
   - Method buttons (Extension, Read-Only, Remote, Android)
   - Smart input field with auto-detection
   - Error handling

### Files to Modify

1. **`src/services/accounts.ts`** - Register new account types
   ```typescript
   accountManager.registerAccountType("readonly", ReadOnlyAccount);
   ```

2. **`src/types/man.ts`** - Add login command
   ```typescript
   login: {
     appId: "login-dialog",
     argParser: parseLoginCommand,
     // ...
   }
   ```

3. **`src/components/nostr/user-menu.tsx`** - Show all accounts
   - Subscribe to `accounts.accounts$` for all accounts
   - Add click handler to switch accounts
   - Add "Add Account" button

### Testing Tasks

- [ ] `login npub1...` creates read-only account
- [ ] `login alice@nostr.com` resolves NIP-05 and creates account
- [ ] `login <hex>` creates read-only account
- [ ] `login nprofile1...` creates account with relay hints
- [ ] Account switching updates active state
- [ ] Accounts persist across page reload

---

## Phase 2: Account Management UI (Week 2)

### Files to Create

1. **`src/components/AccountManager.tsx`** - Full account management window
   - List all accounts with type badges
   - Switch, remove, edit label actions
   - Connection status for NIP-46
   - Add account button

2. **`src/components/ui/account-badge.tsx`** - Account type badge component
   - Extension icon (🔌)
   - Read-only icon (👁️)
   - Remote signer icon (🔗)
   - Android icon (🤖)

### Files to Modify

1. **`src/types/man.ts`** - Add accounts and logout commands
   ```typescript
   accounts: {
     appId: "account-manager",
     // ...
   },
   logout: {
     argParser: parseLogoutCommand,
     // ...
   }
   ```

2. **`src/core/state.ts`** - Add account metadata fields
   ```typescript
   activeAccount?: {
     // ... existing fields
     accountType: 'readonly' | 'extension' | 'remote' | 'android';
     label?: string;
   }
   ```

3. **`src/hooks/useAccountSync.ts`** - Sync account type and label

### Testing Tasks

- [ ] `/accounts` opens management window
- [ ] Can switch accounts from manager
- [ ] Can remove accounts (with confirmation)
- [ ] Can edit account labels
- [ ] Account type badges display correctly
- [ ] `/logout` removes active account

---

## Phase 3: NIP-46 Remote Signer (Week 3)

### Files to Create

1. **`src/lib/bunker-url.ts`** - Bunker URL parsing utilities
   ```typescript
   export function parseBunkerUrl(url: string)
   export function isValidBunkerUrl(url: string): boolean
   ```

### Files to Modify

1. **`src/lib/account-types.ts`** - Add RemoteSignerAccount
   ```typescript
   export class RemoteSignerAccount implements Account {
     signer: Nip46Signer;
     // Connection lifecycle management
     static async fromBunkerUrl(url: string)
   }
   ```

2. **`src/services/accounts.ts`** - Initialize NIP-46 connections
   ```typescript
   function initializeRemoteSigners() {
     // Connect all NIP-46 signers on app start
   }
   ```

3. **`src/lib/login-parser.ts`** - Handle bunker URLs
   ```typescript
   case 'bunker':
     return await RemoteSignerAccount.fromBunkerUrl(input);
   ```

4. **`src/components/LoginDialog.tsx`** - Show connection status
   - Loading indicator during connection
   - Success/error feedback
   - Relay status

5. **`src/components/AccountManager.tsx`** - Connection indicators
   - 🟢 Connected
   - 🔴 Disconnected
   - 🟡 Connecting

### Integration Tasks

- [ ] Hook Nip46Signer with singleton relay pool
- [ ] Monitor connection status via observables
- [ ] Auto-reconnect on disconnect
- [ ] Handle connection errors gracefully
- [ ] Clean up relay subscriptions on account removal

### Testing Tasks

- [ ] `login bunker://...` connects to remote signer
- [ ] Can sign events with remote signer
- [ ] Connection status updates in real-time
- [ ] Reconnects after page reload
- [ ] Handles relay failures gracefully
- [ ] Cleans up connections on logout

---

## Phase 4: NIP-55 Android Signer (Future)

### Research Phase

1. Study NIP-55 specification
2. Find reference implementations
3. Test with Android signer apps
4. Design intent/deep link flow

### Files to Create

1. **`src/lib/account-types.ts`** - AndroidSignerAccount
2. **`src/lib/nip55-handler.ts`** - Android intent handling
3. **`src/components/AndroidSignerSetup.tsx`** - QR code / deep link UI

### Testing Tasks

- [ ] Generate signing request intent
- [ ] Handle response from Android app
- [ ] Sign events via Android signer
- [ ] Handle errors and timeouts

---

## Critical Implementation Notes

### 1. Relay Pool Integration (NIP-46)

NIP-46 signers need to communicate with the relay pool. Two approaches:

**Option A: Separate Pool (Recommended)**
```typescript
// Each Nip46Signer maintains its own relay connections
const signer = new Nip46Signer({
  remotePubkey,
  relays,
  // Creates internal relay connections
});
```

**Option B: Shared Pool**
```typescript
import pool from "@/services/relay-pool";

const signer = new Nip46Signer({
  remotePubkey,
  relays,
  pool, // Pass singleton pool
});
```

**Decision**: Check applesauce-signers API - use Option B if supported, otherwise Option A.

### 2. Account Serialization

When saving to localStorage, NIP-46 accounts need special handling:

```typescript
// Save
toJSON() {
  return {
    id: this.id,
    pubkey: this.pubkey,
    metadata: {
      type: 'remote',
      relays: this.metadata.relays,
      remotePubkey: this.metadata.remotePubkey,
      // DON'T save signer instance or connection secrets
    }
  };
}

// Load
static fromJSON(data: any) {
  // Recreate signer from metadata
  const signer = new Nip46Signer({
    remotePubkey: data.metadata.remotePubkey,
    relays: data.metadata.relays,
  });

  const account = new RemoteSignerAccount(/* ... */);

  // Connect asynchronously after creation
  account.connect().catch(console.error);

  return account;
}
```

### 3. Error Handling Patterns

**Read-Only Signing Attempt**:
```typescript
async function publishNote(content: string) {
  const account = accountManager.active;

  if (!account?.signer) {
    toast.error("Cannot sign", {
      description: "This is a read-only account. Add a signing account to publish.",
      action: {
        label: "Add Account",
        onClick: () => openLoginDialog()
      }
    });
    return;
  }

  // Proceed with signing
}
```

**NIP-46 Connection Failure**:
```typescript
async function connectRemoteSigner(account: RemoteSignerAccount) {
  try {
    await account.signer.connect();
    toast.success("Connected to remote signer");
  } catch (error) {
    toast.error("Connection failed", {
      description: error.message,
      action: {
        label: "Retry",
        onClick: () => connectRemoteSigner(account)
      }
    });
  }
}
```

### 4. Account Sync Hook Enhancement

```typescript
// src/hooks/useAccountSync.ts
export function useAccountSync() {
  const { setActiveAccount } = useGrimoire();
  const eventStore = useEventStore();

  useEffect(() => {
    const sub = accountManager.active$.subscribe(async (account) => {
      if (!account) {
        setActiveAccount(undefined);
        return;
      }

      // Get account type from metadata
      const accountType = account.metadata?.type || 'extension';

      // Load relays from relay list cache or NIP-65
      const relays = await loadRelaysForPubkey(account.pubkey, eventStore);

      setActiveAccount({
        pubkey: account.pubkey,
        relays,
        accountType,
        label: account.metadata?.label,
      });
    });

    return () => sub.unsubscribe();
  }, [setActiveAccount, eventStore]);
}
```

---

## Testing Strategy

### Unit Tests

Create test files alongside implementation:

- `src/lib/account-types.test.ts`
- `src/lib/login-parser.test.ts`
- `src/lib/bunker-url.test.ts`

### Integration Tests

Test account lifecycle:

```typescript
describe("Account Management", () => {
  it("should add read-only account", async () => {
    const account = await createAccountFromInput("npub1...");
    accountManager.addAccount(account);
    expect(accountManager.accounts.length).toBe(1);
  });

  it("should switch accounts", () => {
    const account1 = /* ... */;
    const account2 = /* ... */;

    accountManager.addAccount(account1);
    accountManager.addAccount(account2);

    accountManager.setActive(account2);
    expect(accountManager.active).toBe(account2);
  });
});
```

### Manual Testing Checklist

**Phase 1**:
- [ ] Login with npub works
- [ ] Login with NIP-05 works
- [ ] Login with hex works
- [ ] Login with nprofile works
- [ ] Can switch between accounts
- [ ] Accounts persist after reload
- [ ] Read-only accounts cannot sign

**Phase 2**:
- [ ] Account manager shows all accounts
- [ ] Can remove accounts
- [ ] Can edit labels
- [ ] Type badges display correctly
- [ ] Active account highlighted

**Phase 3**:
- [ ] Bunker URL parsing works
- [ ] Remote signer connects
- [ ] Can sign with remote signer
- [ ] Connection status accurate
- [ ] Reconnects after reload
- [ ] Handles disconnects gracefully

---

## Quick Start Guide

### To implement Phase 1 today:

1. **Create account types**:
   ```bash
   # Create the file
   touch src/lib/account-types.ts
   # Implement ReadOnlyAccount class
   ```

2. **Create login parser**:
   ```bash
   touch src/lib/login-parser.ts
   # Implement detectLoginInputType and createAccountFromInput
   ```

3. **Add login command**:
   ```typescript
   // In src/types/man.ts
   login: {
     description: "Add a new account",
     argParser: async (args) => {
       const input = args.join(' ').trim();
       if (!input) return { showDialog: true };
       const account = await createAccountFromInput(input);
       return { account };
     },
     // ...
   }
   ```

4. **Test it**:
   ```bash
   npm run dev
   # In app: login npub1...
   ```

### Estimated Timeline

- **Phase 1**: 3-5 days (read-only accounts + basic switching)
- **Phase 2**: 2-3 days (account management UI)
- **Phase 3**: 5-7 days (NIP-46 integration + testing)
- **Phase 4**: TBD (future)

**Total**: ~2 weeks for full multi-account support with NIP-46.

---

## Next Steps

1. **Start with Phase 1**: Read-only accounts
2. **Create PR**: Get feedback on architecture
3. **Iterate**: Based on testing and feedback
4. **Phase 2**: Add management UI
5. **Phase 3**: NIP-46 integration
6. **Polish**: UX improvements and edge cases

Let's build this step by step! 🚀
