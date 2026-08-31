import { Inbox, Send, ShieldAlert } from "lucide-react";
import { useAddWindow } from "@/core/state";
import { useRelayInfo } from "@/hooks/useRelayInfo";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { cn } from "@/lib/utils";

/**
 * Format relay URL for display by removing protocol and trailing slashes
 */
function formatRelayUrlForDisplay(url: string): string {
  return url
    .replace(/^wss?:\/\//, "") // Remove ws:// or wss://
    .replace(/\/$/, ""); // Remove trailing slash
}

/**
 * Check if relay uses insecure ws:// protocol
 */
function isInsecureRelay(url: string): boolean {
  return url.startsWith("ws://");
}

export interface RelayLinkProps {
  url: string;
  read?: boolean;
  write?: boolean;
  showInboxOutbox?: boolean;
  className?: string;
  urlClassname?: string;
  iconClassname?: string;
  variant?: "default" | "prompt";
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
  showInboxOutbox = true,
  className,
  variant = "default",
}: RelayLinkProps) {
  const addWindow = useAddWindow();
  const relayInfo = useRelayInfo(url);

  const handleClick = () => {
    addWindow("relay", { url });
  };

  const variantStyles = {
    default: "cursor-crosshair",
    prompt: "cursor-crosshair hover:underline hover:decoration-dotted",
  };

  const displayUrl = formatRelayUrlForDisplay(url);
  const isInsecure = isInsecureRelay(url);

  /**
   * A relay's NIP-11 `name` is chosen by its operator and is not unique — six
   * different nostr.land hosts each report some variant of "nostr.land" — so
   * the name alone cannot identify a relay. The URL is the identity, but
   * showing both inline was too noisy, so it moves to hover.
   */
  const relayName = relayInfo?.name?.trim();
  const showName =
    !!relayName && relayName.toLowerCase() !== displayUrl.toLowerCase();

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-2",
        variantStyles[variant],
        className,
      )}
      onClick={handleClick}
    >
      <div className="flex items-center gap-1.5 min-w-0 flex-1 overflow-hidden">
        {relayInfo?.icon && (
          <img
            src={relayInfo.icon}
            alt=""
            className={cn("size-3 flex-shrink-0 rounded-sm", iconClassname)}
          />
        )}
        {isInsecure && (
          <HoverCard openDelay={200}>
            <HoverCardTrigger asChild>
              <div className="cursor-help">
                <ShieldAlert
                  className={cn(
                    "size-3 text-amber-600 dark:text-amber-500 flex-shrink-0",
                    iconClassname,
                  )}
                />
              </div>
            </HoverCardTrigger>
            <HoverCardContent
              side="top"
              className="w-64 text-xs"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="space-y-1">
                <div className="font-semibold">Insecure Connection</div>
                <p className="text-muted-foreground">
                  This relay uses unencrypted ws:// protocol. This is typically
                  only safe for localhost/development. Production relays should
                  use wss:// (secure WebSocket).
                </p>
              </div>
            </HoverCardContent>
          </HoverCard>
        )}
        {showName ? (
          <HoverCard openDelay={200}>
            <HoverCardTrigger asChild>
              <span className={cn("text-xs truncate min-w-0", urlClassname)}>
                {relayName}
              </span>
            </HoverCardTrigger>
            <HoverCardContent
              side="top"
              className="w-auto max-w-96 text-xs"
              onClick={(e) => e.stopPropagation()}
            >
              {/* The operator-chosen name is not unique, so the URL is the
                  only way to tell two same-named relays apart. */}
              <span className="font-mono break-all">{url}</span>
            </HoverCardContent>
          </HoverCard>
        ) : (
          <span
            className={cn("text-xs truncate", urlClassname)}
            title={displayUrl}
          >
            {displayUrl}
          </span>
        )}
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        {showInboxOutbox && read && (
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
        {showInboxOutbox && write && (
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
