import { ShieldCheck, ShieldX, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { NappletDecision } from "@/services/napplet-acl";
import {
  describeCapability,
  allowNappletCapability,
  revokeNappletCapability,
  revokeAllNappletCapabilities,
} from "@/services/napplet-consent";

/**
 * What a napplet version has been permanently allowed or refused, and the undo.
 *
 * A consent system without an undo is a trap: the user answers once, possibly by
 * accident, and then cannot see or change it. This renders the list itself and
 * nothing around it, so the running napplet's own popover and the launcher row
 * for a napplet that is *not* running are the same list rather than two that
 * drift.
 *
 * The caller owns the decisions and the refresh: one reads a live subscription,
 * the other reads on popover open, and neither should pay for the other's.
 */
export function NappletDecisions({
  decisions,
  onChanged,
  emptyText,
}: {
  /** Already filtered to one `(dTag, aggregateHash)`. */
  decisions: NappletDecision[];
  onChanged: () => void;
  emptyText: string;
}) {
  if (decisions.length === 0) {
    return <p className="text-xs text-muted-foreground">{emptyText}</p>;
  }

  // Allowed first: a granted capability is the one worth taking back, and a
  // refusal is already the safe state.
  const ordered = [
    ...decisions.filter((d) => d.allowed),
    ...decisions.filter((d) => !d.allowed),
  ];

  return (
    <div className="flex flex-col gap-1">
      {ordered.map((decision) => (
        <div
          key={decision.capability}
          className="flex items-center gap-2 text-xs"
        >
          {decision.allowed ? (
            <ShieldCheck className="size-3 shrink-0 text-muted-foreground" />
          ) : (
            <ShieldX className="size-3 shrink-0 text-warning" />
          )}
          <span className="flex-1 truncate">
            {describeCapability(decision.capability)}
          </span>
          <Label>{decision.allowed ? "allowed" : "denied"}</Label>
          {!decision.allowed && (
            // A refusal is otherwise a dead end: the launch dialog treats a
            // remembered deny as final and never mentions the capability
            // again, so the flow that caused the "no" cannot undo it. This is
            // the way back — and it re-runs the napplet, because the runtime
            // was seeded with the refusal when its frame was built.
            <button
              className="text-muted-foreground transition-colors hover:text-foreground"
              title="Allow this, and re-run the napplet"
              aria-label={`Allow ${decision.capability}`}
              onClick={() => {
                allowNappletCapability(
                  decision.dTag,
                  decision.aggregateHash,
                  decision.capability,
                );
                onChanged();
              }}
            >
              <ShieldCheck className="size-3" />
            </button>
          )}
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
        className="mt-2 h-7 w-fit"
        onClick={() => {
          revokeAllNappletCapabilities(
            ordered[0].dTag,
            ordered[0].aggregateHash,
          );
          onChanged();
        }}
      >
        Forget all
      </Button>
    </div>
  );
}
