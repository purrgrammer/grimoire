import type { ProfileContent } from "applesauce-core/helpers";
import type { NostrEvent } from "nostr-tools";

export function derivePlaceholderName(pubkey: string): string {
  return `${pubkey.slice(0, 4)}:${pubkey.slice(-4)}`;
}

export function getTagValues(event: NostrEvent, tagName: string): string[] {
  return event.tags
    .filter((tag) => tag[0] === tagName && tag[1])
    .map((tag) => tag[1]);
}

export function getDisplayName(
  pubkey: string,
  metadata?: ProfileContent,
): string {
  if (metadata?.display_name) {
    return metadata.display_name;
  }
  if (metadata?.name) {
    return metadata.name;
  }
  return derivePlaceholderName(pubkey);
}
