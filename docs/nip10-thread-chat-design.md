# NIP-10 Thread Chat Design

## Overview

Support `chat nevent1...` / `chat note1...` to treat NIP-10 threaded conversations as chat interfaces. The conversation revolves around the thread root event, with all replies displayed as chat messages.

## User Experience

### Command

```bash
chat nevent1qqsxyz...    # Open thread as chat
chat note1abc...         # Open thread as chat (converts to nevent internally)
```

### Visual Layout

```
┌─────────────────────────────────────┐
│ [Root Event Title or Truncated]    │ ← Header (conversation title)
├─────────────────────────────────────┤
│                                     │
│     ┌──────────────────────┐       │
│     │   ROOT EVENT         │       │ ← Centered, full feed renderer
│     │   (feed renderer)    │       │   (BaseEventContainer, actions, etc.)
│     └──────────────────────┘       │
│                                     │
│ ──────────────────────────────────  │ ← Separator
│                                     │
│ Alice: Hey, what do you think?     │ ← Replies as chat messages
│   └─ ↳ root                        │   (show what they're replying to)
│                                     │
│ Bob: I agree with Alice!           │
│   └─ ↳ Alice                       │
│                                     │
│ ⚡ 1000 Alice                       │ ← Zaps as special messages
│                                     │
│ [──────────────────]  [Send]       │ ← Composer
└─────────────────────────────────────┘
```

## Architecture

### 1. Protocol Identifier

**New type in `src/types/chat.ts`**:

```typescript
/**
 * NIP-10 thread identifier (kind 1 note thread)
 */
export interface ThreadIdentifier {
  type: "thread";
  /** Event pointer to the provided event (may be root or a reply) */
  value: EventPointer;
  /** Relay hints from nevent encoding */
  relays?: string[];
}
```

Update `ProtocolIdentifier` union:
```typescript
export type ProtocolIdentifier =
  | GroupIdentifier
  | LiveActivityIdentifier
  | DMIdentifier
  | NIP05Identifier
  | ChannelIdentifier
  | GroupListIdentifier
  | ThreadIdentifier;  // ← Add this
```

Update `ChatProtocol` type:
```typescript
export type ChatProtocol =
  | "nip-c7"
  | "nip-17"
  | "nip-28"
  | "nip-29"
  | "nip-53"
  | "nip-10";  // ← Add this
```

### 2. Chat Parser

**Update `src/lib/chat-parser.ts`**:

```typescript
import { Nip10Adapter } from "./chat/adapters/nip-10-adapter";

export function parseChatCommand(args: string[]): ChatCommandResult {
  // ... existing code ...

  // Try each adapter in priority order
  const adapters = [
    new Nip10Adapter(),  // ← Add before others (to catch nevent/note)
    new Nip29Adapter(),
    new Nip53Adapter(),
  ];

  // ... rest of function ...
}
```

### 3. NIP-10 Adapter

**New file: `src/lib/chat/adapters/nip-10-adapter.ts`**

#### Core Methods

**`parseIdentifier(input: string)`**:
- Match `nevent1...` or `note1...` strings
- Decode to EventPointer
- Return ThreadIdentifier if kind 1 or unknown kind
- Return null for other kinds (let other adapters handle)

**`resolveConversation(identifier: ThreadIdentifier)`**:
1. Fetch provided event from relays
2. If kind ≠ 1, throw error
3. Parse NIP-10 references with `getNip10References(event)`
4. Find root event:
   - If `refs.root` exists: fetch root event
   - Else: provided event IS the root
5. Determine conversation relays (see Relay Strategy below)
6. Extract title from root content (first line or truncate to ~50 chars)
7. Build participants list from all p-tags in thread
8. Return Conversation object

**`loadMessages(conversation: Conversation)`**:
1. Subscribe to:
   - All kind 1 replies (e-tags pointing to root)
   - All kind 7 reactions (e-tags pointing to root or replies)
   - All kind 9735 zaps (e-tags pointing to root or replies)
2. Convert events to Message objects:
   - Parse NIP-10 references to determine reply hierarchy
   - For direct replies to root: `replyTo = root.id`
   - For nested replies: `replyTo = refs.reply.e?.id`
   - Zaps: extract amount, sender, recipient from zap event
3. Return Observable<Message[]> sorted by created_at

**`loadMoreMessages(conversation: Conversation, before: number)`**:
- Same filter as loadMessages but with `until: before`
- One-shot request for pagination

**`sendMessage(conversation: Conversation, content: string, options?)`**:
1. Create kind 1 event
2. Add NIP-10 tags:
   - Root tag: `["e", rootId, rootRelay, "root", rootAuthor]`
   - Reply tag (if replying to a reply): `["e", parentId, parentRelay, "reply", parentAuthor]`
   - If replying directly to root: only root tag
3. Add p-tags:
   - Root author
   - Parent author (if different)
   - All authors mentioned in parent event
4. Add emoji tags (NIP-30) if provided
5. Add imeta tags (NIP-92) for attachments
6. Publish to conversation relays

**`sendReaction(conversation: Conversation, messageId: string, emoji: string)`**:
1. Create kind 7 event
2. Add tags:
   - `["e", messageId]` - event being reacted to
   - `["k", "1"]` - kind of event being reacted to
   - `["p", messageAuthor]` - author of message
3. Add NIP-30 custom emoji tag if provided
4. Publish to conversation relays

**`loadReplyMessage(conversation: Conversation, eventId: string)`**:
- Check EventStore first
- If not found, fetch from conversation relays
- Return NostrEvent or null

**`getCapabilities()`**:
```typescript
return {
  supportsEncryption: false,
  supportsThreading: true,
  supportsModeration: false,
  supportsRoles: false,
  supportsGroupManagement: false,
  canCreateConversations: false,
  requiresRelay: false,
};
```

#### Relay Strategy

Determine relays using this priority:

1. **Root event relays** (from `eventStore` seen relays)
2. **Provided event relays** (from nevent relay hints)
3. **Root author outbox** (kind 10002 relay list)
4. **Active user's inbox** (for receiving replies)

Merge all sources, deduplicate, limit to top 5-7 relays.

Implementation:
```typescript
async function getThreadRelays(
  rootEvent: NostrEvent,
  providedEvent: NostrEvent,
  providedRelays: string[] = []
): Promise<string[]> {
  const relays = new Set<string>();

  // 1. Seen relays from EventStore
  const rootSeenRelays = eventStore.getSeenRelays?.(rootEvent.id) || [];
  rootSeenRelays.forEach(r => relays.add(normalizeURL(r)));

  // 2. Provided event hints
  providedRelays.forEach(r => relays.add(normalizeURL(r)));

  // 3. Root author's outbox relays
  const rootOutbox = await getOutboxRelays(rootEvent.pubkey);
  rootOutbox.slice(0, 3).forEach(r => relays.add(normalizeURL(r)));

  // 4. Active user's outbox/inbox (for publishing replies)
  const activePubkey = accountManager.active$.value?.pubkey;
  if (activePubkey) {
    const userOutbox = await getOutboxRelays(activePubkey);
    userOutbox.slice(0, 2).forEach(r => relays.add(normalizeURL(r)));
  }

  // Limit to 7 relays max
  return Array.from(relays).slice(0, 7);
}
```

#### Event to Message Conversion

```typescript
private eventToMessage(
  event: NostrEvent,
  conversationId: string,
  rootId: string
): Message {
  if (event.kind === 9735) {
    // Zap receipt
    return this.zapToMessage(event, conversationId, rootId);
  }

  // Kind 1 reply
  const refs = getNip10References(event);

  // Determine reply target
  let replyTo: string | undefined;
  if (refs.reply?.e) {
    replyTo = refs.reply.e.id;  // Replying to another reply
  } else if (refs.root?.e) {
    replyTo = refs.root.e.id;   // Replying to root
  }

  return {
    id: event.id,
    conversationId,
    author: event.pubkey,
    content: event.content,
    timestamp: event.created_at,
    type: "user",
    replyTo,
    protocol: "nip-10",
    metadata: {
      encrypted: false,
    },
    event,
  };
}

private zapToMessage(
  zapReceipt: NostrEvent,
  conversationId: string,
  rootId: string
): Message {
  const zapRequest = getZapRequest(zapReceipt);
  const amount = getZapAmount(zapReceipt);
  const sender = getZapSender(zapReceipt);
  const recipient = getZapRecipient(zapReceipt);

  // Find what event is being zapped (from e-tag in zap receipt)
  const eTag = zapReceipt.tags.find(t => t[0] === "e");
  const replyTo = eTag?.[1];

  // Get comment from zap request
  const comment = zapRequest?.content || "";

  return {
    id: zapReceipt.id,
    conversationId,
    author: sender || zapReceipt.pubkey,
    content: comment,
    timestamp: zapReceipt.created_at,
    type: "zap",
    replyTo,
    protocol: "nip-10",
    metadata: {
      zapAmount: amount,
      zapRecipient: recipient,
    },
    event: zapReceipt,
  };
}
```

### 4. ChatViewer Changes

**Update `src/components/ChatViewer.tsx`**:

Add special rendering mode for NIP-10 threads:

```typescript
export function ChatViewer({
  protocol,
  identifier,
  customTitle,
  headerPrefix,
}: ChatViewerProps) {
  // ... existing code ...

  // Check if this is a NIP-10 thread
  const isThreadChat = protocol === "nip-10";

  // Fetch root event for thread display
  const rootEventId = conversation?.metadata?.rootEventId;
  const rootEvent = use$(
    () => rootEventId ? eventStore.event(rootEventId) : undefined,
    [rootEventId]
  );

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="pl-2 pr-0 border-b w-full py-0.5">
        {/* ... existing header ... */}
      </div>

      {/* Message timeline */}
      <div className="flex-1 overflow-hidden">
        {/* NIP-10 Thread: Show root event at top */}
        {isThreadChat && rootEvent && (
          <div className="border-b bg-muted/20">
            <div className="max-w-2xl mx-auto py-4 px-3">
              <KindRenderer event={rootEvent} depth={0} />
            </div>
            <div className="h-px bg-border" />
          </div>
        )}

        {/* Messages list (scrollable) */}
        {messagesWithMarkers && messagesWithMarkers.length > 0 ? (
          <Virtuoso
            // ... existing virtuoso config ...
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            {isThreadChat
              ? "No replies yet. Start the conversation!"
              : "No messages yet. Start the conversation!"}
          </div>
        )}
      </div>

      {/* Composer */}
      {canSign ? (
        <div className="border-t px-2 py-1 pb-0">
          {/* ... existing composer ... */}
        </div>
      ) : (
        <div className="border-t px-3 py-2 text-center text-sm text-muted-foreground">
          Sign in to reply
        </div>
      )}
    </div>
  );
}
```

### 5. Conversation Metadata

**Update `ConversationMetadata` in `src/types/chat.ts`**:

```typescript
export interface ConversationMetadata {
  // ... existing fields ...

  // NIP-10 thread
  rootEventId?: string;       // Thread root event ID
  providedEventId?: string;   // Original event from nevent (may be reply)
  threadDepth?: number;       // Approximate depth of thread
}
```

### 6. Reply Preview Updates

**Update `src/components/chat/ReplyPreview.tsx`**:

Current implementation already supports showing replied-to messages. For NIP-10 threads, we need to:

1. Show "↳ root" when replying directly to root
2. Show "↳ username" when replying to another reply
3. Fetch events from thread relays

This should mostly work with existing code, but we can enhance the display:

```typescript
export const ReplyPreview = memo(function ReplyPreview({
  replyToId,
  adapter,
  conversation,
  onScrollToMessage,
}: ReplyPreviewProps) {
  const replyEvent = use$(() => eventStore.event(replyToId), [replyToId]);

  // For NIP-10 threads, check if replying to root
  const isRoot = conversation.metadata?.rootEventId === replyToId;

  // ... existing fetch logic ...

  if (!replyEvent) {
    return (
      <div className="text-xs text-muted-foreground mb-0.5">
        ↳ Replying to {isRoot ? "thread root" : replyToId.slice(0, 8)}...
      </div>
    );
  }

  return (
    <div
      className="text-xs text-muted-foreground flex items-baseline gap-1 mb-0.5 overflow-hidden cursor-pointer hover:text-foreground transition-colors"
      onClick={handleClick}
      title="Click to scroll to message"
    >
      <span className="flex-shrink-0">↳</span>
      {isRoot ? (
        <span className="font-medium">thread root</span>
      ) : (
        <UserName pubkey={replyEvent.pubkey} className="font-medium flex-shrink-0" />
      )}
      <div className="line-clamp-1 overflow-hidden flex-1 min-w-0">
        <RichText
          event={replyEvent}
          options={{ showMedia: false, showEventEmbeds: false }}
        />
      </div>
    </div>
  );
});
```

### 7. Message Context Menu

NIP-10 threads should support:
- Copy event ID / nevent
- Copy raw JSON
- Open in new window
- Quote (copy with > prefix)
- **View full thread** (new action - opens `chat nevent` for this message)

This can be added to existing `ChatMessageContextMenu` component.

## Implementation Checklist

### Phase 1: Core Infrastructure
- [ ] Add `ThreadIdentifier` to `src/types/chat.ts`
- [ ] Add `"nip-10"` to `ChatProtocol` type
- [ ] Update `ConversationMetadata` with thread fields
- [ ] Create `src/lib/chat/adapters/nip-10-adapter.ts` skeleton

### Phase 2: Identifier Parsing
- [ ] Implement `parseIdentifier()` for nevent/note
- [ ] Add Nip10Adapter to chat-parser.ts
- [ ] Test with various nevent formats

### Phase 3: Conversation Resolution
- [ ] Implement `resolveConversation()`:
  - [ ] Fetch provided event
  - [ ] Find root event via NIP-10 refs
  - [ ] Determine conversation relays
  - [ ] Extract title and participants
- [ ] Test with root events and reply events

### Phase 4: Message Loading
- [ ] Implement `loadMessages()`:
  - [ ] Subscribe to replies (kind 1)
  - [ ] Subscribe to reactions (kind 7)
  - [ ] Subscribe to zaps (kind 9735)
  - [ ] Convert to Message objects
- [ ] Implement `loadMoreMessages()` for pagination
- [ ] Test with threads of varying sizes

### Phase 5: Message Sending
- [ ] Implement `sendMessage()`:
  - [ ] Build NIP-10 tags (root + reply)
  - [ ] Add p-tags for participants
  - [ ] Support emoji tags
  - [ ] Support imeta attachments
- [ ] Implement `sendReaction()`
- [ ] Test reply hierarchy

### Phase 6: UI Integration
- [ ] Update ChatViewer for thread mode:
  - [ ] Render root event at top (centered)
  - [ ] Add separator between root and replies
  - [ ] Adjust composer placeholder
- [ ] Update ReplyPreview for "thread root" display
- [ ] Test visual layout

### Phase 7: Polish
- [ ] Add loading states
- [ ] Add error handling
- [ ] Add "View full thread" context menu action
- [ ] Update help text in chat-parser error
- [ ] Write tests
- [ ] Update CLAUDE.md documentation

## Edge Cases

1. **Provided event is deleted**: Show error, can't resolve thread
2. **Root event not found**: Treat provided event as root
3. **Very deep threads** (>100 replies): Pagination should handle this
4. **Multiple roots claimed**: Trust marked e-tags, fallback to first e-tag
5. **Mixed protocols**: nevent might point to kind 9 (NIP-29) - let Nip29Adapter handle
6. **No relay hints**: Use fallback relay strategy (author outbox + user outbox)
7. **Private relays**: May fail to fetch - show "unable to load thread" error
8. **Quote reposts vs replies**: NIP-10 doesn't distinguish - treat all e-tags as replies

## Testing Strategy

### Unit Tests
- `nip-10-adapter.test.ts`:
  - parseIdentifier with various formats
  - eventToMessage conversion
  - NIP-10 tag building for replies

### Integration Tests
- Resolve conversation from root event
- Resolve conversation from reply event
- Load messages with reactions and zaps
- Send reply with proper NIP-10 tags
- Pagination

### Manual Tests
- Open thread from root event
- Open thread from nested reply (should show full thread)
- Reply to root
- Reply to reply (test hierarchy)
- Send reaction and zap
- Load older messages
- Test with threads containing media, links, mentions

## Future Enhancements

1. **Thread tree view**: Option to show replies in tree structure instead of flat chat
2. **Smart relay selection**: Learn which relays have the most complete thread
3. **Thread health indicator**: Show "X/Y replies loaded" if some are missing
4. **Thread export**: Export thread as markdown or JSON
5. **Thread notifications**: Subscribe to new replies (NIP-XX)
6. **Threaded zaps**: Show zap amount on specific reply being zapped
7. **Quote highlighting**: When replying, highlight quoted text
8. **Draft persistence**: Save draft replies per thread

## Related NIPs

- **NIP-10**: Text note references (threading) - core spec
- **NIP-19**: bech32 encoding (nevent, note formats)
- **NIP-30**: Custom emoji
- **NIP-57**: Zaps
- **NIP-92**: Media attachments (imeta)

## Documentation Updates

Update `CLAUDE.md`:

```markdown
## Chat System

**Current Status**: NIP-10 (threaded notes), NIP-29 (relay groups), and NIP-53 (live chats) are supported.

### NIP-10 Thread Chat

Turn any kind 1 note thread into a chat interface:

```bash
chat nevent1qqsxyz...    # Open thread as chat
chat note1abc...         # Also works (converts to nevent)
```

**Format**: Thread root is displayed at top (centered, full feed renderer), all replies below as chat messages.

**Reply Handling**: Sends kind 1 events with proper NIP-10 markers (root + reply tags).

**Relay Selection**: Combines root event relays, provided hints, author outbox, and user outbox.
```

## Questions for Consideration

1. **Root event interactions**: Should users be able to react/zap the root event from the chat UI?
   - **Answer**: Yes, show actions bar on hover (same as feed renderer)

2. **Reply depth indicator**: Should we show visual threading (indentation) or keep flat?
   - **Answer**: Keep flat initially, add tree view as future enhancement

3. **Title length**: How to truncate root content for chat title?
   - **Answer**: First line OR truncate to 50 chars with "..." suffix

4. **Empty threads**: What if root has no replies?
   - **Answer**: Show root event + empty state "No replies yet"

5. **Cross-protocol**: Can NIP-10 thread include NIP-29 group messages?
   - **Answer**: No, strictly kind 1 events only

6. **Root event scrolling**: Should clicking "thread root" in reply preview scroll to top?
   - **Answer**: Yes, scroll to top (where root is displayed)
