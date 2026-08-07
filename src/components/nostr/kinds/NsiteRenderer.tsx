import { useState } from "react";
import { Globe, FileText, HardDrive, ExternalLink } from "lucide-react";
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
    return <Globe className={`${className} text-muted-foreground`} />;
  }

  return (
    <img
      src={faviconUrl}
      alt=""
      className={`${className} object-contain`}
      onError={() => setFailed(true)}
    />
  );
}

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
          className="flex items-center gap-1.5 text-sm font-medium"
        >
          <NsiteIcon faviconUrl={faviconUrl} className="size-4" />
          <span>{displayTitle}</span>
          {variant && (
            <span className="text-xs text-muted-foreground font-normal">
              ({variant})
            </span>
          )}
        </ClickableEventTitle>

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
          <a
            href={gatewayUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto flex items-center gap-1 hover:text-foreground"
            onClick={(e) => e.stopPropagation()}
          >
            <ExternalLink className="size-3.5" />
            <span>Visit</span>
          </a>
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
