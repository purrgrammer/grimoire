import type { NostrEvent } from "@/types/nostr";
import { getTagValue } from "applesauce-core/helpers";

/**
 * NIP-75 Helper Functions
 * Utility functions for parsing NIP-75 Zap Goal events (kind 9041)
 */

/**
 * Get the target amount for a goal in millisatoshis
 * @param event Goal event (kind 9041)
 * @returns Target amount in millisats or undefined
 */
export function getGoalAmount(event: NostrEvent): number | undefined {
  const amount = getTagValue(event, "amount");
  if (!amount) return undefined;
  const parsed = parseInt(amount, 10);
  return isNaN(parsed) ? undefined : parsed;
}

/**
 * Get the relays where zaps should be sent and tallied
 * @param event Goal event (kind 9041)
 * @returns Array of relay URLs
 */
export function getGoalRelays(event: NostrEvent): string[] {
  const relaysTag = event.tags.find((t) => t[0] === "relays");
  if (!relaysTag) return [];
  const [, ...relays] = relaysTag;
  return relays.filter(Boolean);
}

/**
 * Get the deadline timestamp after which zaps should not be counted
 * @param event Goal event (kind 9041)
 * @returns Unix timestamp in seconds or undefined
 */
export function getGoalClosedAt(event: NostrEvent): number | undefined {
  const closedAt = getTagValue(event, "closed_at");
  if (!closedAt) return undefined;
  const parsed = parseInt(closedAt, 10);
  return isNaN(parsed) ? undefined : parsed;
}

/**
 * Get the summary/brief description of the goal
 * @param event Goal event (kind 9041)
 * @returns Summary string or undefined
 */
export function getGoalSummary(event: NostrEvent): string | undefined {
  return getTagValue(event, "summary");
}

/**
 * Get the image URL for the goal
 * @param event Goal event (kind 9041)
 * @returns Image URL or undefined
 */
export function getGoalImage(event: NostrEvent): string | undefined {
  return getTagValue(event, "image");
}

/**
 * Get the external URL linked to the goal
 * @param event Goal event (kind 9041)
 * @returns URL string or undefined
 */
export function getGoalUrl(event: NostrEvent): string | undefined {
  return getTagValue(event, "r");
}

/**
 * Get the addressable event pointer linked to the goal
 * @param event Goal event (kind 9041)
 * @returns Address pointer string (kind:pubkey:identifier) or undefined
 */
export function getGoalLinkedAddress(event: NostrEvent): string | undefined {
  return getTagValue(event, "a");
}

/**
 * Get all beneficiary pubkeys from zap tags
 * @param event Goal event (kind 9041)
 * @returns Array of beneficiary pubkeys
 */
export function getGoalBeneficiaries(event: NostrEvent): string[] {
  return event.tags
    .filter((t) => t[0] === "zap")
    .map((t) => t[1])
    .filter(Boolean);
}

/**
 * Check if a goal has closed (deadline passed)
 * @param event Goal event (kind 9041)
 * @returns true if goal is closed, false otherwise
 */
export function isGoalClosed(event: NostrEvent): boolean {
  const closedAt = getGoalClosedAt(event);
  if (!closedAt) return false;
  return Date.now() / 1000 > closedAt;
}

/**
 * Get a display title for the goal
 * Content is the goal title per NIP-75
 * @param event Goal event (kind 9041)
 * @returns Display title string
 */
export function getGoalTitle(event: NostrEvent): string {
  const content = event.content?.trim();
  if (content) {
    return content;
  }
  return "Untitled Goal";
}
