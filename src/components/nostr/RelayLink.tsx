import { Inbox, Send } from "lucide-react";
import { useGrimoire } from "@/core/state";
import { useRelayInfo } from "@/hooks/useRelayInfo";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { cn } from "@/lib/utils";

export interface RelayLinkProps {
  url: string;
  read?: boolean;
  write?: boolean;
  className?: string;
  urlClassname?: string;
  iconClassname?: string;
}

/**
 * RelayLink - Clickable relay URL component
 * Displays relay URL with read/write badges and tooltips
 * Opens relay detail window on click
 */
export function RelayLink({
  url,
  urlClassname,
  iconClassname,
  read = false,
  write = false,
  className,
}: RelayLinkProps) {
  const { addWindow } = useGrimoire();
  const relayInfo = useRelayInfo(url);

  const handleClick = () => {
    addWindow("relay", { url }, `Relay ${url}`);
  };

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-2 cursor-crosshair hover:bg-muted/50",
        className,
      )}
      onClick={handleClick}
    >
      <div className="flex items-center gap-1.5 min-w-0">
        {relayInfo?.icon && (
          <img
            src={relayInfo.icon}
            alt=""
            className={cn("size-3 flex-shrink-0 rounded-sm", iconClassname)}
          />
        )}
        <span className={cn("text-xs truncate", urlClassname)}>{url}</span>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        {read && (
          <HoverCard openDelay={200}>
            <HoverCardTrigger asChild>
              <div className="cursor-help">
                <Inbox
                  className={cn("size-3 text-muted-foreground", iconClassname)}
                />
              </div>
            </HoverCardTrigger>
            <HoverCardContent
              side="top"
              className="w-64 text-xs"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="space-y-1">
                <div className="font-semibold">Read / Inbox</div>
                <p className="text-muted-foreground">
                  This relay is used to read events. Your client will fetch
                  events from this relay when loading your feed or searching for
                  content.
                </p>
              </div>
            </HoverCardContent>
          </HoverCard>
        )}
        {write && (
          <HoverCard openDelay={200}>
            <HoverCardTrigger asChild>
              <div className="cursor-help">
                <Send
                  className={cn("size-3 text-muted-foreground", iconClassname)}
                />
              </div>
            </HoverCardTrigger>
            <HoverCardContent
              side="top"
              className="w-64 text-xs"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="space-y-1">
                <div className="font-semibold">Write / Outbox</div>
                <p className="text-muted-foreground">
                  This relay is used to publish events. When you create a post
                  or update your profile, it will be sent to this relay for
                  others to discover.
                </p>
              </div>
            </HoverCardContent>
          </HoverCard>
        )}
      </div>
    </div>
  );
}
