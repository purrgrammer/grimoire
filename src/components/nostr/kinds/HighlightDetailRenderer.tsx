import { useMemo } from "react";
import { ExternalLink } from "lucide-react";
import type { NostrEvent } from "@/types/nostr";
import {
  getHighlightText,
  getHighlightSourceEventPointer,
  getHighlightSourceAddressPointer,
  getHighlightSourceUrl,
  getHighlightComment,
  getHighlightContext,
} from "applesauce-core/helpers/highlight";
import { EmbeddedEvent } from "../EmbeddedEvent";
import { UserName } from "../UserName";
import { useGrimoire } from "@/core/state";

/**
 * Detail renderer for Kind 9802 - Highlight
 * Shows highlighted text, comment, context, and embedded source event
 */
export function Kind9802DetailRenderer({ event }: { event: NostrEvent }) {
  const { addWindow } = useGrimoire();
  const highlightText = useMemo(() => getHighlightText(event), [event]);
  const comment = useMemo(() => getHighlightComment(event), [event]);
  const context = useMemo(() => getHighlightContext(event), [event]);
  const sourceUrl = useMemo(() => getHighlightSourceUrl(event), [event]);

  // Get source event pointer (e tag) or address pointer (a tag)
  const eventPointer = useMemo(
    () => getHighlightSourceEventPointer(event),
    [event],
  );
  const addressPointer = useMemo(
    () => getHighlightSourceAddressPointer(event),
    [event],
  );

  // Format created date
  const createdDate = new Date(event.created_at * 1000).toLocaleDateString(
    "en-US",
    {
      year: "numeric",
      month: "long",
      day: "numeric",
    },
  );

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
      {comment && (
        <div className="flex flex-col gap-2">
          <div className="text-xs text-muted-foreground uppercase tracking-wide">
            Comment
          </div>
          <p className="text-sm leading-relaxed">{comment}</p>
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
            eventId={eventPointer?.id}
            addressPointer={addressPointer}
            onOpen={(pointer) => {
              if (typeof pointer === "string") {
                addWindow(
                  "open",
                  { id: pointer },
                  `Event ${pointer.slice(0, 8)}...`,
                );
              } else {
                addWindow("open", pointer, `Event`);
              }
            }}
          />
        </div>
      )}
    </div>
  );
}
