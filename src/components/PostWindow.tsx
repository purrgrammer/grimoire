import { useCallback, useRef, useState, useMemo, useEffect } from "react";
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
import eventStore from "@/services/event-store";
import { getTagValues } from "@/lib/nostr-utils";
import type { ProfileSearchResult } from "@/services/profile-search";

type RelayPublishState = "idle" | "publishing" | "success" | "error";

interface RelayStatus {
  url: string;
  state: RelayPublishState;
  error?: string;
}

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
export function PostWindow({ kind = 1 }: PostWindowProps) {
  const activeAccount = use$(accountManager.active$);
  const { searchProfiles } = useProfileSearch();
  const { searchEmojis } = useEmojiSearch();
  const composerRef = useRef<PostComposerHandle>(null);
  const [isPublishing, setIsPublishing] = useState(false);
  const [relayStatuses, setRelayStatuses] = useState<RelayStatus[]>([]);

  // Get user's contacts (kind 3 contact list)
  const contactList = use$(
    () =>
      activeAccount
        ? eventStore.replaceable(3, activeAccount.pubkey)
        : undefined,
    [activeAccount?.pubkey],
  );

  const contactPubkeys = useMemo(() => {
    if (!contactList) return new Set<string>();
    const pubkeys = getTagValues(contactList, "p").filter(
      (pk) => pk.length === 64,
    );
    return new Set(pubkeys);
  }, [contactList]);

  // Preload contact profiles for @ autocomplete
  useEffect(() => {
    if (contactPubkeys.size === 0) return;

    // Load profiles for all contacts (trigger fetching if not in store)
    const pubkeysArray = Array.from(contactPubkeys);
    for (const pubkey of pubkeysArray) {
      // Subscribe to profile - this triggers loading if not in store
      const sub = eventStore.replaceable(0, pubkey).subscribe(() => {
        // Profile loaded or updated
      });
      // Clean up subscription after initial load
      setTimeout(() => sub.unsubscribe(), 1000);
    }
  }, [contactPubkeys]);

  // Filter profile search to only contacts
  const searchContactProfiles = useCallback(
    async (query: string): Promise<ProfileSearchResult[]> => {
      const allResults = await searchProfiles(query);
      // If no contacts, return all results
      if (contactPubkeys.size === 0) return allResults;
      // Filter to only contacts
      return allResults.filter((result) => contactPubkeys.has(result.pubkey));
    },
    [searchProfiles, contactPubkeys],
  );

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

      // Initialize relay statuses
      const initialStatuses: RelayStatus[] = data.relays.map((url) => ({
        url,
        state: "publishing" as const,
      }));
      setRelayStatuses(initialStatuses);

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

        // Sign event first
        let signedEvent: any;
        await lastValueFrom(
          hub.exec(() => async ({ sign }: ActionContext) => {
            signedEvent = await sign(unsignedEvent);
          }),
        );

        // Publish to each relay individually and track status
        const publishResults = await Promise.allSettled(
          data.relays.map(async (relay) => {
            try {
              await lastValueFrom(
                hub.exec(() => async ({ publish }: ActionContext) => {
                  await publish(signedEvent, [relay]);
                }),
              );

              // Update relay status to success
              setRelayStatuses((prev) =>
                prev.map((status) =>
                  status.url === relay
                    ? { ...status, state: "success" as const }
                    : status,
                ),
              );

              return { relay, success: true };
            } catch (error) {
              // Update relay status to error
              setRelayStatuses((prev) =>
                prev.map((status) =>
                  status.url === relay
                    ? {
                        ...status,
                        state: "error" as const,
                        error:
                          error instanceof Error
                            ? error.message
                            : "Failed to publish",
                      }
                    : status,
                ),
              );

              return {
                relay,
                success: false,
                error:
                  error instanceof Error ? error.message : "Failed to publish",
              };
            }
          }),
        );

        // Count successes and failures
        const successes = publishResults.filter(
          (r) => r.status === "fulfilled" && r.value.success,
        ).length;
        const failures = publishResults.length - successes;

        // Show toast with results
        if (failures === 0) {
          toast.success(
            `Published to ${successes} relay${successes !== 1 ? "s" : ""}!`,
          );
          composerRef.current?.clear();
          // Reset relay statuses after a delay
          setTimeout(() => setRelayStatuses([]), 3000);
        } else if (successes === 0) {
          toast.error(
            `Failed to publish to all ${failures} relay${failures !== 1 ? "s" : ""}`,
          );
        } else {
          toast.warning(
            `Published to ${successes} relay${successes !== 1 ? "s" : ""}, ${failures} failed`,
          );
          composerRef.current?.clear();
          // Keep error statuses visible for retry
        }
      } catch (error) {
        console.error("Failed to publish:", error);
        toast.error(
          error instanceof Error ? error.message : "Failed to publish",
        );
        // Reset all to error state
        setRelayStatuses((prev) =>
          prev.map((status) => ({
            ...status,
            state: "error" as const,
            error: error instanceof Error ? error.message : "Failed to publish",
          })),
        );
      } finally {
        setIsPublishing(false);
      }
    },
    [activeAccount, kind],
  );

  // Retry publishing to failed relays
  const handleRetryFailedRelays = useCallback(async () => {
    const failedRelays = relayStatuses
      .filter((status) => status.state === "error")
      .map((status) => status.url);

    if (failedRelays.length === 0) return;

    // TODO: Implement full retry logic - for now just show notification
    toast.info(
      `Retry functionality coming soon for ${failedRelays.length} failed relay${failedRelays.length !== 1 ? "s" : ""}`,
    );
  }, [relayStatuses]);

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
      {/* Composer - full height */}
      <PostComposer
        ref={composerRef}
        variant="card"
        onSubmit={handleSubmit}
        searchProfiles={searchContactProfiles}
        searchEmojis={searchEmojis}
        showSubmitButton
        submitLabel="Publish"
        isLoading={isPublishing}
        placeholder="What's on your mind?"
        autoFocus
        className="h-full"
        relayStatuses={relayStatuses}
        onRetryFailedRelays={handleRetryFailedRelays}
      />
    </div>
  );
}
