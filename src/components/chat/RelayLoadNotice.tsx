import type { RelayLoadState } from "@/lib/relay-subscription";

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
          <li key={url} className="break-words">
            {url}:{" "}
            {result === "auth-required"
              ? "Authentication required. Respond to the relay auth prompt if available. Without an AUTH challenge from the relay, authentication is not possible."
              : result === "timeout"
                ? "Timed out waiting for stored messages."
                : "Relay did not finish loading stored messages."}
          </li>
        ))}
      </ul>
    </div>
  );
}
