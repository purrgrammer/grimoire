import { NostrEvent } from "@/types/nostr";
import { UserName } from "../UserName";
import {
  getTrustedProviders,
  hasEncryptedProviders,
  formatKindTag,
} from "@/lib/nip85-helpers";
import { Shield, Lock, Radio } from "lucide-react";

/**
 * Trusted Provider List Detail Renderer (Kind 10040)
 * Full table of all public provider entries
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

      {/* Provider table */}
      {providers.length > 0 ? (
        <div className="flex flex-col gap-0.5">
          {/* Table header */}
          <div className="grid grid-cols-[1fr_1fr_auto] gap-3 pb-2 border-b border-border text-xs text-muted-foreground font-medium">
            <span>Metric</span>
            <span>Provider</span>
            <span>Relay</span>
          </div>

          {/* Rows */}
          {providers.map((p, i) => (
            <div
              key={`${p.kindTag}-${i}`}
              className="grid grid-cols-[1fr_1fr_auto] gap-3 py-2 border-b border-border/30 last:border-0 items-center"
            >
              <span className="text-sm font-mono">
                {formatKindTag(p.kindTag)}
              </span>
              <UserName pubkey={p.servicePubkey} className="text-sm" />
              <span className="flex items-center gap-1 text-xs text-muted-foreground font-mono truncate max-w-48">
                <Radio className="size-3 shrink-0" />
                {p.relay}
              </span>
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
