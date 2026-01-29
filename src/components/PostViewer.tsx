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
import { buildNoteEvent } from "@/lib/composers/note-builder";

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

      return buildNoteEvent(input, signer, {
        includeClientTag: settings?.post?.includeClientTag,
      });
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
