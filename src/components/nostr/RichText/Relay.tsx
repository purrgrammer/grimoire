import type { RelayNode } from "@/lib/relay-transformer";
import { RelayLink } from "@/components/nostr/RelayLink";

interface RelayNodeProps {
  node: RelayNode;
}

/**
 * Renders a relay URL as a clickable link that opens the relay viewer
 */
export function Relay({ node }: RelayNodeProps) {
  const { url } = node;

  return (
    <RelayLink
      url={url}
      variant="prompt"
      showInboxOutbox={false}
      className="inline-flex"
    />
  );
}
