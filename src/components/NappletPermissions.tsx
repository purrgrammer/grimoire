import { useCallback, useState } from "react";
import { ShieldCheck } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  getNappletDecisions,
  type NappletDecision,
} from "@/services/napplet-acl";
import { NappletDecisions } from "@/components/NappletDecisions";

/**
 * The running napplet's own permissions, in its window chrome.
 *
 * Reads on open rather than subscribing: this is behind a popover that is shut
 * almost always, and the answers it shows were given by dialogs this same
 * window raised.
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
        <NappletDecisions
          decisions={decisions}
          emptyText="Nothing remembered for this version. You will be asked the next time it needs something."
          onChanged={() => {
            refresh();
            onChanged();
          }}
        />
        <p className="mt-2 text-[11px] text-muted-foreground/70">
          Answers apply to this exact version. An update re-asks.
        </p>
      </PopoverContent>
    </Popover>
  );
}
