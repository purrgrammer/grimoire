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

Stamps live in the `chatReads` Dexie table, keyed
`[pubkey+protocol+containerId+channelId]`, and are wiped on logout for every
protocol the account holds. The table is shared by design — a NIP-29
`(relay, group)` pair is the same row shape as a Concord `(community, channel)`
one — but only Concord writes it today, because the COUNTING behind the badge
scans `concordRumors` through the fold pipeline. Nothing about read state is
ever published: no CORD document defines a read marker.

Notification levels are keyed the same way:
`chatnotif:<protocol>|<container>[|<channel>]` in `concordKv`, which a Concord
logout empties whole.

## Local search (Concord only)

`searchConcordMessages` (`src/services/concord-search.ts`) does **not** query
rows. It runs each in-scope channel through the same pipeline the timeline reads
with — `queryChannelRumors` → stamp the channel's `current.epoch` →
`filterEpochCutoff` → `foldTimeline(…, chatModerationOf(folded, community.id))`
— and matches a case-insensitive substring over the FOLDED messages.

That is the invariant: **a hit is a strict subset of what the channel would
render.** Banned authors, expired rumors, retired-epoch rows and deleted
messages are absent by construction rather than by a second set of rules, and an
edited message matches its edited text because the fold applied the edit first.
`chatModerationOf` (`src/lib/concord/chat.ts`) exists so the timeline and the
search cannot wire moderation differently.

`SEARCH_SCAN_LIMIT` bounds the store read as well as the fold: since the paging
fix, `queryChannelRumors` walks the `[communityId+channel+created_at]` index
backwards and stops once the limit's worth of row-kind rows is collected, and
search passes no `until`, so the side-event top-up query never runs. A match
older than a channel's newest 5000 rows is invisible.

Search is Concord's alone because its corpus is the local plaintext rumor store.
NIP-29 messages live in the EventStore with no local mirror, so there is nothing
to generalize over yet.

### Jumping to a hit

`ChatViewer`'s `jumpTo={{ messageId, nonce }}` is a REQUEST, and two rules keep
it one:

- **Wait for the resolved conversation's own messages.** `use$` publishes from
  an effect, so on the render where `conversation` first exists, `messages` is
  still `undefined` — and `useJumpToMessage` gives up silently on an empty
  timeline, because there is no oldest row to page below and nothing was paged
  to warrant a toast. Starting there spends the request on a look that never
  happened. This is not a cross-channel concern: the results pane replaces
  ChatViewer, so every click lands on a cold mount.
- **The caller forgets the request, not the viewer.** For the same reason —
  ChatViewer unmounts whenever search is open — consumption tracked only in a
  ref inside it would let a fresh instance honour a request the reader already
  saw answered. `onJumpHandled(nonce)` fires when the walk ends, and
  `ConcordViewer` clears `jumpTo` if the nonce still matches.

`src/hooks/useJumpToMessage.request.test.tsx` drives both against the real
hooks, because everything wrong here was timing.

## Moderation rendering (Concord only)

Nothing is ever removed from `concordRumors` — `writeChatRumors` only puts — so
a kind-5 and its target both persist and `foldTimeline` re-applies the removal
on every read. (Armada physically deletes; CORD authorizes a moderator delete
without mandating removal, so the two clients differ and both are honest.)

`FoldedTimeline.removed` carries the moderator removals only. The adapter maps
each to a `Message` with `metadata.deleted` and `metadata.deletedBy`, and
ChatViewer renders it as a muted row naming author and remover. Three details
are load-bearing:

- **Self-deletes leave nothing.** They are not in `removed`; a tombstone would
  advertise the erasure the spec's carve-out protects.
- **The `event` is scrubbed** — empty content, empty tags — while `id` stays the
  real rumor id for keying and dedupe. `Message.event` is documented as "the
  original event for verification", a contract Concord already voids (`sig` is
  empty; rumors have none and nothing re-verifies). The row exposes no
  raw-event affordance, but a future generic "view raw event" over
  `Message.event` must special-case a deleted row.
- **Tombstones are `type: "user"`, not `"system"`.** `groupSystemMessages`
  collapses only system rows, and a collapsed tombstone would take a jump target
  with it. The adapter's emitter dedupe signature also counts
  `metadata.deleted`, because a delete landing mid-session changes no id, no
  timestamp and no delivery state.

## Adding a protocol

1. Extend `ChatProtocolAdapter` in `src/lib/chat/adapters/`
2. Implement `parseIdentifier`, `resolveConversation`, `loadMessages`, `sendMessage`
3. Register the adapter in `src/lib/chat-parser.ts` and `src/components/ChatViewer.tsx`
4. Update the command docs in `src/types/man.ts`
