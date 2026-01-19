# NIP-10 Thread Chat - Implementation Examples

This document provides concrete code examples for implementing NIP-10 thread chat support.

## Example 1: Parsing nevent/note Identifiers

```typescript
// src/lib/chat/adapters/nip-10-adapter.ts

import { nip19 } from "nostr-tools";
import type { EventPointer } from "applesauce-core/helpers";
import type { ProtocolIdentifier, ThreadIdentifier } from "@/types/chat";

parseIdentifier(input: string): ProtocolIdentifier | null {
  // Try note format first (simpler)
  if (input.startsWith("note1")) {
    try {
      const decoded = nip19.decode(input);
      if (decoded.type === "note") {
        const eventId = decoded.data;
        return {
          type: "thread",
          value: { id: eventId },
          relays: [],
        };
      }
    } catch {
      return null;
    }
  }

  // Try nevent format (includes relay hints)
  if (input.startsWith("nevent1")) {
    try {
      const decoded = nip19.decode(input);
      if (decoded.type === "nevent") {
        const { id, relays, author, kind } = decoded.data;

        // If kind is specified and NOT kind 1, let other adapters handle
        if (kind !== undefined && kind !== 1) {
          return null;
        }

        return {
          type: "thread",
          value: { id, relays, author, kind },
          relays: relays || [],
        };
      }
    } catch {
      return null;
    }
  }

  return null;
}
```

## Example 2: Resolving Thread Conversation

```typescript
// src/lib/chat/adapters/nip-10-adapter.ts

async resolveConversation(
  identifier: ProtocolIdentifier,
): Promise<Conversation> {
  if (identifier.type !== "thread") {
    throw new Error(`NIP-10 adapter cannot handle identifier type: ${identifier.type}`);
  }

  const pointer = identifier.value;
  const relayHints = identifier.relays || [];

  console.log(`[NIP-10] Fetching event ${pointer.id.slice(0, 8)}...`);

  // 1. Fetch the provided event
  const providedEvent = await this.fetchEvent(pointer.id, relayHints);
  if (!providedEvent) {
    throw new Error("Event not found");
  }

  if (providedEvent.kind !== 1) {
    throw new Error(`Expected kind 1 note, got kind ${providedEvent.kind}`);
  }

  // 2. Parse NIP-10 references to find root
  const refs = getNip10References(providedEvent);
  let rootEvent: NostrEvent;
  let rootId: string;

  if (refs.root?.e) {
    // This is a reply - fetch the root
    rootId = refs.root.e.id;
    console.log(`[NIP-10] Fetching root event ${rootId.slice(0, 8)}...`);

    const rootPointer: EventPointer = {
      id: rootId,
      relays: refs.root.e.relays,
      author: refs.root.e.author,
    };

    const fetchedRoot = await this.fetchEvent(rootId, rootPointer.relays);
    if (!fetchedRoot) {
      throw new Error("Thread root not found");
    }
    rootEvent = fetchedRoot;
  } else {
    // No root reference - this IS the root
    rootEvent = providedEvent;
    rootId = providedEvent.id;
    console.log(`[NIP-10] Provided event is the root`);
  }

  // 3. Determine conversation relays
  const conversationRelays = await this.getThreadRelays(
    rootEvent,
    providedEvent,
    relayHints,
  );

  console.log(`[NIP-10] Using ${conversationRelays.length} relays:`, conversationRelays);

  // 4. Extract title from root content
  const title = this.extractTitle(rootEvent);

  // 5. Build participants list from root and provided event
  const participants = this.extractParticipants(rootEvent, providedEvent);

  // 6. Build conversation object
  return {
    id: `nip-10:${rootId}`,
    type: "group", // Use "group" type for multi-participant threads
    protocol: "nip-10",
    title,
    participants,
    metadata: {
      rootEventId: rootId,
      providedEventId: providedEvent.id,
      description: rootEvent.content.slice(0, 200), // First 200 chars for tooltip
    },
    unreadCount: 0,
  };
}

/**
 * Extract a readable title from root event content
 */
private extractTitle(rootEvent: NostrEvent): string {
  const content = rootEvent.content.trim();
  if (!content) return `Thread by ${rootEvent.pubkey.slice(0, 8)}...`;

  // Try to get first line
  const firstLine = content.split("\n")[0];
  if (firstLine && firstLine.length <= 50) {
    return firstLine;
  }

  // Truncate to 50 chars
  if (content.length <= 50) {
    return content;
  }

  return content.slice(0, 47) + "...";
}

/**
 * Extract unique participants from thread
 */
private extractParticipants(
  rootEvent: NostrEvent,
  providedEvent: NostrEvent,
): Participant[] {
  const participants = new Map<string, Participant>();

  // Root author is always first
  participants.set(rootEvent.pubkey, {
    pubkey: rootEvent.pubkey,
    role: "admin", // Root author is "admin" of the thread
  });

  // Add p-tags from root event
  for (const tag of rootEvent.tags) {
    if (tag[0] === "p" && tag[1] && tag[1] !== rootEvent.pubkey) {
      participants.set(tag[1], {
        pubkey: tag[1],
        role: "member",
      });
    }
  }

  // Add provided event author (if different)
  if (providedEvent.pubkey !== rootEvent.pubkey) {
    participants.set(providedEvent.pubkey, {
      pubkey: providedEvent.pubkey,
      role: "member",
    });
  }

  // Add p-tags from provided event
  for (const tag of providedEvent.tags) {
    if (tag[0] === "p" && tag[1] && tag[1] !== providedEvent.pubkey) {
      participants.set(tag[1], {
        pubkey: tag[1],
        role: "member",
      });
    }
  }

  return Array.from(participants.values());
}

/**
 * Determine best relays for the thread
 */
private async getThreadRelays(
  rootEvent: NostrEvent,
  providedEvent: NostrEvent,
  providedRelays: string[],
): Promise<string[]> {
  const relays = new Set<string>();

  // 1. Seen relays from EventStore (if available)
  if (eventStore.getSeenRelays) {
    const rootSeenRelays = eventStore.getSeenRelays(rootEvent.id) || [];
    rootSeenRelays.forEach((r) => relays.add(normalizeURL(r)));
  }

  // 2. Provided relay hints
  providedRelays.forEach((r) => relays.add(normalizeURL(r)));

  // 3. Root author's outbox relays (NIP-65)
  try {
    const rootOutbox = await this.getOutboxRelays(rootEvent.pubkey);
    rootOutbox.slice(0, 3).forEach((r) => relays.add(normalizeURL(r)));
  } catch (err) {
    console.warn("[NIP-10] Failed to get root author outbox:", err);
  }

  // 4. Active user's outbox (for publishing replies)
  const activePubkey = accountManager.active$.value?.pubkey;
  if (activePubkey) {
    try {
      const userOutbox = await this.getOutboxRelays(activePubkey);
      userOutbox.slice(0, 2).forEach((r) => relays.add(normalizeURL(r)));
    } catch (err) {
      console.warn("[NIP-10] Failed to get user outbox:", err);
    }
  }

  // 5. Fallback to popular relays if we have too few
  if (relays.size < 3) {
    ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.nostr.band"].forEach(
      (r) => relays.add(r),
    );
  }

  // Limit to 7 relays max for performance
  return Array.from(relays).slice(0, 7);
}

/**
 * Helper: Get outbox relays for a pubkey (NIP-65)
 */
private async getOutboxRelays(pubkey: string): Promise<string[]> {
  const relayList = await firstValueFrom(
    eventStore.replaceable(10002, pubkey, ""),
    { defaultValue: undefined },
  );

  if (!relayList) return [];

  // Extract write relays (r tags with "write" or no marker)
  return relayList.tags
    .filter((t) => {
      if (t[0] !== "r") return false;
      const marker = t[2];
      return !marker || marker === "write";
    })
    .map((t) => normalizeURL(t[1]))
    .slice(0, 5); // Limit to 5
}

/**
 * Helper: Fetch an event by ID from relays
 */
private async fetchEvent(
  eventId: string,
  relayHints: string[] = [],
): Promise<NostrEvent | null> {
  // Check EventStore first
  const cached = await firstValueFrom(
    eventStore.event(eventId),
    { defaultValue: undefined },
  );
  if (cached) return cached;

  // Not in store - fetch from relays
  const relays = relayHints.length > 0 ? relayHints : await this.getDefaultRelays();

  const filter: Filter = {
    ids: [eventId],
    limit: 1,
  };

  const events: NostrEvent[] = [];
  const obs = pool.subscription(relays, [filter], { eventStore });

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      console.log(`[NIP-10] Fetch timeout for ${eventId.slice(0, 8)}...`);
      resolve();
    }, 5000);

    const sub = obs.subscribe({
      next: (response) => {
        if (typeof response === "string") {
          // EOSE received
          clearTimeout(timeout);
          sub.unsubscribe();
          resolve();
        } else {
          // Event received
          events.push(response);
        }
      },
      error: (err) => {
        clearTimeout(timeout);
        console.error(`[NIP-10] Fetch error:`, err);
        sub.unsubscribe();
        resolve();
      },
    });
  });

  return events[0] || null;
}
```

## Example 3: Loading Thread Messages

```typescript
// src/lib/chat/adapters/nip-10-adapter.ts

loadMessages(
  conversation: Conversation,
  options?: LoadMessagesOptions,
): Observable<Message[]> {
  const rootEventId = conversation.metadata?.rootEventId;
  const relays = conversation.metadata?.relays || [];

  if (!rootEventId) {
    throw new Error("Root event ID required");
  }

  console.log(`[NIP-10] Loading thread ${rootEventId.slice(0, 8)}...`);

  // Build filter for all thread events:
  // - kind 1: replies to root
  // - kind 7: reactions
  // - kind 9735: zap receipts
  const filters: Filter[] = [
    // Replies: kind 1 events with e-tag pointing to root
    {
      kinds: [1],
      "#e": [rootEventId],
      limit: options?.limit || 100,
    },
    // Reactions: kind 7 events with e-tag pointing to root or replies
    {
      kinds: [7],
      "#e": [rootEventId],
      limit: 200, // Reactions are small, fetch more
    },
    // Zaps: kind 9735 receipts with e-tag pointing to root or replies
    {
      kinds: [9735],
      "#e": [rootEventId],
      limit: 100,
    },
  ];

  if (options?.before) {
    filters[0].until = options.before;
  }
  if (options?.after) {
    filters[0].since = options.after;
  }

  // Clean up any existing subscription
  const conversationId = `nip-10:${rootEventId}`;
  this.cleanup(conversationId);

  // Start persistent subscription
  const subscription = pool
    .subscription(relays, filters, { eventStore })
    .subscribe({
      next: (response) => {
        if (typeof response === "string") {
          console.log("[NIP-10] EOSE received");
        } else {
          console.log(
            `[NIP-10] Received event k${response.kind}: ${response.id.slice(0, 8)}...`,
          );
        }
      },
    });

  // Store subscription for cleanup
  this.subscriptions.set(conversationId, subscription);

  // Return observable from EventStore
  // We need to merge all three filters into a single observable
  return eventStore
    .timeline({ kinds: [1, 7, 9735], "#e": [rootEventId] })
    .pipe(
      map((events) => {
        // Filter out the root event itself (we don't want it in messages list)
        const threadEvents = events.filter((e) => e.id !== rootEventId);

        // Convert events to messages
        const messages = threadEvents
          .map((event) => this.eventToMessage(event, conversationId, rootEventId))
          .filter((msg): msg is Message => msg !== null);

        console.log(`[NIP-10] Timeline has ${messages.length} messages`);

        // Sort by timestamp ascending (chronological order)
        return messages.sort((a, b) => a.timestamp - b.timestamp);
      }),
    );
}
```

## Example 4: Sending Replies with NIP-10 Tags

```typescript
// src/lib/chat/adapters/nip-10-adapter.ts

async sendMessage(
  conversation: Conversation,
  content: string,
  options?: SendMessageOptions,
): Promise<void> {
  const activePubkey = accountManager.active$.value?.pubkey;
  const activeSigner = accountManager.active$.value?.signer;

  if (!activePubkey || !activeSigner) {
    throw new Error("No active account or signer");
  }

  const rootEventId = conversation.metadata?.rootEventId;
  const relays = conversation.metadata?.relays || [];

  if (!rootEventId) {
    throw new Error("Root event ID required");
  }

  // Fetch root event for building tags
  const rootEvent = await firstValueFrom(
    eventStore.event(rootEventId),
    { defaultValue: undefined },
  );
  if (!rootEvent) {
    throw new Error("Root event not found in store");
  }

  // Create event factory
  const factory = new EventFactory();
  factory.setSigner(activeSigner);

  // Build NIP-10 tags
  const tags: string[][] = [];

  // Determine if we're replying to root or to another reply
  if (options?.replyTo && options.replyTo !== rootEventId) {
    // Replying to another reply
    const parentEvent = await firstValueFrom(
      eventStore.event(options.replyTo),
      { defaultValue: undefined },
    );

    if (!parentEvent) {
      throw new Error("Parent event not found");
    }

    // Add root marker (always first)
    tags.push([
      "e",
      rootEventId,
      relays[0] || "",
      "root",
      rootEvent.pubkey,
    ]);

    // Add reply marker (the direct parent)
    tags.push([
      "e",
      options.replyTo,
      relays[0] || "",
      "reply",
      parentEvent.pubkey,
    ]);

    // Add p-tag for root author
    tags.push(["p", rootEvent.pubkey]);

    // Add p-tag for parent author (if different)
    if (parentEvent.pubkey !== rootEvent.pubkey) {
      tags.push(["p", parentEvent.pubkey]);
    }

    // Add p-tags from parent event (all mentioned users)
    for (const tag of parentEvent.tags) {
      if (tag[0] === "p" && tag[1]) {
        const pubkey = tag[1];
        // Don't duplicate tags
        if (!tags.some((t) => t[0] === "p" && t[1] === pubkey)) {
          tags.push(["p", pubkey]);
        }
      }
    }
  } else {
    // Replying directly to root
    tags.push([
      "e",
      rootEventId,
      relays[0] || "",
      "root",
      rootEvent.pubkey,
    ]);

    // Add p-tag for root author
    tags.push(["p", rootEvent.pubkey]);

    // Add p-tags from root event
    for (const tag of rootEvent.tags) {
      if (tag[0] === "p" && tag[1]) {
        const pubkey = tag[1];
        // Don't duplicate tags
        if (!tags.some((t) => t[0] === "p" && t[1] === pubkey)) {
          tags.push(["p", pubkey]);
        }
      }
    }
  }

  // Add NIP-30 emoji tags
  if (options?.emojiTags) {
    for (const emoji of options.emojiTags) {
      tags.push(["emoji", emoji.shortcode, emoji.url]);
    }
  }

  // Add NIP-92 imeta tags for blob attachments
  if (options?.blobAttachments) {
    for (const blob of options.blobAttachments) {
      const imetaParts = [`url ${blob.url}`];
      if (blob.sha256) imetaParts.push(`x ${blob.sha256}`);
      if (blob.mimeType) imetaParts.push(`m ${blob.mimeType}`);
      if (blob.size) imetaParts.push(`size ${blob.size}`);
      tags.push(["imeta", ...imetaParts]);
    }
  }

  // Create and sign kind 1 event
  const draft = await factory.build({ kind: 1, content, tags });
  const event = await factory.sign(draft);

  console.log(`[NIP-10] Publishing reply with ${tags.length} tags to ${relays.length} relays`);

  // Publish to conversation relays
  await publishEventToRelays(event, relays);
}
```

## Example 5: Converting Events to Messages

```typescript
// src/lib/chat/adapters/nip-10-adapter.ts

/**
 * Convert Nostr event to Message object
 */
private eventToMessage(
  event: NostrEvent,
  conversationId: string,
  rootEventId: string,
): Message | null {
  // Handle zap receipts (kind 9735)
  if (event.kind === 9735) {
    return this.zapToMessage(event, conversationId);
  }

  // Handle reactions (kind 7) - skip for now, we'll handle via MessageReactions component
  if (event.kind === 7) {
    return null; // Reactions are shown inline, not as separate messages
  }

  // Handle replies (kind 1)
  if (event.kind === 1) {
    const refs = getNip10References(event);

    // Determine what this reply is responding to
    let replyTo: string | undefined;

    if (refs.reply?.e) {
      // Replying to another reply
      replyTo = refs.reply.e.id;
    } else if (refs.root?.e) {
      // Replying directly to root
      replyTo = refs.root.e.id;
    } else {
      // Malformed or legacy reply - assume replying to root
      replyTo = rootEventId;
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

  console.warn(`[NIP-10] Unknown event kind: ${event.kind}`);
  return null;
}

/**
 * Convert zap receipt to Message object
 */
private zapToMessage(
  zapReceipt: NostrEvent,
  conversationId: string,
): Message {
  // Extract zap metadata using applesauce helpers
  const zapRequest = getZapRequest(zapReceipt);
  const amount = getZapAmount(zapReceipt);
  const sender = getZapSender(zapReceipt);
  const recipient = getZapRecipient(zapReceipt);

  // Find what event is being zapped (e-tag in zap receipt)
  const eTag = zapReceipt.tags.find((t) => t[0] === "e");
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

## Example 6: ChatViewer Root Event Display

```typescript
// src/components/ChatViewer.tsx

export function ChatViewer({
  protocol,
  identifier,
  customTitle,
  headerPrefix,
}: ChatViewerProps) {
  // ... existing setup code ...

  // Check if this is a NIP-10 thread
  const isThreadChat = protocol === "nip-10";

  // Fetch root event for thread display
  const rootEventId = conversation?.metadata?.rootEventId;
  const rootEvent = use$(
    () => (rootEventId ? eventStore.event(rootEventId) : undefined),
    [rootEventId],
  );

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="pl-2 pr-0 border-b w-full py-0.5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-1 min-w-0 items-center gap-2">
            {headerPrefix}
            <span className="text-sm font-semibold truncate">
              {customTitle || conversation.title}
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground p-1">
            <MembersDropdown participants={derivedParticipants} />
            <RelaysDropdown conversation={conversation} />
            {isThreadChat && (
              <button className="rounded bg-muted px-1.5 py-0.5 font-mono">
                NIP-10
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Message timeline */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {/* NIP-10 Thread: Show root event at top */}
        {isThreadChat && rootEvent && (
          <div className="border-b bg-muted/10 flex-shrink-0">
            <div className="max-w-2xl mx-auto py-4 px-3">
              {/* Use KindRenderer to render root with full feed functionality */}
              <KindRenderer event={rootEvent} depth={0} />
            </div>
            {/* Visual separator */}
            <div className="flex items-center gap-2 px-3 py-1 text-xs text-muted-foreground">
              <div className="flex-1 h-px bg-border" />
              <span>Replies</span>
              <div className="flex-1 h-px bg-border" />
            </div>
          </div>
        )}

        {/* Scrollable messages list */}
        <div className="flex-1 overflow-hidden">
          {messagesWithMarkers && messagesWithMarkers.length > 0 ? (
            <Virtuoso
              ref={virtuosoRef}
              data={messagesWithMarkers}
              initialTopMostItemIndex={messagesWithMarkers.length - 1}
              followOutput="smooth"
              alignToBottom
              // ... rest of virtuoso config ...
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              {isThreadChat ? "No replies yet. Start the conversation!" : "No messages yet. Start the conversation!"}
            </div>
          )}
        </div>
      </div>

      {/* Composer */}
      {canSign ? (
        <div className="border-t px-2 py-1 pb-0">
          {replyTo && (
            <ComposerReplyPreview
              replyToId={replyTo}
              onClear={() => setReplyTo(undefined)}
            />
          )}
          <div className="flex gap-1.5 items-center">
            {/* ... existing composer ... */}
          </div>
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

## Example 7: Usage Examples

### Opening a Thread from Root Event

```bash
# User clicks on a tweet in their feed
# Extract event ID: abc123...
chat nevent1qqsabc123...
# → Opens thread chat with root at top
```

### Opening a Thread from Reply Event

```bash
# User clicks on a reply deep in a thread
# Extract event ID: xyz789... (this is a reply, not root)
chat nevent1qqsxyz789...
# → Adapter fetches root, opens full thread
```

### Replying to Root

```
User types: "Great point!"
Click Reply button on root event
→ Sends kind 1 with:
  ["e", "<root-id>", "<relay>", "root", "<root-author>"]
  ["p", "<root-author>"]
```

### Replying to a Reply

```
User clicks Reply on Alice's message (which replied to root)
User types: "I agree with Alice"
→ Sends kind 1 with:
  ["e", "<root-id>", "<relay>", "root", "<root-author>"]
  ["e", "<alice-msg-id>", "<relay>", "reply", "<alice-pubkey>"]
  ["p", "<root-author>"]
  ["p", "<alice-pubkey>"]
```

### Visual Flow

```
┌──────────────────────────────────────────┐
│ chat nevent1qqsxyz...                    │  User enters command
└──────────────────────────────────────────┘
              │
              ▼
┌──────────────────────────────────────────┐
│ Nip10Adapter.parseIdentifier()          │  Parse nevent
│ → Returns ThreadIdentifier               │
└──────────────────────────────────────────┘
              │
              ▼
┌──────────────────────────────────────────┐
│ Nip10Adapter.resolveConversation()      │  Fetch events, find root
│ → Fetches provided event                │
│ → Parses NIP-10 refs                    │
│ → Fetches root event                    │
│ → Determines relays                     │
│ → Returns Conversation                  │
└──────────────────────────────────────────┘
              │
              ▼
┌──────────────────────────────────────────┐
│ ChatViewer renders                       │  Display UI
│ ┌────────────────────────────────────┐  │
│ │ Root Event (KindRenderer)          │  │  Root at top
│ └────────────────────────────────────┘  │
│ ────────────────────────────────────── │
│ Alice: Great post!                      │  Replies as messages
│ Bob: +1                                 │
│ [──────────────────]  [Send]            │  Composer
└──────────────────────────────────────────┘
              │
              ▼
┌──────────────────────────────────────────┐
│ Nip10Adapter.loadMessages()             │  Subscribe to replies
│ → Subscribes to kind 1 replies          │
│ → Subscribes to kind 7 reactions        │
│ → Subscribes to kind 9735 zaps          │
│ → Returns Observable<Message[]>         │
└──────────────────────────────────────────┘
```

## Testing Example

```typescript
// src/lib/chat/adapters/nip-10-adapter.test.ts

import { describe, it, expect } from "vitest";
import { Nip10Adapter } from "./nip-10-adapter";

describe("Nip10Adapter", () => {
  const adapter = new Nip10Adapter();

  describe("parseIdentifier", () => {
    it("should parse nevent with relay hints", () => {
      const nevent = "nevent1qqsabc123..."; // Valid nevent
      const result = adapter.parseIdentifier(nevent);

      expect(result).toBeTruthy();
      expect(result?.type).toBe("thread");
      expect(result?.value.id).toBeTruthy();
    });

    it("should parse note (event ID only)", () => {
      const note = "note1abc123..."; // Valid note
      const result = adapter.parseIdentifier(note);

      expect(result).toBeTruthy();
      expect(result?.type).toBe("thread");
    });

    it("should return null for non-note/nevent input", () => {
      const result = adapter.parseIdentifier("npub1...");
      expect(result).toBeNull();
    });

    it("should return null for nevent with kind 9 (group message)", () => {
      // nevent encoding includes kind: 9
      const nevent = "nevent1...kind9...";
      const result = adapter.parseIdentifier(nevent);
      expect(result).toBeNull();
    });
  });

  describe("extractTitle", () => {
    it("should use first line if under 50 chars", () => {
      const event = {
        content: "Short title\nLonger content here...",
        pubkey: "abc",
      };
      // @ts-ignore - testing private method
      const title = adapter.extractTitle(event);
      expect(title).toBe("Short title");
    });

    it("should truncate long content", () => {
      const event = {
        content: "A".repeat(100),
        pubkey: "abc",
      };
      // @ts-ignore
      const title = adapter.extractTitle(event);
      expect(title).toHaveLength(50);
      expect(title).toEndWith("...");
    });
  });

  describe("eventToMessage", () => {
    it("should convert kind 1 reply to Message", () => {
      const event = {
        id: "reply123",
        kind: 1,
        pubkey: "alice",
        content: "Great point!",
        created_at: 1234567890,
        tags: [
          ["e", "root123", "", "root", "bob"],
          ["p", "bob"],
        ],
      };

      // @ts-ignore
      const message = adapter.eventToMessage(event, "nip-10:root123", "root123");

      expect(message).toBeTruthy();
      expect(message?.type).toBe("user");
      expect(message?.replyTo).toBe("root123");
      expect(message?.content).toBe("Great point!");
    });

    it("should return null for kind 7 (reactions handled separately)", () => {
      const event = {
        id: "reaction123",
        kind: 7,
        pubkey: "alice",
        content: "🔥",
        created_at: 1234567890,
        tags: [["e", "msg123"]],
      };

      // @ts-ignore
      const message = adapter.eventToMessage(event, "nip-10:root123", "root123");
      expect(message).toBeNull();
    });
  });
});
```
