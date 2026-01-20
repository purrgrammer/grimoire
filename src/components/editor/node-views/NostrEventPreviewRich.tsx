import { NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import { useNostrEvent } from "@/hooks/useNostrEvent";
import { DetailKindRenderer } from "@/components/nostr/kinds";
import type { EventPointer, AddressPointer } from "nostr-tools/nip19";
import { Loader2 } from "lucide-react";

/**
 * Rich preview component for Nostr events in the editor
 *
 * Uses the full DetailKindRenderer to show event content
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
      <div className="rounded-lg border border-border bg-muted/30 p-3">
        {!event ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            <span>Loading event...</span>
          </div>
        ) : (
          <DetailKindRenderer event={event} />
        )}
      </div>
    </NodeViewWrapper>
  );
}
