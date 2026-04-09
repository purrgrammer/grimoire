import { useState } from "react";
import {
  ScrollText,
  Binary,
  User,
  FileText,
  Type,
  Hash,
  Calendar,
  Radio,
} from "lucide-react";
import {
  getScrollName,
  getScrollDescription,
  getScrollIcon,
  getScrollParams,
  getScrollContentSize,
  formatBytes,
} from "@/lib/nip5c-helpers";
import type { ScrollParamType } from "@/lib/nip5c-helpers";
import {
  BaseEventProps,
  BaseEventContainer,
  ClickableEventTitle,
} from "./BaseEventRenderer";
import { ScrollExecutor } from "@/components/scroll/ScrollExecutor";
import type { NostrEvent } from "@/types/nostr";
import type { LucideIcon } from "lucide-react";

export function ScrollIconImage({
  iconUrl,
  className,
}: {
  iconUrl?: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);

  if (!iconUrl || failed) {
    return <ScrollText className={`${className} text-muted-foreground`} />;
  }

  return (
    <img
      src={iconUrl}
      alt=""
      className={`${className} object-contain rounded-sm`}
      onError={() => setFailed(true)}
    />
  );
}

export const PARAM_CONFIG: Record<
  ScrollParamType,
  { icon: LucideIcon; placeholder: string; inputType: string }
> = {
  public_key: {
    icon: User,
    placeholder: "hex pubkey or npub...",
    inputType: "text",
  },
  event: {
    icon: FileText,
    placeholder: "event ID, note1..., or nevent...",
    inputType: "text",
  },
  string: { icon: Type, placeholder: "text value...", inputType: "text" },
  number: { icon: Hash, placeholder: "0", inputType: "number" },
  timestamp: {
    icon: Calendar,
    placeholder: "unix timestamp",
    inputType: "number",
  },
  relay: { icon: Radio, placeholder: "wss://...", inputType: "text" },
};

export function ScrollRenderer({ event }: BaseEventProps) {
  const name = getScrollName(event);
  const description = getScrollDescription(event);
  const iconUrl = getScrollIcon(event);
  const params = getScrollParams(event);
  const contentSize = getScrollContentSize(event);

  return (
    <BaseEventContainer event={event}>
      <div className="flex flex-col gap-2">
        <ClickableEventTitle
          event={event}
          className="flex items-center gap-1.5 text-sm font-medium"
        >
          <ScrollIconImage iconUrl={iconUrl} className="size-4" />
          <span>{name || "Unnamed Scroll"}</span>
        </ClickableEventTitle>

        {description && (
          <p className="text-xs text-muted-foreground line-clamp-2">
            {description}
          </p>
        )}

        {params.length > 0 && (
          <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
            {params.map((param) => {
              const { icon: Icon } = PARAM_CONFIG[param.type];
              return (
                <div key={param.name} className="flex items-center gap-1.5">
                  <Icon className="size-3 flex-shrink-0" />
                  <span>{param.name}</span>
                </div>
              );
            })}
          </div>
        )}

        {contentSize > 0 && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Binary className="size-3.5" />
            <span>{formatBytes(contentSize)}</span>
          </div>
        )}
      </div>
    </BaseEventContainer>
  );
}

export function ScrollDetailRenderer({ event }: { event: NostrEvent }) {
  const name = getScrollName(event);
  const description = getScrollDescription(event);
  const iconUrl = getScrollIcon(event);
  const contentSize = getScrollContentSize(event);
  const params = getScrollParams(event);

  return (
    <div className="flex flex-col gap-4 p-4 h-full">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <ScrollIconImage iconUrl={iconUrl} className="size-5" />
          <h2 className="text-lg font-semibold">{name || "Unnamed Scroll"}</h2>
        </div>
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
        {contentSize > 0 && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Binary className="size-3.5" />
            <span>~{formatBytes(contentSize)} WASM</span>
          </div>
        )}
      </div>

      <ScrollExecutor params={params} wasmBase64={event.content} />
    </div>
  );
}
