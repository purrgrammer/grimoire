import { useState, useRef, useEffect } from "react";
import { Loader2, Paperclip, Send, CheckSquare, Square } from "lucide-react";
import { toast } from "sonner";
import { EventFactory } from "applesauce-core/event-factory";
import { useAccount } from "@/hooks/useAccount";
import { useProfileSearch } from "@/hooks/useProfileSearch";
import { useEmojiSearch } from "@/hooks/useEmojiSearch";
import { useBlossomUpload } from "@/hooks/useBlossomUpload";
import { relayListCache } from "@/services/relay-list-cache";
import { publishEventToRelays } from "@/services/hub";
import {
  MentionEditor,
  type MentionEditorHandle,
} from "./editor/MentionEditor";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { Label } from "./ui/label";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./ui/tooltip";
import LoginDialog from "./nostr/LoginDialog";

interface NoteComposerProps {
  initialContent?: string;
}

/**
 * NoteComposer - WYSIWYG composer for creating kind 1 text notes
 *
 * Features:
 * - Rich text editing with TipTap
 * - Profile mention autocomplete (@username)
 * - Emoji autocomplete (:emoji:) with Unicode and custom emoji support
 * - File upload with Blossom integration
 * - Relay selector for publishing
 * - Character counter
 * - NIP-27 mentions (nostr: URIs)
 * - NIP-30 custom emoji tags
 * - NIP-92 media attachments (imeta tags)
 */
export function NoteComposer({ initialContent }: NoteComposerProps) {
  const { pubkey, canSign, signer } = useAccount();
  const { searchProfiles } = useProfileSearch();
  const { searchEmojis } = useEmojiSearch();
  const editorRef = useRef<MentionEditorHandle>(null);

  // State for publishing
  const [isPublishing, setIsPublishing] = useState(false);
  const [showLogin, setShowLogin] = useState(false);

  // Get user's outbox relays (write relays)
  const [userRelays, setUserRelays] = useState<string[]>([]);
  const [loadingRelays, setLoadingRelays] = useState(true);
  const [selectedRelays, setSelectedRelays] = useState<Set<string>>(new Set());

  // Load user's outbox relays
  useEffect(() => {
    async function loadRelays() {
      if (!pubkey) {
        setLoadingRelays(false);
        return;
      }

      setLoadingRelays(true);
      try {
        const outboxRelays = await relayListCache.getOutboxRelays(pubkey);
        if (outboxRelays && outboxRelays.length > 0) {
          setUserRelays(outboxRelays);
          // Select all relays by default
          setSelectedRelays(new Set(outboxRelays));
        } else {
          // Fallback to some default relays if user has none configured
          const defaultRelays = [
            "wss://relay.damus.io",
            "wss://nos.lol",
            "wss://relay.nostr.band",
          ];
          setUserRelays(defaultRelays);
          setSelectedRelays(new Set(defaultRelays));
        }
      } catch (error) {
        console.error("[NoteComposer] Failed to load relays:", error);
        // Use fallback relays on error
        const defaultRelays = [
          "wss://relay.damus.io",
          "wss://nos.lol",
          "wss://relay.nostr.band",
        ];
        setUserRelays(defaultRelays);
        setSelectedRelays(new Set(defaultRelays));
      } finally {
        setLoadingRelays(false);
      }
    }

    loadRelays();
  }, [pubkey]);

  // Blossom upload hook
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

  // Set initial content when component mounts
  useEffect(() => {
    if (initialContent && editorRef.current) {
      editorRef.current.insertText(initialContent);
    }
  }, [initialContent]);

  // Toggle relay selection
  const toggleRelay = (relay: string) => {
    setSelectedRelays((prev) => {
      const next = new Set(prev);
      if (next.has(relay)) {
        next.delete(relay);
      } else {
        next.add(relay);
      }
      return next;
    });
  };

  // Toggle all relays
  const toggleAllRelays = () => {
    if (selectedRelays.size === userRelays.length) {
      setSelectedRelays(new Set());
    } else {
      setSelectedRelays(new Set(userRelays));
    }
  };

  // Handle post submission
  const handlePost = async () => {
    if (!canSign || !signer || !pubkey || isPublishing) return;

    if (!editorRef.current || editorRef.current.isEmpty()) {
      toast.error("Cannot publish empty note");
      return;
    }

    if (selectedRelays.size === 0) {
      toast.error("Please select at least one relay to publish to");
      return;
    }

    setIsPublishing(true);
    try {
      // Get serialized content from editor
      const { text, emojiTags, blobAttachments } =
        editorRef.current.getSerializedContent();

      // Create kind 1 event
      const factory = new EventFactory();
      factory.setSigner(signer);

      const draft = {
        kind: 1,
        content: text,
        created_at: Math.floor(Date.now() / 1000),
        tags: [] as string[][],
      };

      // Add emoji tags (NIP-30)
      for (const emoji of emojiTags) {
        draft.tags.push(["emoji", emoji.shortcode, emoji.url]);
      }

      // Add imeta tags for blob attachments (NIP-92)
      for (const blob of blobAttachments) {
        const imetaTag = ["imeta", `url ${blob.url}`];
        if (blob.sha256) {
          imetaTag.push(`x ${blob.sha256}`);
        }
        if (blob.mimeType) {
          imetaTag.push(`m ${blob.mimeType}`);
        }
        if (blob.size) {
          imetaTag.push(`size ${blob.size}`);
        }
        draft.tags.push(imetaTag);
      }

      // Sign the event
      const signedEvent = await factory.sign(draft);

      // Publish to selected relays
      await publishEventToRelays(signedEvent, Array.from(selectedRelays));

      // Success!
      toast.success(
        `Note published to ${selectedRelays.size} relay${selectedRelays.size > 1 ? "s" : ""}`,
      );

      // Clear the editor
      editorRef.current.clear();
      editorRef.current.focus();
    } catch (error) {
      console.error("[NoteComposer] Failed to publish note:", error);
      const errorMessage =
        error instanceof Error ? error.message : "Failed to publish note";
      toast.error(errorMessage);
    } finally {
      setIsPublishing(false);
    }
  };

  if (!canSign) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-sm text-muted-foreground">
          Sign in to compose and publish notes
        </p>
        <Button onClick={() => setShowLogin(true)} variant="outline">
          Sign In
        </Button>
        <LoginDialog open={showLogin} onOpenChange={setShowLogin} />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Editor */}
      <div className="flex-1 overflow-auto p-4">
        <div className="mx-auto max-w-2xl">
          <MentionEditor
            ref={editorRef}
            placeholder="What's on your mind?"
            searchProfiles={searchProfiles}
            searchEmojis={searchEmojis}
            onSubmit={(content) => {
              if (content.trim()) {
                handlePost();
              }
            }}
            className="min-h-[200px] h-auto p-3 rounded-lg border-2 focus-within:border-primary"
            autoFocus
          />
        </div>
      </div>

      {/* Toolbar */}
      <div className="border-t bg-muted/30 p-4">
        <div className="mx-auto max-w-2xl">
          <div className="flex items-start gap-4">
            {/* Attachment button */}
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="flex-shrink-0"
                    onClick={openUpload}
                    disabled={isPublishing}
                  >
                    <Paperclip className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Attach media</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>

            {/* Relay selector */}
            <div className="flex-1 min-w-0">
              <Label className="text-xs text-muted-foreground mb-1 block">
                Publish to relays:
              </Label>
              {loadingRelays ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="size-3 animate-spin" />
                  Loading relays...
                </div>
              ) : userRelays.length === 0 ? (
                <div className="text-xs text-muted-foreground">
                  No relays configured. Please set up your relay list.
                </div>
              ) : (
                <div className="space-y-1">
                  {/* Select all toggle */}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={toggleAllRelays}
                      className="flex items-center gap-2 text-xs hover:text-foreground transition-colors"
                    >
                      {selectedRelays.size === userRelays.length ? (
                        <CheckSquare className="size-3" />
                      ) : (
                        <Square className="size-3" />
                      )}
                      <span className="text-muted-foreground">
                        Select all ({userRelays.length})
                      </span>
                    </button>
                  </div>
                  {/* Relay checkboxes */}
                  <div className="flex flex-wrap gap-2">
                    {userRelays.map((relay) => (
                      <label
                        key={relay}
                        className="flex items-center gap-1.5 cursor-pointer group"
                      >
                        <Checkbox
                          checked={selectedRelays.has(relay)}
                          onCheckedChange={() => toggleRelay(relay)}
                          disabled={isPublishing}
                        />
                        <span className="text-xs group-hover:text-foreground transition-colors">
                          {relay.replace(/^wss?:\/\//, "")}
                        </span>
                      </label>
                    ))}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {selectedRelays.size} of {userRelays.length} selected
                  </div>
                </div>
              )}
            </div>

            {/* Post button */}
            <Button
              onClick={handlePost}
              disabled={isPublishing || selectedRelays.size === 0}
              className="flex-shrink-0 gap-2"
            >
              {isPublishing ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Publishing...
                </>
              ) : (
                <>
                  <Send className="size-4" />
                  Post
                </>
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* Blossom upload dialog */}
      {uploadDialog}
    </div>
  );
}
