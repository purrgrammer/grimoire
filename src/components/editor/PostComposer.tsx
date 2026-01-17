import {
  forwardRef,
  useImperativeHandle,
  useRef,
  useState,
  useMemo,
  useEffect,
} from "react";
import {
  Loader2,
  Paperclip,
  Hash,
  AtSign,
  CheckCircle2,
  XCircle,
  RotateCcw,
} from "lucide-react";
import { useGrimoire } from "@/core/state";
import { nip19 } from "nostr-tools";
import {
  MentionEditor,
  type MentionEditorHandle,
  type EmojiTag,
  type BlobAttachment,
} from "./MentionEditor";
import type { ProfileSearchResult } from "@/services/profile-search";
import type { EmojiSearchResult } from "@/services/emoji-search";
import type { ChatAction } from "@/types/chat-actions";
import { useBlossomUpload } from "@/hooks/useBlossomUpload";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { UserName } from "../nostr/UserName";
import { RelayLink } from "../nostr/RelayLink";

/**
 * Result when submitting a post
 */
export interface PostSubmitData {
  content: string;
  emojiTags: EmojiTag[];
  blobAttachments: BlobAttachment[];
  relays: string[];
  mentionedPubkeys: string[];
  hashtags: string[];
}

/**
 * Props for PostComposer component
 */
export interface PostComposerProps {
  /** Callback when post is submitted */
  onSubmit: (data: PostSubmitData) => void | Promise<void>;
  /** Profile search function for @ mentions */
  searchProfiles: (query: string) => Promise<ProfileSearchResult[]>;
  /** Emoji search function for : autocomplete (optional) */
  searchEmojis?: (query: string) => Promise<EmojiSearchResult[]>;
  /** Slash command search (optional) */
  searchCommands?: (query: string) => Promise<ChatAction[]>;
  /** Command execution handler (optional) */
  onCommandExecute?: (action: ChatAction) => Promise<void>;
  /** Variant style */
  variant?: "inline" | "card";
  /** Placeholder for editor */
  placeholder?: string;
  /** Show submit button */
  showSubmitButton?: boolean;
  /** Submit button label */
  submitLabel?: string;
  /** Loading state (disables inputs) */
  isLoading?: boolean;
  /** Auto focus editor on mount */
  autoFocus?: boolean;
  /** Custom CSS class */
  className?: string;
  /** Relay publish statuses (optional) */
  relayStatuses?: Array<{
    url: string;
    state: "idle" | "publishing" | "success" | "error";
    error?: string;
  }>;
  /** Callback to retry failed relays (optional) */
  onRetryFailedRelays?: () => void;
}

export interface PostComposerHandle {
  /** Focus the editor */
  focus: () => void;
  /** Clear the editor and selections */
  clear: () => void;
  /** Check if editor is empty */
  isEmpty: () => boolean;
  /** Programmatically submit */
  submit: () => void;
}

/**
 * Extract mentioned pubkeys from nostr: URIs in content
 */
function extractMentions(content: string): string[] {
  const mentions: string[] = [];
  const nostrUriRegex = /nostr:(npub1[a-z0-9]+|nprofile1[a-z0-9]+)/g;

  let match;
  while ((match = nostrUriRegex.exec(content)) !== null) {
    try {
      const decoded = nip19.decode(match[1]);
      if (decoded.type === "npub") {
        mentions.push(decoded.data);
      } else if (decoded.type === "nprofile") {
        mentions.push(decoded.data.pubkey);
      }
    } catch {
      // Ignore invalid URIs
    }
  }

  return [...new Set(mentions)]; // Deduplicate
}

/**
 * Extract hashtags from content (#word)
 */
function extractHashtags(content: string): string[] {
  const hashtags: string[] = [];
  const hashtagRegex = /#(\w+)/g;

  let match;
  while ((match = hashtagRegex.exec(content)) !== null) {
    hashtags.push(match[1]);
  }

  return [...new Set(hashtags)]; // Deduplicate
}

/**
 * PostComposer - Generalized post composer for Nostr events
 *
 * Features:
 * - @ mention autocomplete
 * - : emoji autocomplete
 * - Blob attachments
 * - Relay selection
 * - Mention p-tag selection
 */
export const PostComposer = forwardRef<PostComposerHandle, PostComposerProps>(
  (
    {
      onSubmit,
      searchProfiles,
      searchEmojis,
      searchCommands,
      onCommandExecute,
      variant = "inline",
      placeholder = "Type a message...",
      showSubmitButton = false,
      submitLabel = "Send",
      isLoading = false,
      autoFocus = false,
      className = "",
      relayStatuses = [],
      onRetryFailedRelays,
    },
    ref,
  ) => {
    const editorRef = useRef<MentionEditorHandle>(null);
    const { state } = useGrimoire();
    const activeAccount = state.activeAccount;

    // Get user's write relays
    const userRelays = useMemo(() => {
      if (!activeAccount?.relays) return [];
      return activeAccount.relays.filter((r) => r.write).map((r) => r.url);
    }, [activeAccount]);

    // Selected relays (default to all user write relays)
    const [selectedRelays, setSelectedRelays] = useState<string[]>([]);

    // Initialize selected relays when user relays change
    useEffect(() => {
      if (userRelays.length > 0 && selectedRelays.length === 0) {
        setSelectedRelays(userRelays);
      }
    }, [userRelays, selectedRelays.length]);

    // Track extracted mentions from content
    const [extractedMentions, setExtractedMentions] = useState<string[]>([]);
    const [selectedMentions, setSelectedMentions] = useState<string[]>([]);

    // Track extracted hashtags
    const [extractedHashtags, setExtractedHashtags] = useState<string[]>([]);
    const [selectedHashtags, setSelectedHashtags] = useState<string[]>([]);

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

    // Update extracted mentions and hashtags when content changes
    const handleContentChange = () => {
      const serialized = editorRef.current?.getSerializedContent();
      if (serialized) {
        const mentions = extractMentions(serialized.text);
        const hashtags = extractHashtags(serialized.text);

        setExtractedMentions(mentions);
        setExtractedHashtags(hashtags);

        // Sync selected mentions with extracted mentions
        // Remove mentions that are no longer in content
        setSelectedMentions((prev) => {
          const stillPresent = prev.filter((m) => mentions.includes(m));
          const newMentions = mentions.filter((m) => !prev.includes(m));
          return [...stillPresent, ...newMentions];
        });

        // Sync selected hashtags with extracted hashtags
        // Remove hashtags that are no longer in content
        setSelectedHashtags((prev) => {
          const stillPresent = prev.filter((h) => hashtags.includes(h));
          const newHashtags = hashtags.filter((h) => !prev.includes(h));
          return [...stillPresent, ...newHashtags];
        });
      }
    };

    // Handle submit
    const handleSubmit = async (
      content: string,
      emojiTags: EmojiTag[],
      blobAttachments: BlobAttachment[],
    ) => {
      if (!content.trim()) return;

      await onSubmit({
        content,
        emojiTags,
        blobAttachments,
        relays: selectedRelays,
        mentionedPubkeys: selectedMentions,
        hashtags: selectedHashtags,
      });

      // Clear selections after successful submit
      setExtractedMentions([]);
      setSelectedMentions([]);
      setExtractedHashtags([]);
      setSelectedHashtags([]);
    };

    // Expose methods via ref
    useImperativeHandle(
      ref,
      () => ({
        focus: () => editorRef.current?.focus(),
        clear: () => {
          editorRef.current?.clear();
          setExtractedMentions([]);
          setSelectedMentions([]);
          setExtractedHashtags([]);
          setSelectedHashtags([]);
          setSelectedRelays(userRelays);
        },
        isEmpty: () => editorRef.current?.isEmpty() ?? true,
        submit: () => {
          editorRef.current?.submit();
        },
      }),
      [userRelays],
    );

    const isCard = variant === "card";

    return (
      <div className={`flex flex-col gap-3 ${className}`}>
        {/* Editor - full width, no border, takes up available space */}
        <div className={`${isCard ? "editor-card flex-1 min-h-0" : ""}`}>
          <MentionEditor
            ref={editorRef}
            placeholder={placeholder}
            searchProfiles={searchProfiles}
            searchEmojis={searchEmojis}
            searchCommands={searchCommands}
            onCommandExecute={onCommandExecute}
            onSubmit={handleSubmit}
            autoFocus={autoFocus}
            className="w-full h-full"
            onChange={handleContentChange}
          />
        </div>

        {/* Actions row: Upload, Mentions dropdown, Hashtags dropdown */}
        {isCard && (
          <div className="flex items-center gap-2">
            {/* Upload button */}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={openUpload}
              disabled={isLoading}
              className="h-8"
            >
              <Paperclip className="size-4 mr-1.5" />
              Upload
            </Button>

            {/* Mentions dropdown */}
            {extractedMentions.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8">
                    <AtSign className="size-4 mr-1" />
                    {selectedMentions.length}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-72">
                  {extractedMentions.map((pubkey) => (
                    <DropdownMenuCheckboxItem
                      key={pubkey}
                      checked={selectedMentions.includes(pubkey)}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          setSelectedMentions([...selectedMentions, pubkey]);
                        } else {
                          setSelectedMentions(
                            selectedMentions.filter((p) => p !== pubkey),
                          );
                        }
                      }}
                    >
                      <div className="flex flex-col gap-0.5 min-w-0">
                        <UserName pubkey={pubkey} className="text-sm" />
                        <span className="font-mono text-xs text-muted-foreground">
                          {pubkey.slice(0, 8)}...{pubkey.slice(-8)}
                        </span>
                      </div>
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            {/* Hashtags dropdown */}
            {extractedHashtags.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8">
                    <Hash className="size-4 mr-1" />
                    {selectedHashtags.length}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-48">
                  {extractedHashtags.map((tag) => (
                    <DropdownMenuCheckboxItem
                      key={tag}
                      checked={selectedHashtags.includes(tag)}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          setSelectedHashtags([...selectedHashtags, tag]);
                        } else {
                          setSelectedHashtags(
                            selectedHashtags.filter((t) => t !== tag),
                          );
                        }
                      }}
                    >
                      <span className="text-sm">#{tag}</span>
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        )}

        {/* Relay selector with status */}
        {isCard && userRelays.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <div className="text-xs font-medium text-muted-foreground">
                Publish to relays:
              </div>
              {relayStatuses.filter((s) => s.state === "error").length > 0 &&
                onRetryFailedRelays && (
                  <button
                    onClick={onRetryFailedRelays}
                    className="text-xs text-primary hover:underline flex items-center gap-1"
                  >
                    <RotateCcw className="size-3" />
                    Retry failed
                  </button>
                )}
            </div>
            <div className="flex flex-col gap-1.5 max-h-32 overflow-y-auto">
              {userRelays.map((relay) => {
                const status = relayStatuses.find((s) => s.url === relay);
                return (
                  <div
                    key={relay}
                    className="flex items-center gap-2 text-sm hover:bg-muted/50 p-1.5 rounded"
                  >
                    <Checkbox
                      checked={selectedRelays.includes(relay)}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          setSelectedRelays([...selectedRelays, relay]);
                        } else {
                          setSelectedRelays(
                            selectedRelays.filter((r) => r !== relay),
                          );
                        }
                      }}
                    />
                    <div className="flex-1 min-w-0">
                      <RelayLink
                        url={relay}
                        showInboxOutbox={false}
                        className="text-xs"
                      />
                    </div>
                    {status && (
                      <div className="flex items-center gap-1">
                        {status.state === "publishing" && (
                          <Loader2 className="size-3 animate-spin text-muted-foreground" />
                        )}
                        {status.state === "success" && (
                          <CheckCircle2 className="size-3 text-green-600" />
                        )}
                        {status.state === "error" && (
                          <div title={status.error}>
                            <XCircle className="size-3 text-red-600" />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Big publish button */}
        {showSubmitButton && (
          <Button
            type="button"
            size="lg"
            disabled={isLoading || selectedRelays.length === 0}
            onClick={() => {
              editorRef.current?.submit();
            }}
            className="w-full h-12 text-base font-semibold"
          >
            {isLoading ? (
              <>
                <Loader2 className="size-5 mr-2 animate-spin" />
                Publishing...
              </>
            ) : (
              submitLabel
            )}
          </Button>
        )}

        {uploadDialog}
      </div>
    );
  },
);

PostComposer.displayName = "PostComposer";
