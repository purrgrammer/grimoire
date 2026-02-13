import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Key, X } from "lucide-react";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { useRelayState } from "@/hooks/useRelayState";
import { RelayLink } from "./nostr/RelayLink";

interface AuthToastProps {
  relayUrl: string;
  challenge: string;
  onAuthenticate: (remember: boolean) => Promise<void>;
  onReject: (remember: boolean) => Promise<void>;
  onDismiss: () => void;
}

function AuthToast({
  relayUrl,
  challenge,
  onAuthenticate,
  onReject,
  onDismiss,
}: AuthToastProps) {
  const [remember, setRemember] = useState(false);
  const [loading, setLoading] = useState(false);

  return (
    <div className="bg-background border border-border shadow-lg p-4 min-w-[350px] max-w-[500px] overflow-hidden">
      <div className="flex items-start gap-3">
        <Key className="size-5 text-yellow-500 flex-shrink-0 mt-0.5" />
        <div className="flex-1 space-y-3 min-w-0">
          <div>
            <div className="font-semibold text-sm text-foreground mb-1">
              Authentication Request
            </div>
            <RelayLink
              url={relayUrl}
              showInboxOutbox={false}
              variant="prompt"
              iconClassname="size-4"
              urlClassname="text-sm"
            />
          </div>

          <div className="flex items-center space-x-2">
            <Checkbox
              id={`remember-${challenge}`}
              checked={remember}
              onCheckedChange={(checked) => setRemember(checked === true)}
            />
            <label
              htmlFor={`remember-${challenge}`}
              className="text-xs text-muted-foreground cursor-pointer"
            >
              Remember my choice
            </label>
          </div>

          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={async () => {
                setLoading(true);
                try {
                  await onAuthenticate(remember);
                } finally {
                  setLoading(false);
                }
              }}
              disabled={loading}
              className="flex-1 bg-green-500 hover:bg-green-600 text-white h-8"
            >
              Yes
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                setLoading(true);
                try {
                  await onReject(remember);
                } finally {
                  setLoading(false);
                }
              }}
              disabled={loading}
              className="flex-1 h-8"
            >
              No
            </Button>
          </div>
        </div>

        <button
          onClick={onDismiss}
          disabled={loading}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}

/**
 * Global auth prompt using sonner toast - shows when any relay requests authentication
 * Displays pending auth challenges as minimalistic toasts with infinite duration
 */
export function GlobalAuthPrompt() {
  const {
    pendingChallenges,
    authenticateRelay,
    rejectAuth,
    setAuthPreference,
    relays,
  } = useRelayState();

  const activeToasts = useRef<Map<string, string | number>>(new Map());
  const [authenticatingRelays, setAuthenticatingRelays] = useState<Set<string>>(
    new Set(),
  );

  // Watch for authentication success and show toast
  useEffect(() => {
    authenticatingRelays.forEach((relayUrl) => {
      const relayState = relays[relayUrl];
      if (relayState && relayState.authStatus === "authenticated") {
        toast.success(`Authenticated with ${relayUrl}`, {
          duration: 2500,
        });
        setAuthenticatingRelays((prev) => {
          const next = new Set(prev);
          next.delete(relayUrl);
          return next;
        });
      }
    });
  }, [relays, authenticatingRelays]);

  useEffect(() => {
    // Show toasts for new challenges
    pendingChallenges.forEach((challenge) => {
      const key = challenge.relayUrl;

      // Skip if we already have a toast for this relay
      if (activeToasts.current.has(key)) {
        return;
      }

      const toastId = toast.custom(
        (t) => (
          <AuthToast
            relayUrl={challenge.relayUrl}
            challenge={challenge.challenge}
            onAuthenticate={async (remember) => {
              if (remember) {
                setAuthPreference(challenge.relayUrl, "always");
              }

              activeToasts.current.delete(key);
              toast.dismiss(t);

              setAuthenticatingRelays((prev) =>
                new Set(prev).add(challenge.relayUrl),
              );

              try {
                await authenticateRelay(challenge.relayUrl);
              } catch (error) {
                console.error("Auth failed:", error);
                setAuthenticatingRelays((prev) => {
                  const next = new Set(prev);
                  next.delete(challenge.relayUrl);
                  return next;
                });
                toast.error(
                  `Authentication failed: ${error instanceof Error ? error.message : "Unknown error"}`,
                  {
                    duration: 5000,
                  },
                );
              }
            }}
            onReject={async (remember) => {
              if (remember) {
                setAuthPreference(challenge.relayUrl, "never");
              }

              rejectAuth(challenge.relayUrl, !remember);
              activeToasts.current.delete(key);
              toast.dismiss(t);

              const message = remember
                ? `Will never prompt auth for ${challenge.relayUrl}`
                : `Won't ask again this session for ${challenge.relayUrl}`;
              toast.info(message, {
                duration: 2000,
              });
            }}
            onDismiss={() => {
              rejectAuth(challenge.relayUrl, true);
              activeToasts.current.delete(key);
              toast.dismiss(t);
            }}
          />
        ),
        {
          duration: Infinity,
          position: "top-right",
        },
      );

      activeToasts.current.set(key, toastId);
    });

    // Dismiss toasts for challenges that are no longer pending
    activeToasts.current.forEach((toastId, relayUrl) => {
      const stillPending = pendingChallenges.some(
        (c) => c.relayUrl === relayUrl,
      );
      if (!stillPending) {
        toast.dismiss(toastId);
        activeToasts.current.delete(relayUrl);
      }
    });
  }, [pendingChallenges, authenticateRelay, rejectAuth, setAuthPreference]);

  return null; // No UI needed - toasts handle everything
}
