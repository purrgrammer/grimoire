import { useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { PenLine } from "lucide-react";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { UserName } from "./nostr/UserName";
import {
  subscribeNappletSigning,
  type NappletSigningRequest,
} from "@/services/napplet-consent";

/**
 * A manifest `title` is author-chosen. It is signed, so it cannot be forged by
 * a third party, but nothing stops an author calling their napplet
 * "grimoire (system)". Clamp it and always pair it with the verified signing
 * pubkey so the prompt cannot impersonate the host.
 */
const MAX_TITLE = 48;

function clampTitle(title: string): string {
  return title.length > MAX_TITLE ? `${title.slice(0, MAX_TITLE)}…` : title;
}

function Attribution({ title, pubkey }: { title: string; pubkey?: string }) {
  return (
    <span className="inline-flex min-w-0 items-baseline gap-1">
      <span className="truncate font-medium text-foreground">
        {clampTitle(title)}
      </span>
      {pubkey && (
        <span className="shrink-0 text-muted-foreground">
          by <UserName pubkey={pubkey} className="text-inherit" />
        </span>
      )}
    </span>
  );
}

function SigningToast({
  request,
  onAnswer,
}: {
  request: NappletSigningRequest;
  onAnswer: (allowed: boolean) => void;
}) {
  const [remember, setRemember] = useState(false);
  const rememberId = useId();

  return (
    <div className="min-w-[350px] max-w-[500px] overflow-hidden border border-l-4 border-border border-l-warning bg-background p-4 shadow-lg">
      <div className="flex items-start gap-3">
        <PenLine className="mt-0.5 size-5 flex-shrink-0 text-warning" />
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <div className="mb-1 text-sm font-semibold text-foreground">
              {request.kind === "sign" ? "Signing request" : "Napplet request"}
            </div>
            <p className="line-clamp-3 text-xs text-muted-foreground">
              {request.title ? (
                <Attribution title={request.title} pubkey={request.pubkey} />
              ) : (
                <span className="font-medium text-foreground">A napplet</span>
              )}{" "}
              wants to {request.summary}.
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {request.detail}
            </p>
          </div>
          {/* A signing request never offers this: the standing grant for that
              is `relay:write` itself, and a signature is the one thing worth
              seeing every time. An action can offer it, and only ever for the
              allow — a remembered refusal is a silent throw the napplet
              swallows, which is indistinguishable from the feature being
              broken. */}
          {request.remember && (
            <label
              htmlFor={rememberId}
              className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground"
            >
              <Checkbox
                id={rememberId}
                checked={remember}
                onCheckedChange={(value) => setRemember(value === true)}
              />
              {request.remember.label}
            </label>
          )}
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => {
                if (remember) request.remember?.onAllow();
                onAnswer(true);
              }}
              className="h-8 flex-1 bg-green-500 text-white hover:bg-green-600"
            >
              {request.kind === "sign" ? "Sign" : "Allow"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onAnswer(false)}
              className="h-8 flex-1"
            >
              Refuse
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Signing confirmations, as top-right toasts.
 *
 * Capability consent is not here: it goes through the grouped dialog in
 * NappletLaunchConsent, so a napplet that asks for four things produces one
 * decision rather than four reflowing toasts.
 */
export function GlobalNappletConsent() {
  useEffect(() => {
    const shown = new Map<string, string | number>();
    const unsubscribe = subscribeNappletSigning((requests) => {
      for (const request of requests) {
        if (shown.has(request.key)) continue;
        const id = toast.custom(
          () => (
            <SigningToast
              request={request}
              onAnswer={(allowed) => {
                const toastId = shown.get(request.key);
                if (toastId !== undefined) toast.dismiss(toastId);
                shown.delete(request.key);
                request.resolve(allowed);
              }}
            />
          ),
          { duration: Infinity, position: "top-right" },
        );
        shown.set(request.key, id);
      }
      const live = new Set(requests.map((r) => r.key));
      for (const [key, id] of shown) {
        if (!live.has(key)) {
          toast.dismiss(id);
          shown.delete(key);
        }
      }
    });
    return () => {
      unsubscribe();
      // An unanswered signing prompt must not leave the signer hanging.
      shown.forEach((id) => toast.dismiss(id));
    };
  }, []);

  return null;
}
