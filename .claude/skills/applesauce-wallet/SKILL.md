---
name: applesauce-wallet
description: This skill should be used when building NIP-60 Cashu wallets using the applesauce-wallet package. Covers wallet actions (CreateWallet, UnlockWallet, ReceiveNutzaps, TokensOperation), casts (Wallet, WalletToken, Nutzap), helpers (IndexedDBCouch), and integration with the applesauce ecosystem.
---

# applesauce-wallet Package

## Purpose

This skill provides expert-level assistance with `applesauce-wallet`, a TypeScript package for building NIP-60 Cashu wallets and NIP-61 nutzaps on Nostr. Part of the applesauce ecosystem by hzrd149.

## When to Use

Activate this skill when:
- Building a NIP-60 wallet with applesauce
- Implementing nutzap sending/receiving
- Managing Cashu tokens on Nostr
- Working with wallet actions and casts
- Integrating wallet functionality into a Nostr client

## Installation

```bash
npm install applesauce-wallet
# Also need related packages:
npm install applesauce-core applesauce-actions applesauce-react @cashu/cashu-ts
```

## Package Structure

### Imports

```typescript
// Actions - wallet operations
import {
  CreateWallet,
  UnlockWallet,
  ReceiveNutzaps,
  ReceiveToken,
  ConsolidateTokens,
  RecoverFromCouch,
  SetWalletMints,
  SetWalletRelays,
  AddNutzapInfoMint,
  RemoveNutzapInfoMint,
  TokensOperation,
} from "applesauce-wallet/actions";

// Casts - reactive data wrappers
import {
  Wallet,
  WalletToken,
  WalletHistory,
  Nutzap,
} from "applesauce-wallet/casts";

// Helpers - utilities and constants
import {
  getWalletRelays,
  IndexedDBCouch,
  WALLET_KIND,
  WALLET_TOKEN_KIND,
  WALLET_HISTORY_KIND,
  NUTZAP_KIND,
} from "applesauce-wallet/helpers";

// IMPORTANT: Import casts to enable user.wallet$ property
import "applesauce-wallet/casts";
```

## Event Kind Constants

```typescript
const WALLET_KIND = 17375;         // Wallet configuration
const WALLET_TOKEN_KIND = 7375;    // Token storage
const WALLET_HISTORY_KIND = 7376;  // Spending history
const NUTZAP_KIND = 9321;          // Nutzap events
const NUTZAP_INFO_KIND = 10019;    // Nutzap recipient info
```

## Core Setup

### Prerequisites

```typescript
import { EventStore, EventFactory } from "applesauce-core";
import { ActionRunner } from "applesauce-actions";
import { RelayPool } from "applesauce-relay";
import { ProxySigner } from "applesauce-accounts";
import { persistEncryptedContent } from "applesauce-common/helpers";
import { IndexedDBCouch } from "applesauce-wallet/helpers";

// Create singletons
const eventStore = new EventStore();
const pool = new RelayPool();
const couch = new IndexedDBCouch();

// Setup encrypted content persistence
const storage$ = new BehaviorSubject<SecureStorage | null>(null);
persistEncryptedContent(eventStore, storage$.pipe(defined()));

// Create action runner
const factory = new EventFactory({
  signer: new ProxySigner(signer$.pipe(defined()))
});

const actions = new ActionRunner(eventStore, factory, async (event) => {
  // Publish handler - determine relays and publish
  const relays = getPublishRelays(event);
  await pool.publish(relays, event);
});
```

## Wallet Casts

### Wallet

The main wallet cast provides reactive observables for wallet state.

```typescript
import { castUser } from "applesauce-common/casts";
import "applesauce-wallet/casts"; // Enable wallet$ property

const user = castUser(pubkey, eventStore);

// Access wallet
const wallet = use$(user.wallet$);

// Wallet properties (all are observables)
wallet.unlocked        // boolean - whether wallet is decrypted
wallet.mints$          // string[] - configured mints
wallet.relays$         // string[] - wallet relays
wallet.balance$        // { [mint: string]: number } - balance by mint
wallet.tokens$         // WalletToken[] - all token events
wallet.received$       // string[] - received nutzap IDs
```

### WalletToken

Represents a kind:7375 token event.

```typescript
interface WalletToken {
  id: string;              // Event ID
  event: NostrEvent;       // Raw event
  unlocked: boolean;       // Is content decrypted
  mint?: string;           // Mint URL (when unlocked)
  proofs?: Proof[];        // Cashu proofs (when unlocked)
  seen?: string[];         // Relays where seen

  // Observables
  meta$: Observable<TokenMeta>;   // Parsed metadata
  amount$: Observable<number>;    // Total amount
}
```

### WalletHistory

Represents a kind:7376 history event.

```typescript
interface WalletHistory {
  id: string;
  event: NostrEvent;
  unlocked: boolean;

  // Observable
  meta$: Observable<{
    direction: "in" | "out";
    amount: number;
    mint?: string;
    unit?: string;
  }>;
}
```

### Nutzap

Represents a kind:9321 nutzap event.

```typescript
interface Nutzap {
  id: string;
  event: NostrEvent;
  amount: number;           // Total nutzap amount
  mint?: string;            // Mint URL
  comment?: string;         // Message content
  createdAt: Date;          // Event timestamp

  // Cast references
  sender: User;             // Sender user cast

  // Observables
  zapped$: Observable<NostrEvent | undefined>;  // Referenced event
}
```

## User Extensions

When you import `"applesauce-wallet/casts"`, the User cast is extended with:

```typescript
// Available on User cast
user.wallet$      // Observable<Wallet | undefined>
user.nutzap$      // Observable<NutzapInfo | undefined>

// NutzapInfo structure
interface NutzapInfo {
  mints: Array<{ mint: string; units: string[] }>;
  relays?: string[];
  pubkey?: string;  // P2PK pubkey for receiving
}
```

## Wallet Actions

### CreateWallet

Creates a new NIP-60 wallet.

```typescript
import { CreateWallet } from "applesauce-wallet/actions";
import { generateSecretKey } from "nostr-tools";

await actions.run(CreateWallet, {
  mints: ["https://mint1.example.com", "https://mint2.example.com"],
  privateKey: generateSecretKey(),  // For nutzap reception (optional)
  relays: ["wss://relay1.example.com", "wss://relay2.example.com"]
});
```

### UnlockWallet

Decrypts wallet content using NIP-44.

```typescript
import { UnlockWallet } from "applesauce-wallet/actions";

await actions.run(UnlockWallet, {
  history: true,   // Also unlock history events
  tokens: true     // Also unlock token events
});
```

### ReceiveToken

Receives a Cashu token and adds it to the wallet.

```typescript
import { ReceiveToken } from "applesauce-wallet/actions";
import { getDecodedToken } from "@cashu/cashu-ts";

const token = getDecodedToken(tokenString);
await actions.run(ReceiveToken, token, { couch });
```

### ReceiveNutzaps

Claims one or more nutzap events.

```typescript
import { ReceiveNutzaps } from "applesauce-wallet/actions";

// Single nutzap
await actions.run(ReceiveNutzaps, nutzapEvent, couch);

// Multiple nutzaps
const nutzapEvents = nutzaps.map(n => n.event);
await actions.run(ReceiveNutzaps, nutzapEvents, couch);
```

### TokensOperation

Generic operation on wallet tokens. Used for sending, swapping, etc.

```typescript
import { TokensOperation } from "applesauce-wallet/actions";

await actions.run(
  TokensOperation,
  amount,  // Amount to operate on
  async ({ selectedProofs, mint, cashuWallet }) => {
    // cashuWallet is a @cashu/cashu-ts Wallet instance
    const { keep, send } = await cashuWallet.ops
      .send(amount, selectedProofs)
      .run();

    return {
      change: keep.length > 0 ? keep : undefined
    };
  },
  { mint: selectedMint, couch }  // Options
);
```

### SetWalletMints

Updates the wallet's configured mints.

```typescript
import { SetWalletMints } from "applesauce-wallet/actions";

const newMints = ["https://mint1.com", "https://mint2.com"];
await actions.run(SetWalletMints, newMints);
```

### SetWalletRelays

Updates the wallet's relays.

```typescript
import { SetWalletRelays } from "applesauce-wallet/actions";

const newRelays = ["wss://relay1.com", "wss://relay2.com"];
await actions.run(SetWalletRelays, newRelays);
```

### AddNutzapInfoMint / RemoveNutzapInfoMint

Manages mints in the user's kind:10019 nutzap info.

```typescript
import { AddNutzapInfoMint, RemoveNutzapInfoMint } from "applesauce-wallet/actions";

// Add mint to nutzap config
await actions.run(AddNutzapInfoMint, {
  url: "https://mint.example.com",
  units: ["sat"]
});

// Remove mint from nutzap config
await actions.run(RemoveNutzapInfoMint, "https://mint.example.com");
```

### ConsolidateTokens

Merges multiple small tokens into fewer larger ones.

```typescript
import { ConsolidateTokens } from "applesauce-wallet/actions";

await actions.run(ConsolidateTokens, {
  unlockTokens: true,
  couch
});
```

### RecoverFromCouch

Recovers tokens stored in the couch during failed operations.

```typescript
import { RecoverFromCouch } from "applesauce-wallet/actions";

await actions.run(RecoverFromCouch, couch);
```

## IndexedDBCouch

The "couch" is temporary storage for proofs during operations that could fail.

```typescript
import { IndexedDBCouch } from "applesauce-wallet/helpers";

const couch = new IndexedDBCouch();

// Used in operations
await actions.run(ReceiveToken, token, { couch });
await actions.run(TokensOperation, amount, callback, { couch });
```

**Why use a couch?**
- Prevents losing proofs if app crashes mid-operation
- Enables recovery of stuck transactions
- Provides atomic operation semantics

## Subscribing to Wallet Events

```typescript
import { use$ } from "applesauce-react/hooks";
import { relaySet } from "applesauce-core/helpers";

// Subscribe to wallet-related events
use$(() => {
  const relays = relaySet(walletRelays, userOutboxes);
  if (relays.length === 0) return undefined;

  return pool.subscription(
    relays,
    [
      // Wallet events
      {
        kinds: [WALLET_KIND, WALLET_TOKEN_KIND, WALLET_HISTORY_KIND],
        authors: [user.pubkey]
      },
      // Token deletions
      {
        kinds: [kinds.EventDeletion],
        "#k": [String(WALLET_TOKEN_KIND)]
      }
    ],
    { eventStore }
  );
}, [walletRelays, userOutboxes, user.pubkey]);

// Subscribe to incoming nutzaps
use$(() => {
  const relays = relaySet(nutzapRelays, userInboxes);
  if (relays.length === 0) return undefined;

  return pool.subscription(
    relays,
    { kinds: [NUTZAP_KIND], "#p": [user.pubkey] },
    { eventStore }
  );
}, [nutzapRelays, userInboxes, user.pubkey]);
```

## Complete Send Example

```typescript
import { TokensOperation } from "applesauce-wallet/actions";
import { getEncodedToken } from "@cashu/cashu-ts";

async function sendTokens(amount: number, selectedMint?: string) {
  let createdToken: string | null = null;

  await actions.run(
    TokensOperation,
    amount,
    async ({ selectedProofs, mint, cashuWallet }) => {
      const { keep, send } = await cashuWallet.ops
        .send(amount, selectedProofs)
        .run();

      // Encode token for sharing
      createdToken = getEncodedToken({
        mint,
        proofs: send,
        unit: "sat"
      });

      return {
        change: keep.length > 0 ? keep : undefined
      };
    },
    { mint: selectedMint, couch }
  );

  return createdToken;
}
```

## Complete Receive Example

```typescript
import { ReceiveToken } from "applesauce-wallet/actions";
import { getDecodedToken } from "@cashu/cashu-ts";

async function receiveToken(tokenString: string) {
  const token = getDecodedToken(tokenString.trim());

  if (!token) {
    throw new Error("Failed to decode token");
  }

  await actions.run(ReceiveToken, token, { couch });
}
```

## Auto-Unlock Pattern

```typescript
const unlocking = useRef(false);

useEffect(() => {
  if (unlocking.current || !autoUnlock) return;

  let needsUnlock = false;

  if (wallet && !wallet.unlocked) needsUnlock = true;
  if (tokens?.some(t => !t.unlocked)) needsUnlock = true;
  if (history?.some(h => !h.unlocked)) needsUnlock = true;

  if (needsUnlock) {
    unlocking.current = true;
    actions
      .run(UnlockWallet, { history: true, tokens: true })
      .catch(console.error)
      .finally(() => {
        unlocking.current = false;
      });
  }
}, [wallet?.unlocked, tokens?.length, history?.length, autoUnlock]);
```

## Nutzap Timeline

```typescript
import { castTimelineStream } from "applesauce-common/observable";
import { Nutzap } from "applesauce-wallet/casts";

const nutzaps = use$(
  () => eventStore
    .timeline({ kinds: [NUTZAP_KIND], "#p": [user.pubkey] })
    .pipe(castTimelineStream(Nutzap, eventStore)),
  [user.pubkey]
);

// Filter unclaimed nutzaps
const unclaimed = useMemo(() => {
  if (!nutzaps || !received) return nutzaps || [];
  return nutzaps.filter(n => !received.includes(n.id));
}, [nutzaps, received]);
```

## Helper Functions

### getWalletRelays

Extract relay URLs from a wallet event.

```typescript
import { getWalletRelays } from "applesauce-wallet/helpers";

const wallet = await firstValueFrom(
  eventStore.replaceable(WALLET_KIND, pubkey)
);
const relays = wallet ? getWalletRelays(wallet) : [];
```

## Integration with cashu-ts

The wallet actions use `@cashu/cashu-ts` internally. In `TokensOperation`:

```typescript
async ({ selectedProofs, mint, cashuWallet }) => {
  // cashuWallet is a @cashu/cashu-ts Wallet instance
  // Already initialized and connected to the mint

  // Use cashu-ts WalletOps API
  const { keep, send } = await cashuWallet.ops
    .send(amount, selectedProofs)
    .run();

  // Return change proofs to be stored
  return { change: keep };
}
```

## Error Handling

```typescript
try {
  await actions.run(ReceiveNutzaps, nutzapEvents, couch);
} catch (err) {
  if (err instanceof Error) {
    console.error("Failed to receive nutzaps:", err.message);
  }
  // Tokens are safely stored in couch
  // Can recover with RecoverFromCouch action
}
```

## Best Practices

1. **Always use couch**: Pass `couch` to operations that modify tokens
2. **Unlock before operations**: Check `wallet.unlocked` before actions
3. **Handle recovery**: Periodically run `RecoverFromCouch` on app start
4. **Subscribe to events**: Keep wallet data synced via subscriptions
5. **Check mint support**: Verify mint is in wallet config before operations

## Related Packages

- `applesauce-core` - Core event store and utilities
- `applesauce-actions` - ActionRunner for executing actions
- `applesauce-react` - React hooks like `use$`
- `applesauce-common` - Common helpers and casts
- `@cashu/cashu-ts` - Cashu protocol implementation

## Official Resources

- [Applesauce Documentation](https://hzrd149.github.io/applesauce/)
- [GitHub Repository](https://github.com/hzrd149/applesauce)
- [NIP-60 Specification](https://github.com/nostr-protocol/nips/blob/master/60.md)
- [NIP-61 Specification](https://github.com/nostr-protocol/nips/blob/master/61.md)
