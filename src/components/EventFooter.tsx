import { NostrEvent } from "@/types/nostr";
import { KindBadge } from "./KindBadge";
import { Wifi } from "lucide-react";
import { getSeenRelays } from "applesauce-core/helpers/relays";
import { useGrimoire } from "@/core/state";
import { getKindName } from "@/constants/kinds";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { RelayLink } from "./nostr/RelayLink";

interface EventFooterProps {
  event: NostrEvent;
}

/**
 * EventFooter - Subtle footer for events showing kind and relay information
 * Left: Kind badge (clickable to open KIND command)
 * Right: Relay count dropdown
 */
export function EventFooter({ event }: EventFooterProps) {
  const { addWindow } = useGrimoire();

  // Get relays this event was seen on
  const seenRelaysSet = getSeenRelays(event);
  const relays = seenRelaysSet ? Array.from(seenRelaysSet) : [];
  const kindName = getKindName(event.kind);

  const handleKindClick = () => {
    // Open KIND command to show NIP documentation for this kind
    addWindow("kind", { number: event.kind });
  };

  return (
    <div className="pt-2">
      {/* Footer Bar */}
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        {/* Left: Kind Badge */}
        <button
          onClick={handleKindClick}
          className="group flex items-center gap-1.5 cursor-crosshair hover:text-foreground transition-colors"
          title={`View documentation for kind ${event.kind}`}
        >
          <KindBadge
            kind={event.kind}
            variant="compact"
            iconClassname="text-muted-foreground group-hover:text-foreground transition-colors size-3"
          />
          <span className="text-[10px] leading-[10px]">{kindName}</span>
        </button>

        {/* Right: Relay Dropdown */}
        {relays.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="flex items-center gap-1 cursor-pointer hover:text-foreground transition-colors"
                title={`Seen on ${relays.length} relay${relays.length > 1 ? "s" : ""}`}
              >
                <Wifi className="size-3" />
                <span className="text-[10px] leading-[10px]">
                  {relays.length}
                </span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="max-h-64 overflow-y-auto p-1"
            >
              <DropdownMenuLabel>Seen on</DropdownMenuLabel>
              {relays.map((relay) => (
                <RelayLink
                  key={relay}
                  url={relay}
                  showInboxOutbox={false}
                  className="px-2 py-1 rounded-sm"
                />
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
}
