# Grimoire NIP Support Assessment

> Assessment date: 2026-02-12
> Total official NIPs: 101 (96 standard, 5 unrecommended/deprecated)

## Methodology

Each NIP is classified into one of four support levels:

- **FULL**: Dedicated renderers, helper functions, active logic, UI integration
- **PARTIAL**: Some functionality exists but incomplete (e.g., display-only renderer, commented-out adapter, or only metadata registered)
- **DISPLAY-ONLY**: Kind registered in `constants/kinds.ts` and NIP listed in `constants/nips.ts` — events render with the default renderer showing raw content, but no kind-specific rendering or interaction logic exists
- **NONE**: No functional code beyond possibly being referenced in documentation

---

## NIP Support Matrix

### Core Protocol (Foundational)

| NIP | Title | Support | Notes |
|-----|-------|---------|-------|
| 01 | Basic protocol flow | **FULL** | Event creation, signing, relay communication, REQ/EVENT/CLOSE/EOSE — foundational to the entire app |
| 02 | Follow List | **FULL** | Kind 3 renderer + detail view, contact list management, `$contacts` filter alias |
| 09 | Event Deletion Request | **FULL** | Kind 5 deletion action in `actions/delete-event.ts`, event deletion UI |
| 10 | Text Notes and Threads | **FULL** | Kind 1/11 renderers, NIP-10 `e` tag marker parsing via `getNip10References()`, threaded chat adapter |
| 11 | Relay Information Document | **FULL** | `useRelayInfo()` hook, NIP-11 fetch + cache in IndexedDB (24h TTL), `nip11.ts` types |
| 19 | bech32-encoded entities | **FULL** | `useNip19Decode()` hook, encode/decode for npub/nsec/note/nprofile/nevent/naddr throughout |
| 21 | nostr: URI scheme | **FULL** | Parsed in `MarkdownContent.tsx`, editor paste handler, round-trip serialize/deserialize |
| 42 | Authentication | **FULL** | `auth-state-machine.ts` full challenge/response state machine, relay auth prompts, preference storage |
| 65 | Relay List Metadata | **FULL** | Kind 10002 renderer + detail, outbox/inbox relay pattern, `relay-selection.ts`, relay list cache |

### Identity & Keys

| NIP | Title | Support | Notes |
|-----|-------|---------|-------|
| 05 | DNS-based identifiers | **FULL** | `useNip05()` hook, `nip05.ts` resolution, batch resolution, profile display component |
| 06 | Key derivation from mnemonic | **NONE** | No mnemonic/seed phrase handling. Users import keys directly or use extensions |
| 07 | window.nostr (browser extensions) | **FULL** | Login dialog supports NIP-07 extensions via applesauce-signers `NIP07Signer` |
| 39 | External Identities in Profiles | **DISPLAY-ONLY** | Kind registered, NIP listed. No identity verification UI or proof parsing |
| 46 | Nostr Remote Signing | **FULL** | Bunker URL support, QR code generation, NIP-46 connection flow in `LoginDialog.tsx` |
| 49 | Private Key Encryption | **NONE** | No ncryptsec handling |
| 55 | Android Signer Application | **NONE** | Web-only client, not applicable |

### Content & Social

| NIP | Title | Support | Notes |
|-----|-------|---------|-------|
| 14 | Subject tag | **PARTIAL** | `getTagValue(event, "subject")` extracted in `event-title.ts` for display titles, but not shown in note UIs |
| 18 | Reposts | **FULL** | Kind 6/16 `RepostRenderer`, compact preview, generic repost handling |
| 22 | Comment | **FULL** | Kind 1111 `Kind1111Renderer`, NIP-22 reply pointer parsing via `getCommentReplyPointer()` |
| 23 | Long-form Content | **FULL** | Kind 30023/30024 `ArticleRenderer` + detail, markdown rendering, article metadata helpers |
| 25 | Reactions | **FULL** | Kind 7/17 `ReactionRenderer`, emoji reactions, custom emoji support, reaction counts |
| 27 | Text Note References | **FULL** | Inline `nostr:` references rendered in `MarkdownContent.tsx`, editor mentions serialize to `nostr:` URIs |
| 30 | Custom Emoji | **FULL** | `emoji-helpers.ts`, `:shortcode:` parsing, emoji picker, emoji sets (kind 30030), zap request emoji tags |
| 36 | Sensitive Content | **PARTIAL** | `content-warning` tag type defined in schema. **No rendering logic** — no blur, no CW gate, no filter. Listed in TODO |
| 68 | Picture-first feeds | **FULL** | Kind 20 `PictureRenderer` with gallery/media handling |
| 71 | Video Events | **FULL** | Kind 21/22 `VideoRenderer`/`ShortVideoRenderer`, legacy 34235/34236 mapped |
| 7D | Threads | **FULL** | Kind 11 uses `Kind1Renderer`, registered in kind renderers |
| 84 | Highlights | **FULL** | Kind 9802 renderer + detail, highlight helpers from applesauce-common |
| 92 | Media Attachments (imeta) | **FULL** | Comprehensive `imeta.ts` (212 lines), `ImetaEntry` interface, used in post/chat/gallery/media components |
| A0 | Voice Messages | **FULL** | Kind 1222/1244 `VoiceMessageRenderer` with audio playback |
| A4 | Public Messages | **DISPLAY-ONLY** | Kind registered but no dedicated renderer or interaction logic found |
| C0 | Code Snippets | **FULL** | Kind 1337 renderer + detail, `nip-c0-helpers.ts` with language/filename/runtime extraction |

### Encryption & Private Messaging

| NIP | Title | Support | Notes |
|-----|-------|---------|-------|
| 04 | Encrypted Direct Message | **NONE** | Deprecated NIP. No kind 4 handling (correct decision) |
| 17 | Private Direct Messages | **PARTIAL** | Kind 14/15 registered in `kinds.ts`. Chat adapter **exists but commented out** in `chat-parser.ts` and `ChatViewer.tsx`. Skeleton ready, not enabled |
| 44 | Encrypted Payloads (Versioned) | **NONE** | Listed in `nips.ts` but no encryption/decryption logic. Required for NIP-17 DMs |
| 59 | Gift Wrap | **DISPLAY-ONLY** | Kind 1059/13 registered. No unwrap/wrap logic. Required for NIP-17 DMs |
| EE | E2EE Messaging (MLS) | **NONE** | Unrecommended/superseded NIP. Correctly not implemented |

### Lists & Organization (NIP-51)

| NIP | Title | Support | Notes |
|-----|-------|---------|-------|
| 51 | Lists | **FULL** | Comprehensive coverage — 20+ list kinds with dedicated renderers and detail views: mute (10000), pin (10001), bookmark (10003), community (10004), channels (10005), blocked relays (10006), search relays (10007), groups (10009), interests (10015), media follows (10020), emojis (10030), DM relays (10050), follow sets (30000), relay sets (30002), bookmark sets (30003), curation sets (30004-30006), kind mute (30007), interest sets (30015), starter packs (39089/39092) |

### Chat & Groups

| NIP | Title | Support | Notes |
|-----|-------|---------|-------|
| 28 | Public Chat | **PARTIAL** | Kind 40-44 registered. `PublicChatsRenderer` for channel lists. Chat adapter **commented out** |
| 29 | Relay-based Groups | **FULL** | `nip-29-adapter.ts` (500+ lines), full group management, membership, moderation, roles, messaging |
| 53 | Live Activities | **FULL** | `nip-53-adapter.ts` chat adapter, `LiveActivityRenderer` + detail, kind 1311 live chat messages |
| C7 | Chats | **PARTIAL** | Protocol type defined, chat adapter **commented out** but skeleton exists |

### Economic / Lightning / Ecash

| NIP | Title | Support | Notes |
|-----|-------|---------|-------|
| 47 | Nostr Wallet Connect | **FULL** | `nwc.ts` service, `WalletViewer`, balance/transactions, connection management |
| 57 | Lightning Zaps | **FULL** | Kind 9734/9735, `create-zap-request.ts`, `zap-relay-selection.ts`, `ZapReceiptRenderer`, anonymous zaps |
| 60 | Cashu Wallet | **DISPLAY-ONLY** | Kind 7374/7375/7376 registered. No cashu wallet logic |
| 61 | Nutzaps | **DISPLAY-ONLY** | Kind 9321/10019 registered. No nutzap logic |
| 75 | Zap Goals | **FULL** | `nip75-helpers.ts`, `GoalRenderer` + detail, `useGoalProgress()` hook |

### Relay Discovery & Management

| NIP | Title | Support | Notes |
|-----|-------|---------|-------|
| 43 | Relay Access Metadata | **PARTIAL** | Kind 8000/8001 `AddUserRenderer`/`RemoveUserRenderer`, kind 13534 `RelayMembersRenderer`. Partial coverage of the spec |
| 45 | Counting results | **NONE** | No COUNT message support |
| 50 | Search Capability | **NONE** | No `search` filter field support in REQ system. Profile search exists but is local, not NIP-50 |
| 66 | Relay Discovery & Liveness | **FULL** | `nip66-helpers.ts`, `MonitorAnnouncementRenderer`, `RelayDiscoveryRenderer` + details, RTT/network metrics |
| 77 | Negentropy Syncing | **NONE** | No negentropy sync support |
| 86 | Relay Management API | **NONE** | No relay management API client |

### Moderation & Reporting

| NIP | Title | Support | Notes |
|-----|-------|---------|-------|
| 32 | Labeling | **DISPLAY-ONLY** | Kind 1985 registered. No label creation or filtering UI |
| 56 | Reporting | **FULL** | `nip56-helpers.ts`, `ReportRenderer` + detail, report type parsing (nudity, malware, spam, etc.) |
| 70 | Protected Events | **NONE** | No `-` tag handling |

### Specialized Content

| NIP | Title | Support | Notes |
|-----|-------|---------|-------|
| 03 | OpenTimestamps | **DISPLAY-ONLY** | Kind 1040 registered. No OTS verification logic |
| 15 | Nostr Marketplace | **DISPLAY-ONLY** | Kinds registered. No stall/product browsing UI |
| 34 | Git stuff | **FULL** | `nip34-helpers.ts` (600+ lines), full renderers for repos/patches/issues/PRs, status events, `GraspListRenderer` |
| 35 | Torrents | **DISPLAY-ONLY** | Kind 2003/2004 registered. No torrent UI |
| 37 | Draft Events | **DISPLAY-ONLY** | Kind 31234 registered. No draft management UI (but spell drafts use a different system) |
| 38 | User Statuses | **DISPLAY-ONLY** | Kind 30315 registered. No status display in profiles or status updates |
| 52 | Calendar Events | **FULL** | Kind 31922/31923 `CalendarDateEventRenderer`/`CalendarTimeEventRenderer` + details, RSVP kinds |
| 54 | Wiki | **PARTIAL** | Wiki author/relay lists (10101/10102) have renderers. Kind 30818/30819 (wiki pages) registered but no page renderer |
| 58 | Badges | **FULL** | `nip58-helpers.ts`, badge definition/award/profile renderers + details |
| 62 | Request to Vanish | **DISPLAY-ONLY** | Kind 62 registered. No vanish request handling |
| 64 | Chess (PGN) | **DISPLAY-ONLY** | Kind 64 registered. No chess board rendering |
| 72 | Moderated Communities | **PARTIAL** | Kind 34550 `CommunityNIPRenderer` + detail. Kind 4550 (approval) registered. Community list renderer exists |
| 78 | Application-specific data | **DISPLAY-ONLY** | Kind 30078 registered. Generic by nature |
| 85 | Trusted Assertions | **NONE** | No implementation |
| 87 | Ecash Mint Discoverability | **DISPLAY-ONLY** | Kind 38172/38173 registered. No mint discovery UI |
| 88 | Polls | **FULL** | `nip88-helpers.ts`, `PollRenderer`/`PollResponseRenderer` + details, single/multiple choice |
| 89 | App Handlers | **FULL** | `nip89-helpers.ts`, `ApplicationHandlerRenderer`/`HandlerRecommendationRenderer` + details |
| 90 | Data Vending Machines | **DISPLAY-ONLY** | Kind ranges registered. No DVM request/response UI |
| 94 | File Metadata | **FULL** | Kind 1063 `FileMetadataRenderer` |
| 99 | Classified Listings | **DISPLAY-ONLY** | Kind 30402/30403 registered. No classified browsing UI |

### File Storage & Auth

| NIP | Title | Support | Notes |
|-----|-------|---------|-------|
| 96 | HTTP File Storage | **DISPLAY-ONLY** | Unrecommended. Kind 10096 registered |
| 98 | HTTP Auth | **DISPLAY-ONLY** | Kind 27235 registered. No HTTP auth signing logic |
| B0 | Web Bookmarks | **FULL** | Kind 39701 `BookmarkRenderer` |
| B7 | Blossom | **FULL** | `blossom.ts` service, upload dialog, blossom viewer, server list renderer, server cache |

### Commerce

| NIP | Title | Support | Notes |
|-----|-------|---------|-------|
| 69 | P2P Order Events | **FULL** | `nip69-helpers.ts`, `P2pOrderRenderer` + detail, order metadata extraction |
| 73 | External Content IDs | **NONE** | No `i` tag handling |

### Protocol Extensions

| NIP | Title | Support | Notes |
|-----|-------|---------|-------|
| 13 | Proof of Work | **PARTIAL** | `min_pow_difficulty` parsed from NIP-11 relay info. Displayed in relay discovery. No PoW computation |
| 24 | Extra metadata fields | **NONE** | No specific handling |
| 31 | Unknown Events (alt tag) | **FULL** | Alt tag added to published spells for NIP-31 compatibility |
| 40 | Expiration Timestamp | **PARTIAL** | Expiration tag parsed in `nip69-helpers.ts` for P2P orders. Not checked globally on all events |
| 48 | Proxy Tags | **NONE** | No proxy tag handling |
| BE | Nostr BLE | **NONE** | Not applicable to web client |

### Deprecated/Unrecommended

| NIP | Title | Support | Notes |
|-----|-------|---------|-------|
| 04 | Encrypted DM (deprecated) | **NONE** | Correctly not implemented |
| 08 | Handling Mentions (deprecated) | **NONE** | Superseded by NIP-27 |
| 26 | Delegated Event Signing | **NONE** | Unrecommended |
| 96 | HTTP File Storage | **DISPLAY-ONLY** | Superseded by NIP-B7 Blossom |
| EE | E2EE via MLS | **NONE** | Superseded |

---

## Summary Counts

| Support Level | Count | Percentage |
|---------------|-------|------------|
| **FULL** | 46 | 45.5% |
| **PARTIAL** | 11 | 10.9% |
| **DISPLAY-ONLY** | 21 | 20.8% |
| **NONE** | 23 | 22.8% |

Of the 23 "NONE" NIPs, 5 are deprecated/unrecommended, 2 are not applicable to web (NIP-55 Android, NIP-BE BLE), leaving **16 standard NIPs with no support**.

---

## Strategic Analysis for a Developer/Power-User Tool

### Critical Missing Features

These are NIPs whose absence significantly limits Grimoire as a developer tool:

#### 1. NIP-17 + NIP-44 + NIP-59: Private Direct Messages (HIGH PRIORITY)
**Impact**: Cannot send or receive DMs — a fundamental communication channel.

The adapter skeleton already exists and is commented out. The blocking dependency is NIP-44 (encryption) and NIP-59 (gift wrap). This is the single largest feature gap for any Nostr client.

**Work required**: Implement NIP-44 encryption via applesauce-signers, implement NIP-59 gift wrap/unwrap logic, uncomment and finalize the NIP-17 chat adapter.

#### 2. NIP-50: Search Capability (HIGH PRIORITY)
**Impact**: A developer tool without relay-side search is severely limited. Users can only browse by explicit filters (kind, author, time range) but cannot full-text search event content.

**Work required**: Add `search` field to the REQ filter builder. Relay info already shows supported NIPs — could auto-detect NIP-50 support. Natural extension to the existing `req` command.

#### 3. NIP-86: Relay Management API (MEDIUM-HIGH PRIORITY)
**Impact**: Power users and relay operators need to inspect and manage relays. This would be a differentiating feature for Grimoire as a dev tool — no other client focuses on this.

**Work required**: Implement the relay management API client (HTTP-based JSON-RPC). Create a relay admin viewer command.

#### 4. NIP-45: Counting Results (MEDIUM PRIORITY)
**Impact**: Useful for developers inspecting relay data volume, event statistics. Lightweight addition.

**Work required**: Add COUNT message type to relay communication. Could be a simple command: `count -k 1 -a <pubkey>`.

#### 5. NIP-77: Negentropy Syncing (MEDIUM PRIORITY)
**Impact**: Efficient sync protocol for large datasets. Important for dev tools that need to ensure complete data.

**Work required**: Integrate negentropy protocol library. Useful as an advanced sync command.

---

### Low-Hanging Fruit

These are improvements that require minimal effort for meaningful gains:

#### 1. NIP-36: Sensitive Content / Content Warning (TRIVIAL)
**Status**: Schema already defines `content-warning` tag. Just needs rendering logic.

**Work**: Check for `content-warning` tag in event renderers, show a blur/gate with the warning text. ~50 lines of code in a wrapper component.

#### 2. NIP-40: Global Expiration Checking (TRIVIAL)
**Status**: Already parsed for P2P orders. Just needs global application.

**Work**: Add expiration check to event rendering — if `expiration` tag exists and timestamp has passed, show "expired" indicator or dim the event. ~20 lines.

#### 3. NIP-14: Subject Tag Display (TRIVIAL)
**Status**: Already extracted in `event-title.ts`. Just not shown in note renderers.

**Work**: Show subject as a header/title in `Kind1Renderer` when present. ~10 lines.

#### 4. NIP-13: Proof of Work Display (EASY)
**Status**: Already parsed from relay info. Just needs event-level display.

**Work**: Calculate leading zero bits from event ID, show PoW badge on events with significant work. ~30 lines. Could also add PoW to the REQ viewer as a filter/sort option.

#### 5. NIP-32: Labeling Display (EASY)
**Status**: Kind 1985 registered. Just needs a renderer.

**Work**: Create a `LabelRenderer` that shows namespace, label value, and referenced events. Useful for developer inspection of label ecosystems. ~100 lines.

#### 6. NIP-38: User Status Display (EASY)
**Status**: Kind 30315 registered.

**Work**: Fetch kind 30315 in `ProfileViewer` and show current status (general, music). Small addition to profile display. ~50 lines.

#### 7. NIP-70: Protected Events Indicator (TRIVIAL)
**Status**: No code.

**Work**: Check for `["-"]` tag, show a lock/shield icon. ~10 lines in `BaseEventRenderer`.

---

### NIP Integrations to Expand and Support Better

These are NIPs with partial support that could be elevated to full with moderate effort:

#### 1. NIP-54: Wiki Pages (MEDIUM)
**Status**: Wiki author/relay list renderers exist. Missing wiki page (kind 30818) renderer.

**Opportunity**: Wiki pages are long-form content with specific structure. Create a `WikiPageRenderer` that shows title, content (markdown), and edit history via replaceable event versioning. Grimoire's markdown rendering infra already supports this.

#### 2. NIP-28: Public Chat Channels (MEDIUM)
**Status**: Channel list renderer exists. Chat adapter commented out.

**Opportunity**: Uncomment the NIP-28 adapter. Public channels are simpler than DMs (no encryption needed). This would give Grimoire three active chat protocols.

#### 3. NIP-90: Data Vending Machines (MEDIUM-HIGH)
**Status**: Kind ranges registered. No interaction logic.

**Opportunity**: DVMs are a hot area of Nostr development. A DVM explorer/tester command would be extremely valuable for developers — send job requests, inspect responses, browse available DVMs. Fits Grimoire's power-user identity perfectly.

#### 4. NIP-72: Moderated Communities (MEDIUM)
**Status**: Community definition renderer exists. Missing community feed browsing.

**Opportunity**: Show approved posts within a community, display moderator actions. Extends existing community list renderer.

#### 5. NIP-15 + NIP-99: Marketplace & Classifieds (MEDIUM)
**Status**: Kinds registered, no browsing UI.

**Opportunity**: Stall/product/classified browsing would be useful for inspecting the Nostr commerce ecosystem. Feed renderers for kinds 30017/30018/30402 would surface this data.

#### 6. NIP-43: Relay Access Metadata (EXPAND)
**Status**: Add/remove user renderers exist, relay members renderer exists. Missing request-to-join flow.

**Opportunity**: Complete the relay access management cycle — show access requirements, handle requests, display access grants/denials. Important for authenticated relay ecosystems.

#### 7. NIP-39: External Identities (EASY-MEDIUM)
**Status**: Listed but no implementation.

**Opportunity**: Parse identity claims from kind 0 profiles, display verified external identities (GitHub, Twitter, etc.) in profile viewer. Valuable for developer profiles.

---

### Developer-Specific Opportunities (Unique to Grimoire)

These aren't about individual NIP support but about how Grimoire's developer-tool identity could leverage NIPs uniquely:

#### 1. NIP Event Inspector Enhancement
Already strong with the REQ viewer. Could add:
- NIP-50 search integration
- NIP-45 count queries
- NIP-13 PoW analysis
- Event signature verification display
- Tag structure visualization

#### 2. Relay Developer Console
Combine NIP-11 info (already full), NIP-86 management API (missing), NIP-66 discovery (full), NIP-42 auth (full), and NIP-45 counting (missing) into a comprehensive relay operations tool.

#### 3. DVM Playground
NIP-90 interactive tester — pick a DVM, craft a job request, watch the response. Would be unique among Nostr clients.

#### 4. Protocol Compliance Checker
Use known NIP specs to validate events — check if a kind 30023 article has all required tags, verify NIP-10 threading markers, validate NIP-57 zap receipts. Useful for app developers debugging their implementations.

---

### Priority Ranking (for developer/power-user audience)

| Priority | Item | Effort | Impact |
|----------|------|--------|--------|
| 1 | NIP-36 content warnings | Trivial | High (safety) |
| 2 | NIP-50 search in REQ | Low | High (core dev feature) |
| 3 | NIP-14 subject display | Trivial | Low-Medium |
| 4 | NIP-13 PoW display | Easy | Medium (dev insight) |
| 5 | NIP-70 protected indicator | Trivial | Low |
| 6 | NIP-40 global expiration | Trivial | Low-Medium |
| 7 | NIP-32 label renderer | Easy | Medium (dev insight) |
| 8 | NIP-38 user status | Easy | Low-Medium |
| 9 | NIP-28 public chat (uncomment) | Medium | Medium |
| 10 | NIP-90 DVM explorer | Medium-High | High (dev differentiator) |
| 11 | NIP-86 relay management | Medium-High | High (dev differentiator) |
| 12 | NIP-17/44/59 DMs | High | High (fundamental feature) |
| 13 | NIP-54 wiki pages | Medium | Medium |
| 14 | NIP-45 COUNT support | Low | Medium (dev feature) |
| 15 | NIP-39 external identities | Easy-Medium | Low-Medium |
| 16 | NIP-77 negentropy sync | High | Medium (advanced) |
