import { Copy, Check, Server } from "lucide-react";
import { useRelayInfo } from "../hooks/useRelayInfo";
import { useCopy } from "../hooks/useCopy";
import { Button } from "./ui/button";
import { UserName } from "./nostr/UserName";
import { NIPBadge } from "./NIPBadge";

export interface RelayViewerProps {
  url: string;
}

export function RelayViewer({ url }: RelayViewerProps) {
  const info = useRelayInfo(url);
  const { copy, copied } = useCopy();

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        {info?.icon ? (
          <img src={info.icon} alt={info.name || url} className="size-16" />
        ) : (
          <Server className="size-16 text-muted-foreground" />
        )}
        <div className="flex-1">
          <h2 className="text-2xl font-bold">
            {info?.name || "Unknown Relay"}
          </h2>
          <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground">
            {url}
            <Button
              variant="ghost"
              size="icon"
              className="size-5"
              onClick={() => copy(url)}
            >
              {copied ? (
                <Check className="size-3" />
              ) : (
                <Copy className="size-3" />
              )}
            </Button>
          </div>
          {info?.description && (
            <p className="text-sm mt-2">{info.description}</p>
          )}
        </div>
      </div>

      {/* Operator */}
      {(info?.contact || info?.pubkey) && (
        <div>
          <h3 className="mb-2 font-semibold text-sm">Operator</h3>
          <div className="space-y-2 text-sm">
            {info.contact && info.contact.length == 64 && (
              <UserName pubkey={info.contact} />
            )}
            {info.pubkey && info.pubkey.length === 64 && (
              <UserName pubkey={info.pubkey} />
            )}
          </div>
        </div>
      )}

      {/* Software */}
      {(info?.software || info?.version) && (
        <div>
          <h3 className="mb-2 font-semibold text-sm">Software</h3>
          <span className="text-sm text-muted-foreground">
            {info.software || info.version}
          </span>
        </div>
      )}

      {/* Supported NIPs */}
      {info?.supported_nips && info.supported_nips.length > 0 && (
        <div>
          <h3 className="mb-3 font-semibold text-sm">Supported NIPs</h3>
          <div className="flex flex-wrap gap-2">
            {info.supported_nips.map((num: number) => (
              <NIPBadge key={num} nipNumber={num} showName={true} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
