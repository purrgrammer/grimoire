import { NostrEvent } from "@/types/nostr";
import {
  getReleaseVersion,
  getReleaseIdentifier,
  getReleaseFileEventId,
  getReleaseAppPointer,
  getAppName,
  getAppIcon,
} from "@/lib/zapstore-helpers";
import { useNostrEvent } from "@/hooks/useNostrEvent";
import { useGrimoire } from "@/core/state";
import { Badge } from "@/components/ui/badge";
import { UserName } from "../UserName";
import {
  Package,
  FileDown,
  ExternalLink as ExternalLinkIcon,
} from "lucide-react";
import { Kind1063Renderer } from "./FileMetadataRenderer";

interface ZapstoreReleaseDetailRendererProps {
  event: NostrEvent;
}

/**
 * Detail renderer for Kind 30063 - App Release
 * Shows release information with embedded file metadata
 */
export function ZapstoreReleaseDetailRenderer({
  event,
}: ZapstoreReleaseDetailRendererProps) {
  const { addWindow } = useGrimoire();
  const version = getReleaseVersion(event);
  const identifier = getReleaseIdentifier(event);
  const fileEventId = getReleaseFileEventId(event);
  const appPointer = getReleaseAppPointer(event);

  const appEvent = useNostrEvent(appPointer || undefined);
  const fileEvent = useNostrEvent(
    fileEventId ? { id: fileEventId } : undefined,
    event,
  );

  const appName = appEvent ? getAppName(appEvent) : appPointer?.identifier;
  const appIcon = appEvent ? getAppIcon(appEvent) : undefined;

  const handleAppClick = () => {
    if (appPointer) {
      addWindow("open", { pointer: appPointer });
    }
  };

  return (
    <div className="flex flex-col gap-6 p-6 max-w-4xl mx-auto">
      <div className="flex gap-4">
        {appIcon ? (
          <img
            src={appIcon}
            alt={appName || "App"}
            className="size-20 rounded-lg object-cover flex-shrink-0"
            loading="lazy"
          />
        ) : (
          <div className="size-20 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
            <Package className="size-10 text-primary" />
          </div>
        )}

        <div className="flex flex-col gap-2 flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <h1 className="text-3xl font-bold">{appName || "Release"}</h1>
            {version && (
              <Badge variant="default" className="text-base px-3 py-1">
                v{version}
              </Badge>
            )}
          </div>

          {appName && appPointer && (
            <button
              onClick={handleAppClick}
              className="flex items-center gap-2 text-primary hover:underline text-left"
            >
              <ExternalLinkIcon className="size-4" />
              <span>View App Details</span>
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 text-sm">
        <div className="flex flex-col gap-1">
          <h3 className="text-muted-foreground">Publisher</h3>
          <UserName pubkey={event.pubkey} />
        </div>

        {identifier && (
          <div className="flex flex-col gap-1">
            <h3 className="text-muted-foreground">Release ID</h3>
            <code className="font-mono text-sm truncate" title={identifier}>
              {identifier}
            </code>
          </div>
        )}
      </div>

      {fileEvent && (
        <div className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <FileDown className="size-5" />
            Download
          </h2>
          <div className="border border-border rounded-lg overflow-hidden">
            <Kind1063Renderer event={fileEvent} depth={0} />
          </div>
        </div>
      )}

      {fileEventId && !fileEvent && (
        <div className="flex items-center gap-2 p-4 bg-muted/20 rounded-lg text-muted-foreground">
          <FileDown className="size-5" />
          <span>Loading file metadata...</span>
        </div>
      )}

      {!fileEventId && (
        <div className="flex items-center gap-2 p-4 bg-muted/20 rounded-lg text-muted-foreground">
          <FileDown className="size-5" />
          <span>No file metadata available</span>
        </div>
      )}
    </div>
  );
}
