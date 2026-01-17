import { useCallback, useRef, useState } from "react";
import { use$ } from "applesauce-react/hooks";
import accountManager from "@/services/accounts";
import { toast } from "sonner";
import {
  PostComposer,
  type PostComposerHandle,
  type PostSubmitData,
} from "./editor/PostComposer";
import { useProfileSearch } from "@/hooks/useProfileSearch";
import { useEmojiSearch } from "@/hooks/useEmojiSearch";
import type { PostMetadata } from "@/lib/event-builders";
import { hub } from "@/services/hub";
import type { ActionContext } from "applesauce-actions";
import { lastValueFrom } from "rxjs";
import { AlertCircle } from "lucide-react";

export interface PostWindowProps {
  /** Event kind to publish (default: 1) */
  kind?: number;
  /** Custom title for the window */
  customTitle?: string;
}

/**
 * PostWindow - Window component for creating Nostr posts
 *
 * Simplified post composer focused on kind 1 notes.
 * Supports relay selection and mention tagging.
 *
 * @example
 * ```bash
 * post           # Create a kind 1 note
 * post -k 30023  # Create a different kind (if supported)
 * ```
 */
export function PostWindow({ kind = 1, customTitle }: PostWindowProps) {
  const activeAccount = use$(accountManager.active$);
  const { searchProfiles } = useProfileSearch();
  const { searchEmojis } = useEmojiSearch();
  const composerRef = useRef<PostComposerHandle>(null);
  const [isPublishing, setIsPublishing] = useState(false);

  const handleSubmit = useCallback(
    async (data: PostSubmitData) => {
      if (!activeAccount) {
        toast.error("Please sign in to post");
        return;
      }

      if (!data.relays || data.relays.length === 0) {
        toast.error("Please select at least one relay");
        return;
      }

      setIsPublishing(true);
      try {
        const postMetadata: PostMetadata = {
          content: data.content,
          emojiTags: data.emojiTags,
          blobAttachments: data.blobAttachments,
          mentionedPubkeys: data.mentionedPubkeys,
          hashtags: data.hashtags,
        };

        // Build unsigned event
        const unsignedEvent = {
          kind,
          created_at: Math.floor(Date.now() / 1000),
          tags: [] as string[][],
          content: postMetadata.content,
          pubkey: activeAccount.pubkey,
        };

        // Add p-tags for mentioned pubkeys
        if (postMetadata.mentionedPubkeys) {
          for (const pubkey of postMetadata.mentionedPubkeys) {
            unsignedEvent.tags.push(["p", pubkey]);
          }
        }

        // Add hashtags (t-tags)
        if (postMetadata.hashtags) {
          for (const hashtag of postMetadata.hashtags) {
            unsignedEvent.tags.push(["t", hashtag.toLowerCase()]);
          }
        }

        // Add emoji tags (NIP-30)
        if (postMetadata.emojiTags) {
          for (const emoji of postMetadata.emojiTags) {
            unsignedEvent.tags.push(["emoji", emoji.shortcode, emoji.url]);
          }
        }

        // Add imeta tags for blob attachments (NIP-92)
        if (postMetadata.blobAttachments) {
          for (const blob of postMetadata.blobAttachments) {
            const imetaTag = ["imeta", `url ${blob.url}`];
            if (blob.mimeType) imetaTag.push(`m ${blob.mimeType}`);
            if (blob.sha256) imetaTag.push(`x ${blob.sha256}`);
            if (blob.size !== undefined) imetaTag.push(`size ${blob.size}`);
            if (blob.server) imetaTag.push(`ox ${blob.server}`);
            unsignedEvent.tags.push(imetaTag);
          }
        }

        // Publish using action runner (to selected relays)
        await lastValueFrom(
          hub.exec(() => async ({ sign, publish }: ActionContext) => {
            const signedEvent = await sign(unsignedEvent);
            // Publish to each selected relay
            for (const relay of data.relays) {
              await publish(signedEvent, [relay]);
            }
          }),
        );

        toast.success(`Kind ${kind} event published!`);
        composerRef.current?.clear();
      } catch (error) {
        console.error("Failed to publish:", error);
        toast.error(
          error instanceof Error ? error.message : "Failed to publish",
        );
      } finally {
        setIsPublishing(false);
      }
    },
    [activeAccount, kind],
  );

  // Show loading state while checking authentication
  if (!activeAccount) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground p-4">
        <AlertCircle className="size-8" />
        <span className="text-sm text-center">
          Please sign in to create posts
        </span>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col p-4">
      {/* Header */}
      <div className="mb-4">
        <h2 className="text-lg font-semibold">
          {customTitle || `Create Kind ${kind} Note`}
        </h2>
        <p className="text-xs text-muted-foreground mt-1">
          Publish to selected relays with mention tagging
        </p>
      </div>

      {/* Composer */}
      <div className="flex-1 min-h-0 overflow-auto">
        <PostComposer
          ref={composerRef}
          variant="card"
          onSubmit={handleSubmit}
          searchProfiles={searchProfiles}
          searchEmojis={searchEmojis}
          showSubmitButton
          submitLabel="Publish"
          isLoading={isPublishing}
          placeholder="What's on your mind?"
          autoFocus
        />
      </div>
    </div>
  );
}
