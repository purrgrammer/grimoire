---
name: cashu-ts
description: This skill should be used when working with cashu-ts library for building Cashu wallets and handling ecash operations in TypeScript. Provides comprehensive knowledge of the cashu-ts API, wallet operations, mint interactions, and token management.
---

# cashu-ts Library Expert

## Purpose

This skill provides expert-level assistance with cashu-ts, the official TypeScript/JavaScript library for building Cashu wallets. It enables developers to integrate Chaumian ecash functionality into web, mobile, and Node.js applications.

## When to Use

Activate this skill when:
- Building Cashu wallets (web, mobile, desktop)
- Implementing ecash operations in TypeScript/JavaScript
- Working with CashuWallet or CashuMint classes
- Handling token encoding/decoding
- Managing proofs and ecash state
- Integrating Lightning payments with ecash
- Implementing wallet backup and recovery
- Using WalletOps builder pattern

## Core Concepts

### cashu-ts Overview

cashu-ts provides:
- **Wallet operations** - Mint, send, receive, melt ecash
- **Mint communication** - HTTP client for Cashu mint API
- **Token management** - Encode, decode, validate tokens
- **Cryptography** - BDHKE, blind signatures, DLEQ proofs
- **Type definitions** - Complete TypeScript types for Cashu protocol
- **NUT implementations** - Support for NUT-00 through NUT-13+

### Installation

```bash
npm install @cashu/cashu-ts
```

**Peer Dependencies:**
```bash
npm install @noble/curves @noble/hashes
```

### Library Structure

```
@cashu/cashu-ts
├── CashuWallet      - Main wallet interface
├── CashuMint        - Mint API client
├── getEncodedTokenV4 - Token encoding
├── getDecodedToken   - Token decoding
├── deriveKeysetId   - Keyset utilities
├── generateSeed     - Key generation
└── types            - TypeScript definitions
```

## Core Classes

### CashuWallet

Primary interface for wallet operations.

#### Constructor

```typescript
import { CashuWallet, CashuMint } from '@cashu/cashu-ts';

// Simple constructor (fetches mint info)
const wallet = new CashuWallet(new CashuMint(mintUrl));
await wallet.loadMint();

// Advanced constructor (with cached data)
const wallet = new CashuWallet(
  new CashuMint(mintUrl),
  {
    unit: 'sat',           // Currency unit
    keys: cachedKeys,      // Cached mint keys
    keysets: cachedKeysets, // Cached keysets
    mintInfo: cachedInfo   // Cached mint info
  }
);
await wallet.loadMint();
```

**Important**: Always call `loadMint()` after instantiation to fetch mint keys.

#### Wallet Properties

```typescript
wallet.mint          // CashuMint instance
wallet.keys          // Current keyset keys (MintKeys)
wallet.keysetId      // Active keyset ID
wallet.unit          // Currency unit (default: 'sat')
```

### CashuMint

HTTP client for mint API communication.

```typescript
import { CashuMint } from '@cashu/cashu-ts';

const mint = new CashuMint(mintUrl);

// Fetch mint information
const info = await mint.getInfo();
console.log(info.name, info.version, info.nuts);

// Get active keys
const keys = await mint.getKeys();

// Get all keysets
const keysets = await mint.getKeysets();
```

## Wallet Operations

### 1. Minting (Deposit Bitcoin → Receive Ecash)

#### Create Mint Quote

```typescript
// Create quote for 1000 sats
const mintQuote = await wallet.createMintQuote(1000);

console.log('Pay invoice:', mintQuote.request);  // BOLT11 invoice
console.log('Quote ID:', mintQuote.quote);
console.log('Paid:', mintQuote.paid);  // false initially
```

**MintQuoteResponse:**
```typescript
{
  quote: string;        // Quote identifier
  request: string;      // BOLT11 invoice to pay
  paid: boolean;        // Payment status
  expiry: number;       // Unix timestamp
}
```

#### Check Quote Status

```typescript
const status = await wallet.checkMintQuote(mintQuote.quote);
console.log('Paid:', status.paid);
```

#### Mint Tokens

```typescript
// After paying the invoice
const { proofs } = await wallet.mintProofs(1000, mintQuote.quote);

console.log('Minted proofs:', proofs);
// proofs = [
//   { amount: 512, secret: '...', C: '...', id: '...' },
//   { amount: 256, secret: '...', C: '...', id: '...' },
//   { amount: 128, secret: '...', C: '...', id: '...' },
//   { amount: 64, secret: '...', C: '...', id: '...' },
//   { amount: 32, secret: '...', C: '...', id: '...' },
//   { amount: 8, secret: '...', C: '...', id: '...' }
// ]
```

**Complete Flow:**

```typescript
async function depositBitcoin(wallet: CashuWallet, amount: number) {
  // Step 1: Create quote
  const quote = await wallet.createMintQuote(amount);

  // Step 2: Display invoice to user
  console.log('Pay this invoice:', quote.request);
  displayQRCode(quote.request);

  // Step 3: Poll for payment
  while (true) {
    const status = await wallet.checkMintQuote(quote.quote);
    if (status.paid) break;
    await sleep(2000);
  }

  // Step 4: Mint tokens
  const { proofs } = await wallet.mintProofs(amount, quote.quote);

  // Step 5: Store proofs
  await saveProofs(proofs);

  return proofs;
}
```

### 2. Sending (Transfer Ecash)

#### Basic Send

```typescript
// Send 100 sats from existing proofs
const { keep, send } = await wallet.send(100, proofsToSpend);

// keep: proofs to keep in wallet (change)
// send: proofs to send to recipient

// Encode as shareable token
const token = getEncodedTokenV4({
  token: [{
    mint: wallet.mint.mintUrl,
    proofs: send
  }]
});

console.log('Send this token:', token);
// cashuBo2F0gaNhbK...
```

#### Send with Options

```typescript
const { keep, send } = await wallet.send(
  100,              // Amount to send
  proofsToSpend,    // Proofs to use
  {
    includeFees: true,     // Include swap fees
    keysetId: keysetId,    // Specific keyset
    counter: 42,           // Deterministic secret counter
    pubkey: recipientPk,   // P2PK lock to recipient
    privkey: senderSk      // For signing P2PK
  }
);
```

**Send Response:**
```typescript
{
  keep: Proof[];       // Proofs to keep (change)
  send: Proof[];       // Proofs to send
  totalKeep: number;   // Total amount kept
  totalSend: number;   // Total amount sent
}
```

#### With Memo

```typescript
const token = getEncodedTokenV4({
  token: [{
    mint: wallet.mint.mintUrl,
    proofs: send,
    unit: 'sat'
  }],
  memo: 'Coffee payment ☕'
});
```

### 3. Receiving (Accept Ecash)

#### Basic Receive

```typescript
// Decode token from string
const decodedToken = getDecodedToken(tokenString);

// Receive proofs (swaps to new secrets)
const receivedProofs = await wallet.receive(decodedToken);

console.log('Received amount:', sumProofs(receivedProofs));
```

**Why Receive Swaps:**
- Sender knows the secrets and could double-spend
- Swapping creates new secrets only recipient knows
- Makes tokens truly yours

#### Receive with P2PK

```typescript
// Receive P2PK locked token
const receivedProofs = await wallet.receive(
  decodedToken,
  {
    privkey: recipientPrivkey  // Required to unlock P2PK
  }
);
```

#### Multi-Mint Receive

```typescript
const decodedToken = getDecodedToken(tokenString);

// Token may contain proofs from multiple mints
for (const tokenEntry of decodedToken.token) {
  const wallet = getOrCreateWallet(tokenEntry.mint);
  const received = await wallet.receive({
    token: [tokenEntry]
  });
  console.log(`Received ${sumProofs(received)} from ${tokenEntry.mint}`);
}
```

### 4. Melting (Withdraw Ecash → Pay Bitcoin)

#### Create Melt Quote

```typescript
const invoice = 'lnbc10000...';  // BOLT11 invoice

// Get melt quote
const meltQuote = await wallet.createMeltQuote(invoice);

console.log('Amount:', meltQuote.amount);           // Invoice amount
console.log('Fee reserve:', meltQuote.fee_reserve); // Estimated fee
console.log('Total needed:', meltQuote.amount + meltQuote.fee_reserve);
```

**MeltQuoteResponse:**
```typescript
{
  quote: string;        // Quote identifier
  amount: number;       // Invoice amount
  fee_reserve: number;  // Fee estimate
  paid: boolean;        // false initially
  expiry: number;       // Unix timestamp
}
```

#### Melt Tokens

```typescript
// Select proofs for amount + fee
const proofsToSend = selectProofs(
  proofs,
  meltQuote.amount + meltQuote.fee_reserve
);

// Melt tokens (pays invoice)
const meltResponse = await wallet.meltProofs(meltQuote, proofsToSend);

console.log('Paid:', meltResponse.paid);
console.log('Preimage:', meltResponse.payment_preimage);

// Get change if fee was overestimated
if (meltResponse.change) {
  const changeProofs = meltResponse.change;
  console.log('Change:', sumProofs(changeProofs));
}
```

**MeltProofsResponse:**
```typescript
{
  paid: boolean;              // Payment successful
  payment_preimage: string;   // Proof of payment
  change: Proof[];            // Change proofs (if overpaid)
}
```

**Complete Flow:**

```typescript
async function payInvoice(wallet: CashuWallet, invoice: string, proofs: Proof[]) {
  // Step 1: Get quote
  const quote = await wallet.createMeltQuote(invoice);
  const totalNeeded = quote.amount + quote.fee_reserve;

  // Step 2: Check balance
  const balance = sumProofs(proofs);
  if (balance < totalNeeded) {
    throw new Error('Insufficient balance');
  }

  // Step 3: Select proofs
  const proofsToSend = selectProofs(proofs, totalNeeded);

  // Step 4: Melt (pay invoice)
  const result = await wallet.meltProofs(quote, proofsToSend);

  // Step 5: Handle change
  const spent = sumProofs(proofsToSend);
  const changeAmount = result.change ? sumProofs(result.change) : 0;
  const actualFee = spent - quote.amount - changeAmount;

  console.log(`Paid ${quote.amount}, fee: ${actualFee}, change: ${changeAmount}`);

  return {
    paid: result.paid,
    preimage: result.payment_preimage,
    change: result.change || [],
    fee: actualFee
  };
}
```

### 5. Swapping Tokens

Swap proofs for new proofs (same total value).

**Use Cases:**
- Coin selection (split/combine denominations)
- Key rotation (swap to new keyset)
- Change secrets (privacy)

```typescript
// Swap proofs for specific amounts
const { keep, send } = await wallet.send(
  desiredAmount,
  allProofs,
  { includeFees: true }
);

// Or use swap directly
const newProofs = await wallet.swap(desiredAmount, oldProofs);
```

### 6. Checking Token State

Check if proofs are spent or unspent.

```typescript
const states = await wallet.checkProofsSpent(proofs);

for (const state of states) {
  console.log(`Secret: ${state.secret}`);
  console.log(`State: ${state.state}`);  // UNSPENT, SPENT, PENDING
  console.log(`Witness: ${state.witness}`);
}
```

**ProofState:**
```typescript
{
  secret: string;
  state: 'UNSPENT' | 'SPENT' | 'PENDING';
  witness?: string;
}
```

## WalletOps Builder Pattern

Flexible transaction builder for complex operations.

```typescript
import { WalletOps } from '@cashu/cashu-ts';

const ops = new WalletOps(wallet);

// Chain operations
const result = await ops
  .send(100, proofs)           // Send 100 sats
  .send(50, proofs)            // Send 50 more sats
  .melt(invoice, proofs)       // Pay invoice
  .execute();                  // Execute all operations

console.log('Results:', result);
```

## Token Encoding/Decoding

### Encode Token V4

```typescript
import { getEncodedTokenV4 } from '@cashu/cashu-ts';

const token = getEncodedTokenV4({
  token: [
    {
      mint: 'https://mint.example.com',
      proofs: proofs,
      unit: 'sat'
    }
  ],
  memo: 'Optional memo'
});

// token = 'cashuBo2F0gaNhbK...'
```

### Decode Token

```typescript
import { getDecodedToken } from '@cashu/cashu-ts';

const decoded = getDecodedToken(tokenString);

console.log(decoded);
// {
//   token: [
//     {
//       mint: 'https://mint.example.com',
//       proofs: [...],
//       unit: 'sat'
//     }
//   ],
//   memo: 'Optional memo'
// }
```

### Decode Token V3 (Legacy)

```typescript
import { getDecodedToken } from '@cashu/cashu-ts';

// Automatically detects V3 (cashuA) or V4 (cashuB)
const decoded = getDecodedToken(tokenString);
```

## Deterministic Secrets (Wallet Backup)

### Generate Deterministic Seed

```typescript
import { generateSeed, deriveSeedFromMnemonic } from '@cashu/cashu-ts';

// Generate new seed
const seed = generateSeed();  // Uint8Array(32)

// Or derive from mnemonic (BIP39)
const mnemonic = 'abandon abandon abandon...';  // 12 or 24 words
const seed = deriveSeedFromMnemonic(mnemonic);
```

### Use with Wallet

```typescript
import { CashuWallet } from '@cashu/cashu-ts';

const wallet = new CashuWallet(
  new CashuMint(mintUrl),
  {
    unit: 'sat',
    mnemonicOrSeed: seed  // Enable deterministic secrets
  }
);

// Wallet now uses deterministic secrets
// Can restore from seed later
```

### Counter Management

```typescript
// Get current counter value
const counter = wallet.getCounter();

// Set counter (for recovery)
wallet.setCounter(42);

// Wallet generates secrets as:
// secret = HMAC-SHA256(seed, counter || keyset_id || amount)
```

### Restore from Seed

```typescript
async function restoreWallet(mintUrl: string, seed: Uint8Array) {
  const wallet = new CashuWallet(
    new CashuMint(mintUrl),
    { mnemonicOrSeed: seed }
  );
  await wallet.loadMint();

  // Restore proofs by checking state
  const restoredProofs = await wallet.restore(0, 100);  // Check counters 0-100

  console.log('Restored proofs:', restoredProofs);
  return restoredProofs;
}
```

## P2PK (Pay-to-Public-Key)

Lock proofs to a specific public key.

### Send P2PK Locked Token

```typescript
import { getPublicKey } from '@cashu/cashu-ts';

const recipientPubkey = 'recipient-public-key-hex';

// Send with P2PK lock
const { keep, send } = await wallet.send(
  100,
  proofs,
  {
    pubkey: recipientPubkey  // Lock to recipient's key
  }
);

// Recipient MUST have private key to spend
```

### Receive P2PK Token

```typescript
// Recipient needs their private key
const recipientPrivkey = 'recipient-private-key-hex';

const receivedProofs = await wallet.receive(
  token,
  {
    privkey: recipientPrivkey  // Unlock with private key
  }
);
```

### Check P2PK Requirements

```typescript
function isP2PKLocked(proof: Proof): boolean {
  try {
    const secret = JSON.parse(proof.secret);
    return Array.isArray(secret) && secret[0] === 'P2PK';
  } catch {
    return false;
  }
}
```

## BOLT12 (Lightning Offers)

Support for reusable Lightning offers.

```typescript
// Create melt quote for BOLT12 offer
const offer = 'lno1...';  // BOLT12 offer string

const meltQuote = await wallet.createMeltQuoteBolt12(offer, {
  amount: 1000  // Optional amount for flexible offers
});

// Rest is same as BOLT11
const result = await wallet.meltProofs(meltQuote, proofs);
```

## Utility Functions

### Proof Utilities

```typescript
import { sumProofs, splitProofs } from '@cashu/cashu-ts';

// Sum proof amounts
const total = sumProofs(proofs);

// Split proofs by keyset
const byKeyset = splitProofs(proofs);
// { 'keyset-id-1': [...], 'keyset-id-2': [...] }
```

### Keyset Utilities

```typescript
import { deriveKeysetId } from '@cashu/cashu-ts';

// Derive keyset ID from keys
const keysetId = deriveKeysetId(keys);
```

### Amount to Denominations

```typescript
import { splitAmount } from '@cashu/cashu-ts';

const amounts = splitAmount(1000);
// [8, 32, 64, 128, 256, 512]  (powers of 2)
```

## TypeScript Types

### Core Types

```typescript
import type {
  Proof,
  Token,
  MintKeys,
  MintKeyset,
  BlindedMessage,
  BlindSignature,
  MintQuoteResponse,
  MeltQuoteResponse,
  MintInfo,
  SendResponse,
  ProofState
} from '@cashu/cashu-ts';

// Proof
type Proof = {
  amount: number;
  secret: string;
  C: string;       // Signature (hex-encoded point)
  id: string;      // Keyset ID
  witness?: string; // P2PK signature or other witness
};

// Token
type Token = {
  token: Array<{
    mint: string;
    proofs: Proof[];
    unit?: string;
  }>;
  memo?: string;
};

// Mint Keys
type MintKeys = {
  id: string;       // Keyset ID
  unit: string;     // Currency unit
  keys: Record<number, string>;  // amount → pubkey
};

// Mint Info
type MintInfo = {
  name?: string;
  pubkey?: string;
  version?: string;
  description?: string;
  description_long?: string;
  contact?: Array<Array<string>>;
  motd?: string;
  nuts: Record<number, any>;  // Supported NUTs
};
```

## Best Practices

### Wallet Management

1. **Always load mint first**
   ```typescript
   const wallet = new CashuWallet(new CashuMint(url));
   await wallet.loadMint();  // REQUIRED
   ```

2. **Cache mint data**
   ```typescript
   // Save after loading
   const keys = wallet.keys;
   const keysetId = wallet.keysetId;
   localStorage.setItem('mint-keys', JSON.stringify(keys));

   // Load from cache
   const cached = JSON.parse(localStorage.getItem('mint-keys'));
   const wallet = new CashuWallet(new CashuMint(url), {
     keys: cached,
     keysetId: cached.id
   });
   ```

3. **Handle errors gracefully**
   ```typescript
   try {
     const proofs = await wallet.mintProofs(amount, quote);
   } catch (error) {
     if (error.message.includes('Quote not paid')) {
       // Wait for payment
     } else if (error.message.includes('Quote already issued')) {
       // Already minted
     } else {
       throw error;
     }
   }
   ```

### Proof Management

1. **Track proofs per mint**
   ```typescript
   const proofsByMint = new Map<string, Proof[]>();
   proofsByMint.set(mintUrl, proofs);
   ```

2. **Check spent status before sending**
   ```typescript
   const states = await wallet.checkProofsSpent(proofs);
   const unspent = proofs.filter((p, i) =>
     states[i].state === 'UNSPENT'
   );
   ```

3. **Always swap received tokens**
   ```typescript
   // WRONG: Just add to wallet
   proofs.push(...receivedProofs);

   // RIGHT: Swap first
   const newProofs = await wallet.receive(token);
   proofs.push(...newProofs);
   ```

### Security

1. **Store seed securely**
   ```typescript
   // Encrypt before storing
   const encrypted = await encrypt(seed, userPassword);
   localStorage.setItem('wallet-seed', encrypted);
   ```

2. **Don't expose proofs**
   ```typescript
   // WRONG: Logs secrets
   console.log('Proofs:', proofs);

   // RIGHT: Log summary only
   console.log('Balance:', sumProofs(proofs));
   ```

3. **Use P2PK for sensitive transfers**
   ```typescript
   const { send } = await wallet.send(amount, proofs, {
     pubkey: recipientPubkey
   });
   // Recipient must have private key
   ```

### Performance

1. **Batch operations**
   ```typescript
   // Use WalletOps for multiple operations
   const result = await new WalletOps(wallet)
     .send(100, proofs)
     .send(200, proofs)
     .execute();
   ```

2. **Minimize API calls**
   ```typescript
   // Cache mint info
   const info = await mint.getInfo();
   // Don't call getInfo() repeatedly
   ```

3. **Use appropriate denominations**
   ```typescript
   // Let library handle denomination selection
   const { send } = await wallet.send(amount, proofs);
   // More efficient than manual selection
   ```

## Common Patterns

### Multi-Mint Wallet

```typescript
class MultiMintWallet {
  private wallets = new Map<string, CashuWallet>();
  private proofs = new Map<string, Proof[]>();

  async addMint(mintUrl: string) {
    const wallet = new CashuWallet(new CashuMint(mintUrl));
    await wallet.loadMint();
    this.wallets.set(mintUrl, wallet);
    this.proofs.set(mintUrl, []);
  }

  async deposit(mintUrl: string, amount: number) {
    const wallet = this.wallets.get(mintUrl);
    if (!wallet) throw new Error('Mint not found');

    const quote = await wallet.createMintQuote(amount);
    // ... handle payment ...
    const { proofs } = await wallet.mintProofs(amount, quote.quote);

    this.proofs.get(mintUrl)!.push(...proofs);
    return proofs;
  }

  async send(mintUrl: string, amount: number) {
    const wallet = this.wallets.get(mintUrl);
    const proofs = this.proofs.get(mintUrl);
    if (!wallet || !proofs) throw new Error('Mint not found');

    const { keep, send } = await wallet.send(amount, proofs);

    this.proofs.set(mintUrl, keep);
    return getEncodedTokenV4({
      token: [{ mint: mintUrl, proofs: send }]
    });
  }

  async receive(tokenString: string) {
    const decoded = getDecodedToken(tokenString);

    const results = [];
    for (const entry of decoded.token) {
      let wallet = this.wallets.get(entry.mint);
      if (!wallet) {
        await this.addMint(entry.mint);
        wallet = this.wallets.get(entry.mint)!;
      }

      const received = await wallet.receive({ token: [entry] });
      this.proofs.get(entry.mint)!.push(...received);
      results.push({ mint: entry.mint, amount: sumProofs(received) });
    }

    return results;
  }

  getTotalBalance(): number {
    let total = 0;
    for (const proofs of this.proofs.values()) {
      total += sumProofs(proofs);
    }
    return total;
  }
}
```

### Proof Selection Algorithm

```typescript
function selectProofs(proofs: Proof[], target: number): Proof[] {
  // Sort by amount descending
  const sorted = [...proofs].sort((a, b) => b.amount - a.amount);

  const selected: Proof[] = [];
  let sum = 0;

  for (const proof of sorted) {
    if (sum >= target) break;
    selected.push(proof);
    sum += proof.amount;
  }

  if (sum < target) {
    throw new Error(`Insufficient balance: have ${sum}, need ${target}`);
  }

  return selected;
}
```

### Wallet Persistence

```typescript
interface WalletState {
  mintUrl: string;
  proofs: Proof[];
  seed: string;
  counter: number;
}

async function saveWallet(wallet: CashuWallet, proofs: Proof[]) {
  const state: WalletState = {
    mintUrl: wallet.mint.mintUrl,
    proofs: proofs,
    seed: bytesToHex(wallet.seed),
    counter: wallet.getCounter()
  };

  const encrypted = await encrypt(JSON.stringify(state), password);
  localStorage.setItem('wallet-state', encrypted);
}

async function loadWallet(): Promise<{ wallet: CashuWallet; proofs: Proof[] }> {
  const encrypted = localStorage.getItem('wallet-state');
  if (!encrypted) throw new Error('No wallet found');

  const decrypted = await decrypt(encrypted, password);
  const state: WalletState = JSON.parse(decrypted);

  const seed = hexToBytes(state.seed);
  const wallet = new CashuWallet(
    new CashuMint(state.mintUrl),
    { mnemonicOrSeed: seed }
  );
  await wallet.loadMint();
  wallet.setCounter(state.counter);

  return { wallet, proofs: state.proofs };
}
```

## Troubleshooting

### Common Issues

**"Quote not paid" error:**
```typescript
// Wait for payment before minting
const quote = await wallet.createMintQuote(amount);
// ... user pays invoice ...
await waitForPayment(quote.quote);  // Poll checkMintQuote
const proofs = await wallet.mintProofs(amount, quote.quote);
```

**"Insufficient balance" error:**
```typescript
// Check balance first
const balance = sumProofs(proofs);
if (balance < amount) {
  throw new Error(`Need ${amount}, have ${balance}`);
}
```

**"Proofs already spent" error:**
```typescript
// Check state before sending
const states = await wallet.checkProofsSpent(proofs);
const unspent = proofs.filter((p, i) => states[i].state === 'UNSPENT');
```

**"Invalid signature" error:**
```typescript
// Verify proof structure
function isValidProof(proof: Proof): boolean {
  return (
    typeof proof.amount === 'number' &&
    typeof proof.secret === 'string' &&
    typeof proof.C === 'string' &&
    typeof proof.id === 'string' &&
    proof.C.length === 66  // 33-byte hex
  );
}
```

## Development Resources

### Testing

```typescript
import { CashuWallet, CashuMint } from '@cashu/cashu-ts';

// Use test mint (local nutshell instance)
const TEST_MINT_URL = 'http://localhost:3338';

describe('Cashu Wallet', () => {
  let wallet: CashuWallet;

  beforeEach(async () => {
    wallet = new CashuWallet(new CashuMint(TEST_MINT_URL));
    await wallet.loadMint();
  });

  it('should mint tokens', async () => {
    const quote = await wallet.createMintQuote(100);
    // ... pay invoice ...
    const { proofs } = await wallet.mintProofs(100, quote.quote);
    expect(sumProofs(proofs)).toBe(100);
  });
});
```

### Example Projects

- **Cashu.me**: Web wallet (https://cashu.me)
- **Nutstash**: PWA wallet with multi-mint support
- **eNuts**: Mobile wallet (React Native)

### Key Repositories

- **cashu-ts**: https://github.com/cashubtc/cashu-ts
- **cashu-ts docs**: https://cashubtc.github.io/cashu-ts/docs/
- **NPM package**: https://www.npmjs.com/package/@cashu/cashu-ts

## Related Skills

- **cashu** - Cashu protocol fundamentals and NUT specifications
- **nostr** - Nostr integration (NUT-25 wallet backup)
- **react** - Building Cashu wallet UIs with React
