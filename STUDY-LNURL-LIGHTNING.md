# Study: Applesauce LNURL and Lightning Helpers

This document provides a comprehensive overview of LNURL and Lightning-related functionality in applesauce v5.

## Overview

Applesauce v5's `applesauce-common` package provides comprehensive helpers for working with:
- **LNURL** - Lightning Network URL protocol for payments
- **Zaps** - NIP-57 Lightning tips with proof on Nostr
- **Bolt11** - Lightning invoice parsing
- **Zap Splits** - Multi-recipient zap distribution

## Package Structure

```
applesauce-common/
├── helpers/
│   ├── lnurl.js       # LNURL parsing and invoice fetching
│   ├── zap.js         # NIP-57 zap helpers
│   └── bolt11.js      # Lightning invoice parsing
├── casts/
│   └── zap.js         # Reactive Zap class
├── models/
│   └── zaps.js        # Zap query models
└── operations/
    └── zap-split.js   # Zap split operations
```

## LNURL Helpers

Location: `applesauce-common/helpers/lnurl`

### Functions

#### `parseLightningAddress(address: string): URL | undefined`

Parses a Lightning Address (lud16) into a LNURL callback URL.

```typescript
import { parseLightningAddress } from 'applesauce-common/helpers/lnurl';

// Parse Lightning Address (user@domain.com)
const callbackUrl = parseLightningAddress('alice@getalby.com');
// Returns: URL { https://getalby.com/.well-known/lnurlp/alice }
```

**Format**: Lightning Address follows the email format: `name@domain.com`

**Conversion**: Transforms to `https://{domain}/.well-known/lnurlp/{name}`

#### `decodeLNURL(lnurl: string): URL | undefined`

Decodes a bech32-encoded LNURL string into a URL.

```typescript
import { decodeLNURL } from 'applesauce-common/helpers/lnurl';

// Decode LNURL (lnurl1...)
const url = decodeLNURL('lnurl1dp68gurn8ghj7ctsdyh85etzv4jx2efwd9hj7mrww4excup0dajx2mrv92x2um5v56kuvmhv9jnxc3k8qa5vtpexu');
// Returns: URL object with decoded callback
```

**Format**: LNURL is a bech32-encoded URL with prefix `lnurl`

#### `parseLNURLOrAddress(addressOrLNURL: string): URL | undefined`

Universal parser that handles both Lightning Addresses and LNURL strings.

```typescript
import { parseLNURLOrAddress } from 'applesauce-common/helpers/lnurl';

// Works with either format
const url1 = parseLNURLOrAddress('alice@getalby.com');
const url2 = parseLNURLOrAddress('lnurl1...');
```

**Use Case**: When you don't know which format the user will provide

#### `getInvoice(callback: URL): Promise<string>`

Requests a bolt11 invoice from a LNURL callback URL.

```typescript
import { parseLightningAddress, getInvoice } from 'applesauce-common/helpers/lnurl';

// Get invoice for a Lightning Address
const callbackUrl = parseLightningAddress('alice@getalby.com');
if (callbackUrl) {
  const invoice = await getInvoice(callbackUrl);
  // Returns: bolt11 invoice string (lnbc...)
}
```

**Flow**:
1. Parse Lightning Address or LNURL to get callback URL
2. Call `getInvoice()` with callback URL
3. Receive bolt11 invoice string
4. Pay invoice using Lightning wallet

## Bolt11 Helpers

Location: `applesauce-common/helpers/bolt11`

### Types

```typescript
type ParsedInvoice = {
  paymentRequest: string;  // Original invoice string
  description: string;     // Invoice description
  amount?: number;         // Amount in millisats (optional)
  timestamp: number;       // Creation timestamp
  expiry: number;          // Expiration time
  paymentHash?: string;    // Payment hash (optional)
}
```

### Functions

#### `parseBolt11(paymentRequest: string): ParsedInvoice`

Parses a Lightning bolt11 invoice into structured data.

```typescript
import { parseBolt11 } from 'applesauce-common/helpers/bolt11';

const invoice = parseBolt11('lnbc10n1...');
console.log(invoice.amount);        // 10000 (msats)
console.log(invoice.description);   // "Coffee"
console.log(invoice.expiry);        // 3600 (seconds)
```

## Zap Helpers (NIP-57)

Location: `applesauce-common/helpers/zap`

### Core Concept

Zaps are Lightning payments with cryptographic proof on Nostr. The flow:

1. User wants to zap (tip) content or a profile
2. Get recipient's Lightning Address from their profile (`lud16` or `lud06`)
3. Create zap request event (kind 9734)
4. Get invoice from LNURL callback
5. Pay invoice via Lightning
6. LNURL provider publishes zap receipt (kind 9735) to Nostr relays
7. Zap receipt proves payment occurred

### Types

```typescript
type ZapEvent = KnownEvent<kinds.Zap>;  // kind 9735

type ZapSplit = {
  pubkey: string;    // Recipient pubkey
  percent: number;   // Percentage of zap (calculated)
  weight: number;    // Relative weight
  relay?: string;    // Preferred relay
};
```

### Validation

#### `isValidZap(zap?: NostrEvent): zap is ZapEvent`

Checks if a zap event is valid (has required fields). Does NOT validate LNURL address.

```typescript
import { isValidZap } from 'applesauce-common/helpers/zap';

if (isValidZap(event)) {
  // TypeScript now knows event is ZapEvent
  const amount = getZapAmount(event); // Won't be undefined
}
```

**Note**: This only validates structure, not cryptographic signatures or LNURL

### Extraction Helpers

All helpers cache internally - no need for `useMemo`!

#### `getZapAmount(zap: NostrEvent): number | undefined`

Returns the zap amount in millisats.

```typescript
import { getZapAmount } from 'applesauce-common/helpers/zap';

// Returns amount in millisats (1 sat = 1000 msats)
const msats = getZapAmount(zapEvent);
const sats = msats ? Math.floor(msats / 1000) : 0;
```

#### `getZapSender(zap: NostrEvent): string | undefined`

Returns the sender's pubkey (who sent the zap).

```typescript
import { getZapSender } from 'applesauce-common/helpers/zap';

const senderPubkey = getZapSender(zapEvent);
```

#### `getZapRecipient(zap: NostrEvent): string | undefined`

Returns the recipient's pubkey (who received the zap).

```typescript
import { getZapRecipient } from 'applesauce-common/helpers/zap';

const recipientPubkey = getZapRecipient(zapEvent);
```

#### `getZapRequest(zap: NostrEvent): NostrEvent | undefined`

Returns the zap request event (kind 9734) embedded in the zap receipt.

```typescript
import { getZapRequest } from 'applesauce-common/helpers/zap';

const zapRequest = getZapRequest(zapReceipt);
if (zapRequest) {
  const comment = zapRequest.content; // Zap comment/message
}
```

**Use Case**: Get the zap comment (message attached to zap)

#### `getZapPayment(zap: NostrEvent): ParsedInvoice | undefined`

Returns the parsed bolt11 invoice from the zap receipt.

```typescript
import { getZapPayment } from 'applesauce-common/helpers/zap';

const payment = getZapPayment(zapEvent);
if (payment) {
  console.log(payment.paymentHash);
  console.log(payment.amount);
}
```

#### `getZapPreimage(zap: NostrEvent): string | undefined`

Returns the payment preimage (proof of payment).

```typescript
import { getZapPreimage } from 'applesauce-common/helpers/zap';

const preimage = getZapPreimage(zapEvent);
```

#### `getZapEventPointer(zap: NostrEvent): EventPointer | null`

Gets the EventPointer for the event that was zapped (if zapping a specific event).

```typescript
import { getZapEventPointer } from 'applesauce-common/helpers/zap';

const pointer = getZapEventPointer(zapEvent);
if (pointer) {
  // This zap was for a specific event
  console.log(pointer.id);  // Event ID
}
```

#### `getZapAddressPointer(zap: NostrEvent): AddressPointer | null`

Gets the AddressPointer for the replaceable event that was zapped.

```typescript
import { getZapAddressPointer } from 'applesauce-common/helpers/zap';

const pointer = getZapAddressPointer(zapEvent);
if (pointer) {
  // This zap was for a replaceable event
  console.log(pointer.kind);
  console.log(pointer.identifier);
}
```

#### `getZapSplits(event: NostrEvent): ZapSplit[] | undefined`

Returns the zap splits configured on an event (for multi-recipient zaps).

```typescript
import { getZapSplits } from 'applesauce-common/helpers/zap';

const splits = getZapSplits(event);
if (splits) {
  splits.forEach(split => {
    console.log(`${split.pubkey}: ${split.percent}%`);
  });
}
```

**Use Case**: Events can specify multiple recipients for zaps (value-for-value splits)

## Zap Cast (Reactive)

Location: `applesauce-common/casts/zap`

The `Zap` cast provides a reactive, object-oriented interface to zap events.

### Usage

```typescript
import { castEvent } from 'applesauce-common/casts';
import { Zap } from 'applesauce-common/casts/zap';
import { use$ } from 'applesauce-react/hooks';

function ZapComponent({ zapEvent }) {
  const zap = castEvent(zapEvent, Zap, eventStore);

  // Synchronous properties
  console.log(zap.amount);           // Amount in msats
  console.log(zap.payment);          // ParsedInvoice
  console.log(zap.preimage);         // Payment preimage
  console.log(zap.request);          // Zap request event
  console.log(zap.sender);           // User cast for sender
  console.log(zap.recipient);        // User cast for recipient
  console.log(zap.eventPointer);     // EventPointer | null
  console.log(zap.addressPointer);   // AddressPointer | null

  // Reactive observable - zapped event
  const zappedEvent = use$(zap.event$);

  return (
    <div>
      <p>{zap.sender.name} zapped {zap.amount / 1000} sats</p>
      {zappedEvent && <EventCard event={zappedEvent} />}
    </div>
  );
}
```

### Properties

- `sender: User` - User cast for the zap sender
- `recipient: User` - User cast for the zap recipient
- `payment: ParsedInvoice` - Parsed bolt11 invoice
- `amount: number` - Amount in millisats
- `preimage: string | undefined` - Payment preimage
- `request: NostrEvent` - Zap request event (kind 9734)
- `eventPointer: EventPointer | null` - Pointer to zapped event
- `addressPointer: AddressPointer | null` - Pointer to zapped address
- `event$: Observable<NostrEvent | undefined>` - Observable of zapped event

## Zap Models (Queries)

Location: `applesauce-common/models/zaps`

Models provide reactive queries for zap events.

### EventZapsModel

Gets all zaps for a specific event.

```typescript
import { EventZapsModel } from 'applesauce-common/models/zaps';
import { use$ } from 'applesauce-react/hooks';

function EventZaps({ event }) {
  const zaps = use$(() => EventZapsModel(event), [event.id]);

  const totalSats = zaps.reduce((sum, zap) =>
    sum + (getZapAmount(zap) / 1000), 0
  );

  return <div>{zaps.length} zaps - {totalSats} sats total</div>;
}
```

**Accepts**: `string | EventPointer | AddressPointer | NostrEvent`

### SentZapsModel

Gets all zaps sent by a user.

```typescript
import { SentZapsModel } from 'applesauce-common/models/zaps';
import { use$ } from 'applesauce-react/hooks';

function UserSentZaps({ pubkey }) {
  const sentZaps = use$(() => SentZapsModel(pubkey), [pubkey]);

  return <div>Sent {sentZaps.length} zaps</div>;
}
```

### ReceivedZapsModel

Gets all zaps received by a user.

```typescript
import { ReceivedZapsModel } from 'applesauce-common/models/zaps';
import { use$ } from 'applesauce-react/hooks';

function UserReceivedZaps({ pubkey }) {
  const receivedZaps = use$(() => ReceivedZapsModel(pubkey), [pubkey]);

  const totalReceived = receivedZaps.reduce((sum, zap) =>
    sum + (getZapAmount(zap) / 1000), 0
  );

  return <div>Received {totalReceived} sats</div>;
}
```

## Zap Operations (Event Creation)

Location: `applesauce-common/operations/zap-split`

Operations for creating events with zap splits.

### setZapSplitTags

Override the zap splits on an event.

```typescript
import { setZapSplitTags } from 'applesauce-common/operations/zap-split';
import { EventFactory } from 'applesauce-core/event-factory';

const factory = new EventFactory({ signer });

// Create event with zap splits
const draft = await factory.build(
  NoteBlueprint({ content: 'Hello!' }),
  setZapSplitTags([
    { pubkey: 'alice-pubkey', weight: 2 },  // Gets 66%
    { pubkey: 'bob-pubkey', weight: 1 },    // Gets 33%
  ])
);
```

**Type**: `Omit<ZapSplit, "percent" | "relay">[]`

Weights are converted to percentages automatically.

### setZapSplit

Creates the necessary operations for zap options.

```typescript
import { setZapSplit } from 'applesauce-common/operations/zap-split';

const draft = await factory.build(
  NoteBlueprint({ content: 'Hello!' }),
  setZapSplit({
    splits: [
      { pubkey: 'alice-pubkey', weight: 1 },
      { pubkey: 'bob-pubkey', weight: 1 },
    ]
  })
);
```

## Profile Integration

Lightning Addresses are stored in user profiles (kind 0 metadata).

```typescript
// Profile metadata structure
interface ProfileMetadata {
  name?: string;
  lud06?: string;  // LNURL (deprecated, use lud16)
  lud16?: string;  // Lightning Address (preferred)
  // ... other fields
}
```

### Getting Lightning Address from Profile

```typescript
import { useProfile } from '@/hooks/useProfile';
import { parseLightningAddress } from 'applesauce-common/helpers/lnurl';

function ZapButton({ pubkey }) {
  const profile = useProfile(pubkey);

  const lightningAddress = profile?.lud16 || profile?.lud06;

  const handleZap = async () => {
    if (!lightningAddress) {
      alert('No Lightning Address');
      return;
    }

    // Parse to callback URL
    const callbackUrl = parseLightningAddress(lightningAddress);
    if (!callbackUrl) return;

    // Get invoice
    const invoice = await getInvoice(callbackUrl);

    // Pay with webln or show QR code
    if (window.webln) {
      await window.webln.sendPayment(invoice);
    }
  };

  return (
    <button onClick={handleZap} disabled={!lightningAddress}>
      ⚡ Zap
    </button>
  );
}
```

## Complete Zap Flow Example

Here's a complete example of creating and displaying zaps:

```typescript
import {
  getZapAmount,
  getZapSender,
  getZapRequest,
  isValidZap,
  getZapEventPointer,
} from 'applesauce-common/helpers/zap';
import { parseLightningAddress, getInvoice } from 'applesauce-common/helpers/lnurl';
import { useNostrEvent } from '@/hooks/useNostrEvent';
import { useProfile } from '@/hooks/useProfile';

// Display a zap receipt
function ZapReceipt({ event }) {
  // Validate
  if (!isValidZap(event)) {
    return <div>Invalid zap</div>;
  }

  // Get zap details (helpers cache internally - no useMemo needed!)
  const zapSender = getZapSender(event);
  const zapAmount = getZapAmount(event);
  const zapRequest = getZapRequest(event);
  const eventPointer = getZapEventPointer(event);

  // Fetch sender profile
  const senderProfile = useProfile(zapSender);

  // Fetch zapped event
  const zappedEvent = useNostrEvent(eventPointer || undefined);

  // Get comment
  const comment = zapRequest?.content || null;

  // Convert to sats
  const sats = Math.floor(zapAmount / 1000);

  return (
    <div>
      <div>
        ⚡ {senderProfile?.name || 'Anonymous'} zapped {sats.toLocaleString()} sats
      </div>
      {comment && <p>{comment}</p>}
      {zappedEvent && <EventCard event={zappedEvent} />}
    </div>
  );
}

// Send a zap
async function sendZap(recipientPubkey: string, amountSats: number, comment?: string) {
  // 1. Get recipient's Lightning Address
  const profile = await getProfile(recipientPubkey);
  const lightningAddress = profile?.lud16 || profile?.lud06;

  if (!lightningAddress) {
    throw new Error('No Lightning Address found');
  }

  // 2. Parse Lightning Address
  const callbackUrl = parseLightningAddress(lightningAddress);
  if (!callbackUrl) {
    throw new Error('Invalid Lightning Address');
  }

  // 3. Create zap request event (kind 9734)
  const zapRequest = await factory.sign({
    kind: 9734,
    content: comment || '',
    tags: [
      ['p', recipientPubkey],
      ['amount', String(amountSats * 1000)], // Convert to msats
      ['relays', 'wss://relay1.com', 'wss://relay2.com'],
    ],
    created_at: Math.floor(Date.now() / 1000),
  });

  // 4. Add zap request to callback URL
  const invoiceUrl = new URL(callbackUrl);
  invoiceUrl.searchParams.set('amount', String(amountSats * 1000));
  invoiceUrl.searchParams.set('nostr', JSON.stringify(zapRequest));

  // 5. Get invoice
  const invoice = await getInvoice(invoiceUrl);

  // 6. Pay invoice (using WebLN or show QR)
  if (window.webln) {
    await window.webln.sendPayment(invoice);
    return { success: true };
  } else {
    // Show QR code with invoice
    return { invoice };
  }
}
```

## Best Practices

### 1. No useMemo for Helpers

All applesauce helpers cache internally using symbols. Don't wrap them in `useMemo`:

```typescript
// ❌ WRONG - Unnecessary memoization
const amount = useMemo(() => getZapAmount(event), [event]);
const sender = useMemo(() => getZapSender(event), [event]);

// ✅ CORRECT - Helpers cache internally
const amount = getZapAmount(event);
const sender = getZapSender(event);
```

### 2. Validate Zaps Before Using

Always validate zap events before extracting data:

```typescript
if (isValidZap(zapEvent)) {
  const amount = getZapAmount(zapEvent); // TypeScript knows this won't be undefined
}
```

### 3. Prefer lud16 over lud06

`lud16` (Lightning Address) is the modern format. Fall back to `lud06` (LNURL) for compatibility:

```typescript
const address = profile?.lud16 || profile?.lud06;
```

### 4. Use Models for Reactive Queries

For reactive lists of zaps, use the models:

```typescript
// ✅ CORRECT - Reactive, auto-updates
const zaps = use$(() => EventZapsModel(event), [event.id]);

// ❌ WRONG - Manual subscription management
const [zaps, setZaps] = useState([]);
useEffect(() => {
  const sub = eventStore.timeline(filter).subscribe(setZaps);
  return () => sub.unsubscribe();
}, []);
```

### 5. Handle Missing Lightning Addresses

Not all users have Lightning Addresses. Always check before attempting to zap:

```typescript
const canZap = !!(profile?.lud16 || profile?.lud06);

return (
  <button disabled={!canZap}>
    {canZap ? '⚡ Zap' : 'No Lightning Address'}
  </button>
);
```

## Integration with Grimoire

Current usage in Grimoire:

1. **ProfileViewer** (`src/components/ProfileViewer.tsx:438-444`)
   - Displays `lud16` Lightning Address in profile details

2. **ZapReceiptRenderer** (`src/components/nostr/kinds/ZapReceiptRenderer.tsx`)
   - Renders kind 9735 zap receipt events
   - Uses `getZapAmount`, `getZapSender`, `getZapRequest`, `getZapEventPointer`, `isValidZap`
   - **Note**: Currently uses `useMemo` unnecessarily (could be removed per best practices)

3. **ProfileMetadata** (`src/types/profile.ts:9-10`)
   - Defines `lud06` and `lud16` fields

## Related NIPs

- **NIP-57**: Lightning Zaps - https://github.com/nostr-protocol/nips/blob/master/57.md
- **NIP-47**: Nostr Wallet Connect - Remote wallet control
- **NIP-05**: NIP-05 Mapping - Often includes relay hints for zap receipts

## Resources

- LNURL Spec: https://github.com/lnurl/luds
- Lightning Network: https://lightning.network/
- WebLN: https://www.webln.guide/

## Summary

The applesauce LNURL and Lightning helpers provide:

✅ **Complete LNURL support** - Parse addresses, decode LNURL, fetch invoices
✅ **Comprehensive zap helpers** - Extract all data from zap receipts
✅ **Bolt11 parsing** - Parse Lightning invoices
✅ **Reactive models** - Query zaps with RxJS observables
✅ **Zap splits** - Multi-recipient value distribution
✅ **Type safety** - Full TypeScript definitions
✅ **Internal caching** - No manual memoization needed
✅ **NIP-57 compliance** - Full support for Lightning Zaps protocol

Use these helpers to integrate Lightning payments and tips into your Nostr application!
