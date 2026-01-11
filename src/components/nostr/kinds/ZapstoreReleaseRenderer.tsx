import {
  BaseEventContainer,
  BaseEventProps,
  ClickableEventTitle,
} from "./BaseEventRenderer";
import {
  getReleaseVersion,
  getReleaseFileEventId,
  getReleaseAppPointer,
  getAppName,
} from "@/lib/zapstore-helpers";
import { useNostrEvent } from "@/hooks/useNostrEvent";
import { useGrimoire } from "@/core/state";
import { Badge } from "@/components/ui/badge";
import { Package, FileDown } from "lucide-react";

/**
 * Renderer for Kind 30063 - Zapstore Release
 * Displays release version and links to app and file metadata
 */
export function ZapstoreReleaseRenderer({ event }: BaseEventProps) {
  const { addWindow } = useGrimoire();
  const version = getReleaseVersion(event);
  const fileEventId = getReleaseFileEventId(event);
  const appPointer = getReleaseAppPointer(event);

  // Fetch app metadata to show app name
  const appEvent = useNostrEvent(appPointer || undefined);
  const appName = appEvent ? getAppName(appEvent) : appPointer?.identifier;

  const handleAppClick = () => {
    if (appPointer) {
      addWindow("open", { pointer: appPointer });
    }
  };

  const handleFileClick = () => {
    if (fileEventId) {
      addWindow("open", { pointer: { id: fileEventId } });
    }
  };

  return (
    <BaseEventContainer event={event}>
      <div className="flex flex-col gap-2">
        {/* Title */}
        <ClickableEventTitle
          event={event}
          className="text-base font-semibold text-foreground"
        >
          {appName && `${appName} `}
          {version && (
            <Badge variant="secondary" className="text-xs ml-1">
              v{version}
            </Badge>
          )}
        </ClickableEventTitle>

        {/* Links */}
        <div className="flex items-center gap-3 flex-wrap text-sm">
          {/* App Link */}
          {appName && (
            <button
              onClick={handleAppClick}
              className="flex items-center gap-1.5 text-primary hover:underline"
            >
              <Package className="size-3" />
              <span>View App</span>
            </button>
          )}

          {/* File Link */}
          {fileEventId && (
            <button
              onClick={handleFileClick}
              className="flex items-center gap-1.5 text-primary hover:underline"
            >
              <FileDown className="size-3" />
              <span>Download File</span>
            </button>
          )}
        </div>
      </div>
    </BaseEventContainer>
  );
}
