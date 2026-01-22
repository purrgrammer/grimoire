import { ExternalLink } from "lucide-react";
import type { NostrEvent } from "@/types/nostr";
import {
  getHighlightText,
  getHighlightSourceEventPointer,
  getHighlightSourceAddressPointer,
  getHighlightSourceUrl,
  getHighlightComment,
  getHighlightContext,
} from "applesauce-common/helpers/highlight";
import { EmbeddedEvent } from "../EmbeddedEvent";
import { UserName } from "../UserName";
import { useGrimoire } from "@/core/state";
import { RichText } from "../RichText";

/**
 * Detail renderer for Kind 9802 - Highlight
 * Shows highlighted text, comment, context, and embedded source event
 * Note: All applesauce helpers cache internally, no useMemo needed
 */
export function Kind9802DetailRenderer({ event }: { event: NostrEvent }) {
  const { addWindow } = useGrimoire();
  const highlightText = getHighlightText(event);
  const comment = getHighlightComment(event);
  const context = getHighlightContext(event);
  const sourceUrl = getHighlightSourceUrl(event);

  // Get source event pointer (e tag) or address pointer (a tag)
  const eventPointer = getHighlightSourceEventPointer(event);
  const addressPointer = getHighlightSourceAddressPointer(event);

  // Format created date
  const createdDate = new Date(event.created_at * 1000).toLocaleDateString(
    "en-US",
    {
      year: "numeric",
      month: "long",
      day: "numeric",
    },
  );

  // Create synthetic event for comment rendering (preserves emoji tags)
  const commentEvent = comment
    ? {
        ...event,
        content: comment,
      }
    : undefined;

  return (
    <div className="flex flex-col gap-6 p-6 max-w-3xl mx-auto">
      {/* Highlight Header */}
      <header className="flex flex-col gap-4 border-b border-border pb-6">
        <h1 className="text-2xl font-bold">Highlight</h1>

        {/* Metadata */}
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <span>By</span>
            <UserName pubkey={event.pubkey} className="font-semibold" />
          </div>
          <span>•</span>
          <time>{createdDate}</time>
        </div>
      </header>

      {/* Highlighted Text */}
      {highlightText && (
        <blockquote className="border-l-4 border-muted pl-4 py-2 bg-muted/30">
          <p className="text-base italic leading-relaxed text-muted-foreground">
            {highlightText}
          </p>
        </blockquote>
      )}

      {/* Context (surrounding text) */}
      {context && (
        <div className="flex flex-col gap-2">
          <div className="text-xs text-muted-foreground uppercase tracking-wide">
            Context
          </div>
          <p className="text-sm text-muted-foreground italic">{context}</p>
        </div>
      )}

      {/* Comment */}
      {commentEvent && (
        <div className="flex flex-col gap-2">
          <div className="text-xs text-muted-foreground uppercase tracking-wide">
            Comment
          </div>
          <RichText
            event={commentEvent}
            className="text-sm leading-relaxed"
            options={{ showMedia: false, showEventEmbeds: false }}
          />
        </div>
      )}

      {/* Source URL */}
      {sourceUrl && (
        <div className="flex flex-col gap-2">
          <div className="text-xs text-muted-foreground uppercase tracking-wide">
            Source
          </div>
          <a
            href={sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-sm text-accent underline decoration-dotted break-all"
          >
            <ExternalLink className="size-4 flex-shrink-0" />
            <span>{sourceUrl}</span>
          </a>
        </div>
      )}

      {/* Embedded Source Event */}
      {(eventPointer || addressPointer) && (
        <div className="flex flex-col gap-2">
          <div className="text-xs text-muted-foreground uppercase tracking-wide">
            Highlighted From
          </div>
          <EmbeddedEvent
            eventPointer={eventPointer}
            addressPointer={addressPointer}
            onOpen={(pointer) => {
              if (typeof pointer === "string") {
                addWindow("open", { id: pointer });
              } else {
                addWindow("open", pointer);
              }
            }}
          />
        </div>
      )}
    </div>
  );
}
