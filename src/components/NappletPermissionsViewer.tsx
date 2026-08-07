import { useCallback, useEffect, useMemo, useState } from "react";
import { Boxes, ShieldCheck, ShieldX, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { UserName } from "@/components/nostr/UserName";
import {
  getNappletDecisions,
  type NappletDecision,
} from "@/services/napplet-acl";
import {
  describeCapability,
  revokeNappletCapability,
  revokeAllNappletCapabilities,
} from "@/services/napplet-consent";
import { listNapplets } from "@/services/napplet-library";

interface Group {
  dTag: string;
  aggregateHash: string;
  title: string;
  pubkey?: string;
  allowed: NappletDecision[];
  denied: NappletDecision[];
}

/**
 * Everything the user has permanently answered, across every napplet.
 *
 * The per-window popover only covers whatever happens to be open; a consent
 * model needs one place that answers "what have I granted, and to whom".
 */
export function NappletPermissionsViewer() {
  // A synchronous localStorage read, so take it as initial state rather than
  // setting it from an effect and cascading a render on mount.
  const [decisions, setDecisions] =
    useState<NappletDecision[]>(getNappletDecisions);
  const [titles, setTitles] = useState<
    Map<string, { title: string; pubkey: string }>
  >(() => new Map());

  const refresh = useCallback(() => {
    setDecisions(getNappletDecisions());
  }, []);

  // Names come from the launcher's record of what was run, so a revoked
  // napplet is still identifiable rather than a bare d-tag.
  useEffect(() => {
    let cancelled = false;
    listNapplets().then((rows) => {
      if (cancelled) return;
      setTitles(
        new Map(
          rows.map((r) => [r.identifier, { title: r.title, pubkey: r.pubkey }]),
        ),
      );
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const groups = useMemo(() => {
    const byIdentity = new Map<string, Group>();
    for (const decision of decisions) {
      const key = `${decision.dTag}:${decision.aggregateHash}`;
      let group = byIdentity.get(key);
      if (!group) {
        const known = titles.get(decision.dTag);
        group = {
          dTag: decision.dTag,
          aggregateHash: decision.aggregateHash,
          title: known?.title ?? decision.dTag,
          pubkey: known?.pubkey,
          allowed: [],
          denied: [],
        };
        byIdentity.set(key, group);
      }
      (decision.allowed ? group.allowed : group.denied).push(decision);
    }
    return [...byIdentity.values()].sort((a, b) =>
      a.title.localeCompare(b.title),
    );
  }, [decisions, titles]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-b border-border px-4 py-2 font-mono text-xs text-muted-foreground">
        Permissions you have remembered, per napplet version
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {groups.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Nothing remembered yet. Answers you give a napplet with
            &ldquo;Remember my choice&rdquo; appear here.
          </p>
        ) : (
          groups.map((group) => (
            <div
              key={`${group.dTag}:${group.aggregateHash}`}
              className="space-y-2 rounded border border-border/40 p-3"
            >
              <div className="flex items-center gap-2">
                <Boxes className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate text-sm font-medium">
                  {group.title}
                </span>
                {group.pubkey && (
                  <span className="truncate text-xs text-muted-foreground">
                    <UserName pubkey={group.pubkey} />
                  </span>
                )}
                <span
                  className="ml-auto shrink-0 font-mono text-[11px] text-muted-foreground/70"
                  title={group.aggregateHash}
                >
                  {group.aggregateHash.slice(0, 8)}…
                </span>
              </div>

              <div className="flex flex-col gap-1">
                {[...group.allowed, ...group.denied].map((decision) => (
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
                      }}
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </div>
                ))}
              </div>

              <Button
                variant="outline"
                size="sm"
                className="h-7"
                onClick={() => {
                  revokeAllNappletCapabilities(group.dTag, group.aggregateHash);
                  refresh();
                }}
              >
                Forget all
              </Button>
            </div>
          ))
        )}

        <p className="text-[11px] text-muted-foreground/70">
          Answers apply to one exact version. A napplet update re-asks, and a
          running napplet only loses a permission on its next run.
        </p>
      </div>
    </div>
  );
}

export default NappletPermissionsViewer;
