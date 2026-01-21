import { NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import { useNostrEvent } from "@/hooks/useNostrEvent";
import { KindRenderer } from "@/components/nostr/kinds";
import type { EventPointer, AddressPointer } from "nostr-tools/nip19";
import { EventCardSkeleton } from "@/components/ui/skeleton";

/**
 * Rich preview component for Nostr events in the editor
 *
 * Uses the feed KindRenderer to show event content inline
 */
export function NostrEventPreviewRich({ node }: ReactNodeViewProps) {
  const { type, data } = node.attrs as {
    type: "note" | "nevent" | "naddr";
    data: any;
  };

  // Build pointer for useNostrEvent hook
  let pointer: EventPointer | AddressPointer | string | null = null;

  if (type === "note") {
    pointer = data; // Just the event ID
  } else if (type === "nevent") {
    pointer = {
      id: data.id,
      relays: data.relays || [],
      author: data.author,
      kind: data.kind,
    } as EventPointer;
  } else if (type === "naddr") {
    pointer = {
      kind: data.kind,
      pubkey: data.pubkey,
      identifier: data.identifier || "",
      relays: data.relays || [],
    } as AddressPointer;
  }

  // Fetch the event (only if we have a valid pointer)
  const event = useNostrEvent(pointer || undefined);

  return (
    <NodeViewWrapper className="my-2">
      <div className="rounded-lg border border-border bg-muted/30 p-3 pointer-events-none">
        {!event ? (
          <EventCardSkeleton className="py-2" />
        ) : (
          <KindRenderer event={event} depth={0} />
        )}
      </div>
    </NodeViewWrapper>
  );
}
