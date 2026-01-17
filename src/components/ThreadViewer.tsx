import { useMemo, useState } from "react";
import type { EventPointer, AddressPointer } from "nostr-tools/nip19";
import { useNostrEvent } from "@/hooks/useNostrEvent";
import { KindRenderer } from "./nostr/kinds";
import { EventErrorBoundary } from "./EventErrorBoundary";
import { EventDetailSkeleton } from "@/components/ui/skeleton";
import type { NostrEvent } from "@/types/nostr";
import { use$ } from "applesauce-react/hooks";
import eventStore from "@/services/event-store";
import {
  getCommentRootPointer,
  getCommentReplyPointer,
  isCommentEventPointer,
  isCommentAddressPointer,
} from "applesauce-common/helpers/comment";
import { ChevronDown, ChevronRight, MessageCircle } from "lucide-react";
import { UserName } from "./nostr/UserName";
import { RichText } from "./nostr/RichText";
import { BaseEventContainer } from "./nostr/kinds/BaseEventRenderer";
import { formatDistanceToNow } from "date-fns";

export interface ThreadViewerProps {
  pointer: EventPointer | AddressPointer;
  focusEventId?: string; // Optional: Event ID to focus/scroll to
}

interface CommentNode {
  event: NostrEvent;
  children: CommentNode[];
  depth: number;
}

/**
 * Check if a comment's root matches the given pointer
 */
function isRootMatch(
  comment: NostrEvent,
  pointer: EventPointer | AddressPointer,
): boolean {
  const rootPointer = getCommentRootPointer(comment);
  if (!rootPointer) return false;

  // Check event pointer match
  if ("id" in pointer && isCommentEventPointer(rootPointer)) {
    return rootPointer.id === pointer.id;
  }

  // Check address pointer match
  if (
    "kind" in pointer &&
    "pubkey" in pointer &&
    "identifier" in pointer &&
    isCommentAddressPointer(rootPointer)
  ) {
    return (
      rootPointer.kind === pointer.kind &&
      rootPointer.pubkey === pointer.pubkey &&
      rootPointer.identifier === pointer.identifier
    );
  }

  return false;
}

/**
 * Build a comment tree from a flat list of NIP-22 comments
 */
function buildCommentTree(
  comments: NostrEvent[],
  rootPointer: EventPointer | AddressPointer,
): CommentNode[] {
  // Filter comments that belong to this root
  const relevantComments = comments.filter((c) => isRootMatch(c, rootPointer));

  // Build a map of event ID to comment
  const commentMap = new Map<string, NostrEvent>();
  relevantComments.forEach((c) => commentMap.set(c.id, c));

  // Build nodes
  const nodes = new Map<string, CommentNode>();
  relevantComments.forEach((event) => {
    nodes.set(event.id, { event, children: [], depth: 0 });
  });

  // Organize into tree structure
  const rootNodes: CommentNode[] = [];

  relevantComments.forEach((comment) => {
    const node = nodes.get(comment.id);
    if (!node) return;

    const parentPointer = getCommentReplyPointer(comment);
    const rootCheckPointer = getCommentRootPointer(comment);

    // Check if this is a top-level comment (parent === root)
    const isTopLevel =
      parentPointer &&
      rootCheckPointer &&
      JSON.stringify(parentPointer) === JSON.stringify(rootCheckPointer);

    if (isTopLevel) {
      // Top-level comment
      rootNodes.push(node);
    } else if (parentPointer && isCommentEventPointer(parentPointer)) {
      // Reply to another comment
      const parentNode = nodes.get(parentPointer.id);
      if (parentNode) {
        node.depth = parentNode.depth + 1;
        parentNode.children.push(node);
      } else {
        // Parent comment not found (maybe not loaded yet), treat as top-level
        rootNodes.push(node);
      }
    } else {
      // Fallback: treat as top-level
      rootNodes.push(node);
    }
  });

  // Sort by created_at (oldest first)
  const sortByCreatedAt = (a: CommentNode, b: CommentNode) =>
    a.event.created_at - b.event.created_at;

  rootNodes.sort(sortByCreatedAt);
  nodes.forEach((node) => node.children.sort(sortByCreatedAt));

  return rootNodes;
}

/**
 * Single comment renderer with expandable replies
 */
function CommentReply({
  node,
  focusEventId,
}: {
  node: CommentNode;
  focusEventId?: string;
}) {
  const [expanded, setExpanded] = useState(true);
  const isFocused = focusEventId === node.event.id;

  const hasReplies = node.children.length > 0;
  const timeAgo = formatDistanceToNow(node.event.created_at * 1000, {
    addSuffix: true,
  });

  return (
    <div
      className={`border-l-2 pl-3 ${
        isFocused ? "border-accent" : "border-border"
      }`}
    >
      {/* Comment Header */}
      <div className="flex items-center gap-2 mb-1">
        {hasReplies && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="p-0.5 hover:bg-muted rounded transition-colors"
            aria-label={expanded ? "Collapse" : "Expand"}
          >
            {expanded ? (
              <ChevronDown className="size-3" />
            ) : (
              <ChevronRight className="size-3" />
            )}
          </button>
        )}
        {!hasReplies && <div className="w-4" />}

        <UserName
          pubkey={node.event.pubkey}
          className="font-semibold text-sm"
        />
        <span className="text-xs text-muted-foreground">{timeAgo}</span>
        {hasReplies && (
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <MessageCircle className="size-3" />
            {node.children.length}
          </span>
        )}
      </div>

      {/* Comment Content */}
      <div className="mb-2">
        <RichText event={node.event} className="text-sm" />
      </div>

      {/* Nested Replies */}
      {hasReplies && expanded && (
        <div className="space-y-3 mt-2">
          {node.children.map((child) => (
            <CommentReply
              key={child.event.id}
              node={child}
              focusEventId={focusEventId}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * ThreadViewer - Display a NIP-22 comment thread
 * Shows root event + tree of comments
 */
export function ThreadViewer({ pointer, focusEventId }: ThreadViewerProps) {
  const rootEvent = useNostrEvent(pointer);

  // Build filter for comments on this event
  const commentsFilter = useMemo(() => {
    if (!rootEvent) return null;

    // Build filter based on pointer type
    if ("id" in pointer) {
      // Event pointer: look for comments with E tag matching this ID
      return [
        {
          kinds: [1111],
          "#E": [pointer.id],
        },
      ];
    } else {
      // Address pointer: look for comments with A tag matching this address
      const aTag = `${pointer.kind}:${pointer.pubkey}:${pointer.identifier}`;
      return [
        {
          kinds: [1111],
          "#A": [aTag],
        },
      ];
    }
  }, [rootEvent, pointer]);

  // Fetch comments timeline and subscribe to events
  const comments = use$(() => {
    if (!commentsFilter) return undefined;
    return eventStore.timeline(commentsFilter);
  }, [commentsFilter]);

  // Build comment tree
  const commentTree = useMemo(() => {
    if (!rootEvent || !comments) return [];
    return buildCommentTree(comments, pointer);
  }, [comments, rootEvent, pointer]);

  // Loading state
  if (!rootEvent) {
    return (
      <div className="flex flex-col h-full p-8">
        <EventDetailSkeleton />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Root Event */}
      <div className="border-b border-border">
        <EventErrorBoundary event={rootEvent}>
          <BaseEventContainer event={rootEvent}>
            <KindRenderer event={rootEvent} depth={0} />
          </BaseEventContainer>
        </EventErrorBoundary>
      </div>

      {/* Comment Thread */}
      <div className="flex-1 overflow-y-auto p-4">
        {commentTree.length === 0 ? (
          <div className="text-center text-muted-foreground py-8">
            <MessageCircle className="size-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No comments yet</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="text-xs text-muted-foreground mb-3">
              {commentTree.length} top-level{" "}
              {commentTree.length === 1 ? "comment" : "comments"}
            </div>
            {commentTree.map((node) => (
              <CommentReply
                key={node.event.id}
                node={node}
                focusEventId={focusEventId}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
