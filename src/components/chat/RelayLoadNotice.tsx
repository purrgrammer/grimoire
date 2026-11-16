import { useState } from "react";
import { use$ } from "applesauce-react/hooks";
import { toast } from "sonner";
import type { RelayLoadState } from "@/lib/relay-subscription";
import { RelayLink } from "@/components/nostr/RelayLink";
import { Button } from "@/components/ui/button";
import { useAccount } from "@/hooks/useAccount";
import { useRelayState } from "@/hooks/useRelayState";
import pool from "@/services/relay-pool";

/** Keep available history visible, but never describe an incomplete read as empty. */
export function RelayLoadNotice({ state }: { state?: RelayLoadState }) {
  if (state?.status !== "partial") return null;
  const failed = Object.entries(state.relays).filter(
    ([, result]) => result !== "pending" && result !== "eose",
  );
  return (
    <div
      role="status"
      className="border-b px-3 py-2 text-xs text-muted-foreground"
    >
      <p>Message history may be incomplete.</p>
      <ul>
        {failed.map(([url, result]) => (
          <li key={url} className="flex flex-wrap items-center gap-1">
            <RelayLink url={url} showInboxOutbox={false} />
            <span>
              {result === "auth-required" ? (
                <AuthRequired url={url} />
              ) : result === "timeout" ? (
                "Timed out waiting for stored messages."
              ) : (
                "Relay did not finish loading stored messages."
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * What the reader can do about a relay that refused the read.
 *
 * A relay may answer `auth-required` without ever sending an AUTH challenge;
 * then there is nothing to sign, and offering a button would be a lie. When it
 * did send one — possibly a prompt the reader dismissed earlier — authenticate
 * on request: applesauce is still holding the refused REQ and replays it once
 * the relay confirms.
 */
function AuthRequired({ url }: { url: string }) {
  const status = use$(() => pool.relays.get(url)?.status$, [url]);
  const { canSign } = useAccount();
  const { authenticateRelay } = useRelayState();
  const [busy, setBusy] = useState(false);

  if (!status?.challenge) {
    return (
      <>
        Authentication required, but the relay sent no AUTH challenge, so
        authentication is not possible.
      </>
    );
  }
  if (!canSign) {
    return <>Authentication required. Sign in with an account that can sign.</>;
  }
  return (
    <>
      Authentication required.{" "}
      <Button
        size="sm"
        variant="outline"
        className="h-6 px-2 text-xs"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await authenticateRelay(url);
          } catch (error) {
            toast.error(
              `Authentication failed: ${error instanceof Error ? error.message : "Unknown error"}`,
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Authenticating…" : "Authenticate"}
      </Button>
    </>
  );
}
