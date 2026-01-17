# Gift Wrap Study & Performance Optimization Summary

## Part 1: NIP Study (NIP-17, NIP-44, NIP-59)

### NIP-44: Encrypted Payloads (Versioned)

**Purpose**: Versioned encryption scheme for Nostr event payloads

**Technical Details**:
- Uses ChaCha20 encryption (faster than AES, better multi-key attack resistance)
- HMAC-SHA256 for authentication (instead of Poly1305)
- Custom padding scheme for better metadata protection
- Versioned to allow multiple algorithms to coexist
- Audited by Cure53 in December 2023

**Limitations**: No deniability, no forward secrecy, no post-compromise security, no post-quantum security

### NIP-59: Gift Wrap

**Purpose**: Encapsulates any Nostr event to hide metadata during transmission

**Three-Layer Architecture**:
1. **Rumor**: Unsigned event (can't be verified if leaked)
2. **Seal** (kind:13): Signed by author, shows *who* signed but not *what* was said
3. **Gift Wrap** (kind:1059): Encrypts seal with ephemeral key, only reveals recipient's pubkey

**Privacy Features**: Hides participant identities, timestamps, event kinds, and other metadata from public view

### NIP-17: Private Direct Messages

**Purpose**: Modern encrypted chat replacing deprecated NIP-04

**Implementation**: Combines NIP-44 encryption + NIP-59 seals/gift wraps

**Privacy Guarantees**:
- No metadata leakage (identities, timestamps, event kinds hidden)
- Senders/receivers can't be linked publicly
- No central queue or converging identifier
- Messages flow through public relays without privacy loss
- `created_at` randomized (up to 2 days past) for additional obfuscation

## Part 2: Applesauce Architecture Deep Dive

### Symbol-Based Caching System

**Core Mechanism** (`applesauce-core/helpers/cache`):
```typescript
// Helpers cache computed values using symbols on event objects
function getOrComputeCachedValue<T>(event: any, symbol: symbol, compute: () => T): T
```

**How It Works**:
1. Each helper defines a unique Symbol (e.g., `HighlightSourceEventPointerSymbol`)
2. First call: Compute value, cache on event object using symbol
3. Subsequent calls: Return cached value instantly

**Critical Insight**: **You don't need `useMemo` when calling applesauce helpers!**

### Gift Wrap Helpers (`applesauce-common/helpers/gift-wrap`)

**Internal Storage**:
```typescript
// Isolated EventMemory to prevent seal/rumor leakage
const internalGiftWrapEvents: EventMemory;
```

**Type System**:
```typescript
type Rumor = UnsignedEvent & { id: string };

type UnlockedGiftWrapEvent = KnownEvent<kinds.GiftWrap> & {
  [SealSymbol]: UnlockedSeal;
};

type UnlockedSeal = KnownEvent<kinds.Seal> & {
  [GiftWrapSymbol]: UnlockedGiftWrapEvent;
  [RumorSymbol]: Rumor;
};
```

**Core Functions**:
- `unlockGiftWrap(gift, signer)` - Decrypts gift wrap → seal → rumor
- `unlockSeal(seal, signer)` - Decrypts seal → rumor
- `getGiftWrapRumor(gift)` - Returns cached rumor if unlocked
- `getSealRumor(seal)` - Returns rumor from seal
- Navigation symbols link events bidirectionally (gift wrap ↔ seal ↔ rumor)

### Gift Wrap Operations (`applesauce-common/operations/gift-wrap`)

**Pipeline for Creating Gift Wraps**:
```typescript
// Three-step pipeline
toRumor() -> sealRumor(pubkey) -> wrapSeal(pubkey, opts)

// Or use combined operation
giftWrap(pubkey, opts)
```

### Event Store Caching Architecture

**EventMemory** (In-Memory Database):
- **LRU Cache**: Events stored in Least-Recently-Used cache
- **Indexes**: kinds, authors, tags, created_at, kindAuthor composite, replaceable addresses
- **Claims System**: Reference counting to track event usage
- **Pruning**: Automatically removes unclaimed events to free memory

**EventStore** (Wrapper + Reactive Layer):
- **Single Instance Pattern**: Ensures one copy of each event in memory
- **RxJS Observables**: `insert$`, `update$`, `remove$` streams
- **Delete Manager**: Handles NIP-09 event deletion authorization
- **Replaceable Events**: Auto-replaces old versions (configurable)

## Part 3: PR #113 Analysis

### Current Implementation Strengths

✅ **Good Architecture**:
- Singleton service pattern
- Observable-based reactive updates
- Persistent settings in localStorage
- Dexie-based persistence
- On-demand initialization (only when enabled)

✅ **Good UX**:
- InboxViewer with conversation grouping
- Self-chat support ("Saved Messages")
- Auto-decrypt toggle
- Real-time message delivery

### Performance Issues Identified

❌ **No Relay Authentication Pre-Check**:
- Connects to relays immediately with REQ
- AUTH challenges happen during active subscription
- UI thread blocked by concurrent decryption + IndexedDB writes

❌ **Unbounded Loading**:
```typescript
// Loads ALL gift wraps into memory
eventStore.timeline({ kinds: [kinds.GiftWrap], "#p": [userPubkey] })
```
- No pagination
- No time windowing
- "Progressive loading" (LIMIT 20, then backfill) still loads everything

❌ **IndexedDB Write Storm**:
```typescript
// Called for EVERY batch of new events
if (newGiftWraps.length > 0 && this.userPubkey) {
  saveGiftWraps(newGiftWraps, this.userPubkey).catch(...);
}
```
- No debouncing
- No batching
- Continuous writes during sync

❌ **Conversations Rebuild on Every Event**:
```typescript
// Called for every timeline update
this.updateConversations();
```
- O(N) scan of all gift wraps
- No incremental updates

❌ **Auto-Decrypt All at Once**:
- If enabled, attempts to decrypt thousands immediately
- Blocks UI during decryption

## Part 4: Performance Optimization Architecture

### Solution 1: Relay Auth Pre-Check (CRITICAL) ✅ IMPLEMENTED

**File**: `src/services/relay-auth-manager.ts`

**Strategy**:
```typescript
async function preAuthenticateRelay(relayUrl: string, userPubkey: string): Promise<RelayAuthResult> {
  // 1. Send minimal dummy REQ (kind 0, limit 1)
  // 2. Wait for AUTH challenge + complete auth flow
  // 3. Return true if relay is ready, false if failed
  // 4. Timeout after 5s (don't wait forever for dead relays)
}
```

**Benefits**:
- AUTH prompts appear BEFORE heavy operations
- User can approve/deny auth while UI is responsive
- Failed relays excluded from gift wrap queries

### Solution 2: Batched IndexedDB Writes ✅ IMPLEMENTED

**File**: `src/services/gift-wrap-persistence.ts`

**Strategy**:
```typescript
class GiftWrapPersistence {
  private writeQueue: NostrEvent[] = [];
  private readonly BATCH_SIZE = 50;
  private readonly BATCH_DELAY_MS = 2000;

  enqueue(event: NostrEvent) {
    this.writeQueue.push(event);

    // Flush if queue is full OR after delay
    if (this.writeQueue.length >= BATCH_SIZE) {
      this.flush();
    } else {
      this.scheduleFlush(BATCH_DELAY_MS);
    }
  }

  async flush() {
    // Single IndexedDB transaction for all events
    await saveGiftWrapsBatch(this.writeQueue, this.userPubkey);
    this.writeQueue = [];
  }
}
```

**Performance**:
- **Before**: 1000 events = 1000 IndexedDB transactions
- **After**: 1000 events = 20 transactions (50x improvement!)
- Reduces UI blocking significantly

### Solution 3: Time-Windowed Pagination (DESIGNED)

**Strategy**:
```typescript
const SYNC_STRATEGY = {
  // Recent: Last 7 days (real-time sync)
  recent: { since: now - 7_DAYS, until: now },

  // Historical: Last 30 days (on-demand)
  historical: { since: now - 30_DAYS, until: now - 7_DAYS },

  // Archive: Older than 30 days (explicit user action)
  archive: { until: now - 30_DAYS },
};
```

**Loading Flow**:
1. **On Startup**: Load `recent` window only (last 7 days)
2. **On Scroll**: Load `historical` window (7-30 days ago) in chunks
3. **On "Load All"**: Load `archive` window with progress indicator

**Benefits**:
- Fast initial load (only recent messages)
- Responsive UI (load on-demand)
- User controls data fetching

### Solution 4: Incremental Conversation Updates (DESIGNED)

**Strategy**:
```typescript
class ConversationIndex {
  private conversations = new Map<string, Conversation>();

  addRumor(rumor: Rumor): boolean {
    const convId = getConversationIdentifierFromMessage(rumor);
    const existing = this.conversations.get(convId);

    // Only update if this is newer
    if (!existing || rumor.created_at > existing.lastMessage?.created_at) {
      this.conversations.set(convId, { /* ... */ });
      return true; // Changed
    }
    return false; // No change
  }
}
```

**Performance**:
- **Before**: O(N) rebuild on every event
- **After**: O(1) updates
- Only emit conversation updates when they actually change

### Solution 5: Smart Auto-Decrypt (DESIGNED)

**Strategy**:
```typescript
class SmartDecryptQueue {
  async decryptPriority(visibleIds: string[], recentIds: string[]) {
    // 1. Decrypt visible immediately (high priority)
    await this.decryptBatch(visibleIds, { concurrent: 5 });

    // 2. Decrypt recent in background (medium priority)
    await this.decryptBatch(recentIds, { concurrent: 3, delay: 100 });

    // 3. Rest can wait until idle
    requestIdleCallback(() => this.decryptRemainingInBackground());
  }
}
```

**Benefits**:
- User sees active conversation immediately
- Recent messages decrypt in background
- Old messages decrypt only when idle

## Performance Targets

| Metric | Current | Target |
|--------|---------|--------|
| Initial load (1000 gifts) | 3-5s | <500ms |
| Time to first message | 2-3s | <200ms |
| IndexedDB transactions | 1000 | <20 |
| Memory usage (1000 gifts) | ~50MB | ~10MB |
| UI responsiveness during sync | Frozen | 60fps |

## Implementation Status

### ✅ Completed

1. **Relay Auth Manager** (`src/services/relay-auth-manager.ts`)
   - Pre-authentication with timeout
   - Parallel auth for multiple relays
   - Failed relay exclusion

2. **Batched Persistence** (`src/services/gift-wrap-persistence.ts`)
   - Write queue with batching
   - Configurable batch size and delay
   - Backpressure handling
   - Stats monitoring

3. **Design Documentation**:
   - `docs/gift-wrap-performance-design.md` - Full architecture
   - `docs/gift-wrap-study-summary.md` - This document

### 📋 Next Steps

1. **Implement Time-Windowed Gift Wrap Service**:
   - Create `src/services/gift-wrap-v2.ts`
   - Integrate relay auth manager
   - Integrate batched persistence
   - Implement time-windowed loading

2. **Implement Conversation Index**:
   - Incremental updates
   - O(1) add/remove
   - Change detection

3. **Implement Smart Decrypt Queue**:
   - Priority-based decryption
   - Visible-first strategy
   - Background decryption with idle callbacks

4. **Update UI Components**:
   - InboxViewer: Show time windows, "Load More" button
   - ChatViewer: Integrate smart decrypt
   - Loading indicators

5. **Testing**:
   - Unit tests for time window calculations
   - Integration tests with mocked relays
   - Performance benchmarks with 5000+ gift wraps
   - Manual testing on nos.lol

## Key Architectural Insights

1. **Caching is Built-In**: Applesauce helpers cache computed values using symbols—no manual memoization needed

2. **Single Event Instances**: EventMemory ensures only one copy of each event exists in memory

3. **Reactive by Default**: All data flows through RxJS observables, components auto-update

4. **Isolated Gift Wrap Storage**: Seals/rumors stored separately to prevent accidental leakage

5. **Bidirectional Links**: Symbols connect gift wrap ↔ seal ↔ rumor for easy navigation

6. **Event Factory Pattern**: Operations compose into pipelines (toRumor → sealRumor → wrapSeal)

7. **Batch Everything**: Network requests, decryption, IndexedDB writes—batching is key to performance

8. **Auth Before Heavy Ops**: Pre-authenticate relays to keep AUTH prompts responsive

9. **Load What You Need**: Time-windowed pagination prevents memory bloat

10. **Prioritize Visibility**: Decrypt what the user can see first, rest can wait

## Resources

- [NIP-17 Specification](https://nips.nostr.com/17)
- [NIP-44 Specification](https://nips.nostr.com/44)
- [NIP-59 Specification](https://nips.nostr.com/59)
- [Applesauce Documentation](https://hzrd149.github.io/applesauce/)
- [Applesauce TypeDoc API](https://hzrd149.github.io/applesauce/typedoc/)
- [PR #113: Gift Wrap Inbox Implementation](https://github.com/purrgrammer/grimoire/pull/113)
