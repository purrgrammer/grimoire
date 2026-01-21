import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import {
  Paperclip,
  Send,
  Loader2,
  Check,
  X,
  RotateCcw,
  Settings,
  Server,
  ServerOff,
  Plus,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { Input } from "./ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuCheckboxItem,
} from "./ui/dropdown-menu";
import { useAccount } from "@/hooks/useAccount";
import { useProfileSearch } from "@/hooks/useProfileSearch";
import { useEmojiSearch } from "@/hooks/useEmojiSearch";
import { useBlossomUpload } from "@/hooks/useBlossomUpload";
import { useRelayState } from "@/hooks/useRelayState";
import { RichEditor, type RichEditorHandle } from "./editor/RichEditor";
import type { BlobAttachment, EmojiTag } from "./editor/MentionEditor";
import { RelayLink } from "./nostr/RelayLink";
import { Kind1Renderer } from "./nostr/kinds";
import pool from "@/services/relay-pool";
import eventStore from "@/services/event-store";
import { EventFactory } from "applesauce-core/event-factory";
import { NoteBlueprint } from "applesauce-common/blueprints";
import { useGrimoire } from "@/core/state";
import { AGGREGATOR_RELAYS } from "@/services/loaders";
import { normalizeRelayURL } from "@/lib/relay-url";
import { use$ } from "applesauce-react/hooks";
import { getAuthIcon } from "@/lib/relay-status-utils";
import { GRIMOIRE_CLIENT_TAG } from "@/constants/app";

// Per-relay publish status
type RelayStatus = "pending" | "publishing" | "success" | "error";

interface RelayPublishState {
  url: string;
  status: RelayStatus;
  error?: string;
}

// Storage keys
const DRAFT_STORAGE_KEY = "grimoire-post-draft";
const SETTINGS_STORAGE_KEY = "grimoire-post-settings";

interface PostSettings {
  includeClientTag: boolean;
}

const DEFAULT_SETTINGS: PostSettings = {
  includeClientTag: true,
};

interface PostViewerProps {
  windowId?: string;
}

export function PostViewer({ windowId }: PostViewerProps = {}) {
  const { pubkey, canSign, signer } = useAccount();
  const { searchProfiles } = useProfileSearch();
  const { searchEmojis } = useEmojiSearch();
  const { state } = useGrimoire();
  const { getRelay } = useRelayState();

  // Editor ref for programmatic control
  const editorRef = useRef<RichEditorHandle>(null);

  // Publish state
  const [isPublishing, setIsPublishing] = useState(false);
  const [relayStates, setRelayStates] = useState<RelayPublishState[]>([]);
  const [selectedRelays, setSelectedRelays] = useState<Set<string>>(new Set());
  const [isEditorEmpty, setIsEditorEmpty] = useState(true);
  const [lastPublishedEvent, setLastPublishedEvent] = useState<any>(null);
  const [showPublishedPreview, setShowPublishedPreview] = useState(false);
  const [newRelayInput, setNewRelayInput] = useState("");

  // Load settings from localStorage
  const [settings, setSettings] = useState<PostSettings>(() => {
    try {
      const stored = localStorage.getItem(SETTINGS_STORAGE_KEY);
      return stored ? JSON.parse(stored) : DEFAULT_SETTINGS;
    } catch {
      return DEFAULT_SETTINGS;
    }
  });

  // Get relay pool state for connection status
  const relayPoolMap = use$(pool.relays$);

  // Persist settings to localStorage when they change
  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    } catch (err) {
      console.error("Failed to save post settings:", err);
    }
  }, [settings]);

  // Update a single setting
  const updateSetting = useCallback(
    <K extends keyof PostSettings>(key: K, value: PostSettings[K]) => {
      setSettings((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  // Get active account's write relays from Grimoire state, fallback to aggregators
  const writeRelays = useMemo(() => {
    if (!state.activeAccount?.relays) return AGGREGATOR_RELAYS;
    const userWriteRelays = state.activeAccount.relays
      .filter((r) => r.write)
      .map((r) => r.url);
    return userWriteRelays.length > 0 ? userWriteRelays : AGGREGATOR_RELAYS;
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

  // Load draft from localStorage on mount
  useEffect(() => {
    if (!pubkey) return;

    const draftKey = windowId
      ? `${DRAFT_STORAGE_KEY}-${pubkey}-${windowId}`
      : `${DRAFT_STORAGE_KEY}-${pubkey}`;
    const savedDraft = localStorage.getItem(draftKey);

    if (savedDraft) {
      try {
        const draft = JSON.parse(savedDraft);

        // Restore editor content
        if (editorRef.current && draft.editorState) {
          // Use setTimeout to ensure editor is fully mounted
          setTimeout(() => {
            if (editorRef.current && draft.editorState) {
              editorRef.current.setContent(draft.editorState);
            }
          }, 100);
        }

        // Restore selected relays
        if (draft.selectedRelays && Array.isArray(draft.selectedRelays)) {
          setSelectedRelays(new Set(draft.selectedRelays));
        }

        // Restore added relays (relays not in writeRelays)
        if (draft.addedRelays && Array.isArray(draft.addedRelays)) {
          const currentRelayUrls = new Set(relayStates.map((r) => r.url));
          const newRelays = draft.addedRelays
            .filter((url: string) => !currentRelayUrls.has(url))
            .map((url: string) => ({
              url,
              status: "pending" as RelayStatus,
            }));
          if (newRelays.length > 0) {
            setRelayStates((prev) => [...prev, ...newRelays]);
          }
        }
      } catch (err) {
        console.error("Failed to load draft:", err);
      }
    }
  }, [pubkey, windowId, relayStates]);

  // Save draft to localStorage on content change
  const saveDraft = useCallback(() => {
    if (!pubkey || !editorRef.current) return;

    const content = editorRef.current.getContent();
    const editorState = editorRef.current.getJSON();

    const draftKey = windowId
      ? `${DRAFT_STORAGE_KEY}-${pubkey}-${windowId}`
      : `${DRAFT_STORAGE_KEY}-${pubkey}`;

    if (!content.trim()) {
      // Clear draft if empty
      localStorage.removeItem(draftKey);
      return;
    }

    // Identify added relays (those not in writeRelays)
    const addedRelays = relayStates
      .filter((r) => !writeRelays.includes(r.url))
      .map((r) => r.url);

    const draft = {
      editorState, // Full editor JSON state (preserves blobs, emojis, formatting)
      selectedRelays: Array.from(selectedRelays), // Selected relay URLs
      addedRelays, // Custom relays added by user
      timestamp: Date.now(),
    };

    try {
      localStorage.setItem(draftKey, JSON.stringify(draft));
    } catch (err) {
      console.error("Failed to save draft:", err);
    }
  }, [pubkey, windowId, selectedRelays, relayStates, writeRelays]);

  // Debounced draft save on editor changes
  const draftSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const handleEditorChange = useCallback(() => {
    // Update empty state immediately
    if (editorRef.current) {
      setIsEditorEmpty(editorRef.current.isEmpty());
    }

    // Debounce draft save (500ms)
    if (draftSaveTimeoutRef.current) {
      clearTimeout(draftSaveTimeoutRef.current);
    }
    draftSaveTimeoutRef.current = setTimeout(() => {
      saveDraft();
    }, 500);
  }, [saveDraft]);

  // Cleanup timeout on unmount
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

  // Retry publishing to a specific relay
  const retryRelay = useCallback(
    async (relayUrl: string) => {
      // Reuse the last published event instead of recreating it
      if (!lastPublishedEvent) {
        toast.error("No event to retry");
        return;
      }

      try {
        // Update status to publishing
        setRelayStates((prev) =>
          prev.map((r) =>
            r.url === relayUrl
              ? { ...r, status: "publishing" as RelayStatus }
              : r,
          ),
        );

        // Republish the same signed event
        await pool.publish([relayUrl], lastPublishedEvent);

        // Update status to success
        setRelayStates((prev) =>
          prev.map((r) =>
            r.url === relayUrl
              ? { ...r, status: "success" as RelayStatus, error: undefined }
              : r,
          ),
        );

        toast.success(`Published to ${relayUrl.replace(/^wss?:\/\//, "")}`);
      } catch (error) {
        console.error(`Failed to retry publish to ${relayUrl}:`, error);
        setRelayStates((prev) =>
          prev.map((r) =>
            r.url === relayUrl
              ? {
                  ...r,
                  status: "error" as RelayStatus,
                  error:
                    error instanceof Error ? error.message : "Unknown error",
                }
              : r,
          ),
        );
        toast.error(
          `Failed to publish to ${relayUrl.replace(/^wss?:\/\//, "")}`,
        );
      }
    },
    [lastPublishedEvent],
  );

  // Publish to selected relays with per-relay status tracking
  const handlePublish = useCallback(
    async (
      content: string,
      emojiTags: EmojiTag[],
      blobAttachments: BlobAttachment[],
      addressRefs: Array<{ kind: number; pubkey: string; identifier: string }>,
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

      // Create and sign event first
      let event;
      try {
        // Create event factory with signer
        const factory = new EventFactory();
        factory.setSigner(signer);

        // Use NoteBlueprint - it auto-extracts hashtags, mentions, and quotes from content!
        const draft = await factory.create(NoteBlueprint, content.trim(), {
          emojis: emojiTags.map((e) => ({
            shortcode: e.shortcode,
            url: e.url,
          })),
        });

        // Add tags that applesauce doesn't handle yet
        const additionalTags: string[][] = [];

        // Add a tags for address references (naddr - not yet supported by applesauce)
        for (const addr of addressRefs) {
          additionalTags.push([
            "a",
            `${addr.kind}:${addr.pubkey}:${addr.identifier}`,
          ]);
        }

        // Add client tag (if enabled)
        if (settings.includeClientTag) {
          additionalTags.push(GRIMOIRE_CLIENT_TAG);
        }

        // Add imeta tags for blob attachments (NIP-92)
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
          additionalTags.push(imetaTag);
        }

        // Merge additional tags with blueprint tags
        draft.tags.push(...additionalTags);

        // Sign the event
        event = await factory.sign(draft);
      } catch (error) {
        // Signing failed - user might have rejected it
        console.error("Failed to sign event:", error);
        toast.error(
          error instanceof Error ? error.message : "Failed to sign note",
        );
        setIsPublishing(false);
        return; // Don't destroy the post, let user try again
      }

      // Signing succeeded, now publish to relays
      try {
        // Store the signed event for potential retries
        setLastPublishedEvent(event);

        // Update relay states - set selected to publishing, keep others as pending
        setRelayStates((prev) =>
          prev.map((r) =>
            selected.includes(r.url)
              ? { ...r, status: "publishing" as RelayStatus }
              : r,
          ),
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
            return { success: true, relayUrl };
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
            return { success: false, relayUrl };
          }
        });

        // Wait for all publishes to complete (settled = all finished, regardless of success/failure)
        const results = await Promise.allSettled(publishPromises);

        // Check how many relays succeeded
        const successCount = results.filter(
          (r) => r.status === "fulfilled" && r.value.success,
        ).length;

        if (successCount > 0) {
          // At least one relay succeeded - add to event store
          eventStore.add(event);

          // Clear draft from localStorage
          if (pubkey) {
            const draftKey = windowId
              ? `${DRAFT_STORAGE_KEY}-${pubkey}-${windowId}`
              : `${DRAFT_STORAGE_KEY}-${pubkey}`;
            localStorage.removeItem(draftKey);
          }

          // Clear editor content
          editorRef.current?.clear();

          // Show published preview
          setShowPublishedPreview(true);

          // Show success toast
          if (successCount === selected.length) {
            toast.success(
              `Published to all ${selected.length} relay${selected.length > 1 ? "s" : ""}`,
            );
          } else {
            toast.warning(
              `Published to ${successCount} of ${selected.length} relays`,
            );
          }
        } else {
          // All relays failed - keep the editor visible with content
          toast.error(
            "Failed to publish to any relay. Please check your relay connections and try again.",
          );
        }
      } catch (error) {
        console.error("Failed to publish:", error);
        toast.error(
          error instanceof Error ? error.message : "Failed to publish note",
        );

        // Reset relay states to pending on publishing error
        setRelayStates((prev) =>
          prev.map((r) => ({
            ...r,
            status: "error" as RelayStatus,
            error: error instanceof Error ? error.message : "Unknown error",
          })),
        );
      } finally {
        setIsPublishing(false);
      }
    },
    [canSign, signer, pubkey, selectedRelays, settings],
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

  // Reset form to compose another post
  const handleReset = useCallback(() => {
    setShowPublishedPreview(false);
    setLastPublishedEvent(null);
    updateRelayStates();
    editorRef.current?.clear();
    editorRef.current?.focus();
  }, [updateRelayStates]);

  // Discard draft and clear editor
  const handleDiscard = useCallback(() => {
    editorRef.current?.clear();
    if (pubkey) {
      const draftKey = windowId
        ? `${DRAFT_STORAGE_KEY}-${pubkey}-${windowId}`
        : `${DRAFT_STORAGE_KEY}-${pubkey}`;
      localStorage.removeItem(draftKey);
    }
    editorRef.current?.focus();
  }, [pubkey, windowId]);

  // Check if input looks like a valid relay URL
  const isValidRelayInput = useCallback((input: string): boolean => {
    const trimmed = input.trim();
    if (!trimmed) return false;

    // Allow relay URLs with or without protocol
    // Must have at least a domain part (e.g., "relay.com" or "wss://relay.com")
    const urlPattern =
      /^(wss?:\/\/)?[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}(:[0-9]{1,5})?(\/.*)?$/;

    return urlPattern.test(trimmed);
  }, []);

  // Add new relay to the list
  const handleAddRelay = useCallback(() => {
    const trimmed = newRelayInput.trim();
    if (!trimmed || !isValidRelayInput(trimmed)) return;

    try {
      // Normalize the URL (adds wss:// if needed)
      const normalizedUrl = normalizeRelayURL(trimmed);

      // Check if already in list
      const alreadyExists = relayStates.some((r) => r.url === normalizedUrl);
      if (alreadyExists) {
        toast.error("Relay already in list");
        return;
      }

      // Add to relay states
      setRelayStates((prev) => [
        ...prev,
        { url: normalizedUrl, status: "pending" as RelayStatus },
      ]);

      // Select the new relay
      setSelectedRelays((prev) => new Set([...prev, normalizedUrl]));

      // Clear input
      setNewRelayInput("");
    } catch (error) {
      console.error("Failed to add relay:", error);
      toast.error(error instanceof Error ? error.message : "Invalid relay URL");
    }
  }, [newRelayInput, isValidRelayInput, relayStates]);

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
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto space-y-4 p-4">
        {!showPublishedPreview ? (
          <>
            {/* Editor */}
            <div>
              <RichEditor
                ref={editorRef}
                placeholder="What's on your mind?"
                onSubmit={handlePublish}
                onChange={handleEditorChange}
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
              {/* Upload button */}
              <Button
                variant="outline"
                size="icon"
                onClick={() => openUpload()}
                disabled={isPublishing}
                title="Upload image/video"
              >
                <Paperclip className="h-4 w-4" />
              </Button>

              {/* Settings dropdown */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    disabled={isPublishing}
                    title="Post settings"
                  >
                    <Settings className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuCheckboxItem
                    checked={settings.includeClientTag}
                    onCheckedChange={(checked) =>
                      updateSetting("includeClientTag", checked)
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
                disabled={isPublishing || isEditorEmpty}
              >
                Discard
              </Button>

              {/* Publish button */}
              <Button
                onClick={() => editorRef.current?.submit()}
                disabled={
                  isPublishing || selectedRelays.size === 0 || isEditorEmpty
                }
                className="gap-2 w-32"
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
          </>
        ) : (
          <>
            {/* Published event preview */}
            {lastPublishedEvent && (
              <div className="rounded-lg border border-border bg-muted/10 p-4">
                <Kind1Renderer event={lastPublishedEvent} depth={0} />
              </div>
            )}

            {/* Reset button */}
            <div className="flex justify-center">
              <Button variant="outline" onClick={handleReset} className="gap-2">
                <RotateCcw className="h-4 w-4" />
                Compose Another Post
              </Button>
            </div>
          </>
        )}

        {/* Relay selection */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">
              Relays ({selectedRelays.size} selected)
            </span>
          </div>

          <div className="space-y-1 max-h-64 overflow-y-auto">
            {relayStates.map((relay) => {
              // Get relay connection state from pool
              const poolRelay = relayPoolMap?.get(relay.url);
              const isConnected = poolRelay?.connected ?? false;

              // Get relay state for auth status
              const relayState = getRelay(relay.url);
              const authIcon = getAuthIcon(relayState);

              return (
                <div
                  key={relay.url}
                  className="flex items-center justify-between gap-3 py-1"
                >
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <Checkbox
                      id={relay.url}
                      checked={selectedRelays.has(relay.url)}
                      onCheckedChange={() => toggleRelay(relay.url)}
                      disabled={isPublishing || showPublishedPreview}
                    />
                    {/* Connectivity status icon */}
                    {isConnected ? (
                      <Server className="h-3 w-3 text-green-500 flex-shrink-0" />
                    ) : (
                      <ServerOff className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                    )}
                    {/* Auth status icon */}
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

                  {/* Status indicator */}
                  <div className="flex-shrink-0">
                    {relay.status === "publishing" && (
                      <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
                    )}
                    {relay.status === "success" && (
                      <Check className="h-4 w-4 text-green-500" />
                    )}
                    {relay.status === "error" && (
                      <button
                        onClick={() => retryRelay(relay.url)}
                        disabled={isPublishing}
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
                  if (e.key === "Enter" && isValidRelayInput(newRelayInput)) {
                    handleAddRelay();
                  }
                }}
                disabled={isPublishing}
                className="flex-1 text-sm"
              />
              <Button
                size="icon"
                variant="outline"
                onClick={handleAddRelay}
                disabled={isPublishing || !isValidRelayInput(newRelayInput)}
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
}
