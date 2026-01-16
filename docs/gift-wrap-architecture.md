# Gift Wrap (NIP-17) Architecture

## Overview

This document explains the architecture for encrypted private messaging using NIP-17/59 gift wrap protocol in Grimoire.

## Component Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         UI Layer                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ InboxViewer  │  │ ChatViewer   │  │ useAccountSync│          │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘          │
└─────────┼──────────────────┼──────────────────┼─────────────────┘
          │                  │                  │
          └──────────────────┴──────────────────┘
                             │
┌────────────────────────────┼─────────────────────────────────────┐
│                  Service Layer (Singletons)                       │
│                             ▼                                     │
│              ┌───────────────────────────┐                        │
│              │   GiftWrapService         │                        │
│              │  (gift-wrap.ts)           │                        │
│              │                           │                        │
│              │  - Manages gift wrap      │                        │
│              │    subscriptions          │                        │
│              │  - Tracks decrypt state   │                        │
│              │  - Groups conversations   │                        │
│              │  - Loads inbox relays     │                        │
│              └─────┬─────────────────────┘                        │
│                    │                                              │
│        ┌───────────┼────────────┐                                │
│        │           │            │                                │
│        ▼           ▼            ▼                                │
│  ┌──────────┐ ┌──────────┐ ┌──────────────┐                     │
│  │EventStore│ │RelayPool │ │RelayListCache│                     │
│  └──────────┘ └──────────┘ └──────────────┘                     │
│        │           │            │                                │
└────────┼───────────┼────────────┼────────────────────────────────┘
         │           │            │
┌────────┼───────────┼────────────┼────────────────────────────────┐
│                 Adapter Layer                                     │
│                             │                                     │
│              ┌──────────────▼──────────────┐                     │
│              │   Nip17Adapter              │                     │
│              │  (nip-17-adapter.ts)        │                     │
│              │                             │                     │
│              │  - Parses identifiers       │                     │
│              │  - Resolves conversations   │                     │
│              │  - Fetches inbox relays     │                     │
│              │  - Sends messages           │                     │
│              └──────────┬──────────────────┘                     │
│                         │                                        │
│                         ▼                                        │
│              ┌──────────────────────────┐                        │
│              │  Applesauce Actions      │                        │
│              │  - SendWrappedMessage    │                        │
│              │  - ReplyToWrappedMessage │                        │
│              └──────────────────────────┘                        │
└───────────────────────────────────────────────────────────────────┘
```

## Singleton Dependencies

### Critical Dependencies (Direct Imports)

**GiftWrapService** depends on:
- `eventStore` - Singleton EventStore for reactive Nostr event storage
- `pool` - Singleton RelayPool for relay connections
- `relayListCache` - Singleton cache for user relay lists (kind 10002/10050)
- `encryptedContentStorage` - Dexie storage for decrypted rumors

**Nip17Adapter** depends on:
- `giftWrapService` - For accessing decrypted rumors and conversations
- `accountManager` - For active account and signer
- `eventStore` - For creating synthetic events from rumors
- `pool` - For fetching inbox relay lists
- `relayListCache` - For cached relay list lookups
- `hub` - For executing applesauce actions

### Dependency Chain

```
UI Component
  └─> GiftWrapService (singleton)
       ├─> EventStore (singleton)
       ├─> RelayPool (singleton)
       ├─> RelayListCache (singleton)
       └─> EncryptedContentStorage (Dexie)

Chat Component
  └─> Nip17Adapter
       ├─> GiftWrapService (singleton)
       ├─> EventStore (singleton)
       ├─> AccountManager (singleton)
       ├─> RelayListCache (singleton)
       └─> Hub (action runner singleton)
```

### Why Singletons?

**EventStore**: Single reactive database for all Nostr events
- Ensures event deduplication
- Provides consistent observables for UI reactivity
- Manages replaceable event logic globally

**RelayPool**: Single connection manager for all relay connections
- Prevents duplicate WebSocket connections
- Centralizes relay health monitoring
- Manages subscription lifecycle

**RelayListCache**: Single cache for all user relay lists
- Reduces redundant kind 10002/10050 fetches
- Provides fast relay lookups for any pubkey
- Automatically updates on event arrival

**GiftWrapService**: Single manager for all gift wrap operations
- Ensures consistent decrypt state across UI
- Prevents duplicate subscription to same gift wraps
- Centralizes inbox relay management

## Data Flow

### Receiving Messages (Inbox Flow)

1. **User Enables Inbox Sync** → User toggles "Enable Inbox Sync" in InboxViewer settings
2. **Service Initialization** → `useAccountSync` detects enabled setting and calls `giftWrapService.init(pubkey, signer)`
3. **Fetch Inbox Relays** → Load kind 10050 from user's outbox relays
4. **Subscribe to Gift Wraps** → Open subscription to inbox relays for `kind 1059` with `#p` = user pubkey
5. **Gift Wrap Arrival** → EventStore receives event → GiftWrapService detects new gift wrap
6. **Decrypt** (if auto-decrypt enabled) → Call `unlockGiftWrap(event, signer)`
7. **Extract Rumor** → Get kind 14 DM from gift wrap inner content
8. **Group into Conversations** → Compute conversation ID from participants → Update `conversations$` observable
9. **UI Update** → InboxViewer/ChatViewer re-renders with new messages

### Sending Messages (Outbox Flow)

1. **User Types Message** → ChatViewer captures content
2. **Resolve Recipients** → Nip17Adapter resolves pubkeys from identifiers
3. **Fetch Inbox Relays** → Get kind 10050 for each recipient (with 10s timeout)
4. **Validate Relays** → Block if any recipient has no inbox relays
5. **Create Rumor** → Build kind 14 unsigned event with content and tags
6. **Wrap for Each Recipient** → Create kind 1059 gift wrap for each recipient
7. **Publish** → Send to recipient's inbox relays via `hub.run(SendWrappedMessage)`
8. **Local Availability** → EventStore adds sent gift wraps → GiftWrapService processes → Messages appear in UI

## State Management

### Observable Streams

**GiftWrapService** exposes these observables:

- `giftWraps$` - All gift wrap events for current user
- `decryptStates$` - Map of gift wrap ID → decrypt status (pending/success/error)
- `decryptedRumors$` - All decrypted rumors (kind 14 and other kinds)
- `conversations$` - Grouped conversations (NIP-17 kind 14 only)
- `inboxRelays$` - User's inbox relays from kind 10050
- `settings$` - Inbox settings (enabled, autoDecrypt)
- `syncStatus$` - Current sync state (idle/syncing/error/disabled)
- `pendingCount$` - Count of pending decryptions for UI badge

### Lifecycle

**Init** (when user enables inbox sync):
```typescript
giftWrapService.init(pubkey, signer)
  1. Check if enabled (early return if disabled for performance)
  2. Load persisted encrypted content IDs from Dexie
  3. Wait for cache readiness (prevents race condition)
  4. Subscribe to user's kind 10050 (inbox relays)
  5. Load stored gift wraps from Dexie into EventStore
  6. Subscribe to EventStore timeline for real-time updates
  7. Open persistent relay subscription for new gift wraps
```

**Cleanup** (on account logout or disable):
```typescript
giftWrapService.cleanup()
  1. Unsubscribe from all observables
  2. Close relay subscription
  3. Clear in-memory state
```

**Performance Note**: Init is only called when user explicitly enables inbox sync via InboxViewer toggle. This prevents automatic network requests and heavy I/O operations on login.

## Cache Strategy

### Encrypted Content Persistence

**Problem**: Decrypting gift wraps on every page load is slow and redundant.

**Solution**: Applesauce automatically persists decrypted rumors to Dexie:
- `encryptedContent` table stores gift wrap ID → plaintext rumor JSON
- `persistedIds` Set tracks which gift wraps have cached content
- On reload, check `persistedIds` before marking as "pending"

**Cache Readiness Check**:
- Wait for Dexie to be accessible before processing conversations
- Prevents race condition where `persistedIds` says "unlocked" but `getGiftWrapRumor()` returns `null`
- Max 1 second wait with exponential backoff

### Synthetic Events

**Problem**: Rumors are unsigned events (no `sig` field), need to be converted to `NostrEvent` for UI rendering.

**Solution**: EventStore as single source of truth:
- Convert rumors to synthetic `NostrEvent` with empty `sig` field
- Check `eventStore.database.getEvent(rumor.id)` before creating (O(1) lookup)
- Add to EventStore which handles deduplication automatically by event ID
- No additional cache needed - EventStore provides fast lookups and deduplication

## Security Considerations

### Inbox Relay Validation

**Design Philosophy**: Separate viewing from sending.

**Viewing Messages** (Always Allowed):
- Conversations can be created even without recipient relay lists
- Received messages are already in your inbox - no relay list needed to view them
- This allows reading existing messages while relay lists are being fetched

**Sending Messages** (Requires Relay Lists):
1. Fetch inbox relays with 10s timeout
2. Flag unreachable participants in conversation metadata
3. Block `sendMessage()` if ANY recipient has no inbox relays
4. Show UI warnings:
   - Yellow banner: "View-only: Cannot send messages until participants publish inbox relays"
   - Disabled composer: "Sending disabled - waiting for relay lists"

**Benefits**:
- No "conversation failed to load" errors when relay lists are slow
- Users can immediately see existing message history
- Clear UI feedback about why sending is blocked
- Relay lists can be fetched in background without blocking UI

### On-Demand Inbox Sync

**Default**: Inbox sync is **disabled** on login for optimal performance.

**Rationale**: Prevents automatic network requests and heavy I/O operations on login. Users must explicitly enable inbox sync to receive DMs.

**User Control**:
- Enable/disable inbox sync via toggle in InboxViewer
- Configure auto-decrypt behavior in settings
- Service initializes only when explicitly enabled

### Relay List Privacy

**Inbox Relays (kind 10050)**: Published to user's **outbox relays** for discoverability.
- Anyone can query your inbox relays to send you DMs
- This is by design per NIP-17 spec
- Users control which relays are in their inbox list

## Performance Optimizations

### Parallel Relay Fetching

When starting conversation with multiple participants:
```typescript
const results = await Promise.all(
  others.map(async (pubkey) => ({
    pubkey,
    relays: await fetchInboxRelays(pubkey),
  })),
);
```

### Aggressive Relay Coverage

When fetching inbox relays for a pubkey:
1. Check EventStore cache (100ms timeout)
2. Check RelayListCache
3. Query **ALL** participant's write relays + **ALL** aggregators
4. 10s timeout with error handling

Rationale: Better to over-fetch than silently fail to reach someone.

### Efficient Conversation Grouping

Conversations grouped by **sorted participant pubkeys** (stable ID):
```typescript
function computeConversationId(participants: string[]): string {
  const sorted = [...participants].sort();
  return `nip17:${sorted.join(",")}`;
}
```

This ensures:
- 1-on-1 conversation with Alice always has same ID
- Group conversations identified by full participant set
- Self-chat has single-participant ID

## Debugging

### Enable Verbose Logging

```javascript
// In browser console
localStorage.setItem('grimoire:debug:dms', 'true')
location.reload()

// To disable
localStorage.removeItem('grimoire:debug:dms')
location.reload()
```

### What Gets Logged (Debug Mode)

- Gift wrap arrival and processing
- Decryption attempts and results
- Inbox relay fetching and caching
- Conversation grouping updates
- Relay subscription events
- Cache restoration

### What's Always Logged

- Warnings (relay fetch failures, missing inbox relays)
- Errors (decryption failures, send failures)
- Info (loading stored gift wraps, important state changes)

## Testing Strategy

### Unit Tests

**gift-wrap.ts**:
- Cache readiness check logic
- Conversation grouping algorithm
- Decrypt state management

**nip-17-adapter.ts**:
- Identifier parsing (npub, nprofile, NIP-05, $me)
- Inbox relay fetching with timeout
- Conversation resolution with relay validation
- Synthetic event creation and caching

### Integration Tests

**E2E Message Flow**:
1. Alice sends message to Bob
2. Verify gift wrap created and published
3. Verify Bob's inbox subscription receives event
4. Verify auto-decrypt (if enabled)
5. Verify conversation appears in Bob's inbox
6. Verify Bob can reply

**Self-Chat Flow**:
1. Alice sends message to self
2. Verify single gift wrap created
3. Verify published to own inbox relays
4. Verify appears in "Saved Messages"
5. Verify cross-device sync (same message on mobile)

## Future Improvements

### Reliability
- [ ] Retry failed decryptions with exponential backoff
- [ ] Detect relay failures and switch to alternates
- [ ] Implement message queuing for offline sends
- [ ] Add delivery receipts (NIP-17 extension)

### Performance
- [ ] Lazy load old messages (pagination)
- [ ] Virtual scrolling for large conversations
- [ ] Background sync for message fetching
- [ ] Optimize Dexie queries with indexes

### Features
- [ ] Message editing/deletion (NIP-09)
- [ ] Rich media attachments (NIP-94/96)
- [ ] Group chat management (add/remove participants)
- [ ] Message search across conversations
- [ ] Export conversation history

### Architecture
- [ ] Refactor to dependency injection pattern
- [ ] Split GiftWrapService into smaller services
- [ ] Create dedicated ConversationManager
- [ ] Implement proper event sourcing for state management
