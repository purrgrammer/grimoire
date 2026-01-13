import { BaseEventProps, BaseEventContainer } from "./BaseEventRenderer";
import { NostrEvent } from "@/types/nostr";
import { getServersFromEvent } from "@/services/blossom";
import { useGrimoire } from "@/core/state";
import { HardDrive, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Kind 10063 Renderer - Blossom User Server List (Feed View)
 * Shows the user's configured Blossom blob storage servers
 */
export function BlossomServerListRenderer({ event }: BaseEventProps) {
  const { addWindow } = useGrimoire();
  const servers = getServersFromEvent(event);

  const handleServerClick = (serverUrl: string) => {
    // Open the blossom viewer with specific server info
    addWindow(
      "blossom",
      { subcommand: "server", serverUrl },
      `blossom server ${serverUrl}`,
      undefined,
    );
  };

  if (servers.length === 0) {
    return (
      <BaseEventContainer event={event}>
        <div className="text-xs text-muted-foreground italic">
          No Blossom servers configured
        </div>
      </BaseEventContainer>
    );
  }

  return (
    <BaseEventContainer event={event}>
      <div className="flex flex-col gap-0.5">
        {servers.map((url) => (
          <div
            key={url}
            className="flex items-center gap-2 py-0.5 group cursor-pointer hover:bg-muted/30 rounded px-1 -mx-1"
            onClick={() => handleServerClick(url)}
          >
            <HardDrive className="size-4 text-muted-foreground flex-shrink-0" />
            <span className="font-mono text-xs underline decoration-dotted flex-1 truncate">
              {url}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="size-6 opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={(e) => {
                e.stopPropagation();
                window.open(url, "_blank");
              }}
            >
              <ExternalLink className="size-3" />
            </Button>
          </div>
        ))}
      </div>
    </BaseEventContainer>
  );
}

/**
 * Kind 10063 Detail Renderer - Blossom User Server List (Detail View)
 * Shows full Blossom server list with clickable links
 */
export function BlossomServerListDetailRenderer({
  event,
}: {
  event: NostrEvent;
}) {
  const { addWindow } = useGrimoire();
  const servers = getServersFromEvent(event);

  const handleServerClick = (serverUrl: string) => {
    addWindow(
      "blossom",
      { subcommand: "server", serverUrl },
      `blossom server ${serverUrl}`,
      undefined,
    );
  };

  if (servers.length === 0) {
    return (
      <div className="p-4 text-center text-muted-foreground text-sm">
        No Blossom servers configured
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 p-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
        <HardDrive className="size-4" />
        <span>Blossom Servers ({servers.length})</span>
      </div>
      {servers.map((url) => (
        <div
          key={url}
          className="flex items-center gap-3 p-2 rounded hover:bg-muted/30 cursor-pointer group"
          onClick={() => handleServerClick(url)}
        >
          <HardDrive className="size-4 text-muted-foreground flex-shrink-0" />
          <span className="font-mono text-sm underline decoration-dotted flex-1 truncate">
            {url}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={(e) => {
              e.stopPropagation();
              window.open(url, "_blank");
            }}
          >
            <ExternalLink className="size-4" />
          </Button>
        </div>
      ))}
    </div>
  );
}
