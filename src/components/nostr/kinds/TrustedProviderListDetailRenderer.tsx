import { NostrEvent } from "@/types/nostr";
import { UserName } from "../UserName";
import { RelayLink } from "../RelayLink";
import {
  getTrustedProviders,
  hasEncryptedProviders,
  formatKindTag,
} from "@/lib/nip85-helpers";
import { Label } from "@/components/ui/label";
import { Shield, Lock } from "lucide-react";

/**
 * Trusted Provider List Detail Renderer (Kind 10040)
 * Stacked card layout for each provider entry — works at any panel width
 */
export function TrustedProviderListDetailRenderer({
  event,
}: {
  event: NostrEvent;
}) {
  const providers = getTrustedProviders(event);
  const hasEncrypted = hasEncryptedProviders(event);

  return (
    <div className="flex flex-col gap-5 p-6 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Shield className="size-5 text-muted-foreground" />
        <h2 className="text-lg font-semibold">Trusted Providers</h2>
      </div>

      {/* Author */}
      <div className="flex items-center gap-1.5 text-sm">
        <span className="text-muted-foreground">Declared by:</span>
        <UserName pubkey={event.pubkey} className="font-medium" />
      </div>

      {/* Encrypted notice */}
      {hasEncrypted && (
        <div className="flex items-center gap-2 p-3 rounded-md bg-muted/50 text-sm">
          <Lock className="size-4 text-muted-foreground" />
          <span className="text-muted-foreground">
            This list contains encrypted provider entries (NIP-44) that cannot
            be displayed.
          </span>
        </div>
      )}

      {/* Provider cards */}
      {providers.length > 0 ? (
        <div className="flex flex-col gap-2">
          {providers.map((p, i) => (
            <div
              key={`${p.servicePubkey}-${i}`}
              className="flex flex-col gap-2 p-3 rounded-md border border-border/50 bg-muted/30"
            >
              {/* Provider name */}
              <UserName
                pubkey={p.servicePubkey}
                relayHints={[p.relay]}
                className="text-sm font-medium"
              />

              {/* Kind tag */}
              <Label className="w-fit">{formatKindTag(p.kindTag)}</Label>

              {/* Relay */}
              <RelayLink url={p.relay} showInboxOutbox={false} />
            </div>
          ))}
        </div>
      ) : (
        <div className="text-sm text-muted-foreground italic">
          No public provider entries found.
        </div>
      )}
    </div>
  );
}
