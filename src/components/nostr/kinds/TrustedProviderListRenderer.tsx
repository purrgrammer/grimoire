import {
  BaseEventProps,
  BaseEventContainer,
  ClickableEventTitle,
} from "./BaseEventRenderer";
import { Badge } from "@/components/ui/badge";
import { UserName } from "../UserName";
import { RelayLink } from "../RelayLink";
import {
  getTrustedProviders,
  hasEncryptedProviders,
} from "@/lib/nip85-helpers";
import { Shield, Lock } from "lucide-react";

/**
 * Trusted Provider List Renderer — Feed View (Kind 10040)
 * Shows the user's declared trusted assertion providers
 */
export function TrustedProviderListRenderer({ event }: BaseEventProps) {
  const providers = getTrustedProviders(event);
  const hasEncrypted = hasEncryptedProviders(event);
  const previewProviders = providers.slice(0, 3);

  return (
    <BaseEventContainer event={event}>
      <div className="flex flex-col gap-2">
        <ClickableEventTitle event={event} className="text-base font-semibold">
          <span className="flex items-center gap-1.5">
            <Shield className="size-4 text-muted-foreground" />
            Trusted Providers
          </span>
        </ClickableEventTitle>

        {/* Compact summary */}
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" className="h-5 px-1.5 text-muted-foreground">
            {providers.length} provider{providers.length !== 1 ? "s" : ""}
          </Badge>
          {hasEncrypted && (
            <Badge
              variant="outline"
              className="h-5 px-1.5 gap-1 text-muted-foreground"
            >
              <Lock className="size-3" />
              Encrypted
            </Badge>
          )}
        </div>

        {/* Provider preview */}
        {previewProviders.length > 0 && (
          <div className="flex flex-col gap-1">
            {previewProviders.map((p, i) => (
              <div
                key={`${p.servicePubkey}-${i}`}
                className="flex items-center gap-1.5 text-xs text-muted-foreground"
              >
                <UserName
                  pubkey={p.servicePubkey}
                  relayHints={[p.relay]}
                  className="text-xs"
                />
                <span className="text-muted-foreground/50">on</span>
                <RelayLink
                  url={p.relay}
                  showInboxOutbox={false}
                  className="inline-flex"
                />
              </div>
            ))}
            {providers.length > 3 && (
              <span className="text-xs text-muted-foreground">
                +{providers.length - 3} more
              </span>
            )}
          </div>
        )}

        {/* All-encrypted fallback */}
        {hasEncrypted && providers.length === 0 && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Lock className="size-3" />
            <span>All provider entries are encrypted</span>
          </div>
        )}
      </div>
    </BaseEventContainer>
  );
}
