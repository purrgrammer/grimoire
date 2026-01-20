import { useRef, useMemo, useState, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { NostrEditor, type NostrEditorHandle } from "./editor/NostrEditor";
import { createNostrSuggestions } from "./editor/suggestions";
import { useProfileSearch } from "@/hooks/useProfileSearch";
import { useEmojiSearch } from "@/hooks/useEmojiSearch";
import { useBlossomUpload } from "@/hooks/useBlossomUpload";
import { useAccount } from "@/hooks/useAccount";
import { Loader2, Paperclip, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { hub } from "@/services/hub";
import { NoteBlueprint } from "applesauce-common/blueprints";
import type { SerializedContent } from "./editor/types";
import { lastValueFrom } from "rxjs";
import type { ActionContext } from "applesauce-actions";
import { useEventStore } from "applesauce-react/hooks";
import { addressLoader, profileLoader } from "@/services/loaders";

// Draft storage key prefix
const DRAFT_STORAGE_PREFIX = "grimoire:post-draft:";

// Action builder for creating a short text note
function CreateNoteAction(content: SerializedContent) {
  return async ({ factory, sign, publish }: ActionContext) => {
    // Build the note using NoteBlueprint
    const draft = await factory.create(NoteBlueprint, content.text);

    // Add emoji tags if any custom emojis were used
    for (const emoji of content.emojiTags) {
      draft.tags.push(["emoji", emoji.shortcode, emoji.url]);
    }

    // Add imeta tags for media attachments
    for (const blob of content.blobAttachments) {
      const imetaValues = [`url ${blob.url}`, `x ${blob.sha256}`];
      if (blob.mimeType) imetaValues.push(`m ${blob.mimeType}`);
      if (blob.size) imetaValues.push(`size ${blob.size}`);
      draft.tags.push(["imeta", ...imetaValues]);
    }

    // Sign and publish the event
    const event = await sign(draft);
    await publish(event);
  };
}

export function PostViewer() {
  const { pubkey, canSign } = useAccount();
  const eventStore = useEventStore();
  const { searchProfiles, service: profileService } = useProfileSearch();
  const { searchEmojis } = useEmojiSearch();
  const editorRef = useRef<NostrEditorHandle>(null);
  const [isPublishing, setIsPublishing] = useState(false);
  const [isPublished, setIsPublished] = useState(false);

  // Use pubkey as draft key - one draft per account, persists across reloads
  const draftKey = pubkey ? `${DRAFT_STORAGE_PREFIX}${pubkey}` : null;

  // Load draft from localStorage on mount (stores full TipTap JSON for rich content)
  const [initialContent, setInitialContent] = useState<object | undefined>(
    undefined,
  );
  const draftLoadedRef = useRef(false);

  useEffect(() => {
    if (draftLoadedRef.current || !draftKey) return;
    draftLoadedRef.current = true;

    try {
      const savedDraft = localStorage.getItem(draftKey);
      if (savedDraft) {
        const parsed = JSON.parse(savedDraft);
        setInitialContent(parsed);
      }
    } catch (error) {
      console.warn("[PostViewer] Failed to load draft:", error);
    }
  }, [draftKey]);

  // Save draft to localStorage when content changes (uses full TipTap JSON)
  const saveDraft = useCallback(() => {
    if (!draftKey || !editorRef.current) return;
    try {
      const json = editorRef.current.getJSON();
      const text = editorRef.current.getContent();
      if (text.trim()) {
        localStorage.setItem(draftKey, JSON.stringify(json));
      } else {
        localStorage.removeItem(draftKey);
      }
    } catch (error) {
      // localStorage might be full or disabled
      console.warn("[PostViewer] Failed to save draft:", error);
    }
  }, [draftKey]);

  // Clear draft from localStorage
  const clearDraft = useCallback(() => {
    if (!draftKey) return;
    try {
      localStorage.removeItem(draftKey);
    } catch (error) {
      console.warn("[PostViewer] Failed to clear draft:", error);
    }
  }, [draftKey]);

  // Load contacts and their profiles
  useEffect(() => {
    if (!pubkey) return;

    // Load contacts list (kind 3)
    const contactsSubscription = addressLoader({
      kind: 3,
      pubkey,
      identifier: "",
    }).subscribe();

    // Watch for contacts event and load profiles
    const storeSubscription = eventStore
      .replaceable(3, pubkey, "")
      .subscribe((contactsEvent) => {
        if (!contactsEvent) return;

        // Extract pubkeys from p tags
        const contactPubkeys = contactsEvent.tags
          .filter((tag) => tag[0] === "p" && tag[1])
          .map((tag) => tag[1]);

        // Load profiles for all contacts (batched by profileLoader)
        for (const contactPubkey of contactPubkeys) {
          profileLoader({
            kind: 0,
            pubkey: contactPubkey,
            identifier: "",
          }).subscribe({
            next: (event) => {
              // Add loaded profile to search service
              profileService.addProfiles([event]);
            },
          });
        }
      });

    return () => {
      contactsSubscription.unsubscribe();
      storeSubscription.unsubscribe();
    };
  }, [pubkey, eventStore, profileService]);

  // Blossom upload for attachments
  const { open: openUpload, dialog: uploadDialog } = useBlossomUpload({
    accept: "image/*,video/*,audio/*",
    onSuccess: (results) => {
      if (results.length > 0 && editorRef.current) {
        const { blob, server } = results[0];
        editorRef.current.insertBlob({
          url: blob.url,
          sha256: blob.sha256,
          mimeType: blob.type,
          size: blob.size,
          server,
        });
        editorRef.current.focus();
      }
    },
  });

  // Create suggestions for the editor
  const suggestions = useMemo(
    () =>
      createNostrSuggestions({
        searchProfiles,
        searchEmojis,
      }),
    [searchProfiles, searchEmojis],
  );

  // Handle publishing the post
  const handlePublish = useCallback(
    async (content: SerializedContent) => {
      if (!canSign || !pubkey) {
        toast.error("Please sign in to post");
        return;
      }

      if (!content.text.trim()) {
        toast.error("Please write something to post");
        return;
      }

      setIsPublishing(true);
      try {
        // Execute the action (builds, signs, and publishes)
        await lastValueFrom(hub.exec(CreateNoteAction, content));

        toast.success("Post published!");
        setIsPublished(true);
        editorRef.current?.clear();
        clearDraft(); // Clear draft after successful publish
      } catch (error) {
        console.error("[PostViewer] Failed to publish:", error);
        toast.error(
          error instanceof Error ? error.message : "Failed to publish post",
        );
      } finally {
        setIsPublishing(false);
      }
    },
    [canSign, pubkey, clearDraft],
  );

  // Handle submit button click
  const handleSubmitClick = useCallback(() => {
    if (editorRef.current) {
      const content = editorRef.current.getSerializedContent();
      handlePublish(content);
    }
  }, [handlePublish]);

  // Handle content change - save draft and reset published state
  const handleChange = useCallback(() => {
    if (isPublished) {
      setIsPublished(false);
    }
    saveDraft();
  }, [isPublished, saveDraft]);

  if (!canSign) {
    return (
      <div className="h-full flex items-center justify-center p-4">
        <div className="text-center text-muted-foreground">
          <p className="text-lg font-medium">Sign in to post</p>
          <p className="text-sm mt-1">
            You need to be signed in with a signing-capable account to create
            posts.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col p-3 gap-2">
      <NostrEditor
        ref={editorRef}
        placeholder="What's on your mind?"
        variant="full"
        submitBehavior="button-only"
        blobPreview="gallery"
        minLines={6}
        suggestions={suggestions}
        onChange={handleChange}
        initialContent={initialContent}
        autoFocus
      />

      <div className="flex items-center justify-between">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={openUpload}
          disabled={isPublishing}
          title="Attach file"
        >
          <Paperclip className="size-4" />
        </Button>

        <div className="flex items-center gap-2">
          {isPublished && (
            <span className="text-sm text-green-600 dark:text-green-400 flex items-center gap-1">
              <CheckCircle2 className="size-4" />
              Published
            </span>
          )}
          <Button
            type="button"
            onClick={handleSubmitClick}
            disabled={isPublishing}
          >
            {isPublishing ? (
              <>
                <Loader2 className="size-4 mr-2 animate-spin" />
                Publishing...
              </>
            ) : (
              "Post"
            )}
          </Button>
        </div>
      </div>

      {uploadDialog}
    </div>
  );
}

export default PostViewer;
