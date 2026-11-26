import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import {
  Paperclip,
  Send,
  Loader2,
  RotateCcw,
  Settings,
  Plus,
} from "lucide-react";
import { toast } from "sonner";
import type { NostrEvent } from "nostr-tools";
import { Button } from "./ui/button";
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
import { useSettings } from "@/hooks/useSettings";
import {
  RichEditor,
  type RichEditorHandle,
  type BlobAttachment,
  type EmojiTag,
} from "./editor/RichEditor";
import { Kind1Renderer } from "./nostr/kinds";
import publishService from "@/services/publish-service";
import { buildPostTemplate } from "@/lib/post-template";
import {
  deriveRelayRows,
  effectiveSelection,
  hasActiveOverrides,
  tryNormalizeRelay,
} from "@/lib/post-relays";
import {
  parsePostDraft,
  postDraftKey,
  serializePostDraft,
} from "@/lib/post-draft";
import { useGrimoire } from "@/core/state";
import { FALLBACK_RELAYS } from "@/services/loaders";
import { PostRelayRow, type RelayPublishState } from "./post/PostRelayList";

interface PostViewerProps {
  windowId?: string;
}

/** Matches "relay.com", "wss://relay.com", "relay.com:7777/path". */
const RELAY_INPUT_PATTERN =
  /^(wss?:\/\/)?[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}(:[0-9]{1,5})?(\/.*)?$/;

function isValidRelayInput(input: string): boolean {
  const trimmed = input.trim();
  return trimmed !== "" && RELAY_INPUT_PATTERN.test(trimmed);
}

const DRAFT_SAVE_DEBOUNCE_MS = 500;

export function PostViewer({ windowId }: PostViewerProps = {}) {
  const { pubkey, canSign, signer } = useAccount();
  const { searchProfiles } = useProfileSearch();
  const { searchEmojis } = useEmojiSearch();
  const { state } = useGrimoire();
  const { settings, updateSetting } = useSettings();

  const editorRef = useRef<RichEditorHandle>(null);

  // Publish state
  const [isPublishing, setIsPublishing] = useState(false);
  const [publishStatus, setPublishStatus] = useState<
    Record<string, RelayPublishState>
  >({});
  const [isEditorEmpty, setIsEditorEmpty] = useState(true);
  const [lastPublishedEvent, setLastPublishedEvent] =
    useState<NostrEvent | null>(null);
  const [showPublishedPreview, setShowPublishedPreview] = useState(false);
  const [newRelayInput, setNewRelayInput] = useState("");

  // What the user decided. Everything else is derived (src/lib/post-relays.ts).
  const [addedRelays, setAddedRelays] = useState<string[]>([]);
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [excludedRecipients, setExcludedRecipients] = useState<string[]>([]);

  // The account's NIP-65 write relays.
  const ownWriteRelays = useMemo(
    () =>
      (state.activeAccount?.relays ?? [])
        .filter((r) => r.write)
        .map((r) => r.url),
    [state.activeAccount?.relays],
  );

  const rows = useMemo(
    () =>
      deriveRelayRows({
        ownWrite: ownWriteRelays,
        fallback: FALLBACK_RELAYS,
        manual: addedRelays,
      }),
    [ownWriteRelays, addedRelays],
  );
  const selectedRelays = useMemo(
    () => effectiveSelection(rows, overrides),
    [rows, overrides],
  );

  // ---------------------------------------------------------------------------
  // Drafts
  // ---------------------------------------------------------------------------

  // The latest decisions, for a save that runs after a debounce.
  const decisionsRef = useRef({ addedRelays, overrides, excludedRecipients });
  useEffect(() => {
    decisionsRef.current = { addedRelays, overrides, excludedRecipients };
  }, [addedRelays, overrides, excludedRecipients]);

  // Which account's draft is loaded, and whether its content is still being
  // pushed into the editor. Saving while that is pending would read an empty
  // editor and delete the very draft being restored.
  const loadedForRef = useRef<string | null>(null);
  const restoringRef = useRef(false);
  const draftSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const saveDraft = useCallback(() => {
    if (!pubkey || !editorRef.current || restoringRef.current) return;
    if (loadedForRef.current !== pubkey) return;
    const key = postDraftKey(pubkey, windowId);
    const content = editorRef.current.getContent();
    if (!content.trim()) {
      localStorage.removeItem(key);
      return;
    }
    try {
      localStorage.setItem(
        key,
        serializePostDraft({
          editorState: editorRef.current.getJSON(),
          ...decisionsRef.current,
        }),
      );
    } catch (err) {
      console.error("Failed to save draft:", err);
    }
  }, [pubkey, windowId]);

  const scheduleDraftSave = useCallback(() => {
    if (draftSaveTimeoutRef.current) clearTimeout(draftSaveTimeoutRef.current);
    draftSaveTimeoutRef.current = setTimeout(saveDraft, DRAFT_SAVE_DEBOUNCE_MS);
  }, [saveDraft]);

  // Load the account's draft — on mount, and again when the account changes,
  // so one identity never sees (or saves over) another's draft.
  useEffect(() => {
    if (!pubkey || loadedForRef.current === pubkey) return;
    const switching = loadedForRef.current !== null;
    loadedForRef.current = pubkey;
    if (draftSaveTimeoutRef.current) clearTimeout(draftSaveTimeoutRef.current);

    let draft = null;
    try {
      draft = parsePostDraft(
        localStorage.getItem(postDraftKey(pubkey, windowId)),
      );
    } catch (err) {
      console.error("Failed to load draft:", err);
    }

    setAddedRelays(draft?.addedRelays ?? []);
    setOverrides(draft?.overrides ?? {});
    setExcludedRecipients(draft?.excludedRecipients ?? []);

    if (draft?.editorState) {
      restoringRef.current = true;
      const editorState = draft.editorState;
      // The editor mounts asynchronously; retry for up to 500ms.
      const trySetContent = (attempts = 0) => {
        if (loadedForRef.current !== pubkey) return;
        if (editorRef.current) {
          editorRef.current.setContent(editorState as never);
          restoringRef.current = false;
        } else if (attempts < 10) {
          setTimeout(() => trySetContent(attempts + 1), 50);
        } else {
          restoringRef.current = false;
        }
      };
      setTimeout(() => trySetContent(), 50);
    } else if (switching) {
      editorRef.current?.clear();
    }
  }, [pubkey, windowId]);

  // A relay toggle, an added relay or a recipient choice is part of the draft
  // too, not only keystrokes.
  const decisionsKey = JSON.stringify([
    addedRelays,
    overrides,
    excludedRecipients,
  ]);
  const lastDecisionsKeyRef = useRef(decisionsKey);
  useEffect(() => {
    if (lastDecisionsKeyRef.current === decisionsKey) return;
    lastDecisionsKeyRef.current = decisionsKey;
    scheduleDraftSave();
  }, [decisionsKey, scheduleDraftSave]);

  const handleEditorChange = useCallback(() => {
    if (editorRef.current) setIsEditorEmpty(editorRef.current.isEmpty());
    scheduleDraftSave();
  }, [scheduleDraftSave]);

  useEffect(() => {
    return () => {
      if (draftSaveTimeoutRef.current)
        clearTimeout(draftSaveTimeoutRef.current);
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Relays
  // ---------------------------------------------------------------------------

  const setRelaySelected = useCallback((url: string, selected: boolean) => {
    setOverrides((prev) => ({ ...prev, [url]: selected }));
  }, []);

  const resetRelaySelection = useCallback(() => setOverrides({}), []);

  const setStatus = useCallback(
    (url: string, next: RelayPublishState) =>
      setPublishStatus((prev) => ({ ...prev, [url]: next })),
    [],
  );

  const handleAddRelay = useCallback(() => {
    const trimmed = newRelayInput.trim();
    if (!trimmed || !isValidRelayInput(trimmed)) return;
    const normalizedUrl = tryNormalizeRelay(trimmed);
    if (!normalizedUrl) {
      toast.error("Invalid relay URL");
      return;
    }
    if (rows.some((r) => r.url === normalizedUrl)) {
      toast.error("Relay already in list");
      return;
    }
    setAddedRelays((prev) => [...prev, normalizedUrl]);
    setOverrides((prev) => ({ ...prev, [normalizedUrl]: true }));
    setNewRelayInput("");
  }, [newRelayInput, rows]);

  // ---------------------------------------------------------------------------
  // Publishing
  // ---------------------------------------------------------------------------

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

  const retryRelay = useCallback(
    async (relayUrl: string) => {
      if (!lastPublishedEvent) {
        toast.error("No event to retry");
        return;
      }
      setStatus(relayUrl, { status: "publishing" });
      const result = await publishService.retryRelays(lastPublishedEvent, [
        relayUrl,
      ]);
      const host = relayUrl.replace(/^wss?:\/\//, "");
      if (result.ok) {
        setStatus(relayUrl, { status: "success" });
        toast.success(`Published to ${host}`);
      } else {
        setStatus(relayUrl, {
          status: "error",
          error: result.failed[0]?.error || "Unknown error",
        });
        toast.error(`Failed to publish to ${host}`);
      }
    },
    [lastPublishedEvent, setStatus],
  );

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
      const selected = selectedRelays;
      if (selected.length === 0) {
        toast.error("Please select at least one relay");
        return;
      }

      setIsPublishing(true);

      let event: NostrEvent;
      try {
        // One builder for preview and publish (src/lib/post-template.ts).
        const built = await buildPostTemplate({
          content,
          emojiTags,
          blobAttachments,
          addressRefs,
          includeClientTag: !!settings?.post?.includeClientTag,
          excludedRecipients: new Set(excludedRecipients),
          selfPubkey: pubkey,
        });
        event = await built.factory.sign(signer);
      } catch (error) {
        // Signing failed - user might have rejected it
        console.error("Failed to sign event:", error);
        toast.error(
          error instanceof Error ? error.message : "Failed to sign note",
        );
        setIsPublishing(false);
        return; // Don't destroy the post, let user try again
      }

      setLastPublishedEvent(event);
      setPublishStatus(
        Object.fromEntries(
          selected.map((url) => [url, { status: "pending" as const }]),
        ),
      );

      const { updates$, result } = publishService.publishWithUpdates(
        event,
        selected,
      );
      const subscription = updates$.subscribe((update) => {
        setStatus(update.relay, { status: update.status, error: update.error });
      });

      try {
        const publishResult = await result;
        subscription.unsubscribe();
        const successCount = publishResult.successful.length;

        if (publishResult.ok) {
          localStorage.removeItem(postDraftKey(pubkey, windowId));
          editorRef.current?.clear();
          setShowPublishedPreview(true);
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
          toast.error(
            "Failed to publish to any relay. Please check your relay connections and try again.",
          );
        }
      } catch (error) {
        subscription.unsubscribe();
        console.error("Failed to publish:", error);
        const message =
          error instanceof Error ? error.message : "Failed to publish note";
        toast.error(message);
        setPublishStatus(
          Object.fromEntries(
            selected.map((url) => [
              url,
              {
                status: "error" as const,
                error: error instanceof Error ? error.message : "Unknown error",
              },
            ]),
          ),
        );
      } finally {
        setIsPublishing(false);
      }
    },
    [
      canSign,
      signer,
      pubkey,
      selectedRelays,
      settings,
      windowId,
      excludedRecipients,
      setStatus,
    ],
  );

  const handleFilePaste = useCallback(
    (files: File[]) => {
      if (files.length > 0) openUpload();
    },
    [openUpload],
  );

  // Compose another post: a fresh note, the same relays. Added relays stay —
  // the user put them there — while per-note choices start over.
  const handleReset = useCallback(() => {
    setShowPublishedPreview(false);
    setLastPublishedEvent(null);
    setPublishStatus({});
    setOverrides({});
    setExcludedRecipients([]);
    editorRef.current?.clear();
    editorRef.current?.focus();
  }, []);

  const handleDiscard = useCallback(() => {
    editorRef.current?.clear();
    setExcludedRecipients([]);
    if (pubkey) localStorage.removeItem(postDraftKey(pubkey, windowId));
    editorRef.current?.focus();
  }, [pubkey, windowId]);

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

  const rowsLocked = isPublishing || showPublishedPreview;

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto space-y-4 p-4">
        {!showPublishedPreview ? (
          <>
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
                    checked={settings?.post?.includeClientTag ?? true}
                    onCheckedChange={(checked) =>
                      updateSetting("post", "includeClientTag", checked)
                    }
                  >
                    Include client tag
                  </DropdownMenuCheckboxItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <div className="flex-1" />

              <Button
                variant="outline"
                onClick={handleDiscard}
                disabled={isPublishing || isEditorEmpty}
              >
                Discard
              </Button>

              <Button
                onClick={() => editorRef.current?.submit()}
                disabled={
                  isPublishing || selectedRelays.length === 0 || isEditorEmpty
                }
                className="gap-2 w-32"
              >
                {isPublishing ? (
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
            {lastPublishedEvent && (
              <div className="rounded-lg border border-border bg-muted/10 p-4">
                <Kind1Renderer event={lastPublishedEvent} depth={0} />
              </div>
            )}
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
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm text-muted-foreground">
              Relays ({selectedRelays.length} selected)
            </span>
            {!rowsLocked && hasActiveOverrides(rows, overrides) && (
              <button
                type="button"
                onClick={resetRelaySelection}
                className="text-xs text-muted-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-sm"
              >
                Reset selection
              </button>
            )}
          </div>

          <div className="space-y-1 max-h-64 overflow-y-auto">
            {rows.map((row) => (
              <PostRelayRow
                key={row.url}
                row={row}
                overrides={overrides}
                publish={publishStatus[row.url]}
                disabled={rowsLocked}
                retryDisabled={isPublishing}
                onToggle={setRelaySelected}
                onRetry={retryRelay}
              />
            ))}
          </div>

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
                aria-label="Add relay"
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

        {uploadDialog}
      </div>
    </div>
  );
}
