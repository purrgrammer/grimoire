/**
 * Kind 1 Note Event Builder
 *
 * Creates kind 1 (short text note) events from composer input.
 * Separated from component for testability.
 */

import type { NostrEvent } from "nostr-tools";
import type { EventTemplate } from "nostr-tools/core";
import type { ISigner } from "applesauce-signers";
import { EventFactory } from "applesauce-core/event-factory";
import { NoteBlueprint } from "applesauce-common/blueprints";
import type { ComposerInput } from "@/components/composer";
import { GRIMOIRE_CLIENT_TAG } from "@/constants/app";

export interface BuildNoteOptions {
  /** Include client tag in the event */
  includeClientTag?: boolean;
}

/**
 * Build a kind 1 note draft (unsigned)
 * Useful for testing the event structure without signing
 */
export async function buildNoteDraft(
  input: ComposerInput,
  options: BuildNoteOptions = {},
): Promise<EventTemplate> {
  const factory = new EventFactory();

  // Use NoteBlueprint - it auto-extracts hashtags, mentions, and quotes from content!
  const draft = await factory.create(NoteBlueprint, input.content, {
    emojis: input.emojiTags.map((e) => ({
      shortcode: e.shortcode,
      url: e.url,
    })),
  });

  // Add tags that applesauce doesn't handle yet
  const additionalTags: string[][] = [];

  // Add subject tag if title provided
  if (input.title) {
    additionalTags.push(["subject", input.title]);
  }

  // Add a tags for address references (naddr - not yet supported by applesauce)
  for (const addr of input.addressRefs) {
    additionalTags.push([
      "a",
      `${addr.kind}:${addr.pubkey}:${addr.identifier}`,
    ]);
  }

  // Add client tag (if enabled)
  if (options.includeClientTag) {
    additionalTags.push(GRIMOIRE_CLIENT_TAG);
  }

  // Add imeta tags for blob attachments (NIP-92)
  for (const blob of input.blobAttachments) {
    const imetaTag = [
      "imeta",
      `url ${blob.url}`,
      `m ${blob.mimeType}`,
      `x ${blob.sha256}`,
      `size ${blob.size}`,
    ];
    if (blob.server) {
      imetaTag.push(`server ${blob.server}`);
    }
    additionalTags.push(imetaTag);
  }

  // Merge additional tags with blueprint tags
  draft.tags.push(...additionalTags);

  return draft;
}

/**
 * Build and sign a kind 1 note event
 */
export async function buildNoteEvent(
  input: ComposerInput,
  signer: ISigner,
  options: BuildNoteOptions = {},
): Promise<NostrEvent> {
  const factory = new EventFactory();
  factory.setSigner(signer);

  const draft = await buildNoteDraft(input, options);

  // Sign and return the event
  return factory.sign(draft);
}
