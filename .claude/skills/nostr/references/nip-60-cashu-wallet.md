# NIP-60: Cashu Wallets - Complete Reference

This document provides comprehensive information about NIP-60 (Cashu Wallets) and its implementation in the applesauce library.

## Table of Contents

1. [Overview](#overview)
2. [NIP-60 Specification](#nip-60-specification)
3. [Event Kinds](#event-kinds)
4. [Wallet Operations](#wallet-operations)
5. [applesauce-wallet Implementation](#applesauce-wallet-implementation)
6. [Security Considerations](#security-considerations)
7. [Use Cases](#use-cases)
8. [Code Examples](#code-examples)

---

## Overview

### What is NIP-60?

NIP-60 defines the operations of a **cashu-based wallet** where wallet information is stored in **Nostr relays** to make it accessible across applications. This specification enables:

- **Ease-of-use**: New users can immediately receive funds without creating accounts with other services
- **Interoperability**: Users' wallets follow them across different Nostr applications
- **Privacy**: Uses Cashu blind signatures for privacy-preserving ecash
- **Portability**: Wallet state is stored on relays, accessible from any compatible client

### Key Benefits

1. **Cross-Application Wallet Access**: Your Cashu wallet is available in any NIP-60 compatible app
2. **No Account Required**: Start receiving funds immediately without KYC or registration
3. **Nostr-Native**: Leverages Nostr's relay infrastructure for storage and sync
4. **Privacy-Preserving**: Combines Nostr's identity layer with Cashu's blind signatures
5. **NIP-61 Compatible**: Enables Nutzaps (Cashu-based Lightning zaps)

---

## NIP-60 Specification

### Protocol Summary

NIP-60 uses Nostr events to store three types of wallet data:

| Event Kind | Purpose | Replaceability | Encryption |
|------------|---------|----------------|------------|
| 17375 | Wallet configuration | Replaceable | NIP-44 encrypted |
| 7375 | Unspent token proofs | Multiple allowed | NIP-44 encrypted |
| 7376 | Transaction history | Optional | NIP-44 encrypted |
| 7374 | Pending mint quotes | Quote tracking | NIP-40 expiration |

### Wallet Discovery

Clients discover wallets by:

1. Fetching `kind:10019` (Nutzap Mint Recommendations) from user relays
2. Falling back to NIP-65 relay lists if `kind:10019` is unavailable
3. Querying for `kind:17375` wallet events

---

## Event Kinds

### kind:17375 - Wallet Event

**Replaceable event** containing wallet configuration.

**Structure:**
```json
{
  "kind": 17375,
  "pubkey": "<user pubkey>",
  "created_at": <timestamp>,
  "tags": [
    ["d", "<wallet_identifier>"]
  ],
  "content": "<NIP-44 encrypted JSON>"
}
```

**Encrypted Content (after decryption):**
```json
{
  "privkey": "<hex private key>",  // Wallet-specific private key for P2PK ecash
  "mint": [
    "https://mint1.example.com",
    "https://mint2.example.com"
  ]
}
```

**Important Notes:**
- `privkey` is a **different private key** exclusively used for the wallet
- **NOT** associated with the user's Nostr private key
- Used only for receiving NIP-61 nutzaps (P2PK locked ecash)
- MUST be stored encrypted in the `.content` field using NIP-44

---

### kind:7375 - Token Event

**Multiple events allowed** per mint, storing unspent Cashu proofs.

**Structure:**
```json
{
  "kind": 7375,
  "pubkey": "<user pubkey>",
  "created_at": <timestamp>,
  "tags": [
    ["a", "<mint URL>"]
  ],
  "content": "<NIP-44 encrypted JSON>"
}
```

**Encrypted Content (after decryption):**
```json
{
  "mint": "https://mint.example.com",
  "unit": "sat",
  "proofs": [
    {
      "amount": 8,
      "secret": "9a3b2c1d4e5f6a7b8c9d0e1f2a3b4c5d",
      "C": "02ab3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c",
      "id": "00ffd48b78a7b2f4"
    }
  ],
  "del": ["<event_id_1>", "<event_id_2>"]
}
```

**Fields:**
- `mint`: Associated mint URL
- `unit`: Denomination (default: "sat", can be "usd", "msat", etc.)
- `proofs`: Array of **unencoded** Cashu proof objects
- `del`: Event IDs destroyed during state transitions (for tracking)

**Multiple Events:**
- Multiple `kind:7375` events can exist for the same mint
- Allows organizing proofs into different "pockets" or "buckets"
- Useful for privacy (avoiding correlation) and organization

---

### kind:7376 - Spending History Event

**Optional** transaction history tracking.

**Structure:**
```json
{
  "kind": 7376,
  "pubkey": "<user pubkey>",
  "created_at": <timestamp>,
  "tags": [
    ["a", "<mint URL>"],
    ["created", "<event_id>"],
    ["destroyed", "<event_id>"],
    ["redeemed", "<event_id>"]
  ],
  "content": "<NIP-44 encrypted JSON>"
}
```

**Encrypted Content (after decryption):**
```json
{
  "direction": "in",  // or "out"
  "amount": 1000,
  "unit": "sat"
}
```

**Tag Markers:**
- `created`: New token events created by this transaction
- `destroyed`: Token events spent/consumed
- `redeemed`: Token events redeemed for Bitcoin

**Use Cases:**
- Transaction history for UI display
- Accounting and balance tracking
- Debugging wallet state

---

### kind:7374 - Quote Event

**Tracks pending mint quotes** with NIP-40 expiration tags.

**Structure:**
```json
{
  "kind": 7374,
  "pubkey": "<user pubkey>",
  "created_at": <timestamp>,
  "tags": [
    ["expiration", "<unix timestamp>"],
    ["a", "<mint URL>"],
    ["quote", "<quote_id>"]
  ],
  "content": "<NIP-44 encrypted quote data>"
}
```

**Purpose:**
- Track pending Lightning payments waiting to be converted to ecash
- Expire approximately after 2 weeks (NIP-40)
- Allow wallet recovery of in-flight transactions

---

## Wallet Operations

### 1. Creating a Wallet

**Steps:**
1. Generate a new private key (wallet-specific, not Nostr key)
2. Select one or more Cashu mints
3. Create `kind:17375` wallet event with encrypted config
4. Publish to user's write relays

**Pseudocode:**
```typescript
// Generate wallet private key
const walletPrivkey = generatePrivateKey();
const walletPubkey = getPublicKey(walletPrivkey);

// Create wallet config
const walletConfig = {
  privkey: bytesToHex(walletPrivkey),
  mint: [
    "https://mint.example.com"
  ]
};

// Encrypt and create event
const encrypted = await nip44.encrypt(
  JSON.stringify(walletConfig),
  userPrivkey,
  userPubkey
);

const walletEvent = {
  kind: 17375,
  pubkey: userPubkey,
  created_at: Math.floor(Date.now() / 1000),
  tags: [["d", "default"]],
  content: encrypted
};

// Sign and publish
const signed = finalizeEvent(walletEvent, userPrivkey);
await relay.publish(signed);
```

---

### 2. Minting (Deposit Bitcoin → Receive Ecash)

**Flow:**
1. Create mint quote on Cashu mint
2. Pay Lightning invoice
3. Create `kind:7374` quote event (track pending)
4. Wait for payment confirmation
5. Mint Cashu proofs from paid quote
6. Store proofs in `kind:7375` token event
7. Delete `kind:7374` quote event (optional)

**State Transitions:**
```
[Create Quote] → kind:7374 (pending)
     ↓
[Pay Invoice] → External Lightning payment
     ↓
[Mint Proofs] → kind:7375 (unspent tokens)
     ↓
[Delete Quote] → Remove kind:7374
```

---

### 3. Sending (Transfer Ecash)

**Flow:**
1. Select proofs totaling send amount (+ fees if needed)
2. If exact amount: send proofs directly
3. If over: swap at mint to get exact amount + change
4. Create new `kind:7375` with remaining proofs (keep)
5. Delete old `kind:7375` (spent proofs) via NIP-09
6. Add spent event IDs to `del` field of new event
7. Optional: Create `kind:7376` history event
8. Send proofs to recipient (off-Nostr, via token string)

**Important:**
- Deletion events MUST include tag `["k", "7375"]` for filtering
- Change proofs go into a new `kind:7375` event
- Spent proofs' event IDs recorded in `del` field

**Example Deletion Event:**
```json
{
  "kind": 5,
  "pubkey": "<user pubkey>",
  "tags": [
    ["e", "<spent_event_id>"],
    ["k", "7375"]
  ],
  "content": "Spent tokens"
}
```

---

### 4. Receiving (Accept Ecash)

**Flow:**
1. Receive Cashu token string (external to Nostr)
2. Decode token to extract proofs
3. Swap proofs at mint for new proofs (security: prevent double-spend)
4. Create `kind:7375` event with new proofs
5. Optional: Create `kind:7376` history event (direction: "in")
6. Publish events to relays

**Why Swap on Receive?**
- Sender knows the secrets, could double-spend
- Swapping creates new secrets only recipient knows
- Makes tokens truly yours

---

### 5. Melting (Withdraw Ecash → Get Bitcoin)

**Flow:**
1. Create melt quote with Lightning invoice
2. Select proofs for invoice amount + fee reserve
3. Melt proofs at mint (pays Lightning invoice)
4. If change returned:
   - Create new `kind:7375` with change proofs
   - Delete old `kind:7375` (spent proofs)
5. Optional: Create `kind:7376` history event (direction: "out")
6. Publish events

---

### 6. Wallet Recovery

**From Relays:**
1. Fetch `kind:17375` wallet config
2. Decrypt to get wallet private key and mint list
3. Fetch all `kind:7375` token events
4. Decrypt to rebuild unspent proof set
5. Fetch `kind:7376` for transaction history (optional)
6. Verify proof validity against mints (check for double-spend)

**From Seed (if implemented):**
- Some implementations may use BIP39 seed phrases
- Derive wallet private key from seed
- Still need to fetch events from relays for proofs

---

## applesauce-wallet Implementation

### Overview

The **applesauce** library includes wallet functionality for NIP-60:

- **Package**: Likely part of `applesauce-actions` or a dedicated wallet module
- **Status**: Work in progress, still missing some features
- **Used By**: noStrudel web client

### Installation

```bash
npm install applesauce-core applesauce-actions applesauce-react
```

### Architecture

Applesauce wallet follows this architecture:

```
applesauce-core
  ↓ EventStore (reactive storage)
  ↓ EventFactory (event creation)
  ↓
applesauce-actions
  ↓ ActionHub (execution manager)
  ↓ Wallet Actions (createWallet, send, receive, etc.)
  ↓
applesauce-react
  ↓ Hooks (useWallet, useBalance, etc.)
```

### Typical Usage Pattern

```typescript
import { EventStore } from 'applesauce-core';
import { EventFactory } from 'applesauce-factory';
import { ActionHub } from 'applesauce-actions';

// Setup
const eventStore = new EventStore();
const eventFactory = new EventFactory();

async function publishEvent(event: NostrEvent) {
  await relayPool.publish(event, relays);
}

// Create action hub
const hub = new ActionHub(eventStore, eventFactory, publishEvent);

// Wallet operations would go through the hub
// Example: await hub.exec(CreateWallet, mintUrl);
```

### Key Features

Based on documentation and references:

1. **NIP-60 Support**: Full implementation of wallet events
2. **Send Tab**: UI for sending Cashu tokens
3. **Token Recovery**: Tools for recovering lost tokens
4. **Reactive**: Uses RxJS observables for real-time updates
5. **Cross-App**: Wallet state syncs across applications

### Actions Likely Included

While specific API isn't fully documented, likely actions include:

- `CreateWallet` - Initialize a new NIP-60 wallet
- `SendToken` - Send ecash to another user
- `ReceiveToken` - Accept and swap received ecash
- `MintToken` - Deposit Bitcoin and mint ecash
- `MeltToken` - Withdraw Bitcoin by melting ecash
- `GetBalance` - Query current wallet balance
- `GetHistory` - Fetch transaction history

### React Hooks (Expected)

```typescript
// Hypothetical hooks based on applesauce patterns
import { useWallet, useBalance, useTokens } from 'applesauce-wallet';

function WalletComponent() {
  const wallet = useWallet();  // Get wallet config
  const balance = useBalance(mintUrl);  // Get balance for mint
  const tokens = useTokens(mintUrl);  // Get token events

  // Render wallet UI
}
```

---

## Security Considerations

### Private Key Management

**Critical Points:**
- Wallet private key is **distinct** from Nostr private key
- MUST be stored encrypted (NIP-44) in `kind:17375` content
- Used only for P2PK locked ecash (NIP-61 nutzaps)
- Never reuse Nostr key for wallet operations

**Encryption:**
```typescript
// Correct: Encrypt with NIP-44
const encrypted = await nip44.encrypt(
  JSON.stringify({ privkey, mint }),
  userPrivkey,
  userPubkey
);

// Wrong: Storing privkey in plaintext
// DO NOT DO THIS
const event = { content: JSON.stringify({ privkey, mint }) };
```

### Proof Validation

Clients should validate proofs against mints to detect:
- **Double-spending**: Check if secrets already spent
- **Invalid signatures**: Verify mint signatures
- **Counterfeit tokens**: Ensure proofs are genuine

**Example Validation:**
```typescript
import { CashuWallet } from '@cashu/cashu-ts';

const wallet = new CashuWallet(new CashuMint(mintUrl));
await wallet.loadMint();

// Check proof state
const states = await wallet.checkProofsSpent(proofs);

for (const state of states) {
  if (state.state === 'SPENT') {
    console.warn('Token already spent!');
  }
}
```

### Relay Trust

- **No Trusted Relays**: Don't rely on single relay for wallet data
- **Multi-Relay Sync**: Publish wallet events to multiple relays
- **Conflict Resolution**: Handle conflicting state across relays
- **Backup Strategy**: Maintain local encrypted backups

### State Transitions

**Always Include `del` Field:**
- Tracks which token events were spent
- Helps detect incomplete state transitions
- Provides audit trail for debugging

**Atomic Operations:**
- Delete old `kind:7375` and create new in same batch
- Prevents inconsistent state if one operation fails

---

## Use Cases

### 1. NIP-61 Nutzaps

**Scenario**: Zap a user with Cashu ecash instead of Lightning

**Flow:**
1. User publishes `kind:17375` wallet with P2PK pubkey
2. Sender creates P2PK locked ecash token
3. Sender publishes `kind:9321` nutzap event
4. Receiver detects nutzap, unlocks with wallet privkey
5. Receiver swaps to new proofs and stores in `kind:7375`

**Benefits:**
- Privacy: Nutzaps don't reveal amounts on-chain
- Instant: No Lightning routing required
- Low fees: Minimal mint fees vs Lightning routing

### 2. Cross-Application Wallet

**Scenario**: Use same wallet in multiple Nostr clients

**Flow:**
1. Create wallet in App A
2. Open App B, automatically discovers wallet via NIP-60
3. Both apps share same proofs and balance
4. Spend in App A, balance updates in App B

**Benefits:**
- No manual imports or exports
- Seamless user experience
- Single source of truth (Nostr relays)

### 3. Ecash Savings

**Scenario**: Store Bitcoin as Cashu ecash for privacy

**Flow:**
1. Deposit Bitcoin via Lightning
2. Mint ecash proofs
3. Store in multiple `kind:7375` events across mints
4. Withdraw when needed via melt operation

**Benefits:**
- Privacy: Amounts not visible on Lightning
- Diversification: Multiple mints reduce risk
- Accessibility: Available in any NIP-60 client

### 4. Merchant Payments

**Scenario**: Accept Cashu payments for goods/services

**Flow:**
1. Customer sends Cashu token (off-Nostr)
2. Merchant receives and swaps proofs
3. Stores in `kind:7375` for later use or melts to Bitcoin
4. Creates `kind:7376` history for accounting

**Benefits:**
- Instant settlement: No Lightning routing delays
- Low fees: Minimal mint fees
- Privacy: Customer amounts not public

---

## Code Examples

### Example 1: Fetching Wallet Config

```typescript
import { EventStore } from 'applesauce-core';
import { use$ } from 'applesauce-react/hooks';
import { nip44 } from 'nostr-tools';

// Get wallet config event
const walletEvent = use$(() =>
  eventStore.replaceable(17375, userPubkey),
  [userPubkey]
);

if (walletEvent) {
  // Decrypt content
  const decrypted = await nip44.decrypt(
    walletEvent.content,
    userPrivkey,
    userPubkey
  );

  const config = JSON.parse(decrypted);
  console.log('Wallet privkey:', config.privkey);
  console.log('Mints:', config.mint);
}
```

### Example 2: Fetching Token Events

```typescript
import { EventStore } from 'applesauce-core';
import { use$ } from 'applesauce-react/hooks';

// Get all token events for user
const tokenEvents = use$(() =>
  eventStore.timeline([
    {
      kinds: [7375],
      authors: [userPubkey]
    }
  ]),
  [userPubkey]
);

// Decrypt and extract proofs
const allProofs = [];

for (const event of tokenEvents) {
  const decrypted = await nip44.decrypt(
    event.content,
    userPrivkey,
    userPubkey
  );

  const tokenData = JSON.parse(decrypted);
  allProofs.push(...tokenData.proofs);
}

// Calculate balance
const balance = allProofs.reduce((sum, p) => sum + p.amount, 0);
console.log('Total balance:', balance, 'sats');
```

### Example 3: Creating History Event

```typescript
import { EventFactory } from 'applesauce-factory';
import { nip44 } from 'nostr-tools';

async function createHistoryEvent(
  direction: 'in' | 'out',
  amount: number,
  unit: string,
  mintUrl: string,
  createdEventIds: string[],
  destroyedEventIds: string[]
) {
  const historyData = {
    direction,
    amount,
    unit
  };

  const encrypted = await nip44.encrypt(
    JSON.stringify(historyData),
    userPrivkey,
    userPubkey
  );

  const tags = [
    ['a', mintUrl],
    ...createdEventIds.map(id => ['created', id]),
    ...destroyedEventIds.map(id => ['destroyed', id])
  ];

  const event = eventFactory.create(7376, tags, encrypted);
  const signed = finalizeEvent(event, userPrivkey);

  await publishEvent(signed);
}

// Usage
await createHistoryEvent(
  'out',                    // Sent tokens
  100,                      // 100 sats
  'sat',                    // Unit
  'https://mint.example.com',
  ['new_event_id'],         // Created events
  ['spent_event_id']        // Destroyed events
);
```

### Example 4: State Transition (Send Flow)

```typescript
async function sendTokens(
  amount: number,
  currentTokenEvent: NostrEvent,
  currentProofs: Proof[]
) {
  // 1. Select proofs for amount
  const selected = selectProofs(currentProofs, amount);
  const totalSelected = sumProofs(selected);

  // 2. Swap at mint to get exact amount + change
  const { keep, send } = await wallet.send(amount, selected);

  // 3. Create new token event with keep proofs
  const newTokenData = {
    mint: mintUrl,
    unit: 'sat',
    proofs: keep,
    del: [currentTokenEvent.id]  // Track spent event
  };

  const encrypted = await nip44.encrypt(
    JSON.stringify(newTokenData),
    userPrivkey,
    userPubkey
  );

  const newTokenEvent = eventFactory.create(
    7375,
    [['a', mintUrl]],
    encrypted
  );

  // 4. Delete old token event
  const deleteEvent = eventFactory.create(
    5,
    [
      ['e', currentTokenEvent.id],
      ['k', '7375']
    ],
    'Spent tokens'
  );

  // 5. Publish both events
  await publishEvent(finalizeEvent(newTokenEvent, userPrivkey));
  await publishEvent(finalizeEvent(deleteEvent, userPrivkey));

  // 6. Return send proofs to user
  const token = getEncodedTokenV4({
    token: [{ mint: mintUrl, proofs: send }]
  });

  return token;
}
```

---

## Resources

### Official Specifications

- **NIP-60 Specification**: [github.com/nostr-protocol/nips/blob/master/60.md](https://github.com/nostr-protocol/nips/blob/master/60.md)
- **NIP-61 Nutzaps**: [github.com/nostr-protocol/nips/blob/master/61.md](https://github.com/nostr-protocol/nips/blob/master/61.md)
- **NIP-44 Encrypted Payloads**: [github.com/nostr-protocol/nips/blob/master/44.md](https://github.com/nostr-protocol/nips/blob/master/44.md)

### applesauce Documentation

- **Main Documentation**: [hzrd149.github.io/applesauce/](https://hzrd149.github.io/applesauce/)
- **Wallet Guide**: [hzrd149.github.io/applesauce/wallet/getting-started.html](https://hzrd149.github.io/applesauce/wallet/getting-started.html)
- **TypeDoc API**: [hzrd149.github.io/applesauce/typedoc/](https://hzrd149.github.io/applesauce/typedoc/)
- **GitHub**: [github.com/hzrd149/applesauce](https://github.com/hzrd149/applesauce)

### Cashu Resources

- **Cashu Protocol**: [cashu.space](https://cashu.space)
- **Cashu Documentation**: [docs.cashu.space](https://docs.cashu.space)
- **cashu-ts Library**: [github.com/cashubtc/cashu-ts](https://github.com/cashubtc/cashu-ts)

### Related NIPs

- **NIP-09**: Event Deletion Request
- **NIP-40**: Expiration Timestamp
- **NIP-44**: Encrypted Payloads (Versioned)
- **NIP-47**: Nostr Wallet Connect
- **NIP-57**: Lightning Zaps
- **NIP-61**: Nutzaps (Cashu Lightning zaps)
- **NIP-65**: Relay List Metadata

### Tools and Implementations

- **noStrudel**: Web client using applesauce (includes NIP-60 wallet)
- **NDK Wallet**: Alternative NIP-60 implementation in NDK
- **Cashu Cache**: NIP-60 compliant Cashu wallet

---

## Summary

NIP-60 brings Cashu ecash wallets to Nostr, enabling:

✅ Cross-application wallet access via relay storage
✅ Privacy-preserving ecash with blind signatures
✅ Instant value transfer without Lightning routing
✅ NIP-61 nutzaps for private zapping
✅ No account or KYC required

The applesauce library provides a work-in-progress implementation used by noStrudel and other Nostr clients. By storing wallet state as encrypted Nostr events, users get a seamless, portable, and private ecash experience across the Nostr ecosystem.
