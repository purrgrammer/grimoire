import { EventPointer, AddressPointer } from "nostr-tools/nip19";
import { QuotedEvent } from "../QuotedEvent";

interface EventEmbedNodeProps {
  node: {
    pointer: EventPointer | AddressPointer;
  };
  depth?: number;
}

/**
 * EventEmbed component for rendering quoted/embedded Nostr events
 * Uses QuotedEvent with depth tracking for smart expand/collapse behavior
 */
export function EventEmbed({ node, depth = 1 }: EventEmbedNodeProps) {
  const { pointer } = node;

  return (
    <QuotedEvent
      eventId={"id" in pointer ? pointer.id : undefined}
      addressPointer={
        "kind" in pointer && "pubkey" in pointer ? pointer : undefined
      }
      depth={depth}
    />
  );
}
