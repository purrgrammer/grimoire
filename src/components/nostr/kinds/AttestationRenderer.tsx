import {
  BaseEventProps,
  BaseEventContainer,
  ClickableEventTitle,
} from "./BaseEventRenderer";
import { Label } from "@/components/ui/label";
import { QuotedEvent } from "../QuotedEvent";
import { getTagValue } from "applesauce-core/helpers";
import { parseReplaceableAddress } from "applesauce-core/helpers/pointers";
import { ShieldCheck, Clock, AlertCircle, XCircle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatTimestamp } from "@/hooks/useLocale";
import { useGrimoire } from "@/core/state";

const STATUS_CONFIG: Record<
  string,
  { label: string; icon: React.ElementType; color: string; bg: string }
> = {
  verifying: {
    label: "Verifying",
    icon: AlertCircle,
    color: "text-amber-600",
    bg: "bg-amber-50",
  },
  valid: {
    label: "Valid",
    icon: CheckCircle2,
    color: "text-emerald-600",
    bg: "bg-emerald-50",
  },
  invalid: {
    label: "Invalid",
    icon: XCircle,
    color: "text-red-600",
    bg: "bg-red-50",
  },
  revoked: {
    label: "Revoked",
    icon: XCircle,
    color: "text-slate-500",
    bg: "bg-slate-50",
  },
};

function StatusBadge({ status }: { status: string }) {
  const config = STATUS_CONFIG[status] ?? {
    label: status,
    icon: ShieldCheck,
    color: "text-muted-foreground",
    bg: "bg-muted",
  };
  const Icon = config.icon;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium",
        config.bg,
        config.color,
      )}
    >
      <Icon className="size-3" />
      {config.label}
    </span>
  );
}

/**
 * Renderer for Kind 31871 - Attestation
 * Displays attestation status, referenced assertion, validity window, and notes.
 */
export function AttestationRenderer({ event }: BaseEventProps) {
  const { locale } = useGrimoire();

  const status = getTagValue(event, "s");
  const validFrom = getTagValue(event, "valid_from");
  const validTo = getTagValue(event, "valid_to");
  const eTag = getTagValue(event, "e");
  const aTag = getTagValue(event, "a");

  const validFromTs = validFrom ? parseInt(validFrom, 10) : undefined;
  const validToTs = validTo ? parseInt(validTo, 10) : undefined;

  const aPointer = aTag ? parseReplaceableAddress(aTag) : undefined;

  return (
    <BaseEventContainer event={event}>
      <div className="flex flex-col gap-2.5">
        {/* Header: kind label + status */}
        <div className="flex items-center gap-2">
          <Label className="w-fit">Attestation</Label>
          {status && <StatusBadge status={status} />}
        </div>

        {/* Referenced assertion */}
        {eTag && (
          <QuotedEvent eventPointer={{ id: eTag }} depth={2} />
        )}
        {aPointer && (
          <QuotedEvent addressPointer={aPointer} depth={2} />
        )}

        {/* Validity window */}
        {(validFromTs || validToTs) && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="size-3" />
            {validFromTs && (
              <span>From {formatTimestamp(validFromTs, "absolute", locale.locale)}</span>
            )}
            {validFromTs && validToTs && <span>–</span>}
            {validToTs && (
              <span>To {formatTimestamp(validToTs, "absolute", locale.locale)}</span>
            )}
          </div>
        )}

        {/* Note / content */}
        {event.content && (
          <ClickableEventTitle
            event={event}
            className="text-sm text-foreground line-clamp-3 leading-relaxed"
          >
            {event.content}
          </ClickableEventTitle>
        )}
      </div>
    </BaseEventContainer>
  );
}
