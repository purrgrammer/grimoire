# NIP-10 Thread Chat - Quick Reference

## What It Is

Turn any kind 1 Nostr thread into a chat interface, with the root event displayed prominently at the top and all replies shown as chat messages below.

## Command Format

```bash
chat nevent1qqsxyz...    # Full nevent with relay hints
chat note1abc...         # Simple note ID (less reliable)
```

## Visual Comparison

### Before (Traditional Feed View)

```
┌─────────────────────────────────────┐
│ Alice: Check out this cool feature  │  ← Root event
│   [Like] [Repost] [Reply] [Zap]    │
├─────────────────────────────────────┤
│ Bob: Great idea!                    │  ← Reply (separate event)
│   [Like] [Repost] [Reply] [Zap]    │
├─────────────────────────────────────┤
│ Carol: I agree with Bob             │  ← Reply (separate event)
│   [Like] [Repost] [Reply] [Zap]    │
└─────────────────────────────────────┘
```

### After (Thread Chat View)

```
┌─────────────────────────────────────┐
│ 📌 Check out this cool feature...   │  ← Header (thread title)
├─────────────────────────────────────┤
│                                     │
│     ┌──────────────────────┐       │
│     │ Alice                │       │  ← Root event (centered)
│     │ Check out this       │       │    Full feed renderer
│     │ cool feature I built │       │    (can like, zap, etc.)
│     │ [Like] [Zap] [Share] │       │
│     └──────────────────────┘       │
│                                     │
│ ─────────── Replies ──────────────  │  ← Visual separator
│                                     │
│ Bob: Great idea!                   │  ← Replies as chat messages
│   └─ ↳ thread root                │     (simpler, chat-like)
│                                     │
│ Carol: I agree with Bob            │
│   └─ ↳ Bob                         │
│                                     │
│ ⚡ 1000 Alice                       │  ← Zaps inline
│                                     │
│ [Type a message...] 📎  [Send]     │  ← Chat composer
└─────────────────────────────────────┘
```

## Architecture Overview

```
┌────────────────────────────────────────────────────────┐
│                    User Input                          │
│              chat nevent1qqsxyz...                     │
└───────────────────────┬────────────────────────────────┘
                        │
                        ▼
┌────────────────────────────────────────────────────────┐
│             src/lib/chat-parser.ts                     │
│  Tries each adapter's parseIdentifier():               │
│    1. Nip10Adapter (nevent/note)  ← NEW               │
│    2. Nip29Adapter (relay'group)                       │
│    3. Nip53Adapter (naddr live chat)                   │
└───────────────────────┬────────────────────────────────┘
                        │
                        ▼
┌────────────────────────────────────────────────────────┐
│     src/lib/chat/adapters/nip-10-adapter.ts  ← NEW    │
│                                                        │
│  parseIdentifier(input)                               │
│    • Match nevent/note format                         │
│    • Decode to EventPointer                           │
│    • Return ThreadIdentifier                          │
│                                                        │
│  resolveConversation(identifier)                      │
│    • Fetch provided event                             │
│    • Parse NIP-10 refs → find root                    │
│    • Determine relays (merge sources)                 │
│    • Extract title from root                          │
│    • Return Conversation                              │
│                                                        │
│  loadMessages(conversation)                           │
│    • Subscribe: kind 1 replies                        │
│    • Subscribe: kind 7 reactions                      │
│    • Subscribe: kind 9735 zaps                        │
│    • Convert to Message[]                             │
│    • Return Observable                                │
│                                                        │
│  sendMessage(conversation, content, options)          │
│    • Build NIP-10 tags (root + reply markers)         │
│    • Add p-tags for participants                      │
│    • Create kind 1 event                              │
│    • Publish to conversation relays                   │
└───────────────────────┬────────────────────────────────┘
                        │
                        ▼
┌────────────────────────────────────────────────────────┐
│          src/components/ChatViewer.tsx                 │
│                                                        │
│  Detects: protocol === "nip-10"                       │
│                                                        │
│  Special rendering:                                    │
│    • Fetch rootEventId from conversation.metadata     │
│    • Render root with KindRenderer (centered)         │
│    • Show visual separator                            │
│    • Render replies as chat messages below            │
│    • Chat composer at bottom                          │
└────────────────────────────────────────────────────────┘
```

## Key Differences from Other Chat Protocols

| Feature | NIP-29 Groups | NIP-53 Live Chat | **NIP-10 Threads (NEW)** |
|---------|---------------|------------------|---------------------------|
| **Event Kind** | 9 | 1311 | **1** |
| **Reply Tag** | q-tag | q-tag | **e-tag with markers** |
| **Root Display** | ❌ No root | ❌ No root | **✅ Root at top** |
| **Relay Model** | Single relay | Multiple relays | **Multiple relays** |
| **Membership** | Admin approval | Open | **Open** |
| **Protocol** | nip-29 | nip-53 | **nip-10** |
| **Identifier** | `relay'group` | `naddr1...` | **`nevent1...`** |
| **Use Case** | Private groups | Live streams | **Twitter threads** |

## NIP-10 Tag Structure Comparison

### Direct Reply to Root (Kind 1)

```javascript
{
  kind: 1,
  content: "Great point!",
  tags: [
    ["e", "<root-id>", "<relay>", "root", "<root-author>"],
    ["p", "<root-author>"]
  ]
}
```

### Nested Reply (Kind 1)

```javascript
{
  kind: 1,
  content: "I agree with Alice!",
  tags: [
    ["e", "<root-id>", "<relay>", "root", "<root-author>"],     // Thread root
    ["e", "<alice-msg-id>", "<relay>", "reply", "<alice-pk>"],  // Direct parent
    ["p", "<root-author>"],
    ["p", "<alice-pk>"]
  ]
}
```

### NIP-29 Group Message (Kind 9) - For Comparison

```javascript
{
  kind: 9,
  content: "Hello group!",
  tags: [
    ["h", "<group-id>"],                      // Group identifier
    ["q", "<parent-msg-id>"]                  // Simple reply (if replying)
  ]
}
```

## Relay Selection Strategy

NIP-10 threads use **merged relay sources** for maximum reach:

```
1. Root Event Seen Relays (from EventStore)
   └─ Where the root was originally found

2. Provided Event Relay Hints (from nevent)
   └─ User-specified relays in the nevent encoding

3. Root Author's Outbox (NIP-65 kind 10002)
   └─ Where the root author publishes

4. Active User's Outbox (NIP-65 kind 10002)
   └─ Where current user publishes

5. Fallback Popular Relays (if < 3 found)
   └─ relay.damus.io, nos.lol, relay.nostr.band

Result: Top 5-7 relays (deduplicated, normalized)
```

## Data Flow

### Loading a Thread

```
1. User: chat nevent1qqsxyz...
   │
   ▼
2. Parse nevent → EventPointer
   │
   ▼
3. Fetch event xyz
   │
   ├─ Is it kind 1? ✓
   │
   ▼
4. Parse NIP-10 references
   │
   ├─ Has root marker? → Fetch root event
   └─ No root marker? → xyz IS the root
   │
   ▼
5. Determine relays
   │
   ├─ Merge: seen, hints, outbox
   │
   ▼
6. Subscribe to thread events
   │
   ├─ kind 1 with #e = root.id
   ├─ kind 7 with #e = root.id
   └─ kind 9735 with #e = root.id
   │
   ▼
7. Convert events → Messages
   │
   ├─ Parse reply hierarchy
   ├─ Extract zap amounts
   └─ Sort chronologically
   │
   ▼
8. Render UI
   │
   ├─ Root event (centered, feed renderer)
   ├─ Visual separator
   └─ Replies (chat messages)
```

### Sending a Reply

```
1. User types: "Great idea!"
   │
   ▼
2. User clicks Reply on Alice's message
   │
   ▼
3. Adapter.sendMessage(conversation, content, { replyTo: alice.id })
   │
   ▼
4. Build tags:
   │
   ├─ ["e", root.id, relay, "root", root.author]
   ├─ ["e", alice.id, relay, "reply", alice.pk]
   ├─ ["p", root.author]
   └─ ["p", alice.pk]
   │
   ▼
5. Create kind 1 event
   │
   ▼
6. Publish to conversation relays
   │
   ├─ relay.damus.io
   ├─ nos.lol
   └─ root.author's outbox
   │
   ▼
7. Event propagates
   │
   ▼
8. Subscription receives event
   │
   ▼
9. UI updates (new message appears)
```

## Implementation Files

### New Files (to be created)

```
src/lib/chat/adapters/nip-10-adapter.ts
  └─ Full adapter implementation (~600 lines)

src/lib/chat/adapters/nip-10-adapter.test.ts
  └─ Unit tests for adapter

docs/nip10-thread-chat-design.md
  └─ Detailed design spec

docs/nip10-thread-chat-examples.md
  └─ Code examples

docs/nip10-thread-chat-summary.md
  └─ This file
```

### Modified Files

```
src/types/chat.ts
  ├─ Add ThreadIdentifier type
  ├─ Add "nip-10" to ChatProtocol
  └─ Add rootEventId to ConversationMetadata

src/lib/chat-parser.ts
  ├─ Import Nip10Adapter
  └─ Add to adapter priority list

src/components/ChatViewer.tsx
  ├─ Detect isThreadChat = protocol === "nip-10"
  ├─ Fetch rootEvent from metadata
  ├─ Render root with KindRenderer (centered)
  └─ Show visual separator

src/components/chat/ReplyPreview.tsx
  └─ Show "thread root" when replying to root

CLAUDE.md
  └─ Document NIP-10 thread chat usage
```

## Usage Examples

### Example 1: Opening Thread from Twitter-like Feed

```bash
# User sees interesting post in feed (kind 1 note)
# Clicks "View as Thread" button
# App extracts event pointer
chat nevent1qqsrz7x...

# Result: Opens thread chat with:
# - Root post at top (full renderer with actions)
# - All replies as chat messages below
# - Reply composer at bottom
```

### Example 2: Opening Thread from Deep Reply

```bash
# User is reading a reply deep in a thread
# Clicks "View Thread" context menu
chat nevent1qqsabc...   # This is a nested reply, not root

# Adapter logic:
# 1. Fetch event abc
# 2. Parse NIP-10 refs → finds root XYZ
# 3. Fetch root event XYZ
# 4. Resolve conversation with root XYZ
# 5. Load all replies to XYZ
# 6. Display full thread (not just from abc onward)
```

### Example 3: Replying in Thread

```
Thread Chat Interface:

┌──────────────────────────────────┐
│  [Root Event by Alice]           │  User can interact with root
│    42 ⚡  18 ♥  3 💬             │  (zap, like, etc.)
├──────────────────────────────────┤
│                                  │
│  Bob: Great point!               │  ← Hover shows Reply button
│    └─ ↳ thread root             │
│                                  │
│  Carol: I agree                  │  ← Click Reply here
│    └─ ↳ Bob                     │
│                                  │
└──────────────────────────────────┘
   ↓
┌──────────────────────────────────┐
│  [Replying to Carol]             │  ← Reply preview shows
│  Type message...          [Send] │
└──────────────────────────────────┘
   ↓ User types "Me too!"
   ↓ Clicks Send
   ↓
Publishes kind 1 with:
  ["e", rootId, relay, "root", alice]     # Thread root
  ["e", carolId, relay, "reply", carol]   # Direct parent
  ["p", alice]                             # Root author
  ["p", carol]                             # Parent author
  ["p", bob]                               # Mentioned in parent
```

## Benefits

### For Users
- **Focused discussion**: See entire thread in one view
- **Better context**: Root always visible at top
- **Faster replies**: Chat-like composer instead of feed actions
- **Real-time**: New replies appear instantly (subscription)
- **Cross-client**: Works with any NIP-10 compliant client

### For Developers
- **Reuses infrastructure**: Same ChatViewer, just different adapter
- **Protocol-agnostic UI**: Adapter pattern abstracts differences
- **Testable**: Unit tests for adapter, integration tests for UI
- **Extensible**: Easy to add features (threading UI, export, etc.)

## Limitations & Trade-offs

### Limitations
1. **Kind 1 only**: Doesn't work with other event kinds
2. **No encryption**: All messages public (NIP-10 has no encryption)
3. **No moderation**: Can't delete/hide replies (not in NIP-10)
4. **Relay dependent**: Need good relay coverage to see all replies
5. **No real-time guarantees**: Relies on relay subscriptions

### Trade-offs
- **Simplicity vs Features**: Chat UI sacrifices some feed features (repost, quote, etc.)
- **Performance vs Completeness**: Limit to 7 relays for speed (might miss some replies)
- **UX vs Protocol**: Showing root separately breaks chronological order slightly

## Future Enhancements

1. **Thread Tree View**: Toggle between flat chat and tree structure
2. **Thread Statistics**: "X replies from Y participants"
3. **Smart Relay Discovery**: Learn which relays have full thread
4. **Missing Reply Detection**: "Some replies may be missing" indicator
5. **Thread Export**: Save thread as markdown/JSON
6. **Quote Highlighting**: Visual indication of quoted text
7. **Thread Branching**: Show sub-threads that diverge
8. **Participant Indicators**: Show who's been most active

## FAQ

**Q: What happens if I open a nevent for a kind 9 (group message)?**
A: Nip10Adapter returns null, Nip29Adapter handles it instead.

**Q: Can I reply to the root event from the chat?**
A: Yes! Click the Reply button that appears on hover on the root event display.

**Q: What if the root event is deleted?**
A: Adapter throws error "Thread root not found" - cannot display thread.

**Q: Do reactions work?**
A: Yes! Reactions (kind 7) are subscribed to and shown inline via MessageReactions component.

**Q: Can I zap messages in the thread?**
A: Yes! Zaps (kind 9735) are shown as special chat messages with ⚡ indicator.

**Q: What if relays are slow/offline?**
A: EventStore caches events. If relay is offline, cached events still display. New replies won't arrive until relay reconnects.

**Q: How is this different from opening the note in the feed?**
A: Thread chat provides focused, conversation-centric view with root prominent and chat-like UI. Feed view is more action-oriented (repost, quote, etc.).

**Q: Can I use this for group discussions?**
A: It works, but NIP-29 groups are better for persistent communities. NIP-10 threads are ad-hoc, thread-specific.

**Q: Does it support polls/forms/etc?**
A: No, only text replies (kind 1). Other kinds ignored.

## References

- [NIP-10: Text Note References](https://github.com/nostr-protocol/nips/blob/master/10.md)
- [NIP-19: bech32 Encoding](https://github.com/nostr-protocol/nips/blob/master/19.md)
- [NIP-65: Relay List Metadata](https://github.com/nostr-protocol/nips/blob/master/65.md)
- [Grimoire Chat System Docs](../CLAUDE.md#chat-system)
