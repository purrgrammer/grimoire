import { BaseEventContainer, type BaseEventProps } from "./BaseEventRenderer";
import { MediaEmbed } from "../MediaEmbed";
import { useNostrEvent } from "@/hooks/useNostrEvent";
import { useGrimoire } from "@/core/state";
import { UserName } from "../UserName";
import { RichText } from "../RichText";
import { InlineReplySkeleton } from "@/components/ui/skeleton";
import { getKindName } from "@/constants/kinds";
import type { NostrEvent } from "@/types/nostr";

/**
 * Get reply pointer from voice message reply (kind 1244)
 * Parses the e tag manually since getCommentReplyPointer only works for kind 1111
 */
function getVoiceReplyPointer(event: NostrEvent): { id: string } | undefined {
  if (event.kind !== 1244) return undefined;

  // Find the e tag - format: ["e", "<event-id>", "<relay>", "<pubkey>"]
  const eTag = event.tags.find((t) => t[0] === "e");
  if (!eTag || !eTag[1]) return undefined;

  return { id: eTag[1] };
}

/**
 * Parent event preview - compact inline display
 */
function ParentPreview({
  parentEvent,
  onClickHandler,
}: {
  parentEvent: NostrEvent;
  onClickHandler: () => void;
}) {
  const kindName = getKindName(parentEvent.kind);
  const isVoiceMessage = parentEvent.kind === 1222;

  return (
    <div
      onClick={onClickHandler}
      className="flex items-center gap-2 text-xs cursor-crosshair hover:opacity-80 transition-opacity"
    >
      <UserName
        pubkey={parentEvent.pubkey}
        className="text-accent font-medium flex-shrink-0"
      />
      <span className="text-muted-foreground shrink-0">[{kindName}]</span>
      {!isVoiceMessage && (
        <div className="text-muted-foreground truncate min-w-0 flex-1">
          <RichText
            event={parentEvent}
            className="line-clamp-1"
            options={{
              showMedia: false,
              showEventEmbeds: false,
            }}
          />
        </div>
      )}
    </div>
  );
}

/**
 * Renderer for Kind 1222 - Voice Message (NIP-A0)
 * and Kind 1244 - Voice Message Reply (NIP-A0)
 *
 * Simple display: just the audio player, with reply context for 1244
 */
export function VoiceMessageRenderer({ event }: BaseEventProps) {
  const { addWindow } = useGrimoire();

  // Audio URL is in event.content per NIP-A0
  const audioUrl = event.content.trim();

  // For kind 1244 (voice reply), get the reply pointer
  const isReply = event.kind === 1244;
  const replyPointer = isReply ? getVoiceReplyPointer(event) : undefined;
  const replyEvent = useNostrEvent(replyPointer, event);

  const handleReplyClick = () => {
    if (!replyEvent || !replyPointer) return;
    addWindow("open", { pointer: replyPointer });
  };

  // Validate URL
  const isValidUrl =
    audioUrl.startsWith("http://") || audioUrl.startsWith("https://");

  return (
    <BaseEventContainer event={event}>
      <div className="flex flex-col gap-2">
        {/* Reply context for kind 1244 */}
        {isReply && replyPointer && !replyEvent && <InlineReplySkeleton />}

        {isReply && replyPointer && replyEvent && (
          <ParentPreview
            parentEvent={replyEvent}
            onClickHandler={handleReplyClick}
          />
        )}

        {/* Audio player */}
        {isValidUrl ? (
          <MediaEmbed url={audioUrl} type="audio" showControls />
        ) : (
          <p className="text-sm text-muted-foreground italic">
            Invalid audio URL
          </p>
        )}
      </div>
    </BaseEventContainer>
  );
}
