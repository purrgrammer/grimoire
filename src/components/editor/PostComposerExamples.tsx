/**
 * Example usage components for PostComposer
 *
 * These examples demonstrate how to use PostComposer with event builders
 * for different Nostr event kinds (kind 1 and kind 11).
 *
 * This file is for documentation/reference purposes.
 */

import { useCallback, useState, useRef } from "react";
import type { NostrEvent } from "nostr-tools";
import { use$ } from "applesauce-react/hooks";
import accountManager from "@/services/accounts";
import { toast } from "sonner";
import {
  PostComposer,
  type PostComposerHandle,
  type PostSubmitData,
} from "./PostComposer";
import { useProfileSearch } from "@/hooks/useProfileSearch";
import { useEmojiSearch } from "@/hooks/useEmojiSearch";
import {
  buildKind1Event,
  buildKind11Event,
  type PostMetadata,
} from "@/lib/event-builders";
import { hub } from "@/services/hub";
import type { ActionContext } from "applesauce-actions";
import { lastValueFrom } from "rxjs";

/**
 * Example: Simple note composer (Kind 1)
 *
 * Inline variant for quick notes without reply context.
 * Similar to chat composer but for timeline posts.
 */
export function SimpleNoteComposer() {
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

      setIsPublishing(true);
      try {
        // Build kind 1 event
        const postMetadata: PostMetadata = {
          content: data.content,
          emojiTags: data.emojiTags,
          blobAttachments: data.blobAttachments,
          // TODO: Extract mentions and hashtags from content
          // mentionedPubkeys: extractMentions(data.content),
          // hashtags: extractHashtags(data.content),
        };

        const eventTemplate = buildKind1Event({
          post: postMetadata,
          pubkey: activeAccount.pubkey,
        });

        // Publish using action runner
        await lastValueFrom(
          hub.exec(() => async ({ sign, publish }: ActionContext) => {
            const signedEvent = await sign(eventTemplate);
            await publish(signedEvent);
          }),
        );

        toast.success("Note published!");
        composerRef.current?.clear();
      } catch (error) {
        console.error("Failed to publish note:", error);
        toast.error(
          error instanceof Error ? error.message : "Failed to publish note",
        );
      } finally {
        setIsPublishing(false);
      }
    },
    [activeAccount],
  );

  if (!activeAccount) {
    return (
      <div className="p-4 text-center text-sm text-muted-foreground">
        Sign in to post notes
      </div>
    );
  }

  return (
    <PostComposer
      ref={composerRef}
      variant="inline"
      onSubmit={handleSubmit}
      searchProfiles={searchProfiles}
      searchEmojis={searchEmojis}
      showSubmitButton
      submitLabel="Post"
      isLoading={isPublishing}
      placeholder="What's on your mind?"
    />
  );
}

/**
 * Example: Reply composer (Kind 1 with NIP-10 threading)
 *
 * Card variant for replying to events with full context.
 * Shows reply preview and builds proper NIP-10 thread tags.
 */
export function ReplyComposer({ replyTo }: { replyTo: NostrEvent }) {
  const activeAccount = use$(accountManager.active$);
  const { searchProfiles } = useProfileSearch();
  const { searchEmojis } = useEmojiSearch();
  const composerRef = useRef<PostComposerHandle>(null);
  const [isPublishing, setIsPublishing] = useState(false);

  const handleSubmit = useCallback(
    async (data: PostSubmitData) => {
      if (!activeAccount) {
        toast.error("Please sign in to reply");
        return;
      }

      setIsPublishing(true);
      try {
        // Build kind 1 reply event with NIP-10 tags
        const postMetadata: PostMetadata = {
          content: data.content,
          emojiTags: data.emojiTags,
          blobAttachments: data.blobAttachments,
          // TODO: Extract mentions and hashtags
        };

        const eventTemplate = buildKind1Event({
          post: postMetadata,
          replyTo, // Pass full event for NIP-10 threading
          pubkey: activeAccount.pubkey,
        });

        // Publish using action runner
        await lastValueFrom(
          hub.exec(() => async ({ sign, publish }: ActionContext) => {
            const signedEvent = await sign(eventTemplate);
            await publish(signedEvent);
          }),
        );

        toast.success("Reply published!");
        composerRef.current?.clear();
      } catch (error) {
        console.error("Failed to publish reply:", error);
        toast.error(
          error instanceof Error ? error.message : "Failed to publish reply",
        );
      } finally {
        setIsPublishing(false);
      }
    },
    [activeAccount, replyTo],
  );

  if (!activeAccount) {
    return (
      <div className="p-4 text-center text-sm text-muted-foreground">
        Sign in to reply
      </div>
    );
  }

  return (
    <PostComposer
      ref={composerRef}
      variant="card"
      onSubmit={handleSubmit}
      searchProfiles={searchProfiles}
      searchEmojis={searchEmojis}
      replyTo={replyTo} // Pass full event, not just ID
      showSubmitButton
      submitLabel="Reply"
      isLoading={isPublishing}
      placeholder="Write your reply..."
    />
  );
}

/**
 * Example: Thread composer (Kind 11 with title)
 *
 * Card variant with title input for creating new threads.
 * Uses NIP-7D thread format with title tag.
 */
export function ThreadComposer() {
  const activeAccount = use$(accountManager.active$);
  const { searchProfiles } = useProfileSearch();
  const { searchEmojis } = useEmojiSearch();
  const composerRef = useRef<PostComposerHandle>(null);
  const [isPublishing, setIsPublishing] = useState(false);

  const handleSubmit = useCallback(
    async (data: PostSubmitData) => {
      if (!activeAccount) {
        toast.error("Please sign in to create thread");
        return;
      }

      if (!data.title || !data.title.trim()) {
        toast.error("Thread title is required");
        return;
      }

      setIsPublishing(true);
      try {
        // Build kind 11 thread event
        const postMetadata: PostMetadata = {
          content: data.content,
          emojiTags: data.emojiTags,
          blobAttachments: data.blobAttachments,
          // TODO: Extract mentions and hashtags
        };

        const eventTemplate = buildKind11Event({
          title: data.title,
          post: postMetadata,
          pubkey: activeAccount.pubkey,
        });

        // Publish using action runner
        await lastValueFrom(
          hub.exec(() => async ({ sign, publish }: ActionContext) => {
            const signedEvent = await sign(eventTemplate);
            await publish(signedEvent);
          }),
        );

        toast.success("Thread created!");
        composerRef.current?.clear();
      } catch (error) {
        console.error("Failed to create thread:", error);
        toast.error(
          error instanceof Error ? error.message : "Failed to create thread",
        );
      } finally {
        setIsPublishing(false);
      }
    },
    [activeAccount],
  );

  if (!activeAccount) {
    return (
      <div className="p-4 text-center text-sm text-muted-foreground">
        Sign in to create threads
      </div>
    );
  }

  return (
    <PostComposer
      ref={composerRef}
      variant="card"
      showTitleInput
      onSubmit={handleSubmit}
      searchProfiles={searchProfiles}
      searchEmojis={searchEmojis}
      showSubmitButton
      submitLabel="Create Thread"
      isLoading={isPublishing}
      placeholder="Write your thread content..."
      titlePlaceholder="Thread title..."
    />
  );
}

/**
 * Example: Standalone reply with state management
 *
 * Shows how to manage reply context state externally.
 */
export function StandaloneReplyComposer() {
  const activeAccount = use$(accountManager.active$);
  const { searchProfiles } = useProfileSearch();
  const { searchEmojis } = useEmojiSearch();
  const [replyTo, setReplyTo] = useState<NostrEvent | undefined>();
  const [isPublishing, setIsPublishing] = useState(false);

  const handleSubmit = useCallback(
    async (data: PostSubmitData) => {
      if (!activeAccount) return;

      setIsPublishing(true);
      try {
        const postMetadata: PostMetadata = {
          content: data.content,
          emojiTags: data.emojiTags,
          blobAttachments: data.blobAttachments,
        };

        const eventTemplate = buildKind1Event({
          post: postMetadata,
          replyTo, // May be undefined (for root post) or NostrEvent (for reply)
          pubkey: activeAccount.pubkey,
        });

        await lastValueFrom(
          hub.exec(() => async ({ sign, publish }: ActionContext) => {
            const signedEvent = await sign(eventTemplate);
            await publish(signedEvent);
          }),
        );

        toast.success(replyTo ? "Reply published!" : "Note published!");
        setReplyTo(undefined); // Clear reply context
      } catch (error) {
        toast.error("Failed to publish");
      } finally {
        setIsPublishing(false);
      }
    },
    [activeAccount, replyTo],
  );

  if (!activeAccount) {
    return null;
  }

  return (
    <PostComposer
      variant="card"
      onSubmit={handleSubmit}
      searchProfiles={searchProfiles}
      searchEmojis={searchEmojis}
      replyTo={replyTo}
      onClearReply={() => setReplyTo(undefined)}
      showSubmitButton
      submitLabel={replyTo ? "Reply" : "Post"}
      isLoading={isPublishing}
      placeholder={replyTo ? "Write your reply..." : "What's on your mind?"}
    />
  );
}
