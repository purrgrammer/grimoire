import { firstValueFrom } from "rxjs";
import { kinds } from "nostr-tools";
import { profileLoader } from "@/services/loaders";
import { getProfileContent } from "applesauce-core/helpers";
import type { NostrEvent } from "@/types/nostr";

/**
 * Check if a string is a valid nostr pubkey (64 character hex string)
 */
export function isValidPubkey(str: string): boolean {
  return /^[0-9a-f]{64}$/i.test(str);
}

/**
 * Resolved group metadata
 */
export interface ResolvedGroupMetadata {
  name?: string;
  description?: string;
  icon?: string;
  source: "nip29" | "profile" | "fallback";
}

/**
 * Create a cache key for a group
 */
export function getGroupCacheKey(relayUrl: string, groupId: string): string {
  return `${relayUrl}'${groupId}`;
}

/**
 * Extract metadata synchronously from a kind 39000 event
 * This is the fast path - no async needed when we have the metadata event
 */
export function extractMetadataFromEvent(
  groupId: string,
  metadataEvent: NostrEvent,
): ResolvedGroupMetadata {
  const name = metadataEvent.tags.find((t) => t[0] === "name")?.[1] || groupId;
  const description = metadataEvent.tags.find((t) => t[0] === "about")?.[1];
  const icon = metadataEvent.tags.find((t) => t[0] === "picture")?.[1];

  return {
    name,
    description,
    icon,
    source: "nip29",
  };
}

/**
 * Resolve group metadata with profile fallback
 *
 * Priority:
 * 1. NIP-29 metadata (kind 39000) if available
 * 2. Profile metadata (kind 0) if groupId is a valid pubkey
 * 3. Fallback to groupId as name
 *
 * @param groupId - The group identifier (may be a pubkey)
 * @param relayUrl - The relay URL to fetch profile from (if needed)
 * @param metadataEvent - Optional NIP-29 metadata event (kind 39000)
 * @returns Resolved metadata
 */
export async function resolveGroupMetadata(
  groupId: string,
  relayUrl: string,
  metadataEvent?: NostrEvent,
): Promise<ResolvedGroupMetadata> {
  // If NIP-29 metadata exists, use it (priority 1)
  if (metadataEvent && metadataEvent.kind === 39000) {
    const name =
      metadataEvent.tags.find((t) => t[0] === "name")?.[1] || groupId;
    const description = metadataEvent.tags.find((t) => t[0] === "about")?.[1];
    const icon = metadataEvent.tags.find((t) => t[0] === "picture")?.[1];

    return {
      name,
      description,
      icon,
      source: "nip29",
    };
  }

  // If no NIP-29 metadata and groupId is a valid pubkey, try profile fallback (priority 2)
  if (isValidPubkey(groupId)) {
    try {
      const profileEvent = await firstValueFrom(
        profileLoader({
          kind: kinds.Metadata,
          pubkey: groupId,
          relays: [relayUrl],
        }),
        { defaultValue: undefined },
      );

      if (profileEvent) {
        const profileContent = getProfileContent(profileEvent);
        if (profileContent) {
          return {
            name:
              profileContent.display_name ||
              profileContent.name ||
              groupId.slice(0, 8) + ":" + groupId.slice(-8),
            description: profileContent.about,
            icon: profileContent.picture,
            source: "profile",
          };
        }
      }
    } catch (error) {
      console.warn(
        `[GroupMetadata] Failed to fetch profile fallback for ${groupId.slice(0, 8)}:`,
        error,
      );
      // Fall through to fallback
    }
  }

  // Fallback: use groupId as name (priority 3)
  return {
    name: groupId,
    source: "fallback",
  };
}
