import type { ReactNode } from "react";
import { RichText } from "../RichText";
import { EventPreviewLine } from "../EventPreviewLine";
import { BaseEventContainer, type BaseEventProps } from "./BaseEventRenderer";
import {
  getCommentReplyPointer,
  isCommentAddressPointer,
  isCommentEventPointer,
  type CommentPointer,
} from "applesauce-common/helpers/comment";
import { useNostrEvent } from "@/hooks/useNostrEvent";
import { Reply } from "lucide-react";
import { useAddWindow } from "@/core/state";
import { InlineReplySkeleton } from "@/components/ui/skeleton";
import { KindBadge } from "@/components/KindBadge";
import type { NostrEvent } from "@/types/nostr";
import {
  getCommentRootScope,
  isTopLevelComment,
  type CommentRootScope,
  type CommentScope,
} from "@/lib/nip22-helpers";
import { ExternalIdentifierInline } from "../ExternalIdentifierDisplay";

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

/**
 * Inline scope row — children are direct flex items.
 * Renders as a plain div, clickable div, or anchor depending on props.
 */
function ScopeRow({
  children,
  onClick,
  href,
}: {
  children: ReactNode;
  onClick?: () => void;
  href?: string;
}) {
  const base = "flex items-center gap-1.5 text-xs overflow-hidden min-w-0";

  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={`${base} text-muted-foreground underline decoration-dotted hover:text-foreground transition-colors`}
      >
        {children}
      </a>
    );
  }

  if (onClick) {
    return (
      <div
        className={`${base} text-muted-foreground cursor-crosshair hover:text-foreground transition-colors`}
        onClick={onClick}
      >
        {children}
      </div>
    );
  }

  return <div className={`${base} text-muted-foreground`}>{children}</div>;
}

/** Icon + author + title or one-line body, in the scope row's style. */
function NostrEventContent({
  nostrEvent,
  icon,
}: {
  nostrEvent: NostrEvent;
  icon: ReactNode;
}) {
  return (
    <EventPreviewLine
      event={nostrEvent}
      icon={icon}
      useTitle
      nameClassName="text-accent font-semibold flex-shrink-0"
      contentClassName="text-muted-foreground"
    />
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
  const addWindow = useAddWindow();
  const pointer = scopeToPointer(root.scope);
  const rootEvent = useNostrEvent(pointer, event);

  // External identifier (I-tag) — render using shared NIP-73 component
  if (root.scope.type === "external") {
    return (
      <ExternalIdentifierInline
        value={root.scope.value}
        kType={root.kind}
        hint={root.scope.hint}
      />
    );
  }

  if (!pointer) return null;

  // Loading
  if (!rootEvent) {
    return (
      <InlineReplySkeleton
        icon={
          <KindBadge
            kind={parseInt(root.kind, 10) || 0}
            variant="compact"
            className="text-inherit"
            iconClassname="size-3"
          />
        }
      />
    );
  }

  return (
    <ScopeRow onClick={() => addWindow("open", { pointer })}>
      <NostrEventContent
        nostrEvent={rootEvent}
        icon={
          // text-inherit so the root icon tracks ScopeRow's color and hover,
          // matching the plain Reply icon on the parent row
          <KindBadge
            kind={rootEvent.kind}
            variant="compact"
            className="text-inherit"
            iconClassname="size-3"
          />
        }
      />
    </ScopeRow>
  );
}

/**
 * Renderer for Kind 1111 - Comment (NIP-22)
 * Shows root scope (what the thread is about) and parent reply (if nested)
 */
export function Kind1111Renderer({ event, depth = 0 }: BaseEventProps) {
  const addWindow = useAddWindow();
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

      {/* Parent reply — only shown for nested comments */}
      {!topLevel && replyPointer && !replyEvent && (
        <InlineReplySkeleton icon={<Reply className="size-3" />} />
      )}

      {!topLevel && replyPointer && replyEvent && (
        <ScopeRow onClick={handleReplyClick}>
          <NostrEventContent
            nostrEvent={replyEvent}
            icon={<Reply className="size-3 flex-shrink-0" />}
          />
        </ScopeRow>
      )}

      <RichText
        event={event}
        className="text-sm"
        depth={depth}
        options={{ bigEmoji: true }}
      />
    </BaseEventContainer>
  );
}
