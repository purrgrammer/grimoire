# Chat System

**Status**: only NIP-29 (relay-based groups) is enabled. Other protocol adapters
are implemented but commented out.

## Architecture

A protocol adapter pattern:

- `src/lib/chat/adapters/base-adapter.ts` — interface all adapters implement
- `src/lib/chat/adapters/nip-29-adapter.ts` — NIP-29 relay groups (enabled)
- NIP-10, NIP-22, NIP-53 adapters exist but are not registered

## Key components

- `src/components/ChatViewer.tsx` — protocol-agnostic chat interface
- `src/components/chat/ReplyPreview.tsx` — reply context with scroll-to
- `src/lib/chat-parser.ts` — auto-detects protocol from identifier format
- `src/types/chat.ts` — protocol-agnostic types (`Conversation`, `Message`, …)

## NIP-29 identifier format

`relay'group-id` (the `wss://` prefix is optional):

```bash
chat relay.example.com'bitcoin-dev
chat wss://nos.lol'welcome
```

Groups live on a single relay that enforces membership and moderation.
Messages are kind 9, metadata kind 39000, admins kind 39001, members kind 39002.

## Read state (optional adapter surface)

Two optional methods on `ChatProtocolAdapter`, implemented only by Concord:

- `getLastRead(conversation): Promise<number>` — unix seconds, 0 for never read
- `markRead(conversation, timestampSecs): Promise<void>` — monotonic

`useReadMarker` (`src/hooks/useReadMarker.ts`) drives both and returns the id of
the message the "New" divider belongs above. Three rules matter to anyone
implementing this for another protocol:

1. **Read before write.** Opening a conversation is what moves the stamp, so the
   pre-visit value is captured first and the divider is measured against that
   frozen number for the whole visit. Reversing the order silently deletes the
   divider.
2. **The stamp must be able to cover everything the count counts.** If the
   protocol hides rows the store still holds — moderation, expiry, key rotation —
   then the newest message the viewer can show is older than the newest unread
   row, and stamping what the viewer showed leaves a badge nothing can clear.
   Concord resolves this in `markRead`: it stamps
   `max(clamped newest loaded, summary.latest)`, where `latest` is by
   construction the newest row the count counted
   (`channelUnreadSummary`, `src/services/concord-rumor-store.ts`).
3. **Bound both sides by the same clock allowance.** Message timestamps are
   author-chosen. Concord's scan and stamp both stop at
   `now + CONCORD_READ_MAX_FUTURE_SECS`; clamping one and not the other either
   pins the badge forever or marks the conversation read for years.

A conversation with `lastRead === 0` gets badges but no divider — flagging the
whole history of a channel someone just joined is noise.

Concord's stamps live in the `concordReads` Dexie table, keyed
`[pubkey+communityId+channelId]`, and are wiped on logout. Nothing about read
state is ever published: no CORD document defines a read marker.

## Adding a protocol

1. Extend `ChatProtocolAdapter` in `src/lib/chat/adapters/`
2. Implement `parseIdentifier`, `resolveConversation`, `loadMessages`, `sendMessage`
3. Register the adapter in `src/lib/chat-parser.ts` and `src/components/ChatViewer.tsx`
4. Update the command docs in `src/types/man.ts`
