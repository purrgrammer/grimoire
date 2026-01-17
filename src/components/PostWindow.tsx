import { useCallback, useRef, useState, useEffect } from "react";
import { use$ } from "applesauce-react/hooks";
import accountManager from "@/services/accounts";
import eventStore from "@/services/event-store";
import { toast } from "sonner";
import {
  PostComposer,
  type PostComposerHandle,
  type PostSubmitData,
} from "./editor/PostComposer";
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
import { Loader2, AlertCircle } from "lucide-react";

export interface PostWindowProps {
  /** Post type: "note" (kind 1) or "thread" (kind 11) */
  type?: "note" | "thread";
  /** Event ID or naddr to reply to (for kind 1) */
  replyTo?: string;
  /** Custom title for the window */
  customTitle?: string;
}

/**
 * PostWindow - Window component for creating Nostr posts
 *
 * Supports:
 * - Kind 1 notes (short text posts)
 * - Kind 11 threads (posts with title)
 * - Replying to events (NIP-10 threading)
 *
 * @example
 * ```bash
 * post                  # Create a kind 1 note
 * post --thread         # Create a kind 11 thread
 * post --reply <id>     # Reply to an event
 * ```
 */
export function PostWindow({
  type = "note",
  replyTo: replyToId,
  customTitle,
}: PostWindowProps) {
  const activeAccount = use$(accountManager.active$);
  const { searchProfiles } = useProfileSearch();
  const { searchEmojis } = useEmojiSearch();
  const composerRef = useRef<PostComposerHandle>(null);
  const [isPublishing, setIsPublishing] = useState(false);

  // Load reply-to event if provided
  const replyToEvent = use$(
    () => (replyToId ? eventStore.event(replyToId) : undefined),
    [replyToId],
  );

  // Track loading state for reply event
  const [isLoadingReply, setIsLoadingReply] = useState(!!replyToId);

  useEffect(() => {
    if (!replyToId) {
      setIsLoadingReply(false);
      return;
    }

    // Check if event is loaded
    if (replyToEvent) {
      setIsLoadingReply(false);
    } else {
      // Event not loaded yet, keep loading state
      setIsLoadingReply(true);
    }
  }, [replyToId, replyToEvent]);

  const handleSubmit = useCallback(
    async (data: PostSubmitData) => {
      if (!activeAccount) {
        toast.error("Please sign in to post");
        return;
      }

      setIsPublishing(true);
      try {
        const postMetadata: PostMetadata = {
          content: data.content,
          emojiTags: data.emojiTags,
          blobAttachments: data.blobAttachments,
          // TODO: Extract mentions and hashtags from content
          // mentionedPubkeys: extractMentions(data.content),
          // hashtags: extractHashtags(data.content),
        };

        let eventTemplate;

        if (type === "thread") {
          if (!data.title || !data.title.trim()) {
            toast.error("Thread title is required");
            setIsPublishing(false);
            return;
          }

          eventTemplate = buildKind11Event({
            title: data.title,
            post: postMetadata,
            pubkey: activeAccount.pubkey,
          });
        } else {
          // Kind 1 note (with optional reply)
          eventTemplate = buildKind1Event({
            post: postMetadata,
            replyTo: replyToEvent,
            pubkey: activeAccount.pubkey,
          });
        }

        // Publish using action runner
        await lastValueFrom(
          hub.exec(() => async ({ sign, publish }: ActionContext) => {
            const signedEvent = await sign(eventTemplate);
            await publish(signedEvent);
          }),
        );

        const successMessage =
          type === "thread"
            ? "Thread created!"
            : replyToEvent
              ? "Reply published!"
              : "Note published!";

        toast.success(successMessage);
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
    [activeAccount, type, replyToEvent],
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

  // Show loading state while fetching reply event
  if (isLoadingReply) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
        <Loader2 className="size-6 animate-spin" />
        <span className="text-xs">Loading event...</span>
      </div>
    );
  }

  // Show error if reply event not found
  if (replyToId && !replyToEvent) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground p-4">
        <AlertCircle className="size-8 text-destructive" />
        <span className="text-sm text-center">
          Could not load event to reply to
        </span>
        <span className="text-xs text-muted-foreground/70 font-mono">
          {replyToId.slice(0, 16)}...
        </span>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col p-4">
      {/* Header */}
      <div className="mb-4">
        <h2 className="text-lg font-semibold">
          {customTitle ||
            (type === "thread"
              ? "Create Thread"
              : replyToEvent
                ? "Reply to Note"
                : "Create Note")}
        </h2>
        {type === "thread" && (
          <p className="text-xs text-muted-foreground mt-1">
            Threads (kind 11) have a title and use flat reply structure
          </p>
        )}
        {replyToEvent && (
          <p className="text-xs text-muted-foreground mt-1">
            Your reply will use NIP-10 threading tags
          </p>
        )}
      </div>

      {/* Composer */}
      <div className="flex-1 min-h-0">
        <PostComposer
          ref={composerRef}
          variant="card"
          showTitleInput={type === "thread"}
          onSubmit={handleSubmit}
          searchProfiles={searchProfiles}
          searchEmojis={searchEmojis}
          replyTo={replyToEvent}
          showSubmitButton
          submitLabel={
            type === "thread"
              ? "Create Thread"
              : replyToEvent
                ? "Reply"
                : "Publish"
          }
          isLoading={isPublishing}
          placeholder={
            type === "thread"
              ? "Write your thread content..."
              : replyToEvent
                ? "Write your reply..."
                : "What's on your mind?"
          }
          titlePlaceholder="Thread title..."
          autoFocus
        />
      </div>
    </div>
  );
}
