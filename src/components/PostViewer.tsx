/**
 * PostViewer - Note (kind 1) composer using generic Composer
 *
 * Uses the schema-driven Composer component with NOTE_SCHEMA
 * to compose and publish short text notes.
 */

import { useCallback } from "react";
import type { NostrEvent } from "nostr-tools";
import { Composer, type ComposerInput } from "@/components/composer";
import { Kind1Renderer } from "@/components/nostr/kinds";
import { NOTE_SCHEMA } from "@/lib/composer/schemas";
import { useAccount } from "@/hooks/useAccount";
import { useSettings } from "@/hooks/useSettings";
import { EventFactory } from "applesauce-core/event-factory";
import { NoteBlueprint } from "applesauce-common/blueprints";
import { GRIMOIRE_CLIENT_TAG } from "@/constants/app";

interface PostViewerProps {
  windowId?: string;
}

export function PostViewer({ windowId }: PostViewerProps = {}) {
  const { signer } = useAccount();
  const { settings } = useSettings();

  // Build the kind 1 note event
  const handleBuildEvent = useCallback(
    async (input: ComposerInput): Promise<NostrEvent> => {
      if (!signer) {
        throw new Error("No signer available");
      }

      // Create event factory with signer
      const factory = new EventFactory();
      factory.setSigner(signer);

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
      if (settings?.post?.includeClientTag) {
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

      // Sign and return the event
      return factory.sign(draft);
    },
    [signer, settings?.post?.includeClientTag],
  );

  // Render preview of published event
  const renderPreview = useCallback((event: NostrEvent) => {
    return (
      <div className="rounded-lg border border-border bg-muted/10 p-4">
        <Kind1Renderer event={event} depth={0} />
      </div>
    );
  }, []);

  return (
    <Composer
      schema={NOTE_SCHEMA}
      windowId={windowId}
      onBuildEvent={handleBuildEvent}
      renderPreview={renderPreview}
    />
  );
}
