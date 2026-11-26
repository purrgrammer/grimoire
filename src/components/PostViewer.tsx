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
import {
  buildPostTemplate,
  getTaggedPubkeys,
  type PostRecipient,
} from "@/lib/post-template";
import {
  deriveRelayRows,
  effectiveSelection,
  hasActiveOverrides,
  summarizeRecipientDelivery,
  tryNormalizeRelay,
  type RecipientInbox,
  type RelayRow,
} from "@/lib/post-relays";
import { useRecipientInboxes } from "@/hooks/useRecipientInboxes";
import type { InboxResolution } from "@/services/relay-selection";
import { PostRecipients } from "./post/PostRecipients";
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
/** How long after a keystroke the tagged people are re-read off the note. */
const RECIPIENT_ANALYSIS_DEBOUNCE_MS = 300;
/**
 * How long Publish waits for inbox lookups still in flight. Lookups start
 * when a mention is typed, so this is normally not waited at all; past it the
 * note goes out with what is known and the summary says who was left out.
 */
const PUBLISH_INBOX_WAIT_MS = 3000;

function resolvedRelays(resolution: InboxResolution | undefined): string[] {
  return resolution?.status === "resolved" ? resolution.relays : [];
}

function personCount(n: number) {
  return `${n} ${n === 1 ? "person" : "people"}`;
}

export function PostViewer({ windowId }: PostViewerProps = {}) {
  const { pubkey, canSign, signer } = useAccount();
  const { searchProfiles } = useProfileSearch();
  const { searchEmojis } = useEmojiSearch();
  const { state } = useGrimoire();
  const { settings, updateSetting } = useSettings();

  const editorRef = useRef<RichEditorHandle>(null);

  // Publish state
  const [isPublishing, setIsPublishing] = useState(false);
  const [publishPhase, setPublishPhase] = useState<
    "idle" | "resolving" | "signing"
  >("idle");
  // The rows a publish went out with. Shown instead of the live rows while
  // publishing and in the published preview, so a lookup that answers after
  // the snapshot cannot add a row the note was never sent to.
  const [frozenRows, setFrozenRows] = useState<RelayRow[] | null>(null);
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

  // Who the note tags, read off the same template Publish signs.
  const [recipients, setRecipients] = useState<PostRecipient[]>([]);
  const excludedSet = useMemo(
    () => new Set(excludedRecipients),
    [excludedRecipients],
  );
  const shownRecipients = useMemo(
    () =>
      recipients.map((r) => ({ ...r, excluded: excludedSet.has(r.pubkey) })),
    [recipients, excludedSet],
  );
  const taggedPubkeys = useMemo(
    () => shownRecipients.filter((r) => !r.excluded).map((r) => r.pubkey),
    [shownRecipients],
  );
  const inboxes = useRecipientInboxes(taggedPubkeys);

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
        recipients: taggedPubkeys.map((pk): RecipientInbox => ({
          pubkey: pk,
          relays: resolvedRelays(inboxes.get(pk)),
        })),
      }),
    [ownWriteRelays, addedRelays, taggedPubkeys, inboxes],
  );
  const displayRows = frozenRows ?? rows;
  const selectedRelays = useMemo(
    () => effectiveSelection(displayRows, overrides),
    [displayRows, overrides],
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

  // Re-read who the note tags. Async (the builder is), so each run carries a
  // generation and a superseded run's answer is dropped.
  const analysisGenRef = useRef(0);
  const analysisTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const analyzeRecipients = useCallback(async () => {
    const editor = editorRef.current;
    if (!editor) return;
    const generation = ++analysisGenRef.current;
    const serialized = editor.getSerializedContent();
    if (!serialized.text.trim()) {
      setRecipients([]);
      return;
    }
    try {
      const built = await buildPostTemplate({
        content: serialized.text,
        emojiTags: serialized.emojiTags,
        blobAttachments: serialized.blobAttachments,
        addressRefs: serialized.addressRefs,
        includeClientTag: false,
        selfPubkey: pubkey,
      });
      if (generation === analysisGenRef.current)
        setRecipients(built.recipients);
    } catch (err) {
      console.warn("[PostViewer] Failed to read recipients:", err);
    }
  }, [pubkey]);

  const handleEditorChange = useCallback(() => {
    if (editorRef.current) setIsEditorEmpty(editorRef.current.isEmpty());
    scheduleDraftSave();
    if (analysisTimeoutRef.current) clearTimeout(analysisTimeoutRef.current);
    analysisTimeoutRef.current = setTimeout(
      analyzeRecipients,
      RECIPIENT_ANALYSIS_DEBOUNCE_MS,
    );
  }, [scheduleDraftSave, analyzeRecipients]);

  useEffect(() => {
    const analysisGen = analysisGenRef;
    return () => {
      if (draftSaveTimeoutRef.current)
        clearTimeout(draftSaveTimeoutRef.current);
      if (analysisTimeoutRef.current) clearTimeout(analysisTimeoutRef.current);
      analysisGen.current++;
    };
  }, []);

  const excludeRecipient = useCallback((pk: string) => {
    setExcludedRecipients((prev) => (prev.includes(pk) ? prev : [...prev, pk]));
  }, []);
  const includeRecipient = useCallback((pk: string) => {
    setExcludedRecipients((prev) => prev.filter((p) => p !== pk));
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
    if (displayRows.some((r) => r.url === normalizedUrl)) {
      toast.error("Relay already in list");
      return;
    }
    setAddedRelays((prev) => [...prev, normalizedUrl]);
    setOverrides((prev) => ({ ...prev, [normalizedUrl]: true }));
    setNewRelayInput("");
  }, [newRelayInput, displayRows]);

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

      setIsPublishing(true);
      setPublishPhase("resolving");

      // 1. The note, exactly as it will be signed.
      let built: Awaited<ReturnType<typeof buildPostTemplate>>;
      try {
        built = await buildPostTemplate({
          content,
          emojiTags,
          blobAttachments,
          addressRefs,
          includeClientTag: !!settings?.post?.includeClientTag,
          excludedRecipients: new Set(excludedRecipients),
          selfPubkey: pubkey,
        });
      } catch (error) {
        console.error("Failed to build note:", error);
        toast.error(
          error instanceof Error ? error.message : "Failed to build note",
        );
        setIsPublishing(false);
        setPublishPhase("idle");
        return;
      }

      // 2. Its tagged people are its p tags. Wait, bounded, for their inboxes.
      const tagged = getTaggedPubkeys(built.template).filter(
        (pk) => pk !== pubkey,
      );
      const inboxSnapshot = await inboxes.settle(tagged, PUBLISH_INBOX_WAIT_MS);

      // 3. Freeze the relay list. From here on nothing that answers late can
      //    change where this note goes.
      const snapshotRows = deriveRelayRows({
        ownWrite: ownWriteRelays,
        fallback: FALLBACK_RELAYS,
        manual: addedRelays,
        recipients: tagged.map((pk) => ({
          pubkey: pk,
          relays: resolvedRelays(inboxSnapshot.get(pk)),
        })),
      });
      const selected = effectiveSelection(snapshotRows, overrides);
      if (selected.length === 0) {
        toast.error("Please select at least one relay");
        setIsPublishing(false);
        setPublishPhase("idle");
        return;
      }
      setFrozenRows(snapshotRows);
      setPublishPhase("signing");

      let event: NostrEvent;
      try {
        event = await built.factory.sign(signer);
      } catch (error) {
        // Signing failed - user might have rejected it
        console.error("Failed to sign event:", error);
        toast.error(
          error instanceof Error ? error.message : "Failed to sign note",
        );
        setFrozenRows(null);
        setIsPublishing(false);
        setPublishPhase("idle");
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

          const delivery = summarizeRecipientDelivery(
            tagged,
            snapshotRows,
            selected,
            publishResult.successful,
          );
          const notes: string[] = [];
          if (delivery.accepted.length > 0)
            notes.push(
              `Accepted by an inbox relay of ${personCount(delivery.accepted.length)} you tagged.`,
            );
          if (delivery.rejected.length > 0)
            notes.push(
              `No inbox relay accepted it for ${personCount(delivery.rejected.length)}.`,
            );
          if (delivery.noInboxSelected.length > 0) {
            const stillLooking = delivery.noInboxSelected.filter(
              (pk) => inboxSnapshot.get(pk)?.status === "pending",
            ).length;
            notes.push(
              `Not sent to any inbox relay of ${personCount(delivery.noInboxSelected.length)}` +
                (stillLooking > 0
                  ? ` (${stillLooking} still being looked up).`
                  : "."),
            );
          }
          const description = notes.length > 0 ? notes.join(" ") : undefined;

          if (successCount === selected.length) {
            toast.success(
              `Published to all ${selected.length} relay${selected.length > 1 ? "s" : ""}`,
              { description },
            );
          } else {
            toast.warning(
              `Published to ${successCount} of ${selected.length} relays`,
              { description },
            );
          }
        } else {
          setFrozenRows(null);
          toast.error(
            "Failed to publish to any relay. Please check your relay connections and try again.",
          );
        }
      } catch (error) {
        subscription.unsubscribe();
        setFrozenRows(null);
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
        setPublishPhase("idle");
      }
    },
    [
      canSign,
      signer,
      pubkey,
      settings,
      windowId,
      excludedRecipients,
      inboxes,
      ownWriteRelays,
      addedRelays,
      overrides,
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
    setFrozenRows(null);
    setOverrides({});
    setExcludedRecipients([]);
    setRecipients([]);
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
  const authorRows = displayRows.filter((r) => r.section === "author");
  const inboxRows = displayRows.filter((r) => r.section === "recipients");
  const hasInboxSection = inboxRows.length > 0;
  const renderRow = (row: RelayRow) => (
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
  );

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
                className="gap-2 min-w-32"
                aria-live="polite"
              >
                {publishPhase === "resolving" ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Finding inboxes…
                  </>
                ) : isPublishing ? (
                  <Loader2
                    className="h-4 w-4 animate-spin"
                    aria-label="Publishing"
                  />
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

        {!showPublishedPreview && (
          <PostRecipients
            recipients={shownRecipients}
            getInbox={inboxes.get}
            disabled={isPublishing}
            onExclude={excludeRecipient}
            onInclude={includeRecipient}
          />
        )}

        {/* Relay selection */}
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm text-muted-foreground">
              Relays ({selectedRelays.length} selected)
            </span>
            {!rowsLocked && hasActiveOverrides(displayRows, overrides) && (
              <button
                type="button"
                onClick={resetRelaySelection}
                className="text-xs text-muted-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-sm"
              >
                Reset selection
              </button>
            )}
          </div>

          <div className="space-y-1 max-h-80 overflow-y-auto">
            {hasInboxSection && (
              <h3 className="text-xs text-muted-foreground font-normal pt-1">
                Your relays
              </h3>
            )}
            {authorRows.map(renderRow)}
            {hasInboxSection && (
              <section
                aria-labelledby="post-inbox-relays-heading"
                className="pt-2 space-y-1"
              >
                <h3
                  id="post-inbox-relays-heading"
                  className="text-xs text-muted-foreground font-normal"
                >
                  Tagged people&apos;s inboxes
                </h3>
                <p className="text-xs text-muted-foreground">
                  The relays these people list for reading mentions (NIP-65).
                  Untick any you don&apos;t want to send to.
                </p>
                {inboxRows.map(renderRow)}
              </section>
            )}
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
