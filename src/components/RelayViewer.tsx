import { Copy, CopyCheck } from "lucide-react";
import { useRelayInfo } from "../hooks/useRelayInfo";
import { useCopy } from "../hooks/useCopy";
import { Button } from "./ui/button";
import { UserName } from "./nostr/UserName";
import { RelaySupportedNips } from "./nostr/RelaySupportedNips";

export interface RelayViewerProps {
  url: string;
}

export function RelayViewer({ url }: RelayViewerProps) {
  const info = useRelayInfo(url);
  const { copy, copied } = useCopy();

  return (
    <div className="flex flex-col gap-6 p-4">
      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="flex-1">
          <h2 className="text-2xl font-bold">
            {info?.name || "Unknown Relay"}
          </h2>
          <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground">
            {url}
            <Button
              variant="link"
              size="icon"
              className="size-4 text-muted-foreground"
              onClick={() => copy(url)}
            >
              {copied ? (
                <CopyCheck className="size-3" />
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
          <div className="space-y-2 text-sm text-accent">
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
      {info?.supported_nips && (
        <RelaySupportedNips nips={info.supported_nips} />
      )}
    </div>
  );
}
