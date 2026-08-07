import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Boxes, PenLine, X } from "lucide-react";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { UserName } from "./nostr/UserName";
import {
  subscribeNappletConsent,
  subscribeNappletSigning,
  allowNappletCapability,
  denyNappletCapability,
  describeCapability,
  type NappletConsentRequest,
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

function ConsentToast({
  request,
  onAllow,
  onDeny,
  onDismiss,
}: {
  request: NappletConsentRequest;
  onAllow: (remember: boolean) => void;
  onDeny: (remember: boolean) => void;
  onDismiss: () => void;
}) {
  const [remember, setRemember] = useState(false);

  return (
    <div className="min-w-[350px] max-w-[500px] overflow-hidden border border-border bg-background p-4 shadow-lg">
      <div className="flex items-start gap-3">
        <Boxes className="mt-0.5 size-5 flex-shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <div className="mb-1 text-sm font-semibold text-foreground">
              Permission request
            </div>
            {/* With several panes open an unattributed prompt is a spoofing
                surface, so the napplet is always named — by verified author,
                not just its self-declared title. */}
            <p className="line-clamp-3 text-xs text-muted-foreground">
              <Attribution title={request.title} pubkey={request.pubkey} />{" "}
              wants to {describeCapability(request.capability)}.
            </p>
            <p className="mt-1 font-mono text-[11px] text-muted-foreground/70">
              {request.capability}
            </p>
          </div>

          <div className="flex items-center space-x-2">
            <Checkbox
              id={`napplet-remember-${request.key}`}
              checked={remember}
              onCheckedChange={(checked) => setRemember(checked === true)}
            />
            <label
              htmlFor={`napplet-remember-${request.key}`}
              className="cursor-pointer text-xs text-muted-foreground"
            >
              Remember my choice
            </label>
          </div>

          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => onAllow(remember)}
              className="h-8 flex-1 bg-green-500 text-white hover:bg-green-600"
            >
              Allow
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onDeny(remember)}
              className="h-8 flex-1"
            >
              Deny
            </Button>
          </div>

          <p className="text-[11px] text-muted-foreground/70">
            Allowing re-runs the napplet so the permission takes effect.
          </p>
        </div>

        <button
          onClick={onDismiss}
          className="text-muted-foreground transition-colors hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}

function SigningToast({
  request,
  onAnswer,
}: {
  request: NappletSigningRequest;
  onAnswer: (allowed: boolean) => void;
}) {
  return (
    <div className="min-w-[350px] max-w-[500px] overflow-hidden border border-border bg-background p-4 shadow-lg">
      <div className="flex items-start gap-3">
        <PenLine className="mt-0.5 size-5 flex-shrink-0 text-warning" />
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <div className="mb-1 text-sm font-semibold text-foreground">
              Signing request
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
          {/* No "remember" here on purpose: a standing grant is what
              relay:write already is. This is the extra confirmation for
              operations that overwrite or destroy existing data. */}
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => onAnswer(true)}
              className="h-8 flex-1 bg-green-500 text-white hover:bg-green-600"
            >
              Sign
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
 * Renders napplet capability and signing prompts as top-right toasts,
 * mirroring GlobalAuthPrompt. No UI of its own — the toasts are the surface.
 */
export function GlobalNappletConsent() {
  const activeToasts = useRef<Map<string, string | number>>(new Map());

  useEffect(() => {
    return subscribeNappletConsent((requests) => {
      for (const request of requests) {
        if (activeToasts.current.has(request.key)) continue;

        const close = () => {
          const id = activeToasts.current.get(request.key);
          if (id !== undefined) toast.dismiss(id);
          activeToasts.current.delete(request.key);
        };

        const toastId = toast.custom(
          () => (
            <ConsentToast
              request={request}
              onAllow={(remember) => {
                close();
                allowNappletCapability(request, remember);
              }}
              onDeny={(remember) => {
                close();
                denyNappletCapability(request, remember);
                toast.info(
                  remember
                    ? `Won't ask again for ${request.capability}`
                    : `Denied ${request.capability}`,
                  { duration: 2000 },
                );
              }}
              // Dismissing is a refusal, but not a remembered one.
              onDismiss={() => {
                close();
                denyNappletCapability(request, false);
              }}
            />
          ),
          { duration: Infinity, position: "top-right" },
        );

        activeToasts.current.set(request.key, toastId);
      }

      // Drop toasts whose request was resolved elsewhere (e.g. window closed).
      const live = new Set(requests.map((r) => r.key));
      for (const [key, id] of activeToasts.current) {
        if (!live.has(key)) {
          toast.dismiss(id);
          activeToasts.current.delete(key);
        }
      }
    });
  }, []);

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
