import type { NostrEvent } from "@/types/nostr";
import { Hash, Calendar, Users, ExternalLink } from "lucide-react";
import { UserName } from "../UserName";
import { useGrimoire } from "@/core/state";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { nip19 } from "nostr-tools";
import Timestamp from "../Timestamp";
import { use$ } from "applesauce-react/hooks";
import eventStore from "@/services/event-store";
import { useMemo } from "react";

interface ChannelCreationDetailRendererProps {
  event: NostrEvent;
}

/**
 * Kind 40 Detail View - Full channel information
 * Shows channel creation details with metadata and open button
 */
export function ChannelCreationDetailRenderer({
  event,
}: ChannelCreationDetailRendererProps) {
  const { addWindow } = useGrimoire();
  const channelName = event.content || `Channel ${event.id.slice(0, 8)}`;

  // Fetch the latest kind 41 metadata for this channel
  const metadataEvent = use$(
    () =>
      eventStore.timeline({
        kinds: [41],
        authors: [event.pubkey],
        "#e": [event.id],
        limit: 1,
      }),
    [event.id, event.pubkey],
  )[0];

  // Parse metadata if available
  const metadata = useMemo(() => {
    if (!metadataEvent) return null;
    try {
      return JSON.parse(metadataEvent.content) as {
        name?: string;
        about?: string;
        picture?: string;
        relays?: string[];
      };
    } catch {
      return null;
    }
  }, [metadataEvent]);

  // Extract relay hints from event
  const relayHints = event.tags
    .filter((t) => t[0] === "r" && t[1])
    .map((t) => t[1]);

  const handleOpenChannel = () => {
    const identifier =
      relayHints.length > 0
        ? nip19.neventEncode({ id: event.id, relays: relayHints })
        : nip19.noteEncode(event.id);

    addWindow(
      "chat",
      { protocol: "nip-28", identifier },
      `#${metadata?.name || channelName}`,
    );
  };

  const title = metadata?.name || channelName;
  const description = metadata?.about;
  const picture = metadata?.picture;
  const metadataRelays = metadata?.relays || [];
  const allRelays = Array.from(new Set([...relayHints, ...metadataRelays]));

  return (
    <div className="flex flex-col h-full bg-background overflow-y-auto">
      {/* Header Image */}
      {picture && (
        <div className="flex-shrink-0 aspect-video bg-muted">
          <img
            src={picture}
            alt={title}
            className="w-full h-full object-cover"
          />
        </div>
      )}

      {/* Channel Info Section */}
      <div className="flex-1 p-4 space-y-4">
        {/* Title */}
        <div className="flex items-start gap-3">
          <Hash className="size-8 text-muted-foreground flex-shrink-0 mt-1" />
          <h1 className="text-2xl font-bold text-balance">{title}</h1>
        </div>

        {/* Creator */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Users className="size-4" />
          <span>Created by</span>
          <UserName pubkey={event.pubkey} className="text-accent" />
        </div>

        {/* Created Date */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Calendar className="size-4" />
          <Timestamp timestamp={event.created_at} format="long" />
        </div>

        {/* Description */}
        {description && (
          <div className="space-y-2">
            <Label>About</Label>
            <p className="text-base text-muted-foreground leading-relaxed">
              {description}
            </p>
          </div>
        )}

        {/* Relays */}
        {allRelays.length > 0 && (
          <div className="space-y-2">
            <Label>Relays ({allRelays.length})</Label>
            <div className="flex flex-col gap-1">
              {allRelays.map((relay) => (
                <div
                  key={relay}
                  className="flex items-center gap-2 text-xs text-muted-foreground font-mono bg-muted/30 px-2 py-1 rounded"
                >
                  <ExternalLink className="size-3" />
                  <span className="truncate">{relay}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Open Channel Button */}
        <Button onClick={handleOpenChannel} className="w-full">
          Open Channel
        </Button>

        {/* Metadata Status */}
        {metadataEvent && (
          <div className="text-xs text-muted-foreground text-center">
            Last updated <Timestamp timestamp={metadataEvent.created_at} />
          </div>
        )}
      </div>
    </div>
  );
}
