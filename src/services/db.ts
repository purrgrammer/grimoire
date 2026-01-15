import { ProfileContent } from "applesauce-core/helpers";
import { Dexie, Table } from "dexie";
import { RelayInformation } from "../types/nip11";
import { normalizeRelayURL } from "../lib/relay-url";
import type { NostrEvent } from "@/types/nostr";
import type {
  SpellEvent,
  SpellbookContent,
  SpellbookEvent,
} from "@/types/spell";

export interface Profile extends ProfileContent {
  pubkey: string;
  created_at: number;
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

/**
 * Gift wrap envelope (kind 1059) - tracks outer layer
 * Records which gift wraps we've seen and their decryption status
 */
export interface GiftWrapEnvelope {
  id: string; // gift wrap event ID (kind 1059)
  recipientPubkey: string; // who it's addressed to (from p-tag)
  event: NostrEvent; // full gift wrap event
  status: "pending" | "decrypted" | "failed"; // decryption state
  failureReason?: string; // if failed, why?
  receivedAt: number; // when we first saw it
  processedAt?: number; // when we attempted decryption
}

/**
 * Decrypted rumor - the actual message content after unwrapping
 * Stores the seal (kind 13) and extracted rumor (unsigned event)
 */
export interface DecryptedRumor {
  giftWrapId: string; // links back to gift wrap (primary key)
  recipientPubkey: string; // which of our accounts received this
  senderPubkey: string; // from seal (who sent it)
  seal: NostrEvent; // kind 13 seal event
  rumor: NostrEvent; // the unsigned inner event
  rumorCreatedAt: number; // canonical timestamp from rumor
  rumorKind: number; // kind of the rumor (for filtering)
  decryptedAt: number; // when we successfully decrypted it
}

/**
 * Conversation metadata - denormalized cache for fast conversation list queries
 * One entry per (sender, recipient) pair
 */
export interface ConversationMetadata {
  id: string; // `${senderPubkey}:${recipientPubkey}` (primary key)
  senderPubkey: string; // who sent messages
  recipientPubkey: string; // which of our accounts
  lastMessageGiftWrapId: string; // ID of most recent gift wrap
  lastMessageCreatedAt: number; // rumor created_at of most recent message
  lastMessagePreview: string; // content preview for UI
  lastMessageKind: number; // rumor kind of most recent message
  messageCount: number; // total messages in conversation
  unreadCount: number; // unread message count
  updatedAt: number; // when this metadata was last updated
}

class GrimoireDb extends Dexie {
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
  giftWraps!: Table<GiftWrapEnvelope>;
  decryptedRumors!: Table<DecryptedRumor>;
  conversations!: Table<ConversationMetadata>;

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
        console.log("[DB Migration v6] Normalizing relay URLs...");

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
        console.log(
          `[DB Migration v6] Normalized ${normalizedAuthPrefs.size} auth preferences` +
            (skippedAuthPrefs > 0
              ? ` (skipped ${skippedAuthPrefs} invalid)`
              : ""),
        );

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
        console.log(
          `[DB Migration v6] Normalized ${normalizedRelayInfos.size} relay infos` +
            (skippedRelayInfos > 0
              ? ` (skipped ${skippedRelayInfos} invalid)`
              : ""),
        );
        console.log("[DB Migration v6] Complete!");
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
        console.log(
          "[DB Migration v10] Migrating spell schema (localName → alias)...",
        );

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

        console.log(`[DB Migration v10] Migrated ${spells.length} spells`);
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

    // Version 16: Add gift wrap (NIP-59) support
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
      // Gift wrap envelopes indexed by recipient and status for efficient queries
      giftWraps: "&id, recipientPubkey, [recipientPubkey+status], receivedAt",
      // Decrypted rumors indexed by sender and timestamp for conversation queries
      decryptedRumors:
        "&giftWrapId, recipientPubkey, senderPubkey, [senderPubkey+rumorCreatedAt], [recipientPubkey+senderPubkey], rumorCreatedAt",
      // Conversation metadata for fast conversation list queries
      conversations:
        "&id, recipientPubkey, [recipientPubkey+lastMessageCreatedAt]",
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
    const { url, ...state } = entry;
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
