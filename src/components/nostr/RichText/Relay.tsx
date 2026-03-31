import type { RelayNode } from "@/lib/relay-transformer";
import { RelayLink } from "../RelayLink";

interface RelayNodeProps {
  node: RelayNode;
}

/**
 * Renders a relay URL as a clickable link that opens the relay viewer
 */
export function Relay({ node }: RelayNodeProps) {
  return (
    <RelayLink
      url={node.url}
      className="inline-flex underline decoration-dotted cursor-crosshair hover:text-foreground [&>div]:items-baseline"
      urlClassname="text-[length:inherit]"
      iconClassname="size-3.5 self-center"
    />
  );
}
