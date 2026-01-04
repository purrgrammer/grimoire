# Multi-Account, Multi-Login Method Plan for Grimoire

## Overview

This document outlines the comprehensive plan for implementing multi-account support with multiple login methods in Grimoire. The implementation will support:

1. **Read-Only Accounts** - Login with pubkey/npub/nprofile/nip-05 (no signing capability)
2. **NIP-07 (Browser Extension)** - Existing, needs enhancement for multi-account
3. **NIP-46 (Nostr Connect/Bunker)** - Remote signing via relay communication
4. **NIP-55 (Android Signer)** - Android app signing (future consideration)

## Current State Analysis

### Existing Implementation

**Accounts Service** (`src/services/accounts.ts`):
- ✅ Uses `AccountManager` from `applesauce-accounts`
- ✅ Registers common account types via `registerCommonAccountTypes`
- ✅ Persists accounts to localStorage (`nostr-accounts` key)
- ✅ Persists active account to localStorage (`active-account` key)
- ✅ RxJS observables for reactive account updates (`accounts$`, `active$`)
- ❌ Only supports `ExtensionAccount` (NIP-07) currently

**User Menu** (`src/components/nostr/user-menu.tsx`):
- ✅ Shows active account with avatar and NIP-05
- ✅ Basic login/logout functionality for NIP-07
- ✅ Shows relay list from active account
- ❌ No account switching UI
- ❌ No multiple login method options
- ❌ No account management features

**State Management** (`src/core/state.ts`):
- ✅ Stores `activeAccount` with `pubkey` and `relays` in Jotai state
- ✅ Has `setActiveAccount()` and `setActiveAccountRelays()` functions
- ✅ Synced via `useAccountSync` hook

**Relay Infrastructure**:
- ✅ Singleton `RelayPool` (`src/services/relay-pool.ts`)
- ✅ Relay authentication state machine (`src/lib/auth-state-machine.ts`)
- ✅ Supports NIP-42 relay auth

### What's Missing

1. **Account Types**:
   - Read-only account implementation
   - NIP-46 account with relay pool integration
   - NIP-55 account (Android signer)

2. **Login Flows**:
   - Login command(s) to add accounts
   - Support for different input formats (npub, hex, nip-05, bunker URLs, etc.)
   - Error handling and validation

3. **Account Management**:
   - Switch between accounts
   - Remove accounts
   - View all accounts
   - Set account metadata (labels, colors)

4. **UI Components**:
   - Multi-account selector in user menu
   - Login dialog with method selection
   - Account management settings

## Architecture Design

### Account Type Hierarchy

```typescript
// All accounts will implement the base account interface from applesauce-accounts

1. ReadOnlyAccount
   - pubkey: string
   - signer: null
   - metadata: { type: 'readonly', source: 'npub' | 'nip05' | 'hex' | 'nprofile' }
   - Cannot sign events

2. ExtensionAccount (existing)
   - pubkey: string
   - signer: ExtensionSigner (NIP-07)
   - metadata: { type: 'extension' }
   - Signs via window.nostr

3. RemoteSignerAccount (NEW - NIP-46)
   - pubkey: string
   - signer: Nip46Signer
   - metadata: {
       type: 'remote',
       relays: string[],
       remotePubkey: string,
       connectionStatus: 'connected' | 'disconnected' | 'connecting'
     }
   - Requires relay pool integration
   - Persistent connection management

4. AndroidSignerAccount (FUTURE - NIP-55)
   - pubkey: string
   - signer: Nip55Signer
   - metadata: { type: 'android' }
   - Uses Android intent system
```

### Relay Pool Integration for NIP-46

NIP-46 signers need to communicate with remote signers via relays. This requires:

1. **Dedicated Relay Connections**:
   - NIP-46 signers maintain their own relay subscriptions
   - These are separate from user's content relays
   - Must persist across app reloads

2. **Connection Lifecycle**:
   ```typescript
   // On app start
   - Load all accounts from localStorage
   - For each RemoteSignerAccount:
     - Initialize Nip46Signer
     - Connect to specified relays
     - Subscribe to signer response events
     - Update connection status

   // On account activation
   - Ensure signer is connected
   - If disconnected, attempt reconnection

   // On account removal
   - Disconnect signer
   - Clean up relay subscriptions
   ```

3. **Integration Point**:
   - Extend `src/services/accounts.ts` to handle NIP-46 lifecycle
   - Add connection status monitoring
   - Emit connection events via observables

### Login Flow Design

#### Command: `/login` (or `login` in palette)

**Syntax**: `login [identifier]`

**Identifier Formats**:
- `npub1...` → Read-only account
- `hex pubkey` → Read-only account
- `user@domain.com` (NIP-05) → Resolve to pubkey, create read-only
- `nprofile1...` → Read-only with relay hints
- `bunker://pubkey?relay=...` → NIP-46 remote signer
- `nostrconnect://...` → NIP-46 remote signer
- (no argument) → Open login dialog with method selection

**Examples**:
```bash
login npub1abc...                    # Read-only from npub
login alice@nostr.com                # Read-only from NIP-05
login bunker://abc...?relay=wss://  # NIP-46 remote signer
login                                # Open dialog
```

#### Login Dialog UI

When `login` is called with no arguments, show a dialog:

```
┌─ Add Account ──────────────────────────────┐
│                                             │
│ Choose login method:                        │
│                                             │
│ [📱 Browser Extension (NIP-07)]            │
│ [👁️  Read-Only (View Mode)]                │
│ [🔗 Remote Signer (NIP-46)]                │
│ [🤖 Android App (NIP-55)]  (coming soon)   │
│                                             │
│ ─────────────────────────────────────────  │
│                                             │
│ Or paste any Nostr identifier:              │
│ ┌─────────────────────────────────────────┐│
│ │ npub, hex, nip-05, bunker://...         ││
│ └─────────────────────────────────────────┘│
│                                             │
│               [Cancel]  [Add Account]       │
└─────────────────────────────────────────────┘
```

**Method-Specific Flows**:

1. **Browser Extension**:
   - Check `window.nostr` availability
   - Request public key
   - Create ExtensionAccount
   - Add to AccountManager

2. **Read-Only**:
   - Show input for npub/hex/nip-05/nprofile
   - Validate and parse input
   - For NIP-05: Resolve to pubkey
   - Create ReadOnlyAccount
   - Add to AccountManager

3. **Remote Signer (NIP-46)**:
   - Show input for bunker URL or manual config
   - Parse bunker URL or collect: pubkey, relays, secret
   - Create Nip46Signer
   - Attempt connection
   - Show connection status
   - On success: Create RemoteSignerAccount
   - Add to AccountManager

4. **Android Signer (NIP-55)** (future):
   - Show QR code or deep link
   - Wait for Android app response
   - Create AndroidSignerAccount

### Account Management Features

#### Command: `/accounts` (or `accounts` in palette)

Opens an account management window showing:
- List of all accounts with type badges
- Active account indicator
- Quick actions: Switch, Remove, Set Label
- Connection status for NIP-46 accounts

#### User Menu Enhancements

**Current Active Account Section**:
```
┌─ User Menu ────────────────────────┐
│ ● Alice (alice@nostr.com)           │ ← Active account with indicator
│   via Browser Extension             │ ← Account type
│                                     │
│ ─────────────────────────────────  │
│ Accounts (3):                       │
│ ● Alice (Browser Extension)         │ ← Active
│   Bob (Read-Only)                   │
│   Carol (Remote Signer) 🟢         │ ← Connection status
│                                     │
│ ─────────────────────────────────  │
│ + Add Account                       │
│ ⚙ Manage Accounts                  │
│                                     │
│ ─────────────────────────────────  │
│ Relays (if active account)          │
│ ...                                 │
│                                     │
│ ─────────────────────────────────  │
│ Log Out                             │ ← Removes active account
└─────────────────────────────────────┘
```

**Account Actions**:
- Click account → Switch to that account
- Hover → Show quick actions (Remove, Rename)
- Badge colors:
  - 🟢 Green = Connected (NIP-46)
  - 🔴 Red = Disconnected (NIP-46)
  - 🔵 Blue = Extension available
  - ⚪ Gray = Read-only

### State Management Changes

#### Extend `GrimoireState` type:

```typescript
type GrimoireState = {
  // ... existing fields
  activeAccount?: {
    pubkey: string;
    relays: RelayInfo[];
    accountType: 'readonly' | 'extension' | 'remote' | 'android'; // NEW
    label?: string; // NEW - user-defined label
  }
}
```

#### Sync with AccountManager:

The `useAccountSync` hook should be enhanced to:
1. Subscribe to `accounts.active$` observable
2. When active account changes:
   - Get account type from account metadata
   - Update `state.activeAccount`
   - Load relays from account or relay list cache
3. When active account removed:
   - Clear `state.activeAccount`
   - Clear active windows if needed

### Services Architecture

#### Enhanced `src/services/accounts.ts`:

```typescript
import { AccountManager } from "applesauce-accounts";
import { registerCommonAccountTypes } from "applesauce-accounts/accounts";
import { ReadOnlyAccount, RemoteSignerAccount } from "@/lib/account-types"; // NEW
import pool from "@/services/relay-pool";

const accountManager = new AccountManager();

// Register all account types
registerCommonAccountTypes(accountManager);
accountManager.registerAccountType("readonly", ReadOnlyAccount); // NEW
accountManager.registerAccountType("remote", RemoteSignerAccount); // NEW

// ... existing localStorage sync code

// NEW: Initialize NIP-46 connections
function initializeRemoteSigners() {
  accountManager.accounts$.subscribe((accounts) => {
    accounts.forEach((account) => {
      if (account.metadata?.type === 'remote') {
        const signer = account.signer as Nip46Signer;
        if (!signer.isConnected()) {
          signer.connect().catch(console.error);
        }
      }
    });
  });
}

initializeRemoteSigners();

export default accountManager;
```

#### New file: `src/lib/account-types.ts`:

```typescript
import type { Account } from "applesauce-accounts";
import { Nip46Signer } from "applesauce-signers";
import { nip19 } from "nostr-tools";
import { resolveNip05 } from "@/lib/nip05";
import pool from "@/services/relay-pool";

/**
 * Read-only account - no signing capability
 */
export class ReadOnlyAccount implements Account {
  id: string;
  pubkey: string;
  signer = null;
  metadata: {
    type: 'readonly';
    source: 'npub' | 'nip05' | 'hex' | 'nprofile';
    originalInput: string;
    relays?: string[]; // from nprofile
  };

  constructor(pubkey: string, source: string, metadata: any) {
    this.id = `readonly:${pubkey}`;
    this.pubkey = pubkey;
    this.metadata = { type: 'readonly', ...metadata };
  }

  toJSON() {
    return {
      id: this.id,
      pubkey: this.pubkey,
      metadata: this.metadata,
    };
  }

  static fromJSON(data: any): ReadOnlyAccount {
    return new ReadOnlyAccount(data.pubkey, data.metadata.source, data.metadata);
  }

  // Factory methods
  static async fromNpub(npub: string): Promise<ReadOnlyAccount> {
    const decoded = nip19.decode(npub);
    if (decoded.type !== 'npub') throw new Error('Invalid npub');
    return new ReadOnlyAccount(decoded.data, 'npub', { originalInput: npub });
  }

  static async fromNip05(nip05: string): Promise<ReadOnlyAccount> {
    const pubkey = await resolveNip05(nip05);
    if (!pubkey) throw new Error('NIP-05 resolution failed');
    return new ReadOnlyAccount(pubkey, 'nip05', { originalInput: nip05 });
  }

  static async fromNprofile(nprofile: string): Promise<ReadOnlyAccount> {
    const decoded = nip19.decode(nprofile);
    if (decoded.type !== 'nprofile') throw new Error('Invalid nprofile');
    return new ReadOnlyAccount(decoded.data.pubkey, 'nprofile', {
      originalInput: nprofile,
      relays: decoded.data.relays,
    });
  }

  static fromHex(hex: string): ReadOnlyAccount {
    if (!/^[0-9a-f]{64}$/.test(hex)) throw new Error('Invalid hex pubkey');
    return new ReadOnlyAccount(hex, 'hex', { originalInput: hex });
  }
}

/**
 * Remote signer account (NIP-46)
 */
export class RemoteSignerAccount implements Account {
  id: string;
  pubkey: string;
  signer: Nip46Signer;
  metadata: {
    type: 'remote';
    relays: string[];
    remotePubkey: string;
    connectionStatus: 'connected' | 'disconnected' | 'connecting';
  };

  constructor(pubkey: string, signer: Nip46Signer, relays: string[], remotePubkey: string) {
    this.id = `remote:${pubkey}`;
    this.pubkey = pubkey;
    this.signer = signer;
    this.metadata = {
      type: 'remote',
      relays,
      remotePubkey,
      connectionStatus: 'disconnected',
    };

    // Monitor connection status
    this.signer.on('connected', () => {
      this.metadata.connectionStatus = 'connected';
    });
    this.signer.on('disconnected', () => {
      this.metadata.connectionStatus = 'disconnected';
    });
  }

  toJSON() {
    return {
      id: this.id,
      pubkey: this.pubkey,
      metadata: this.metadata,
    };
  }

  static fromJSON(data: any): RemoteSignerAccount {
    // Reconstruct signer from saved metadata
    const signer = new Nip46Signer({
      remotePubkey: data.metadata.remotePubkey,
      relays: data.metadata.relays,
      pool, // Use singleton relay pool
    });

    return new RemoteSignerAccount(
      data.pubkey,
      signer,
      data.metadata.relays,
      data.metadata.remotePubkey
    );
  }

  // Factory method from bunker URL
  static async fromBunkerUrl(bunkerUrl: string): Promise<RemoteSignerAccount> {
    const parsed = parseBunkerUrl(bunkerUrl); // Parse bunker:// URL

    const signer = new Nip46Signer({
      remotePubkey: parsed.pubkey,
      relays: parsed.relays,
      secret: parsed.secret,
      pool, // Use singleton relay pool
    });

    // Connect and get pubkey
    await signer.connect();
    const pubkey = await signer.getPublicKey();

    return new RemoteSignerAccount(pubkey, signer, parsed.relays, parsed.pubkey);
  }

  async disconnect() {
    await this.signer.disconnect();
  }
}

// Helper to parse bunker URLs
function parseBunkerUrl(url: string) {
  // bunker://pubkey?relay=wss://...&relay=wss://...&secret=...
  const parsed = new URL(url);
  return {
    pubkey: parsed.pathname.replace('//', ''),
    relays: parsed.searchParams.getAll('relay'),
    secret: parsed.searchParams.get('secret'),
  };
}
```

#### New file: `src/lib/login-parser.ts`:

Parser for the `/login` command to detect input type and create appropriate account.

```typescript
import { nip19 } from "nostr-tools";
import { isNip05 } from "@/lib/nip05";
import { ReadOnlyAccount, RemoteSignerAccount } from "@/lib/account-types";

export type LoginInputType =
  | 'npub'
  | 'nprofile'
  | 'nip05'
  | 'hex'
  | 'bunker'
  | 'extension'
  | 'unknown';

/**
 * Detect the type of login input
 */
export function detectLoginInputType(input: string): LoginInputType {
  if (!input || input.trim() === '') return 'extension'; // Default to extension

  const trimmed = input.trim();

  // NIP-19 encoded
  if (trimmed.startsWith('npub1')) return 'npub';
  if (trimmed.startsWith('nprofile1')) return 'nprofile';

  // Bunker URL
  if (trimmed.startsWith('bunker://')) return 'bunker';
  if (trimmed.startsWith('nostrconnect://')) return 'bunker';

  // NIP-05
  if (isNip05(trimmed)) return 'nip05';

  // Hex pubkey (64 char hex string)
  if (/^[0-9a-f]{64}$/i.test(trimmed)) return 'hex';

  return 'unknown';
}

/**
 * Create an account from login input
 */
export async function createAccountFromInput(input: string) {
  const type = detectLoginInputType(input);

  switch (type) {
    case 'npub':
      return await ReadOnlyAccount.fromNpub(input);

    case 'nprofile':
      return await ReadOnlyAccount.fromNprofile(input);

    case 'nip05':
      return await ReadOnlyAccount.fromNip05(input);

    case 'hex':
      return ReadOnlyAccount.fromHex(input);

    case 'bunker':
      return await RemoteSignerAccount.fromBunkerUrl(input);

    case 'extension':
      // Handle in UI - requires window.nostr
      throw new Error('Extension login requires UI interaction');

    default:
      throw new Error(`Unknown input format: ${input}`);
  }
}
```

### Commands

#### 1. `/login [identifier]`

**Location**: `src/types/man.ts` + `src/lib/login-parser.ts`

**Parser**:
```typescript
export async function parseLoginCommand(args: string[]) {
  const input = args.join(' ').trim();

  if (!input) {
    // No args - open login dialog
    return { action: 'open-dialog' };
  }

  // Try to create account from input
  try {
    const account = await createAccountFromInput(input);
    return { action: 'add-account', account };
  } catch (error) {
    return { action: 'error', message: error.message };
  }
}
```

**App ID**: `login-dialog` (shows login method selection)

#### 2. `/accounts`

**Location**: `src/types/man.ts`

Opens account management window showing all accounts with actions.

**App ID**: `account-manager`

#### 3. `/logout`

**Location**: `src/types/man.ts`

Removes the active account (or all accounts if flag provided).

```typescript
export function parseLogoutCommand(args: string[]) {
  const all = args.includes('--all');
  return { all };
}
```

### UI Components

#### 1. Login Dialog (`src/components/LoginDialog.tsx`)

- Method selection buttons
- Smart input field (auto-detects format)
- Extension availability indicator
- Connection status for NIP-46
- Error handling and validation feedback

#### 2. Account Manager Window (`src/components/AccountManager.tsx`)

- List of all accounts with type badges
- Active account highlight
- Switch account button
- Remove account button (with confirmation)
- Edit label button
- Connection status for NIP-46
- Add account button (opens login dialog)

#### 3. Enhanced User Menu (`src/components/nostr/user-menu.tsx`)

**Changes**:
- Show account type badge next to avatar
- Dropdown shows all accounts (not just active)
- Click account to switch
- "Add Account" option
- "Manage Accounts" option
- Connection status indicators

```typescript
export default function UserMenu() {
  const accounts = useObservableMemo(() => accountManager.accounts$, []);
  const activeAccount = useObservableMemo(() => accountManager.active$, []);
  const [showLoginDialog, setShowLoginDialog] = useState(false);

  async function switchAccount(account: Account) {
    accountManager.setActive(account);
  }

  async function addAccount() {
    setShowLoginDialog(true);
  }

  // ... render with all accounts
}
```

## Implementation Steps

### Phase 1: Read-Only Accounts (Priority 1)

**Goal**: Users can add read-only accounts to browse Nostr without signing.

1. ✅ Create `ReadOnlyAccount` class in `src/lib/account-types.ts`
2. ✅ Create `src/lib/login-parser.ts` with input detection
3. ✅ Add login command to `src/types/man.ts`
4. ✅ Create `LoginDialog` component
5. ✅ Enhance user menu to show all accounts
6. ✅ Add account switching logic
7. ✅ Test with npub, hex, nip-05, nprofile

**Deliverable**: Users can `login npub1...` to add read-only accounts and switch between them.

### Phase 2: Account Management UI (Priority 2)

**Goal**: Users can manage multiple accounts via UI.

1. ✅ Create `AccountManager` window component
2. ✅ Add `/accounts` command
3. ✅ Add account labels/metadata support
4. ✅ Add remove account functionality
5. ✅ Enhance user menu dropdown
6. ✅ Add account type badges and icons
7. ✅ Polish UX and animations

**Deliverable**: Full account management interface with switching and removal.

### Phase 3: NIP-46 Remote Signer (Priority 3)

**Goal**: Users can connect remote signers for secure key management.

1. ✅ Create `RemoteSignerAccount` class
2. ✅ Integrate `Nip46Signer` with relay pool
3. ✅ Add connection lifecycle management
4. ✅ Add bunker URL parsing
5. ✅ Add connection status indicators
6. ✅ Test with bunker URLs
7. ✅ Add reconnection logic
8. ✅ Handle connection errors gracefully

**Deliverable**: Users can `login bunker://...` to add remote signers.

### Phase 4: NIP-55 Android Signer (Priority 4 - Future)

**Goal**: Android app signing support.

1. Research NIP-55 implementation patterns
2. Create `AndroidSignerAccount` class
3. Add Android intent handling
4. Add QR code / deep link support
5. Test with Android signer apps

**Deliverable**: Users can sign via Android apps.

## Testing Checklist

### Unit Tests

- [ ] `login-parser.ts` - All input format detection
- [ ] `ReadOnlyAccount` - Factory methods
- [ ] `RemoteSignerAccount` - Connection lifecycle
- [ ] Account type serialization/deserialization

### Integration Tests

- [ ] Add read-only account → Switch → Works
- [ ] Add extension account → Switch → Signs events
- [ ] Add NIP-46 account → Connect → Signs events
- [ ] Remove account → State cleanup
- [ ] Multiple accounts → Persistence across reload

### E2E Scenarios

1. **Read-Only Flow**:
   - Login with npub → View profile → Cannot sign → Works

2. **Multi-Account Extension**:
   - Login with extension → Add another npub → Switch between → Active account updates

3. **NIP-46 Connection**:
   - Login with bunker URL → Connect → Sign event → Disconnect → Reconnect → Works

4. **Account Management**:
   - Add 3 accounts → Label them → Remove one → Switch active → Persist → Reload → Still works

## Migration Notes

### Existing Users

Users who already have an `ExtensionAccount` from the current implementation:

1. **No Breaking Changes**: Existing accounts will continue to work
2. **Automatic Migration**: Accounts will be loaded from localStorage
3. **Enhanced Features**: Existing accounts gain new features (labels, management UI)

### LocalStorage Keys

- `nostr-accounts` - All accounts (unchanged)
- `active-account` - Active account ID (unchanged)

## Security Considerations

1. **Read-Only Accounts**:
   - ✅ No private key stored
   - ✅ Cannot sign events
   - ✅ Safe for public viewing

2. **Extension Accounts**:
   - ✅ Keys managed by extension
   - ✅ User approves each signature
   - ⚠️ Trust extension security

3. **NIP-46 Accounts**:
   - ✅ Private keys never touch browser
   - ✅ Remote signer controls security
   - ⚠️ Relay communication must be encrypted
   - ⚠️ Verify bunker URL authenticity
   - ⚠️ Connection secrets must be secured

4. **Android Signer**:
   - ✅ Keys stay on mobile device
   - ✅ User approves each signature
   - ⚠️ Intent system security

### Best Practices

- Never log or expose connection secrets
- Validate all input formats before processing
- Show clear connection status for NIP-46
- Warn users about bunker URL authenticity
- Encrypt NIP-46 relay communication (enforced by NIP-46 spec)

## Open Questions

1. **Account Labels**: Auto-generate from NIP-05/profile or require user input?
   - **Decision**: Auto-generate, allow user to edit

2. **Default Account**: When adding first account, auto-activate?
   - **Decision**: Yes, auto-activate first account

3. **Extension Detection**: Prompt to install extension if not found?
   - **Decision**: Show helpful message with extension links

4. **NIP-46 Relays**: Allow user to configure or use defaults from bunker URL?
   - **Decision**: Use bunker URL relays, allow manual override in settings

5. **Account Icons**: Use profile pictures or type icons?
   - **Decision**: Profile pictures with type badge overlay

6. **Signing Errors**: How to handle when read-only account tries to sign?
   - **Decision**: Show clear error with upgrade prompt to add signing account

## Success Criteria

1. ✅ Users can add accounts via `/login [identifier]`
2. ✅ Users can switch between accounts seamlessly
3. ✅ Users can manage accounts (add, remove, label)
4. ✅ Read-only accounts work for viewing
5. ✅ NIP-46 accounts connect and sign
6. ✅ Account state persists across reloads
7. ✅ Connection status visible for NIP-46
8. ✅ All NIPs properly implemented (05, 07, 46, 55)

## Future Enhancements

1. **Account Groups**: Organize accounts by category
2. **Quick Switch**: Keyboard shortcut to switch accounts
3. **Account Sync**: Sync accounts across devices (encrypted)
4. **Multi-Sig**: Support for multi-signature accounts
5. **Hardware Wallets**: Support for hardware signer devices
6. **Account Delegation**: NIP-26 delegation support
7. **Session Management**: Temporary sessions without persistence
8. **Account Import/Export**: Backup and restore accounts

## References

- **NIP-05**: Mapping Nostr keys to DNS-based internet identifiers
- **NIP-07**: window.nostr capability for web browsers
- **NIP-46**: Nostr Connect (remote signing)
- **NIP-55**: Android Signer Application
- **applesauce-accounts**: Account management library
- **applesauce-signers**: Signer abstraction library
