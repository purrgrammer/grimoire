# Gift Wrap Performance Optimization Design

## Problem Statement

The current gift wrap implementation (PR #113) has performance issues when handling thousands of gift-wrapped messages:

1. **UI Clogging**: IndexedDB writes block the main thread
2. **Unresponsive Auth**: Relay AUTH prompts don't appear due to concurrent operations
3. **Memory Pressure**: All gift wraps loaded into memory immediately
4. **Slow Initial Load**: Auto-decrypt attempts to decrypt thousands of messages at once

## Root Causes

### 1. No Relay Auth Pre-Check
- Connects to relays immediately with REQ
- AUTH challenges happen during active subscription
- UI thread blocked by concurrent decryption + IndexedDB writes

### 2. Unbounded Loading
```typescript
// Current: Loads ALL gift wraps
eventStore.timeline({ kinds: [kinds.GiftWrap], "#p": [userPubkey] })

// Problem: No pagination, no time windowing
```

### 3. IndexedDB Write Storm
```typescript
// Called for EVERY batch of new events
if (newGiftWraps.length > 0 && this.userPubkey) {
  saveGiftWraps(newGiftWraps, this.userPubkey).catch(...);
}
```

- No debouncing
- No batching
- Continuous writes during sync

### 4. Conversations Rebuild on Every Event
```typescript
// Called for every timeline update
this.updateConversations();
```

- O(N) scan of all gift wraps
- No incremental updates

## Solution Architecture

### Phase 1: Relay Auth Pre-Check (CRITICAL)

**Before subscribing to gift wraps, ensure relays are authenticated:**

```typescript
async function ensureRelayAuth(relayUrl: string): Promise<boolean> {
  // 1. Send dummy REQ with immediate CLOSE
  const dummyFilter = { kinds: [0], authors: [userPubkey], limit: 1 };

  // 2. Wait for AUTH challenge + complete auth flow
  // 3. Return true if relay is ready, false if failed

  // 4. Timeout after 5s (don't wait forever for dead relays)
}

// Pre-authenticate all inbox relays before querying gift wraps
const authedRelays = await Promise.all(
  inboxRelays.map(relay => ensureRelayAuth(relay))
);
```

**Benefits:**
- AUTH prompts appear BEFORE heavy operations
- User can approve/deny auth while UI is responsive
- Failed relays excluded from gift wrap queries

### Phase 2: Time-Windowed Pagination

**Load gift wraps in time windows instead of all-at-once:**

```typescript
// Sync strategy with 3 time windows
const SYNC_STRATEGY = {
  // Recent: Last 7 days (real-time sync)
  recent: { since: now - 7_DAYS, until: now },

  // Historical: Last 30 days (on-demand)
  historical: { since: now - 30_DAYS, until: now - 7_DAYS },

  // Archive: Older than 30 days (explicit user action)
  archive: { until: now - 30_DAYS },
};
```

**Loading Flow:**

1. **On Startup/Enable**:
   - Load `recent` window only (last 7 days)
   - Subscribe for real-time updates (since: now)
   - Keep connection open for live messages

2. **On Scroll to Top** (user wants older messages):
   - Load `historical` window (7-30 days ago)
   - Paginate in 7-day chunks with loading indicators

3. **On Explicit "Load All"**:
   - Load `archive` window (>30 days ago)
   - Show progress indicator
   - Allow cancellation

**Benefits:**
- Fast initial load (only recent messages)
- Responsive UI (load on-demand)
- User controls data fetching

### Phase 3: Batched IndexedDB Writes

**Replace immediate writes with batched queue:**

```typescript
class GiftWrapPersistence {
  private writeQueue: NostrEvent[] = [];
  private writeTimer: NodeJS.Timeout | null = null;

  private readonly BATCH_SIZE = 50;      // Write every 50 events
  private readonly BATCH_DELAY_MS = 2000; // Or every 2 seconds

  enqueue(events: NostrEvent[]) {
    this.writeQueue.push(...events);

    // Flush if queue is full
    if (this.writeQueue.length >= this.BATCH_SIZE) {
      this.flush();
      return;
    }

    // Schedule flush if not already scheduled
    if (!this.writeTimer) {
      this.writeTimer = setTimeout(() => this.flush(), this.BATCH_DELAY_MS);
    }
  }

  async flush() {
    if (this.writeQueue.length === 0) return;

    const batch = this.writeQueue.splice(0, this.writeQueue.length);
    clearTimeout(this.writeTimer);
    this.writeTimer = null;

    // Single IndexedDB transaction for all events
    await saveGiftWrapsBatch(batch, this.userPubkey);
  }
}
```

**Benefits:**
- Reduces IndexedDB transactions from N to N/50
- Batches writes into single transaction (faster)
- Debounces rapid updates

### Phase 4: Incremental Conversation Updates

**Replace full rebuild with incremental updates:**

```typescript
class ConversationIndex {
  private conversations = new Map<string, Conversation>();

  addRumor(rumor: Rumor) {
    const convId = getConversationIdentifierFromMessage(rumor);
    const existing = this.conversations.get(convId);

    // Only update if this is newer
    if (!existing || rumor.created_at > (existing.lastMessage?.created_at ?? 0)) {
      this.conversations.set(convId, {
        id: convId,
        participants: getConversationParticipants(rumor),
        lastMessage: rumor,
      });
      return true; // Changed
    }
    return false; // No change
  }

  removeRumor(rumorId: string) {
    // Handle deletions incrementally
  }
}
```

**Benefits:**
- O(1) updates instead of O(N) rebuilds
- Only emit conversation updates when they actually change
- Reduces unnecessary re-renders

### Phase 5: Smart Auto-Decrypt

**Replace "decrypt all" with "decrypt visible + recent":**

```typescript
class SmartDecryptQueue {
  private queue: string[] = [];
  private processing = false;

  // Decrypt in priority order:
  // 1. Visible in UI (current conversation)
  // 2. Recent (last 24 hours)
  // 3. Rest (background, low priority)

  async decryptPriority(visibleIds: string[], recentIds: string[]) {
    // Decrypt visible immediately (high priority)
    await this.decryptBatch(visibleIds, { concurrent: 5 });

    // Decrypt recent in background (medium priority)
    await this.decryptBatch(recentIds, { concurrent: 3, delay: 100 });

    // Rest can wait until idle
    requestIdleCallback(() => this.decryptRemainingInBackground());
  }
}
```

**Benefits:**
- User sees their active conversation immediately
- Recent messages decrypt in background
- Old messages decrypt only when idle (or never if not needed)

## Implementation Plan

### Step 1: Create New Service Layer
- [ ] `src/services/gift-wrap-v2.ts` - New implementation
- [ ] `src/services/gift-wrap-persistence.ts` - Batched IndexedDB
- [ ] `src/services/relay-auth-manager.ts` - Pre-authentication

### Step 2: Implement Relay Auth Pre-Check
- [ ] Auth manager with timeout
- [ ] Parallel auth for multiple relays
- [ ] Failed relay exclusion

### Step 3: Implement Time-Windowed Loading
- [ ] Recent window (7 days)
- [ ] Historical window (7-30 days)
- [ ] Archive window (>30 days)
- [ ] "Load More" UI

### Step 4: Implement Batched Persistence
- [ ] Write queue
- [ ] Batch flushing
- [ ] Transaction optimization

### Step 5: Implement Incremental Conversations
- [ ] Conversation index
- [ ] Incremental add/remove
- [ ] Change detection

### Step 6: Implement Smart Decrypt
- [ ] Priority queue
- [ ] Visible-first decryption
- [ ] Background decryption
- [ ] Idle callback usage

### Step 7: Update UI Components
- [ ] InboxViewer: Show time windows
- [ ] ChatViewer: Integrate smart decrypt
- [ ] Loading indicators for historical fetch

## Performance Targets

| Metric | Current | Target |
|--------|---------|--------|
| Initial load (1000 gifts) | 3-5s | <500ms |
| Time to first message | 2-3s | <200ms |
| IndexedDB transactions | 1000 | <20 |
| Memory usage (1000 gifts) | ~50MB | ~10MB |
| UI responsiveness during sync | Frozen | 60fps |
| Conversation list updates | Every event | On change only |

## Backwards Compatibility

**Migration Strategy:**
1. New code reads both old and new IndexedDB schema
2. Lazy migration on access (no upfront cost)
3. Settings preserved (enabled/autoDecrypt)
4. Existing Dexie tables remain unchanged

## Testing Strategy

1. **Unit Tests**: Time window calculations, batch queue logic
2. **Integration Tests**: Full sync flow with mocked relays
3. **Performance Tests**: Benchmark with 5000+ gift wraps
4. **Manual Tests**: Real-world usage on nos.lol with active DMs

## Rollout Plan

1. **Feature Flag**: `grimoire:gift-wrap-v2` in localStorage
2. **A/B Test**: 10% of users on v2, monitor performance
3. **Gradual Rollout**: 50% → 100% over 1 week
4. **Rollback Plan**: Toggle flag to revert to v1

## Success Metrics

- ✅ AUTH prompts appear within 1s of enabling inbox
- ✅ First conversation visible within 500ms
- ✅ UI stays responsive during sync (60fps)
- ✅ No reports of "app frozen" during DM sync
- ✅ Memory usage under 20MB for 1000 gift wraps
- ✅ Background decryption completes without blocking UI
