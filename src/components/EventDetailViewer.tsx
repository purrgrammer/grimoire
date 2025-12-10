import { useState } from "react";
import type { EventPointer, AddressPointer } from "nostr-tools/nip19";
import { useNostrEvent } from "@/hooks/useNostrEvent";
import { KindRenderer } from "./nostr/kinds";
import { Kind0DetailRenderer } from "./nostr/kinds/Kind0DetailRenderer";
import { Kind3DetailView } from "./nostr/kinds/Kind3Renderer";
import { Kind30023DetailRenderer } from "./nostr/kinds/Kind30023DetailRenderer";
import { Kind9802DetailRenderer } from "./nostr/kinds/Kind9802DetailRenderer";
import { KindBadge } from "./KindBadge";
import {
  Copy,
  ChevronDown,
  ChevronRight,
  FileJson,
  Wifi,
  Circle,
} from "lucide-react";
import { nip19 } from "nostr-tools";
import { getSeenRelays } from "applesauce-core/helpers/relays";

export interface EventDetailViewerProps {
  pointer: EventPointer | AddressPointer;
}

/**
 * EventDetailViewer - Detailed view for a single event
 * Shows compact metadata header and rendered content
 */
export function EventDetailViewer({ pointer }: EventDetailViewerProps) {
  const event = useNostrEvent(pointer);
  const [showJson, setShowJson] = useState(false);
  const [showRelays, setShowRelays] = useState(false);

  // Loading state
  if (!event) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-muted-foreground">
        <div className="text-sm">Loading event...</div>
      </div>
    );
  }

  // Helper to copy to clipboard
  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  // Get relays this event was seen on using applesauce
  const seenRelaysSet = getSeenRelays(event);
  const relays = seenRelaysSet ? Array.from(seenRelaysSet) : undefined;

  // Generate nevent/naddr bech32 ID for display (always use nevent, not note)
  const bech32Id =
    "id" in pointer
      ? nip19.neventEncode({
          id: event.id,
          relays: relays,
          author: event.pubkey,
        })
      : nip19.naddrEncode({
          kind: event.kind,
          pubkey: event.pubkey,
          identifier: event.tags.find((t) => t[0] === "d")?.[1] || "",
          relays: relays,
        });

  // Format timestamp - compact format
  // const timestamp = new Date(event.created_at * 1000).toLocaleString("en-US", {
  //   month: "2-digit",
  //   day: "2-digit",
  //   year: "numeric",
  //   hour: "2-digit",
  //   minute: "2-digit",
  // });

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Compact Header - Single Line */}
      <div className="border-b border-border px-4 py-2 font-mono text-xs flex items-center justify-between gap-3">
        {/* Left: Event ID */}
        <button
          onClick={() => copyToClipboard(bech32Id)}
          className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors truncate min-w-0"
          title={bech32Id}
        >
          <Copy className="size-3 flex-shrink-0" />
          <code className="truncate">
            {bech32Id.slice(0, 16)}...{bech32Id.slice(-8)}
          </code>
        </button>

        {/* Right: Kind Badge, Relay Count, and JSON Toggle */}
        <div className="flex items-center gap-3 flex-shrink-0">
          <div className="flex items-center gap-1">
            <KindBadge kind={event.kind} variant="compact" />
            <span className="text-xs text-muted-foreground">
              <KindBadge
                kind={event.kind}
                showName
                showKindNumber={false}
                showIcon={false}
              />
            </span>
          </div>
          {relays && relays.length > 0 && (
            <button
              onClick={() => setShowRelays(!showRelays)}
              className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
            >
              {showRelays ? (
                <ChevronDown className="size-3" />
              ) : (
                <ChevronRight className="size-3" />
              )}
              <Wifi className="size-3" />
              <span>{relays.length}</span>
            </button>
          )}
          <button
            onClick={() => setShowJson(!showJson)}
            className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
          >
            {showJson ? (
              <ChevronDown className="size-3" />
            ) : (
              <ChevronRight className="size-3" />
            )}
            <FileJson className="size-3" />
          </button>
        </div>
      </div>

      {/* Expandable Relays */}
      {showRelays && relays && relays.length > 0 && (
        <div className="border-b border-border px-4 py-2 bg-muted">
          <div className="flex flex-col gap-2">
            {relays.map((relay) => (
              <div key={relay} className="flex items-center gap-2">
                <Circle className="size-2 fill-green-500 text-green-500" />
                <span className="text-xs font-mono text-muted-foreground">
                  {relay}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Expandable JSON */}
      {showJson && (
        <div className="border-b border-border px-4 py-2 bg-muted">
          <div className="flex justify-end mb-2">
            <button
              onClick={() => copyToClipboard(JSON.stringify(event, null, 2))}
              className="hover:text-foreground text-muted-foreground transition-colors text-xs flex items-center gap-1"
            >
              <Copy className="size-3" />
              Copy JSON
            </button>
          </div>
          <pre className="text-xs overflow-x-auto whitespace-pre-wrap break-words bg-background p-2 rounded border border-border font-mono">
            {JSON.stringify(event, null, 2)}
          </pre>
        </div>
      )}

      {/* Rendered Content - Focus Here */}
      <div className="flex-1 overflow-y-auto">
        {event.kind === 0 ? (
          <Kind0DetailRenderer event={event} />
        ) : event.kind === 3 ? (
          <Kind3DetailView event={event} />
        ) : event.kind === 30023 ? (
          <Kind30023DetailRenderer event={event} />
        ) : event.kind === 9802 ? (
          <Kind9802DetailRenderer event={event} />
        ) : (
          <KindRenderer event={event} showTimestamp={true} />
        )}
      </div>
    </div>
  );
}
