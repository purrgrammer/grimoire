import {
  forwardRef,
  useImperativeHandle,
  useRef,
  useState,
  useMemo,
  useEffect,
} from "react";
import { Loader2, Paperclip, ChevronDown } from "lucide-react";
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip";
import { Checkbox } from "../ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../ui/collapsible";

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
 *
 * @example
 * ```tsx
 * <PostComposer
 *   variant="card"
 *   onSubmit={handlePublish}
 *   searchProfiles={searchProfiles}
 *   searchEmojis={searchEmojis}
 *   showSubmitButton
 * />
 * ```
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

    // Update extracted mentions when content changes
    const handleContentChange = () => {
      const serialized = editorRef.current?.getSerializedContent();
      if (serialized) {
        const mentions = extractMentions(serialized.text);
        setExtractedMentions(mentions);
        // Auto-select new mentions
        setSelectedMentions((prev) => {
          const newMentions = mentions.filter((m) => !prev.includes(m));
          return [...prev, ...newMentions];
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

      const hashtags = extractHashtags(content);

      await onSubmit({
        content,
        emojiTags,
        blobAttachments,
        relays: selectedRelays,
        mentionedPubkeys: selectedMentions,
        hashtags,
      });

      // Clear selections after successful submit
      setExtractedMentions([]);
      setSelectedMentions([]);
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
        },
        isEmpty: () => editorRef.current?.isEmpty() ?? true,
        submit: () => {
          editorRef.current?.submit();
        },
      }),
      [],
    );

    const isInline = variant === "inline";
    const isCard = variant === "card";

    // Relays section open state
    const [relaysOpen, setRelaysOpen] = useState(false);
    const [mentionsOpen, setMentionsOpen] = useState(false);

    return (
      <div
        className={`flex flex-col gap-3 ${isCard ? "p-3 border rounded-lg bg-card" : ""} ${className}`}
      >
        {/* Editor row */}
        <div className="flex gap-1.5 items-center">
          {/* Attach button */}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className={`flex-shrink-0 text-muted-foreground hover:text-foreground ${isInline ? "size-7" : "size-9"}`}
                  onClick={openUpload}
                  disabled={isLoading}
                >
                  <Paperclip className={isInline ? "size-4" : "size-5"} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">
                <p>Attach media</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          {/* Editor */}
          <div className={`flex-1 min-w-0 ${isCard ? "editor-card" : ""}`}>
            <MentionEditor
              ref={editorRef}
              placeholder={placeholder}
              searchProfiles={searchProfiles}
              searchEmojis={searchEmojis}
              searchCommands={searchCommands}
              onCommandExecute={onCommandExecute}
              onSubmit={handleSubmit}
              autoFocus={autoFocus}
              className="w-full"
              onChange={handleContentChange}
            />
          </div>

          {/* Submit button (optional) */}
          {showSubmitButton && (
            <Button
              type="button"
              variant="secondary"
              size={isInline ? "sm" : "default"}
              className={`flex-shrink-0 ${isInline ? "h-7 px-2 text-xs" : ""}`}
              disabled={isLoading}
              onClick={() => {
                editorRef.current?.submit();
              }}
            >
              {isLoading ? (
                <Loader2
                  className={`animate-spin ${isInline ? "size-3" : "size-4"}`}
                />
              ) : (
                submitLabel
              )}
            </Button>
          )}
        </div>

        {/* Relays section (collapsible) */}
        {isCard && userRelays.length > 0 && (
          <Collapsible open={relaysOpen} onOpenChange={setRelaysOpen}>
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-between text-xs h-6"
              >
                <span className="text-muted-foreground">
                  Relays ({selectedRelays.length}/{userRelays.length})
                </span>
                <ChevronDown
                  className={`size-3 transition-transform ${relaysOpen ? "rotate-180" : ""}`}
                />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-1 pt-2">
              {userRelays.map((relay) => (
                <div key={relay} className="flex items-center gap-2">
                  <Checkbox
                    id={`relay-${relay}`}
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
                  <label
                    htmlFor={`relay-${relay}`}
                    className="text-xs font-mono cursor-pointer text-foreground"
                  >
                    {relay.replace(/^wss?:\/\//, "")}
                  </label>
                </div>
              ))}
            </CollapsibleContent>
          </Collapsible>
        )}

        {/* Mentions section (collapsible) */}
        {isCard && extractedMentions.length > 0 && (
          <Collapsible open={mentionsOpen} onOpenChange={setMentionsOpen}>
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-between text-xs h-6"
              >
                <span className="text-muted-foreground">
                  Mentions ({selectedMentions.length}/{extractedMentions.length}
                  )
                </span>
                <ChevronDown
                  className={`size-3 transition-transform ${mentionsOpen ? "rotate-180" : ""}`}
                />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-1 pt-2">
              {extractedMentions.map((pubkey) => (
                <div key={pubkey} className="flex items-center gap-2">
                  <Checkbox
                    id={`mention-${pubkey}`}
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
                  />
                  <label
                    htmlFor={`mention-${pubkey}`}
                    className="text-xs font-mono cursor-pointer text-foreground"
                  >
                    {pubkey.slice(0, 8)}...{pubkey.slice(-8)}
                  </label>
                </div>
              ))}
            </CollapsibleContent>
          </Collapsible>
        )}

        {uploadDialog}
      </div>
    );
  },
);

PostComposer.displayName = "PostComposer";
