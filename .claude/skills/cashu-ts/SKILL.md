---
name: cashu-ts
description: This skill should be used when building Cashu wallets in JavaScript/TypeScript using the @cashu/cashu-ts library. Provides comprehensive knowledge of the Wallet and Mint classes, WalletOps builder pattern, token encoding/decoding, P2PK conditions, deterministic secrets, and all wallet operations like minting, melting, sending, and receiving tokens.
---

# cashu-ts TypeScript Library Expert

## Purpose

This skill provides expert-level assistance with `@cashu/cashu-ts`, the official TypeScript library for building Cashu ecash wallets. The library implements the Cashu protocol for minting, sending, receiving, and melting ecash tokens backed by Bitcoin Lightning.

## When to Use

Activate this skill when:
- Building a Cashu wallet in JavaScript/TypeScript
- Implementing ecash token operations (mint, melt, send, receive)
- Working with the WalletOps builder pattern
- Encoding/decoding Cashu tokens
- Implementing P2PK or HTLC spending conditions
- Managing deterministic secrets with BIP39 seeds
- Handling keyset management and rotation
- Integrating Cashu payments into web or Node.js apps

## Installation

```bash
npm install @cashu/cashu-ts
```

**Browser (IIFE build):** Available via GitHub Releases for non-bundler usage.

## Core Architecture

### Key Principles

1. **Stateless Wallets**: Wallet classes are mostly stateless - your app manages proof storage
2. **Always call `loadMint()`**: Required after instantiation before any operations
3. **Proof Management**: You must persist proofs in your database
4. **Counter Tracking**: For deterministic secrets, persist counter values

### Main Classes

| Class | Purpose |
|-------|---------|
| `Wallet` | Primary wallet operations (v3 API) |
| `CashuWallet` | Legacy wallet class (v2 API) |
| `CashuMint` | Direct mint API interactions |
| `WalletOps` | Fluent builder for transactions |

## Quick Start

### Basic Wallet Setup

```typescript
import { Wallet } from '@cashu/cashu-ts';

const mintUrl = 'https://mint.example.com';
const wallet = new Wallet(mintUrl);
await wallet.loadMint();

// Now ready for operations
```

### With Cached Data (Faster Initialization)

```typescript
// First time - save cache
const wallet1 = new Wallet(mintUrl);
await wallet1.loadMint();
const keyChainCache = wallet1.keyChain.cache;
const mintInfoCache = wallet1.getMintInfo().cache;
// Persist these to storage...

// Later - restore from cache
const wallet2 = new Wallet(mintUrl, { unit: 'sat' });
wallet2.loadMintFromCache(mintInfoCache, keyChainCache);
```

### With Deterministic Secrets (BIP39)

```typescript
import { Wallet } from '@cashu/cashu-ts';
import { mnemonicToSeedSync } from '@scure/bip39';

const mnemonic = 'abandon abandon abandon...'; // 12 words
const bip39seed = mnemonicToSeedSync(mnemonic);

const wallet = new Wallet(mintUrl, {
  unit: 'sat',
  bip39seed,
  keysetId: 'preferred_keyset_id', // optional
  counterInit: { '009a1f293253e41e': 0 } // keyset -> counter
});
await wallet.loadMint();
```

## Wallet Operations

### Minting Tokens (Deposit Bitcoin)

```typescript
import { Wallet, MintQuoteState } from '@cashu/cashu-ts';

const wallet = new Wallet(mintUrl);
await wallet.loadMint();

// 1. Create mint quote (get Lightning invoice)
const quote = await wallet.createMintQuote(1000); // 1000 sats
console.log('Pay this invoice:', quote.request);
console.log('Quote ID:', quote.quote);

// 2. Wait for payment, check status
const status = await wallet.checkMintQuote(quote.quote);
if (status.state === MintQuoteState.PAID) {
  // 3. Mint the tokens
  const proofs = await wallet.mintProofs(1000, quote.quote);
  // Store proofs in your database
  console.log('Minted proofs:', proofs);
}
```

### Melting Tokens (Pay Lightning Invoice)

```typescript
const invoice = 'lnbc10u1p...'; // Lightning invoice to pay

// 1. Create melt quote
const quote = await wallet.createMeltQuote(invoice);
console.log('Amount:', quote.amount);
console.log('Fee reserve:', quote.fee_reserve);

// 2. Select proofs to spend
const totalNeeded = quote.amount + quote.fee_reserve;
const proofsToSpend = selectProofs(myProofs, totalNeeded);

// 3. Melt (pay the invoice)
const result = await wallet.meltProofs(quote, proofsToSpend);

if (result.quote.state === 'PAID') {
  console.log('Payment successful!');
  console.log('Preimage:', result.quote.payment_preimage);

  // Handle fee change if any
  if (result.change) {
    // Store change proofs
  }
}
```

### Sending Tokens

```typescript
// Simple send - get token string for recipient
const { keep, send } = await wallet.send(100, myProofs);
// keep = change proofs to store
// send = proofs to encode and share

// Encode for sharing
import { getEncodedTokenV4 } from '@cashu/cashu-ts';
const token = getEncodedTokenV4({
  mint: mintUrl,
  proofs: send,
  memo: 'Coffee payment'
});
// Share token string: cashuBxxx...
```

### Receiving Tokens

```typescript
import { getDecodedToken } from '@cashu/cashu-ts';

const tokenString = 'cashuBxxx...';

// 1. Decode and validate
const decoded = getDecodedToken(tokenString);
console.log('From mint:', decoded.mint);
console.log('Amount:', decoded.proofs.reduce((a, p) => a + p.amount, 0));

// 2. Create wallet for that mint
const wallet = new Wallet(decoded.mint);
await wallet.loadMint();

// 3. Receive (swap to invalidate sender's copy)
const newProofs = await wallet.receive(tokenString);
// Store newProofs in your database
```

### Swapping Tokens

```typescript
// Swap to change denominations or refresh tokens
const { keep } = await wallet.swap(myProofs);
// keep contains new proofs with same total value
```

### Checking Token States

```typescript
const states = await wallet.checkProofsStates(proofs);
states.forEach((state, i) => {
  console.log(`Proof ${i}: ${state.state}`); // UNSPENT, PENDING, SPENT
  if (state.witness) {
    console.log('Witness:', state.witness);
  }
});
```

## WalletOps Builder Pattern

The fluent `WalletOps` API provides readable, chainable transaction building.

### Access WalletOps

```typescript
// From wallet instance
const ops = wallet.ops;

// Or standalone
import { WalletOps } from '@cashu/cashu-ts';
const ops = new WalletOps(wallet);
```

### Send Operations

```typescript
// Simple send
const { keep, send } = await wallet.ops.send(100, proofs).run();

// With deterministic outputs
const { keep, send } = await wallet.ops
  .send(100, proofs)
  .asDeterministic(0, [64, 32, 4])  // counter=0 auto-reserves
  .run();

// Keep as random (change proofs)
const { keep, send } = await wallet.ops
  .send(100, proofs)
  .asDeterministic(0, [64, 32, 4])
  .keepAsRandom()
  .run();

// Offline exact match (no mint contact)
try {
  const result = await wallet.ops
    .send(100, proofs)
    .offlineExactOnly()
    .run();
} catch (e) {
  // Falls back if exact match impossible
}
```

### Receive Operations

```typescript
// Simple receive
const proofs = await wallet.ops.receive(token).run();

// With P2PK unlock
const proofs = await wallet.ops
  .receive(token)
  .privkey(['privkey_hex'])
  .run();

// Lock received proofs to your pubkey
const proofs = await wallet.ops
  .receive(token)
  .asP2PK({ pubkey: myPubkey })
  .run();
```

### Mint Operations

```typescript
const proofs = await wallet.ops
  .mint(1000, quoteId)
  .asDeterministic(0) // auto-reserve counters
  .run();
```

### Melt Operations

```typescript
const result = await wallet.ops
  .melt(quote, proofs)
  .run();
```

## P2PK (Pay-to-Pubkey)

Lock tokens to a public key requiring signature to spend.

### Using P2PKBuilder

```typescript
import { P2PKBuilder } from '@cashu/cashu-ts';

const p2pkOptions = new P2PKBuilder()
  .addLockPubkey('02abc123...')
  .lockUntil(1712345678)  // Unix timestamp
  .addRefundPubkey('02def456...')
  .setMinSigs(2)
  .toOptions();

// Send with P2PK lock
const { send } = await wallet.ops
  .send(100, proofs)
  .asP2PK(p2pkOptions)
  .run();
```

### Receiving P2PK Tokens

```typescript
// Unlock with your private key
const proofs = await wallet.ops
  .receive(token)
  .privkey(['your_private_key_hex'])
  .run();

// Or with wallet.receive()
const proofs = await wallet.receive(token, {
  privkey: 'your_private_key_hex'
});
```

## Token Encoding/Decoding

### Encode Tokens

```typescript
import { getEncodedTokenV4 } from '@cashu/cashu-ts';

const token = getEncodedTokenV4({
  mint: 'https://mint.example.com',
  proofs: proofs,
  memo: 'Payment for coffee',
  unit: 'sat'
});
// Returns: cashuBxxx...
```

### Decode Tokens

```typescript
import { getDecodedToken } from '@cashu/cashu-ts';

try {
  const decoded = getDecodedToken(tokenString);
  console.log('Mint:', decoded.mint);
  console.log('Unit:', decoded.unit);
  console.log('Memo:', decoded.memo);
  console.log('Proofs:', decoded.proofs);
  console.log('Total:', decoded.proofs.reduce((a, p) => a + p.amount, 0));
} catch (e) {
  console.error('Invalid token');
}
```

### Token Types

```typescript
// V4 Token (current) - CBOR encoded
interface Token {
  mint: string;
  proofs: Proof[];
  memo?: string;
  unit?: string;
}

// Proof structure
interface Proof {
  amount: number;
  id: string;      // keyset ID
  secret: string;
  C: string;       // signature point
  witness?: string; // for spending conditions
}
```

## Deterministic Secrets & Recovery

### Counter Management

```typescript
// Get current counter state
const snapshot = wallet.counters.snapshot();
// { '009a1f293253e41e': 42, ... }

// Set counter (for migrations)
wallet.counters.setNext('009a1f293253e41e', 100);

// Subscribe to counter reservations
wallet.on.countersReserved(({ keysetId, start, count, next }) => {
  // Persist 'next' value to your database
  saveCounter(keysetId, next);
});
```

### Wallet Recovery

```typescript
// Restore wallet from seed
const wallet = new Wallet(mintUrl, {
  bip39seed: seedFromMnemonic,
  counterInit: loadedCounters
});
await wallet.loadMint();

// Restore proofs using NUT-09
const restoredProofs = await wallet.restore(startCounter, endCounter);
```

## Keyset Management

### Get Keysets

```typescript
// Get all keysets from mint
const keysets = await wallet.getKeysets();

// Get specific keyset keys
const keys = await wallet.getKeys('009a1f293253e41e');

// Force refresh from mint
const freshKeys = await wallet.getKeys(keysetId, true);
```

### Keyset Structure

```typescript
interface MintKeyset {
  id: string;       // keyset identifier
  unit: string;     // 'sat', 'usd', etc.
  active: boolean;  // mint signs with this keyset
  input_fee_ppk?: number; // fee in parts per thousand
}

interface Keys {
  id: string;
  unit: string;
  keys: { [amount: number]: string }; // amount -> pubkey
}
```

## Mint Information

```typescript
const info = wallet.getMintInfo();

console.log('Name:', info.name);
console.log('Version:', info.version);
console.log('Supported NUTs:', Object.keys(info.nuts));
console.log('Contact:', info.contact);

// Check feature support
if (info.nuts['10']?.supported) {
  console.log('Spending conditions supported');
}
if (info.nuts['12']?.supported) {
  console.log('DLEQ proofs supported');
}
```

## CashuMint Class (Direct API)

For low-level mint interactions:

```typescript
import { CashuMint } from '@cashu/cashu-ts';

const mint = new CashuMint(mintUrl);

// Get mint info
const info = await mint.getInfo();

// Get active keysets
const keysets = await mint.getKeySets();

// Get keys for keyset
const keys = await mint.getKeys(keysetId);

// Swap proofs
const response = await mint.swap(inputs, outputs);

// Check proof states
const states = await mint.check({ Ys: proofYs });
```

## Events & Logging

### Wallet Events

```typescript
// Subscribe to counter reservations
wallet.on.countersReserved(({ keysetId, start, count, next }) => {
  console.log(`Reserved ${count} counters for ${keysetId}`);
});

// Unsubscribe
const unsub = wallet.on.countersReserved(handler);
unsub(); // cleanup
```

### Logging

```typescript
import { Wallet, ConsoleLogger } from '@cashu/cashu-ts';

// Enable console logging
const wallet = new Wallet(mintUrl, {
  logger: new ConsoleLogger()
});

// Custom logger
const wallet = new Wallet(mintUrl, {
  logger: {
    debug: (msg) => myLogger.debug(msg),
    info: (msg) => myLogger.info(msg),
    warn: (msg) => myLogger.warn(msg),
    error: (msg) => myLogger.error(msg)
  }
});
```

## Error Handling

```typescript
import { CashuError } from '@cashu/cashu-ts';

try {
  const proofs = await wallet.receive(token);
} catch (e) {
  if (e instanceof CashuError) {
    console.error('Cashu error:', e.code, e.message);
    // Handle specific error codes
    switch (e.code) {
      case 10000: // Token already spent
        console.error('Token was already redeemed');
        break;
      case 11001: // Quote not found
        console.error('Quote expired or invalid');
        break;
    }
  } else {
    throw e;
  }
}
```

## Type Exports

```typescript
import type {
  // Core types
  Proof,
  Token,
  Keys,
  MintKeyset,

  // Quote types
  MintQuoteResponse,
  MeltQuoteResponse,
  MintQuoteState,
  MeltQuoteState,

  // Response types
  SwapResponse,
  MintResponse,
  MeltResponse,
  CheckStateResponse,
  ProofState,

  // Blinding types
  BlindedMessage,
  BlindSignature,
  BlindingData,

  // Options
  P2PKOptions,
  OutputAmounts,

  // Wallet types
  SendResponse,
  ReceiveResponse
} from '@cashu/cashu-ts';
```

## Migration Notes

### v2 to v3

- `CashuWallet` → `Wallet` (new class)
- Improved WalletOps builder API
- Better TypeScript types
- HTLC support (NUT-14)
- Transaction preview functionality

### v1 to v2

- `mintTokens()` → `mintProofs()` (returns `Proof[]` directly)
- `meltTokens()` → `meltProofs()`
- `checkProofsSpent()` → `checkProofsStates()`
- `returnChange` → `keep` in SendResponse
- BIP39 must be converted to seed externally
- `OutputAmounts` object replaces `AmountPreference` array

## Best Practices

1. **Always swap received tokens** - Invalidates sender's copy immediately
2. **Persist proofs securely** - They are bearer instruments
3. **Track counters** - Essential for deterministic wallet recovery
4. **Check mint support** - Verify NUT support before using features
5. **Handle errors gracefully** - Network and mint errors are common
6. **Use DLEQ verification** - When receiving tokens offline
7. **Implement proper backup** - Seed + counters for full recovery

## Official Resources

- **GitHub**: https://github.com/cashubtc/cashu-ts
- **Documentation**: https://cashubtc.github.io/cashu-ts/docs/
- **npm**: https://www.npmjs.com/package/@cashu/cashu-ts
- **Releases**: https://github.com/cashubtc/cashu-ts/releases

## Quick Reference

| Operation | Method |
|-----------|--------|
| Initialize | `new Wallet(url)` + `loadMint()` |
| Mint quote | `createMintQuote(amount)` |
| Check quote | `checkMintQuote(quoteId)` |
| Mint tokens | `mintProofs(amount, quoteId)` |
| Melt quote | `createMeltQuote(invoice)` |
| Melt tokens | `meltProofs(quote, proofs)` |
| Send | `send(amount, proofs)` or `ops.send().run()` |
| Receive | `receive(token)` or `ops.receive().run()` |
| Swap | `swap(proofs)` |
| Check state | `checkProofsStates(proofs)` |
| Encode | `getEncodedTokenV4({...})` |
| Decode | `getDecodedToken(token)` |
