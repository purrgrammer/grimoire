import type { NostrEvent } from "@/types/nostr";
import { getTagValue } from "applesauce-core/helpers";

/**
 * NIP-34 Helper Functions
 * Utility functions for parsing NIP-34 git event tags
 */

// ============================================================================
// Repository Event Helpers (Kind 30617)
// ============================================================================

/**
 * Get the repository name from a repository event
 * @param event Repository event (kind 30617)
 * @returns Repository name or undefined
 */
export function getRepositoryName(event: NostrEvent): string | undefined {
  return getTagValue(event, "name");
}

/**
 * Get the repository description
 * @param event Repository event (kind 30617)
 * @returns Repository description or undefined
 */
export function getRepositoryDescription(
  event: NostrEvent,
): string | undefined {
  return getTagValue(event, "description");
}

/**
 * Get the repository identifier (d tag)
 * @param event Repository event (kind 30617)
 * @returns Repository identifier or undefined
 */
export function getRepositoryIdentifier(event: NostrEvent): string | undefined {
  return getTagValue(event, "d");
}

/**
 * Get all clone URLs from a repository event
 * @param event Repository event (kind 30617)
 * @returns Array of clone URLs
 */
export function getCloneUrls(event: NostrEvent): string[] {
  return event.tags.filter((t) => t[0] === "clone").map((t) => t[1]);
}

/**
 * Get all web URLs from a repository event
 * @param event Repository event (kind 30617)
 * @returns Array of web URLs
 */
export function getWebUrls(event: NostrEvent): string[] {
  return event.tags.filter((t) => t[0] === "web").map((t) => t[1]);
}

/**
 * Get all maintainer pubkeys from a repository event
 * @param event Repository event (kind 30617)
 * @returns Array of maintainer pubkeys
 */
export function getMaintainers(event: NostrEvent): string[] {
  return event.tags
    .filter((t) => t[0] === "maintainers")
    .map((t) => t[1])
    .filter((p: string) => p !== event.pubkey);
}

/**
 * Get relay hints for patches and issues
 * @param event Repository event (kind 30617)
 * @returns Array of relay URLs
 */
export function getRepositoryRelays(event: NostrEvent): string[] {
  const relaysTag = event.tags.find((t) => t[0] === "relays");
  if (!relaysTag) return [];
  const [, ...relays] = relaysTag;
  return relays;
}

// ============================================================================
// Issue Event Helpers (Kind 1621)
// ============================================================================

/**
 * Get the issue title/subject
 * @param event Issue event (kind 1621)
 * @returns Issue title or undefined
 */
export function getIssueTitle(event: NostrEvent): string | undefined {
  return getTagValue(event, "subject");
}

/**
 * Get all issue labels/tags
 * @param event Issue event (kind 1621)
 * @returns Array of label strings
 */
export function getIssueLabels(event: NostrEvent): string[] {
  return event.tags.filter((t) => t[0] === "t").map((t) => t[1]);
}

/**
 * Get the repository address pointer for an issue
 * @param event Issue event (kind 1621)
 * @returns Repository address pointer (a tag) or undefined
 */
export function getIssueRepositoryAddress(
  event: NostrEvent,
): string | undefined {
  return getTagValue(event, "a");
}

/**
 * Get the repository owner pubkey for an issue
 * @param event Issue event (kind 1621)
 * @returns Repository owner pubkey or undefined
 */
export function getIssueRepositoryOwner(event: NostrEvent): string | undefined {
  return getTagValue(event, "p");
}
