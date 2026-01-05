import { useMemo } from "react";
import type { NostrEvent } from "@/types/nostr";
import type { EventPointer, AddressPointer } from "nostr-tools/nip19";
import { kinds } from "nostr-tools";
import { UserName } from "./UserName";
import { RichText } from "./RichText";
import { Zap, CornerDownRight, Quote } from "lucide-react";
import { cn } from "@/lib/utils";
import { getTagValue } from "applesauce-core/helpers";
import { getZapAmount, getZapSender } from "applesauce-common/helpers/zap";
import { getNip10References } from "applesauce-common/helpers/threading";
import { useNostrEvent } from "@/hooks/useNostrEvent";

interface ChatViewProps {
  events: NostrEvent[];
  className?: string;
}

const isSameDay = (date1: Date, date2: Date) => {
  return (
    date1.getFullYear() === date2.getFullYear() &&
    date1.getMonth() === date2.getMonth() &&
    date1.getDate() === date2.getDate()
  );
};

export function ChatView({ events, className }: ChatViewProps) {
  return (
    <div className={cn("flex flex-col h-full", className)}>
      {/* Chat messages area */}
      <div className="flex-1 flex flex-col-reverse gap-0.5 overflow-y-auto p-0 scrollbar-thin scrollbar-thumb-muted scrollbar-track-transparent">
        {events.map((event, index) => {
          const currentDate = new Date(event.created_at * 1000);
          const prevEvent = events[index + 1];

          const prevDate = prevEvent
            ? new Date(prevEvent.created_at * 1000)
            : null;
          const showDateHeader = !prevDate || !isSameDay(currentDate, prevDate);

          return (
            <div key={event.id} className="flex flex-col-reverse">
              {event.kind === kinds.Zap ? (
                <ZapMessage event={event} />
              ) : (
                <ChatMessage event={event} />
              )}
              {showDateHeader && (
                <div className="flex justify-center py-2 pointer-events-none">
                  <span className="text-[10px] font-light text-muted-foreground">
                    {currentDate.toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Chat input - Commented out for now */}
      {/* <form
        onSubmit={handleSubmit}
        className="flex gap-0 border-t border-border bg-background"
      >
        <input
          type="text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Send message..."
          className="flex-1 px-2 py-1 bg-transparent text-sm focus:outline-none placeholder:text-muted-foreground/50 h-8"
        />
        <Button
          type="submit"
          disabled={!message.trim()}
          variant="default"
          size="sm"
          aria-label="Send message"
          className="h-8 rounded-none px-3"
        >
          <Send className="w-4 h-4" />
        </Button>
      </form> */}
    </div>
  );
}

function ChatMessage({ event }: { event: NostrEvent }) {
  // Both helpers cache internally, no useMemo needed
  const threadRefs = getNip10References(event);
  const replyToId = threadRefs.reply?.e?.id;
  const qTagValue = getTagValue(event, "q");

  return (
    <div className="flex flex-col gap-0.5">
      {replyToId && <ReplyIndicator eventId={replyToId} />}
      {qTagValue && <QuoteIndicator qValue={qTagValue} />}
      <RichText
        className="text-xs leading-tight text-foreground/90"
        event={event}
        options={{ showMedia: false, showEventEmbeds: false }}
      >
        <UserName
          pubkey={event.pubkey}
          className="font-bold leading-tight flex-shrink-0 mr-1.5 text-accent"
        />
      </RichText>
    </div>
  );
}

function ReplyIndicator({ eventId }: { eventId: string }) {
  const replyToEvent = useNostrEvent(eventId);

  if (!replyToEvent) {
    return null;
  }

  return (
    <div className="flex items-center gap-1 text-[10px] text-muted-foreground pl-2 opacity-60">
      <CornerDownRight className="w-3 h-3 flex-shrink-0" />
      <UserName
        pubkey={replyToEvent.pubkey}
        className="font-semibold flex-shrink-0"
      />
      <span className="truncate">{replyToEvent.content}</span>
    </div>
  );
}

/**
 * Parse q-tag value into EventPointer or AddressPointer
 * Format can be:
 * - Event ID: "abc123..." (64-char hex)
 * - Address: "kind:pubkey:d-tag"
 */
function parseQTag(qValue: string): EventPointer | AddressPointer | null {
  // Check if it's an address (contains colons)
  if (qValue.includes(":")) {
    const parts = qValue.split(":");
    if (parts.length >= 2) {
      const kind = parseInt(parts[0], 10);
      const pubkey = parts[1];
      const identifier = parts.slice(2).join(":") || "";

      if (!isNaN(kind) && pubkey) {
        return { kind, pubkey, identifier };
      }
    }
  }

  // Assume it's an event ID (hex string)
  if (/^[0-9a-f]{64}$/i.test(qValue)) {
    return { id: qValue };
  }

  return null;
}

function QuoteIndicator({ qValue }: { qValue: string }) {
  const pointer = useMemo(() => parseQTag(qValue), [qValue]);
  const quotedEvent = useNostrEvent(pointer || undefined);

  if (!quotedEvent) {
    return null;
  }

  return (
    <div className="flex items-center gap-1 text-[10px] text-muted-foreground pl-2 opacity-60">
      <Quote className="w-3 h-3 flex-shrink-0" />
      <UserName
        pubkey={quotedEvent.pubkey}
        className="font-semibold flex-shrink-0"
      />
      <span className="truncate">{quotedEvent.content}</span>
    </div>
  );
}

function ZapMessage({ event }: { event: NostrEvent }) {
  const amount = getZapAmount(event);
  const zapper = getZapSender(event);

  if (!amount || !zapper) return null;

  return (
    <RichText
      className="text-xs"
      event={event}
      options={{ showMedia: false, showEventEmbeds: false }}
    >
      <div className="flex flex-row justify-between items-center">
        <UserName pubkey={zapper} className="font-bold text-xs truncate" />
        <span className="text-xs font-bold text-yellow-500 inline-flex items-center gap-1">
          <Zap className="w-3 h-3 fill-yellow-500" />
          <span className="text-sm">
            {(amount / 1000).toLocaleString("en", {
              notation: "compact",
            })}
          </span>
        </span>
      </div>
    </RichText>
  );
}
