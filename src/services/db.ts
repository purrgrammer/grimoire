import { ProfileContent } from "applesauce-core/helpers";
import { Dexie, Table } from "dexie";
import { RelayInformation } from "../types/nip11";
import { normalizeRelayURL } from "../lib/relay-url";
import type { EmojiTag } from "../lib/emoji-helpers";
import type { NostrEvent } from "@/types/nostr";
import type { ChatProtocol } from "@/types/chat";
import type {
  SpellEvent,
  SpellbookContent,
  SpellbookEvent,
} from "@/types/spell";

export interface Profile extends ProfileContent {
  pubkey: string;
  created_at: number;
  /** NIP-30 emoji tags from the kind 0 event, for shortcodes in the name */
  emojis?: EmojiTag[];
}

export interface Nip05 {
  nip05: string;
  pubkey: string;
}

export interface Nip {
  id: string;
  content: string;
  fetchedAt: number;
}

export interface RelayInfo {
  url: string;
  info: RelayInformation;
  fetchedAt: number;
}

export interface RelayAuthPreference {
  url: string;
  preference: "always" | "never" | "ask";
  updatedAt: number;
}

export interface CachedRelayList {
  pubkey: string;
  event: NostrEvent;
  read: string[];
  write: string[];
  updatedAt: number;
}

export interface RelayLivenessEntry {
  url: string;
  state: "online" | "offline" | "dead";
  failureCount: number;
  lastFailureTime: number;
  lastSuccessTime: number;
  backoffUntil?: number;
}

export interface CachedBlossomServerList {
  pubkey: string;
  event: NostrEvent;
  servers: string[];
  updatedAt: number;
}

export interface LocalSpell {
  id: string; // UUID for local-only spells, or event ID for published spells
  alias?: string; // Optional local-only quick name (e.g., "btc")
  name?: string; // Optional spell name (published to Nostr or mirrored from event)
  command: string; // REQ command
  description?: string; // Optional description
  createdAt: number; // Timestamp
  isPublished: boolean; // Whether it's been published to Nostr
  eventId?: string; // Nostr event ID if published
  event?: SpellEvent; // Full signed event for rebroadcasting
  deletedAt?: number; // Timestamp when soft-deleted
}

export interface LocalSpellbook {
  id: string; // UUID for local-only, or event ID for published
  slug: string; // d-tag for replaceable events
  title: string; // Human readable title
  description?: string; // Optional description
  content: SpellbookContent; // JSON payload
  createdAt: number;
  isPublished: boolean;
  eventId?: string;
  event?: SpellbookEvent;
  deletedAt?: number;
}

export interface LnurlCache {
  address: string; // Primary key (e.g., "user@domain.com")
  callback: string; // LNURL callback URL
  minSendable: number; // Min amount in millisats
  maxSendable: number; // Max amount in millisats
  metadata: string; // LNURL metadata
  tag: "payRequest"; // LNURL tag (always "payRequest" for LNURL-pay)
  allowsNostr?: boolean; // Zap support
  nostrPubkey?: string; // Pubkey for zap receipts
  commentAllowed?: number; // Max comment length
  fetchedAt: number; // Timestamp for cache invalidation
}

export interface CachedNsiteMetadata {
  hash: string; // Primary key - sha256 of index.html (content-addressable, never expires)
  title?: string;
  description?: string;
  faviconUrl?: string;
}

export interface GrimoireZap {
  eventId: string; // Primary key - zap receipt event ID
  senderPubkey: string; // Who sent the zap
  amountSats: number; // Amount in sats (not msats)
  timestamp: number; // Unix timestamp when zap was sent (created_at)
  comment?: string; // Optional zap comment/message
}

export interface CachedUserEmojiList {
  pubkey: string; // Primary key
  event: NostrEvent; // Raw kind 10030 event
  emojis: Array<{ shortcode: string; url: string }>; // Derived inline emoji tags
  setAddresses: string[]; // Derived "a" tag coordinates for referenced 30030 sets
  updatedAt: number;
}

export interface CachedEmojiSet {
  address: string; // Primary key: "30030:pubkey:identifier"
  event: NostrEvent; // Raw kind 30030 event
  emojis: Array<{ shortcode: string; url: string }>; // Derived emoji tags
  updatedAt: number;
}

/**
 * One Concord membership, as decrypted out of the viewer's kind-13302 list.
 *
 * Keyed by `[pubkey+idHex]`, never by community id alone: the row holds a
 * decrypted `community_root` and private-channel keys, so one account must
 * never read another's vault, and account removal needs a column to wipe by.
 *
 * The RAW list entry is stored, not a rehydrated `Community` — the document is
 * cross-client and carries fields this version doesn't understand, and
 * rehydration is pure and cheap enough to redo on every read.
 */
export interface ConcordCommunityRow {
  pubkey: string; // The viewer whose list this came from
  idHex: string; // community_id, lowercase hex
  entry: unknown; // CommunityListEntry, verbatim
  name: string; // Join-time preview name, for lookup without rehydrating
  listEventId: string; // The kind 13302 this was decrypted from
  listCreatedAt: number;
  updatedAt: number;
}

/**
 * A decrypted Concord rumor. Rumors only, never wraps: the wrap is opened once
 * at ingest and the rumor its author signed is what persists, so a chat read is
 * an ordinary indexed query with no crypto. `communityId` is in every index and
 * MUST be in every query — it is what keeps one community's planes out of
 * another's. Populated from phase 5.
 */
export interface ConcordRumorRow {
  id: string;
  communityId: string;
  kind: number;
  channel?: string;
  created_at: number;
  pubkey: string;
  content: string;
  tags: string[][];
}

/** Control-snapshot rumor-id sets, per community epoch. Populated from phase 4. */
export interface ConcordSnapshotRow {
  communityId: string;
  controlPk: string;
  rumorIds: string[];
  updatedAt: number;
}

/** Small opaque Concord blobs (the groupKey derivation memo, wire cursors). */
export interface ConcordKvRow {
  key: string;
  value: unknown;
}

/**
 * A Concord wrap the wire could not open, held until a key for it arrives.
 *
 * **The one place a wrap is persisted.** Everywhere else a wrap is opened at
 * ingest and only the rumor its author signed is stored (`ConcordRumorRow`).
 * The exception exists because a standing subscription has no "later": a wrap
 * authored by a stream address this member holds no key for yet — a rekey not
 * caught up with, a channel granted moments ago — is ordinary rather than an
 * error, and dropping it makes that history recoverable only by a backfill that
 * may never run.
 *
 * Stored WITHOUT its signature: a wrap is signed by a throwaway ephemeral key
 * that nothing ever checks (authorship is proved by the seal sealed inside it,
 * CORD-01), so there is nothing here worth preserving. Ciphertext at rest, which
 * is a weaker exposure than the decrypted rumors stored beside it.
 *
 * `pubkey` is the stream address, which is the only way a plane finds its own.
 * `created_at` carries the age prune.
 */
export interface ConcordPendingWrapRow {
  id: string;
  pubkey: string;
  kind: number;
  created_at: number;
  content: string;
  tags: string[][];
}

/**
 * Key material this device adopted from a CORD-06 rotation, keyed by account.
 *
 * Grimoire never publishes kind 13302, so an adoption cannot go where armada
 * puts it — into the member's own Community List. It lands here instead, and
 * the reader layers it over the rehydrated list entry. The list stays the
 * source of truth; this is a cache allowed to run AHEAD of it, and both
 * directions heal: if armada is offline when a rotation lands, grimoire adopts
 * locally; if grimoire is offline, it picks the same key up from the refreshed
 * list on the next read and drops its own copy as stale.
 *
 * Keyed by `[pubkey+idHex]` for the same reason the vault is: these are
 * decrypted community roots and channel keys, so keying by community alone
 * would let one account read another's, and account removal would have no
 * column to wipe by.
 *
 * Everything is hex — this row is JSON in IndexedDB, and a `Uint8Array` round
 * trips through structured clone in ways that differ across browsers.
 */
export interface ConcordAdoptionRow {
  pubkey: string;
  idHex: string;
  /** Adopted root epochs, newest first. `retiredAt` belongs to the epoch it retired. */
  roots: Array<{
    epoch: string;
    key: string;
    controlPk?: string;
    controlRoot?: string;
    refounder?: string;
    /** Epoch-seconds the rotation published — the retired root's read cutoff. */
    retiredAt?: number;
  }>;
  /** Adopted private-channel keys, one entry per channel. */
  channels: Array<{
    idHex: string;
    epoch: string;
    key: string;
    priors?: Array<{ epoch: string; key: string; retiredAt?: number }>;
  }>;
  /** Channels a rotation cut us out of: the epoch that excluded us. */
  cuts: Array<{ idHex: string; epoch: string }>;
  /** The root epoch a rotation excluded us at, if one did. */
  excludedAtEpoch?: string;
  updatedAt: number;
}

/**
 * How far into one chat channel the reading account has caught up.
 *
 * Keyed by `[pubkey+protocol+containerId+channelId]` rather than by channel
 * alone, and every segment is load-bearing:
 *
 * - `pubkey` because read state is a fact about a READER — keying it by channel
 *   would show one account another's badges the moment a second signs in. The
 *   standalone index on it is what lets the logout wipe delete this account's
 *   rows and only this account's, unlike the rumor store beside it.
 * - `protocol` because a channel id is only unique WITHIN a protocol. This is
 *   the cursor every chat protocol will share: the shape is generic even while
 *   the only writer is Concord, and adding the discriminator later would mean
 *   re-keying a populated table, which Dexie cannot do in place.
 * - `containerId` because a channel id alone is never an identity. A NIP-29
 *   group is `(relay, id)` — the same id forked onto another relay is a
 *   different room under different governance — so the container is part of the
 *   key by rule, not by convenience.
 *
 * `containerId` is the Concord community idHex today; for NIP-29 it would be
 * the relay URL. Ids are stored LOWERCASE (the rumor store lowercases channel
 * ids at write, so a mixed-case key here would never match a scan) — a relay
 * URL survives that unharmed, since scheme and host are case-insensitive.
 *
 * `lastRead` is unix SECONDS, because it is compared against message
 * `created_at`; `updatedAt` is milliseconds and is bookkeeping only.
 */
export interface ChatReadRow {
  pubkey: string;
  /** {@link ChatProtocol}. `"concord"` for every row written so far. */
  protocol: ChatProtocol;
  /** Concord: community idHex. NIP-29 (later): relay URL. Lowercase. */
  containerId: string;
  channelId: string;
  /** Unix SECONDS. Everything at or below this is read. */
  lastRead: number;
  /** Milliseconds. Bookkeeping; nothing reads it. */
  updatedAt: number;
}

/**
 * A message this account has asked to send and no relay has taken yet.
 *
 * The INTENT, never a sealed wrap. A wrap is sealed under the channel's current
 * epoch and its rumor id commits to the timestamp and NIP-40 deadline stamped
 * when it was built, so one that waited out a CORD-06 rotation is undecodable
 * to the members it was for, and one that waited out its disappearing timer is
 * refused by `writeChatRumors` on arrival. Every attempt therefore rebuilds
 * from these fields and produces a NEW rumor id — which is why `id` is a uuid
 * and not a rumor id, and why `lastAttemptRumorId` is tracked separately.
 *
 * Kinds 9 and 1111 only. A reaction or a self-delete keeps the strict
 * publish-first contract and throws on failure, so nothing else can appear
 * here — which is what lets the timeline merge treat every row as a message.
 *
 * Plaintext at rest, like the rumor store beside it: logout wipes it.
 *
 * NOT protocol-qualified, unlike `chatReads` and the chat drafts, and that is a
 * decision rather than an oversight. Everything the drain does is Concord's:
 * it reseals the intent under the channel's CURRENT epoch key, re-resolves the
 * parent rumor id, and hands the result to the plane. A NIP-29 send is a signed
 * public event with none of that around it, so it would need its own queue and
 * its own retry rules, not a row here under a different discriminator. The
 * shared shapes are the ones a second protocol could actually occupy.
 */
export interface ConcordOutboxRow {
  /** uuid. NOT a rumor id — a rebuild changes that. */
  id: string;
  /** The sending account, for scoping and for the logout wipe. */
  pubkey: string;
  communityId: string;
  /** Channel idHex, lowercase. */
  channel: string;
  /** KIND_MESSAGE (9) or KIND_COMMENT (1111). */
  kind: number;
  content: string;
  /** Parent RUMOR id, re-resolved at every attempt rather than preserved. */
  replyToId?: string;
  /** Emoji and imeta tags, as the send path built them. */
  extraTags?: string[][];
  /** Enqueue time in SECONDS — what the reader sees while it is pending. */
  createdAt: number;
  status: "sending" | "failed";
  attempts: number;
  /** Seconds. A refusal's backoff, or {@link OUTBOX_NEVER} for a dead row. */
  nextAttemptAt?: number;
  lastError?: string;
  /** The rumor id of the most recent build — the at-least-once dedupe key. */
  lastAttemptRumorId?: string;
}

/**
 * A half-typed message, kept so switching channels does not eat it.
 *
 * `key` is `${accountPubkey}:${protocol}:${conversationId}`. The account comes
 * FIRST and is not optional: grimoire is multi-account, and a key without it
 * would show one account the draft another was writing. It is also what the
 * logout wipe deletes by, since this table has no other column for it.
 *
 * `content` is tiptap's JSON document, stored whole rather than as text so the
 * mentions, emoji and attachments in it survive the round trip.
 */
export interface ChatDraftRow {
  key: string;
  content: unknown;
  replyToId?: string;
  /** Milliseconds. */
  updatedAt: number;
}

/** A failure nothing will retry on its own — only the reader's own Retry. */
export const OUTBOX_NEVER = Number.MAX_SAFE_INTEGER;

/** Exported for the migration tests, which open a throwaway database name. */
export class GrimoireDb extends Dexie {
  profiles!: Table<Profile>;
  nip05!: Table<Nip05>;
  nips!: Table<Nip>;
  relayInfo!: Table<RelayInfo>;
  relayAuthPreferences!: Table<RelayAuthPreference>;
  relayLists!: Table<CachedRelayList>;
  relayLiveness!: Table<RelayLivenessEntry>;
  blossomServers!: Table<CachedBlossomServerList>;
  spells!: Table<LocalSpell>;
  spellbooks!: Table<LocalSpellbook>;
  lnurlCache!: Table<LnurlCache>;
  nsiteMetadata!: Table<CachedNsiteMetadata>;
  grimoireZaps!: Table<GrimoireZap>;
  userEmojiLists!: Table<CachedUserEmojiList>;
  emojiSets!: Table<CachedEmojiSet>;
  concordCommunities!: Table<ConcordCommunityRow>;
  concordRumors!: Table<ConcordRumorRow>;
  concordSnapshots!: Table<ConcordSnapshotRow>;
  concordKv!: Table<ConcordKvRow>;
  concordPendingWraps!: Table<ConcordPendingWrapRow>;
  concordAdoptions!: Table<ConcordAdoptionRow>;
  chatReads!: Table<ChatReadRow>;
  concordOutbox!: Table<ConcordOutboxRow>;
  chatDrafts!: Table<ChatDraftRow>;

  constructor(name: string) {
    super(name);

    // Version 5: Current schema
    this.version(5).stores({
      profiles: "&pubkey",
      nip05: "&nip05",
      nips: "&id",
      relayInfo: "&url",
      relayAuthPreferences: "&url",
    });

    // Version 6: Normalize relay URLs
    this.version(6)
      .stores({
        profiles: "&pubkey",
        nip05: "&nip05",
        nips: "&id",
        relayInfo: "&url",
        relayAuthPreferences: "&url",
      })
      .upgrade(async (tx) => {
        // Migrate relayAuthPreferences
        const authPrefs = await tx
          .table<RelayAuthPreference>("relayAuthPreferences")
          .toArray();
        const normalizedAuthPrefs = new Map<string, RelayAuthPreference>();
        let skippedAuthPrefs = 0;

        for (const pref of authPrefs) {
          try {
            const normalizedUrl = normalizeRelayURL(pref.url);
            const existing = normalizedAuthPrefs.get(normalizedUrl);

            // Keep the most recent preference if duplicates exist
            if (!existing || pref.updatedAt > existing.updatedAt) {
              normalizedAuthPrefs.set(normalizedUrl, {
                ...pref,
                url: normalizedUrl,
              });
            }
          } catch (error) {
            skippedAuthPrefs++;
            console.warn(
              `[DB Migration v6] Skipping invalid relay URL in auth preferences: ${pref.url}`,
              error,
            );
          }
        }

        await tx.table("relayAuthPreferences").clear();
        await tx
          .table("relayAuthPreferences")
          .bulkAdd(Array.from(normalizedAuthPrefs.values()));
        // Migrate relayInfo
        const relayInfos = await tx.table<RelayInfo>("relayInfo").toArray();
        const normalizedRelayInfos = new Map<string, RelayInfo>();
        let skippedRelayInfos = 0;

        for (const info of relayInfos) {
          try {
            const normalizedUrl = normalizeRelayURL(info.url);
            const existing = normalizedRelayInfos.get(normalizedUrl);

            // Keep the most recent info if duplicates exist
            if (!existing || info.fetchedAt > existing.fetchedAt) {
              normalizedRelayInfos.set(normalizedUrl, {
                ...info,
                url: normalizedUrl,
              });
            }
          } catch (error) {
            skippedRelayInfos++;
            console.warn(
              `[DB Migration v6] Skipping invalid relay URL in relay info: ${info.url}`,
              error,
            );
          }
        }

        await tx.table("relayInfo").clear();
        await tx
          .table("relayInfo")
          .bulkAdd(Array.from(normalizedRelayInfos.values()));
      });

    // Version 7: Add relay lists caching
    this.version(7).stores({
      profiles: "&pubkey",
      nip05: "&nip05",
      nips: "&id",
      relayInfo: "&url",
      relayAuthPreferences: "&url",
      relayLists: "&pubkey, updatedAt",
    });

    // Version 8: Add relay liveness tracking
    this.version(8).stores({
      profiles: "&pubkey",
      nip05: "&nip05",
      nips: "&id",
      relayInfo: "&url",
      relayAuthPreferences: "&url",
      relayLists: "&pubkey, updatedAt",
      relayLiveness: "&url",
    });

    // Version 9: Add local spell storage
    this.version(9).stores({
      profiles: "&pubkey",
      nip05: "&nip05",
      nips: "&id",
      relayInfo: "&url",
      relayAuthPreferences: "&url",
      relayLists: "&pubkey, updatedAt",
      relayLiveness: "&url",
      spells: "&id, createdAt, isPublished",
    });

    // Version 10: Rename localName → alias, add name field
    this.version(10)
      .stores({
        profiles: "&pubkey",
        nip05: "&nip05",
        nips: "&id",
        relayInfo: "&url",
        relayAuthPreferences: "&url",
        relayLists: "&pubkey, updatedAt",
        relayLiveness: "&url",
        spells: "&id, createdAt, isPublished",
      })
      .upgrade(async (tx) => {
        const spells = await tx.table<any>("spells").toArray();

        for (const spell of spells) {
          // Rename localName → alias
          if (spell.localName) {
            spell.alias = spell.localName;
            delete spell.localName;
          }

          // Initialize name field (will be populated from published events)
          if (!spell.name) {
            spell.name = undefined;
          }

          await tx.table("spells").put(spell);
        }
      });

    // Version 11: Add index for spell alias
    this.version(11).stores({
      profiles: "&pubkey",
      nip05: "&nip05",
      nips: "&id",
      relayInfo: "&url",
      relayAuthPreferences: "&url",
      relayLists: "&pubkey, updatedAt",
      relayLiveness: "&url",
      spells: "&id, alias, createdAt, isPublished",
    });

    // Version 12: Add full event storage for spells
    this.version(12).stores({
      profiles: "&pubkey",
      nip05: "&nip05",
      nips: "&id",
      relayInfo: "&url",
      relayAuthPreferences: "&url",
      relayLists: "&pubkey, updatedAt",
      relayLiveness: "&url",
      spells: "&id, alias, createdAt, isPublished",
    });

    // Version 13: Add index for deletedAt
    this.version(13).stores({
      profiles: "&pubkey",
      nip05: "&nip05",
      nips: "&id",
      relayInfo: "&url",
      relayAuthPreferences: "&url",
      relayLists: "&pubkey, updatedAt",
      relayLiveness: "&url",
      spells: "&id, alias, createdAt, isPublished, deletedAt",
    });

    // Version 14: Add local spellbook storage
    this.version(14).stores({
      profiles: "&pubkey",
      nip05: "&nip05",
      nips: "&id",
      relayInfo: "&url",
      relayAuthPreferences: "&url",
      relayLists: "&pubkey, updatedAt",
      relayLiveness: "&url",
      spells: "&id, alias, createdAt, isPublished, deletedAt",
      spellbooks: "&id, slug, title, createdAt, isPublished, deletedAt",
    });

    // Version 15: Add blossom server list caching
    this.version(15).stores({
      profiles: "&pubkey",
      nip05: "&nip05",
      nips: "&id",
      relayInfo: "&url",
      relayAuthPreferences: "&url",
      relayLists: "&pubkey, updatedAt",
      relayLiveness: "&url",
      blossomServers: "&pubkey, updatedAt",
      spells: "&id, alias, createdAt, isPublished, deletedAt",
      spellbooks: "&id, slug, title, createdAt, isPublished, deletedAt",
    });

    // Version 16: Add LNURL address caching
    this.version(16).stores({
      profiles: "&pubkey",
      nip05: "&nip05",
      nips: "&id",
      relayInfo: "&url",
      relayAuthPreferences: "&url",
      relayLists: "&pubkey, updatedAt",
      relayLiveness: "&url",
      blossomServers: "&pubkey, updatedAt",
      spells: "&id, alias, createdAt, isPublished, deletedAt",
      spellbooks: "&id, slug, title, createdAt, isPublished, deletedAt",
      lnurlCache: "&address, fetchedAt",
    });

    // Version 17: Add Grimoire donation tracking
    this.version(17).stores({
      profiles: "&pubkey",
      nip05: "&nip05",
      nips: "&id",
      relayInfo: "&url",
      relayAuthPreferences: "&url",
      relayLists: "&pubkey, updatedAt",
      relayLiveness: "&url",
      blossomServers: "&pubkey, updatedAt",
      spells: "&id, alias, createdAt, isPublished, deletedAt",
      spellbooks: "&id, slug, title, createdAt, isPublished, deletedAt",
      lnurlCache: "&address, fetchedAt",
      grimoireZaps:
        "&eventId, senderPubkey, timestamp, [senderPubkey+timestamp]",
    });

    // Version 18: Add nsite metadata caching (NIP-5A)
    this.version(18).stores({
      profiles: "&pubkey",
      nip05: "&nip05",
      nips: "&id",
      relayInfo: "&url",
      relayAuthPreferences: "&url",
      relayLists: "&pubkey, updatedAt",
      relayLiveness: "&url",
      blossomServers: "&pubkey, updatedAt",
      spells: "&id, alias, createdAt, isPublished, deletedAt",
      spellbooks: "&id, slug, title, createdAt, isPublished, deletedAt",
      lnurlCache: "&address, fetchedAt",
      grimoireZaps:
        "&eventId, senderPubkey, timestamp, [senderPubkey+timestamp]",
      nsiteMetadata: "&hash",
    });

    // Version 19: Add emoji caching (kind 10030 user emoji lists, kind 30030 emoji sets)
    this.version(19).stores({
      profiles: "&pubkey",
      nip05: "&nip05",
      nips: "&id",
      relayInfo: "&url",
      relayAuthPreferences: "&url",
      relayLists: "&pubkey, updatedAt",
      relayLiveness: "&url",
      blossomServers: "&pubkey, updatedAt",
      spells: "&id, alias, createdAt, isPublished, deletedAt",
      spellbooks: "&id, slug, title, createdAt, isPublished, deletedAt",
      lnurlCache: "&address, fetchedAt",
      grimoireZaps:
        "&eventId, senderPubkey, timestamp, [senderPubkey+timestamp]",
      nsiteMetadata: "&hash",
      userEmojiLists: "&pubkey",
      emojiSets: "&address",
    });

    // Version 20: Concord — decrypted membership vault, rumor store, snapshots
    this.version(20).stores({
      profiles: "&pubkey",
      nip05: "&nip05",
      nips: "&id",
      relayInfo: "&url",
      relayAuthPreferences: "&url",
      relayLists: "&pubkey, updatedAt",
      relayLiveness: "&url",
      blossomServers: "&pubkey, updatedAt",
      spells: "&id, alias, createdAt, isPublished, deletedAt",
      spellbooks: "&id, slug, title, createdAt, isPublished, deletedAt",
      lnurlCache: "&address, fetchedAt",
      grimoireZaps:
        "&eventId, senderPubkey, timestamp, [senderPubkey+timestamp]",
      nsiteMetadata: "&hash",
      userEmojiLists: "&pubkey",
      emojiSets: "&address",
      concordCommunities: "&[pubkey+idHex], pubkey",
      concordRumors:
        "&id, communityId, [communityId+kind], [communityId+channel], [communityId+channel+created_at]",
      concordSnapshots: "&[communityId+controlPk], communityId",
      concordKv: "&key",
    });

    // Version 21: Concord wire — parked wraps awaiting a key
    this.version(21).stores({
      profiles: "&pubkey",
      nip05: "&nip05",
      nips: "&id",
      relayInfo: "&url",
      relayAuthPreferences: "&url",
      relayLists: "&pubkey, updatedAt",
      relayLiveness: "&url",
      blossomServers: "&pubkey, updatedAt",
      spells: "&id, alias, createdAt, isPublished, deletedAt",
      spellbooks: "&id, slug, title, createdAt, isPublished, deletedAt",
      lnurlCache: "&address, fetchedAt",
      grimoireZaps:
        "&eventId, senderPubkey, timestamp, [senderPubkey+timestamp]",
      nsiteMetadata: "&hash",
      userEmojiLists: "&pubkey",
      emojiSets: "&address",
      concordCommunities: "&[pubkey+idHex], pubkey",
      concordRumors:
        "&id, communityId, [communityId+kind], [communityId+channel], [communityId+channel+created_at]",
      concordSnapshots: "&[communityId+controlPk], communityId",
      concordKv: "&key",
      concordPendingWraps: "&id, pubkey, created_at",
    });

    // Version 22: Concord rekey adoptions (keys this device took locally)
    this.version(22).stores({
      profiles: "&pubkey",
      nip05: "&nip05",
      nips: "&id",
      relayInfo: "&url",
      relayAuthPreferences: "&url",
      relayLists: "&pubkey, updatedAt",
      relayLiveness: "&url",
      blossomServers: "&pubkey, updatedAt",
      spells: "&id, alias, createdAt, isPublished, deletedAt",
      spellbooks: "&id, slug, title, createdAt, isPublished, deletedAt",
      lnurlCache: "&address, fetchedAt",
      grimoireZaps:
        "&eventId, senderPubkey, timestamp, [senderPubkey+timestamp]",
      nsiteMetadata: "&hash",
      userEmojiLists: "&pubkey",
      emojiSets: "&address",
      concordCommunities: "&[pubkey+idHex], pubkey",
      concordRumors:
        "&id, communityId, [communityId+kind], [communityId+channel], [communityId+channel+created_at]",
      concordSnapshots: "&[communityId+controlPk], communityId",
      concordKv: "&key",
      concordPendingWraps: "&id, pubkey, created_at",
      concordAdoptions: "&[pubkey+idHex], pubkey",
    });

    // Version 23: Concord read state (per-account, per-channel last-read stamp)
    this.version(23).stores({
      profiles: "&pubkey",
      nip05: "&nip05",
      nips: "&id",
      relayInfo: "&url",
      relayAuthPreferences: "&url",
      relayLists: "&pubkey, updatedAt",
      relayLiveness: "&url",
      blossomServers: "&pubkey, updatedAt",
      spells: "&id, alias, createdAt, isPublished, deletedAt",
      spellbooks: "&id, slug, title, createdAt, isPublished, deletedAt",
      lnurlCache: "&address, fetchedAt",
      grimoireZaps:
        "&eventId, senderPubkey, timestamp, [senderPubkey+timestamp]",
      nsiteMetadata: "&hash",
      userEmojiLists: "&pubkey",
      emojiSets: "&address",
      concordCommunities: "&[pubkey+idHex], pubkey",
      concordRumors:
        "&id, communityId, [communityId+kind], [communityId+channel], [communityId+channel+created_at]",
      concordSnapshots: "&[communityId+controlPk], communityId",
      concordKv: "&key",
      concordPendingWraps: "&id, pubkey, created_at",
      concordAdoptions: "&[pubkey+idHex], pubkey",
      // `pubkey` on its own is what the logout wipe deletes by; the compound
      // `[pubkey+communityId]` answers "every last-read in this community" —
      // the sidebar's whole query — in one index range.
      concordReads:
        "&[pubkey+communityId+channelId], pubkey, [pubkey+communityId]",
    });

    // Version 24: the message outbox, and per-channel composer drafts
    this.version(24).stores({
      profiles: "&pubkey",
      nip05: "&nip05",
      nips: "&id",
      relayInfo: "&url",
      relayAuthPreferences: "&url",
      relayLists: "&pubkey, updatedAt",
      relayLiveness: "&url",
      blossomServers: "&pubkey, updatedAt",
      spells: "&id, alias, createdAt, isPublished, deletedAt",
      spellbooks: "&id, slug, title, createdAt, isPublished, deletedAt",
      lnurlCache: "&address, fetchedAt",
      grimoireZaps:
        "&eventId, senderPubkey, timestamp, [senderPubkey+timestamp]",
      nsiteMetadata: "&hash",
      userEmojiLists: "&pubkey",
      emojiSets: "&address",
      concordCommunities: "&[pubkey+idHex], pubkey",
      concordRumors:
        "&id, communityId, [communityId+kind], [communityId+channel], [communityId+channel+created_at]",
      concordSnapshots: "&[communityId+controlPk], communityId",
      concordKv: "&key",
      concordPendingWraps: "&id, pubkey, created_at",
      concordAdoptions: "&[pubkey+idHex], pubkey",
      concordReads:
        "&[pubkey+communityId+channelId], pubkey, [pubkey+communityId]",
      // `pubkey` is the logout wipe's column; `[communityId+channel]` is what
      // the timeline merge asks ("what is still in flight in this channel").
      concordOutbox: "&id, pubkey, [communityId+channel], nextAttemptAt",
      // No `pubkey` column: the account is the first segment of the key, so a
      // logout deletes by primary-key prefix instead — see `clearCommunities`.
      chatDrafts: "&key, updatedAt",
    });

    // Version 25: the read cursor becomes protocol-qualified — `concordReads`
    // gives way to `chatReads`, keyed by protocol as well as reader, container
    // and channel.
    //
    // A NEW TABLE rather than a re-key, because Dexie refuses to change a
    // primary key in place ("Not yet support for changing primary key"). The
    // upgrade copies every existing row forward under protocol `"concord"`
    // instead of dropping the store: these stamps are days old but a lost one
    // relights a channel the reader has already read, which is the one way this
    // table can lie. Reading `concordReads` here is safe even though the same
    // version deletes it — Dexie runs the content upgrade before
    // `deleteRemovedTables`, and keeps the dropped table on the upgrade
    // transaction's schema for exactly this.
    this.version(25)
      .stores({
        profiles: "&pubkey",
        nip05: "&nip05",
        nips: "&id",
        relayInfo: "&url",
        relayAuthPreferences: "&url",
        relayLists: "&pubkey, updatedAt",
        relayLiveness: "&url",
        blossomServers: "&pubkey, updatedAt",
        spells: "&id, alias, createdAt, isPublished, deletedAt",
        spellbooks: "&id, slug, title, createdAt, isPublished, deletedAt",
        lnurlCache: "&address, fetchedAt",
        grimoireZaps:
          "&eventId, senderPubkey, timestamp, [senderPubkey+timestamp]",
        nsiteMetadata: "&hash",
        userEmojiLists: "&pubkey",
        emojiSets: "&address",
        concordCommunities: "&[pubkey+idHex], pubkey",
        concordRumors:
          "&id, communityId, [communityId+kind], [communityId+channel], [communityId+channel+created_at]",
        concordSnapshots: "&[communityId+controlPk], communityId",
        concordKv: "&key",
        concordPendingWraps: "&id, pubkey, created_at",
        concordAdoptions: "&[pubkey+idHex], pubkey",
        concordOutbox: "&id, pubkey, [communityId+channel], nextAttemptAt",
        chatDrafts: "&key, updatedAt",
        // Superseded by `chatReads`. `null` is what removes a table; a later
        // version must simply not mention it, since restating the name would
        // recreate it empty.
        concordReads: null,
        // `pubkey` on its own is still the logout wipe's column;
        // `[pubkey+protocol+containerId]` answers "every last-read in this
        // container" — the sidebar's whole query — in one index range.
        chatReads:
          "&[pubkey+protocol+containerId+channelId], pubkey, [pubkey+protocol+containerId]",
      })
      .upgrade(async (tx) => {
        const old = await tx
          .table<{
            pubkey: string;
            communityId: string;
            channelId: string;
            lastRead: number;
            updatedAt: number;
          }>("concordReads")
          .toArray();
        for (const row of old) {
          await tx.table<ChatReadRow>("chatReads").put({
            pubkey: row.pubkey,
            protocol: "concord",
            containerId: row.communityId,
            channelId: row.channelId,
            lastRead: row.lastRead,
            updatedAt: row.updatedAt,
          });
        }
      });

    // Version 26: notification levels become protocol-qualified too.
    //
    // No schema change — the levels are rows in the flat `concordKv` table, so
    // this rewrites their KEYS: `c2notif:<community>[::<channel>]` becomes
    // `chatnotif:<protocol>|<container>[|<channel>]`. See the separator note in
    // `concord-notif-prefs.ts`: `::` stops working the moment a container is a
    // relay URL, since an IPv6 literal contains one.
    //
    // Carried rather than dropped even though a logout forgets these anyway: a
    // level is the one preference in Concord whose loss is audible, because a
    // channel deliberately silenced starts ringing again. The old shape is
    // spelled out here rather than imported — `concord-notif-prefs` imports
    // this module, and a migration is frozen history in any case.
    this.version(26)
      .stores({ concordKv: "&key" })
      .upgrade(async (tx) => {
        const kv = tx.table<{ key: string; value: unknown }>("concordKv");
        const legacy = await kv.where("key").startsWith("c2notif:").toArray();
        for (const row of legacy) {
          const rest = row.key.slice("c2notif:".length);
          // The community segment is 64 hex characters, so the first `::` is
          // unambiguously the channel separator.
          const cut = rest.indexOf("::");
          const container = cut === -1 ? rest : rest.slice(0, cut);
          const channel = cut === -1 ? "" : rest.slice(cut + 2);
          const key = channel
            ? `chatnotif:concord|${container}|${channel}`
            : `chatnotif:concord|${container}`;
          await kv.put({ key, value: row.value });
          await kv.delete(row.key);
        }
      });
  }
}

const db = new GrimoireDb("grimoire-dev");

/**
 * Dexie storage adapter for RelayLiveness persistence
 * Implements the LivenessStorage interface expected by applesauce-relay
 */
export const relayLivenessStorage = {
  async getItem(key: string): Promise<any> {
    const entry = await db.relayLiveness.get(key);
    if (!entry) return null;

    // Return RelayState object without the url field
    const { url: _url, ...state } = entry;
    return state;
  },

  async setItem(key: string, value: any): Promise<void> {
    await db.relayLiveness.put({
      url: key,
      ...value,
    });
  },
};

export default db;
