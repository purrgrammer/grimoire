---
name: cashu
description: This skill should be used when working with the Cashu ecash protocol, implementing Cashu wallets or mints, handling ecash tokens, or discussing Cashu NUTs (Notation, Usage, and Terminology specifications). Provides comprehensive knowledge of Cashu's Chaumian ecash system, blind signatures, token lifecycle, and all standard NUTs.
---

# Cashu Ecash Protocol Expert

## Purpose

This skill provides expert-level assistance with the Cashu protocol, an open-source Chaumian ecash system built for Bitcoin. Cashu enables instant, private digital cash payments using blind signatures, where tokens are bearer instruments stored on users' devices.

## When to Use

Activate this skill when:
- Implementing Cashu wallets or mints
- Working with ecash tokens (minting, melting, swapping)
- Handling blind signatures and BDHKE cryptography
- Implementing any Cashu NUT specification
- Building payment systems with ecash
- Integrating Cashu with Lightning Network
- Working with spending conditions (P2PK, HTLCs)
- Implementing wallet backup/recovery
- Discussing privacy-preserving payment systems

## Core Concepts

### The Protocol Foundation

Cashu operates on two main components:
1. **Wallets** - Client applications that hold and transact ecash tokens
2. **Mints** - Servers that issue and redeem tokens, backed by Bitcoin/Lightning

Key principles:
- Tokens are bearer instruments (like physical cash)
- Blind signatures provide privacy (mint can't link issuance to redemption)
- Single-use tokens prevent double-spending
- Backed by Bitcoin via Lightning Network
- No account registration required

### Blind Diffie-Hellmann Key Exchange (BDHKE)

The cryptographic foundation of Cashu on secp256k1:

**Participants:**
- **Bob (Mint)**: Private key `k`, public key `K = kG`
- **Alice (User)**: Creates and holds tokens
- **Carol (Recipient)**: Receives tokens from Alice

**Token Creation Flow:**
1. Alice generates secret `x`, computes `Y = hash_to_curve(x)`
2. Alice picks random blinding factor `r`, sends `B_ = Y + rG` to mint
3. Mint returns blind signature `C_ = kB_`
4. Alice unblinds: `C = C_ - rK = kY` (this is the proof)
5. Token is the pair `(x, C)`

**Redemption:**
- Mint verifies `k * hash_to_curve(x) == C`
- Mint marks secret `x` as spent

### Hash-to-Curve Function

```
Y = PublicKey('02' || SHA256(msg_hash || counter))
msg_hash = SHA256(DOMAIN_SEPARATOR || x)
DOMAIN_SEPARATOR = b"Secp256k1_HashToCurve_Cashu_"
counter: uint32 little-endian, incremented until valid point
```

## Data Models

### BlindedMessage (sent to mint for signing)

```json
{
  "amount": 8,
  "id": "009a1f293253e41e",
  "B_": "02abc123..."
}
```

### BlindSignature (returned by mint)

```json
{
  "amount": 8,
  "id": "009a1f293253e41e",
  "C_": "03def456..."
}
```

### Proof (spendable token)

```json
{
  "amount": 8,
  "id": "009a1f293253e41e",
  "secret": "random_secret_string",
  "C": "02789abc..."
}
```

### Token Serialization

**V4 Format (current):** `cashuB[base64_urlsafe_cbor]`
```
{
  "m": "https://mint.example.com",
  "u": "sat",
  "d": "optional memo",
  "t": [{"i": "keyset_id", "p": [proofs...]}]
}
```

**Binary Format:** `craw` + version + CBOR payload

**V3 Format (deprecated):** `cashuA[base64_urlsafe_json]`

## NUT Specifications Reference

### Mandatory NUTs (Core Protocol)

| NUT | Title | Description |
|-----|-------|-------------|
| **00** | Cryptography and Models | BDHKE, hash-to-curve, data models, serialization |
| **01** | Mint Public Keys | `GET /v1/keys`, keyset exchange |
| **02** | Keysets and Fees | Keyset IDs, fee calculation (ppk) |
| **03** | Swapping Tokens | `POST /v1/swap` - denomination changes |
| **04** | Minting Tokens | Quote + mint flow via Lightning |
| **05** | Melting Tokens | Redeem tokens for Lightning payments |
| **06** | Mint Info | `GET /v1/info` - capabilities, supported NUTs |

### Optional NUTs

| NUT | Title | Description |
|-----|-------|-------------|
| **07** | Token State Check | UNSPENT, PENDING, SPENT states |
| **08** | Overpaid Lightning Fees | Blank outputs for fee change |
| **09** | Signature Restore | Recover blind signatures |
| **10** | Spending Conditions | Well-known secret format |
| **11** | Pay-To-Pubkey (P2PK) | Lock to public key |
| **12** | DLEQ Proofs | Prove mint key consistency |
| **13** | Deterministic Secrets | BIP39 wallet recovery |
| **14** | HTLCs | Hash Time-Locked Contracts |
| **15** | Multi-Path Payments | Pay from multiple mints |
| **16** | Animated QR Codes | UR protocol for large tokens |
| **17** | WebSocket Subscriptions | Real-time notifications |
| **18** | Payment Requests | Receiver-initiated payments |
| **19** | Cached Responses | Idempotent operations |
| **20** | Signature on Mint Quote | Front-running prevention |
| **21** | Clear Authentication | OAuth 2.0/OIDC |
| **22** | Blind Authentication | Privacy-preserving auth |
| **23** | Payment Method: BOLT11 | Lightning invoices |
| **24** | HTTP 402 Payment Required | Inline ecash payments |
| **25** | Payment Method: BOLT12 | Lightning offers |
| **26** | Payment Request Bech32m | Compact encoding |
| **27** | Nostr Mint Backup | Encrypted backup to Nostr |

## API Endpoints

### Key Management

```
GET  /v1/keys              # Active keysets
GET  /v1/keys/{keyset_id}  # Specific keyset
GET  /v1/keysets           # All keyset IDs
```

### Minting (Deposit Bitcoin → Get Tokens)

```
POST /v1/mint/quote/{method}   # Request quote (get invoice)
GET  /v1/mint/quote/{method}/{quote_id}  # Check quote status
POST /v1/mint/{method}         # Execute mint (get tokens)
```

**Flow:**
1. Request quote → receive Lightning invoice
2. Pay invoice
3. Submit blinded messages → receive blind signatures
4. Unblind to get proofs

### Melting (Spend Tokens → Pay Lightning)

```
POST /v1/melt/quote/{method}   # Request quote
GET  /v1/melt/quote/{method}/{quote_id}  # Check status
POST /v1/melt/{method}         # Execute melt
```

**Flow:**
1. Request quote with Lightning invoice → get amount + fee_reserve
2. Submit proofs (amount + fee_reserve) → mint pays invoice
3. Receive change for overpaid fees

### Swapping

```
POST /v1/swap
{
  "inputs": [proofs...],
  "outputs": [blinded_messages...]
}
→ {"signatures": [blind_signatures...]}
```

### Token State

```
POST /v1/checkstate
{"Ys": ["hash_to_curve(secret)..."]}
→ {"states": [{"Y": "...", "state": "UNSPENT|PENDING|SPENT"}]}
```

### Restore (Wallet Recovery)

```
POST /v1/restore
{"outputs": [blinded_messages...]}
→ {"outputs": [...], "signatures": [...]}
```

### Mint Info

```
GET /v1/info
→ {
    "name": "My Mint",
    "version": "Nutshell/0.15.0",
    "nuts": {"4": {...}, "5": {...}, ...}
  }
```

## Spending Conditions

### Well-Known Secret Format (NUT-10)

```json
["<kind>", {
  "nonce": "<unique_random_string>",
  "data": "<condition_data>",
  "tags": [["key", "value1", "value2"]]
}]
```

### P2PK (NUT-11)

Lock tokens to a public key:

```json
["P2PK", {
  "nonce": "abc123",
  "data": "02pubkey_hex",
  "tags": [
    ["sigflag", "SIG_INPUTS"],
    ["n_sigs", "2"],
    ["pubkeys", "02key2", "02key3"],
    ["locktime", "1700000000"],
    ["refund", "02refund_key"]
  ]
}]
```

**Witness:**
```json
{"signatures": ["schnorr_sig_hex"]}
```

### HTLC (NUT-14)

Hash Time-Locked Contracts:

```json
["HTLC", {
  "nonce": "xyz789",
  "data": "sha256_hash_of_preimage",
  "tags": [
    ["pubkeys", "02receiver_key"],
    ["locktime", "1700000000"],
    ["refund", "02sender_key"]
  ]
}]
```

**Witness:**
```json
{
  "preimage": "hex_preimage",
  "signatures": ["schnorr_sig_hex"]
}
```

## Fee Calculation

Fees are expressed in parts-per-thousand (ppk) per input:

```
individual_fee = input_fee_ppk  // per input
total_fee = ceil(sum(individual_fees) / 1000)

// Balance equation:
sum(inputs) - total_fee = sum(outputs)
```

## DLEQ Proofs (NUT-12)

Prove mint used same private key without revealing it:

**Mint generates:**
- Random `r`, compute `R1 = rG`, `R2 = rB_`
- Challenge `e = SHA256(R1 || R2 || A || C_)`
- Response `s = r + e*a`

**User verifies:**
- `R1 = sG - eA`
- `R2 = sB_ - eC_`
- `e == SHA256(R1 || R2 || A || C_)`

## Wallet Recovery (NUT-13)

### Derivation (Keyset v01)

```
secret = HMAC-SHA256(
  "Cashu_KDF_HMAC_SHA256" || keyset_id || counter || 0x00
) mod n

r = HMAC-SHA256(
  "Cashu_KDF_HMAC_SHA256" || keyset_id || counter || 0x01
) mod n
```

### Recovery Flow

1. Derive secrets from BIP39 mnemonic
2. Generate BlindedMessages
3. Call `POST /v1/restore`
4. Unblind returned signatures
5. Check states via `POST /v1/checkstate`
6. Continue in batches of 100 until 3 empty batches

## Authentication

### Clear Auth (NUT-21)

- OAuth 2.0/OIDC integration
- JWT in `Clear-auth` header
- Identifies user to mint

### Blind Auth (NUT-22)

- Privacy-preserving tokens
- Unit: `auth`, single denomination
- Token in `Blind-auth` header
- Single-use, user anonymous within group

## Payment Requests (NUT-18)

**Format:** `creqA[base64_cbor]` or `creqb1...` (bech32m)

```json
{
  "i": "payment_id",
  "a": 1000,
  "u": "sat",
  "m": ["https://mint1.com", "https://mint2.com"],
  "d": "Coffee payment",
  "t": [{"t": "nostr", "a": "nprofile1..."}],
  "nut10": {"k": "P2PK", "d": "02pubkey"}
}
```

**Transport methods:**
- `nostr` - NIP-17 direct message
- `post` - HTTP POST to URL
- Empty = in-band (HTTP header)

## WebSocket Subscriptions (NUT-17)

```json
// Subscribe
{"kind": "bolt11_mint_quote", "subId": "uuid", "filters": ["quote_id"]}

// Notification
{"subId": "uuid", "payload": {...quote_response...}}

// Unsubscribe
{"unsubscribe": "uuid"}
```

**Subscription kinds:**
- `bolt11_mint_quote` / `bolt11_melt_quote`
- `bolt12_mint_quote` / `bolt12_melt_quote`
- `proof_state`

## Nostr Integration (NUT-27)

Encrypted mint list backup:

- **Event kind:** 30078 (NIP-78)
- **Encryption:** NIP-44 v2
- **d-tag:** `mint-list`
- **Key:** `SHA256(BIP39_seed || "cashu-mint-backup")`

## Security Considerations

1. **Quote IDs are secrets** - Can be used to front-run minting
2. **Use NUT-20** - Lock mint quotes to your pubkey
3. **DLEQ proofs** - Enable offline verification
4. **Blinding factor `r`** - Never share with mint
5. **Single-use tokens** - Always swap received tokens immediately
6. **Verify mint** - Check NUT-06 info before trusting
7. **Multiple mints** - Don't keep all funds in one mint

## Implementation Best Practices

### For Wallets

1. **Verify DLEQ proofs** when receiving tokens
2. **Swap immediately** after receiving tokens from others
3. **Generate unique pubkeys** for each mint quote (NUT-20)
4. **Implement NUT-13** for seed-based recovery
5. **Use NUT-19 cached responses** for reliability
6. **Check token states** before spending (NUT-07)
7. **Handle pending states** gracefully
8. **Order outputs ascending** by amount for privacy

### For Mints

1. **Persist blind signatures** for NUT-09 restore
2. **Implement rate limiting** to prevent abuse
3. **Track pending proofs** with mutex locks
4. **Use NUT-19 caching** for idempotency
5. **Implement NUT-12 DLEQ** for trustless verification
6. **Provide NUT-06 info** with all supported features
7. **Handle key rotation** gracefully

## Common Patterns

### Minting Tokens

```typescript
// 1. Get quote
const quote = await fetch(`${mint}/v1/mint/quote/bolt11`, {
  method: 'POST',
  body: JSON.stringify({ amount: 1000, unit: 'sat' })
}).then(r => r.json());

// 2. Pay the invoice (quote.request)
// ... pay Lightning invoice ...

// 3. Generate blinded messages
const { blindedMessages, secrets, rs } = createBlindedMessages(amounts, keysetId);

// 4. Get signatures
const { signatures } = await fetch(`${mint}/v1/mint/bolt11`, {
  method: 'POST',
  body: JSON.stringify({ quote: quote.quote, outputs: blindedMessages })
}).then(r => r.json());

// 5. Unblind to get proofs
const proofs = unblindSignatures(signatures, secrets, rs, keys);
```

### Sending Tokens

```typescript
// 1. Select proofs for amount
const { send, keep } = selectProofsToSend(proofs, amount);

// 2. Swap to get exact amount (optional but recommended)
const { outputs, blindingFactors } = createBlindedMessages([amount, ...changeDenominations]);
const { signatures } = await fetch(`${mint}/v1/swap`, {
  method: 'POST',
  body: JSON.stringify({ inputs: send, outputs })
}).then(r => r.json());

// 3. Serialize token for recipient
const token = serializeToken({ mint, unit: 'sat', proofs: sendProofs });
// Returns: cashuBxxxxx...
```

### Receiving Tokens

```typescript
// 1. Deserialize token
const { mint, unit, proofs } = deserializeToken(tokenString);

// 2. Swap immediately (invalidates sender's copy)
const { outputs, blindingFactors } = createBlindedMessages(proofs.map(p => p.amount));
const { signatures } = await fetch(`${mint}/v1/swap`, {
  method: 'POST',
  body: JSON.stringify({ inputs: proofs, outputs })
}).then(r => r.json());

// 3. Unblind and store new proofs
const newProofs = unblindSignatures(signatures, secrets, blindingFactors, keys);
```

### Paying Lightning Invoice

```typescript
// 1. Get melt quote
const quote = await fetch(`${mint}/v1/melt/quote/bolt11`, {
  method: 'POST',
  body: JSON.stringify({ request: bolt11Invoice, unit: 'sat' })
}).then(r => r.json());

// 2. Select proofs (amount + fee_reserve)
const proofs = selectProofs(quote.amount + quote.fee_reserve);

// 3. Create blank outputs for fee change
const blankOutputs = createBlankOutputs(Math.ceil(Math.log2(quote.fee_reserve)));

// 4. Execute melt
const result = await fetch(`${mint}/v1/melt/bolt11`, {
  method: 'POST',
  body: JSON.stringify({ quote: quote.quote, inputs: proofs, outputs: blankOutputs })
}).then(r => r.json());

// 5. Process change if any
if (result.change) {
  const changeProofs = unblindSignatures(result.change, ...);
}
```

## Error Handling

Mint errors return HTTP 400 with:

```json
{
  "detail": "Human readable error message",
  "code": 10000
}
```

Common error codes:
- `10000` - Token already spent
- `10001` - Transaction unbalanced
- `10002` - Unit not supported
- `11001` - Quote not found
- `11002` - Quote expired
- `20000` - Keyset not found
- `20001` - Keyset inactive
- `20008` - Quote requires signature (NUT-20)

## Official Resources

- **Website**: https://cashu.space
- **Documentation**: https://docs.cashu.space
- **NUTs Specifications**: https://cashubtc.github.io/nuts/
- **GitHub**: https://github.com/cashubtc/nuts
- **Cashu Dev Kit**: https://cashudevkit.org
- **Reference Implementation**: https://github.com/cashubtc/nutshell

## Quick Checklist

When implementing Cashu:
- [ ] BDHKE operations use secp256k1 correctly
- [ ] Hash-to-curve follows spec with domain separator
- [ ] Token serialization uses V4 CBOR format
- [ ] Keyset IDs calculated correctly (SHA256 + version prefix)
- [ ] Fee calculation uses ppk (parts per thousand)
- [ ] Proofs are swapped immediately after receiving
- [ ] DLEQ proofs verified when present
- [ ] Spending conditions parsed and validated
- [ ] Quote IDs kept secret (use NUT-20)
- [ ] Wallet recovery implemented (NUT-13)
- [ ] Error codes handled appropriately
- [ ] WebSocket subscriptions cleaned up
