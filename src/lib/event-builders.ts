import type { NostrEvent, UnsignedEvent } from "nostr-tools";
import { kinds } from "nostr-tools";
import { getNip10References } from "applesauce-common/helpers/threading";

/**
 * Metadata for building Nostr events from post composer
 */
export interface PostMetadata {
  /** The text content with nostr: URIs for mentions */
  content: string;
  /** NIP-30 emoji tags */
  emojiTags?: Array<{ shortcode: string; url: string }>;
  /** NIP-92 blob attachments (imeta tags) */
  blobAttachments?: Array<{
    url: string;
    sha256: string;
    mimeType?: string;
    size?: number;
    server?: string;
  }>;
  /** Extracted pubkeys from @mentions */
  mentionedPubkeys?: string[];
  /** Extracted #hashtags */
  hashtags?: string[];
}

/**
 * Options for building Kind 1 (ShortTextNote) events
 */
export interface BuildKind1Options {
  /** The post content and metadata */
  post: PostMetadata;
  /** Event being replied to (for NIP-10 threading) */
  replyTo?: NostrEvent;
  /** Author's pubkey (required for unsigned event template) */
  pubkey: string;
}

/**
 * Options for building Kind 11 (Thread) events
 */
export interface BuildKind11Options {
  /** The thread title */
  title: string;
  /** The post content and metadata */
  post: PostMetadata;
  /** Author's pubkey (required for unsigned event template) */
  pubkey: string;
}

/**
 * Build a Kind 1 (ShortTextNote) event with NIP-10 reply tags
 *
 * NIP-10 Threading Rules:
 * - First "e" tag: root (with "root" marker)
 * - Last "e" tag: reply target (with "reply" marker)
 * - "p" tags: mentioned pubkeys + parent author
 *
 * @example
 * ```ts
 * // Simple note
 * const note = buildKind1Event({
 *   post: { content: "Hello Nostr!" },
 *   pubkey: myPubkey,
 * });
 *
 * // Reply to an event
 * const reply = buildKind1Event({
 *   post: { content: "Great post!" },
 *   replyTo: parentEvent,
 *   pubkey: myPubkey,
 * });
 * ```
 */
export function buildKind1Event(options: BuildKind1Options): UnsignedEvent {
  const { post, replyTo, pubkey } = options;
  const tags: string[][] = [];

  // Add reply tags (NIP-10)
  if (replyTo) {
    const refs = getNip10References(replyTo);

    // Determine root event
    let rootId: string | undefined;
    let rootRelayHint: string | undefined;

    if (refs.root?.e) {
      // Parent has a root, use it
      rootId = refs.root.e.id;
      rootRelayHint = refs.root.e.relays?.[0];
    } else {
      // Parent is the root
      rootId = replyTo.id;
      // Try to get relay hint from parent's tags
      const parentETags = replyTo.tags.filter((t) => t[0] === "e");
      if (parentETags.length > 0) {
        rootRelayHint = parentETags[0][2];
      }
    }

    // Add root tag (first e-tag)
    if (rootId) {
      tags.push(
        rootRelayHint
          ? ["e", rootId, rootRelayHint, "root"]
          : ["e", rootId, "", "root"],
      );
    }

    // Add reply tag (last e-tag, points to immediate parent)
    const replyRelayHint = replyTo.tags.find((t) => t[0] === "e")?.[2] || "";
    tags.push(["e", replyTo.id, replyRelayHint, "reply"]);

    // Add p-tag for parent author
    tags.push(["p", replyTo.pubkey]);
  }

  // Add p-tags for mentioned pubkeys (deduplicated)
  if (post.mentionedPubkeys) {
    const existingPTags = new Set(
      tags.filter((t) => t[0] === "p").map((t) => t[1]),
    );
    for (const mentionedPubkey of post.mentionedPubkeys) {
      if (!existingPTags.has(mentionedPubkey)) {
        tags.push(["p", mentionedPubkey]);
        existingPTags.add(mentionedPubkey);
      }
    }
  }

  // Add hashtags (t-tags)
  if (post.hashtags) {
    for (const hashtag of post.hashtags) {
      tags.push(["t", hashtag.toLowerCase()]);
    }
  }

  // Add emoji tags (NIP-30)
  if (post.emojiTags) {
    for (const emoji of post.emojiTags) {
      tags.push(["emoji", emoji.shortcode, emoji.url]);
    }
  }

  // Add imeta tags for blob attachments (NIP-92)
  if (post.blobAttachments) {
    for (const blob of post.blobAttachments) {
      const imetaTag = ["imeta", `url ${blob.url}`];

      // Add optional metadata fields
      if (blob.mimeType) {
        imetaTag.push(`m ${blob.mimeType}`);
      }
      if (blob.sha256) {
        imetaTag.push(`x ${blob.sha256}`);
      }
      if (blob.size !== undefined) {
        imetaTag.push(`size ${blob.size}`);
      }
      if (blob.server) {
        imetaTag.push(`ox ${blob.server}`);
      }

      tags.push(imetaTag);
    }
  }

  return {
    kind: kinds.ShortTextNote,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: post.content,
    pubkey,
  };
}

/**
 * Build a Kind 11 (Thread) event with title tag
 *
 * NIP-7D Threading Rules:
 * - MUST include "title" tag
 * - Replies use kind 1111 (Comments), not kind 1
 * - All replies reference the root thread (flat structure)
 *
 * @example
 * ```ts
 * const thread = buildKind11Event({
 *   title: "Why Nostr is the future",
 *   post: { content: "Let me explain..." },
 *   pubkey: myPubkey,
 * });
 * ```
 */
export function buildKind11Event(options: BuildKind11Options): UnsignedEvent {
  const { title, post, pubkey } = options;
  const tags: string[][] = [];

  // Add title tag (required for kind 11)
  tags.push(["title", title]);

  // Add p-tags for mentioned pubkeys
  if (post.mentionedPubkeys) {
    for (const mentionedPubkey of post.mentionedPubkeys) {
      tags.push(["p", mentionedPubkey]);
    }
  }

  // Add hashtags (t-tags)
  if (post.hashtags) {
    for (const hashtag of post.hashtags) {
      tags.push(["t", hashtag.toLowerCase()]);
    }
  }

  // Add emoji tags (NIP-30)
  if (post.emojiTags) {
    for (const emoji of post.emojiTags) {
      tags.push(["emoji", emoji.shortcode, emoji.url]);
    }
  }

  // Add imeta tags for blob attachments (NIP-92)
  if (post.blobAttachments) {
    for (const blob of post.blobAttachments) {
      const imetaTag = ["imeta", `url ${blob.url}`];

      // Add optional metadata fields
      if (blob.mimeType) {
        imetaTag.push(`m ${blob.mimeType}`);
      }
      if (blob.sha256) {
        imetaTag.push(`x ${blob.sha256}`);
      }
      if (blob.size !== undefined) {
        imetaTag.push(`size ${blob.size}`);
      }
      if (blob.server) {
        imetaTag.push(`ox ${blob.server}`);
      }

      tags.push(imetaTag);
    }
  }

  return {
    kind: 11,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: post.content,
    pubkey,
  };
}
