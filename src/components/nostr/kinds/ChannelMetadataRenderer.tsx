import { Hash, Settings } from "lucide-react";
import type { NostrEvent } from "@/types/nostr";
import { BaseEventContainer, type BaseEventProps } from "./BaseEventRenderer";
import { getTagValues } from "@/lib/nostr-utils";
import { nip19 } from "nostr-tools";

/**
 * Renderer for NIP-28 Channel Creation (kind 40) and Metadata (kind 41)
 */
export function ChannelMetadataRenderer({ event, depth }: BaseEventProps) {
  // Parse metadata from JSON content
  let metadata: any = {};
  try {
    metadata = JSON.parse(event.content);
  } catch {
    // Invalid JSON, show as-is
  }

  const name = metadata.name || "Unnamed Channel";
  const about = metadata.about;
  const picture = metadata.picture;
  const relays = metadata.relays || [];

  const isCreation = event.kind === 40;
  const Icon = isCreation ? Hash : Settings;
  const action = isCreation ? "created channel" : "updated channel";

  // Generate nevent for easy sharing
  const nevent = nip19.neventEncode({
    id: event.id,
    relays: relays.length > 0 ? relays : undefined,
  });

  return (
    <BaseEventContainer event={event}>
      <div className="space-y-2">
        <div className="flex items-start gap-2">
          <Icon className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <span className="text-sm text-muted-foreground">{action}: </span>
            <span className="font-medium">{name}</span>
          </div>
        </div>

        {picture && (
          <img
            src={picture}
            alt={name}
            className="w-16 h-16 rounded object-cover"
          />
        )}

        {about && (
          <p className="text-sm text-muted-foreground line-clamp-2">{about}</p>
        )}

        {relays.length > 0 && (
          <div className="text-xs text-muted-foreground">
            Relays: {relays.length}
          </div>
        )}

        <div className="text-xs text-muted-foreground font-mono">
          Join: chat {nevent.slice(0, 20)}...
        </div>
      </div>
    </BaseEventContainer>
  );
}
