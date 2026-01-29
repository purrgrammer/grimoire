/**
 * Composer - Schema-driven event composition
 *
 * A generic composer component that adapts its UI based on the provided schema.
 * Supports different editor types, metadata fields, and relay strategies.
 */

import {
  useState,
  useRef,
  useCallback,
  useEffect,
  forwardRef,
  useImperativeHandle,
} from "react";
import {
  Paperclip,
  Send,
  Loader2,
  Settings,
  Server,
  ServerOff,
  Plus,
  Circle,
  Check,
  X,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import type { NostrEvent } from "nostr-tools";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
import { useAccount } from "@/hooks/useAccount";
import { useProfileSearch } from "@/hooks/useProfileSearch";
import { useEmojiSearch } from "@/hooks/useEmojiSearch";
import { useBlossomUpload } from "@/hooks/useBlossomUpload";
import { useSettings } from "@/hooks/useSettings";
import { useRelaySelection } from "@/hooks/useRelaySelection";
import { useEventPublisher } from "@/hooks/useEventPublisher";
import {
  TextEditor,
  type TextEditorHandle,
} from "@/components/editor/TextEditor";
import {
  MarkdownEditor,
  type MarkdownEditorHandle,
} from "@/components/editor/MarkdownEditor";
import type { BlobAttachment, EmojiTag } from "@/components/editor/core/types";
import { RelayLink } from "@/components/nostr/RelayLink";
import { getAuthIcon } from "@/lib/relay-status-utils";
import type { ComposerSchema, ComposerContext } from "@/lib/composer/schema";

// Generic editor handle type
type EditorHandle = TextEditorHandle | MarkdownEditorHandle;

export interface ComposerProps {
  /** Schema defining how to compose this event kind */
  schema: ComposerSchema;
  /** Context for the composition (reply target, group, etc.) */
  context?: ComposerContext;
  /** Called when event is created and ready to sign */
  onBuildEvent: (input: ComposerInput) => Promise<NostrEvent>;
  /** Called after successful publish */
  onPublished?: (event: NostrEvent) => void;
  /** Render published event preview */
  renderPreview?: (event: NostrEvent) => React.ReactNode;
  /** Additional class name */
  className?: string;
  /** Window ID for draft storage */
  windowId?: string;
}

export interface ComposerInput {
  content: string;
  title?: string;
  summary?: string;
  image?: string;
  labels?: string[];
  emojiTags: EmojiTag[];
  blobAttachments: BlobAttachment[];
  addressRefs: Array<{ kind: number; pubkey: string; identifier: string }>;
}

export interface ComposerHandle {
  /** Focus the editor */
  focus: () => void;
  /** Clear the editor */
  clear: () => void;
  /** Get current content */
  getContent: () => string;
  /** Check if editor is empty */
  isEmpty: () => boolean;
}

export const Composer = forwardRef<ComposerHandle, ComposerProps>(
  (
    {
      schema,
      context,
      onBuildEvent,
      onPublished,
      renderPreview,
      className = "",
      windowId,
    },
    ref,
  ) => {
    const { pubkey, canSign } = useAccount();
    const { searchProfiles } = useProfileSearch();
    const { searchEmojis } = useEmojiSearch();
    const { settings, updateSetting } = useSettings();

    // Editor ref
    const editorRef = useRef<EditorHandle>(null);

    // Metadata state
    const [title, setTitle] = useState("");
    const [summary, setSummary] = useState("");
    const [image, setImage] = useState("");
    const [labels, setLabels] = useState<string[]>([]);

    // UI state
    const [isEditorEmpty, setIsEditorEmpty] = useState(true);
    const [showPublishedPreview, setShowPublishedPreview] = useState(false);
    const [newRelayInput, setNewRelayInput] = useState("");

    // Relay selection hook
    const relaySelection = useRelaySelection({
      strategy: schema.relays,
      contextRelay: context?.groupRelay,
    });

    // Event publisher hook
    const publisher = useEventPublisher();

    // Expose handle methods
    useImperativeHandle(
      ref,
      () => ({
        focus: () => editorRef.current?.focus(),
        clear: () => {
          editorRef.current?.clear();
          setTitle("");
          setSummary("");
          setImage("");
          setLabels([]);
        },
        getContent: () => editorRef.current?.getContent() || "",
        isEmpty: () => editorRef.current?.isEmpty() ?? true,
      }),
      [],
    );

    // Draft storage key
    const getDraftKey = useCallback(() => {
      if (!schema.drafts.supported || !schema.drafts.storageKey) return null;
      return schema.drafts.storageKey({
        ...context,
        windowId,
      });
    }, [schema.drafts, context, windowId]);

    // Track if draft has been loaded
    const draftLoadedRef = useRef(false);

    // Load draft from localStorage on mount
    useEffect(() => {
      if (!pubkey || draftLoadedRef.current) return;

      const draftKey = getDraftKey();
      if (!draftKey) {
        draftLoadedRef.current = true;
        return;
      }

      const savedDraft = localStorage.getItem(draftKey);
      if (savedDraft) {
        try {
          const draft = JSON.parse(savedDraft);
          draftLoadedRef.current = true;

          // Restore editor content with retry logic
          if (draft.editorState) {
            const trySetContent = (attempts = 0) => {
              if (editorRef.current && "setContent" in editorRef.current) {
                (editorRef.current as TextEditorHandle).setContent(
                  draft.editorState,
                );
              } else if (attempts < 10) {
                setTimeout(() => trySetContent(attempts + 1), 50);
              }
            };
            setTimeout(() => trySetContent(), 50);
          }

          // Restore metadata
          if (draft.title) setTitle(draft.title);
          if (draft.summary) setSummary(draft.summary);
          if (draft.image) setImage(draft.image);
          if (draft.labels) setLabels(draft.labels);

          // Restore relays
          if (draft.selectedRelays && draft.addedRelays) {
            relaySelection.restoreRelayStates(
              draft.selectedRelays,
              draft.addedRelays,
            );
          }
        } catch (err) {
          console.error("Failed to load draft:", err);
        }
      } else {
        draftLoadedRef.current = true;
      }
    }, [pubkey, getDraftKey, relaySelection]);

    // Save draft to localStorage
    const saveDraft = useCallback(() => {
      if (!pubkey || !editorRef.current) return;

      const draftKey = getDraftKey();
      if (!draftKey) return;

      const content = editorRef.current.getContent();

      if (!content.trim() && !title && !summary) {
        localStorage.removeItem(draftKey);
        return;
      }

      const draft = {
        editorState:
          "getJSON" in editorRef.current
            ? (editorRef.current as TextEditorHandle).getJSON()
            : undefined,
        title,
        summary,
        image,
        labels,
        selectedRelays: Array.from(relaySelection.selectedRelays),
        addedRelays: relaySelection.getAddedRelays(),
        timestamp: Date.now(),
      };

      try {
        localStorage.setItem(draftKey, JSON.stringify(draft));
      } catch (err) {
        console.error("Failed to save draft:", err);
      }
    }, [pubkey, getDraftKey, title, summary, image, labels, relaySelection]);

    // Debounced draft save
    const draftSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
      null,
    );

    const handleEditorChange = useCallback(() => {
      if (editorRef.current) {
        setIsEditorEmpty(editorRef.current.isEmpty());
      }

      if (draftSaveTimeoutRef.current) {
        clearTimeout(draftSaveTimeoutRef.current);
      }
      draftSaveTimeoutRef.current = setTimeout(() => {
        saveDraft();
      }, 500);
    }, [saveDraft]);

    useEffect(() => {
      return () => {
        if (draftSaveTimeoutRef.current) {
          clearTimeout(draftSaveTimeoutRef.current);
        }
      };
    }, []);

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

    // Handle publish
    const handlePublish = useCallback(
      async (
        content: string,
        emojiTags: EmojiTag[],
        blobAttachments: BlobAttachment[],
        addressRefs: Array<{
          kind: number;
          pubkey: string;
          identifier: string;
        }>,
      ) => {
        if (!canSign || !pubkey) {
          toast.error("Please log in to publish");
          return;
        }

        if (!content.trim() && schema.metadata.title?.required && !title) {
          toast.error("Please fill in required fields");
          return;
        }

        const selectedUrls = Array.from(relaySelection.selectedRelays);
        if (selectedUrls.length === 0) {
          toast.error("Please select at least one relay");
          return;
        }

        try {
          // Build the event using the provided callback
          const input: ComposerInput = {
            content: content.trim(),
            title: title || undefined,
            summary: summary || undefined,
            image: image || undefined,
            labels,
            emojiTags,
            blobAttachments,
            addressRefs,
          };

          const event = await onBuildEvent(input);

          // Publish with status tracking
          const result = await publisher.publishEvent(
            event,
            selectedUrls,
            relaySelection.updateRelayStatus,
          );

          if (result.success) {
            // Clear draft
            const draftKey = getDraftKey();
            if (draftKey) {
              localStorage.removeItem(draftKey);
            }

            // Clear editor and metadata
            editorRef.current?.clear();
            setTitle("");
            setSummary("");
            setImage("");
            setLabels([]);

            // Show preview
            setShowPublishedPreview(true);

            // Notify parent
            onPublished?.(event);
          }
        } catch (error) {
          console.error("Failed to create/publish event:", error);
          toast.error(
            error instanceof Error ? error.message : "Failed to publish",
          );
        }
      },
      [
        canSign,
        pubkey,
        schema.metadata.title?.required,
        title,
        summary,
        image,
        labels,
        relaySelection,
        onBuildEvent,
        publisher,
        getDraftKey,
        onPublished,
      ],
    );

    // Handle file paste
    const handleFilePaste = useCallback(
      (files: File[]) => {
        if (files.length > 0) {
          openUpload();
        }
      },
      [openUpload],
    );

    // Reset to compose another
    const handleReset = useCallback(() => {
      setShowPublishedPreview(false);
      publisher.clearLastEvent();
      relaySelection.resetRelayStates();
      editorRef.current?.clear();
      setTitle("");
      setSummary("");
      setImage("");
      setLabels([]);
      editorRef.current?.focus();
    }, [publisher, relaySelection]);

    // Discard draft
    const handleDiscard = useCallback(() => {
      editorRef.current?.clear();
      setTitle("");
      setSummary("");
      setImage("");
      setLabels([]);
      const draftKey = getDraftKey();
      if (draftKey) {
        localStorage.removeItem(draftKey);
      }
      editorRef.current?.focus();
    }, [getDraftKey]);

    // Add relay
    const handleAddRelay = useCallback(() => {
      const success = relaySelection.addRelay(newRelayInput);
      if (success) {
        setNewRelayInput("");
      }
    }, [newRelayInput, relaySelection]);

    // Handle relay retry
    const handleRetryRelay = useCallback(
      (relayUrl: string) => {
        publisher.retryRelay(relayUrl, relaySelection.updateRelayStatus);
      },
      [publisher, relaySelection],
    );

    // Show login prompt if not logged in
    if (!canSign) {
      return (
        <div className="h-full flex items-center justify-center p-8">
          <div className="max-w-md text-center space-y-4">
            <p className="text-muted-foreground">
              You need to be logged in to {schema.name.toLowerCase()}.
            </p>
            <p className="text-sm text-muted-foreground">
              Click the user icon in the top right to log in.
            </p>
          </div>
        </div>
      );
    }

    // Determine which editor to render
    const renderEditor = () => {
      const editorProps = {
        placeholder:
          schema.content.placeholder ||
          `Write your ${schema.name.toLowerCase()}...`,
        onSubmit: handlePublish,
        onChange: handleEditorChange,
        searchProfiles,
        searchEmojis,
        onFilePaste: handleFilePaste,
        autoFocus: true,
        minHeight: schema.content.editor === "markdown" ? 200 : 150,
        maxHeight: schema.content.editor === "markdown" ? 600 : 400,
      };

      if (schema.content.editor === "markdown") {
        return (
          <MarkdownEditor
            ref={editorRef as React.Ref<MarkdownEditorHandle>}
            {...editorProps}
          />
        );
      }

      return (
        <TextEditor
          ref={editorRef as React.Ref<TextEditorHandle>}
          {...editorProps}
        />
      );
    };

    // Render title field if configured
    const renderTitleField = () => {
      if (!schema.metadata.title) return null;

      return (
        <Input
          type="text"
          placeholder={
            schema.metadata.title.placeholder ||
            `${schema.metadata.title.label}...`
          }
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={publisher.isPublishing || showPublishedPreview}
          className="text-lg font-medium"
        />
      );
    };

    // Check if form is empty
    const isFormEmpty = isEditorEmpty && !title && !summary && !image;

    return (
      <div className={`h-full overflow-y-auto ${className}`}>
        <div className="max-w-2xl mx-auto space-y-4 p-4">
          {!showPublishedPreview ? (
            <>
              {/* Title field */}
              {renderTitleField()}

              {/* Editor */}
              <div>{renderEditor()}</div>

              {/* Action buttons */}
              <div className="flex items-center gap-2">
                {/* Upload button */}
                {schema.media.allowed && (
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => openUpload()}
                    disabled={publisher.isPublishing}
                    title="Upload image/video"
                  >
                    <Paperclip className="h-4 w-4" />
                  </Button>
                )}

                {/* Settings dropdown */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      size="icon"
                      disabled={publisher.isPublishing}
                      title="Post settings"
                    >
                      <Settings className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuCheckboxItem
                      checked={settings?.post?.includeClientTag ?? true}
                      onCheckedChange={(checked) =>
                        updateSetting("post", "includeClientTag", checked)
                      }
                    >
                      Include client tag
                    </DropdownMenuCheckboxItem>
                  </DropdownMenuContent>
                </DropdownMenu>

                {/* Spacer */}
                <div className="flex-1" />

                {/* Discard button */}
                <Button
                  variant="outline"
                  onClick={handleDiscard}
                  disabled={publisher.isPublishing || isFormEmpty}
                >
                  Discard
                </Button>

                {/* Publish button */}
                <Button
                  onClick={() => editorRef.current?.submit()}
                  disabled={
                    publisher.isPublishing ||
                    relaySelection.selectedRelays.size === 0 ||
                    isFormEmpty
                  }
                  className="gap-2 w-32"
                >
                  {publisher.isPublishing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      <Send className="h-4 w-4" />
                      Publish
                    </>
                  )}
                </Button>
              </div>
            </>
          ) : (
            <>
              {/* Published event preview */}
              {publisher.lastPublishedEvent &&
                renderPreview?.(publisher.lastPublishedEvent)}

              {/* Reset button */}
              <div className="flex justify-center">
                <Button
                  variant="outline"
                  onClick={handleReset}
                  className="gap-2"
                >
                  <RotateCcw className="h-4 w-4" />
                  Compose Another {schema.name}
                </Button>
              </div>
            </>
          )}

          {/* Relay selection */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                Relays ({relaySelection.selectedRelays.size} selected)
              </span>
            </div>

            <div className="space-y-1 max-h-64 overflow-y-auto">
              {relaySelection.relayStates.map((relay) => {
                const isConnected = relaySelection.getConnectionStatus(
                  relay.url,
                );
                const relayState = relaySelection.getRelayAuthState(relay.url);
                const authIcon = getAuthIcon(relayState);

                return (
                  <div
                    key={relay.url}
                    className="flex items-center justify-between gap-3 py-1"
                  >
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <Checkbox
                        id={relay.url}
                        checked={relaySelection.selectedRelays.has(relay.url)}
                        onCheckedChange={() =>
                          relaySelection.toggleRelay(relay.url)
                        }
                        disabled={
                          publisher.isPublishing || showPublishedPreview
                        }
                      />
                      {isConnected ? (
                        <Server className="h-3 w-3 text-green-500 flex-shrink-0" />
                      ) : (
                        <ServerOff className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                      )}
                      <div className="flex-shrink-0" title={authIcon.label}>
                        {authIcon.icon}
                      </div>
                      <label
                        htmlFor={relay.url}
                        className="cursor-pointer truncate flex-1"
                        onClick={(e) => e.preventDefault()}
                      >
                        <RelayLink
                          url={relay.url}
                          write={true}
                          showInboxOutbox={false}
                          className="text-sm"
                        />
                      </label>
                    </div>

                    <div className="flex-shrink-0 w-6 flex items-center justify-center">
                      {relay.status === "pending" && (
                        <Circle className="h-4 w-4 text-muted-foreground" />
                      )}
                      {relay.status === "publishing" && (
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      )}
                      {relay.status === "success" && (
                        <Check className="h-4 w-4 text-green-500" />
                      )}
                      {relay.status === "error" && (
                        <button
                          onClick={() => handleRetryRelay(relay.url)}
                          disabled={publisher.isPublishing}
                          className="p-0.5 rounded hover:bg-red-500/10 transition-colors"
                          title={`${relay.error || "Failed to publish"}. Click to retry.`}
                        >
                          <X className="h-4 w-4 text-red-500" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Add relay input */}
            {!showPublishedPreview && (
              <div className="flex items-center gap-2 pt-2">
                <Input
                  type="text"
                  placeholder="relay.example.com"
                  value={newRelayInput}
                  onChange={(e) => setNewRelayInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (
                      e.key === "Enter" &&
                      relaySelection.isValidRelayInput(newRelayInput)
                    ) {
                      handleAddRelay();
                    }
                  }}
                  disabled={publisher.isPublishing}
                  className="flex-1 text-sm"
                />
                <Button
                  size="icon"
                  variant="outline"
                  onClick={handleAddRelay}
                  disabled={
                    publisher.isPublishing ||
                    !relaySelection.isValidRelayInput(newRelayInput)
                  }
                  title="Add relay"
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>

          {/* Upload dialog */}
          {uploadDialog}
        </div>
      </div>
    );
  },
);

Composer.displayName = "Composer";
