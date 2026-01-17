import { useState, useMemo, useEffect, useRef } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { getNip10References } from "applesauce-common/helpers/threading";
import { getCommentReplyPointer } from "applesauce-common/helpers/comment";
import { EventErrorBoundary } from "./EventErrorBoundary";
import { ThreadCommentRenderer } from "./ThreadCommentRenderer";
import type { NostrEvent } from "@/types/nostr";

export interface ThreadConversationProps {
  rootEventId: string;
  replies: NostrEvent[];
  focusedEventId?: string; // Event to highlight and scroll to (if not root)
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
  focusedEventId?: string,
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

  // Determine thread kind dynamically per event
  sortedReplies.forEach((event) => {
    const threadKind = event.kind === 1111 ? "nip22" : "nip10";
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
  // Auto-expand parent if focusedEventId is in its children
  return firstLevel.map((event) => {
    const children = childrenByParent.get(event.id) || [];
    const hasFocusedChild =
      focusedEventId && children.some((c) => c.id === focusedEventId);

    return {
      event,
      children,
      isCollapsed: hasFocusedChild ? false : false, // Start expanded (could make collapsible later)
    };
  });
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
  focusedEventId,
}: ThreadConversationProps) {
  // Build tree structure
  const initialTree = useMemo(
    () => buildThreadTree(rootEventId, replies, focusedEventId),
    [rootEventId, replies, focusedEventId],
  );

  // Track collapse state per event ID
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());

  // Ref for the focused event element
  const focusedRef = useRef<HTMLDivElement>(null);

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

  // Scroll to focused event on mount
  useEffect(() => {
    if (focusedEventId && focusedRef.current) {
      // Small delay to ensure rendering is complete
      setTimeout(() => {
        focusedRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      }, 100);
    }
  }, [focusedEventId]);

  if (initialTree.length === 0) {
    return null;
  }

  return (
    <div className="space-y-0">
      {initialTree.map((node) => {
        const isCollapsed = collapsedIds.has(node.event.id);
        const hasChildren = node.children.length > 0;

        const isFocused = focusedEventId === node.event.id;

        return (
          <div key={node.event.id}>
            {/* First-level reply */}
            <div ref={isFocused ? focusedRef : undefined} className="relative">
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

              <div
                className={isFocused ? "ring-2 ring-primary/50 rounded" : ""}
              >
                <EventErrorBoundary event={node.event}>
                  <ThreadCommentRenderer event={node.event} />
                </EventErrorBoundary>
              </div>
            </div>

            {/* Second-level replies (nested, indented) */}
            {hasChildren && !isCollapsed && (
              <div className="ml-8 mt-2 space-y-0 border-l-2 border-border pl-4">
                {node.children.map((child) => {
                  const isChildFocused = focusedEventId === child.id;
                  return (
                    <div
                      key={child.id}
                      ref={isChildFocused ? focusedRef : undefined}
                      className={
                        isChildFocused ? "ring-2 ring-primary/50 rounded" : ""
                      }
                    >
                      <EventErrorBoundary event={child}>
                        <ThreadCommentRenderer event={child} />
                      </EventErrorBoundary>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
