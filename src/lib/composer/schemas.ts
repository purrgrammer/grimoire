/**
 * Predefined schemas for common event kinds
 *
 * These schemas define how to compose different Nostr event kinds.
 * Add new schemas here as more kinds are supported.
 */

import type { ComposerSchema } from "./schema";
import { slugify } from "./schema";

/**
 * Kind 1: Short text note
 */
export const NOTE_SCHEMA: ComposerSchema = {
  kind: 1,
  name: "Note",
  description: "Short text note",

  content: {
    type: "text",
    editor: "text",
    placeholder: "What's on your mind?",
  },

  metadata: {
    title: {
      tag: "subject",
      required: false,
      label: "Subject (optional)",
      placeholder: "Add a subject line",
    },
    labels: {
      tag: "t",
      style: "auto-extract",
    },
  },

  context: { type: "standalone" },
  threading: { style: "nip10", markers: ["root", "reply"] },

  media: { allowed: true, tag: "imeta" },
  emoji: { allowed: true, tag: "emoji" },

  relays: { type: "user-outbox" },

  replaceable: false,
  drafts: {
    supported: true,
    storageKey: (ctx) => `note-draft-${ctx.windowId || "default"}`,
  },
};

/**
 * Kind 1111: Comment (NIP-22)
 */
export const COMMENT_SCHEMA: ComposerSchema = {
  kind: 1111,
  name: "Comment",
  description: "Comment on any Nostr event or external content",

  content: {
    type: "markdown",
    editor: "text", // Comments use plain text editor, not markdown toolbar
    placeholder: "Write a comment...",
  },

  metadata: {
    labels: {
      tag: "t",
      style: "auto-extract",
    },
  },

  context: { type: "comment", style: "nip22" },
  threading: { style: "nip22" },

  media: { allowed: true, tag: "imeta" },
  emoji: { allowed: true, tag: "emoji" },

  relays: { type: "user-outbox", additional: "context-hints" },

  replaceable: false,
  drafts: { supported: false },
};

/**
 * Kind 1621: Issue (NIP-34)
 */
export const ISSUE_SCHEMA: ComposerSchema = {
  kind: 1621,
  name: "Issue",
  description: "Bug report or feature request for a repository",

  content: {
    type: "markdown",
    editor: "markdown",
    placeholder: "Describe the issue...",
  },

  metadata: {
    title: {
      tag: "subject",
      required: false,
      label: "Title (optional)",
      placeholder: "Brief description of the issue",
    },
    labels: {
      tag: "t",
      style: "explicit",
      label: "Labels",
      placeholder: "bug, enhancement, help-wanted",
    },
  },

  context: { type: "address", tag: "a", required: true },
  threading: { style: "nip10", markers: ["root", "reply"] },

  media: { allowed: true, tag: "imeta" },
  emoji: { allowed: true, tag: "emoji" },

  relays: { type: "address-hints", fallback: "user-outbox" },

  replaceable: false,
  drafts: {
    supported: true,
    storageKey: (ctx) =>
      ctx.address
        ? `issue-draft-${ctx.address.kind}:${ctx.address.pubkey}:${ctx.address.identifier}`
        : "issue-draft-new",
  },
};

/**
 * Kind 9: Group chat message (NIP-29)
 */
export const GROUP_MESSAGE_SCHEMA: ComposerSchema = {
  kind: 9,
  name: "Group Message",
  description: "Message in a relay-based group",

  content: {
    type: "text",
    editor: "chat",
    placeholder: "Type a message...",
  },

  metadata: {
    labels: {
      tag: "t",
      style: "auto-extract",
    },
  },

  context: { type: "group", tag: "h" },
  threading: { style: "q-tag" },

  media: { allowed: true, tag: "imeta" },
  emoji: { allowed: true, tag: "emoji" },

  relays: { type: "context-only", fromContext: true },

  replaceable: false,
  drafts: { supported: false },
};

/**
 * Kind 30023: Long-form article (NIP-23)
 */
export const ARTICLE_SCHEMA: ComposerSchema = {
  kind: 30023,
  name: "Article",
  description: "Long-form content with rich formatting",

  content: {
    type: "markdown",
    editor: "markdown",
    placeholder: "Write your article...",
  },

  metadata: {
    title: {
      tag: "title",
      required: true,
      label: "Title",
      placeholder: "Article title",
    },
    summary: {
      tag: "summary",
      label: "Summary (optional)",
    },
    image: {
      tag: "image",
      label: "Cover image URL",
    },
    publishedAt: {
      tag: "published_at",
      auto: true,
    },
    labels: {
      tag: "t",
      style: "both",
      label: "Topics",
      placeholder: "nostr, development, tutorial",
    },
  },

  context: { type: "standalone" },
  threading: { style: "none" },

  media: { allowed: true, tag: "imeta" },
  emoji: { allowed: true, tag: "emoji" },

  identifier: {
    tag: "d",
    source: "from-title",
    generator: (input) => slugify(input.title || "untitled"),
  },

  relays: { type: "user-outbox" },

  replaceable: true,
  drafts: {
    supported: true,
    draftKind: 30024,
    storageKey: (ctx) => `article-draft-${ctx.windowId || "new"}`,
  },
};

/**
 * Kind 30818: Wiki article (NIP-54)
 */
export const WIKI_ARTICLE_SCHEMA: ComposerSchema = {
  kind: 30818,
  name: "Wiki Article",
  description: "Collaborative wiki entry",

  content: {
    type: "markdown", // Actually AsciiDoc per spec, but we can treat as markdown
    editor: "markdown",
    placeholder: "Write the article content...",
  },

  metadata: {
    title: {
      tag: "title",
      required: false,
      label: "Display Title",
      placeholder: "Optional display title (d-tag used if empty)",
    },
    summary: {
      tag: "summary",
      label: "Summary",
    },
  },

  context: { type: "standalone" },
  threading: { style: "none" },

  media: { allowed: true, tag: "imeta" },
  emoji: { allowed: true, tag: "emoji" },

  identifier: {
    tag: "d",
    source: "user-input", // Wiki articles need explicit topic identifiers
  },

  relays: { type: "user-outbox" },

  replaceable: true,
  drafts: {
    supported: true,
    storageKey: (ctx) => `wiki-draft-${ctx.windowId || "new"}`,
  },
};

/**
 * Registry of all schemas by kind
 */
export const SCHEMAS: Record<number, ComposerSchema> = {
  1: NOTE_SCHEMA,
  9: GROUP_MESSAGE_SCHEMA,
  1111: COMMENT_SCHEMA,
  1621: ISSUE_SCHEMA,
  30023: ARTICLE_SCHEMA,
  30818: WIKI_ARTICLE_SCHEMA,
};

/**
 * Get schema for a kind, or undefined if not supported
 */
export function getSchema(kind: number): ComposerSchema | undefined {
  return SCHEMAS[kind];
}

/**
 * Check if a kind has a composer schema
 */
export function hasSchema(kind: number): boolean {
  return kind in SCHEMAS;
}
