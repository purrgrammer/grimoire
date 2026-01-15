---
name: cashu
description: This skill should be used when working with the Cashu ecash protocol, implementing Cashu wallets or mints, handling ecash tokens, or discussing Cashu NUT specifications. Provides comprehensive knowledge of Chaumian blind signatures, Bitcoin Lightning integration, and privacy-preserving digital cash.
---

# Cashu Protocol Expert

## Purpose

This skill provides expert-level assistance with the Cashu protocol, a free and open-source Chaumian ecash system built for Bitcoin. The protocol enables private, instant, and nearly free transactions using blind signatures over the Lightning Network.

## When to Use

Activate this skill when:
- Implementing Cashu wallets or mints
- Working with ecash tokens and blind signatures
- Handling minting and melting operations
- Implementing any Cashu NUT specification
- Building privacy-preserving payment applications
- Integrating Lightning Network with ecash
- Discussing cryptographic operations (BDHKE, blind signatures)
- Working with token serialization and encoding

## Core Concepts

### Protocol Foundation

Cashu is built on **Blind Diffie-Hellman Key Exchange (BDHKE)**, a variant of David Wagner's Chaumian blinding scheme. The protocol involves three parties:

1. **Alice (User)** - Holds secrets and creates blinded messages
2. **Bob (Mint)** - Issues blind signatures and manages private keys
3. **Carol (Recipient)** - Receives and verifies tokens

Key principles:
- Privacy through blind signatures (mint can't link tokens to users)
- Instant and final transactions (like physical cash)
- Bitcoin-backed via Lightning Network
- Custodial model (mint holds Bitcoin)
- Open protocol (anyone can run a mint)

### Ecash System Architecture

**Mint (Server):**
- Holds Bitcoin in custody
- Issues blind signatures for denominations
- Manages private keys per denomination
- Provides Lightning endpoints for deposits/withdrawals
- Cannot track token ownership or transaction history

**Wallet (Client):**
- Generates secrets and blinding factors
- Creates blinded messages for minting
- Unblinds signatures to create valid tokens
- Stores proofs (ecash tokens)
- Handles sending and receiving
- Melts tokens back to Lightning

### Cryptographic Operations (BDHKE)

#### Key Generation
```
Mint generates:
  k = private key (scalar)
  K = k·G = public key (point on secp256k1)
  G = generator point
```

#### Blinding Protocol (5 Steps)

**1. Blinding (Alice → Bob)**
```
Alice generates:
  x = secret (random 32 bytes)
  r = blinding factor (random scalar)
  Y = hash_to_curve(x)
  B_ = Y + r·G (blinded message)
Alice sends B_ to Bob
```

**2. Signing (Bob → Alice)**
```
Bob computes:
  C_ = k·B_ (blind signature)
Bob sends C_ to Alice
```

**3. Unblinding (Alice)**
```
Alice computes:
  C = C_ - r·K = k·Y (unblinded signature)
Result: Proof = (x, C)
```

**4. Transfer (Alice → Carol)**
```
Alice sends proof (x, C) to Carol
Carol sends to Bob for verification
```

**5. Verification (Bob)**
```
Bob checks:
  k·hash_to_curve(x) == C
  x not in spent secrets database
If valid, Bob marks x as spent
```

#### Hash-to-Curve Function

Deterministic mapping from secret to curve point:

```
msg_hash = SHA256(DOMAIN_SEPARATOR || x)
DOMAIN_SEPARATOR = b"Secp256k1_HashToCurve_Cashu_"

counter = 0
loop:
  candidate = SHA256(msg_hash || counter)
  try:
    Y = PublicKey('02' || candidate)  // Compressed point
    if valid: return Y
  counter += 1
```

### Token Format

#### Proof Structure

A **Proof** is an unblinded signature representing value:

```json
{
  "amount": 8,                    // Token denomination
  "secret": "9a3b2c1d...",        // 64-char hex (or UTF-8)
  "C": "02ab3c4d5e...",           // Unblinded signature (33-byte compressed point)
  "id": "00ffd48b78a7b2f4"       // Keyset ID (identifies mint's key)
}
```

**Proof Fields:**
- `amount`: Denomination in base unit (sats)
- `secret`: Random hex string (must be unique)
- `C`: secp256k1 point (hex-encoded compressed format)
- `id`: Keyset identifier (8-byte hex)

#### BlindedMessage Structure

Sent by wallet to request blind signature:

```json
{
  "amount": 8,
  "id": "00ffd48b78a7b2f4",      // Keyset ID
  "B_": "02c1a3b5d7..."          // Blinded secret (33-byte point)
}
```

#### BlindSignature (Promise)

Returned by mint after blinding:

```json
{
  "amount": 8,
  "id": "00ffd48b78a7b2f4",
  "C_": "03ab5c7d9e..."          // Blinded signature
}
```

### Token Serialization

#### V4 Tokens (Current Standard)

Format: `cashuB[base64_urlsafe_cbor]`

**Structure (CBOR-encoded):**
```json
{
  "t": [                          // Token array
    {
      "m": "https://mint.host",   // Mint URL
      "u": "sat",                 // Unit (sat, usd, etc.)
      "d": "Thanks!",             // Optional memo
      "t": [                      // Token entries
        {
          "i": "00ffd48b",        // Keyset ID (short form)
          "p": [                  // Proofs array
            {
              "a": 8,             // Amount
              "s": "9a3b2c...",   // Secret
              "c": "02ab3c..."    // Signature
            }
          ]
        }
      ]
    }
  ]
}
```

**Binary Encoding:**
```
"cashu" (UTF-8) + "B" + CBOR(token_object)
```

**Advantages:**
- Space-efficient (CBOR vs JSON)
- Abbreviated keys (single letters)
- Short keyset IDs (8 bytes instead of 16)
- Multi-mint support in single token

#### V3 Tokens (Deprecated)

Format: `cashuA[base64_urlsafe_json]`

JSON-based with full field names. Still readable but less efficient.

### Keysets and Denominations

**Keyset**: Set of public keys for different amounts

```json
{
  "id": "00ffd48b78a7b2f4",       // Keyset identifier
  "unit": "sat",                   // Currency unit
  "keys": {
    "1": "02ab3c4d...",           // Public key for 1 sat
    "2": "03bc5d6e...",           // Public key for 2 sats
    "4": "02cd7e8f...",           // Public key for 4 sats
    "8": "03de9f0a...",           // Public key for 8 sats
    // ... powers of 2
  }
}
```

**Why Powers of 2?**
- Any amount can be represented as sum of powers of 2
- Efficient coin selection
- Example: 13 sats = 8 + 4 + 1 (3 proofs)

**Keyset ID Derivation:**
```
id = SHA256(sorted_pubkeys_concatenated)[:16]  // First 16 bytes (hex)
```

## Cashu NUTs (Specifications)

### Mandatory NUTs (Must Implement)

All wallets and mints **MUST** implement these:

#### NUT-00: Cryptography and Models
- BDHKE blind signature scheme
- Token data structures (Proof, BlindedMessage, BlindSignature)
- Token serialization (V3 and V4 formats)
- Hash-to-curve function
- Error codes and responses

#### NUT-01: Mint Public Keys
- **Endpoint**: `GET /v1/keys`
- **Response**: Keyset with public keys for each amount
- Allows wallet to unblind signatures
- Supports key rotation

#### NUT-02: Keysets and Fees
- **Endpoint**: `GET /v1/keysets`
- Lists all active and inactive keysets
- Fee structure per keyset
- Unit specification (sat, msat, usd, etc.)

#### NUT-03: Swapping Tokens
- **Endpoint**: `POST /v1/swap`
- Exchange proofs for new proofs (same total value)
- Used for: sending specific amounts, combining/splitting, key rotation
- Atomic operation (all or nothing)

#### NUT-04: Minting Tokens
- **Endpoint**: `POST /v1/mint/quote/bolt11` (create quote)
- **Endpoint**: `POST /v1/mint/bolt11` (mint tokens)
- Deposit Bitcoin via Lightning
- Receive blinded signatures (promises)
- Unblind to get valid proofs

#### NUT-05: Melting Tokens
- **Endpoint**: `POST /v1/melt/quote/bolt11` (create quote)
- **Endpoint**: `POST /v1/melt/bolt11` (melt tokens)
- Withdraw Bitcoin via Lightning
- Provide proofs to cover amount + fee
- Receive change if overpaid

#### NUT-06: Mint Information
- **Endpoint**: `GET /v1/info`
- Mint metadata (name, description, version)
- Supported NUTs
- Contact information
- Message of the day (MOTD)

### Optional NUTs (Recommended)

#### NUT-07: Token State Check
- **Endpoint**: `POST /v1/checkstate`
- Check if secrets are spent or pending
- Returns state: `UNSPENT`, `SPENT`, `PENDING`
- Useful for wallet recovery

#### NUT-08: Overpaid Lightning Fees
- **Endpoint**: `POST /v1/melt/quote/bolt11` returns fee_reserve
- Return change when actual fee < fee_reserve
- Prevents fee overpayment

#### NUT-09: Restore Signatures
- **Endpoint**: `POST /v1/restore`
- Recover lost proofs using deterministic secrets
- Requires counter-based secret generation
- Useful for wallet backup/recovery

#### NUT-10: Spending Conditions
- P2PK (Pay-to-Public-Key) locking
- HTLC (Hashed Timelock Contracts)
- Custom spending conditions on proofs
- Enhanced security and programmability

#### NUT-11: Pay-to-Public-Key (P2PK)
- Lock proofs to specific pubkey
- Requires signature to spend
- Format: `["P2PK", {"nonce": "...", "data": "pubkey", "tags": [...]}]`
- Prevents theft if proofs leaked

#### NUT-12: DLEQ Proofs
- Discrete Log Equality Proofs
- Proves mint signed correctly without revealing key
- Prevents mint from creating unbacked tokens
- Optional but increases trust

#### NUT-13: Deterministic Secrets
- Generate secrets from counter + seed
- Enables deterministic wallet recovery
- Works with NUT-09 for backup
- Format: `secret = hash(seed || counter)`

#### NUT-14: Hashed Timelock Contracts (HTLC)
- Time-locked proofs
- Preimage reveals spending ability
- Useful for atomic swaps, escrow
- Format: `["HTLC", {"nonce": "...", "data": "hash", "tags": [["locktime", "timestamp"]]}]`

#### NUT-15: Multi-Path Payments (MPP)
- Split payment across multiple routes
- Improves Lightning payment success rate
- Coordination between wallet and mint

### Extended NUTs

- **NUT-16**: Animated QR codes for large tokens
- **NUT-17**: WebSocket subscriptions for real-time updates
- **NUT-18**: Payment requests (invoicing)
- **NUT-19**: Cached responses for performance
- **NUT-20**: Multiple signature methods
- **NUT-21**: BOLT11 Lightning invoices (mandatory for Lightning)
- **NUT-22**: BOLT12 Lightning offers
- **NUT-23**: HTTP 402 Payment Required
- **NUT-24**: Bech32m encoding for tokens
- **NUT-25**: Nostr-based wallet backup

## Core Operations

### 1. Minting (Deposit Bitcoin → Get Ecash)

**Flow:**
```
1. Wallet creates mint quote
   POST /v1/mint/quote/bolt11 {amount: 1000}
   → {quote: "quote_id", request: "lnbc...", paid: false}

2. User pays Lightning invoice (external)

3. Wallet generates secrets and blinds them
   secrets = [random_32_bytes() for _ in amounts]
   blinded_messages = [blind(secret, amount) for secret, amount in zip(secrets, amounts)]

4. Wallet requests signatures
   POST /v1/mint/bolt11 {quote: "quote_id", outputs: blinded_messages}
   → {signatures: [blind_signatures]}

5. Wallet unblinds signatures
   proofs = [unblind(signature, secret) for signature, secret in zip(signatures, secrets)]

6. Wallet stores proofs
```

**Example (1000 sats → proofs for 512, 256, 128, 64, 32, 8):**
```typescript
// Step 1: Create quote
const quote = await mint.createMintQuote(1000);
console.log("Pay invoice:", quote.request);

// Step 2: Wait for payment
await waitForPayment(quote.quote);

// Step 3-4: Generate blinded messages
const outputs = generateBlindedMessages([512, 256, 128, 64, 32, 8]);

// Step 4: Request signatures
const { signatures } = await mint.mintTokens(quote.quote, outputs);

// Step 5: Unblind
const proofs = unblindSignatures(signatures, secrets);
```

### 2. Sending (Transfer Ecash)

**Flow:**
```
1. Select proofs totaling send_amount (+ optional fee)
   selected = coin_select(proofs, send_amount)

2. If exact amount: send proofs directly
   If over: swap to get exact amount + change

3. Create swap request
   POST /v1/swap {
     inputs: selected_proofs,
     outputs: blinded_messages_for(send_amount + change)
   }
   → {signatures: [...]}

4. Unblind signatures
   send_proofs = unblind(signatures[:send_count])
   keep_proofs = unblind(signatures[send_count:])

5. Encode send_proofs as token
   token = encode_token_v4(send_proofs, mint_url)

6. Share token with recipient (QR, text, NFC)
```

**Example (send 100 sats, have proofs for 128):**
```typescript
// Swap 128 proof into 100 (send) + 28 (change)
const { keep, send } = await wallet.send(100, proofs);
const token = getEncodedTokenV4({ mint: mintUrl, proofs: send });
console.log("Send this:", token);  // cashuB...
```

### 3. Receiving (Accept Ecash)

**Flow:**
```
1. Decode token
   decoded = decode_token_v4(token_string)
   → {mint: "url", proofs: [...]}

2. Verify mint URL (trust check)

3. Swap received proofs for new ones (prevents double-spend)
   POST /v1/swap {
     inputs: decoded.proofs,
     outputs: blinded_messages_for_same_total
   }
   → {signatures: [...]}

4. Unblind signatures
   new_proofs = unblind(signatures)

5. Store new_proofs in wallet
```

**Why swap on receive?**
- Sender knows the secrets, could double-spend
- Swapping creates new secrets only recipient knows
- Makes tokens truly bearer assets after swap

**Example:**
```typescript
const token = getDecodedToken(tokenString);
const newProofs = await wallet.receive(token);
// newProofs are now safe to spend
```

### 4. Melting (Withdraw Ecash → Get Bitcoin)

**Flow:**
```
1. Create melt quote with Lightning invoice
   POST /v1/melt/quote/bolt11 {request: "lnbc..."}
   → {quote: "quote_id", amount: 1000, fee_reserve: 10}

2. Select proofs for amount + fee_reserve
   proofs = coin_select(wallet.proofs, 1010)

3. Melt tokens
   POST /v1/melt/bolt11 {
     quote: "quote_id",
     inputs: proofs
   }
   → {paid: true, payment_preimage: "...", change: [signatures]}

4. If overpaid, unblind change
   if change:
     change_proofs = unblind(change)
     store(change_proofs)

5. Lightning payment is now complete
```

**Example (pay 1000 sat invoice with 1024 sats of proofs):**
```typescript
const invoice = "lnbc1000...";
const meltQuote = await mint.createMeltQuote(invoice);
// meltQuote.amount = 1000, meltQuote.fee_reserve = 24

const proofs = selectProofs(1024);  // Cover amount + fee
const meltResult = await mint.meltTokens(meltQuote.quote, proofs);

if (meltResult.change) {
  const changeProofs = unblind(meltResult.change);
  // Actual fee was less, got change back
}
```

### 5. Checking Token State

**Flow:**
```
POST /v1/checkstate {
  Ys: [hash_to_curve(secret1), hash_to_curve(secret2), ...]
}
→ {
  states: [
    {Y: "02ab...", state: "UNSPENT", witness: null},
    {Y: "03cd...", state: "SPENT", witness: null},
    {Y: "02ef...", state: "PENDING", witness: null}
  ]
}
```

**States:**
- `UNSPENT`: Token valid and unspent
- `SPENT`: Token already redeemed
- `PENDING`: Token in pending transaction

## Implementation Best Practices

### For Wallets

1. **Key Management**
   - Generate cryptographically secure random secrets
   - Never reuse secrets (prevents linking)
   - Store proofs encrypted at rest

2. **Coin Selection**
   - Use powers of 2 for efficient representation
   - Minimize number of proofs sent (combines proofs)
   - Consider fees in selection logic

3. **Always Swap on Receive**
   - Sender knows secrets, could double-spend
   - Creates new secrets only you know
   - Critical security practice

4. **Multiple Mint Support**
   - Allow users to trust multiple mints
   - Separate balance per mint
   - V4 tokens support multi-mint payments

5. **Backup and Recovery**
   - Implement NUT-13 (deterministic secrets)
   - Use NUT-09 for signature restoration
   - Store seed securely (12/24 word mnemonic)

6. **Error Handling**
   - Handle double-spend errors gracefully
   - Retry failed melt operations
   - Check token state before sending

7. **Privacy Considerations**
   - Don't correlate amounts across sessions
   - Use Tor/VPN for mint connections
   - Regularly swap tokens for new secrets

### For Mints

1. **Signature Verification**
   - Always verify proof signatures
   - Check secrets not in spent database
   - Validate keyset IDs

2. **Database Management**
   - Index spent secrets for fast lookup
   - Store pending operations atomically
   - Archive old keysets (never delete)

3. **Lightning Integration**
   - Robust Lightning node management
   - Handle payment failures gracefully
   - Return change for overpaid fees (NUT-08)

4. **Key Rotation**
   - Rotate keysets periodically
   - Keep old keysets active for swapping
   - Announce deprecation before deactivation

5. **Rate Limiting**
   - Prevent spam (checkstate, mint quote spam)
   - Implement proof-of-work (optional)
   - Monitor for abuse patterns

6. **DLEQ Proofs** (Recommended)
   - Implement NUT-12 for transparency
   - Proves signatures are valid
   - Builds user trust

7. **Monitoring and Logging**
   - Track Lightning balance vs issued proofs
   - Alert on discrepancies
   - Log all operations for auditing

### Security Considerations

1. **Mint Custody Risk**
   - Mints are custodial (hold Bitcoin)
   - Users must trust mint operator
   - Diversify across multiple mints

2. **Double-Spend Prevention**
   - Mint tracks spent secrets
   - Atomic swap operations
   - Network race conditions possible (accept only once)

3. **Key Compromise**
   - If mint's private key leaks, tokens can be forged
   - Key rotation limits damage
   - Monitor for anomalies

4. **Secret Reuse**
   - NEVER reuse secrets (breaks privacy)
   - NEVER share secrets before receiving payment
   - Always generate fresh secrets

5. **Token Lifetime**
   - Tokens don't expire (unless mint goes offline)
   - Old keysets can become invalid
   - Swap to active keysets regularly

6. **Network Privacy**
   - Use Tor for mint connections
   - Don't reveal IP to mint
   - Avoid timing correlation

## Common Patterns

### Coin Selection Algorithm

```typescript
function selectProofs(proofs: Proof[], targetAmount: number): Proof[] {
  // Sort by amount descending
  const sorted = proofs.sort((a, b) => b.amount - a.amount);

  const selected: Proof[] = [];
  let sum = 0;

  for (const proof of sorted) {
    if (sum >= targetAmount) break;
    selected.push(proof);
    sum += proof.amount;
  }

  if (sum < targetAmount) {
    throw new Error("Insufficient balance");
  }

  return selected;
}
```

### Amount to Denominations

```typescript
function amountToDenominations(amount: number): number[] {
  const denominations: number[] = [];
  let remaining = amount;
  let power = 0;

  while (remaining > 0) {
    if (remaining & 1) {
      denominations.push(1 << power);  // 2^power
    }
    remaining >>= 1;
    power++;
  }

  return denominations;
}

// Example: 1000 = 512 + 256 + 128 + 64 + 32 + 8
console.log(amountToDenominations(1000));
// [8, 32, 64, 128, 256, 512]
```

### Deterministic Secret Generation

```typescript
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';

function generateSecret(seed: Uint8Array, counter: number): string {
  const counterBytes = new Uint8Array(8);
  new DataView(counterBytes.buffer).setBigUint64(0, BigInt(counter), false);

  const combined = new Uint8Array(seed.length + counterBytes.length);
  combined.set(seed);
  combined.set(counterBytes, seed.length);

  return bytesToHex(sha256(combined));
}
```

### Token Encoding Helper

```typescript
import { encodeBase64Url } from './utils';
import { encode as cborEncode } from 'cbor-x';

function encodeTokenV4(proofs: Proof[], mintUrl: string, memo?: string): string {
  // Group proofs by keyset ID
  const grouped = new Map<string, Proof[]>();
  for (const proof of proofs) {
    if (!grouped.has(proof.id)) {
      grouped.set(proof.id, []);
    }
    grouped.get(proof.id)!.push(proof);
  }

  // Build token object
  const token = {
    t: [{
      m: mintUrl,
      u: "sat",
      ...(memo && { d: memo }),
      t: Array.from(grouped.entries()).map(([id, proofs]) => ({
        i: id.slice(0, 16),  // Short form (8 bytes)
        p: proofs.map(p => ({
          a: p.amount,
          s: p.secret,
          c: p.C
        }))
      }))
    }]
  };

  const cbor = cborEncode(token);
  return 'cashuB' + encodeBase64Url(cbor);
}
```

## Troubleshooting

### Common Issues

**Token Already Spent:**
- Cause: Secret already in spent database
- Solution: Don't reuse tokens, always swap received tokens
- Check state before sending: `POST /v1/checkstate`

**Signature Verification Failed:**
- Cause: Invalid proof, wrong keyset, or tampered data
- Solution: Verify proof structure, check keyset ID, re-request from sender

**Lightning Payment Failed:**
- Cause: Invoice expired, insufficient liquidity, routing failure
- Solution: Retry with new quote, try different route, check balance

**Mint Not Responding:**
- Cause: Mint offline, network issues, rate limiting
- Solution: Use backup mint, check connection, wait and retry

**Amount Mismatch:**
- Cause: Fee estimation wrong, coin selection error
- Solution: Request melt quote first (shows fee), add buffer for fees

**Cannot Decode Token:**
- Cause: Invalid encoding, wrong version, corrupted data
- Solution: Check token prefix (cashuA/cashuB), validate base64, try different parser

## Development Resources

### Essential NUTs for Beginners

Start with these specifications in order:
1. **NUT-00** - Cryptography and models (MUST read)
2. **NUT-01** - Mint public keys
3. **NUT-04** - Minting tokens
4. **NUT-05** - Melting tokens
5. **NUT-03** - Swapping tokens
6. **NUT-07** - Token state check

### Testing and Development

- **Reference Mint**: nutshell (Python implementation)
- **Test Mint**: Use local nutshell instance for development
- **Libraries**: cashu-ts (TypeScript), cashu-crab (Rust), cashu-feni (Dart)
- **Wallets**: Nutstash (web), eNuts (mobile), Cashu.me (web)
- **Tools**: Cashu Explorer, token decoder utilities

### Key Repositories

- **NUTs Repository**: https://github.com/cashubtc/nuts
- **Nutshell (Python mint)**: https://github.com/cashubtc/nutshell
- **cashu-ts (TypeScript)**: https://github.com/cashubtc/cashu-ts
- **Cashu Website**: https://cashu.space
- **Documentation**: https://docs.cashu.space

## Reference Files

For comprehensive technical details, see:
- **references/nuts-overview.md** - Detailed descriptions of all NUT specifications
- **references/common-patterns.md** - Code patterns and best practices

## Quick Checklist

When implementing Cashu:
- [ ] Proofs have all required fields (amount, secret, C, id)
- [ ] Secrets are cryptographically random (32 bytes)
- [ ] Never reuse secrets across operations
- [ ] Always swap tokens on receive (critical for security)
- [ ] Verify mint signatures using public keys from NUT-01
- [ ] Use powers of 2 denominations for efficiency
- [ ] Handle keyset rotation gracefully
- [ ] Implement backup/recovery (NUT-09, NUT-13)
- [ ] Check token state before sending (NUT-07)
- [ ] Connected to multiple mints for redundancy
- [ ] Following relevant NUTs for features implemented

## Official Resources

- **Cashu Website**: https://cashu.space
- **Cashu Documentation**: https://docs.cashu.space
- **NUTs Repository**: https://github.com/cashubtc/nuts
- **Cashu Organization**: https://github.com/cashubtc
- **Cashu Community**: Telegram, Discord (links at cashu.space)
