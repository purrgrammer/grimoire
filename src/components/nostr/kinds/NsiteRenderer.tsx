import { useState } from "react";
import { Globe, FileText, HardDrive, ExternalLink } from "lucide-react";
// Commented out with `RunButton` below, and to be restored with it:
// import { Play } from "lucide-react";
// import { Button } from "@/components/ui/button";
// import { useRunNapplet } from "@/hooks/useRunNapplet";
// import type { NostrEvent } from "@/types/nostr";
import {
  getNsitePaths,
  getNsiteServers,
  getNsiteIdentifier,
  getNsiteGatewayUrl,
} from "@/lib/nip5a-helpers";
import { useNsiteMetadata } from "@/hooks/useNsiteMetadata";
import {
  BaseEventProps,
  BaseEventContainer,
  ClickableEventTitle,
} from "./BaseEventRenderer";

/**
 * Shows favicon with Globe fallback on error or when unavailable
 */
function NsiteIcon({
  faviconUrl,
  className,
}: {
  faviconUrl?: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);

  if (!faviconUrl || failed) {
    return <Globe className={`${className} shrink-0 text-muted-foreground`} />;
  }

  return (
    <img
      src={faviconUrl}
      alt=""
      className={`${className} shrink-0 object-contain`}
      onError={() => setFailed(true)}
    />
  );
}

/*
 * Running an nsite locally is parked, not abandoned — see issue #324.
 *
 * Everything behind this works and is verified in development: the manifest is
 * checked, every file is hashed, and the site runs on an origin of its own so
 * it cannot reach grimoire's storage or keys. What is missing is production.
 * `VITE_NSITE_ORIGIN` is unset and the code fails closed, so shipping this
 * button today would offer an action that cannot work outside a dev server.
 *
 * `Visit` stays. It hands the reader to a gateway, which is a different trust
 * story and an honest one — it just is not this one.
 *
 * To bring it back: uncomment the button below, and the `Play`, `Button` and
 * `useRunNapplet` imports with it. `app <naddr>` still runs an nsite, so
 * nothing under it goes stale in the meantime.
 */
// function RunButton({ event }: { event: NostrEvent }) {
//   const run = useRunNapplet(event);
//
//   return (
//     <Button
//       size="sm"
//       className="h-7 shrink-0"
//       onClick={(e) => {
//         e.stopPropagation();
//         run();
//       }}
//     >
//       <Play className="size-3.5 shrink-0" />
//       Run
//     </Button>
//   );
// }

/**
 * Shared nsite feed renderer
 */
function NsiteRendererInner({
  event,
  variant,
}: BaseEventProps & { variant?: "legacy" | "snapshot" }) {
  const paths = getNsitePaths(event);
  const servers = getNsiteServers(event);
  const identifier = getNsiteIdentifier(event);
  const { title, faviconUrl } = useNsiteMetadata(event);
  const gatewayUrl = getNsiteGatewayUrl(event);

  const displayTitle = title || (identifier ? `/${identifier}` : "Nsite");

  return (
    <BaseEventContainer event={event}>
      <div className="flex flex-col gap-2">
        <ClickableEventTitle
          event={event}
          className="flex min-w-0 items-center gap-1.5 text-sm font-medium"
        >
          <NsiteIcon faviconUrl={faviconUrl} className="size-4" />
          <span className="truncate">{displayTitle}</span>
          {variant && (
            <span className="text-xs text-muted-foreground font-normal">
              ({variant})
            </span>
          )}
        </ClickableEventTitle>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {paths.length > 0 && (
            <div className="flex shrink-0 items-center gap-1 whitespace-nowrap">
              <FileText className="size-3.5 shrink-0" />
              <span>
                {paths.length} file{paths.length !== 1 ? "s" : ""}
              </span>
            </div>
          )}
          {servers.length > 0 && (
            <div className="flex shrink-0 items-center gap-1 whitespace-nowrap">
              <HardDrive className="size-3.5 shrink-0" />
              <span>
                {servers.length} server{servers.length !== 1 ? "s" : ""}
              </span>
            </div>
          )}
          <a
            href={gatewayUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto flex shrink-0 items-center gap-1 whitespace-nowrap hover:text-foreground"
            onClick={(e) => e.stopPropagation()}
          >
            <ExternalLink className="size-3.5 shrink-0" />
            <span>Visit</span>
          </a>
          {/* Verified here, against the manifest, rather than trusted from a
              gateway — so it is the primary action and `Visit` is the escape.
              Parked until there is an origin to run it on in production. */}
          {/* <RunButton event={event} /> */}
        </div>
      </div>
    </BaseEventContainer>
  );
}

/**
 * Kind 15128 Renderer - Root Nsite Manifest (Feed View)
 */
export function NsiteRootRenderer({ event }: BaseEventProps) {
  return <NsiteRendererInner event={event} />;
}

/**
 * Kind 35128 Renderer - Named Nsite Manifest (Feed View)
 */
export function NsiteNamedRenderer({ event }: BaseEventProps) {
  return <NsiteRendererInner event={event} />;
}

/**
 * Kind 34128 Renderer - Legacy Nsite (Feed View, deprecated)
 */
export function NsiteLegacyRenderer({ event }: BaseEventProps) {
  return <NsiteRendererInner event={event} variant="legacy" />;
}

/**
 * Kind 5128 Renderer - Nsite Manifest Snapshot (Feed View)
 */
export function NsiteSnapshotRenderer({ event }: BaseEventProps) {
  return <NsiteRendererInner event={event} variant="snapshot" />;
}
