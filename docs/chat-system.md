# Chat System

**Status**: NIP-10, NIP-17, NIP-22, NIP-29, NIP-53 and Concord are all
registered. Only NIP-28 (public channels) remains commented out.

## Architecture

A protocol adapter pattern:

- `src/lib/chat/adapters/base-adapter.ts` — interface all adapters implement
- `nip-10-adapter.ts` — thread chat on a kind 1
- `nip-17-adapter.ts` — private direct messages (see below)
- `nip-22-adapter.ts` — comments; the catch-all
- `nip-29-adapter.ts` — relay groups
- `nip-53-adapter.ts` — live activity chat
- `concord-adapter.ts` — E2E-encrypted community channels

Registered in two places, both of which must agree: the `getAdapter` switch in
`src/components/ChatViewer.tsx` and the priority array in
`src/lib/chat-parser.ts`.

## The browser: bare `chat`

`chat <identifier>` opens ONE conversation — a window that shows a single
timeline for its whole life, with no sidebar. `chat` with no argument opens the
**browser** instead: three collapsible sections in one sidebar — private
conversations, NIP-29 relay groups, Concord communities — each sorted by its
most recent message, with `ChatViewer` rendering whichever one is selected.

`ConcordViewer` is the browser component; bare `chat` mounts it. (A `concord`
command used to mount it too; it was removed, and a window saved under its
appId now renders the removed-app notice — see `src/lib/removed-apps.ts`.)
Navigation writes the window's command back, and **`chat` stays BARE,
always**: its appId dispatches on props, so a browser window that rebuilt its
command as `chat relay'group` would reopen as a single-conversation pane with
no sidebar at all. The selection rides in the props beside the command, never
in it.

`src/lib/concord/window-props.ts` is the one place those props are written, and one
selection has three families: a channel, a private conversation and a relay
group are mutually exclusive, so every write drops the other two. A window
carrying both would reload showing one while the sidebar highlighted another.

The NIP-29 section resolves the reader's OWN kind-10009 list
(`useNip29Groups`) — a plain replaceable list, identifier `""`, found through
the outbox loader with no hint required. That is the difference from
`useNip29GroupList`, which serves `chat naddr1…10009…`: someone else's list,
addressed explicitly. Both share the group extraction and the per-group
last-message REQ.

A group is addressed by id AND relay everywhere (`GroupSelection`,
`src/lib/nip29/group-selection.ts`): a NIP-29 group id is only unique within
the relay hosting it, so the pair travels together through the sidebar, the
window props and the timeline key.

## NIP-17 direct messages

**applesauce does the crypto; Dexie does the storage and the reads.** Wraps are
opened once at ingest (`src/services/dm-inbox.ts`) and the rumor is mirrored to
`dmRumors`; the adapter reads that mirror and repaints on a `dm-bus` ring. The
applesauce `WrappedMessages*` models are deliberately unused — they read the
EventStore, and rumors never enter it.

Four things here are load-bearing, and each of them was a bug first:

1. **Reads authenticate; writes do not.** A gift wrap is signed by a throwaway
   key so the relay cannot attribute it, and a socket that has NIP-42 AUTHed as
   the sender gives that away for free. The peer's copy is published on
   `dm-publish-pool.ts`, which no auth manager watches, and a relay answering
   `auth-required` is reported undeliverable rather than satisfied. The inbox
   REQ and the self-copy stay on the singleton pool, where authenticating to
   your own mailbox costs nothing. `hub.ts` refuses to publish anyone else's
   wrap, because applesauce turns an `auth-required` refusal into a retry that
   WAITS for authentication — the leak succeeds rather than failing.
2. **Every `Message` carries `metadata.reactions`, always.** `MessageReactions`
   opens `{kinds:[7],"#e":[id]}` unless the field is present, and a DM's id is a
   rumor id that exists on no relay — the REQ alone announces the conversation.
   Reactions come from the mirror: they are kind-7 rumors in gift wraps.
   `metadata.relays` is empty for the same class of reason.
3. **Side rows are folded across the whole viewer, not the conversation.** A
   NIP-09 delete usually carries only an `e` tag, so it is filed under its
   author alone — and in a group DM under a two-person conversation that does
   not exist. Target ids are globally unique, so the wider read is safe and the
   narrow one loses tombstones. Kind 5 and kind 7 are both side rows, so the
   delete fold matches on kind 5 ALONE: treating them alike makes liking a
   message erase it.
4. **Decrypt once, ever.** Two `nip44.decrypt` calls per wrap, against what may
   be a browser prompt or a bunker. `dmSeenWraps` records every wrap, including
   the ones that would not open; the batch dedupes within itself (applesauce's
   cross-relay dedupe is off, so four inbox relays deliver four copies) and
   across concurrent callers. `DmConsentGate` asks once per account before any
   of it happens.

A conversation with yourself is "Saved messages": pinned above the list, never
unread, and named for what people use it as. It exists whether or not it holds
anything — a notepad you can only reach after writing in it is one nobody finds.

### Legacy NIP-04

`dm-legacy-inbox.ts` imports kind-4 history into the SAME `dmRumors` table and
the same conversations, because a kind-4 exchange with someone is the same
human conversation as the gift-wrapped one. NIP-17 is young; for anyone with
history, the legacy messages ARE the conversation list.

Four things differ from the gift-wrap path, each for its own reason:

1. **The signature is the vetting, not the id.** A kind-4 id was hashed over
   the ciphertext, so it cannot be recomputed from a row holding plaintext.
   `toLegacyDmRow` verifies the signature instead — strictly stronger, since a
   kind 4 is signed and a rumor is not. It rebuilds the event from its fields
   first: `verifyEvent` memoizes its verdict on a symbol, and a spread copy
   carries that symbol, so `{...event, content: forged}` verifies as true.
2. **Two filters.** `{authors:[self]}` for what you sent and `{"#p":[self]}`
   for what you received. A gift-wrap inbox needs only the second, because the
   self-copy is p-tagged to you.
3. **Received is scoped to follows.** The kind-4 era has no gift wrap deciding
   who may write to you, so unscoped this imports the entire spam era — and
   each one costs a signer round trip to discover. The cost is real and stated:
   a legacy message from someone you do not follow is not imported.
4. **The row is marked `legacy`.** A kind 4 hid its contents and nothing else;
   its author, recipient and timing were plain on a public event. The row says
   so rather than rendering under gift-wrap chrome. `messageIdsArePrivate`
   stays `true` for the whole adapter — on a mixed timeline the conservative
   value is the correct one, and the cost is only that Copy ID stays suppressed
   for ids that happen to be public.

Read-only, deliberately. Sending kind 4 means porting a downgrade-consent flow,
and it opens the one real leak: a public event quoting a private rumor id would
put that id on relays permanently.

### Coverage

Everything in this section exists because a message that was fetched and then
silently dropped is indistinguishable, to the reader, from one nobody sent.

- **A relay that did not answer is not a relay with no mail.** `readWrapsPerRelay`
  reports whether each relay ANSWERED. A page nobody answered pauses the walk;
  only an empty answer from a live relay ends it. Conflating the two let a cold
  start — every relay still waiting on the signer — latch `exhausted` forever.
- **The paging bound is the MAX of the per-relay tails**, not the min over the
  merged union. One relay holding a single ancient message would otherwise drag
  `until` past everything a busy relay had in between.
- **The relay-set signature is written when the walk starts**, so a walk
  interrupted before it finishes resumes instead of restarting from the newest
  page.
- **Write, then mark seen** — in that order, per wave. The reverse leaves wraps
  recorded as opened with no row behind them, and the seen memo never hands
  those back.
- **Reading is wider than sending.** A send goes to exactly what the recipient
  nominated; a read of your own inbox unions the 10050, BOTH sides of the
  NIP-65 list, and the configured read relays, because a wrap delivered to the
  wrong relay is still yours and asking costs one REQ.

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
A group may also run a live audio/video room — see "NIP-29 AV spaces" below.

## Read state (optional adapter surface)

Two optional methods on `ChatProtocolAdapter`, implemented by Concord, NIP-17 and
NIP-29:

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
   NIP-29 has the OPPOSITE problem, and it is the one thing a reader porting this
   should study. Its count is kind 9 alone while the timeline also renders 9000,
   9001 and 9321, so the newest message shown can be NEWER than anything the
   count can see — and a NIP-29 stamp has a second consumer no other protocol's
   has: it is the `since` on the sidebar's `kinds:[9]` REQ. Stamped from the
   reader's own join event, that REQ asks for messages newer than the join, gets
   nothing, and the group loses its last message: a blank row in
   `GroupListViewer` and last place in the recency sort until somebody posts
   again. So `Nip29Adapter.markRead` caps at the newest non-future kind 9, and a
   group holding no countable message is not stamped at all.
3. **Bound both sides by the same clock allowance.** Message timestamps are
   author-chosen. Concord's scan and stamp both stop at
   `now + CONCORD_READ_MAX_FUTURE_SECS`; clamping one and not the other either
   pins the badge forever or marks the conversation read for years. NIP-17 uses
   the same hour on both sides.

   **NIP-29 deliberately does not**, for the reason in rule 2: its stamp is a
   fetch bound. A stamp settled an hour ahead puts `since` an hour ahead, and
   every message genuinely sent during that hour falls below it — never
   requested, never counted, and marked read besides. So the scan keeps the hour
   (a future-dated message still badges) while `markGroupRead` clamps at `now`
   and `GroupUnread.latest` — what "Mark as read" writes straight through —
   names only a message that has happened. The cost is the milder failure rule 3
   warns about, and it is bounded: a future-dated message badges until the clock
   reaches it, then becomes stampable and clears.

   The corollary is that `nowSecs` must stay fresh. `useNip29Unread` ticks a
   counter into its `useLiveQuery` deps because nothing else will: a live query
   refires on a deps change or a mutation to a range it observes, and NIP-29 has
   no local mirror to write and `markGroupRead` does not write when the stamp
   would not move. Frozen, the ceiling drifts into the past and every arriving
   message reads as future-dated — a window left open counts to zero and stays
   there. Concord shares the shape and gets away with it only because its ingest
   writes Dexie on every message.

A conversation with `lastRead === 0` gets badges but no divider — flagging the
whole history of a channel someone just joined is noise.

Stamps live in the `chatReads` Dexie table, keyed
`[pubkey+protocol+containerId+channelId]`, and are wiped on logout for every
protocol the account holds — `clearReads` (`concord-reads.ts`) deletes by the
`pubkey` index and is deliberately not protocol-scoped, so a new protocol's rows
are covered the day it starts writing them. Nothing about read state is ever
published: no CORD document and no NIP defines a read marker.

The table is shared by design, one small module per protocol over it:

| Protocol | Module | `containerId` | `channelId` |
| --- | --- | --- | --- |
| `concord` | `concord-reads.ts` | community idHex | channel idHex |
| `nip-17` | `dm-reads.ts` | constant `"dm"` | conversation id |
| `nip-29` | `nip29-reads.ts` | normalized relay URL | group id, VERBATIM |

Two keying rules that each cost a bug elsewhere:

- **Normalize the relay in the module, not at the call site.** The sidebar builds
  its URL with `new URL().toString()` (trailing slash); the adapter's
  `parseIdentifier` only prefixes `wss://`. Written raw, the pane stamps one key
  and the badge reads another — a badge nothing can clear. `nip29-reads.ts` runs
  every key through `normalizeRelayURL`, and exports `groupReadKey` so the hook
  that JOINS stamps to messages canonicalizes the same way.
- **Do not lowercase a NIP-29 group id.** Concord lowercases its channel ids
  because they are hex; a group id is relay-assigned and `#h` is case-sensitive,
  so `Bitcoin` and `bitcoin` on one relay are two rooms.

### Counting, which is the part that does not generalize

Each protocol counts over its own substrate, and NIP-29 is the odd one:

- Concord scans `concordRumors`, NIP-17 scans `dmRumors` — Dexie index ranges,
  descending, so `latest` is the newest row counted.
- **NIP-29 has no local mirror at all.** A kind 9 lives in the in-memory
  EventStore and nowhere else, so the count is measured over a bounded
  newest-first window the sidebar's own standing REQ collects
  (`useGroupMessageWindows`, `src/hooks/useNip29GroupList.ts`), folded by
  `mergeGroupWindow` and summarized by the pure `summarizeGroupUnread`
  (`src/lib/nip29/unread.ts`).

Three consequences of having no mirror:

1. **The window is relay-scoped by construction, and has to be.** A group id is
   only unique within its relay, so `eventStore.timeline({"#h":[id]})` would
   merge two relays' `bitcoin` rooms. The subscription knows which relay it
   opened; the store does not.
2. **`since` is the reader's own stamp**, resolved once per (reader, group set)
   and deliberately NOT a subscription dependency — a stamp only moves forward,
   which can only shrink a client-side count, and re-subscribing per mark would
   cost one REQ per relay per message read. A group with no stamp gets no `since`
   at all: a time floor would return nothing for a quiet group nobody has opened,
   erasing its last message and demoting it out of the recency sort.
3. **The count is only as deep as the window** — beyond `NIP29_UNREAD_CAP` it
   reports a floor and says so through `capped`, which `UnreadBadge` renders as
   `99+`. Concord's badge has the same ceiling for the same reason.

The Groups section's REQs are therefore ungated: they used to run only while the
section was expanded, which was right while the heading carried no count, and a
collapsed section that cannot say something is waiting is most of an unread badge
missing.

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

## NIP-29 AV spaces

A group whose `kind:39000` carries a `livekit` tag has a media room, and the
whole feature turns on one fact: **the party enforcing the group's rules and the
party issuing the media credential are the same relay.** Everything that makes
Concord's call (CORD-07) complicated is absent here, and each absence has that
one cause.

| | Concord | NIP-29 |
| --- | --- | --- |
| Token from | a BLIND broker, authorized by the channel key | the group's own relay, authorized by NIP-98 with the reader's key |
| Media | end-to-end encrypted, per-sender keys nobody exchanges | TLS to the relay's SFU, and no further |
| Who is in it | members announce themselves (kind 23313, sealed, heartbeat) | the relay publishes `kind:39004` |
| Identity | member-visible, so a claim can be CONTESTED | relay-minted, pubkey bound into the JWT `sub` — single by construction |
| Where | any broker; §5 rendezvous and split healing | one relay, one endpoint |
| Hand, reactions | ride the presence rumor | no carrier; the buttons are absent, not disabled |

So `nip29-call.ts` is a fifth the size of `concord-call.ts`, and what it does
NOT buy is worth saying plainly: a hostile relay can put anyone in a room under
anyone's name. That is the trust NIP-29 asks for everywhere else — for
`kind:39000`, for the member list, for moderation — and nothing here makes it
larger.

### What is shared

One call, app-wide and protocol-wide: one microphone, one camera, one pair of
ears. `CallState.protocol` says whose it is, `hangUpAny()`
(`src/services/call-room.ts`) ends it, and joining anywhere calls that first. The
slot holds the owner's own hang-up rather than dispatching on the atom, because
a teardown announcing a goodbye holds the atom on the old call for seconds after
the service has already let it go — dispatching on `protocol` found nobody to
hang up at exactly the moment there was something.

`CallRoster` (`src/lib/call/roster.ts`), `CallStage`, `CallControls`,
`CallHeaderButton`, `InCallCount`, the device prefs and RNNoise are all shared.
`claims` in the roster is where the two trust models meet: Concord can produce a
contested identity and a relay group cannot, and the renderer does not have to
know which it is looking at.

### Reading the roster

`kind:39004` is watched for every group in the sidebar, not only the ones
advertising a room — the whole set costs one filter per relay, and gating on
metadata would keep a room invisible until its `kind:39000` happened to resolve.

**The fold reads the subscription, never the store.** `eventStore.replaceable`
is keyed on the address alone, so two relays hosting a `bitcoin` would merge into
one roster; the subscription knows which relay it opened and the store does not.
This is the `#h` lesson from the unread section, in a second place.

The latest roster per group is remembered at module level
(`src/services/nip29-participants.ts`), because a watcher that mounts second —
the call window, over a sidebar subscribed since the app started — would
otherwise show an empty room until the relay next republishes, which may be
never. `useGroupParticipants` reads that memory through `useSyncExternalStore`
rather than mirroring it into state: the snapshot is a function of the CURRENT
group, so switching groups cannot leave the previous one's members on screen
under the new one's name.

`foldGroupRoster` merges the relay's list with the room's own participants and
keeps everyone in either. A member holds a token before their session is up (a
tile with no media) and the room knows a participant the relay has not
re-announced yet (a tile the relay has not blessed). Someone audible must never
be invisible.

### Minting

`GET https://<relay-host>/.well-known/nip29/livekit/<group-id>` with
`Authorization: Nostr <base64 kind-27235>` (`src/lib/nip98.ts` — the repo's first
real NIP-98 helper; Concord's `signAvGrant` only resembles one). Three details:

- **Origin, not path.** A relay's socket may live under a path; a well-known URI
  is defined against an origin. `wss://` only — the header is a bearer credential
  naming the reader.
- **One URL, both uses.** The `u` tag and the fetch take the same string. A
  server comparing them gets a 401 with nothing in it to explain a mismatch.
- **The identity comes from the JWT's `sub`**, not from a field beside it. `sub`
  is what the spec mandates and what the SFU will present us as; a response
  disagreeing with itself would leave us matching our own tile against the wrong
  string.

A network error against an endpoint the group itself advertised is almost always
a missing CORS header — the request never reaches the application, so there is no
status and the browser will not say which header. The viewer names it.

### `supported_kinds`

Absent means every kind; present and EMPTY means none. That distinction is the
whole point of the tag, and collapsing it puts a message box on a room that has
no messages. A group listing kinds without 9 sets
`Conversation.metadata.acceptsMessages = false`, and `ChatViewer` renders a line
saying so where the composer would be.

## Adding a protocol

1. Extend `ChatProtocolAdapter` in `src/lib/chat/adapters/`
2. Implement `parseIdentifier`, `resolveConversation`, `loadMessages`, `sendMessage`
3. Register the adapter in `src/lib/chat-parser.ts` and `src/components/ChatViewer.tsx`
4. Update the command docs in `src/types/man.ts`
