import {
  BaseEventProps,
  BaseEventContainer,
  ClickableEventTitle,
} from "./BaseEventRenderer";
import { UserName } from "../UserName";
import {
  getTrustedProviders,
  hasEncryptedProviders,
  formatKindTag,
} from "@/lib/nip85-helpers";
import { Shield, Lock } from "lucide-react";

/**
 * Trusted Provider List Renderer — Feed View (Kind 10040)
 * Shows the user's declared trusted assertion providers
 */
export function TrustedProviderListRenderer({ event }: BaseEventProps) {
  const providers = getTrustedProviders(event);
  const hasEncrypted = hasEncryptedProviders(event);
  const previewProviders = providers.slice(0, 4);

  return (
    <BaseEventContainer event={event}>
      <div className="flex flex-col gap-2">
        <ClickableEventTitle event={event} className="text-base font-semibold">
          <span className="flex items-center gap-1.5">
            <Shield className="size-4 text-muted-foreground" />
            Trusted Providers
          </span>
        </ClickableEventTitle>

        {/* Provider count */}
        <span className="text-xs text-muted-foreground">
          {providers.length} public provider{providers.length !== 1 ? "s" : ""}
          {hasEncrypted && " + encrypted entries"}
        </span>

        {/* Preview of provider entries */}
        {previewProviders.length > 0 && (
          <div className="flex flex-col gap-1">
            {previewProviders.map((p, i) => (
              <div
                key={`${p.kindTag}-${i}`}
                className="flex items-center gap-2 text-xs"
              >
                <span className="text-muted-foreground font-mono shrink-0">
                  {formatKindTag(p.kindTag)}
                </span>
                <span className="text-muted-foreground">-</span>
                <UserName pubkey={p.servicePubkey} className="text-xs" />
              </div>
            ))}
            {providers.length > 4 && (
              <span className="text-xs text-muted-foreground">
                +{providers.length - 4} more...
              </span>
            )}
          </div>
        )}

        {/* Encrypted notice */}
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
