import type { NostrEvent, NostrFilter } from "./nostr";
import type { Workspace, WindowInstance } from "./app";
import { SPELL_KIND, SPELLBOOK_KIND } from "@/constants/kinds";

export { SPELL_KIND, SPELLBOOK_KIND };

/**
 * Spell event (kind 777 immutable event)
 *
 * REQ command parameters encoded as Nostr tags:
 *
 * REQUIRED:
 * - ["cmd", "REQ"] - Command type
 *
 * METADATA:
 * - ["client", "grimoire"] - Client identifier
 * - ["alt", "description"] - NIP-31 human-readable description
 * - ["name", "My Spell"] - Optional spell name (metadata only, not unique identifier)
 * - ["t", "bitcoin"], ["t", "news"] - Topic tags for categorization
 *
 * FILTER - Queryable (multiple tags):
 * - ["k", "1"], ["k", "3"] - Kinds filters
 *
 * FILTER - Arrays (single tag with multiple values):
 * - ["authors", "hex1", "hex2", "$me", "$contacts"] - Author filters
 * - ["ids", "id1", "id2"] - Direct event IDs (filter.ids)
 * - ["tag", "e", "id1", "id2"] - Event tag filters (filter["#e"])
 * - ["tag", "p", "pub1", "pub2"] - #p tag filters (can contain $me, $contacts)
 * - ["tag", "P", "pub1", "pub2"] - #P tag filters (uppercase, can contain $me, $contacts)
 * - ["tag", "t", "tag1", "tag2"] - #t tag filters (hashtags in filter)
 * - ["tag", "d", "tag1", "tag2"] - #d tag filters
 * - ["tag", "a", "kind:pubkey:d-tag"] - #a tag filters
 * - ["tag", "X", "val1", "val2"] - Any single-letter tag filter
 * - ["relays", "wss://relay1.com", "wss://relay2.com"] - Relay URLs
 *
 * FILTER - Scalars:
 * - ["limit", "50"] - Result limit
 * - ["since", "7d"] - Since timestamp (PRESERVE relative format for dynamic spells!)
 * - ["until", "now"] - Until timestamp (PRESERVE relative format!)
 * - ["search", "query text"] - Search query
 *
 * OPTIONS:
 * - ["close-on-eose"] - Close subscription on EOSE (boolean flag)
 *
 * PROVENANCE:
 * - ["e", "event-id"] - Fork source (references another spell event)
 *
 * CONTENT: Human-readable description (required)
 */
export interface SpellEvent extends NostrEvent {
  kind: 777;
  content: string;
  tags: [string, string, ...string[]][];
}

/**
 * Parsed spell with extracted metadata and reconstructed command
 */
export interface ParsedSpell {
  /** Spell name (from name tag, published) */
  name?: string;

  /** Description (from content field) */
  description?: string;

  /** Reconstructed REQ command string (canonical form) */
  command: string;

  /** Parsed Nostr filter components */
  filter: NostrFilter;

  /** Relay URLs */
  relays?: string[];

  /** Close on EOSE flag */
  closeOnEose: boolean;

  /** Topic tags for categorization */
  topics: string[];

  /** Fork provenance (event ID of source spell) */
  forkedFrom?: string;

  /** Full event for reference */
  event: SpellEvent;
}

/**
 * Options for creating a spell from a REQ command
 */
export interface CreateSpellOptions {
  /** Full REQ command string to parse (e.g., "req -k 1,3 -a npub... -l 50") */
  command: string;

  /** Optional spell name (published to Nostr) */
  name?: string;

  /** Optional description (goes to content field) */
  description?: string;

  /** Optional topic tags for categorization (stored as regular t tags) */
  topics?: string[];

  /** If forking, provide source event ID */
  forkedFrom?: string;
}

/**
 * Result of encoding a REQ command as a spell event
 */
export interface EncodedSpell {
  /** Event tags encoding the REQ command parameters */
  tags: [string, string, ...string[]][];

  /** Human-readable content (optional) */
  content: string;

  /** Parsed filter for verification */
  filter: NostrFilter;

  /** Relay URLs extracted from command */
  relays?: string[];

  /** Close on EOSE flag */
  closeOnEose: boolean;
}

/**
 * Content structure for a Spellbook (Kind 30777)
 * Represents a saved layout configuration (one or more workspaces)
 */
export interface SpellbookContent {
  /** Schema version for migrations */
  version: number;
  /** Workspaces included in this spellbook */
  workspaces: Record<string, Workspace>;
  /** Windows referenced by the workspaces */
  windows: Record<string, WindowInstance>;
}

/**
 * Spellbook event (kind 30777 parameterized replaceable event)
 *
 * TAGS:
 * - ["d", "slug"] - Unique identifier (slugified title)
 * - ["title", "My Dashboard"] - Human readable title
 * - ["description", "My cool setup"] - Optional description
 * - ["e", "spell-id", "relay", "mention"] - References to spells used in the layout
 */
export interface SpellbookEvent extends NostrEvent {
  kind: 30777;
  content: string; // JSON encoded SpellbookContent
  tags: [string, string, ...string[]][];
}

/**
 * Parsed spellbook with extracted metadata and content
 */
export interface ParsedSpellbook {
  /** Slug identifier (from d tag) */
  slug: string;
  /** Title (from title tag) */
  title: string;
  /** Description (from description tag) */
  description?: string;
  /** The actual layout data */
  content: SpellbookContent;
  /** IDs of spells referenced in this book (from e tags) */
  referencedSpells: string[];
  /** Full event reference (may be undefined for local-only spellbooks) */
  event?: SpellbookEvent;
  /** Optional: Local DB ID if this spellbook is in the user's library */
  localId?: string;
  /** Optional: Whether this spellbook has been published to Nostr */
  isPublished?: boolean;
  /** Optional: Where this spellbook was loaded from */
  source?: "local" | "network";
}
