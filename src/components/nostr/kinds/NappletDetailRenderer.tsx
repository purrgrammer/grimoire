import {
  Boxes,
  Code,
  ExternalLink,
  FileText,
  Fingerprint,
  HardDrive,
  Play,
  ShieldQuestion,
} from "lucide-react";
import {
  getNappletTitle,
  getNappletDescription,
  getNappletSource,
  getNappletIdentifier,
  getNappletPaths,
  getNappletServers,
  getNappletRequires,
  getNappletArchetypes,
  getNappletAggregateHash,
} from "@/lib/nip5d-helpers";
import { useAddWindow } from "@/core/state";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import type { NostrEvent } from "@/types/nostr";
import { useRunNapplet } from "@/hooks/useRunNapplet";

function NappletFileRow({
  path,
  hash,
  serverUrl,
}: {
  path: string;
  hash: string;
  serverUrl?: string;
}) {
  const addWindow = useAddWindow();

  return (
    <div
      className="-mx-1 flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-xs hover:bg-muted/30"
      onClick={() =>
        addWindow(
          "blossom",
          { subcommand: "blob", sha256: hash, serverUrl },
          `blossom blob ${hash.slice(0, 8)}`,
          undefined,
        )
      }
    >
      <span className="flex-1 truncate">{path}</span>
      <span className="shrink-0 font-mono text-muted-foreground">
        {hash.slice(0, 8)}…{hash.slice(-4)}
      </span>
    </div>
  );
}

function NappletDetailView({
  event,
  variant,
}: {
  event: NostrEvent;
  variant?: "snapshot";
}) {
  const paths = getNappletPaths(event);
  const servers = getNappletServers(event);
  const requires = getNappletRequires(event);
  const archetypes = getNappletArchetypes(event);
  const aggregate = getNappletAggregateHash(event);
  const identifier = getNappletIdentifier(event);
  const title = getNappletTitle(event);
  const description = getNappletDescription(event);
  const source = getNappletSource(event);
  const addWindow = useAddWindow();
  const run = useRunNapplet(event);

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <Boxes className="size-5 text-muted-foreground" />
          <h2 className="text-lg font-semibold">
            {title || identifier || "Napplet"}
          </h2>
          {identifier && <Label>{identifier}</Label>}
        </div>
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
        {variant === "snapshot" && (
          <p className="text-xs text-muted-foreground">
            A manifest snapshot (kind 5129) pinning one napplet version.
          </p>
        )}
        {aggregate && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Fingerprint className="size-3.5 shrink-0" />
            <span>aggregate</span>
            <span className="truncate font-mono" title={aggregate}>
              {aggregate.slice(0, 12)}…{aggregate.slice(-6)}
            </span>
          </div>
        )}
        <p className="text-xs text-muted-foreground/70">
          Unverified manifest tags — checked when the napplet runs.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <Button onClick={run}>
          <Play className="size-4" />
          Run
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

      {requires.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <ShieldQuestion className="size-4" />
            <span>Requires ({requires.length})</span>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            {requires.map((nap) => (
              <Label key={nap}>{nap}</Label>
            ))}
          </div>
        </div>
      )}

      {archetypes.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          {archetypes.map((a) => (
            <Label key={a.slug}>{a.convention || a.slug}</Label>
          ))}
        </div>
      )}

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
                <NappletFileRow
                  key={path}
                  path={path}
                  hash={hash}
                  serverUrl={servers[0]}
                />
              ))}
          </div>
        </div>
      )}

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
                className="group -mx-1 flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 hover:bg-muted/30"
                onClick={() =>
                  addWindow(
                    "blossom",
                    { subcommand: "server", serverUrl: url },
                    `blossom server ${url}`,
                    undefined,
                  )
                }
              >
                <HardDrive className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="flex-1 truncate font-mono text-xs underline decoration-dotted">
                  {url}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6 opacity-0 transition-opacity group-hover:opacity-100"
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
    </div>
  );
}

/** Kind 15129 Detail - Root Napplet Manifest */
export function NappletRootDetailRenderer({ event }: { event: NostrEvent }) {
  return <NappletDetailView event={event} />;
}

/** Kind 35129 Detail - Named Napplet Manifest */
export function NappletNamedDetailRenderer({ event }: { event: NostrEvent }) {
  return <NappletDetailView event={event} />;
}

/** Kind 5129 Detail - Napplet Manifest Snapshot */
export function NappletSnapshotDetailRenderer({
  event,
}: {
  event: NostrEvent;
}) {
  return <NappletDetailView event={event} variant="snapshot" />;
}
