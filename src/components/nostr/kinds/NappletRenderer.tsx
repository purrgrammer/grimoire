import { Boxes, FileText, HardDrive, Play } from "lucide-react";
import { useRunNapplet } from "@/hooks/useRunNapplet";
import {
  getNappletTitle,
  getNappletDescription,
  getNappletIdentifier,
  getNappletPaths,
  getNappletServers,
  getNappletRequires,
} from "@/lib/nip5d-helpers";
import { Label } from "@/components/ui/label";
import type { NostrEvent } from "@/types/nostr";
import {
  BaseEventProps,
  BaseEventContainer,
  ClickableEventTitle,
} from "./BaseEventRenderer";

function RunButton({ event }: { event: NostrEvent }) {
  const run = useRunNapplet(event);

  return (
    <button
      type="button"
      className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted/40 hover:text-foreground"
      onClick={(e) => {
        e.stopPropagation();
        run();
      }}
    >
      <Play className="size-3.5" />
      <span>Run</span>
    </button>
  );
}

function NappletRendererInner({
  event,
  variant,
}: BaseEventProps & { variant?: "snapshot" }) {
  const paths = getNappletPaths(event);
  const servers = getNappletServers(event);
  const requires = getNappletRequires(event);
  const identifier = getNappletIdentifier(event);
  const title = getNappletTitle(event);
  const description = getNappletDescription(event);

  const displayTitle = title || identifier || "Napplet";

  return (
    <BaseEventContainer event={event}>
      <div className="flex flex-col gap-2">
        <ClickableEventTitle
          event={event}
          className="flex items-center gap-1.5 text-sm font-medium"
        >
          <Boxes className="size-4 text-muted-foreground" />
          <span>{displayTitle}</span>
          {variant && (
            <span className="text-xs font-normal text-muted-foreground">
              ({variant})
            </span>
          )}
        </ClickableEventTitle>

        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}

        {requires.length > 0 && (
          <div className="flex flex-wrap items-center gap-1">
            {requires.map((nap) => (
              <Label key={nap}>{nap}</Label>
            ))}
          </div>
        )}

        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {paths.length > 0 && (
            <div className="flex items-center gap-1">
              <FileText className="size-3.5" />
              <span>
                {paths.length} file{paths.length !== 1 ? "s" : ""}
              </span>
            </div>
          )}
          {servers.length > 0 && (
            <div className="flex items-center gap-1">
              <HardDrive className="size-3.5" />
              <span>
                {servers.length} server{servers.length !== 1 ? "s" : ""}
              </span>
            </div>
          )}
          <div className="ml-auto">
            <RunButton event={event} />
          </div>
        </div>
      </div>
    </BaseEventContainer>
  );
}

/** Kind 15129 - Root Napplet Manifest (Feed View) */
export function NappletRootRenderer({ event }: BaseEventProps) {
  return <NappletRendererInner event={event} />;
}

/** Kind 35129 - Named Napplet Manifest (Feed View) */
export function NappletNamedRenderer({ event }: BaseEventProps) {
  return <NappletRendererInner event={event} />;
}

/** Kind 5129 - Napplet Manifest Snapshot (Feed View) */
export function NappletSnapshotRenderer({ event }: BaseEventProps) {
  return <NappletRendererInner event={event} variant="snapshot" />;
}
