import type { EventPointer, AddressPointer } from "nostr-tools/nip19";
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
 * Passes full pointer (including relay hints) for proper event resolution
 */
export function EventEmbed({ node, depth = 1 }: EventEmbedNodeProps) {
  const { pointer } = node;

  // Check if it's an EventPointer (has 'id') or AddressPointer (has 'kind' + 'pubkey')
  const isEvent = "id" in pointer;

  return (
    <QuotedEvent
      eventPointer={isEvent ? pointer : undefined}
      addressPointer={!isEvent ? (pointer as AddressPointer) : undefined}
      depth={depth}
    />
  );
}
