import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import { Paperclip, Send, Loader2, Check, X, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { Label } from "./ui/label";
import { useAccount } from "@/hooks/useAccount";
import { useProfileSearch } from "@/hooks/useProfileSearch";
import { useEmojiSearch } from "@/hooks/useEmojiSearch";
import { useBlossomUpload } from "@/hooks/useBlossomUpload";
import { RichEditor, type RichEditorHandle } from "./editor/RichEditor";
import type { BlobAttachment, EmojiTag } from "./editor/MentionEditor";
import pool from "@/services/relay-pool";
import eventStore from "@/services/event-store";
import { EventFactory } from "applesauce-core/event-factory";
import { useGrimoire } from "@/core/state";

// Per-relay publish status
type RelayStatus = "pending" | "publishing" | "success" | "error";

interface RelayPublishState {
  url: string;
  status: RelayStatus;
  error?: string;
}

export function PostViewer() {
  const { pubkey, canSign, signer } = useAccount();
  const { searchProfiles } = useProfileSearch();
  const { searchEmojis } = useEmojiSearch();
  const { state } = useGrimoire();

  // Editor ref for programmatic control
  const editorRef = useRef<RichEditorHandle>(null);

  // Publish state
  const [isPublishing, setIsPublishing] = useState(false);
  const [relayStates, setRelayStates] = useState<RelayPublishState[]>([]);
  const [selectedRelays, setSelectedRelays] = useState<Set<string>>(new Set());

  // Get active account's write relays from Grimoire state
  const writeRelays = useMemo(() => {
    if (!state.activeAccount?.relays) return [];
    return state.activeAccount.relays.filter((r) => r.write).map((r) => r.url);
  }, [state.activeAccount?.relays]);

  // Update relay states when write relays change
  const updateRelayStates = useCallback(() => {
    setRelayStates(
      writeRelays.map((url) => ({
        url,
        status: "pending" as RelayStatus,
      })),
    );
    setSelectedRelays(new Set(writeRelays));
  }, [writeRelays]);

  // Initialize selected relays when write relays change
  useEffect(() => {
    if (writeRelays.length > 0) {
      updateRelayStates();
    }
  }, [writeRelays, updateRelayStates]);

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

  // Toggle relay selection
  const toggleRelay = useCallback((url: string) => {
    setSelectedRelays((prev) => {
      const next = new Set(prev);
      if (next.has(url)) {
        next.delete(url);
      } else {
        next.add(url);
      }
      return next;
    });
  }, []);

  // Publish to selected relays with per-relay status tracking
  const handlePublish = useCallback(
    async (
      content: string,
      emojiTags: EmojiTag[],
      blobAttachments: BlobAttachment[],
    ) => {
      if (!canSign || !signer || !pubkey) {
        toast.error("Please log in to publish");
        return;
      }

      if (!content.trim()) {
        toast.error("Cannot publish empty note");
        return;
      }

      const selected = Array.from(selectedRelays);
      if (selected.length === 0) {
        toast.error("Please select at least one relay");
        return;
      }

      setIsPublishing(true);

      try {
        // Create event factory with signer
        const factory = new EventFactory();
        factory.setSigner(signer);

        // Build tags array
        const tags: string[][] = [];

        // Add emoji tags
        for (const emoji of emojiTags) {
          tags.push(["emoji", emoji.shortcode, emoji.url]);
        }

        // Add blob attachment tags (imeta)
        for (const blob of blobAttachments) {
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
          tags.push(imetaTag);
        }

        // Create and sign event (kind 1 note)
        const draft = await factory.build({ kind: 1, content, tags });
        const event = await factory.sign(draft);

        // Initialize relay states
        setRelayStates(
          selected.map((url) => ({
            url,
            status: "publishing" as RelayStatus,
          })),
        );

        // Publish to each relay individually to track status
        const publishPromises = selected.map(async (relayUrl) => {
          try {
            await pool.publish([relayUrl], event);

            // Update status to success
            setRelayStates((prev) =>
              prev.map((r) =>
                r.url === relayUrl
                  ? { ...r, status: "success" as RelayStatus }
                  : r,
              ),
            );
          } catch (error) {
            console.error(`Failed to publish to ${relayUrl}:`, error);

            // Update status to error
            setRelayStates((prev) =>
              prev.map((r) =>
                r.url === relayUrl
                  ? {
                      ...r,
                      status: "error" as RelayStatus,
                      error:
                        error instanceof Error
                          ? error.message
                          : "Unknown error",
                    }
                  : r,
              ),
            );
          }
        });

        // Wait for all publishes to complete
        await Promise.all(publishPromises);

        // Add to event store for immediate local availability
        eventStore.add(event);

        // Clear editor on success
        editorRef.current?.clear();

        toast.success(
          `Published to ${selected.length} relay${selected.length > 1 ? "s" : ""}`,
        );
      } catch (error) {
        console.error("Failed to publish:", error);
        toast.error(
          error instanceof Error ? error.message : "Failed to publish note",
        );

        // Reset relay states to pending on error
        setRelayStates((prev) =>
          prev.map((r) => ({ ...r, status: "error" as RelayStatus })),
        );
      } finally {
        setIsPublishing(false);
      }
    },
    [canSign, signer, pubkey, selectedRelays],
  );

  // Handle file paste
  const handleFilePaste = useCallback(
    (files: File[]) => {
      if (files.length > 0) {
        // For pasted files, trigger upload dialog
        openUpload();
      }
    },
    [openUpload],
  );

  // Show login prompt if not logged in
  if (!canSign) {
    return (
      <div className="h-full flex items-center justify-center p-8">
        <div className="max-w-md text-center space-y-4">
          <p className="text-muted-foreground">
            You need to be logged in to post notes.
          </p>
          <p className="text-sm text-muted-foreground">
            Click the user icon in the top right to log in.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto p-4 space-y-4">
      {/* Editor */}
      <div>
        <RichEditor
          ref={editorRef}
          placeholder="What's on your mind?"
          onSubmit={handlePublish}
          searchProfiles={searchProfiles}
          searchEmojis={searchEmojis}
          onFilePaste={handleFilePaste}
          autoFocus
          minHeight={150}
          maxHeight={400}
        />
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          onClick={() => openUpload()}
          disabled={isPublishing}
          title="Upload image/video"
        >
          <Paperclip className="h-4 w-4" />
        </Button>

        <Button
          onClick={() => editorRef.current?.submit()}
          disabled={isPublishing || selectedRelays.size === 0}
          className="gap-2 flex-1"
        >
          {isPublishing ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Publishing...
            </>
          ) : (
            <>
              <Send className="h-4 w-4" />
              Publish
            </>
          )}
        </Button>
      </div>

      {/* Relay selection */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium">
            Relays ({selectedRelays.size} selected)
          </Label>
          {writeRelays.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={updateRelayStates}
              disabled={isPublishing}
              className="h-6 text-xs"
            >
              <RefreshCw className="h-3 w-3 mr-1" />
              Reset
            </Button>
          )}
        </div>

        {writeRelays.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No write relays configured. Please add relays in your profile
            settings.
          </p>
        ) : (
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {relayStates.map((relay) => (
              <div
                key={relay.url}
                className="flex items-center justify-between gap-3 rounded-md border border-border bg-background p-2"
              >
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <Checkbox
                    id={relay.url}
                    checked={selectedRelays.has(relay.url)}
                    onCheckedChange={() => toggleRelay(relay.url)}
                    disabled={isPublishing}
                  />
                  <label
                    htmlFor={relay.url}
                    className="text-sm cursor-pointer truncate flex-1"
                  >
                    {relay.url.replace(/^wss?:\/\//, "")}
                  </label>
                </div>

                {/* Status indicator */}
                <div className="flex-shrink-0">
                  {relay.status === "publishing" && (
                    <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
                  )}
                  {relay.status === "success" && (
                    <Check className="h-4 w-4 text-green-500" />
                  )}
                  {relay.status === "error" && (
                    <div title={relay.error || "Failed to publish"}>
                      <X className="h-4 w-4 text-red-500" />
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Upload dialog */}
      {uploadDialog}
    </div>
  );
}
