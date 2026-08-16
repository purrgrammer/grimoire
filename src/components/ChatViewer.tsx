import { useMemo, useState, memo, useCallback, useRef, useEffect } from "react";
import { use$ } from "applesauce-react/hooks";
import { from, catchError, of, map } from "rxjs";
import { Virtuoso } from "react-virtuoso";
import {
  Loader2,
  Reply,
  Zap,
  AlertTriangle,
  RefreshCw,
  Paperclip,
  Copy,
  CopyCheck,
  FileText,
  MessageSquare,
  Check,
} from "lucide-react";
import { nip19 } from "nostr-tools";
import type { EventPointer, AddressPointer } from "nostr-tools/nip19";
import { getZapRequest } from "applesauce-common/helpers/zap";
import { getEventPointerFromETag } from "applesauce-core/helpers/pointers";
import { toast } from "sonner";
import eventStore from "@/services/event-store";
import type {
  ChatProtocol,
  ProtocolIdentifier,
  Conversation,
  LiveActivityMetadata,
} from "@/types/chat";
import { CHAT_KINDS } from "@/types/chat";
import { Nip10Adapter } from "@/lib/chat/adapters/nip-10-adapter";
import { Nip22Adapter } from "@/lib/chat/adapters/nip-22-adapter";
import { ConcordAdapter } from "@/lib/chat/adapters/concord-adapter";
import { CONCORD_URL } from "@/constants/concord-links";
import { Nip29Adapter } from "@/lib/chat/adapters/nip-29-adapter";
import { Nip53Adapter } from "@/lib/chat/adapters/nip-53-adapter";
import type {
  BlobAttachmentMeta,
  ChatProtocolAdapter,
} from "@/lib/chat/adapters/base-adapter";
import {
  prepareAttachment,
  type EncryptedUpload,
} from "@/lib/concord/attachment-upload";
import type { Message } from "@/types/chat";
import type { NostrEvent } from "@/types/nostr";
import type { ChatAction } from "@/types/chat-actions";
import { parseSlashCommand } from "@/lib/chat/slash-command-parser";
import {
  groupSystemMessages,
  isGroupedSystemMessage,
  type GroupedSystemMessage,
} from "@/lib/chat/group-system-messages";
import { UserName } from "./nostr/UserName";
import { RichText } from "./nostr/RichText";
import Timestamp from "./Timestamp";
import { ReplyPreview } from "./chat/ReplyPreview";
import { MembersDropdown } from "./chat/MembersDropdown";
import { RelaysDropdown } from "./chat/RelaysDropdown";
import { MessageReactions } from "./chat/MessageReactions";
import { StatusBadge } from "./live/StatusBadge";
import { ChatMessageContextMenu } from "./chat/ChatMessageContextMenu";
import { useAddWindow } from "@/core/state";
import { Button } from "./ui/button";
import LoginDialog from "./nostr/LoginDialog";
import {
  MentionEditor,
  type MentionEditorHandle,
  type EmojiTag,
  type BlobAttachment,
} from "./editor/MentionEditor";
import { useProfileSearch } from "@/hooks/useProfileSearch";
import profileSearch from "@/services/profile-search";
import { makeRosterProfileSearch } from "@/lib/chat/roster-search";
import { useEmojiSearch } from "@/hooks/useEmojiSearch";
import { useCopy } from "@/hooks/useCopy";
import { useFeedHomeEnd } from "@/hooks/useFeedHomeEnd";
import { useReadMarker } from "@/hooks/useReadMarker";
import { useJumpToMessage } from "@/hooks/useJumpToMessage";
import { useAccount } from "@/hooks/useAccount";
import { useLocale } from "@/hooks/useLocale";
import { Label } from "./ui/label";
import { KindRenderer } from "./nostr/kinds";
import {
  getExternalIdentifierIcon,
  getExternalIdentifierLabel,
  getExternalIdentifierHref,
  getLocalizedRegionName,
  regionToEmoji,
} from "@/lib/nip73-helpers";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./ui/tooltip";
import { useBlossomUpload } from "@/hooks/useBlossomUpload";
import {
  computeFirstItemIndexDelta,
  FIRST_ITEM_INDEX_BASE,
} from "./chat/prepend-anchor";
import { REVIVE_AFTER_MS, shouldRevive } from "./chat/list-revival";
import {
  clearDraft,
  draftKey,
  draftsReady,
  readDraft,
  shouldRestoreDraft,
  writeDraft,
} from "@/services/chat-drafts";
import { mentionsPubkey } from "@/lib/chat/mentions";
import { cn } from "@/lib/utils";

interface ChatViewerProps {
  protocol: ChatProtocol;
  identifier: ProtocolIdentifier;
  customTitle?: string;
  /** Optional content to render before the title (e.g., sidebar toggle on mobile) */
  headerPrefix?: React.ReactNode;
  /**
   * Land on a message the caller already knows about — a search hit, typically.
   *
   * The `nonce` is what makes it a request rather than a value: without one,
   * clicking the same result twice would be indistinguishable from not clicking
   * at all, and a lingering id would re-fire on every channel change.
   */
  jumpTo?: { messageId: string; nonce: number };
  /**
   * Called once a `jumpTo` request has been walked to its end — landed, given
   * up, or refused.
   *
   * The consumption has to live with the CALLER, not in a ref here: the pane
   * that raises a jump is the pane that replaces this one, so ChatViewer
   * unmounts between the click and the next time the reader comes back. A
   * request remembered only in a ref would be honoured again by the fresh
   * instance, and the timeline would jump at someone who asked for nothing.
   */
  onJumpHandled?: (nonce: number) => void;
}

/**
 * Format a timestamp as a readable day marker, in the reader's calendar.
 *
 * The locale is a PARAMETER rather than a `useLocale()` call, because this runs
 * inside the memo that builds the rendered array and a hook cannot. The caller
 * passes what `useLocale` gave it, which is what keeps this off the browser
 * default that CLAUDE.md's locale rule exists to stop.
 */
function formatDayMarker(timestamp: number, locale: string): string {
  const date = new Date(timestamp * 1000);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  // Reset time parts for comparison
  const dateOnly = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  );
  const todayOnly = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );
  const yesterdayOnly = new Date(
    yesterday.getFullYear(),
    yesterday.getMonth(),
    yesterday.getDate(),
  );

  if (dateOnly.getTime() === todayOnly.getTime()) {
    return "Today";
  } else if (dateOnly.getTime() === yesterdayOnly.getTime()) {
    return "Yesterday";
  } else {
    // "Jan 15" — short month, no year, in the reader's locale.
    return date.toLocaleDateString(locale, {
      month: "short",
      day: "numeric",
    });
  }
}

/**
 * Helper: Check if two timestamps are on different days
 */
function isDifferentDay(timestamp1: number, timestamp2: number): boolean {
  const date1 = new Date(timestamp1 * 1000);
  const date2 = new Date(timestamp2 * 1000);

  return (
    date1.getFullYear() !== date2.getFullYear() ||
    date1.getMonth() !== date2.getMonth() ||
    date1.getDate() !== date2.getDate()
  );
}

/**
 * Type guard for LiveActivityMetadata
 */
function isLiveActivityMetadata(value: unknown): value is LiveActivityMetadata {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.status === "string" &&
    typeof obj.hostPubkey === "string" &&
    Array.isArray(obj.hashtags) &&
    Array.isArray(obj.relays)
  );
}

/**
 * Get relay URLs for a conversation based on protocol
 * Used for fetching protocol-specific data like reactions
 */
function getConversationRelays(conversation: Conversation): string[] {
  // NIP-53 live chats: Use full relay list from liveActivity metadata
  if (conversation.protocol === "nip-53") {
    const liveActivity = conversation.metadata?.liveActivity;
    if (isLiveActivityMetadata(liveActivity) && liveActivity.relays) {
      return liveActivity.relays;
    }
  }

  // NIP-22 comments and NIP-10 threads: Use relays from metadata
  if (
    conversation.protocol === "nip-22" ||
    conversation.protocol === "nip-10"
  ) {
    return conversation.metadata?.relays || [];
  }

  // NIP-29 groups and fallback: Use single relay URL
  const relayUrl = conversation.metadata?.relayUrl;
  return relayUrl ? [relayUrl] : [];
}

/**
 * Get the chat command identifier for a conversation
 * Returns a string that can be passed to the `chat` command to open this conversation
 *
 * For NIP-29 groups: relay'group-id (without wss:// prefix)
 * For NIP-53 live activities: naddr1... encoding
 */
function getChatIdentifier(conversation: Conversation): string | null {
  if (conversation.protocol === "nip-29") {
    const groupId = conversation.metadata?.groupId;
    const relayUrl = conversation.metadata?.relayUrl;
    if (!groupId || !relayUrl) return null;

    // Strip wss:// or ws:// prefix for cleaner identifier
    const cleanRelay = relayUrl.replace(/^wss?:\/\//, "");
    return `${cleanRelay}'${groupId}`;
  }

  if (conversation.protocol === "concord") {
    // The raw channel id. Unlike every other protocol here this is NOT
    // something you can type back into the command — a Concord channel lives
    // at a derived pubkey and has no public address — but it is what names the
    // channel in the store, in a filter and in a bug report.
    return conversation.metadata?.channelId ?? null;
  }

  if (conversation.protocol === "nip-53") {
    const activityAddress = conversation.metadata?.activityAddress;
    if (!activityAddress) return null;

    // Get relay hints from live activity metadata
    const liveActivity = conversation.metadata?.liveActivity;
    const relays = liveActivity?.relays || [];

    return nip19.naddrEncode({
      kind: activityAddress.kind,
      pubkey: activityAddress.pubkey,
      identifier: activityAddress.identifier,
      relays: relays.slice(0, 3), // Limit relay hints to keep naddr short
    });
  }

  if (conversation.protocol === "nip-22") {
    const meta = conversation.metadata;
    const relays = (meta?.relays || []).slice(0, 3);

    if (meta?.commentRootType === "external" && meta?.commentRootExternal) {
      return meta.commentRootExternal;
    }

    if (meta?.commentRootType === "address" && meta?.commentRootAddress) {
      return nip19.naddrEncode({
        kind: meta.commentRootAddress.kind,
        pubkey: meta.commentRootAddress.pubkey,
        identifier: meta.commentRootAddress.identifier,
        relays,
      });
    }

    if (meta?.commentRootEventId) {
      const kind = meta.commentRootKind
        ? parseInt(meta.commentRootKind, 10)
        : undefined;
      return nip19.neventEncode({
        id: meta.commentRootEventId,
        kind: Number.isFinite(kind) ? kind : undefined,
        relays,
      });
    }

    return null;
  }

  return null;
}

/**
 * Conversation resolution result - either success with conversation or error
 */
/**
 * The page an older-messages fetch asks for, and the depth below which there is
 * nothing older to ask for. One constant, because the two have to agree: using
 * a different number in each is how a "load older" button ends up permanently
 * offered on a channel that has already given up everything it has.
 */
const OLDER_PAGE_SIZE = 50;

/**
 * How long the timeline must stop changing before we jump it to the newest
 * message.
 *
 * The timeline arrives in pieces — the local store first, then each relay's
 * backfill page — and every piece shifts what "the end" means. Waiting for a
 * lull is what makes one jump land correctly instead of a dozen chasing a
 * moving target.
 */
const ANCHOR_SETTLE_MS = 400;

/**
 * How long typing must pause before the draft is written to disk.
 *
 * Only the WRITE waits — the document is mirrored in memory on every keystroke,
 * so a channel switch or a closed window saves what was typed a moment ago
 * rather than what was typed a debounce ago.
 */
const DRAFT_SAVE_MS = 750;

type ConversationResult =
  | { status: "loading" }
  | {
      status: "success";
      conversation: Conversation;
      /**
       * The identifier this conversation was resolved FROM.
       *
       * Carried because the resolved value lags the prop by a render: `use$`
       * clears itself in an effect, so the first render after the caller points
       * this viewer at another channel still hands back the previous channel's
       * conversation. Anything that must not act on the wrong channel compares
       * this against the current `identifier` first.
       */
      identifier: ProtocolIdentifier;
    }
  | { status: "error"; error: string };

/**
 * ComposerReplyPreview - Shows who is being replied to in the composer
 */
const ComposerReplyPreview = memo(function ComposerReplyPreview({
  replyToId,
  adapter,
  conversation,
  onClear,
}: {
  replyToId: string;
  adapter: ChatProtocolAdapter;
  conversation: Conversation;
  onClear: () => void;
}) {
  const fromStore = use$(() => eventStore.event(replyToId), [replyToId]);
  /**
   * The adapter's own answer, for protocols whose messages never reach the
   * shared EventStore — the same two-source resolution `ReplyPreview` already
   * does for the in-timeline banner.
   *
   * Concord is the case, and it is not an edge one: its messages are decrypted
   * rumors of a private community, deliberately kept out of the store shared
   * with every other window. Reading only the store meant the composer could
   * never name what it was replying to and fell back to a raw rumor id — while
   * the timeline right above it rendered the same parent correctly.
   */
  const [fromAdapter, setFromAdapter] = useState<NostrEvent | null>(null);
  const replyEvent = fromStore ?? fromAdapter ?? undefined;

  useEffect(() => {
    if (fromStore || fromAdapter) return;
    let cancelled = false;
    adapter
      .loadReplyMessage(conversation, { id: replyToId })
      .then((event) => {
        if (!cancelled && event) setFromAdapter(event);
      })
      .catch((error: unknown) => {
        console.warn("[Chat] could not resolve the reply parent:", error);
      });
    return () => {
      cancelled = true;
    };
  }, [fromStore, fromAdapter, adapter, conversation, replyToId]);

  if (!replyEvent) {
    return (
      <div className="flex items-center gap-2 rounded bg-muted px-2 py-1 text-xs mb-1.5 overflow-hidden">
        <span className="flex-1 min-w-0 truncate">
          Replying to {replyToId.slice(0, 8)}...
        </span>
        <button
          onClick={onClear}
          className="ml-auto text-muted-foreground hover:text-foreground flex-shrink-0"
        >
          ✕
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded bg-muted px-2 py-1 text-xs mb-1.5 overflow-hidden">
      <span className="flex-shrink-0">↳</span>
      <UserName
        pubkey={replyEvent.pubkey}
        className="font-medium flex-shrink-0"
      />
      <div className="flex-1 min-w-0 line-clamp-1 overflow-hidden text-muted-foreground">
        <RichText
          event={replyEvent}
          options={{ showMedia: false, showEventEmbeds: false }}
        />
      </div>
      <button
        onClick={onClear}
        className="ml-auto text-muted-foreground hover:text-foreground flex-shrink-0"
      >
        ✕
      </button>
    </div>
  );
});

/**
 * GroupedSystemMessageItem - Renders multiple users performing the same action
 * Example: "alice, bob and 3 others reposted"
 */
const GroupedSystemMessageItem = memo(function GroupedSystemMessageItem({
  grouped,
}: {
  grouped: GroupedSystemMessage;
}) {
  const { authors, content } = grouped;

  // Format the authors list based on count
  const formatAuthors = () => {
    if (authors.length === 1) {
      return <UserName pubkey={authors[0]} className="text-xs" />;
    } else if (authors.length === 2) {
      return (
        <>
          <UserName pubkey={authors[0]} className="text-xs" /> and{" "}
          <UserName pubkey={authors[1]} className="text-xs" />
        </>
      );
    } else if (authors.length === 3) {
      return (
        <>
          <UserName pubkey={authors[0]} className="text-xs" />,{" "}
          <UserName pubkey={authors[1]} className="text-xs" /> and{" "}
          <UserName pubkey={authors[2]} className="text-xs" />
        </>
      );
    } else {
      // 4 or more: show first 2 and "X others"
      const othersCount = authors.length - 2;
      return (
        <>
          <UserName pubkey={authors[0]} className="text-xs" />,{" "}
          <UserName pubkey={authors[1]} className="text-xs" /> and {othersCount}{" "}
          {othersCount === 1 ? "other" : "others"}
        </>
      );
    }
  };

  return (
    <div className="flex items-center px-3 py-1">
      <span className="text-xs text-muted-foreground">
        * {formatAuthors()} {content}
      </span>
    </div>
  );
});

/**
 * Where an outgoing message has got to.
 *
 * Only ever rendered for the sender's own messages, and only by protocols that
 * track delivery at all — everywhere else this is nothing, which is why the
 * check on a delivered message is gated on the capability rather than on the
 * author alone. Retry and Discard are feature-detected on the adapter, so a
 * protocol that grows a delivery state without them shows a badge and no
 * buttons rather than two that throw.
 */
const DeliveryStatus = memo(function DeliveryStatus({
  message,
  adapter,
  conversation,
  activePubkey,
}: {
  message: Message;
  adapter: ChatProtocolAdapter;
  conversation: Conversation;
  activePubkey?: string;
}) {
  const tracked = adapter.getCapabilities().supportsDeliveryStatus;
  if (!tracked) return null;

  if (message.delivery === "sending") {
    return (
      <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
        <Loader2 className="size-3 animate-spin" />
        Sending
      </span>
    );
  }

  if (message.delivery === "failed") {
    const act = async (
      run: ((c: Conversation, id: string) => Promise<void>) | undefined,
      what: string,
    ) => {
      if (!run) return;
      try {
        await run.call(adapter, conversation, message.id);
      } catch (error) {
        console.error(`[Chat] could not ${what} the message:`, error);
        toast.error(
          error instanceof Error ? error.message : `Could not ${what} it.`,
        );
      }
    };
    return (
      <span className="flex items-center gap-1.5 text-[10px] text-destructive">
        <AlertTriangle className="size-3" />
        Not sent
        {adapter.retrySend && (
          <button
            className="underline hover:no-underline"
            onClick={() => void act(adapter.retrySend, "resend")}
          >
            Retry
          </button>
        )}
        {adapter.discardSend && (
          <button
            className="underline hover:no-underline"
            onClick={() => void act(adapter.discardSend, "discard")}
          >
            Discard
          </button>
        )}
      </span>
    );
  }

  // Delivered, and ours: a relay took it. Quiet on purpose — it is the absence
  // of a warning that carries the meaning. But quiet is not the same as
  // self-explanatory: a bare tick next to your own message reads as a read
  // receipt, which this is emphatically not, so it says what it means on hover.
  if (activePubkey && message.author === activePubkey) {
    return (
      <span title="Sent — a relay accepted this message. It does not mean anyone has read it.">
        <Check
          className="size-3 text-muted-foreground/60"
          aria-label="Sent — a relay accepted this message"
        />
      </span>
    );
  }
  return null;
});

/**
 * MessageItem - Memoized message component for performance
 */
const MessageItem = memo(function MessageItem({
  message,
  adapter,
  conversation,
  onReply,
  canReply,
  onScrollToMessage,
  isRootMessage,
  activePubkey,
  isFlashing,
}: {
  message: Message;
  adapter: ChatProtocolAdapter;
  conversation: Conversation;
  onReply?: (messageId: string) => void;
  canReply: boolean;
  onScrollToMessage?: (messageId: string) => void;
  isRootMessage?: boolean;
  /** The viewer, so the menu can offer a self-delete on their own messages. */
  activePubkey?: string;
  /** Briefly marked, because a jump just landed here. */
  isFlashing?: boolean;
}) {
  // Get relays for this conversation (memoized to prevent unnecessary re-subscriptions)
  const relays = useMemo(
    () => getConversationRelays(conversation),
    [conversation],
  );

  // Whether this message names the reader. Protocol-generic: NIP-29's factory
  // emits the same `p` tag Concord now sends.
  const mentionsMe =
    !!activePubkey &&
    message.author !== activePubkey &&
    !!message.event &&
    mentionsPubkey(message.event.tags, activePubkey);

  // Determine if the reply target is a chat message (not a reaction, repost, etc.)
  // Extract event ID from reply pointer
  const replyEventId =
    message.replyTo && "id" in message.replyTo ? message.replyTo.id : undefined;
  const replyEvent = use$(
    () => (replyEventId ? eventStore.event(replyEventId) : undefined),
    [replyEventId],
  );

  // Chat message kinds per protocol - only show reply preview for these
  const isChatKindReply =
    !message.replyTo ||
    !replyEvent ||
    (CHAT_KINDS as readonly number[]).includes(replyEvent.kind) ||
    (conversation.protocol === "nip-10" && replyEvent.kind === 1);

  // A message a moderator took down. Early, and BEFORE the context-menu wrap
  // below: every entry in that menu names an event, and this row's event is a
  // scrubbed stand-in whose content was deliberately withheld.
  //
  // Only a third party's removal ever reaches here. A message its own author
  // deleted leaves no row at all, which is the point — a tombstone would
  // announce exactly the erasure they performed.
  if (message.metadata?.deleted) {
    return (
      <div className="flex items-center px-3 py-1">
        <span className="text-xs italic text-muted-foreground">
          Message from{" "}
          <UserName pubkey={message.author} className="text-xs not-italic" />{" "}
          {message.metadata.deletedBy ? (
            <>
              removed by{" "}
              <UserName
                pubkey={message.metadata.deletedBy}
                className="text-xs not-italic"
              />
            </>
          ) : (
            "removed"
          )}{" "}
          · <Timestamp timestamp={message.timestamp} />
        </span>
      </div>
    );
  }

  // System messages (join/leave) have special styling
  if (message.type === "system") {
    return (
      <div className="flex items-center px-3 py-1">
        <span className="text-xs text-muted-foreground">
          * <UserName pubkey={message.author} className="text-xs" />{" "}
          {message.content}
        </span>
      </div>
    );
  }

  // Zap messages have special styling with gradient border
  if (message.type === "zap") {
    const zapRequest = message.event ? getZapRequest(message.event) : null;
    // For NIP-57 zaps, reply target is in the zap request's e-tag
    // For NIP-61 nutzaps, reply target is already in message.replyTo (as EventPointer)
    // Convert zap request e-tag to EventPointer for consistent handling
    const zapRequestETag = zapRequest?.tags.find((t) => t[0] === "e");
    const zapReplyPointer: EventPointer | AddressPointer | undefined =
      message.replyTo ||
      (zapRequestETag
        ? (getEventPointerFromETag(zapRequestETag) ?? undefined)
        : undefined);

    // Extract event ID from pointer for EventStore lookup
    const zapReplyEventId =
      zapReplyPointer && "id" in zapReplyPointer
        ? zapReplyPointer.id
        : undefined;

    // Check if the replied-to event exists and is a chat kind
    const replyEvent = use$(
      () => (zapReplyEventId ? eventStore.event(zapReplyEventId) : undefined),
      [zapReplyEventId],
    );

    // Only show reply preview if:
    // 1. The event exists in our store
    // 2. The event is a chat kind (includes messages, nutzaps, live chat, and zap receipts)
    const shouldShowReplyPreview =
      zapReplyPointer &&
      replyEvent &&
      (CHAT_KINDS as readonly number[]).includes(replyEvent.kind);

    return (
      <div className="pl-2 my-1">
        <div
          className="p-[1px] rounded"
          style={{
            background:
              "linear-gradient(to right, rgb(250 204 21), rgb(251 146 60), rgb(168 85 247), rgb(34 211 238))",
          }}
        >
          <div className="bg-background px-1 rounded-sm">
            <div className="flex items-center gap-2">
              <UserName
                pubkey={message.author}
                className="font-semibold text-sm"
              />
              <Zap className="size-4 fill-yellow-500 text-yellow-500" />
              <span className="text-yellow-500 font-bold">
                {(message.metadata?.zapAmount || 0).toLocaleString("en", {
                  notation: "compact",
                })}
              </span>
              {message.metadata?.zapRecipient && (
                <UserName
                  pubkey={message.metadata.zapRecipient}
                  className="text-sm"
                />
              )}
              <span className="text-xs text-muted-foreground">
                <Timestamp timestamp={message.timestamp} />
              </span>
              {/* Reactions display - inline after timestamp */}
              <MessageReactions
                messageId={message.id}
                relays={relays}
                adapter={adapter}
                conversation={conversation}
                reactions={message.metadata?.reactions}
              />
            </div>
            {shouldShowReplyPreview && zapReplyPointer && (
              <ReplyPreview
                replyTo={zapReplyPointer}
                adapter={adapter}
                conversation={conversation}
                onScrollToMessage={onScrollToMessage}
              />
            )}
            {message.content && (
              <RichText
                event={zapRequest || message.event}
                className="text-sm leading-tight break-words"
                options={{ showMedia: false, showEventEmbeds: false }}
              />
            )}
          </div>
        </div>
      </div>
    );
  }

  // Regular user messages - wrap in context menu if event exists
  const messageContent = (
    <div
      className={cn(
        "group flex items-start hover:bg-muted/50 px-3",
        // A message that names you, marked the way the composer's own accent
        // marks you elsewhere. `mentionsPubkey` is the single predicate the
        // unread badge and the "New" divider also answer with, so a highlighted
        // row and a badged channel can never disagree — including the rule it
        // carries: a threaded reply to you p-tags you, so it counts as naming
        // you even with no @ in the body.
        mentionsMe && "border-l-2 border-highlight bg-highlight/10",
        // Where a jump landed. Fades on its own, so the reader's eye finds the
        // row without the timeline keeping a selection it never asked for.
        isFlashing && "bg-primary/15 transition-colors duration-500",
      )}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <UserName pubkey={message.author} className="font-semibold text-sm" />
          <span className="text-xs text-muted-foreground">
            <Timestamp timestamp={message.timestamp} />
          </span>
          {/* Reactions display - inline after timestamp */}
          <MessageReactions
            messageId={message.id}
            relays={relays}
            adapter={adapter}
            conversation={conversation}
            reactions={message.metadata?.reactions}
          />
          <DeliveryStatus
            message={message}
            adapter={adapter}
            conversation={conversation}
            activePubkey={activePubkey}
          />
          {/* Nothing to reply to yet: a queued message exists on no relay, so
              a reply could not name it. */}
          {canReply && onReply && !isRootMessage && !message.delivery && (
            <button
              onClick={() => onReply(message.id)}
              className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground ml-auto"
              title="Reply to this message"
            >
              <Reply className="size-3" />
            </button>
          )}
        </div>
        <div className="break-words overflow-hidden">
          {message.event ? (
            <RichText className="text-sm leading-tight" event={message.event}>
              {message.replyTo && isChatKindReply && (
                <ReplyPreview
                  replyTo={message.replyTo}
                  adapter={adapter}
                  conversation={conversation}
                  onScrollToMessage={onScrollToMessage}
                />
              )}
            </RichText>
          ) : (
            <span className="whitespace-pre-wrap break-words">
              {message.content}
            </span>
          )}
        </div>
      </div>
    </div>
  );

  // Wrap in context menu if event exists — but never for a message that is
  // still queued: every action in that menu names an event id no relay holds.
  if (message.event && !message.delivery) {
    return (
      <ChatMessageContextMenu
        event={message.event}
        onReply={
          canReply && onReply && !isRootMessage
            ? () => onReply(message.id)
            : undefined
        }
        conversation={conversation}
        adapter={adapter}
        message={message}
        activePubkey={activePubkey}
      >
        {messageContent}
      </ChatMessageContextMenu>
    );
  }

  return messageContent;
});

/**
 * ChatViewer - Main chat interface component
 *
 * Provides protocol-agnostic chat UI that works across all Nostr messaging protocols.
 * Uses adapter pattern to handle protocol-specific logic while providing consistent UX.
 */
export function ChatViewer({
  protocol,
  identifier,
  customTitle,
  headerPrefix,
  jumpTo,
  onJumpHandled,
}: ChatViewerProps) {
  const addWindow = useAddWindow();

  // Get active account with signing capability
  const { pubkey, canSign, signer } = useAccount();

  // Day markers are dates, so they answer to the reader's calendar.
  const { locale } = useLocale();

  // Profile search for mentions
  const { searchProfiles } = useProfileSearch();

  // Emoji search for custom emoji autocomplete
  const { searchEmojis } = useEmojiSearch();

  // Copy chat identifier to clipboard
  const { copy: copyChatId, copied: chatIdCopied } = useCopy();

  // Ref to MentionEditor for programmatic submission
  const editorRef = useRef<MentionEditorHandle>(null);

  /**
   * AES-GCM params for attachments uploaded in this session, keyed by URL.
   *
   * Concord attachments are encrypted BEFORE upload (CORD-02 §6), so the blob
   * on the media host is ciphertext and these are the only copy of what opens
   * it. They ride in the message's `imeta`, which is sealed to the members who
   * may read the channel.
   */
  const attachmentEncryption = useRef<
    Map<string, Pick<BlobAttachmentMeta, "encryption" | "originalMime">>
  >(new Map());
  /** The most recent prepared upload, awaiting the URL it lands on. */
  const preparedUpload = useRef<EncryptedUpload | undefined>(undefined);
  /**
   * A `blob:` URL for the plaintext of that upload, for the composer badge.
   *
   * The uploaded URL serves ciphertext, so the badge cannot draw it. Held only
   * until the badge is inserted, and revoked whenever it is replaced or
   * abandoned — an object URL pins its bytes in memory until it is.
   */
  const preparedPreview = useRef<string | undefined>(undefined);
  const dropPreview = useCallback(() => {
    if (preparedPreview.current) URL.revokeObjectURL(preparedPreview.current);
    preparedPreview.current = undefined;
  }, []);

  // Blossom upload hook for file attachments
  const { open: openUpload, dialog: uploadDialog } = useBlossomUpload({
    accept: "image/*,video/*,audio/*",
    // Concord only. Every other protocol here posts to a public channel where
    // an encrypted blob would just be an unreadable one.
    ...(protocol === "concord"
      ? {
          prepareFile: async (file: File) => {
            const prepared = await prepareAttachment(file);
            preparedUpload.current = prepared;
            dropPreview();
            // Only images are ever drawn in the badge; minting a URL for a
            // video would pin its bytes for nothing.
            if (file.type.startsWith("image/")) {
              preparedPreview.current = URL.createObjectURL(file);
            }
            return prepared.file;
          },
        }
      : {}),
    onCancel: () => {
      // A prepared-but-unuploaded file must not outlive its dialog, or the next
      // upload could be tagged with the previous file's key.
      preparedUpload.current = undefined;
      dropPreview();
    },
    onError: () => {
      preparedUpload.current = undefined;
      dropPreview();
    },
    onSuccess: (results) => {
      // Captured before the ref is cleared below: the badge needs to know the
      // server holds ciphertext, and `insertBlob` runs after that clear.
      const wasEncrypted = preparedUpload.current !== undefined;
      const preview = preparedPreview.current;
      if (results.length > 0 && preparedUpload.current) {
        // Every result is the SAME blob mirrored to several servers, so one
        // record per URL keeps a later mirror URL readable too.
        for (const { blob } of results) {
          attachmentEncryption.current.set(blob.url, {
            encryption: preparedUpload.current.encryption,
            originalMime: preparedUpload.current.originalMime,
          });
        }
        preparedUpload.current = undefined;
      }
      if (results.length > 0 && editorRef.current) {
        // Insert the first successful upload as a blob attachment with metadata
        const { blob, server } = results[0];
        editorRef.current.insertBlob({
          url: blob.url,
          sha256: blob.sha256,
          mimeType: blob.type,
          size: blob.size,
          server,
          ...(preview ? { previewUrl: preview } : {}),
          ...(wasEncrypted ? { encrypted: true } : {}),
        });
        // Ownership passes to the badge; revoking here would blank it.
        preparedPreview.current = undefined;
        editorRef.current.focus();
      }
    },
  });

  // Get the appropriate adapter for this protocol
  const adapter = useMemo(() => getAdapter(protocol), [protocol]);

  // State for retry trigger
  const [retryCount, setRetryCount] = useState(0);

  // Resolve conversation from identifier with error handling
  const conversationResult = use$(
    () =>
      from(adapter.resolveConversation(identifier)).pipe(
        map((conv): ConversationResult => ({
          status: "success",
          conversation: conv,
          identifier,
        })),
        catchError((err) => {
          console.error("[Chat] Failed to resolve conversation:", err);
          const errorMessage =
            err instanceof Error ? err.message : "Failed to load conversation";
          return of<ConversationResult>({
            status: "error",
            error: errorMessage,
          });
        }),
      ),
    [adapter, identifier, retryCount],
  );

  // Extract conversation from result (null while loading or on error)
  const conversation =
    conversationResult?.status === "success"
      ? conversationResult.conversation
      : null;

  // Relays for this conversation (used for reactions on root post, etc.)
  const conversationRelays = useMemo(
    () => (conversation ? getConversationRelays(conversation) : []),
    [conversation],
  );

  /**
   * Where `@` looks: the room's roster when the protocol has one, else the
   * global profile index.
   *
   * **This is read ONCE, when the editor is created.** `MentionEditor` builds
   * its suggestion plugin from `searchProfiles` at mount and tiptap's
   * `setOptions` never rebuilds the extension manager, so handing a MOUNTED
   * editor a different function is a silent no-op. It works here only because
   * ChatViewer unmounts the composer between conversations — `conversation` is
   * null while the next one resolves, and the composer is behind that gate. If
   * anyone later keeps the previous conversation on screen while re-resolving,
   * or makes this identity change mid-mount, the composer will quietly keep
   * autocompleting against the previous channel's roster.
   */
  const searchMentions = useMemo(() => {
    if (!conversation) return searchProfiles;
    if (adapter.getCapabilities().mentionSuggestions !== "roster")
      return searchProfiles;
    return makeRosterProfileSearch(conversation.participants, (pk) =>
      profileSearch.getByPubkey(pk),
    );
  }, [adapter, conversation, searchProfiles]);

  // Slash command search for action autocomplete
  // Context-aware: only shows relevant actions based on membership status
  const searchCommands = useCallback(
    async (query: string) => {
      const availableActions = adapter.getActions({
        conversation: conversation || undefined,
        activePubkey: pubkey,
      });
      const lowerQuery = query.toLowerCase();
      return availableActions.filter((action) =>
        action.name.toLowerCase().includes(lowerQuery),
      );
    },
    [adapter, conversation, pubkey],
  );

  // Cleanup subscriptions when conversation changes or component unmounts
  useEffect(() => {
    return () => {
      if (conversation) {
        adapter.cleanup(conversation.id);
      }
    };
  }, [adapter, conversation]);

  // Load messages for this conversation (reactive)
  const messages = use$(
    () => (conversation ? adapter.loadMessages(conversation) : undefined),
    [adapter, conversation],
  );

  // Where the "New messages" line goes, and — once the pre-visit stamp has been
  // captured — moving that stamp forward as the reader sits here. Inert for any
  // protocol whose adapter keeps no read state.
  const dividerMessageId = useReadMarker(
    adapter,
    conversation ?? undefined,
    messages,
    pubkey,
  );

  // Process messages to include day markers and group system messages
  const messagesWithMarkers = useMemo(() => {
    if (!messages || messages.length === 0) return [];

    // For NIP-22, ensure root event is always first regardless of timestamp
    let orderedMessages = messages;
    const nip22RootId =
      protocol === "nip-22"
        ? conversation?.metadata?.commentRootEventId
        : undefined;
    if (nip22RootId) {
      const rootMsg = messages.find((m) => m.id === nip22RootId);
      const rest = messages.filter((m) => m.id !== nip22RootId);
      orderedMessages = rootMsg ? [rootMsg, ...rest] : rest;
    }

    // First, group consecutive system messages
    const groupedMessages = groupSystemMessages(orderedMessages);

    const items: Array<
      | { type: "message"; data: Message }
      | { type: "grouped-system"; data: GroupedSystemMessage }
      | { type: "day-marker"; data: string; timestamp: number }
      | { type: "unread-divider" }
    > = [];

    groupedMessages.forEach((item, index) => {
      const timestamp = isGroupedSystemMessage(item)
        ? item.timestamp
        : item.timestamp;

      // Add day marker if this is the first message or if day changed
      // For NIP-22: skip marker before root (index 0), but always add one
      // before the first comment (index 1) to separate it from the root
      const isNip22Root =
        nip22RootId && !isGroupedSystemMessage(item) && item.id === nip22RootId;
      if (isNip22Root) {
        // No day marker before root — KindRenderer shows its own timestamp
      } else if (index === 0 || (nip22RootId && index === 1)) {
        // First message (or first comment after NIP-22 root)
        items.push({
          type: "day-marker",
          data: formatDayMarker(timestamp, locale),
          timestamp,
        });
      } else {
        const prevItem = groupedMessages[index - 1];
        const prevTimestamp = isGroupedSystemMessage(prevItem)
          ? prevItem.timestamp
          : prevItem.timestamp;
        if (isDifferentDay(prevTimestamp, timestamp)) {
          items.push({
            type: "day-marker",
            data: formatDayMarker(timestamp, locale),
            timestamp,
          });
        }
      }

      // Add the message or grouped system message
      if (isGroupedSystemMessage(item)) {
        items.push({ type: "grouped-system", data: item });
      } else {
        // The "New messages" line sits directly ABOVE the first unread message,
        // and below its day marker: the reader is looking for where they left
        // off, not for a second date heading.
        if (dividerMessageId && item.id === dividerMessageId) {
          items.push({ type: "unread-divider" });
        }
        items.push({ type: "message", data: item });
      }
    });

    return items;
  }, [
    messages,
    protocol,
    conversation?.metadata?.commentRootEventId,
    dividerMessageId,
    locale,
  ]);

  /**
   * The offset that keeps a row's Virtuoso identity stable as history is paged
   * in above it — see `prepend-anchor.ts` for why lengths cannot be used.
   *
   * Adjusted DURING RENDER rather than from an effect, which is React's own
   * shape for state derived from changing inputs: an effect would paint the new
   * page at the old offset first, and that one frame is the scroll jump this
   * exists to prevent. The comparison is on array IDENTITY, so a re-render that
   * changed nothing costs one reference check.
   */
  const [anchor, setAnchor] = useState<{
    items: typeof messagesWithMarkers;
    conversationId: string | undefined;
    firstItemIndex: number;
  }>({
    items: messagesWithMarkers,
    conversationId: conversation?.id,
    firstItemIndex: FIRST_ITEM_INDEX_BASE,
  });
  if (
    anchor.items !== messagesWithMarkers ||
    anchor.conversationId !== conversation?.id
  ) {
    // A conversation switch is a different timeline, not a prepend. ChatViewer
    // does NOT remount between conversations — only the Virtuoso does, through
    // the empty-timeline gate below — so this state would otherwise carry one
    // channel's offset into the next.
    const delta =
      anchor.conversationId === conversation?.id
        ? computeFirstItemIndexDelta(anchor.items, messagesWithMarkers)
        : null;
    setAnchor({
      items: messagesWithMarkers,
      conversationId: conversation?.id,
      firstItemIndex:
        delta === null ? FIRST_ITEM_INDEX_BASE : anchor.firstItemIndex - delta,
    });
  }

  // Track reply context (which message is being replied to)
  const [replyTo, setReplyTo] = useState<string | undefined>();
  const replyToRef = useRef<string | undefined>(undefined);
  replyToRef.current = replyTo;

  // State for loading older messages
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  // Ref to Virtuoso for programmatic scrolling; also wires up Home/End
  const { ref: virtuosoRef, onKeyDown: handleFeedKeyDown } = useFeedHomeEnd();

  /**
   * Open every channel at its NEWEST message.
   *
   * The SECOND of two anchors, and they cover different opens.
   *
   * `initialTopMostItemIndex={{ index: "LAST", align: "end" }}` on the list is
   * the first. It is read once at mount, so it lands whenever the history is
   * already in the store — which is every open after the first. Note the
   * `align`: passing a bare NUMBER instead asks Virtuoso to put that index at
   * the TOP, which this layout cannot satisfy, and it answers by leaving the
   * item list `visibility: hidden` with zero rows mounted and never recovering.
   * That is the blank channel. `align: "end"` asks for the same row at the
   * bottom, which is reachable. Never reintroduce the numeric form.
   *
   * This effect is the second, for the FIRST open, where the timeline arrives
   * after mount: the local store first, then each relay's backfill page, each
   * one prepending history that walks the view back up. Debounced until that
   * stops, because anchoring to the end of one piece only gets pushed up by the
   * next. `scrollToIndex` is the same call the End key uses.
   */
  /**
   * Revive a timeline that mounted before its container existed — see
   * `list-revival.ts` for what react-virtuoso does in that case and why nothing
   * recovers on its own.
   *
   * `itemsRendered` is the signal: it fires with the rows the list actually put
   * in the DOM, so zero of them while `messagesWithMarkers` is non-empty is the
   * blank pane exactly. The check is deferred, because zero is also what a
   * healthy list reports for one frame between mounting and measuring.
   */
  const [listKey, setListKey] = useState(0);
  const renderedCount = useRef(0);
  const revivals = useRef(0);
  const revivingFor = useRef<string | undefined>(undefined);
  useEffect(() => {
    const id = conversation?.id;
    if (revivingFor.current !== id) {
      revivingFor.current = id;
      revivals.current = 0;
      // A new conversation has rendered nothing yet. Without this the count
      // left behind by the LAST channel — a healthy 13 — answers for the new
      // one, and a channel that mounts stuck is never seen to be stuck. That
      // is the common way into a blank pane: clicking between channels.
      renderedCount.current = 0;
    }
    const count = messagesWithMarkers.length;
    if (count === 0) return;
    const timer = setTimeout(() => {
      if (!shouldRevive(renderedCount.current, count, revivals.current)) return;
      revivals.current += 1;
      setListKey((k) => k + 1);
    }, REVIVE_AFTER_MS);
    return () => clearTimeout(timer);
  }, [conversation?.id, messagesWithMarkers.length, listKey]);

  const anchoredFor = useRef<string | undefined>(undefined);
  useEffect(() => {
    const id = conversation?.id;
    const count = messagesWithMarkers.length;
    if (!id || count === 0 || anchoredFor.current === id) return;
    const timer = setTimeout(() => {
      anchoredFor.current = id;
      virtuosoRef.current?.scrollToIndex({ index: count - 1, align: "end" });
    }, ANCHOR_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [conversation?.id, messagesWithMarkers.length, virtuosoRef]);

  /**
   * Keep what is half-typed with the channel it was typed in.
   *
   * The composer is ONE tiptap instance shared by every conversation, so
   * without this the text follows the reader into the next channel — where it
   * is either sent to the wrong people or lost when the window closes.
   *
   * The document is mirrored into a ref on every keystroke rather than read out
   * of the editor at save time. The composer unmounts between conversations and
   * React runs a child's cleanup before its parent's, so anything reaching for
   * the editor in the save path would find it already destroyed. Only the
   * WRITE is debounced; the mirror is always current, which is what makes the
   * save-on-switch complete.
   */
  const draftKeyFor = useMemo(
    () =>
      pubkey && conversation
        ? draftKey(pubkey, protocol, conversation.id)
        : undefined,
    [pubkey, protocol, conversation],
  );
  const draftDoc = useRef<{ json: unknown; isEmpty: boolean }>({
    json: undefined,
    isEmpty: true,
  });
  const draftTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const savingDraftFor = useRef<string | undefined>(undefined);

  // What the restore needs to check a stored reply target against, read through
  // a ref so the restore keys on the draft KEY alone: adding the adapter and the
  // conversation object to its deps would re-run the whole restore on every
  // identity change of either.
  const replyResolve = useRef({ adapter, conversation });
  useEffect(() => {
    replyResolve.current = { adapter, conversation };
  });

  const flushDraft = useCallback(() => {
    clearTimeout(draftTimer.current);
    const key = savingDraftFor.current;
    if (!key) return;
    const { json, isEmpty } = draftDoc.current;
    // An emptied composer DELETES the row rather than storing an empty
    // document, so a channel with nothing in it has nothing to restore.
    if (isEmpty || json === undefined) clearDraft(key);
    else writeDraft(key, json, replyToRef.current);
  }, []);

  const handleEditorChange = useCallback(
    (state: { isEmpty: boolean; json: unknown }) => {
      draftDoc.current = state;
      clearTimeout(draftTimer.current);
      draftTimer.current = setTimeout(flushDraft, DRAFT_SAVE_MS);
    },
    [flushDraft],
  );

  useEffect(() => {
    let cancelled = false;
    savingDraftFor.current = draftKeyFor;
    draftDoc.current = { json: undefined, isEmpty: true };

    /**
     * A restored reply target the channel can no longer answer for clears itself.
     *
     * A draft can outlive its parent by days — deleted, or expired under a
     * disappearing timer — and the composer would otherwise come back reading
     * "Replying to 1a2b3c4d…" with every Send refused for a parent that is gone.
     * The text is kept; only the target goes.
     *
     * Cleared only on a definitive "no such message": a thrown lookup is a relay
     * that could not answer, which is no evidence about the parent at all.
     */
    const degradeReply = async (parentId: string) => {
      const { adapter: replyAdapter, conversation: replyIn } =
        replyResolve.current;
      if (!replyIn) return;
      let parent;
      try {
        parent = await replyAdapter.loadReplyMessage(replyIn, { id: parentId });
      } catch (error) {
        console.warn("[Chat] could not check the draft's reply parent:", error);
        return;
      }
      if (parent || cancelled) return;
      // The reader may have picked a different message to reply to while the
      // lookup was out; theirs wins.
      if (replyToRef.current !== undefined && replyToRef.current !== parentId)
        return;
      setReplyTo(undefined);
    };

    if (draftKeyFor) {
      void (async () => {
        // Cold mount: reading before the cache is warm answers "no draft", and
        // the empty composer would then be saved over the real one.
        await draftsReady();
        if (cancelled) return;
        const draft = readDraft(draftKeyFor);
        // Reply context belongs to the channel it was started in — carrying it
        // across would address a message in another channel entirely.
        setReplyTo(draft?.replyToId);
        if (draft?.replyToId) void degradeReply(draft.replyToId);
        if (!draft) return;
        // The composer is mounted a beat after the conversation resolves.
        for (let step = 0; step < 40 && !cancelled; step++) {
          const editor = editorRef.current;
          if (editor) {
            if (shouldRestoreDraft(draft, editor.isEmpty())) {
              editor.setJSON(draft.content);
              draftDoc.current = { json: draft.content, isEmpty: false };
            }
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
      })();
    }
    return () => {
      cancelled = true;
      flushDraft();
      savingDraftFor.current = undefined;
    };
  }, [draftKeyFor, flushDraft]);

  // State for send in progress (prevents double-sends)
  const [isSending, setIsSending] = useState(false);

  // State for tooltip open (for mobile tap support)
  const [tooltipOpen, setTooltipOpen] = useState(false);

  // State for login dialog
  const [showLogin, setShowLogin] = useState(false);

  // Handle sending messages with error handling
  const handleSend = async (
    content: string,
    replyToId?: string,
    emojiTags?: EmojiTag[],
    blobAttachments?: BlobAttachment[],
  ) => {
    if (!conversation || !canSign) return;
    // Already sending: REJECT rather than return. The composer clears
    // optimistically and only puts the text back when the send rejects, so a
    // bare return swallows the attempt AND the text — which is what turned one
    // stuck send into every later one vanishing without a word.
    if (isSending) throw new Error("Still sending the last message.");

    // Check if this is a slash command
    const slashCmd = parseSlashCommand(content);
    if (slashCmd) {
      // Execute action instead of sending message
      setIsSending(true);
      try {
        const result = await adapter.executeAction(slashCmd.command, {
          activePubkey: pubkey!,
          activeSigner: signer!,
          conversation,
        });

        if (result.success) {
          toast.success(result.message || "Action completed");
        } else {
          toast.error(result.message || "Action failed");
        }
      } catch (error) {
        console.error("[Chat] Failed to execute action:", error);
        const errorMessage =
          error instanceof Error ? error.message : "Action failed";
        toast.error(errorMessage);
      } finally {
        setIsSending(false);
        // Clear reply context after slash command execution
        replyToRef.current = undefined;
        setReplyTo(undefined);
      }
      return;
    }

    // Regular message sending
    setIsSending(true);
    try {
      await adapter.sendMessage(conversation, content, {
        replyTo: replyToId,
        emojiTags,
        // The AES-GCM params never enter the editor: they are held by URL from
        // the moment the upload resolves and rejoined here, which is armada's
        // shape too. Losing them makes the blob permanently unreadable, so they
        // travel the shortest path that exists.
        blobAttachments: blobAttachments?.map((blob) => {
          const enc = attachmentEncryption.current.get(blob.url);
          // REFUSE rather than post an unopenable attachment. In Concord the
          // blob is ciphertext and this map holds the only copy of what opens
          // it, so an attachment we cannot pair with its params would be
          // published as a URL that renders as a broken image for everyone,
          // forever, with nothing to recover from. Every other protocol posts
          // plaintext blobs and is unaffected.
          if (!enc && protocol === "concord") {
            throw new Error(
              "Lost the decryption key for that attachment — attach it again.",
            );
          }
          return enc ? { ...blob, ...enc } : blob;
        }),
      });
      // Clear reply context immediately (ref + state) so the next send
      // cannot read a stale value before React re-renders.
      replyToRef.current = undefined;
      setReplyTo(undefined);
    } catch (error) {
      console.error("[Chat] Failed to send message:", error);
      const errorMessage =
        error instanceof Error ? error.message : "Failed to send message";
      toast.error(errorMessage);
      // Don't clear replyTo so user can retry — and rethrow, which is what puts
      // the typed text back in the composer (see MentionEditor's handleSubmit).
      throw error;
    } finally {
      setIsSending(false);
    }
  };

  // Handle command execution from autocomplete
  const handleCommandExecute = useCallback(
    async (action: ChatAction) => {
      if (!conversation || !canSign || isSending) return;

      setIsSending(true);
      try {
        const result = await adapter.executeAction(action.name, {
          activePubkey: pubkey!,
          activeSigner: signer!,
          conversation,
        });

        if (result.success) {
          toast.success(result.message || "Action completed");
        } else {
          toast.error(result.message || "Action failed");
        }
      } catch (error) {
        console.error("[Chat] Failed to execute action:", error);
        const errorMessage =
          error instanceof Error ? error.message : "Action failed";
        toast.error(errorMessage);
      } finally {
        setIsSending(false);
      }
    },
    [conversation, canSign, isSending, adapter, pubkey, signer],
  );

  // Handle reply button click
  const handleReply = useCallback((messageId: string) => {
    setReplyTo(messageId);
    // Focus the editor after context menu closes (next frame)
    requestAnimationFrame(() => {
      editorRef.current?.focus();
    });
  }, []);

  // Where a message sits in the RENDERED array, which is not the message array:
  // day markers, the unread divider and grouped system rows all take a slot.
  const indexOfMessage = useCallback(
    (messageId: string) =>
      messagesWithMarkers.findIndex(
        (item) =>
          (item.type === "message" && item.data.id === messageId) ||
          (item.type === "grouped-system" &&
            item.data.messageIds.includes(messageId)),
      ),
    [messagesWithMarkers],
  );

  // Jumping to a message, paging backwards for it when it is older than what is
  // loaded. Only for protocols whose `loadMoreMessages` repaints the timeline —
  // a NIP-10 thread or a NIP-22 comment set is already whole, so there is
  // nothing to page and a miss stays as quiet as it has always been.
  const canPage = protocol !== "nip-10" && protocol !== "nip-22";
  // `isJumping` is unused while the date entry point is hidden from the header;
  // the jump itself still runs for search hits and reply previews.
  const { jump, flashId } = useJumpToMessage({
    adapter,
    conversation,
    messages,
    canPage,
    virtuosoRef,
    indexOfMessage,
    pageSize: OLDER_PAGE_SIZE,
  });

  // Handle scroll to message (when clicking on reply preview)
  const handleScrollToMessage = useCallback(
    (messageId: string) => {
      void jump({ kind: "id", id: messageId });
    },
    [jump],
  );

  // A jump asked for from OUTSIDE — a search result the reader clicked, which
  // may well be in a channel that was not open a moment ago.
  //
  // Carried as a nonce rather than a bare id: a bare id could not ask for the
  // same message twice, and would re-fire every time the conversation changed.
  //
  // The wait is the whole of this. A resolved conversation is NOT enough to
  // start walking — `use$` publishes its value from an effect, so on the render
  // where `conversation` first exists, `messages` has not been subscribed yet
  // and is still `undefined`. Firing there hands the walk an empty timeline,
  // which it can only give up on (there is no oldest row to page below), and it
  // gives up SILENTLY because nothing was paged. The nonce would be spent on a
  // jump that never looked at anything, which is a search result that never
  // lands — the same for a hit in the channel already open, because the results
  // pane replaces this component and every click arrives at a cold mount.
  //
  // So: wait for the resolved conversation's own first timeline. The messages
  // cannot belong to a previous channel, because `conversation` passes through
  // `null` between identifiers and takes the message stream to `undefined` with
  // it — the same null gap the composer's roster relies on above. An empty
  // timeline is not waited out forever, it is simply never the case for a
  // channel a hit was just found in; a jump left pending by one is dropped by
  // the next channel the reader picks.
  //
  // The freshness check is not ceremony either: that same lag means the render
  // right after the caller switches channel still holds the PREVIOUS channel's
  // conversation. Jumping on that would walk ten pages of the channel the
  // reader just left and tell them the message is unreachable.
  //
  // The row it lands on survives `groupSystemMessages` by construction: only
  // `type: "system"` rows are collapsed, and both chat messages and Concord's
  // tombstones are `type: "user"`. Any future grouping must keep that true, or
  // this jump starts silently no-opping.
  //
  // The ref still earns its place next to `onJumpHandled`: the effect now
  // re-runs on every emission, and the ref is what stops a second walk starting
  // while the first is still paging. The callback is the other half — it is
  // what makes the request stop existing, so a later mount does not honour it
  // again.
  const jumpedNonce = useRef<number | undefined>(undefined);
  const resolvedFor =
    conversationResult?.status === "success"
      ? conversationResult.identifier
      : undefined;
  useEffect(() => {
    if (!jumpTo || !conversation || resolvedFor !== identifier) return;
    if (!messages || messages.length === 0) return;
    if (jumpedNonce.current === jumpTo.nonce) return;
    jumpedNonce.current = jumpTo.nonce;
    const { nonce, messageId } = jumpTo;
    void jump({ kind: "id", id: messageId }).then(() => onJumpHandled?.(nonce));
  }, [
    jumpTo,
    conversation,
    resolvedFor,
    identifier,
    messages,
    jump,
    onJumpHandled,
  ]);

  // Handle loading older messages
  const handleLoadOlder = useCallback(async () => {
    if (!conversation || !messages || messages.length === 0 || isLoadingOlder) {
      return;
    }

    setIsLoadingOlder(true);
    try {
      // Get the timestamp of the oldest message
      const oldestMessage = messages[0];
      const olderMessages = await adapter.loadMoreMessages(
        conversation,
        oldestMessage.timestamp,
      );

      // A short page is the end of the history: nothing deeper to ask for.
      if (olderMessages.length < OLDER_PAGE_SIZE) {
        setHasMore(false);
      }
    } catch (error) {
      console.error("Failed to load older messages:", error);
    } finally {
      setIsLoadingOlder(false);
    }
  }, [conversation, messages, adapter, isLoadingOlder]);

  // Handle NIP badge click
  const handleNipClick = useCallback(() => {
    if (conversation?.protocol === "nip-10") {
      addWindow("nip", { number: 10 });
    } else if (conversation?.protocol === "nip-22") {
      addWindow("nip", { number: 22 });
    } else if (conversation?.protocol === "nip-29") {
      addWindow("nip", { number: 29 });
    } else if (conversation?.protocol === "nip-53") {
      addWindow("nip", { number: 53 });
    } else if (conversation?.protocol === "concord") {
      // Concord is not a NIP, so there is no `nip` window to open — the badge
      // goes to the spec itself. Without this branch the button rendered
      // hover styles and a pointer cursor and did nothing at all.
      window.open(CONCORD_URL, "_blank", "noopener,noreferrer");
    }
  }, [conversation?.protocol, addWindow]);

  // Get live activity metadata if this is a NIP-53 chat (with type guard)
  const liveActivity = isLiveActivityMetadata(
    conversation?.metadata?.liveActivity,
  )
    ? conversation?.metadata?.liveActivity
    : undefined;

  // Derive participants from messages for live activities, NIP-10 threads, and NIP-22 comments
  const derivedParticipants = useMemo(() => {
    // NIP-10 threads and NIP-22 comments: derive from messages with OP first
    if (
      (protocol === "nip-10" || protocol === "nip-22") &&
      messages &&
      conversation
    ) {
      const rootId =
        protocol === "nip-10"
          ? conversation.metadata?.rootEventId
          : conversation.metadata?.commentRootEventId;
      const rootAuthor = rootId
        ? messages.find((m) => m.id === rootId)?.author
        : undefined;

      const participants: { pubkey: string; role: "op" | "member" }[] = [];

      if (rootAuthor) {
        participants.push({ pubkey: rootAuthor, role: "op" });
      }

      const seen = new Set(rootAuthor ? [rootAuthor] : []);
      for (const msg of messages) {
        if (msg.type !== "system" && !seen.has(msg.author)) {
          seen.add(msg.author);
          participants.push({ pubkey: msg.author, role: "member" });
        }
      }

      return participants;
    }

    // Live activities: derive from messages with host first
    if (conversation?.type === "live-chat" && messages) {
      const hostPubkey = liveActivity?.hostPubkey;
      const participants: { pubkey: string; role: "host" | "member" }[] = [];

      // Host always first
      if (hostPubkey) {
        participants.push({ pubkey: hostPubkey, role: "host" });
      }

      // Add other participants from messages (excluding host)
      const seen = new Set(hostPubkey ? [hostPubkey] : []);
      for (const msg of messages) {
        if (msg.type !== "system" && !seen.has(msg.author)) {
          seen.add(msg.author);
          participants.push({ pubkey: msg.author, role: "member" });
        }
      }

      return participants;
    }

    // Other protocols: use static participants from conversation
    return conversation?.participants || [];
  }, [
    protocol,
    conversation?.type,
    conversation?.participants,
    conversation?.metadata?.rootEventId,
    conversation?.metadata?.commentRootEventId,
    messages,
    liveActivity?.hostPubkey,
  ]);

  // Handle loading state
  if (!conversationResult || conversationResult.status === "loading") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
        <Loader2 className="size-6 animate-spin" />
        <span className="text-xs">Loading conversation...</span>
      </div>
    );
  }

  // Handle error state with retry option
  if (conversationResult.status === "error") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground p-4">
        <AlertTriangle className="size-8 text-destructive" />
        <span className="text-center text-sm">{conversationResult.error}</span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setRetryCount((c) => c + 1)}
          className="gap-2"
        >
          <RefreshCw className="size-3" />
          Retry
        </Button>
      </div>
    );
  }

  // At this point conversation is guaranteed to exist
  if (!conversation) {
    return null; // Should never happen, but satisfies TypeScript
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header with conversation info and controls */}
      {/* `h-8` to sit level with the sidebar's search heading beside it. The
          old `py-0.5` made the height depend on whichever control inside was
          tallest, so the two headers lined up only by coincidence — and stopped
          doing so as soon as the search box was empty and this header, rather
          than the results heading, was the thing next to it. */}
      <div className="flex h-8 w-full items-center border-b pl-2 pr-0">
        <div className="flex w-full items-center justify-between gap-3">
          <div className="flex flex-1 min-w-0 items-center gap-2">
            {headerPrefix}
            <TooltipProvider>
              <Tooltip open={tooltipOpen} onOpenChange={setTooltipOpen}>
                <TooltipTrigger asChild>
                  <button
                    className="text-sm font-semibold truncate cursor-help text-left"
                    onClick={() => setTooltipOpen(!tooltipOpen)}
                  >
                    {customTitle || conversation.title}
                  </button>
                </TooltipTrigger>
                <TooltipContent
                  side="bottom"
                  align="start"
                  className="max-w-md p-3"
                >
                  <div className="flex flex-col gap-2">
                    {/* Icon + Name */}
                    <div className="flex items-center gap-2">
                      {conversation.metadata?.icon && (
                        <img
                          src={conversation.metadata.icon}
                          alt=""
                          className="size-6 rounded object-cover flex-shrink-0"
                          onError={(e) => {
                            // Hide image if it fails to load
                            e.currentTarget.style.display = "none";
                          }}
                        />
                      )}
                      <span className="font-semibold">
                        {conversation.title}
                      </span>
                    </div>
                    {/* Description */}
                    {conversation.metadata?.description && (
                      <p className="text-xs opacity-90">
                        {conversation.metadata.description}
                      </p>
                    )}
                    {/* Protocol Type - Clickable */}
                    <div className="flex items-center gap-1.5 text-xs">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleNipClick();
                        }}
                        className="rounded bg-tooltip-foreground/20 px-1.5 py-0.5 font-mono hover:bg-tooltip-foreground/30 transition-colors cursor-pointer"
                      >
                        {conversation.protocol.toUpperCase()}
                      </button>
                      <span className="opacity-60">•</span>
                      {conversation.protocol === "nip-10" ? (
                        <span className="flex items-center gap-1 opacity-80">
                          <FileText className="size-3" />
                          Thread
                        </span>
                      ) : conversation.protocol === "nip-22" ? (
                        <span className="flex items-center gap-1 opacity-80">
                          <MessageSquare className="size-3" />
                          Comments
                        </span>
                      ) : (
                        <span className="capitalize opacity-80">
                          {conversation.type}
                        </span>
                      )}
                    </div>
                    {/* Live Activity Status */}
                    {liveActivity?.status && (
                      <div className="flex items-center gap-1.5 text-xs">
                        <span className="opacity-80">Status:</span>
                        <StatusBadge status={liveActivity.status} size="xs" />
                      </div>
                    )}
                    {/* Host Info */}
                    {liveActivity?.hostPubkey && (
                      <div className="flex items-center gap-1.5 text-xs opacity-80">
                        <span>Host:</span>
                        <UserName
                          pubkey={liveActivity.hostPubkey}
                          className="text-xs"
                        />
                      </div>
                    )}
                  </div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            {/* Copy Chat ID button */}
            {getChatIdentifier(conversation) && (
              <button
                onClick={() => {
                  const chatId = getChatIdentifier(conversation);
                  if (chatId) copyChatId(chatId);
                }}
                className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
                aria-label="Copy chat ID"
              >
                {chatIdCopied ? (
                  <CopyCheck className="size-3.5" />
                ) : (
                  <Copy className="size-3.5" />
                )}
              </button>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground p-1">
            {/* Jump-to-date is hidden from the header: it earned a permanent
                slot next to members and relays without being reached for at
                that rate. `jump({kind:"date"})` and the whole paging walk stay,
                so a date entry point costs one element wherever it belongs. */}
            <MembersDropdown participants={derivedParticipants} />
            <RelaysDropdown conversation={conversation} />
            <button
              onClick={handleNipClick}
              className="rounded bg-muted px-1.5 py-0.5 font-mono hover:bg-muted/80 transition-colors cursor-pointer"
            >
              {conversation.protocol.toUpperCase()}
            </button>
          </div>
        </div>
      </div>

      {/* Message timeline with virtualization */}
      <div className="flex-1 overflow-hidden" onKeyDown={handleFeedKeyDown}>
        {messagesWithMarkers && messagesWithMarkers.length > 0 ? (
          <Virtuoso
            // A remount is the revival: it re-runs `initialTopMostItemIndex`
            // against a container that is laid out by now. Nothing is lost —
            // this only bumps while the list is rendering nothing.
            key={listKey}
            ref={virtuosoRef}
            data={messagesWithMarkers}
            itemsRendered={(items) => {
              renderedCount.current = items.length;
            }}
            firstItemIndex={anchor.firstItemIndex}
            initialTopMostItemIndex={{ index: "LAST", align: "end" }}
            followOutput="smooth"
            alignToBottom
            components={{
              Header: () => {
                // NIP-22 external root header (hashtag, URL, country, etc.)
                if (
                  protocol === "nip-22" &&
                  conversation.metadata?.commentRootType === "external" &&
                  conversation.metadata?.commentRootExternal
                ) {
                  return (
                    <ExternalRootHeader
                      external={conversation.metadata.commentRootExternal}
                      kValue={conversation.metadata.commentRootKind || "web"}
                    />
                  );
                }

                // "Load older" for protocols that support it.
                //
                // Hidden until the timeline is at least a full page deep. A
                // channel holding fewer messages than one page has nothing
                // older by construction, so offering to fetch it is an empty
                // promise the reader can only discover by clicking — and on a
                // quiet channel that button was the ONLY thing in the pane.
                if (
                  hasMore &&
                  messages !== undefined &&
                  messages.length >= OLDER_PAGE_SIZE &&
                  conversationResult.status === "success" &&
                  protocol !== "nip-10" &&
                  protocol !== "nip-22"
                ) {
                  return (
                    <div className="flex justify-center py-2">
                      <Button
                        onClick={handleLoadOlder}
                        disabled={isLoadingOlder}
                        variant="ghost"
                        size="sm"
                      >
                        {isLoadingOlder ? (
                          <>
                            <Loader2 className="size-3 animate-spin" />
                            <span className="text-xs">Loading...</span>
                          </>
                        ) : (
                          "Load older messages"
                        )}
                      </Button>
                    </div>
                  );
                }

                return null;
              },
              Footer: () => <div className="h-1" />,
            }}
            itemContent={(_index, item) => {
              if (item.type === "day-marker") {
                return (
                  <div
                    className="flex justify-center py-2"
                    key={`marker-${item.timestamp}`}
                  >
                    <Label className="text-[10px] text-muted-foreground">
                      {item.data}
                    </Label>
                  </div>
                );
              }

              if (item.type === "unread-divider") {
                return (
                  <div
                    className="flex items-center gap-2 px-3 py-1"
                    key="unread-divider"
                  >
                    <div className="h-px flex-1 bg-destructive/60" />
                    <span className="rounded-sm bg-destructive/15 px-1 text-[10px] font-semibold uppercase tracking-wide text-destructive">
                      New
                    </span>
                  </div>
                );
              }

              if (item.type === "grouped-system") {
                return (
                  <GroupedSystemMessageItem
                    key={item.data.messageIds.join("-")}
                    grouped={item.data}
                  />
                );
              }

              // For NIP-10 threads, check if this is the root message
              const isRootMessage =
                protocol === "nip-10" &&
                conversation.metadata?.rootEventId === item.data.id;

              // NIP-22 root: render with feed KindRenderer (no border)
              const isNip22Root =
                protocol === "nip-22" &&
                item.data.id === conversation.metadata?.commentRootEventId;
              if (isNip22Root && item.data.event) {
                return (
                  <div key={item.data.id}>
                    <div className="[&>*]:border-b-0">
                      <KindRenderer event={item.data.event} />
                    </div>
                    <div className="px-3 pb-2">
                      <MessageReactions
                        messageId={item.data.id}
                        relays={conversationRelays}
                        adapter={adapter}
                        conversation={conversation}
                        reactions={item.data.metadata?.reactions}
                      />
                    </div>
                  </div>
                );
              }

              return (
                <MessageItem
                  key={item.data.id}
                  message={item.data}
                  adapter={adapter}
                  conversation={conversation}
                  onReply={handleReply}
                  canReply={canSign}
                  onScrollToMessage={handleScrollToMessage}
                  isRootMessage={isRootMessage}
                  activePubkey={pubkey}
                  isFlashing={flashId === item.data.id}
                />
              );
            }}
            style={{ height: "100%" }}
          />
        ) : messages === undefined ? (
          // Adapters don't emit until EOSE, so undefined means still loading —
          // not empty.
          <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
            <span className="text-xs">Loading messages...</span>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            No messages yet. Start the conversation!
          </div>
        )}
      </div>

      {/* Message composer - only show if user can sign */}
      {canSign ? (
        <div className="border-t px-2 py-1 pb-0">
          {replyTo && (
            <ComposerReplyPreview
              replyToId={replyTo}
              adapter={adapter}
              conversation={conversation}
              onClear={() => setReplyTo(undefined)}
            />
          )}
          <div className="flex gap-1.5 items-center">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="flex-shrink-0 size-7 text-muted-foreground hover:text-foreground"
                    onClick={() => openUpload()}
                    disabled={isSending}
                  >
                    <Paperclip className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  <p>Attach media</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <MentionEditor
              ref={editorRef}
              placeholder="Type a message..."
              searchProfiles={searchMentions}
              searchEmojis={searchEmojis}
              searchCommands={searchCommands}
              onCommandExecute={handleCommandExecute}
              onChange={handleEditorChange}
              onFilePaste={(files) => {
                // Open upload dialog with pasted files
                openUpload(files);
              }}
              onSubmit={(content, emojiTags, blobAttachments) =>
                content.trim()
                  ? handleSend(
                      content,
                      replyToRef.current,
                      emojiTags,
                      blobAttachments,
                    )
                  : undefined
              }
              className="flex-1 min-w-0"
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="flex-shrink-0 h-7 px-2 text-xs"
              disabled={isSending}
              onClick={() => {
                editorRef.current?.submit();
              }}
            >
              {isSending ? <Loader2 className="size-3 animate-spin" /> : "Send"}
            </Button>
          </div>
          {uploadDialog}
        </div>
      ) : (
        <div className="border-t px-2 py-1 text-center text-sm text-muted-foreground">
          <button
            onClick={() => setShowLogin(true)}
            className="hover:text-foreground transition-colors underline"
          >
            Sign in
          </button>{" "}
          to post
        </div>
      )}

      {/* Login dialog */}
      <LoginDialog open={showLogin} onOpenChange={setShowLogin} />
    </div>
  );
}

/**
 * External root header for NIP-22 comment threads on external identifiers.
 */
function ExternalRootHeader({
  external,
  kValue,
}: {
  external: string;
  kValue: string;
}) {
  const { locale: userLocale } = useLocale();

  // ISO 3166 — locale-aware country/region name with emoji flag
  if (kValue === "iso3166" || external.startsWith("iso3166:")) {
    const code = external.startsWith("iso3166:")
      ? external.slice(8).toUpperCase()
      : external.toUpperCase();

    return (
      <div className="flex items-center gap-2 px-4 py-3">
        <span className="text-2xl flex-shrink-0">{regionToEmoji(code)}</span>
        <span className="text-sm font-medium truncate">
          {getLocalizedRegionName(code, userLocale)}
        </span>
      </div>
    );
  }

  const Icon = getExternalIdentifierIcon(kValue);
  const label = getExternalIdentifierLabel(external, kValue);
  const href = getExternalIdentifierHref(external);

  return (
    <div className="flex items-center gap-2 px-4 py-3">
      <Icon className="size-5 text-muted-foreground flex-shrink-0" />
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-medium hover:underline truncate"
        >
          {label}
        </a>
      ) : (
        <span className="text-sm font-medium truncate">{label}</span>
      )}
    </div>
  );
}

/**
 * Get the appropriate adapter for a protocol
 * Currently NIP-10 (thread chat), NIP-29 (relay-based groups) and NIP-53 (live activity chat) are supported
 * Other protocols will be enabled in future phases
 */
function getAdapter(protocol: ChatProtocol): ChatProtocolAdapter {
  switch (protocol) {
    case "nip-10":
      return new Nip10Adapter();
    case "nip-22":
      return new Nip22Adapter();
    case "nip-29":
      return new Nip29Adapter();
    // case "nip-17":  // Phase 2 - Encrypted DMs (coming soon)
    //   return new Nip17Adapter();
    // case "nip-28":  // Phase 3 - Public channels (coming soon)
    //   return new Nip28Adapter();
    case "nip-53":
      return new Nip53Adapter();
    case "concord":
      return new ConcordAdapter();
    default:
      throw new Error(`Unsupported protocol: ${protocol}`);
  }
}
