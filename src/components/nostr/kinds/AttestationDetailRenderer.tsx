import { NostrEvent } from "@/types/nostr";
import { UserName } from "../UserName";
import { QuotedEvent } from "../QuotedEvent";
import { getTagValue } from "applesauce-core/helpers";
import { parseReplaceableAddress } from "applesauce-core/helpers/pointers";
import {
  ShieldCheck,
  AlertCircle,
  XCircle,
  CheckCircle2,
  FileText,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatTimestamp } from "@/hooks/useLocale";
import { useGrimoire } from "@/core/state";

const STATUS_CONFIG: Record<
  string,
  { label: string; icon: React.ElementType; color: string; border: string }
> = {
  verifying: {
    label: "Verifying",
    icon: AlertCircle,
    color: "text-amber-600",
    border: "border-amber-200",
  },
  valid: {
    label: "Valid",
    icon: CheckCircle2,
    color: "text-emerald-600",
    border: "border-emerald-200",
  },
  invalid: {
    label: "Invalid",
    icon: XCircle,
    color: "text-red-600",
    border: "border-red-200",
  },
  revoked: {
    label: "Revoked",
    icon: XCircle,
    color: "text-slate-500",
    border: "border-slate-200",
  },
};

function StatusHeader({ status }: { status: string }) {
  const config = STATUS_CONFIG[status] ?? {
    label: status,
    icon: ShieldCheck,
    color: "text-muted-foreground",
    border: "border-border",
  };
  const Icon = config.icon;

  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-lg border px-3 py-2",
        config.border,
        config.color,
      )}
    >
      <Icon className="size-5" />
      <span className="text-sm font-semibold">{config.label}</span>
    </div>
  );
}

function DetailRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 py-2 border-b border-border/30 last:border-0">
      <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <div className="text-sm">{value}</div>
    </div>
  );
}

/**
 * Detail renderer for Kind 31871 - Attestation
 * Full view with all tags, referenced event, validity window, and notes.
 */
export function AttestationDetailRenderer({
  event,
}: {
  event: NostrEvent;
}) {
  const { locale } = useGrimoire();

  const status = getTagValue(event, "s");
  const validFrom = getTagValue(event, "valid_from");
  const validTo = getTagValue(event, "valid_to");
  const expiration = getTagValue(event, "expiration");
  const dTag = getTagValue(event, "d");
  const eTag = getTagValue(event, "e");
  const aTag = getTagValue(event, "a");
  const requestTag = getTagValue(event, "request");

  const validFromTs = validFrom ? parseInt(validFrom, 10) : undefined;
  const validToTs = validTo ? parseInt(validTo, 10) : undefined;
  const expirationTs = expiration ? parseInt(expiration, 10) : undefined;

  const aPointer = aTag ? parseReplaceableAddress(aTag) : undefined;

  return (
    <div className="flex flex-col gap-5 p-6 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-2">
        <ShieldCheck className="size-5 text-muted-foreground" />
        <h2 className="text-lg font-semibold">Attestation</h2>
      </div>

      {/* Attestor */}
      <div className="flex items-center gap-1.5 text-sm">
        <span className="text-muted-foreground">Attestor:</span>
        <UserName pubkey={event.pubkey} className="font-medium" />
      </div>

      {/* Status */}
      {status && <StatusHeader status={status} />}

      {/* Assertion reference */}
      {(eTag || aPointer) && (
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Assertion
          </span>
          {eTag && <QuotedEvent eventPointer={{ id: eTag }} depth={1} />}
          {aPointer && <QuotedEvent addressPointer={aPointer} depth={1} />}
        </div>
      )}

      {/* Metadata */}
      <div className="flex flex-col">
        {dTag && (
          <DetailRow
            label="Identifier"
            value={<span className="font-mono text-xs break-all">{dTag}</span>}
          />
        )}
        {validFromTs && (
          <DetailRow
            label="Valid From"
            value={formatTimestamp(validFromTs, "long", locale.locale)}
          />
        )}
        {validToTs && (
          <DetailRow
            label="Valid To"
            value={formatTimestamp(validToTs, "long", locale.locale)}
          />
        )}
        {expirationTs && (
          <DetailRow
            label="Expires"
            value={formatTimestamp(expirationTs, "long", locale.locale)}
          />
        )}
        {requestTag && (
          <DetailRow
            label="Request"
            value={
              <span className="font-mono text-xs break-all">{requestTag}</span>
            }
          />
        )}
      </div>

      {/* Notes */}
      {event.content && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            <FileText className="size-3" />
            Notes
          </div>
          <div className="text-sm whitespace-pre-wrap break-words leading-relaxed">
            {event.content}
          </div>
        </div>
      )}
    </div>
  );
}
