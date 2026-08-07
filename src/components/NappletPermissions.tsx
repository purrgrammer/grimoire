import { useCallback, useState } from "react";
import { ShieldCheck, Trash2 } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  getNappletDecisions,
  type NappletDecision,
} from "@/services/napplet-acl";
import {
  describeCapability,
  revokeNappletCapability,
  revokeAllNappletCapabilities,
} from "@/services/napplet-consent";

/**
 * What this napplet version has been permanently allowed or refused, and a way
 * to take it back.
 *
 * A consent system without an undo is a trap: the user answers once, possibly
 * by accident, and has no way to see or change it afterwards.
 */
export function NappletPermissions({
  dTag,
  aggregateHash,
  onChanged,
}: {
  dTag: string;
  aggregateHash: string;
  onChanged: () => void;
}) {
  const [decisions, setDecisions] = useState<NappletDecision[]>([]);

  const refresh = useCallback(() => {
    setDecisions(
      getNappletDecisions().filter(
        (d) => d.dTag === dTag && d.aggregateHash === aggregateHash,
      ),
    );
  }, [dTag, aggregateHash]);

  return (
    <Popover onOpenChange={(open) => open && refresh()}>
      <PopoverTrigger asChild>
        <button
          className="flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
          title="Permissions"
          aria-label="Permissions"
        >
          <ShieldCheck className="size-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <div className="mb-2 text-sm font-semibold">Remembered permissions</div>
        {decisions.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Nothing remembered for this version. You will be asked the next time
            it needs something.
          </p>
        ) : (
          <div className="flex flex-col gap-1">
            {decisions.map((decision) => (
              <div
                key={decision.capability}
                className="flex items-center gap-2 text-xs"
              >
                <Label>{decision.allowed ? "allowed" : "denied"}</Label>
                <span className="flex-1 truncate">
                  {describeCapability(decision.capability)}
                </span>
                <button
                  className="text-muted-foreground transition-colors hover:text-destructive"
                  title="Forget this answer"
                  aria-label={`Forget ${decision.capability}`}
                  onClick={() => {
                    revokeNappletCapability(
                      decision.dTag,
                      decision.aggregateHash,
                      decision.capability,
                    );
                    refresh();
                    onChanged();
                  }}
                >
                  <Trash2 className="size-3" />
                </button>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              className="mt-2 h-7"
              onClick={() => {
                revokeAllNappletCapabilities(dTag, aggregateHash);
                refresh();
                onChanged();
              }}
            >
              Forget all
            </Button>
          </div>
        )}
        <p className="mt-2 text-[11px] text-muted-foreground/70">
          Answers apply to this exact version. An update re-asks.
        </p>
      </PopoverContent>
    </Popover>
  );
}
