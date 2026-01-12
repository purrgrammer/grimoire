import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import { use$ } from "applesauce-react/hooks";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  MentionEditor,
  type MentionEditorHandle,
  type EmojiTag,
} from "@/components/editor/MentionEditor";
import { useProfileSearch } from "@/hooks/useProfileSearch";
import { useEmojiSearch } from "@/hooks/useEmojiSearch";
import { buildThreadTags } from "@/lib/thread-builder";
import { hub, publishEventToRelays } from "@/services/hub";
import accountManager from "@/services/accounts";
import type { NostrEvent } from "nostr-tools/core";
import { relayListCache } from "@/services/relay-list-cache";
import { Send, Eye, Edit3, AtSign, X } from "lucide-react";
import { getDisplayName } from "@/lib/nostr-utils";
import { useProfile } from "@/hooks/useProfile";
import { RelaySelector } from "@/components/RelaySelector";
import { PowerTools } from "@/components/PowerTools";

export interface ComposeDialogProps {
  /** Whether dialog is open */
  open: boolean;
  /** Callback when dialog open state changes */
  onOpenChange: (open: boolean) => void;
  /** Event being replied to (optional) */
  replyTo?: NostrEvent;
  /** Kind of event to create (defaults to 1 for notes) */
  kind?: number;
  /** Initial content */
  initialContent?: string;
  /** Callback after successful publish */
  onPublish?: (event: NostrEvent) => void;
}

/**
 * Generic compose/reply dialog for Nostr events
 *
 * Features:
 * - Rich text editing with profile and emoji autocomplete
 * - Reply context display
 * - Relay selection
 * - Explicit p-tag mention management
 * - Preview mode
 * - Power tools (quick formatting)
 * - Automatic thread tag building (NIP-10 for kind 1, NIP-22 for others)
 */
export function ComposeDialog({
  open,
  onOpenChange,
  replyTo,
  kind = 1,
  initialContent = "",
  onPublish,
}: ComposeDialogProps) {
  const account = use$(accountManager.active$);
  const editorRef = useRef<MentionEditorHandle>(null);

  // State
  const [isPublishing, setIsPublishing] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [selectedRelays, setSelectedRelays] = useState<string[]>([]);
  const [additionalMentions, setAdditionalMentions] = useState<string[]>([]);
  const [content, setContent] = useState(initialContent);
  const [emojiTags, setEmojiTags] = useState<EmojiTag[]>([]);

  // Hooks
  const { searchProfiles } = useProfileSearch();
  const { searchEmojis } = useEmojiSearch();

  // Load user's outbox relays
  useEffect(() => {
    async function loadRelays() {
      if (!account?.pubkey) return;

      const outboxRelays = await relayListCache.getOutboxRelays(account.pubkey);
      if (outboxRelays && outboxRelays.length > 0) {
        setSelectedRelays(outboxRelays);
      }
    }

    loadRelays();
  }, [account?.pubkey]);

  // Build thread tags
  const threadTags = useMemo(() => {
    if (!replyTo) return null;
    return buildThreadTags(replyTo, kind, additionalMentions);
  }, [replyTo, kind, additionalMentions]);

  // Get reply-to author profile
  const replyToProfile = useProfile(replyTo?.pubkey);

  // Handle content change (for preview)
  const handleContentChange = useCallback(() => {
    if (!editorRef.current) return;
    const serialized = editorRef.current.getSerializedContent();
    setContent(serialized.text);
    setEmojiTags(serialized.emojiTags);
  }, []);

  // Handle submit
  const handleSubmit = useCallback(
    async (messageContent: string, messageTags: EmojiTag[]) => {
      if (!account?.signer) {
        console.error("No signer available");
        return;
      }

      if (selectedRelays.length === 0) {
        alert("Please select at least one relay to publish to");
        return;
      }

      setIsPublishing(true);

      try {
        // Build tags
        const tags: string[][] = [];

        // Add thread tags if replying
        if (threadTags) {
          tags.push(...threadTags.tags);
        }

        // Add emoji tags (NIP-30)
        for (const emoji of messageTags) {
          tags.push(["emoji", emoji.shortcode, emoji.url]);
        }

        // Create and sign event
        const draft = await hub.factory.build({
          kind,
          content: messageContent,
          tags,
        });
        const event = await hub.factory.sign(draft);

        // Publish to selected relays
        await publishEventToRelays(event, selectedRelays);

        // Callback
        onPublish?.(event);

        // Close dialog
        onOpenChange(false);

        // Clear editor
        editorRef.current?.clear();
        setAdditionalMentions([]);
      } catch (error) {
        console.error("Failed to publish:", error);
        alert(`Failed to publish: ${error}`);
      } finally {
        setIsPublishing(false);
      }
    },
    [
      account?.signer,
      threadTags,
      kind,
      onPublish,
      onOpenChange,
      selectedRelays,
    ],
  );

  // Add mention
  const handleAddMention = useCallback((pubkey: string) => {
    setAdditionalMentions((prev: string[]) => {
      if (prev.includes(pubkey)) return prev;
      return [...prev, pubkey];
    });
  }, []);

  // Remove mention
  const handleRemoveMention = useCallback((pubkey: string) => {
    setAdditionalMentions((prev: string[]) =>
      prev.filter((p: string) => p !== pubkey),
    );
  }, []);

  // Dialog title
  const dialogTitle = replyTo
    ? `Reply to ${getDisplayName(replyTo.pubkey, replyToProfile)}`
    : `Compose ${kind === 1 ? "Note" : `Kind ${kind}`}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[700px] h-[85vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 py-4 border-b">
          <DialogTitle>{dialogTitle}</DialogTitle>
          {replyTo && (
            <DialogDescription className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Replying to:</span>
              <span className="font-mono text-xs">
                {replyTo.content.slice(0, 60)}
                {replyTo.content.length > 60 ? "..." : ""}
              </span>
            </DialogDescription>
          )}
        </DialogHeader>

        <div className="flex-1 overflow-hidden flex flex-col">
          <Tabs
            value={showPreview ? "preview" : "edit"}
            onValueChange={(v: string) => setShowPreview(v === "preview")}
            className="flex-1 flex flex-col"
          >
            {/* Tab Navigation */}
            <div className="px-6 py-2 border-b flex items-center justify-between">
              <TabsList>
                <TabsTrigger value="edit" className="flex items-center gap-2">
                  <Edit3 className="w-4 h-4" />
                  Edit
                </TabsTrigger>
                <TabsTrigger
                  value="preview"
                  className="flex items-center gap-2"
                  onClick={handleContentChange}
                >
                  <Eye className="w-4 h-4" />
                  Preview
                </TabsTrigger>
              </TabsList>

              {/* Power Tools */}
              <PowerTools
                onInsert={(text) => editorRef.current?.insertText(text)}
                onAddMention={handleAddMention}
              />
            </div>

            {/* Edit Tab */}
            <TabsContent
              value="edit"
              className="flex-1 m-0 p-6 overflow-y-auto"
            >
              <div className="space-y-4">
                {/* Editor */}
                <MentionEditor
                  ref={editorRef}
                  placeholder={
                    replyTo ? "Write your reply..." : "What's on your mind?"
                  }
                  onSubmit={handleSubmit}
                  searchProfiles={searchProfiles}
                  searchEmojis={searchEmojis}
                  autoFocus
                  className="min-h-[200px] items-start"
                />

                {/* Additional Mentions */}
                {additionalMentions.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-sm font-medium flex items-center gap-2">
                      <AtSign className="w-4 h-4" />
                      Additional Mentions
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {additionalMentions.map((pubkey: string) => (
                        <MentionBadge
                          key={pubkey}
                          pubkey={pubkey}
                          onRemove={() => {
                            handleRemoveMention(pubkey);
                          }}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {/* Relay Info */}
                {selectedRelays.length > 0 && (
                  <div className="text-xs text-muted-foreground">
                    Publishing to {selectedRelays.length} relay
                    {selectedRelays.length === 1 ? "" : "s"}
                  </div>
                )}
              </div>
            </TabsContent>

            {/* Preview Tab */}
            <TabsContent
              value="preview"
              className="flex-1 m-0 p-6 overflow-y-auto"
            >
              <div className="prose prose-sm max-w-none dark:prose-invert">
                <div className="whitespace-pre-wrap break-words">
                  {content || (
                    <span className="text-muted-foreground italic">
                      Nothing to preview yet...
                    </span>
                  )}
                </div>

                {/* Show thread tags */}
                {threadTags && (
                  <div className="mt-6 pt-6 border-t">
                    <h4 className="text-sm font-medium mb-2">Thread Tags</h4>
                    <div className="space-y-1 font-mono text-xs">
                      {threadTags.tags.map((tag: string[], i: number) => (
                        <div key={i} className="text-muted-foreground">
                          [{tag.join(", ")}]
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Show emoji tags */}
                {emojiTags.length > 0 && (
                  <div className="mt-4">
                    <h4 className="text-sm font-medium mb-2">Emoji Tags</h4>
                    <div className="space-y-1 font-mono text-xs">
                      {emojiTags.map((tag: EmojiTag, i: number) => (
                        <div key={i} className="text-muted-foreground">
                          ["emoji", "{tag.shortcode}", "{tag.url}"]
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </div>

        {/* Footer */}
        <DialogFooter className="px-6 py-4 border-t flex items-center justify-between">
          <div className="flex items-center gap-2">
            <RelaySelector
              selectedRelays={selectedRelays}
              onRelaysChange={setSelectedRelays}
            />
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isPublishing}
            >
              Cancel
            </Button>
            <Button
              onClick={() => editorRef.current?.submit()}
              disabled={isPublishing || !account?.signer}
            >
              {isPublishing ? (
                "Publishing..."
              ) : (
                <>
                  <Send className="w-4 h-4 mr-2" />
                  {replyTo ? "Reply" : "Publish"}
                </>
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Badge component for displaying mentioned profiles
 */
function MentionBadge({
  pubkey,
  onRemove,
}: {
  pubkey: string;
  onRemove: () => void;
}) {
  const profile = useProfile(pubkey);
  const displayName = getDisplayName(pubkey, profile);

  return (
    <div className="inline-flex items-center gap-2 pl-2 pr-1 py-1 rounded-full bg-secondary text-secondary-foreground">
      <AtSign className="w-3 h-3" />
      <span className="text-sm">{displayName}</span>
      <Button
        variant="ghost"
        size="icon"
        className="h-4 w-4 hover:bg-destructive/10 hover:text-destructive rounded-full"
        onClick={onRemove}
      >
        <X className="h-3 w-3" />
        <span className="sr-only">Remove {displayName}</span>
      </Button>
    </div>
  );
}
