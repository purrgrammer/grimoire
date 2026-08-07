import { useState } from "react";
import {
  Globe,
  FileText,
  HardDrive,
  ExternalLink,
  Code,
  Radio,
  GitBranch,
  Fingerprint,
} from "lucide-react";
import { nip19 } from "nostr-tools";
import {
  getNsitePaths,
  getNsiteServers,
  getNsiteRelays,
  getNsiteIdentifier,
  getNsiteSource,
  getNsiteGatewayUrl,
  getNsiteAggregateHash,
  getNsiteParent,
  getNsiteOrigin,
  type NsiteLineage,
} from "@/lib/nip5a-helpers";
import { useNsiteMetadata } from "@/hooks/useNsiteMetadata";
import { useAddWindow } from "@/core/state";
import { RelayLink } from "../RelayLink";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import type { NostrEvent } from "@/types/nostr";

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

function NsiteFileRow({
  path,
  hash,
  serverUrl,
}: {
  path: string;
  hash: string;
  serverUrl?: string;
}) {
  const addWindow = useAddWindow();

  const handleClick = () => {
    addWindow(
      "blossom",
      { subcommand: "blob", sha256: hash, serverUrl },
      `blossom blob ${hash.slice(0, 8)}`,
      undefined,
    );
  };

  return (
    <div
      className="flex items-center gap-2 py-0.5 px-1 -mx-1 text-xs rounded hover:bg-muted/30 cursor-pointer group"
      onClick={handleClick}
    >
      <span className="truncate flex-1">{path}</span>
      <span className="font-mono text-muted-foreground shrink-0">
        {hash.slice(0, 8)}…{hash.slice(-4)}
      </span>
    </div>
  );
}

/**
 * A parent (`a`) or origin (`A`) coordinate, opening the referenced nsite
 */
function NsiteLineageRow({
  label,
  lineage,
}: {
  label: string;
  lineage: NsiteLineage;
}) {
  const addWindow = useAddWindow();

  const handleClick = () => {
    const pointer = {
      kind: lineage.kind,
      pubkey: lineage.pubkey,
      identifier: lineage.identifier,
      relays: lineage.relay ? [lineage.relay] : undefined,
    };
    addWindow(
      "open",
      { pointer },
      `open ${nip19.naddrEncode(pointer)}`,
      undefined,
    );
  };

  return (
    <div
      className="flex items-center gap-2 py-0.5 px-1 -mx-1 text-xs rounded hover:bg-muted/30 cursor-pointer"
      onClick={handleClick}
    >
      <GitBranch className="size-3.5 text-muted-foreground shrink-0" />
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="font-mono underline decoration-dotted truncate">
        {lineage.kind}:{lineage.pubkey.slice(0, 8)}…
        {lineage.identifier ? `:${lineage.identifier}` : ""}
      </span>
    </div>
  );
}

/**
 * Shared detail view for all nsite kinds
 */
function NsiteDetailView({
  event,
  variant,
}: {
  event: NostrEvent;
  variant?: "legacy" | "snapshot";
}) {
  const paths = getNsitePaths(event);
  const servers = getNsiteServers(event);
  const relays = getNsiteRelays(event);
  const identifier = getNsiteIdentifier(event);
  const source = getNsiteSource(event);
  const gatewayUrl = getNsiteGatewayUrl(event);
  const aggregateHash = getNsiteAggregateHash(event);
  const parent = getNsiteParent(event);
  const origin = getNsiteOrigin(event);
  const { title, description, faviconUrl } = useNsiteMetadata(event);
  const addWindow = useAddWindow();

  const displayTitle = title || (identifier ? `/${identifier}` : "Nsite");

  const handleServerClick = (serverUrl: string) => {
    addWindow(
      "blossom",
      { subcommand: "server", serverUrl },
      `blossom server ${serverUrl}`,
      undefined,
    );
  };

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <NsiteIcon faviconUrl={faviconUrl} className="size-5" />
          <h2 className="text-lg font-semibold">{displayTitle}</h2>
          {identifier && <Label>{identifier}</Label>}
        </div>
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
        {variant === "legacy" && (
          <p className="text-xs text-yellow-500">
            This is a legacy nsite event (kind 34128). New sites should use kind
            15128 or 35128.
          </p>
        )}
        {variant === "snapshot" && (
          <p className="text-xs text-muted-foreground">
            A manifest snapshot (kind 5128) pinning one version of a site.
          </p>
        )}
        {aggregateHash && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Fingerprint className="size-3.5 shrink-0" />
            <span>aggregate</span>
            <span className="font-mono truncate">
              {aggregateHash.slice(0, 12)}…{aggregateHash.slice(-6)}
            </span>
          </div>
        )}
      </div>

      {/* Lineage */}
      {(parent || origin) && (
        <div className="flex flex-col gap-0.5">
          {origin && <NsiteLineageRow label="origin" lineage={origin} />}
          {parent && <NsiteLineageRow label="parent" lineage={parent} />}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" asChild>
          <a href={gatewayUrl} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="size-3.5" />
            View Site
          </a>
        </Button>
        {source && (
          <Button variant="ghost" size="sm" asChild>
            <a href={source} target="_blank" rel="noopener noreferrer">
              <Code className="size-3.5" />
              Source
            </a>
          </Button>
        )}
      </div>

      {/* Files */}
      {paths.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <FileText className="size-4" />
            <span>Files ({paths.length})</span>
          </div>
          <div className="flex flex-col gap-0.5">
            {[...paths]
              .sort((a, b) => a.path.localeCompare(b.path))
              .map(({ path, hash }) => (
                <NsiteFileRow
                  key={path}
                  path={path}
                  hash={hash}
                  serverUrl={servers[0]}
                />
              ))}
          </div>
        </div>
      )}

      {/* Servers */}
      {servers.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <HardDrive className="size-4" />
            <span>Blossom Servers ({servers.length})</span>
          </div>
          <div className="flex flex-col gap-0.5">
            {servers.map((url) => (
              <div
                key={url}
                className="flex items-center gap-2 py-0.5 group cursor-pointer hover:bg-muted/30 rounded px-1 -mx-1"
                onClick={() => handleServerClick(url)}
              >
                <HardDrive className="size-3.5 text-muted-foreground flex-shrink-0" />
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
        </div>
      )}

      {/* Relays */}
      {relays.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Radio className="size-4" />
            <span>Relays ({relays.length})</span>
          </div>
          <div className="flex flex-col gap-0.5">
            {relays.map((url) => (
              <RelayLink key={url} url={url} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Kind 15128 Detail Renderer - Root Nsite Manifest
 */
export function NsiteRootDetailRenderer({ event }: { event: NostrEvent }) {
  return <NsiteDetailView event={event} />;
}

/**
 * Kind 35128 Detail Renderer - Named Nsite Manifest
 */
export function NsiteNamedDetailRenderer({ event }: { event: NostrEvent }) {
  return <NsiteDetailView event={event} />;
}

/**
 * Kind 34128 Detail Renderer - Legacy Nsite (deprecated)
 */
export function NsiteLegacyDetailRenderer({ event }: { event: NostrEvent }) {
  return <NsiteDetailView event={event} variant="legacy" />;
}

/**
 * Kind 5128 Detail Renderer - Nsite Manifest Snapshot
 */
export function NsiteSnapshotDetailRenderer({ event }: { event: NostrEvent }) {
  return <NsiteDetailView event={event} variant="snapshot" />;
}
