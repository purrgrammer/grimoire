import { useState, useMemo } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { getNip10References } from "applesauce-common/helpers/threading";
import { getCommentReplyPointer } from "applesauce-common/helpers/comment";
import { KindRenderer } from "./nostr/kinds";
import { EventErrorBoundary } from "./EventErrorBoundary";
import type { NostrEvent } from "@/types/nostr";

export interface ThreadConversationProps {
  rootEventId: string;
  replies: NostrEvent[];
  threadKind: "nip10" | "nip22"; // NIP-10 (kind 1) or NIP-22 (kind 1111)
}

interface ThreadNode {
  event: NostrEvent;
  children: NostrEvent[];
  isCollapsed: boolean;
}

/**
 * Get the parent event ID for a reply
 */
function getParentId(
  event: NostrEvent,
  threadKind: "nip10" | "nip22",
): string | null {
  if (threadKind === "nip10") {
    // NIP-10: Use reply pointer (immediate parent) or root pointer
    const refs = getNip10References(event);
    if (refs.reply?.e) {
      return "id" in refs.reply.e ? refs.reply.e.id : null;
    }
    if (refs.root?.e) {
      return "id" in refs.root.e ? refs.root.e.id : null;
    }
    return null;
  } else {
    // NIP-22: Use lowercase 'e' tag (immediate parent)
    const eTags = event.tags.filter((tag) => tag[0] === "e" && tag[1]);
    if (eTags.length > 0) {
      return eTags[0][1];
    }

    // Fallback: check if reply pointer gives us an event ID
    const pointer = getCommentReplyPointer(event);
    if (pointer && "id" in pointer) {
      return pointer.id || null;
    }

    return null;
  }
}

/**
 * Build a 2-level tree structure from flat replies
 * First level: Direct replies to root
 * Second level: Replies to first-level replies (nested under parent)
 */
function buildThreadTree(
  rootId: string,
  replies: NostrEvent[],
  threadKind: "nip10" | "nip22",
): ThreadNode[] {
  // Sort all replies chronologically (oldest first)
  const sortedReplies = [...replies].sort(
    (a, b) => a.created_at - b.created_at,
  );

  // Map event ID -> event for quick lookup
  const eventMap = new Map<string, NostrEvent>();
  sortedReplies.forEach((event) => eventMap.set(event.id, event));

  // Separate into first-level and second-level
  const firstLevel: NostrEvent[] = [];
  const childrenByParent = new Map<string, NostrEvent[]>();

  sortedReplies.forEach((event) => {
    const parentId = getParentId(event, threadKind);

    if (parentId === rootId) {
      // Direct reply to root
      firstLevel.push(event);
    } else if (parentId && eventMap.has(parentId)) {
      // Reply to another reply
      if (!childrenByParent.has(parentId)) {
        childrenByParent.set(parentId, []);
      }
      childrenByParent.get(parentId)!.push(event);
    } else {
      // Unknown parent or orphaned - treat as first-level
      firstLevel.push(event);
    }
  });

  // Build thread nodes
  return firstLevel.map((event) => ({
    event,
    children: childrenByParent.get(event.id) || [],
    isCollapsed: false, // Start expanded
  }));
}

/**
 * ThreadConversation - Displays a 2-level threaded conversation
 * - Max 2 levels: root replies + their replies
 * - Only 2nd level is indented
 * - Chronological order
 * - Expand/collapse for 1st level replies
 */
export function ThreadConversation({
  rootEventId,
  replies,
  threadKind,
}: ThreadConversationProps) {
  // Build tree structure
  const initialTree = useMemo(
    () => buildThreadTree(rootEventId, replies, threadKind),
    [rootEventId, replies, threadKind],
  );

  // Track collapse state per event ID
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());

  // Toggle collapse for a specific event
  const toggleCollapse = (eventId: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(eventId)) {
        next.delete(eventId);
      } else {
        next.add(eventId);
      }
      return next;
    });
  };

  if (initialTree.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4">
      {initialTree.map((node) => {
        const isCollapsed = collapsedIds.has(node.event.id);
        const hasChildren = node.children.length > 0;

        return (
          <div key={node.event.id}>
            {/* First-level reply */}
            <div className="relative">
              {/* Collapse toggle button (only if has children) */}
              {hasChildren && (
                <button
                  onClick={() => toggleCollapse(node.event.id)}
                  className="absolute -left-6 top-2 text-muted-foreground hover:text-foreground transition-colors"
                  aria-label={
                    isCollapsed ? "Expand replies" : "Collapse replies"
                  }
                >
                  {isCollapsed ? (
                    <ChevronRight className="size-4" />
                  ) : (
                    <ChevronDown className="size-4" />
                  )}
                </button>
              )}

              <EventErrorBoundary event={node.event}>
                <KindRenderer event={node.event} />
              </EventErrorBoundary>

              {/* Reply count badge (when collapsed) */}
              {hasChildren && isCollapsed && (
                <div className="mt-2 ml-4 text-xs text-muted-foreground italic">
                  {node.children.length}{" "}
                  {node.children.length === 1 ? "reply" : "replies"}
                </div>
              )}
            </div>

            {/* Second-level replies (nested, indented) */}
            {hasChildren && !isCollapsed && (
              <div className="ml-8 mt-3 space-y-3 border-l-2 border-border pl-4">
                {node.children.map((child) => (
                  <EventErrorBoundary key={child.id} event={child}>
                    <KindRenderer event={child} />
                  </EventErrorBoundary>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
