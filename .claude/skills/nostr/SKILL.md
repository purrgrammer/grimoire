---
name: nostr
description: Use this skill whenever working with the Nostr protocol — event creation, signing, filtering, relay communication, NIP implementations, key encoding (NIP-19), encryption (NIP-04/NIP-44), or nostr-tools library APIs. Activate for any code importing nostr-tools, handling Nostr events, or discussing NIPs.
---

# Nostr Protocol & nostr-tools

Comprehensive reference for the Nostr protocol and the nostr-tools JavaScript library.

## Protocol Fundamentals

### Events

All data in Nostr is an event — a signed JSON object:

```json
{
  "id": "<32-byte hex SHA256 of serialized event>",
  "pubkey": "<32-byte hex public key>",
  "created_at": "<unix timestamp in seconds>",
  "kind": "<integer>",
  "tags": [["<name>", "<value>", "..."]],
  "content": "<string>",
  "sig": "<64-byte hex schnorr signature of id>"
}
```

**ID calculation**: `SHA256(JSON.stringify([0, pubkey, created_at, kind, tags, content]))` — compact JSON, no spaces.

**Signature**: Schnorr (BIP-340) on secp256k1, signing the 32-byte event ID.

### Event Kind Ranges

| Range | Type | Behavior |
|-------|------|----------|
| 0-999 | Core | Varies per kind |
| 1000-9999 | Regular | Immutable, all kept |
| 10000-19999 | Replaceable | Latest per pubkey+kind wins |
| 20000-29999 | Ephemeral | Not stored, forwarded only |
| 30000-39999 | Parameterized Replaceable | Latest per pubkey+kind+d-tag wins |

Common kinds: `0` metadata, `1` text note, `3` contacts, `5` deletion, `6` repost, `7` reaction, `9` group message (NIP-29), `9735` zap receipt, `10002` relay list, `30023` article.

See **references/event-kinds.md** for the full list.

### Tags

```
["e", "<event-id>", "<relay-url>", "<marker>"]  — event reference
["p", "<pubkey>", "<relay-url>"]                 — profile reference
["a", "<kind>:<pubkey>:<d-tag>", "<relay-url>"]  — replaceable event ref
["d", "<identifier>"]                            — parameterized replaceable ID
["t", "<hashtag>"]                               — hashtag
["r", "<url>"]                                   — web resource / relay
```

NIP-10 markers for threading: `"root"`, `"reply"`, `"mention"`.

### Client-Relay Communication (WebSocket)

**Client sends**: `["EVENT", <event>]`, `["REQ", <sub_id>, <filter>, ...]`, `["CLOSE", <sub_id>]`, `["AUTH", <event>]`

**Relay sends**: `["EVENT", <sub_id>, <event>]`, `["OK", <event_id>, <bool>, <msg>]`, `["EOSE", <sub_id>]`, `["CLOSED", <sub_id>, <msg>]`, `["NOTICE", <msg>]`, `["AUTH", <challenge>]`

### Filters

```json
{
  "ids": ["<hex>"],
  "authors": ["<hex>"],
  "kinds": [1, 7],
  "#e": ["<event-id>"],
  "#p": ["<pubkey>"],
  "#t": ["<hashtag>"],
  "since": 1704067200,
  "until": 1704153600,
  "limit": 50,
  "search": "query"
}
```

- Array fields are OR'd; different fields are AND'd
- `ids` and `authors` support prefix matching
- Always set reasonable `limit` (50-500)

## nostr-tools Library

### Key Management & Encoding (NIP-19)

```typescript
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { nip19 } from 'nostr-tools';

const sk = generateSecretKey();          // Uint8Array
const pk = getPublicKey(sk);             // hex string

// Encode
const npub = nip19.npubEncode(pk);       // npub1...
const nsec = nip19.nsecEncode(sk);       // nsec1...
const note = nip19.noteEncode(eventId);  // note1...

const nprofile = nip19.nprofileEncode({ pubkey: pk, relays: ['wss://...'] });
const nevent = nip19.neventEncode({ id, relays, author, kind });
const naddr = nip19.naddrEncode({ identifier, pubkey, kind, relays });

// Decode
const { type, data } = nip19.decode(npub); // type: 'npub', data: hex
```

### Creating & Signing Events

```typescript
import { finalizeEvent, verifyEvent } from 'nostr-tools/pure';

const event = finalizeEvent({
  kind: 1,
  created_at: Math.floor(Date.now() / 1000),
  tags: [['t', 'nostr']],
  content: 'Hello Nostr!'
}, secretKey);

const valid = verifyEvent(event); // true/false
```

### Relay Communication (SimplePool)

```typescript
import { SimplePool } from 'nostr-tools/pool';

const pool = new SimplePool();
const relays = ['wss://relay.damus.io', 'wss://nos.lol'];

// Subscribe
const sub = pool.subscribeMany(relays, [filter], {
  onevent(event) { /* handle event */ },
  oneose() { /* end of stored events */ }
});
sub.close(); // always close when done

// Query (returns Promise)
const events = await pool.querySync(relays, filter);
const event = await pool.get(relays, { ids: [eventId] });

// Publish
await Promise.allSettled(pool.publish(relays, signedEvent));

// Cleanup
pool.close(relays);
```

### Direct Relay Connection

```typescript
import { Relay } from 'nostr-tools/relay';

const relay = await Relay.connect('wss://relay.damus.io');

const sub = relay.subscribe([filter], {
  onevent(event) { /* ... */ },
  oneose() { sub.close(); }
});

await relay.publish(signedEvent);
relay.close();
```

### Encryption

```typescript
// NIP-44 (preferred)
import { nip44 } from 'nostr-tools';

const conversationKey = nip44.getConversationKey(secretKey, recipientPubkey);
const ciphertext = nip44.encrypt('Hello!', conversationKey);
const plaintext = nip44.decrypt(ciphertext, conversationKey);

// NIP-04 (legacy, avoid for new code)
import { nip04 } from 'nostr-tools';

const ct = await nip04.encrypt(secretKey, recipientPubkey, 'Hello!');
const pt = await nip04.decrypt(secretKey, senderPubkey, ct);
```

### NIP-05 DNS Identifiers

```typescript
import { nip05 } from 'nostr-tools';

const profile = await nip05.queryProfile('alice@example.com');
// { pubkey: '...', relays: ['wss://...'] }
```

### NIP-10 Thread Parsing

```typescript
import { nip10 } from 'nostr-tools';

const parsed = nip10.parse(event);
// { root, reply, mentions, profiles }
```

## Key NIPs Reference

| NIP | Topic | Key Points |
|-----|-------|------------|
| 01 | Basic protocol | Event structure, WebSocket messages, filters |
| 02 | Contacts | Kind 3, `p` tags for following list |
| 05 | DNS identifiers | `name@domain` via `.well-known/nostr.json` |
| 09 | Deletion | Kind 5, `e` tags for events to delete |
| 10 | Threading | `e` tag markers: root, reply, mention |
| 11 | Relay info | HTTP GET relay URL for NIP-11 document |
| 19 | bech32 entities | npub, nsec, note, nprofile, nevent, naddr |
| 25 | Reactions | Kind 7, content "+" or emoji |
| 42 | Auth | Relay challenges, kind 22242 response |
| 44 | Encryption | ChaCha20-Poly1305 AEAD (replaces NIP-04) |
| 50 | Search | `search` field in filters |
| 57 | Zaps | Kind 9734 request, 9735 receipt |
| 65 | Relay list | Kind 10002, read/write relay preferences |

See **references/nips-overview.md** for comprehensive NIP documentation.

## Common Patterns

### Reply with NIP-10 threading

```typescript
const reply = finalizeEvent({
  kind: 1,
  created_at: Math.floor(Date.now() / 1000),
  tags: [
    ['e', rootEventId, '', 'root'],
    ['e', parentEventId, '', 'reply'],
    ['p', parentAuthorPubkey]
  ],
  content: 'Great post!'
}, secretKey);
```

### NIP-65 relay list

```typescript
// Fetch user's relay preferences
const [relayList] = await pool.querySync(relays, {
  kinds: [10002], authors: [pubkey]
});

const readRelays = [], writeRelays = [];
for (const [tag, url, mode] of relayList.tags) {
  if (tag !== 'r') continue;
  if (!mode || mode === 'read') readRelays.push(url);
  if (!mode || mode === 'write') writeRelays.push(url);
}
```

### Reconnection with backoff

```typescript
let delay = 1000;
const connect = () => {
  const ws = new WebSocket(relayUrl);
  ws.onopen = () => { delay = 1000; resubscribe(); };
  ws.onclose = () => {
    setTimeout(connect, delay);
    delay = Math.min(delay * 2, 30000);
  };
};
```

## Security Essentials

- **Never expose nsec** in code, logs, or network requests
- **Always verify signatures** before trusting event data
- **Use NIP-44** for encryption (NIP-04 is deprecated)
- **Sanitize content** before rendering (XSS prevention)
- **Prefer NIP-07** (browser extensions) over handling raw keys

See **references/common-mistakes.md** for a comprehensive list of pitfalls.

## Reference Files

- **references/nips-overview.md** — Detailed descriptions of all standard NIPs
- **references/event-kinds.md** — Complete event kinds reference with examples
- **references/common-mistakes.md** — 30 common implementation mistakes and fixes
