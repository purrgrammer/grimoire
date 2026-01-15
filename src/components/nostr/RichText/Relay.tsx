import type { RelayNode } from "@/lib/relay-transformer";
import { useGrimoire } from "@/core/state";

interface RelayNodeProps {
  node: RelayNode;
}

/**
 * Format relay URL for display by removing protocol and trailing slashes
 */
function formatRelayUrlForDisplay(url: string): string {
  return url
    .replace(/^wss?:\/\//, "") // Remove ws:// or wss://
    .replace(/\/$/, ""); // Remove trailing slash
}

/**
 * Renders a relay URL as a clickable link that opens the relay viewer
 */
export function Relay({ node }: RelayNodeProps) {
  const { addWindow } = useGrimoire();
  const { url } = node;

  const displayUrl = formatRelayUrlForDisplay(url);

  const openRelay = () => {
    addWindow("relay", { url });
  };

  return (
    <button
      onClick={openRelay}
      className="text-muted-foreground underline decoration-dotted hover:text-foreground cursor-crosshair"
      title={url}
    >
      {displayUrl}
    </button>
  );
}
