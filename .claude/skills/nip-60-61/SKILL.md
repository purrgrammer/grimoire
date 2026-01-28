---
name: nip-60-61
description: This skill should be used when implementing NIP-60 Cashu wallets or NIP-61 nutzaps on Nostr. Covers the wallet event structure (kind:17375), token events (kind:7375), spending history (kind:7376), nutzap events (kind:9321), nutzap info (kind:10019), P2PK locking, and wallet workflows.
---

# NIP-60 & NIP-61: Cashu Wallets and Nutzaps

## Purpose

This skill provides expert-level assistance with NIP-60 (Cashu Wallets) and NIP-61 (Nutzaps) - the Nostr protocols for storing ecash wallets on relays and sending P2PK-locked Cashu payments.

## When to Use

Activate this skill when:
- Implementing a NIP-60 compatible Cashu wallet
- Sending or receiving nutzaps (NIP-61)
- Working with encrypted wallet events
- Managing ecash proofs on Nostr relays
- Implementing P2PK-locked Cashu transfers
- Building nutzap-enabled Nostr clients

## NIP-60: Cashu Wallets

### Overview

NIP-60 enables Cashu-based wallets with information stored on Nostr relays, providing:
- **Ease of use**: Users can receive funds without external accounts
- **Interoperability**: Wallet follows users across applications
- **Privacy**: Content encrypted with NIP-44

### Event Kinds

| Kind | Name | Purpose |
|------|------|---------|
| **17375** | Wallet | Replaceable wallet configuration |
| **7375** | Token | Unspent proof storage |
| **7376** | History | Spending/receiving history |
| **7374** | Quote | Pending mint quotes |
| **10019** | Nutzap Info | Recipient preferences (NIP-61) |

### Wallet Event (kind:17375)

Replaceable event storing wallet configuration. Content is NIP-44 encrypted.

```json
{
  "kind": 17375,
  "content": "<NIP-44 encrypted JSON>",
  "tags": [
    ["mint", "https://mint1.example.com", "sat"],
    ["mint", "https://mint2.example.com", "sat"],
    ["relay", "wss://relay1.example.com"],
    ["relay", "wss://relay2.example.com"]
  ]
}
```

**Encrypted content structure:**
```json
{
  "privkey": "<hex private key for P2PK>"
}
```

**Important**: The `privkey` is a **separate key** exclusively for the wallet, NOT the user's Nostr private key. Used for:
- Receiving NIP-61 nutzaps (P2PK-locked tokens)
- Unlocking tokens locked to the wallet's pubkey

### Token Event (kind:7375)

Records unspent Cashu proofs. Multiple events can exist per mint.

```json
{
  "kind": 7375,
  "content": "<NIP-44 encrypted JSON>",
  "tags": []
}
```

**Encrypted content structure:**
```json
{
  "mint": "https://mint.example.com",
  "unit": "sat",
  "proofs": [
    {
      "id": "009a1f293253e41e",
      "amount": 8,
      "secret": "secret_string",
      "C": "02abc..."
    }
  ],
  "del": ["<token_event_id_1>", "<token_event_id_2>"]
}
```

| Field | Description |
|-------|-------------|
| `mint` | Mint URL |
| `unit` | Currency unit (default: "sat") |
| `proofs` | Array of unspent Cashu proofs |
| `del` | IDs of deleted/spent token events |

### Spending History Event (kind:7376)

Optional events documenting transactions.

```json
{
  "kind": 7376,
  "content": "<NIP-44 encrypted JSON>",
  "tags": [
    ["e", "<created_token_id>", "", "created"],
    ["e", "<destroyed_token_id>", "", "destroyed"],
    ["e", "<redeemed_nutzap_id>", "", "redeemed"]
  ]
}
```

**Encrypted content structure:**
```json
{
  "direction": "in",
  "amount": 100,
  "unit": "sat"
}
```

**Direction values:**
- `"in"` - Received tokens
- `"out"` - Sent tokens

**Tag markers:**
- `created` - New token event created
- `destroyed` - Token event consumed/deleted
- `redeemed` - Nutzap event redeemed (leave unencrypted)

### Quote Event (kind:7374)

Tracks pending mint quotes for deposits.

```json
{
  "kind": 7374,
  "content": "<NIP-44 encrypted quote_id>",
  "tags": [
    ["expiration", "<unix_timestamp>"],
    ["mint", "https://mint.example.com"]
  ]
}
```

Expiration typically ~2 weeks. Delete after quote is used or expired.

### Relay Discovery

Clients discover wallet relays from:
1. Kind 10019 event (preferred)
2. Kind 10002 NIP-65 relay list (fallback)

## NIP-61: Nutzaps

### Overview

Nutzaps are P2PK-locked Cashu tokens sent via Nostr. The payment itself serves as the receipt - no Lightning invoices needed.

Key principle: **"A Nutzap is a P2PK Cashu token in which the payment itself is the receipt."**

### Nutzap Info Event (kind:10019)

Recipients publish this to configure nutzap reception.

```json
{
  "kind": 10019,
  "content": "",
  "tags": [
    ["relay", "wss://relay1.example.com"],
    ["relay", "wss://relay2.example.com"],
    ["mint", "https://mint1.example.com", "sat"],
    ["mint", "https://mint2.example.com", "sat", "usd"],
    ["pubkey", "02<compressed_pubkey_hex>"]
  ]
}
```

| Tag | Description |
|-----|-------------|
| `relay` | Where senders should publish nutzaps |
| `mint` | Trusted mints with supported units |
| `pubkey` | P2PK pubkey for locking tokens (NOT Nostr key) |

**Critical**: The pubkey MUST be prefixed with `02` for Nostr-Cashu compatibility.

### Nutzap Event (kind:9321)

The actual payment event sent by the payer.

```json
{
  "kind": 9321,
  "content": "Optional message/comment",
  "pubkey": "<sender_pubkey>",
  "tags": [
    ["proof", "{\"id\":\"...\",\"amount\":8,\"secret\":\"...\",\"C\":\"...\",\"dleq\":{...}}"],
    ["proof", "{\"id\":\"...\",\"amount\":4,\"secret\":\"...\",\"C\":\"...\",\"dleq\":{...}}"],
    ["u", "https://mint.example.com"],
    ["p", "<recipient_nostr_pubkey>"],
    ["e", "<nutzapped_event_id>", "<relay_hint>"]
  ]
}
```

| Tag | Description |
|-----|-------------|
| `proof` | JSON-stringified Cashu proof with DLEQ |
| `u` | Mint URL (must match recipient's config exactly) |
| `p` | Recipient's Nostr pubkey |
| `e` | Event being nutzapped (optional) |

**Proof structure (in proof tag):**
```json
{
  "id": "009a1f293253e41e",
  "amount": 8,
  "secret": "[\"P2PK\",{\"nonce\":\"...\",\"data\":\"02pubkey\"}]",
  "C": "02abc...",
  "dleq": {
    "e": "...",
    "s": "...",
    "r": "..."
  }
}
```

### P2PK Locking Requirements

1. **Use recipient's wallet pubkey** from kind:10019, NOT their Nostr pubkey
2. **Prefix with '02'** for compatibility: `02<32-byte-hex>`
3. **Include DLEQ proofs** for offline verification (NUT-12)
4. Lock using NUT-11 P2PK spending condition

### Validation Rules

Observers verifying nutzaps must confirm:
1. Recipient has kind:10019 listing the mint
2. Token is locked to recipient's specified pubkey
3. Mint URL matches exactly (case-sensitive)
4. DLEQ proof validates offline

### Sending Workflow

```
1. Fetch recipient's kind:10019
   ↓
2. Select a mint from their trusted list
   ↓
3. Mint or swap tokens at that mint
   ↓
4. P2PK-lock proofs to recipient's pubkey
   ↓
5. Publish kind:9321 to recipient's relays
```

### Receiving Workflow

```
1. Subscribe to kind:9321 events tagged with your pubkey
   ↓
2. Validate nutzap (mint in config, correct pubkey lock)
   ↓
3. Swap proofs at the mint (prevents double-claim)
   ↓
4. Create kind:7375 token event with new proofs
   ↓
5. Create kind:7376 history event with "redeemed" marker
```

## Wallet Workflows

### Token Spending

When spending tokens:

1. **Select proofs** for the amount to spend
2. **Create new token event** with remaining (unspent) proofs
3. **Add spent token IDs** to the `del` field
4. **Delete original token event** via NIP-09
5. **Create history event** (optional) documenting the transaction

```typescript
// Pseudocode for spending
const { spend, keep } = await selectProofs(wallet.proofs, amount);

// Create new token event with change
if (keep.length > 0) {
  await createTokenEvent({
    proofs: keep,
    del: [originalTokenEventId]
  });
}

// Delete original token event
await deleteEvent(originalTokenEventId);

// Record history
await createHistoryEvent({
  direction: 'out',
  amount: spend.reduce((a, p) => a + p.amount, 0),
  tags: [['e', originalTokenEventId, '', 'destroyed']]
});
```

### Token Receiving

When receiving tokens (from nutzap or direct transfer):

1. **Validate token** (correct mint, valid proofs)
2. **Swap proofs** at mint (prevents sender reuse)
3. **Create token event** with new proofs
4. **Create history event** with "redeemed" marker

### Couch Pattern (Safe Operations)

For atomic operations that could fail mid-way:

1. **Store proofs in "couch"** (temporary storage like IndexedDB)
2. **Perform mint operation** (swap, melt, etc.)
3. **On success**: Delete from couch, create new token event
4. **On failure**: Recover from couch

This prevents losing proofs if the app crashes during an operation.

## Security Considerations

1. **Separate wallet key**: Never use your Nostr private key for the wallet
2. **Encrypt everything**: All token data must be NIP-44 encrypted
3. **Verify DLEQ**: Always verify DLEQ proofs when receiving nutzaps
4. **Swap immediately**: Swap received tokens to prevent sender double-spending
5. **Trusted mints only**: Only accept nutzaps from mints you trust
6. **Relay redundancy**: Store wallet data on multiple relays

## Event Kind Reference

| Kind | Name | Type | Encryption |
|------|------|------|------------|
| 7374 | Quote | Regular | NIP-44 |
| 7375 | Token | Regular | NIP-44 |
| 7376 | History | Regular | NIP-44 (partial) |
| 9321 | Nutzap | Regular | None |
| 10019 | Nutzap Info | Replaceable | None |
| 17375 | Wallet | Replaceable | NIP-44 |

## Best Practices

1. **Multiple token events**: Don't put all proofs in one event
2. **Consolidate periodically**: Merge small tokens to reduce event count
3. **Track history**: Create kind:7376 events for audit trail
4. **Handle offline**: Use DLEQ for offline nutzap verification
5. **Clean up quotes**: Delete expired kind:7374 events
6. **Normalize URLs**: Use consistent mint URL formatting

## Official Resources

- [NIP-60 Specification](https://github.com/nostr-protocol/nips/blob/master/60.md)
- [NIP-61 Specification](https://github.com/nostr-protocol/nips/blob/master/61.md)
- [NIP-44 Encryption](https://github.com/nostr-protocol/nips/blob/master/44.md)
- [Cashu NUTs](https://cashubtc.github.io/nuts/)
