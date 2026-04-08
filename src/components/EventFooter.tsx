import { NostrEvent } from "@/types/nostr";
import { KindBadge } from "./KindBadge";
import { Wifi, ShieldCheck } from "lucide-react";
import { getSeenRelays } from "applesauce-core/helpers/relays";
import { useAddWindow } from "@/core/state";
import { getKindName } from "@/constants/kinds";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { RelayLink } from "./nostr/RelayLink";
import { isProtectedEvent } from "@/lib/nip70-helpers";

interface EventFooterProps {
  event: NostrEvent;
  clientName?: string;
  clientAppPointer?: {
    kind: number;
    pubkey: string;
    identifier: string;
  } | null;
}

/**
 * EventFooter - Subtle footer for events showing kind and relay information
 * Left: Kind badge (clickable to open KIND command)
 * Right: Relay count dropdown
 */
export function EventFooter({
  event,
  clientName,
  clientAppPointer,
}: EventFooterProps) {
  const addWindow = useAddWindow();

  // Get relays this event was seen on
  const seenRelaysSet = getSeenRelays(event);
  const relays = seenRelaysSet ? Array.from(seenRelaysSet) : [];
  const kindName = getKindName(event.kind);
  const isProtected = isProtectedEvent(event);

  const handleKindClick = () => {
    // Open KIND command to show NIP documentation for this kind
    addWindow("kind", { number: event.kind });
  };

  return (
    <div className="pt-1">
      {/* Footer Bar */}
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        {/* Left: Kind Badge + Client */}
        <div className="flex items-center gap-2 md:gap-1.5">
          <button
            onClick={handleKindClick}
            className="group flex items-center gap-2 md:gap-1.5 min-h-[44px] md:min-h-0 px-1 -mx-1 cursor-crosshair hover:text-foreground transition-colors"
            title={`View documentation for kind ${event.kind}`}
          >
            <KindBadge
              kind={event.kind}
              variant="compact"
              iconClassname="text-muted-foreground group-hover:text-foreground transition-colors size-4 md:size-3"
            />
            <span className="text-xs md:text-[10px] md:leading-[10px]">
              {kindName}
            </span>
          </button>
          {clientName && (
            <span className="text-xs md:text-[10px] md:leading-[10px] text-muted-foreground/70">
              ·{" "}
              {clientAppPointer ? (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    addWindow("open", { pointer: clientAppPointer });
                  }}
                  className="hover:underline hover:text-foreground cursor-crosshair"
                >
                  {clientName}
                </button>
              ) : (
                clientName
              )}
            </span>
          )}
        </div>

        {/* Right: Protected + Relay Dropdown */}
        <div className="flex items-center gap-3 md:gap-2">
          {isProtected && (
            <button
              onClick={() => addWindow("nip", { number: 70 }, "NIP 70")}
              className="flex items-center min-h-[44px] md:min-h-0 px-1 -mx-1 cursor-crosshair hover:text-foreground transition-colors"
              title="Protected event (NIP-70)"
            >
              <ShieldCheck className="size-4 md:size-3" />
            </button>
          )}
          {relays.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="flex items-center gap-2 md:gap-1 min-h-[44px] md:min-h-0 px-1 -mx-1 cursor-pointer hover:text-foreground transition-colors"
                  title={`Seen on ${relays.length} relay${relays.length > 1 ? "s" : ""}`}
                >
                  <Wifi className="size-4 md:size-3" />
                  <span className="text-xs md:text-[10px] md:leading-[10px]">
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
    </div>
  );
}
