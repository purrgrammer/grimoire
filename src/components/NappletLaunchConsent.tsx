import { useEffect, useState } from "react";
import { Boxes, ShieldQuestion } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { UserName } from "./nostr/UserName";
import {
  subscribeNappletLaunch,
  describeCapability,
  type NappletLaunchRequest,
} from "@/services/napplet-consent";

/** Author-chosen and unbounded — clamp it and pair it with the signing pubkey. */
const MAX_TITLE = 48;

/** Writes go above reads: the consequential ones should be read first. */
function isWrite(capability: string): boolean {
  return /:(write|send|forward|bind|call|control|channel)$/.test(capability);
}

function LaunchDialog({ request }: { request: NappletLaunchRequest }) {
  const [allowed, setAllowed] = useState<Set<string>>(
    () => new Set(request.capabilities),
  );

  const ordered = [...request.capabilities].sort((a, b) => {
    const byKind = Number(isWrite(b)) - Number(isWrite(a));
    return byKind !== 0 ? byKind : a.localeCompare(b);
  });

  const title =
    request.title.length > MAX_TITLE
      ? `${request.title.slice(0, MAX_TITLE)}…`
      : request.title;

  return (
    <Dialog open onOpenChange={(open) => !open && request.resolve(null)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Boxes className="size-5 text-muted-foreground" />
            <span className="truncate">{title}</span>
          </DialogTitle>
          <DialogDescription>
            {request.undeclared ? (
              <>
                Published by <UserName pubkey={request.pubkey} /> and verified.
                It is asking for something its manifest never declared, so it
                was refused. Allowing re-runs it.
              </>
            ) : (
              <>
                Published by <UserName pubkey={request.pubkey} /> and verified.
                It asks for the following before it runs.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          {ordered.map((capability) => (
            <label
              key={capability}
              className="flex cursor-pointer items-start gap-2 rounded px-1 py-1 hover:bg-muted/40"
            >
              <Checkbox
                className="mt-0.5"
                checked={allowed.has(capability)}
                onCheckedChange={(checked) =>
                  setAllowed((prev) => {
                    const next = new Set(prev);
                    if (checked === true) next.add(capability);
                    else next.delete(capability);
                    return next;
                  })
                }
              />
              <span className="min-w-0 flex-1">
                <span className="block text-sm">
                  {describeCapability(capability)}
                </span>
                <span className="block font-mono text-[11px] text-muted-foreground/70">
                  {capability}
                  {isWrite(capability) && " · acts as you"}
                </span>
              </span>
            </label>
          ))}

          {request.unenforceable.length > 0 && (
            <div className="mt-1 flex items-start gap-2 rounded border border-l-4 border-l-warning bg-card p-2">
              <ShieldQuestion className="mt-0.5 size-4 shrink-0 text-warning" />
              <div className="min-w-0 flex-1 space-y-1">
                <p className="text-xs">
                  These have no permission of their own, so each action is
                  confirmed individually instead.
                </p>
                <div className="flex flex-wrap gap-1">
                  {request.unenforceable.map((domain) => (
                    <Label key={domain}>{domain}</Label>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="ghost" onClick={() => request.resolve(null)}>
            {request.undeclared ? "Cancel" : "Don't run"}
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => request.resolve([])}>
              {request.undeclared ? "Deny all" : "Run with none"}
            </Button>
            <Button onClick={() => request.resolve([...allowed])}>
              {request.undeclared ? "Allow" : "Run"}
              {allowed.size > 0 && ` ${allowed.size}`}
            </Button>
          </div>
        </DialogFooter>

        <p className="text-[11px] text-muted-foreground/70">
          Your answer applies to this exact version. An update re-asks.
          {request.undeclared &&
            " A napplet should declare what it needs in its manifest."}
        </p>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The one dialog a well-behaved napplet shows.
 *
 * Everything the verified manifest declared is answered here, before any of its
 * code runs, so grants never require re-running the napplet. Only capabilities
 * a manifest failed to declare fall through to the per-use toasts.
 */
export function NappletLaunchConsent() {
  const [requests, setRequests] = useState<NappletLaunchRequest[]>([]);

  useEffect(() => subscribeNappletLaunch(setRequests), []);

  // Modal and serial: two launch dialogs at once would be unattributable.
  const current = requests[0];
  return current ? <LaunchDialog key={current.key} request={current} /> : null;
}
