import { Hash, Users } from "lucide-react";
import { BaseEventContainer, type BaseEventProps } from "./BaseEventRenderer";
import { UserName } from "../UserName";
import { useGrimoire } from "@/core/state";
import { Button } from "@/components/ui/button";
import { nip19 } from "nostr-tools";

/**
 * Kind 40 Renderer - Channel Creation (Feed View)
 * NIP-28 public chat channel creation event
 */
export function ChannelCreationRenderer({ event }: BaseEventProps) {
  const { addWindow } = useGrimoire();
  const channelName = event.content || `Channel ${event.id.slice(0, 8)}`;

  const handleOpenChannel = () => {
    // Create nevent with relay hints from event
    const relayHints = event.tags
      .filter((t) => t[0] === "r" && t[1])
      .map((t) => t[1]);

    const identifier =
      relayHints.length > 0
        ? nip19.neventEncode({ id: event.id, relays: relayHints })
        : nip19.noteEncode(event.id);

    addWindow("chat", { protocol: "nip-28", identifier }, `#${channelName}`);
  };

  return (
    <BaseEventContainer event={event}>
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-1.5 text-sm">
          <Hash className="size-4 text-muted-foreground" />
          <span className="font-medium">{channelName}</span>
        </div>

        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Users className="size-3.5" />
          <span>Created by</span>
          <UserName pubkey={event.pubkey} className="text-accent" />
        </div>

        <Button
          onClick={handleOpenChannel}
          variant="outline"
          size="sm"
          className="self-start"
        >
          Open Channel
        </Button>
      </div>
    </BaseEventContainer>
  );
}
