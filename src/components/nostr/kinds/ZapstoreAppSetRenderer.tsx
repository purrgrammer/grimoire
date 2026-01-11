import {
  BaseEventContainer,
  BaseEventProps,
  ClickableEventTitle,
} from "./BaseEventRenderer";
import {
  getCurationSetName,
  getAppReferences,
  getAppName,
} from "@/lib/zapstore-helpers";
import { useNostrEvent } from "@/hooks/useNostrEvent";
import { useGrimoire } from "@/core/state";
import { Package } from "lucide-react";

function AppItem({
  address,
}: {
  address: { kind: number; pubkey: string; identifier: string };
}) {
  const { addWindow } = useGrimoire();
  const appEvent = useNostrEvent(address);
  const appName = appEvent
    ? getAppName(appEvent)
    : address?.identifier || "Unknown App";

  const handleClick = () => {
    addWindow("open", { pointer: address });
  };

  return (
    <div className="flex items-center gap-2">
      <Package className="size-3 text-muted-foreground" />
      <button
        onClick={handleClick}
        className="text-sm hover:underline cursor-crosshair text-primary truncate"
      >
        {appName}
      </button>
    </div>
  );
}

/**
 * Renderer for Kind 30267 - App Collection
 * Compact feed view listing all apps similar to relay lists
 */
export function ZapstoreAppSetRenderer({ event }: BaseEventProps) {
  const setName = getCurationSetName(event);
  const apps = getAppReferences(event);

  return (
    <BaseEventContainer event={event}>
      <div className="flex flex-col gap-2">
        <ClickableEventTitle
          event={event}
          className="text-base font-semibold text-foreground"
        >
          {setName}
        </ClickableEventTitle>

        <p className="text-sm text-muted-foreground">
          {apps.length} {apps.length === 1 ? "app" : "apps"}
        </p>

        {apps.length > 0 && (
          <div className="flex flex-col gap-0.5">
            {apps.map((ref, idx) => (
              <AppItem key={idx} address={ref.address} />
            ))}
          </div>
        )}
      </div>
    </BaseEventContainer>
  );
}
