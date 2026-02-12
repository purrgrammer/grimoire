import type { ReactNode } from "react";
import { RichText } from "../RichText";
import { BaseEventContainer, type BaseEventProps } from "./BaseEventRenderer";
import {
  getCommentReplyPointer,
  isCommentAddressPointer,
  isCommentEventPointer,
  type CommentPointer,
} from "applesauce-common/helpers/comment";
import { useNostrEvent } from "@/hooks/useNostrEvent";
import { UserName } from "../UserName";
import { Reply, type LucideIcon } from "lucide-react";
import { useGrimoire } from "@/core/state";
import { InlineReplySkeleton } from "@/components/ui/skeleton";
import { KindBadge } from "@/components/KindBadge";
import { getKindInfo } from "@/constants/kinds";
import { getEventDisplayTitle } from "@/lib/event-title";
import type { NostrEvent } from "@/types/nostr";
import {
  getCommentRootScope,
  isTopLevelComment,
  getExternalIdentifierIcon,
  getExternalIdentifierLabel,
  type CommentRootScope,
  type CommentScope,
} from "@/lib/nip22-helpers";

/**
 * Convert CommentPointer to pointer format for useNostrEvent
 */
function convertCommentPointer(
  commentPointer: CommentPointer | null,
):
  | { id: string; relays?: string[] }
  | { kind: number; pubkey: string; identifier: string; relays?: string[] }
  | undefined {
  if (!commentPointer) return undefined;

  if (isCommentEventPointer(commentPointer)) {
    return {
      id: commentPointer.id,
      relays: commentPointer.relay ? [commentPointer.relay] : undefined,
    };
  } else if (isCommentAddressPointer(commentPointer)) {
    return {
      kind: commentPointer.kind,
      pubkey: commentPointer.pubkey,
      identifier: commentPointer.identifier,
      relays: commentPointer.relay ? [commentPointer.relay] : undefined,
    };
  }
  return undefined;
}

/**
 * Convert a CommentScope to a useNostrEvent-compatible pointer.
 * Event and address scopes already carry EventPointer/AddressPointer fields
 * from applesauce helpers, so we just strip the discriminant.
 */
function scopeToPointer(
  scope: CommentScope,
):
  | { id: string; relays?: string[] }
  | { kind: number; pubkey: string; identifier: string; relays?: string[] }
  | undefined {
  if (scope.type === "event") {
    const { type: _, ...pointer } = scope;
    return pointer;
  }
  if (scope.type === "address") {
    const { type: _, ...pointer } = scope;
    return pointer;
  }
  return undefined;
}

function getKindIcon(kind: number): LucideIcon {
  const info = getKindInfo(kind);
  return info?.icon || Reply;
}

/**
 * Uniform inline scope row — icon + label text.
 * Used for both root scope and parent reply, regardless of Nostr event or external identifier.
 */
function ScopeRow({
  icon: Icon,
  label,
  onClick,
  href,
}: {
  icon: LucideIcon;
  label: ReactNode;
  onClick?: () => void;
  href?: string;
}) {
  const className =
    "flex items-center gap-1.5 text-xs text-muted-foreground overflow-hidden min-w-0" +
    (onClick
      ? " cursor-crosshair hover:text-foreground transition-colors"
      : "");

  const inner = (
    <>
      <Icon className="size-3 flex-shrink-0" />
      <span className="truncate min-w-0">{label}</span>
    </>
  );

  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={className + " hover:text-foreground transition-colors"}
      >
        {inner}
      </a>
    );
  }

  return (
    <div className={className} onClick={onClick}>
      {inner}
    </div>
  );
}

/**
 * Builds the label ReactNode for a loaded Nostr event scope row.
 */
function NostrEventLabel({ nostrEvent }: { nostrEvent: NostrEvent }) {
  const title = getEventDisplayTitle(nostrEvent, false);
  return (
    <>
      <KindBadge
        kind={nostrEvent.kind}
        variant="compact"
        iconClassname="size-3 text-muted-foreground"
      />
      <UserName
        pubkey={nostrEvent.pubkey}
        className="text-accent font-semibold flex-shrink-0"
      />
      <span className="truncate min-w-0">
        {title || nostrEvent.content.slice(0, 80)}
      </span>
    </>
  );
}

/**
 * Root scope display — loads and renders the root Nostr event, or shows external identifier
 */
function RootScopeDisplay({
  root,
  event,
}: {
  root: CommentRootScope;
  event: NostrEvent;
}) {
  const { addWindow } = useGrimoire();
  const pointer = scopeToPointer(root.scope);
  const rootEvent = useNostrEvent(pointer, event);

  // External identifier (I-tag)
  if (root.scope.type === "external") {
    const Icon = getExternalIdentifierIcon(root.kind);
    const label = getExternalIdentifierLabel(root.scope.value, root.kind);
    return (
      <ScopeRow icon={Icon} label={label} href={root.scope.hint || undefined} />
    );
  }

  if (!pointer) return null;

  // Loading
  if (!rootEvent) {
    return (
      <InlineReplySkeleton
        icon={
          <KindBadge kind={parseInt(root.kind, 10) || 0} variant="compact" />
        }
      />
    );
  }

  return (
    <ScopeRow
      icon={getKindIcon(rootEvent.kind)}
      label={<NostrEventLabel nostrEvent={rootEvent} />}
      onClick={() => addWindow("open", { pointer })}
    />
  );
}

/**
 * Renderer for Kind 1111 - Comment (NIP-22)
 * Shows root scope (what the thread is about) and parent reply (if nested)
 */
export function Kind1111Renderer({ event, depth = 0 }: BaseEventProps) {
  const { addWindow } = useGrimoire();
  const root = getCommentRootScope(event);
  const topLevel = isTopLevelComment(event);

  // Parent pointer (for reply-to-comment case)
  const replyPointerRaw = getCommentReplyPointer(event);
  const replyPointer = convertCommentPointer(replyPointerRaw);
  const replyEvent = useNostrEvent(!topLevel ? replyPointer : undefined, event);

  const handleReplyClick = () => {
    if (!replyEvent || !replyPointer) return;
    addWindow("open", { pointer: replyPointer });
  };

  return (
    <BaseEventContainer event={event}>
      {/* Root scope — what this comment thread is about */}
      {root && <RootScopeDisplay root={root} event={event} />}

      {/* Parent reply — only shown for nested comments (reply to another comment) */}
      {!topLevel && replyPointer && !replyEvent && (
        <InlineReplySkeleton icon={<Reply className="size-3" />} />
      )}

      {!topLevel && replyPointer && replyEvent && (
        <ScopeRow
          icon={Reply}
          label={<NostrEventLabel nostrEvent={replyEvent} />}
          onClick={handleReplyClick}
        />
      )}

      <RichText event={event} className="text-sm" depth={depth} />
    </BaseEventContainer>
  );
}
