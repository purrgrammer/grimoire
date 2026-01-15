# Cashu NUTs (Notation, Usage, and Terminology) - Complete Reference

This document provides detailed descriptions of all Cashu NUT specifications. NUTs define the Cashu protocol and enable interoperability between different implementations.

## NUT Status

- **Mandatory**: All wallets and mints MUST implement
- **Optional**: Implementations CAN implement for enhanced features
- **Draft**: Under development, subject to change

## Mandatory NUTs

### NUT-00: Cryptography and Models

**Status**: Mandatory
**Purpose**: Foundational cryptographic protocol and data structures

#### Overview

Defines the Blind Diffie-Hellman Key Exchange (BDHKE) scheme used for blind signatures, core data models, token serialization formats, and error handling.

#### Key Concepts

**BDHKE Scheme:**
```
1. Alice generates secret x, computes Y = hash_to_curve(x)
2. Alice blinds: B_ = Y + r·G
3. Bob signs: C_ = k·B_
4. Alice unblinds: C = C_ - r·K
5. Verification: k·hash_to_curve(x) == C
```

**Hash-to-Curve:**
```
DOMAIN_SEPARATOR = b"Secp256k1_HashToCurve_Cashu_"
msg_hash = SHA256(DOMAIN_SEPARATOR || x)

counter = 0
loop:
  candidate = SHA256(msg_hash || counter)
  try parse as secp256k1 point
    if valid: return point
  counter += 1
```

#### Data Structures

**BlindedMessage** (wallet → mint):
```json
{
  "amount": 64,
  "id": "00ffd48b78a7b2f4",
  "B_": "02ab3c4d5e..."
}
```

**BlindSignature** (mint → wallet):
```json
{
  "amount": 64,
  "id": "00ffd48b78a7b2f4",
  "C_": "03bc5d6e7f..."
}
```

**Proof** (unblinded token):
```json
{
  "amount": 64,
  "secret": "9a3b2c1d4e5f6a7b8c9d0e1f2a3b4c5d",
  "C": "02cd7e8f9a...",
  "id": "00ffd48b78a7b2f4",
  "witness": "..."  // Optional (P2PK, HTLC)
}
```

#### Token Serialization

**V4 Format (Current)**: `cashuB[base64_urlsafe_cbor]`
- CBOR encoding for efficiency
- Abbreviated keys (t, m, u, d, i, p, a, s, c)
- Short keyset IDs (8 bytes)
- Multi-mint support

**V3 Format (Deprecated)**: `cashuA[base64_urlsafe_json]`
- JSON encoding
- Full key names
- Legacy support only

#### Error Codes

Standard HTTP 400 response:
```json
{
  "detail": "human-readable message",
  "code": 1000X
}
```

Common codes:
- `10001`: Token already spent
- `10002`: Invalid proof
- `10003`: Quote not paid
- `10004`: Insufficient funds

---

### NUT-01: Mint Public Keys

**Status**: Mandatory
**Endpoint**: `GET /v1/keys` or `GET /v1/keys/{keyset_id}`

#### Purpose

Exchange mint's public keys with wallets. Keys are needed to unblind signatures and verify proofs.

#### Response Format

```json
{
  "keysets": [
    {
      "id": "00ffd48b78a7b2f4",
      "unit": "sat",
      "keys": {
        "1": "02194603ffa36356f4a56b7df9371fc3192472351453ec7398b8da8117e7c3e104",
        "2": "03b0f36d6d47ce14df8a7be9137712c42bcdd960b19dd02f1d4a9703b1f31d7513",
        "4": "0366be6e026e42852498efb82014ca91e89da2e7a5bd3761bdad699fa2aec9f96c",
        "8": "0253de5237f189606f29d8a690ea719f74d65f617bb1cb6fbea34f2bc4f930016d"
      }
    }
  ]
}
```

#### Key Fields

- `id`: Keyset identifier (16-byte hex, SHA256 of concatenated pubkeys)
- `unit`: Currency unit (sat, msat, usd, eur, etc.)
- `keys`: Map of amount → public key (hex-encoded compressed secp256k1 points)

#### Key Rotation

Mints can rotate keys by creating new keysets. Old keysets should remain available for swapping until all proofs are migrated.

---

### NUT-02: Keysets and Fees

**Status**: Mandatory
**Endpoint**: `GET /v1/keysets`

#### Purpose

List all keysets (active and inactive) with fee information.

#### Response Format

```json
{
  "keysets": [
    {
      "id": "00ffd48b78a7b2f4",
      "unit": "sat",
      "active": true,
      "input_fee_ppk": 0,
      "output_fee_ppk": 0
    },
    {
      "id": "00ab12cd34ef5678",
      "unit": "sat",
      "active": false,
      "input_fee_ppk": 100,
      "output_fee_ppk": 100
    }
  ]
}
```

#### Fee Structure

- `input_fee_ppk`: Fee per 1000 input proofs (parts per thousand)
- `output_fee_ppk`: Fee per 1000 output proofs

**Example**: 100 ppk = 0.1 sat per proof = 100 sats per 1000 proofs

#### Keyset Status

- `active: true`: Mint will sign new proofs with this keyset
- `active: false`: Keyset deprecated, can still swap but not mint

---

### NUT-03: Swapping Tokens

**Status**: Mandatory
**Endpoint**: `POST /v1/swap`

#### Purpose

Exchange proofs for new proofs of the same total value. Used for coin selection, sending exact amounts, and key rotation.

#### Request Format

```json
{
  "inputs": [
    {
      "amount": 128,
      "secret": "secret1",
      "C": "02ab3c...",
      "id": "00ffd48b"
    }
  ],
  "outputs": [
    {
      "amount": 64,
      "id": "00ffd48b",
      "B_": "03cd7e..."
    },
    {
      "amount": 64,
      "id": "00ffd48b",
      "B_": "02ef9a..."
    }
  ]
}
```

#### Response Format

```json
{
  "signatures": [
    {
      "amount": 64,
      "id": "00ffd48b",
      "C_": "02ab3c..."
    },
    {
      "amount": 64,
      "id": "00ffd48b",
      "C_": "03de9f..."
    }
  ]
}
```

#### Validation

- Sum of inputs MUST equal sum of outputs (minus fees)
- All input proofs MUST be valid and unspent
- Atomic operation: all or nothing
- Mint marks input secrets as spent

---

### NUT-04: Minting Tokens

**Status**: Mandatory
**Endpoints**:
- `POST /v1/mint/quote/bolt11` - Create quote
- `GET /v1/mint/quote/bolt11/{quote_id}` - Check quote
- `POST /v1/mint/bolt11` - Mint tokens

#### Purpose

Deposit Bitcoin via Lightning and receive ecash.

#### Flow

**1. Create Quote**

Request:
```json
{
  "amount": 1000,
  "unit": "sat"
}
```

Response:
```json
{
  "quote": "quote_12345",
  "request": "lnbc1000n...",
  "paid": false,
  "expiry": 1704153600
}
```

**2. Check Quote Status**

Request: `GET /v1/mint/quote/bolt11/quote_12345`

Response:
```json
{
  "quote": "quote_12345",
  "request": "lnbc1000n...",
  "paid": true,
  "expiry": 1704153600
}
```

**3. Mint Tokens**

Request:
```json
{
  "quote": "quote_12345",
  "outputs": [
    {"amount": 512, "id": "00ffd48b", "B_": "02ab..."},
    {"amount": 256, "id": "00ffd48b", "B_": "03cd..."},
    {"amount": 128, "id": "00ffd48b", "B_": "02ef..."},
    {"amount": 64, "id": "00ffd48b", "B_": "03gh..."},
    {"amount": 32, "id": "00ffd48b", "B_": "02ij..."},
    {"amount": 8, "id": "00ffd48b", "B_": "03kl..."}
  ]
}
```

Response:
```json
{
  "signatures": [
    {"amount": 512, "id": "00ffd48b", "C_": "02mn..."},
    {"amount": 256, "id": "00ffd48b", "C_": "03op..."},
    {"amount": 128, "id": "00ffd48b", "C_": "02qr..."},
    {"amount": 64, "id": "00ffd48b", "C_": "03st..."},
    {"amount": 32, "id": "00ffd48b", "C_": "02uv..."},
    {"amount": 8, "id": "00ffd48b", "C_": "03wx..."}
  ]
}
```

#### Error Codes

- `20001`: Quote not paid
- `20002`: Quote expired
- `20003`: Quote already issued

---

### NUT-05: Melting Tokens

**Status**: Mandatory
**Endpoints**:
- `POST /v1/melt/quote/bolt11` - Create quote
- `GET /v1/melt/quote/bolt11/{quote_id}` - Check quote
- `POST /v1/melt/bolt11` - Melt tokens

#### Purpose

Withdraw Bitcoin via Lightning by melting ecash.

#### Flow

**1. Create Quote**

Request:
```json
{
  "request": "lnbc1000n...",
  "unit": "sat"
}
```

Response:
```json
{
  "quote": "melt_12345",
  "amount": 1000,
  "fee_reserve": 10,
  "paid": false,
  "expiry": 1704153600
}
```

**2. Melt Tokens**

Request:
```json
{
  "quote": "melt_12345",
  "inputs": [
    {"amount": 512, "secret": "...", "C": "...", "id": "..."},
    {"amount": 256, "secret": "...", "C": "...", "id": "..."},
    {"amount": 128, "secret": "...", "C": "...", "id": "..."},
    {"amount": 64, "secret": "...", "C": "...", "id": "..."},
    {"amount": 32, "secret": "...", "C": "...", "id": "..."},
    {"amount": 16, "secret": "...", "C": "...", "id": "..."},
    {"amount": 2, "secret": "...", "C": "...", "id": "..."}
  ],
  "outputs": [
    {"amount": 8, "id": "00ffd48b", "B_": "02ab..."},
    {"amount": 2, "id": "00ffd48b", "B_": "03cd..."}
  ]
}
```

Response:
```json
{
  "paid": true,
  "payment_preimage": "0e5b2f1a...",
  "change": [
    {"amount": 8, "id": "00ffd48b", "C_": "02ef..."},
    {"amount": 2, "id": "00ffd48b", "C_": "03gh..."}
  ]
}
```

#### Fee Handling

- `fee_reserve`: Estimated maximum fee
- Inputs MUST cover: amount + fee_reserve
- Actual fee may be less → change returned
- See NUT-08 for overpaid fee handling

---

### NUT-06: Mint Information

**Status**: Mandatory
**Endpoint**: `GET /v1/info`

#### Purpose

Provide mint metadata and capabilities.

#### Response Format

```json
{
  "name": "Example Mint",
  "pubkey": "02ab3c4d...",
  "version": "nutshell/0.15.0",
  "description": "Community ecash mint",
  "description_long": "A Cashu mint operated for the Bitcoin community...",
  "contact": [
    ["email", "admin@example.com"],
    ["nostr", "npub1..."],
    ["twitter", "@example"]
  ],
  "motd": "Welcome! Please backup your tokens.",
  "nuts": {
    "4": {
      "methods": [
        {"method": "bolt11", "unit": "sat", "min_amount": 1, "max_amount": 1000000}
      ],
      "disabled": false
    },
    "5": {
      "methods": [
        {"method": "bolt11", "unit": "sat", "min_amount": 1, "max_amount": 1000000}
      ],
      "disabled": false
    },
    "7": {"supported": true},
    "8": {"supported": true},
    "9": {"supported": true},
    "10": {"supported": true},
    "11": {"supported": true},
    "12": {"supported": true}
  }
}
```

#### Key Fields

- `name`: Human-readable mint name
- `version`: Mint software version
- `nuts`: Supported NUT specifications with parameters
- `contact`: Contact methods (array of [type, value])
- `motd`: Message of the day (displayed to users)

---

## Optional NUTs

### NUT-07: Token State Check

**Status**: Optional (Highly Recommended)
**Endpoint**: `POST /v1/checkstate`

#### Purpose

Check if secrets are spent, unspent, or pending without revealing the secret itself.

#### Request Format

```json
{
  "Ys": [
    "02ab3c4d5e...",  // Y = hash_to_curve(secret)
    "03bc5d6e7f...",
    "02cd7e8f9a..."
  ]
}
```

#### Response Format

```json
{
  "states": [
    {
      "Y": "02ab3c4d5e...",
      "state": "UNSPENT",
      "witness": null
    },
    {
      "Y": "03bc5d6e7f...",
      "state": "SPENT",
      "witness": null
    },
    {
      "Y": "02cd7e8f9a...",
      "state": "PENDING",
      "witness": null
    }
  ]
}
```

#### States

- `UNSPENT`: Secret has not been used
- `SPENT`: Secret has been redeemed
- `PENDING`: Secret is in pending transaction

#### Use Cases

- Wallet recovery (check which proofs are still valid)
- Verify token validity before accepting
- Detect double-spend attempts

---

### NUT-08: Overpaid Lightning Fees

**Status**: Optional (Recommended)
**Integrated**: NUT-05 melt response

#### Purpose

Return change when actual Lightning fee is less than fee_reserve.

#### Implementation

When melting (NUT-05):
1. Wallet provides inputs for amount + fee_reserve
2. Mint pays invoice (actual_fee ≤ fee_reserve)
3. If actual_fee < fee_reserve, mint returns change
4. Change = fee_reserve - actual_fee

#### Example

```
Invoice amount: 1000 sats
Fee reserve: 10 sats
Inputs provided: 1010 sats
Actual fee: 3 sats
Change returned: 7 sats
```

---

### NUT-09: Restore Signatures

**Status**: Optional (Recommended for backup)
**Endpoint**: `POST /v1/restore`

#### Purpose

Recover lost proofs using deterministic secrets (NUT-13).

#### Request Format

```json
{
  "outputs": [
    {"amount": 1, "id": "00ffd48b", "B_": "02ab..."},
    {"amount": 2, "id": "00ffd48b", "B_": "03cd..."},
    {"amount": 4, "id": "00ffd48b", "B_": "02ef..."}
  ]
}
```

#### Response Format

```json
{
  "outputs": [
    {"amount": 1, "id": "00ffd48b", "C_": "02gh..."},
    null,  // Not issued
    {"amount": 4, "id": "00ffd48b", "C_": "02ij..."}
  ],
  "signatures": [
    {"amount": 1, "id": "00ffd48b", "C_": "02gh..."},
    {"amount": 4, "id": "00ffd48b", "C_": "02ij..."}
  ]
}
```

#### Usage Pattern

1. Wallet generates deterministic secrets (counter-based)
2. After mint loss, wallet regenerates secrets with same counters
3. Wallet creates blinded messages from regenerated secrets
4. Mint returns signatures for secrets that were previously issued
5. Wallet unblinds to recover proofs

---

### NUT-10: Spending Conditions

**Status**: Optional
**Purpose**: Programmable spending conditions on proofs

#### Supported Conditions

- P2PK (NUT-11): Pay-to-Public-Key
- HTLC (NUT-14): Hash Time Locked Contracts
- Custom: Extensible format

#### Secret Format

Spending condition secrets are JSON arrays:
```json
[
  "condition_type",
  {
    "nonce": "random_hex",
    "data": "condition_data",
    "tags": [["key", "value"]]
  }
]
```

#### Witness Format

When spending condition-locked proofs, include witness:
```json
{
  "amount": 64,
  "secret": "[\"P2PK\",{\"nonce\":\"abc\",\"data\":\"pubkey\"}]",
  "C": "02ab3c...",
  "id": "00ffd48b",
  "witness": "{\"signatures\":[\"sig1\"]}"
}
```

---

### NUT-11: Pay-to-Public-Key (P2PK)

**Status**: Optional
**Purpose**: Lock proofs to specific public key (requires signature to spend)

#### Secret Format

```json
[
  "P2PK",
  {
    "nonce": "da62796403af76c80cd6ce9153ed3746",
    "data": "033281c37677ea273eb7183b783067f5244933ef78d8c3f15b1a77cb246099c26e",
    "tags": [
      ["sigflag", "SIG_INPUTS"],  // Optional: what to sign
      ["n_sigs", "2"],            // Optional: multisig (N-of-M)
      ["pubkeys", "pk1,pk2,pk3"]  // Optional: additional pubkeys
    ]
  }
]
```

#### Witness Format

```json
{
  "signatures": [
    "fd5e0e3e6e5c6fa14059c56a66e36c44e1e06d820b0e164f56f14051a85c1cda6a9d1d7ddbb15e98e3b4eb5a34f97e49141c64bb3cbc70b1bde85bc5b53e16bb"
  ]
}
```

#### Signature Flags

- `SIG_INPUTS`: Sign all input proofs
- `SIG_OUTPUTS`: Sign all outputs (prevents mint alteration)

#### Use Cases

- Secure transfers (recipient must have private key)
- Non-custodial storage (wallet can't spend without key)
- Escrow services

---

### NUT-12: DLEQ Proofs

**Status**: Optional (Recommended for trust)
**Purpose**: Discrete Log Equality proofs to verify mint signatures

#### Concept

Proves that `C = k·Y` without revealing `k` (mint's private key).

#### DLEQ Structure

```json
{
  "e": "9818e061ee51d5c8edc3342369a554998ff7b4381c8652d724cdf46429be73d9",
  "s": "9818e061ee51d5c8edc3342369a554998ff7b4381c8652d724cdf46429be73d9"
}
```

#### Verification

```
C = s·G + e·K
Y' = s·B_ + e·C_

Verify: e == SHA256(K || C || Y')
```

#### Benefits

- Proves mint signed correctly
- Detects mint misbehavior (creating unbacked tokens)
- Builds user trust in mint

---

### NUT-13: Deterministic Secrets

**Status**: Optional (Recommended for backup)
**Purpose**: Generate secrets deterministically for wallet recovery

#### Secret Generation

```
secret = HMAC-SHA256(
  key = seed,
  msg = counter || keyset_id || amount
)
```

#### Counter Format

```
counter = 8-byte big-endian integer
```

#### Usage Pattern

1. Wallet generates seed (BIP39 mnemonic)
2. For each proof, increment counter
3. Generate secret from: seed + counter + keyset_id + amount
4. Store only seed and counter (not individual secrets)
5. For recovery: regenerate secrets and use NUT-09 restore

#### Benefits

- Backup entire wallet with 12/24 words
- Restore all proofs from seed
- No need to backup individual proofs

---

### NUT-14: Hashed Timelock Contracts (HTLC)

**Status**: Optional
**Purpose**: Time-locked proofs with hash preimage reveal

#### Secret Format

```json
[
  "HTLC",
  {
    "nonce": "da62796403af76c80cd6ce9153ed3746",
    "data": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "tags": [
      ["locktime", "1704153600"],  // Unix timestamp
      ["refund", "pubkey"]          // Refund pubkey after locktime
    ]
  }
]
```

#### Witness Format

**Before locktime (with preimage):**
```json
{
  "preimage": "preimage_hex"
}
```

**After locktime (refund):**
```json
{
  "signatures": ["refund_signature"]
}
```

#### Use Cases

- Atomic swaps
- Escrow with time limits
- Payment channels

---

### Extended NUTs (NUT-15 to NUT-27)

Brief descriptions of additional optional specifications:

- **NUT-15**: MPP (Multi-Path Payments) - Split Lightning payments across routes
- **NUT-16**: Animated QR codes - Encode large tokens across multiple QR frames
- **NUT-17**: WebSocket subscriptions - Real-time updates for quotes and proofs
- **NUT-18**: Payment requests - Invoice-like payment requests
- **NUT-19**: Cached responses - Performance optimization via caching
- **NUT-20**: Multiple signature methods - Support various signature schemes
- **NUT-21**: BOLT11 - Lightning invoice support (standard for minting/melting)
- **NUT-22**: BOLT12 - Lightning offers support (reusable payment requests)
- **NUT-23**: HTTP 402 - Payment Required status code integration
- **NUT-24**: Bech32m - Alternative token encoding format
- **NUT-25**: Nostr backup - Backup wallet to Nostr relays (encrypted kind 10000+ events)
- **NUT-26**: Subscription payments - Recurring payments
- **NUT-27**: Multi-mint atomic swaps - Atomic swaps across different mints

---

## Implementation Priority

### For Basic Wallet

1. NUT-00 (Cryptography)
2. NUT-01 (Mint Keys)
3. NUT-04 (Minting)
4. NUT-05 (Melting)
5. NUT-03 (Swapping)
6. NUT-07 (State Check)

### For Production Wallet

Add these to basic wallet:
7. NUT-08 (Overpaid Fees)
8. NUT-13 (Deterministic Secrets)
9. NUT-09 (Restore)
10. NUT-11 (P2PK)

### For Advanced Features

Add based on use case:
- NUT-12 (DLEQ) - Verify mint honesty
- NUT-14 (HTLC) - Atomic swaps, escrow
- NUT-17 (WebSocket) - Real-time updates
- NUT-25 (Nostr Backup) - Cloud backup

---

## Resources

- **Official NUTs**: https://github.com/cashubtc/nuts
- **NUT Status**: https://cashubtc.github.io/nuts/
- **Cashu Docs**: https://docs.cashu.space
