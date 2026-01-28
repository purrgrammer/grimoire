/**
 * ComposerSchema - Schema definitions for event kind composers
 *
 * This module defines the structure for describing how to compose different
 * Nostr event kinds. Each schema specifies:
 * - Content type and editor to use
 * - Metadata fields (title, summary, etc.)
 * - Context binding (what the event relates to)
 * - Threading style (for replies)
 * - Relay selection strategy
 * - Whether the event is replaceable
 */

import type { AddressPointer, EventPointer } from "nostr-tools/nip19";

/**
 * Content type determines which editor to use
 */
export type ContentType = "text" | "markdown";

/**
 * Editor variant to render
 */
export type EditorVariant = "text" | "markdown" | "chat";

/**
 * Title/subject field configuration
 */
export interface TitleFieldConfig {
  /** Which tag to use for the title */
  tag: "title" | "subject" | "name";
  /** Whether the title is required */
  required: boolean;
  /** Label shown in the UI */
  label: string;
  /** Placeholder text */
  placeholder?: string;
}

/**
 * Label/tag field configuration (for t-tags)
 */
export interface LabelsConfig {
  /** Tag name (usually "t") */
  tag: string;
  /** How to handle labels */
  style: "auto-extract" | "explicit" | "both";
  /** Label shown in the UI */
  label?: string;
  /** Placeholder text */
  placeholder?: string;
}

/**
 * Metadata fields configuration
 */
export interface MetadataConfig {
  title?: TitleFieldConfig;
  summary?: { tag: "summary" | "description"; label?: string };
  image?: { tag: "image"; label?: string };
  publishedAt?: { tag: "published_at"; auto?: boolean };
  labels?: LabelsConfig;
  /** Custom domain-specific fields */
  custom?: CustomFieldConfig[];
}

/**
 * Custom field configuration for domain-specific metadata
 */
export interface CustomFieldConfig {
  tag: string;
  type: "text" | "number" | "date" | "timestamp" | "select" | "location";
  label: string;
  placeholder?: string;
  required?: boolean;
  options?: string[]; // For select type
}

/**
 * Context binding - what this event relates to
 */
export type ContextBinding =
  | { type: "standalone" }
  | { type: "address"; tag: "a"; required: boolean }
  | { type: "event"; tag: "e"; marker?: "root" }
  | { type: "group"; tag: "h" }
  | { type: "comment"; style: "nip22" }
  | { type: "multi"; tags: ("a" | "e" | "p" | "r")[] };

/**
 * Threading style for replies
 */
export type ThreadingStyle =
  | { style: "none" }
  | { style: "nip10"; markers: ("root" | "reply")[] }
  | { style: "nip22" }
  | { style: "q-tag" }
  | { style: "custom"; tag: string; values: string[] };

/**
 * Relay selection strategy
 */
export type RelayStrategy =
  | { type: "user-outbox" }
  | { type: "user-outbox"; additional: "context-hints" }
  | { type: "context-only"; fromContext: true }
  | { type: "address-hints"; fallback: "user-outbox" };

/**
 * Media configuration
 */
export interface MediaConfig {
  allowed: boolean;
  tag: "imeta";
  types?: string[]; // MIME type filter
}

/**
 * Emoji configuration
 */
export interface EmojiConfig {
  allowed: boolean;
  tag: "emoji";
}

/**
 * Identifier configuration (for replaceable events)
 */
export interface IdentifierConfig {
  tag: "d";
  source: "auto" | "from-title" | "user-input" | "prop";
  /** Function to generate identifier from input */
  generator?: (input: ComposerInput) => string;
}

/**
 * Draft configuration
 */
export interface DraftConfig {
  supported: boolean;
  /** Kind to use for drafts (e.g., 30024 for 30023 articles) */
  draftKind?: number;
  /** Function to generate storage key */
  storageKey?: (context: ComposerContext) => string;
}

/**
 * Input provided to identifier generators
 */
export interface ComposerInput {
  title?: string;
  content: string;
  labels?: string[];
}

/**
 * Context provided to the composer
 */
export interface ComposerContext {
  /** Repository, article, etc. this event relates to */
  address?: AddressPointer;
  /** Event this is replying to */
  replyTo?: EventPointer;
  /** Group identifier (for NIP-29) */
  groupId?: string;
  /** Single relay (for groups) */
  groupRelay?: string;
  /** Window/instance ID (for draft storage) */
  windowId?: string;
}

/**
 * Complete schema for a composable event kind
 */
export interface ComposerSchema {
  /** Event kind number */
  kind: number;

  /** Human-readable name */
  name: string;

  /** Description for UI */
  description?: string;

  // ═══════════════════════════════════════════════════════
  // CONTENT
  // ═══════════════════════════════════════════════════════
  content: {
    type: ContentType;
    editor: EditorVariant;
    placeholder?: string;
  };

  // ═══════════════════════════════════════════════════════
  // METADATA
  // ═══════════════════════════════════════════════════════
  metadata: MetadataConfig;

  // ═══════════════════════════════════════════════════════
  // CONTEXT BINDING
  // ═══════════════════════════════════════════════════════
  context: ContextBinding;

  // ═══════════════════════════════════════════════════════
  // THREADING
  // ═══════════════════════════════════════════════════════
  threading: ThreadingStyle;

  // ═══════════════════════════════════════════════════════
  // MEDIA & EMOJI
  // ═══════════════════════════════════════════════════════
  media: MediaConfig;
  emoji: EmojiConfig;

  // ═══════════════════════════════════════════════════════
  // IDENTIFIER (for replaceable events)
  // ═══════════════════════════════════════════════════════
  identifier?: IdentifierConfig;

  // ═══════════════════════════════════════════════════════
  // RELAY STRATEGY
  // ═══════════════════════════════════════════════════════
  relays: RelayStrategy;

  // ═══════════════════════════════════════════════════════
  // BEHAVIOR
  // ═══════════════════════════════════════════════════════
  /** Whether this is a replaceable event (kind 10000-19999 or 30000-39999) */
  replaceable: boolean;

  /** Draft configuration */
  drafts: DraftConfig;
}

/**
 * Helper to create a slug from title
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
