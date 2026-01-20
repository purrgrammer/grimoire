import { useRef, useMemo, useState, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { NostrEditor, type NostrEditorHandle } from "./editor/NostrEditor";
import { createNostrSuggestions } from "./editor/suggestions";
import { useProfileSearch } from "@/hooks/useProfileSearch";
import { useEmojiSearch } from "@/hooks/useEmojiSearch";
import { useBlossomUpload } from "@/hooks/useBlossomUpload";
import { useAccount } from "@/hooks/useAccount";
import { Loader2, Paperclip } from "lucide-react";
import { toast } from "sonner";
import { hub } from "@/services/hub";
import { NoteBlueprint } from "applesauce-common/blueprints";
import type { SerializedContent } from "./editor/types";
import { lastValueFrom } from "rxjs";
import type { ActionContext } from "applesauce-actions";

interface PostDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

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

export default function PostDialog({ open, onOpenChange }: PostDialogProps) {
  const { pubkey, canSign } = useAccount();
  const { searchProfiles } = useProfileSearch();
  const { searchEmojis } = useEmojiSearch();
  const editorRef = useRef<NostrEditorHandle>(null);
  const [isPublishing, setIsPublishing] = useState(false);

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
        editorRef.current?.clear();
        onOpenChange(false);
      } catch (error) {
        console.error("[PostDialog] Failed to publish:", error);
        toast.error(
          error instanceof Error ? error.message : "Failed to publish post",
        );
      } finally {
        setIsPublishing(false);
      }
    },
    [canSign, pubkey, onOpenChange],
  );

  // Handle submit button click
  const handleSubmitClick = useCallback(() => {
    if (editorRef.current) {
      const content = editorRef.current.getSerializedContent();
      handlePublish(content);
    }
  }, [handlePublish]);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New Post</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <NostrEditor
              ref={editorRef}
              placeholder="What's on your mind?"
              variant="full"
              submitBehavior="button-only"
              blobPreview="gallery"
              minLines={8}
              suggestions={suggestions}
              autoFocus
            />

            <div className="flex items-center justify-between">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={openUpload}
                disabled={isPublishing}
              >
                <Paperclip className="size-4 mr-1" />
                Attach
              </Button>

              <Button
                type="button"
                onClick={handleSubmitClick}
                disabled={isPublishing || !canSign}
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
        </DialogContent>
      </Dialog>

      {uploadDialog}
    </>
  );
}
