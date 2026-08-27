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
  Copy,
  CopyCheck,
  FileText,
  MessageSquare,
  Check,
  CircleCheck,
  CircleDot,
  CircleSlash,
  CircleDashed,
  GitMerge,
  GitPullRequest,
  FileDiff,
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
import { Nip17Adapter } from "@/lib/chat/adapters/nip-17-adapter";
import { useDirectMessages } from "@/hooks/useDirectMessages";
import { DmConsentGate } from "@/components/dm/DmConsentGate";
import { NIPBadge } from "@/components/NIPBadge";
import { Nip53Adapter } from "@/lib/chat/adapters/nip-53-adapter";
import type {
  BlobAttachmentMeta,
  ChatProtocolAdapter,
} from "@/lib/chat/adapters/base-adapter";
import type { Message } from "@/types/chat";
import type { ChatAction } from "@/types/chat-actions";
import { parseSlashCommand } from "@/lib/chat/slash-command-parser";
import {
  groupSystemMessages,
  isGroupedSystemMessage,
  type GroupedSystemMessage,
} from "@/lib/chat/group-system-messages";
import { UserName } from "./nostr/UserName";
import { BotMarker } from "./nostr/BotMarker";
import { RichText } from "./nostr/RichText";
import Timestamp from "./Timestamp";
import { ReplyPreview } from "./chat/ReplyPreview";
import { MembersDropdown } from "./chat/MembersDropdown";
import { RelaysDropdown } from "./chat/RelaysDropdown";
import { MessageReactions } from "./chat/MessageReactions";
import { StatusBadge } from "./live/StatusBadge";
import { ChatMessageContextMenu } from "./chat/ChatMessageContextMenu";
import { PinsHeaderButton, ConcordPinsList } from "./ConcordPinsBar";
import { useNip29Pins } from "@/hooks/useNip29Pins";
import { useAddWindow } from "@/core/state";
import { MessageSessions } from "@/components/agent/MessageSessions";
import { Button } from "./ui/button";
import LoginDialog from "./nostr/LoginDialog";
import type { EmojiTag, BlobAttachment } from "./editor/MentionEditor";
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
import {
  computeFirstItemIndexDelta,
  FIRST_ITEM_INDEX_BASE,
} from "./chat/prepend-anchor";
import { usePaintedContainer } from "./chat/use-painted-container";
import { timelineState } from "./chat/timeline-state";
import { draftKey } from "@/services/chat-drafts";
import { mentionsPubkey } from "@/lib/chat/mentions";
import { ChatComposer, type ChatComposerHandle } from "./chat/ChatComposer";
import {
  countThreadUnread,
  foldThreads,
  type ThreadSummary,
} from "@/lib/chat/threads";
import { ThreadPane, THREAD_PANE_DEFAULT_WIDTH } from "./chat/ThreadPane";
import { layoutThreadPane } from "./chat/thread-pane-layout";
import { useMeasuredWidth } from "@/hooks/useMeasuredWidth";
import { MessageActivity } from "./chat/MessageActivity";
import { useSettings } from "@/hooks/useSettings";
import { cn } from "@/lib/utils";

interface ChatViewerProps {
  protocol: ChatProtocol;
  identifier: ProtocolIdentifier;
  customTitle?: string;
  /** Optional content to render before the title (e.g., sidebar toggle on mobile) */
  headerPrefix?: React.ReactNode;
  /** Optional control in the header's right-hand group (e.g. a pin count). */
  headerExtra?: React.ReactNode;
  /** Optional panel between the header and the timeline (e.g. the pin list). */
  belowHeader?: React.ReactNode;
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

  // NIP-17 DMs, NIP-22 comments and NIP-10 threads: relays from metadata.
  //
  // For a DM that is BOTH parties' inboxes — yours is where their reply lands
  // and theirs is where your message goes, and a reader deciding whether a
  // message will arrive needs to see both. It discloses nothing: this is the
  // reader's own view of their own conversation, and the privacy rule that
  // matters is the one about never NAMING these relays in a query.
  if (
    conversation.protocol === "nip-17" ||
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
/**
 * One icon per verb, so a glance separates a merge from a close without
 * reading. Keyed on the action string `gitActivityRows` writes.
 */
const GIT_ACTION_ICONS: Record<string, typeof GitPullRequest> = {
  "opened issue": CircleDot,
  "sent a patch": FileDiff,
  "opened a pull request": GitPullRequest,
  opened: CircleDot,
  resolved: CircleCheck,
  merged: GitMerge,
  closed: CircleSlash,
  "marked as draft": CircleDashed,
};

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
  isPinned,
  canManagePins,
  onTogglePin,
  thread,
  threadUnread,
  onOpenThread,
  onCloseThread,
  threadActive,
  activityView,
  inThreadRootId,
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
  /** Whether this message is in the group's pin list (NIP-29 only). */
  isPinned?: boolean;
  /** Whether the viewer may pin/unpin — an admin or moderator of this group. */
  canManagePins?: boolean;
  onTogglePin?: (messageId: string) => void;
  /** The replies folded under this message, when it has any. */
  thread?: ThreadSummary;
  /** How many of those replies the reader has not seen. */
  threadUnread?: number;
  onOpenThread?: (rootId: string) => void;
  /** Closes it — the row that opened the pane is also the way back out. */
  onCloseThread?: () => void;
  /** Whether the pane is already showing this message's thread. */
  threadActive?: boolean;
  /**
   * How the follow-on activity under this message is drawn.
   *
   * `"merged"` is the channel: replies and runs on one line, opening the thread.
   * `"sessions"` is inside the pane, where the thread is already open and every
   * run gets its own row — the only place a second session is reachable, since
   * the merged row speaks for one.
   */
  activityView?: "merged" | "sessions";
  /**
   * The thread this row is being rendered INSIDE, if any.
   *
   * Suppresses the quote block: in a thread pane the parent is the row at the
   * top of the same column, so quoting it under every reply repeats the same two
   * lines down the whole thread. A reply to another reply still quotes, because
   * that one is not obvious from position.
   */
  inThreadRootId?: string;
}) {
  const addWindow = useAddWindow();
  // Get relays for this conversation (memoized to prevent unnecessary re-subscriptions)
  const relays = useMemo(
    () => getConversationRelays(conversation),
    [conversation],
  );

  // Sat amounts are numbers, so they answer to the reader's locale.
  const { locale } = useLocale();

  // Whether this message names the reader. Protocol-generic: NIP-29's factory
  // emits the same `p` tag Concord now sends.
  //
  // Except in a direct message, where the predicate is vacuously true: NIP-17
  // p-tags every recipient on every message, so the highlight would mark the
  // entire conversation. A room where everything is a mention has no mentions.
  const mentionsMe =
    conversation?.protocol !== "nip-17" &&
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

  // Inside a thread, the root sits at the top of the same column.
  const quotesItsOwnThreadRoot =
    !!inThreadRootId && replyEventId === inThreadRootId;

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

  // Public git activity in a Concord channel attached to a repository. As
  // quiet as a system row and shaped like one — a line of muted text the eye
  // passes over — except the subject, which is the one thing on the row worth
  // clicking and so the one thing that carries colour.
  if (message.metadata?.git) {
    const { action, subject, pointer } = message.metadata.git;
    const Icon = GIT_ACTION_ICONS[action] ?? GitPullRequest;
    return (
      <div className="flex items-center gap-1 px-3 py-1 text-xs text-muted-foreground">
        <Icon className="size-3 shrink-0" />
        {/* Who did it never shrinks. `UserName` hides its own overflow, which
            makes it a flex item that can collapse to nothing — and a row
            reading "ver… sent a patch" loses the only part that is about a
            person. The subject is the long half and the half that can afford
            an ellipsis, since clicking it opens the thing in full. Capped all
            the same: a pathological display name must not leave a narrow pane
            with no room for the subject at all. */}
        <UserName
          pubkey={message.author}
          className="max-w-32 shrink-0 text-xs"
        />
        <span className="shrink-0">{action}</span>
        {subject && (
          <button
            type="button"
            onClick={() => addWindow("open", { pointer })}
            className="min-w-0 truncate text-left font-medium text-primary hover:underline"
          >
            {subject}
          </button>
        )}
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

    // Show the reply preview whenever the zap names a target, unless the target
    // resolves to something that is not a chat message. A sealed protocol's
    // target is never in the shared EventStore — its id is a rumor id — so
    // requiring it there would hide what every private zap was paid for.
    // `ReplyPreview` resolves those through `adapter.loadReplyMessage`, exactly
    // as the ordinary message path above does.
    const shouldShowReplyPreview =
      zapReplyPointer &&
      (!replyEvent ||
        (CHAT_KINDS as readonly number[]).includes(replyEvent.kind));

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
                {(message.metadata?.zapAmount || 0).toLocaleString(locale, {
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
          {/* A NIP-04 message hid its content and nothing else — who it was
              between and when was plain on a public event. Saying so is the
              difference between showing history and quietly claiming it had a
              guarantee it never had. Named for the NIP rather than "legacy",
              and clickable, so the caveat is one click away instead of a
              tooltip nobody hovers. */}
          {message.metadata?.legacy && (
            <NIPBadge
              nipNumber="04"
              size="sm"
              showName={false}
              className="shrink-0"
            />
          )}
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
              {message.replyTo &&
                isChatKindReply &&
                !quotesItsOwnThreadRoot && (
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
          {/* What came of this message: the replies folded under it and the runs
              it set going, on one line. Renders nothing at all for the vast
              majority of messages, which started nothing and got no reply.
              `MessageActivity` for the channel, where one line is the budget;
              the pane lists every run separately, because there it has room and
              a second session needs its own way in. */}
          {activityView === "sessions" ? (
            <MessageSessions messageId={message.id} />
          ) : (
            <MessageActivity
              messageId={message.id}
              thread={thread}
              unread={threadUnread}
              active={threadActive}
              onOpenThread={onOpenThread}
              onCloseThread={onCloseThread}
              onOpenSession={(agent, session) =>
                addWindow("agent", { agent, session })
              }
            />
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
        isPinned={isPinned}
        canPin={canManagePins}
        onTogglePin={onTogglePin ? () => onTogglePin(message.id) : undefined}
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
  headerExtra,
  belowHeader,
  jumpTo,
  onJumpHandled,
}: ChatViewerProps) {
  const addWindow = useAddWindow();

  // Get active account with signing capability
  const { pubkey, canSign, signer } = useAccount();

  // Private messages are gated on the reader asking for their inbox to be
  // opened — see DmConsentGate. Inert for every other protocol.
  const dms = useDirectMessages({ enabled: protocol === "nip-17" });

  // Day markers are dates, so they answer to the reader's calendar.
  const { locale } = useLocale();

  // Profile search for mentions
  const { searchProfiles } = useProfileSearch();

  // Emoji search for custom emoji autocomplete
  const { searchEmojis } = useEmojiSearch();

  // Copy chat identifier to clipboard
  const { copy: copyChatId, copied: chatIdCopied } = useCopy();

  /**
   * The channel composer's focus, so "Reply" can put the cursor in it.
   *
   * A handle rather than the editor's own ref: there are two composers now and
   * each owns its editor, upload dialog and draft (`ChatComposer`). This one is
   * the channel's, which is the only one anything outside a composer aims at.
   */
  const channelComposer = useRef<ChatComposerHandle | null>(null);
  /** The same, for the thread pane's composer — Reply focuses whichever is used. */
  const threadComposer = useRef<ChatComposerHandle | null>(null);

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

  /**
   * Whether this room takes text messages. Only a NIP-29 group ever says no,
   * and only by listing `supported_kinds` that omit kind 9.
   */
  const acceptsMessages = conversation?.metadata?.acceptsMessages;

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

  const { settings } = useSettings();
  const collapseThreads = settings?.appearance?.collapseThreads ?? true;

  /**
   * Replies folded out of the timeline and into threads.
   *
   * Before the read marker, because the divider has to be placed over the rows
   * that will actually be RENDERED. Three other things read it too: the jump (a
   * target may no longer have a row), the summary rows, and the pane.
   *
   * `conversationRootId` is what keeps a conversation that IS a thread flat —
   * NIP-10 and NIP-22 timelines are entirely replies to one event, and folding
   * those would hide the whole channel. See `foldThreads`.
   */
  const conversationRootId =
    conversation?.metadata?.rootEventId ??
    conversation?.metadata?.commentRootEventId;

  /**
   * Whether a thread can form under a message here at all.
   *
   * An event-rooted conversation cannot host one, and the reason is in the
   * adapters rather than here: NIP-10 stamps every reply's `threadRoot` as the
   * conversation root (`nip-10-adapter.ts`), and NIP-22's `CommentFactory`
   * inherits the parent's root scope verbatim, so a reply to a reply names the
   * article. `foldThreads` then correctly refuses to fold it — the conversation IS
   * the thread — and a reply typed into a pane would land in the channel while the
   * pane went on reading "0 replies".
   *
   * So the affordance is not offered. A NIP-22 view on an addressable or external
   * root has no event root, threads there DO form, and it keeps them.
   */
  const canThread = conversationRootId === undefined;

  const folded = useMemo(
    () =>
      foldThreads(messages ?? [], {
        conversationRootId,
        collapse: collapseThreads && canThread,
      }),
    [messages, conversationRootId, collapseThreads, canThread],
  );

  // Where the "New messages" line goes, and — once the pre-visit stamp has been
  // captured — moving that stamp forward as the reader sits here. Inert for any
  // protocol whose adapter keeps no read state.
  //
  // Both arrays matter and they are not the same one: the stamp is taken over
  // every message, including replies with no row of their own, because a stamp
  // that could not cover them would leave a badge nothing can clear. The line
  // itself is placed over the rendered rows, because a divider pointing at a
  // folded reply simply does not appear.
  const { dividerId: dividerMessageId, lastRead } = useReadMarker(
    adapter,
    conversation ?? undefined,
    messages,
    pubkey,
    folded.rows,
  );

  /**
   * Unread replies per thread — what the channel divider can no longer say.
   *
   * A reply inside a collapsed thread still moves the channel's badge, and the
   * divider is measured over rows that reply is not among, so without this the
   * badge names something the reader has no way to find. Measured against the
   * SAME frozen stamp the divider uses, so the two cannot disagree.
   */
  const threadUnread = useMemo(
    () =>
      lastRead === undefined || !messages
        ? undefined
        : countThreadUnread(folded.threads, messages, lastRead, pubkey),
    [folded, messages, lastRead, pubkey],
  );

  // Process messages to include day markers and group system messages
  const messagesWithMarkers = useMemo(() => {
    if (!messages || messages.length === 0) return [];

    // For NIP-22, ensure root event is always first regardless of timestamp
    let orderedMessages = folded.rows;
    const nip22RootId =
      protocol === "nip-22"
        ? conversation?.metadata?.commentRootEventId
        : undefined;
    if (nip22RootId) {
      const rootMsg = folded.rows.find((m) => m.id === nip22RootId);
      const rest = folded.rows.filter((m) => m.id !== nip22RootId);
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
    folded,
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

  /**
   * Which thread the pane is showing, by root id.
   *
   * Stored WITH the conversation it belongs to and derived back out, rather than
   * cleared from an effect on conversation change: ChatViewer does not remount
   * between conversations, so an effect is the only other way to stop one
   * channel's thread reopening over the next — and it would paint the wrong pane
   * for a frame first. The same reasoning as the Virtuoso anchor above.
   *
   * A root that has left the loaded window needs no clearing at all: `threadView`
   * resolves through `messages` and the pane is gated on it, so the id simply
   * stops naming anything until the row pages back in.
   */
  const [openThread, setOpenThread] = useState<{
    conversationId?: string;
    rootId?: string;
  }>({});
  const [threadWidth, setThreadWidth] = useState(THREAD_PANE_DEFAULT_WIDTH);

  /**
   * This chat WINDOW's width, so the pane can decide between a column and taking
   * the whole window.
   *
   * A viewport media query is the wrong instrument here: these windows are tiled,
   * so one can be 300px wide on a large display and `matchMedia` would still
   * report a desktop. Observed rather than measured once — a mosaic split resizes
   * its tiles continuously as the divider is dragged.
   */
  const [windowBox, windowWidth] = useMeasuredWidth();
  const threadRootId =
    openThread.conversationId === conversation?.id
      ? openThread.rootId
      : undefined;
  const conversationId = conversation?.id;
  const showThread = useCallback(
    (rootId: string) => setOpenThread({ conversationId, rootId }),
    [conversationId],
  );
  const closeThread = useCallback(() => setOpenThread({}), []);

  /**
   * Which message in the thread the pane's composer is answering.
   *
   * Undefined means the thread itself, which is the default and the common case.
   * Picking a particular reply is worth having anyway: the fold flattens a thread
   * on READ, so a reply naming its real parent still lands in the same thread —
   * the wire keeps who was answered, and the pane keeps its one level.
   *
   * Stored with the thread it belongs to and derived back out, like the open
   * thread above: a target left over from another thread would answer a message
   * the reader is no longer looking at.
   */
  const [threadReply, setThreadReply] = useState<{
    rootId?: string;
    messageId?: string;
  }>({});
  const threadReplyTo =
    threadReply.rootId === threadRootId ? threadReply.messageId : undefined;
  const replyInThread = useCallback(
    (messageId: string | undefined) =>
      setThreadReply({ rootId: threadRootId, messageId }),
    [threadRootId],
  );

  /**
   * What the pane shows: the root and its replies, from the same timeline the
   * channel is reading.
   *
   * No separate REQ. Every reply this can show is already in the window the
   * adapter loaded — the standing `#h` subscription for NIP-29, the local mirror
   * for Concord and NIP-17 — so opening a thread costs nothing and fetches
   * nothing. The cost is that a thread whose replies are older than the window
   * fills in as history pages, rather than on open.
   */
  const threadView = useMemo(() => {
    if (!threadRootId || !messages) return undefined;
    const root = messages.find((m) => m.id === threadRootId);
    if (!root) return undefined;
    const replyIds = new Set(folded.threads.get(threadRootId)?.replyIds ?? []);
    return { root, replies: messages.filter((m) => replyIds.has(m.id)) };
  }, [threadRootId, messages, folded]);

  // State for loading older messages
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  // Ref to Virtuoso for programmatic scrolling; also wires up Home/End
  const { ref: virtuosoRef, onKeyDown: handleFeedKeyDown } = useFeedHomeEnd();

  // Re-armed per conversation AND per emptiness: the list unmounts whenever the
  // timeline has nothing, so both are ways it mounts afresh.
  const { ref: timelineBox, painted } = usePaintedContainer<HTMLDivElement>(
    `${conversation?.id ?? ""}:${messagesWithMarkers.length > 0}`,
  );

  // The list, a wait, or nothing — and never "nothing" while the gate above is
  // still shut. See `chat/timeline-state.ts`.
  const timeline = timelineState({
    messages,
    rows: messagesWithMarkers.length,
    painted,
  });

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
   * Where this channel's half-typed message is kept.
   *
   * The composer is one tiptap instance shared by every conversation this window
   * shows, so without a key per channel the text follows the reader into the
   * next one — where it is either sent to the wrong people or lost when the
   * window closes. `ChatComposer` owns the saving; this only names the row, and
   * the thread pane derives its own key from it.
   */
  const draftKeyFor = useMemo(
    () =>
      pubkey && conversation
        ? draftKey(pubkey, protocol, conversation.id)
        : undefined,
    [pubkey, protocol, conversation],
  );

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

    /**
     * Clear the composer's reply context — but only if this send is the one it
     * was pointing at.
     *
     * The thread pane sends through here too, always targeting its own root, and
     * clearing unconditionally would drop the reply target out from under the
     * channel composer while the reader still had text sitting in it: their next
     * Send would go as a plain message with no sign anything changed.
     */
    const ownsChannelReply = replyToId === replyToRef.current;
    const clearSentReply = () => {
      if (ownsChannelReply) {
        replyToRef.current = undefined;
        setReplyTo(undefined);
      }
      /**
       * And the same for the thread pane, which picks its own target: a send
       * answering one particular reply has to drop it, or the pane goes on
       * quoting a message the reader already answered.
       *
       * Tested inside the updater rather than against a value captured when the
       * send started — that value can be a render old by the time an await
       * returns, and no ref is needed to ask the question at commit time.
       */
      setThreadReply((prev) =>
        replyToId !== undefined && prev.messageId === replyToId
          ? { ...prev, messageId: undefined }
          : prev,
      );
    };

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
        clearSentReply();
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
      clearSentReply();
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

  /**
   * Reply to a message. One action — the thread is implicit.
   *
   * Where threads are folded, answering a message IS its thread, so Reply opens
   * the pane on it and aims the pane's composer there. There was briefly a second
   * "Reply in thread" beside this, and it was a distinction without a difference:
   * both wrote the same tag, and the reader had to know which one put the answer
   * where they could see it.
   *
   * Where threads are NOT folded — the setting off, or a conversation that IS a
   * thread and cannot host one (`canThread`) — it stays what it always was: the
   * channel composer, with the message quoted above it.
   */
  const handleReply = useCallback(
    (messageId: string) => {
      if (canThread && collapseThreads) {
        showThread(messageId);
        // The target is the thread's own root, which is the default, so nothing
        // to set — and clearing keeps a target from a previous thread out.
        setThreadReply({});
        requestAnimationFrame(() => threadComposer.current?.focus());
        return;
      }
      setReplyTo(messageId);
      // Focus the editor after context menu closes (next frame)
      requestAnimationFrame(() => channelComposer.current?.focus());
    },
    [canThread, collapseThreads, showThread],
  );

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

  /**
   * Show the reader a message, wherever it now lives.
   *
   * A folded reply has no row to scroll to, and `useJumpToMessage` answers that
   * by paging history for a row that will never appear and then giving up
   * silently. So a target that was folded away opens its thread instead, and the
   * scroll lands on the root — which is the row that IS on screen.
   */
  const revealMessage = useCallback(
    (messageId: string) => {
      const rootId = folded.replyToRoot.get(messageId);
      if (rootId) {
        showThread(rootId);
        return jump({ kind: "id", id: rootId });
      }
      return jump({ kind: "id", id: messageId });
    },
    [folded, jump, showThread],
  );

  // Handle scroll to message (when clicking on reply preview)
  const handleScrollToMessage = useCallback(
    (messageId: string) => {
      void revealMessage(messageId);
    },
    [revealMessage],
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
    void revealMessage(messageId).then(() => onJumpHandled?.(nonce));
  }, [
    jumpTo,
    conversation,
    resolvedFor,
    identifier,
    messages,
    revealMessage,
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
    } else if (conversation?.protocol === "nip-17") {
      addWindow("nip", { number: 17 });
    } else if (conversation?.protocol === "concord") {
      // Concord is not a NIP, so there is no `nip` window to open — the badge
      // goes to the spec itself. Without this branch the button rendered
      // hover styles and a pointer cursor and did nothing at all.
      window.open(CONCORD_URL, "_blank", "noopener,noreferrer");
    }
  }, [conversation?.protocol, addWindow]);

  /**
   * A NIP-29 group's pin list (`kind:39005`), rendered with the same UI
   * Concord uses for its own pins (§7) — see `useNip29Pins` for why a plain
   * reference costs nothing to share that UI with a sealed one.
   *
   * Undefined group id/relay for every other protocol, which the hook reads
   * as "nothing to watch".
   */
  const nip29GroupId =
    protocol === "nip-29" ? conversation?.metadata?.groupId : undefined;
  const nip29RelayUrl =
    protocol === "nip-29" ? conversation?.metadata?.relayUrl : undefined;
  const nip29Pins = useNip29Pins(nip29GroupId, nip29RelayUrl);
  const [showGroupPins, setShowGroupPins] = useState(false);
  const nip29PinnedIds = useMemo(
    () => new Set(nip29Pins.pins.map((pin) => pin.rumorId)),
    [nip29Pins.pins],
  );

  // Pinning is a moderation action (kind 9010): gated the same way the relay
  // itself will enforce it, on the reader's OWN role in this group.
  const canManageGroupPins =
    protocol === "nip-29" &&
    !!pubkey &&
    !!conversation?.participants.some(
      (participant) =>
        participant.pubkey === pubkey &&
        (participant.role === "admin" || participant.role === "moderator"),
    );

  const handleTogglePin = useCallback(
    async (messageId: string) => {
      if (!conversation || !adapter.pinMessage || !adapter.unpinMessage) {
        return;
      }
      try {
        if (nip29PinnedIds.has(messageId)) {
          await adapter.unpinMessage(conversation, messageId);
        } else {
          await adapter.pinMessage(conversation, messageId);
        }
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Could not update pins",
        );
      }
    },
    [adapter, conversation, nip29PinnedIds],
  );

  /**
   * The other person in a 1:1 DM, when there is exactly one.
   *
   * NIP-17 only, and only for two participants: a group DM's heading names
   * several people, and one of their flags would say something false about the
   * rest.
   */
  const dmOthers =
    conversation?.protocol === "nip-17" && pubkey
      ? (conversation.participants ?? [])
          .map((participant) => participant.pubkey)
          .filter((candidate) => candidate !== pubkey)
      : [];
  const dmPeer = dmOthers.length === 1 ? dmOthers[0] : undefined;

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

  // Before anything else for a DM: without a signer that can decrypt, and
  // without the reader having asked, there is no conversation to resolve — and
  // `resolveConversation` would throw into the error branch, which reads as a
  // failure rather than a question.
  if (protocol === "nip-17" && dms.status !== "ready") {
    return <DmConsentGate status={dms.status} onGrant={dms.grantConsent} />;
  }

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

  // Same clamp `ThreadPane` draws from, so the conversation hides on exactly
  // the width where the pane stops being a column beside it and becomes the
  // window's only content — never on a separate guess that could disagree.
  const threadCollapsed =
    !!threadView && layoutThreadPane(windowWidth, threadWidth).collapsed;

  return (
    <div ref={windowBox} className="flex h-full min-w-0">
      {/* The conversation. `min-w-0` so the pane beside it takes its width from
          its own style rather than from whatever the longest message is.
          Hidden, not unmounted, when the thread has taken over a too-narrow
          window — back returns to it exactly as it was left, draft and scroll
          position included. */}
      <div
        className={cn(
          "flex h-full min-w-0 flex-1 flex-col",
          threadCollapsed && "hidden",
        )}
      >
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
              {/* Says the counterpart is automation, from their kind 0. A DM
                heading is where someone decides how much to trust an answer. */}
              <BotMarker pubkey={dmPeer} className="w-4 h-4" />
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
              {headerExtra}
              {protocol === "nip-29" && (
                <PinsHeaderButton
                  count={nip29Pins.pins.length}
                  unavailable={false}
                  open={showGroupPins}
                  onToggle={() => setShowGroupPins((v) => !v)}
                />
              )}
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

        {protocol === "nip-29" && showGroupPins ? (
          <ConcordPinsList
            pins={nip29Pins.pins}
            onOpen={(id) => {
              handleScrollToMessage(id);
              setShowGroupPins(false);
            }}
          />
        ) : (
          belowHeader
        )}

        {/* Message timeline with virtualization */}
        <div
          ref={timelineBox}
          className="flex-1 overflow-hidden"
          onKeyDown={handleFeedKeyDown}
        >
          {/* Not mounted until the pane can be measured in a painting document —
            `use-painted-container.ts` for what mounting early does to a list
            that opens itself at the newest message, and `timeline-state.ts` for
            why waiting behind that gate is not the same as having nothing. */}
          {timeline === "list" ? (
            <Virtuoso
              ref={virtuosoRef}
              data={messagesWithMarkers}
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
                    isPinned={
                      protocol === "nip-29"
                        ? nip29PinnedIds.has(item.data.id)
                        : undefined
                    }
                    canManagePins={canManageGroupPins}
                    onTogglePin={
                      canManageGroupPins ? handleTogglePin : undefined
                    }
                    thread={folded.threads.get(item.data.id)}
                    threadUnread={threadUnread?.get(item.data.id)}
                    onOpenThread={showThread}
                    onCloseThread={closeThread}
                    threadActive={threadRootId === item.data.id}
                  />
                );
              }}
              style={{ height: "100%" }}
            />
          ) : timeline === "waiting" ? (
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

        {/* Message composer - only show if user can sign, and only where the room
          takes messages at all. An AV-only NIP-29 space says so in its
          `supported_kinds`, and a box whose every send the relay rejects is
          worse than no box. */}
        {acceptsMessages === false ? (
          <div className="border-t px-2 py-1 text-center text-sm text-muted-foreground">
            This space carries live audio and video, not messages.
          </div>
        ) : canSign ? (
          <ChatComposer
            adapter={adapter}
            conversation={conversation}
            protocol={protocol}
            placeholder="Type a message..."
            draftKey={draftKeyFor}
            replyTo={replyTo}
            onReplyToChange={setReplyTo}
            onSend={handleSend}
            isSending={isSending}
            attachmentEncryption={attachmentEncryption}
            searchProfiles={searchMentions}
            searchEmojis={searchEmojis}
            searchCommands={searchCommands}
            onCommandExecute={handleCommandExecute}
            handleRef={channelComposer}
          />
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

      {threadView && (
        <ThreadPane
          count={threadView.replies.length}
          onClose={closeThread}
          windowWidth={windowWidth}
          width={threadWidth}
          onWidthChange={setThreadWidth}
          root={
            <MessageItem
              message={threadView.root}
              adapter={adapter}
              conversation={conversation}
              canReply={canSign}
              onReply={replyInThread}
              activePubkey={pubkey}
              activityView="sessions"
            />
          }
          replies={threadView.replies.map((reply) => (
            <MessageItem
              key={reply.id}
              message={reply}
              adapter={adapter}
              conversation={conversation}
              // Answerable, one by one. The fold flattens a thread on READ, so a
              // reply naming its real parent still lands in this same thread —
              // the wire keeps who was answered and the pane keeps one level.
              canReply={canSign}
              onReply={replyInThread}
              activePubkey={pubkey}
              isFlashing={flashId === reply.id}
              inThreadRootId={threadView.root.id}
              activityView="sessions"
            />
          ))}
          composer={
            canSign && acceptsMessages !== false ? (
              <ChatComposer
                adapter={adapter}
                conversation={conversation}
                protocol={protocol}
                placeholder="Reply in thread..."
                // Its own draft row, so a half-typed reply and a half-typed
                // channel message cannot overwrite each other. Nothing parses
                // this key, and logout deletes on the account prefix, so the
                // suffix costs nothing (`chat-drafts.ts`).
                draftKey={
                  draftKeyFor
                    ? `${draftKeyFor}#thread:${threadView.root.id}`
                    : undefined
                }
                // The thread itself by default, or whichever message in it the
                // reader picked. `onReplyToChange` only once they have picked:
                // its absence is what keeps the banner off the common case,
                // where the target is the thread the pane is already showing.
                replyTo={threadReplyTo ?? threadView.root.id}
                onReplyToChange={
                  threadReplyTo ? () => replyInThread(undefined) : undefined
                }
                onSend={handleSend}
                isSending={isSending}
                attachmentEncryption={attachmentEncryption}
                searchProfiles={searchMentions}
                searchEmojis={searchEmojis}
                searchCommands={searchCommands}
                onCommandExecute={handleCommandExecute}
                handleRef={threadComposer}
              />
            ) : undefined
          }
        />
      )}
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
    case "nip-17":
      return new Nip17Adapter();
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
