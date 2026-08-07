import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Boxes, X } from "lucide-react";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import {
  subscribeNappletConsent,
  allowNappletCapability,
  denyNappletCapability,
  describeCapability,
  type NappletConsentRequest,
} from "@/services/napplet-consent";

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
            {/* Naming the napplet matters: with several panes open, an
                unattributed prompt is a spoofing surface. */}
            <p className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">
                {request.title}
              </span>{" "}
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

/**
 * Renders napplet capability prompts as top-right toasts, mirroring
 * GlobalAuthPrompt. No UI of its own — the toasts are the whole surface.
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
                    ? `Blocked ${request.title}`
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

  return null;
}
