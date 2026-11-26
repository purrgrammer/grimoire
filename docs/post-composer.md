# POST composer: tagged people and their inbox relays

The `post` window publishes a kind 1 note. This file is the contract for who
that note tags, which relays it goes to, and what the draft remembers.

| Piece | File |
| --- | --- |
| The note template (only builder; preview and publish) | `src/lib/post-template.ts` |
| Relay rows, overrides, limits, delivery summary | `src/lib/post-relays.ts` |
| Draft storage and v1 → v2 migration | `src/lib/post-draft.ts` |
| Inbox lookups (memo, generations, late kind 10002) | `src/hooks/useRecipientInboxes.ts` |
| Quoted notes' authors | `src/hooks/useQuoteAuthors.ts` |
| Inbox resolution service | `resolveInboxRelays()` in `src/services/relay-selection.ts` |
| UI | `src/components/PostViewer.tsx`, `src/components/post/*` |

## Protocol basis

- **NIP-65**: when publishing, send to the author's write relays and to "all
  read relays of each tagged user". Lists should be 2–4 relays per category.
- **NIP-27**: mentions are `nostr:` URIs in the content; the `p` tag is what
  notifies, and a client may leave it out for a given mention.
- **NIP-18**: `note`/`nevent`/`naddr` in content → `q` tag
  `["q", id, relay, pubkey-if-regular]`.
- **NIP-10**: "Authors of the `e` and `q` tags SHOULD be added as `p` tags".
- **NIP-19**: relay and author TLVs are hints for finding an entity, not
  declarations of where someone reads.

## Who is tagged

The tagged people are the `p` tags of the template Publish signs, minus the
author. Nothing else decides it.

| In the content | `p` tag | Shown as |
| --- | --- | --- |
| `npub` / `nprofile` (also a bare `npub1…`, which applesauce repairs) | yes | mentioned |
| `naddr` (pubkey is part of the address) | yes | author of a quoted event |
| `note` / `nevent` whose event is in hand | yes, from the **signed event's** pubkey | author of a quoted note |
| `note` / `nevent` not found | no | "Quoted note not found, so its author isn't tagged" |
| yourself | a self-mention keeps its `p`; a self-quote adds none | never listed |

- A quoted author comes only from an event in the EventStore (signature
  verified on insert) and re-checked with `verifyEvent`. An nevent's author
  TLV is only passed to the loader as a place to look. If the signed event
  disagrees with it, the signed pubkey wins, in the `q` tag too.
- An unresolved quote keeps applesauce's `q` tag unchanged and adds no `p`.

## Not tagging someone

"Don't tag" removes that person's `p` tag from the signed note, and with it
their inbox rows. The mention or quote stays in the text, and `q`/`a` tags
stay. POST has no reply mode, so no `p` tag is structurally required; if a
reply mode is added, the parent's author must not be removable.

- The choice is kept per pubkey in the draft, so removing and re-adding the
  mention, or restoring the draft, does not silently tag them again.
- "Tag again" restores the tag and the inbox lookup. Relay unticks made
  before are kept.
- The UI does not promise privacy: the note is public, and the tag is only
  what clients use to notify.

## Relay rows

One row per normalized URL. Sections:

- **Your relays**: the account's NIP-65 write relays (or `FALLBACK_RELAYS`
  when it has none, labelled "default relay") and relays added by hand.
- **Tagged people's inboxes**: each tagged person's read relays, resolved via
  `relayListCache` → EventStore → `fetchRelayList` (indexers) and filtered
  like every other selection (kind 10006 blocked, localhost, `.onion`,
  liveness). Relay hints from content are never used.

A URL that is also one of the author's stays in the author section with
"also inbox of …". A URL two people read from is one row with both names.
Untagging one keeps the row for the others.

Inbox rows are checked by default for the first **4** relays of each person
and at most **12** in total. Rows past a limit, and unencrypted `ws://`
relays, are listed unchecked.

Per-person states: finding inbox relays…, N inbox relays (and how many the
blocklist removed), no usable inbox relays, no relay list found, relay list
lookup timed out, couldn't look up relay list.

## Selection model

Rows are derived. The user's decisions are stored separately:

- `overrides`: URL → on/off, only for relays the user toggled
- `addedRelays`
- `excludedRecipients`

Checked = `overrides[url] ?? row.defaultSelected`. A late answer (a slow
indexer, a person editing their kind 10002, the account's own list arriving
after a draft restore) adds or changes rows but never resets an override.
"Reset selection" clears the overrides.

## Drafts

`localStorage["grimoire-post-draft-<pubkey>[-<windowId>]"]`, version 2:
`{ version, editorState, overrides, addedRelays, excludedRecipients, timestamp }`.
Saved on edits and on every decision change (500 ms debounce). Switching
account loads that account's draft.

A version 1 draft (`selectedRelays`, `addedRelays`) keeps its content and
added relays. Only provable unticks carry over: an added relay missing from
`selectedRelays`. An account write relay missing from it is ambiguous
(unticked, or not in the list yet) and goes back to its default.

## Publish

1. Build the template, then wait for quoted notes still loading.
2. Rebuild with the verified quote authors; its `p` tags are the tagged people.
3. Wait for their inbox lookups. Steps 1–3 share **one 3 s deadline**; the
   button reads "Finding inboxes…".
4. Freeze the rows and the selection. The window shows the frozen rows, so a
   lookup that answers late cannot add a relay the note was not sent to.
5. Sign that same factory and publish to the frozen selection.

The result toast says, per tagged person, whether one of their inbox relays
**accepted** the note (a relay OK, not a delivery claim), whether none did,
or whether none was in the publish (unticked, no list, still looking). It
also counts quoted notes sent without their author tagged.

## Known limits

- The author's own kind 10002 is not re-broadcast to the relays used
  (NIP-65's third SHOULD).
