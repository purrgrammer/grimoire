import type { NostrEvent } from "@/types/nostr";
import { getTagValue, getOrComputeCachedValue } from "applesauce-core/helpers";
import { getTagValues } from "./nostr-utils";

/**
 * NIP-88 Poll Helpers
 *
 * Utilities for parsing and working with poll events (kind 1068)
 * and poll response events (kind 1018).
 *
 * Uses applesauce's symbol-based caching to avoid recomputation.
 */

export interface PollOption {
  id: string;
  label: string;
}

export type PollType = "singlechoice" | "multiplechoice";

export interface PollData {
  question: string;
  options: PollOption[];
  relays: string[];
  pollType: PollType;
  endsAt: number | null;
}

// Symbols for caching computed values on events
const PollOptionsSymbol = Symbol("pollOptions");
const PollTypeSymbol = Symbol("pollType");
const PollEndsAtSymbol = Symbol("pollEndsAt");
const PollRelaysSymbol = Symbol("pollRelays");
const PollDataSymbol = Symbol("pollData");
const PollEventIdSymbol = Symbol("pollEventId");
const PollRelayHintSymbol = Symbol("pollRelayHint");
const SelectedOptionsSymbol = Symbol("selectedOptions");

/**
 * Get the poll question from a poll event (kind 1068)
 * The question is stored in the event content (no caching needed - direct access)
 */
export function getPollQuestion(event: NostrEvent): string {
  return event.content || "";
}

/**
 * Get all poll options from a poll event
 * Options are stored as ["option", "option_id", "option_label"] tags
 */
export function getPollOptions(event: NostrEvent): PollOption[] {
  return getOrComputeCachedValue(event, PollOptionsSymbol, () =>
    event.tags
      .filter((tag) => tag[0] === "option" && tag[1] && tag[2])
      .map((tag) => ({
        id: tag[1],
        label: tag[2],
      })),
  );
}

/**
 * Get the poll type (singlechoice or multiplechoice)
 * Defaults to "singlechoice" if not specified
 */
export function getPollType(event: NostrEvent): PollType {
  return getOrComputeCachedValue(event, PollTypeSymbol, () => {
    const pollType = getTagValue(event, "polltype");
    return pollType === "multiplechoice" ? "multiplechoice" : "singlechoice";
  });
}

/**
 * Get the poll end timestamp (unix seconds)
 * Returns null if not specified
 */
export function getPollEndsAt(event: NostrEvent): number | null {
  return getOrComputeCachedValue(event, PollEndsAtSymbol, () => {
    const endsAt = getTagValue(event, "endsAt");
    if (!endsAt) return null;
    const timestamp = parseInt(endsAt, 10);
    return isNaN(timestamp) ? null : timestamp;
  });
}

/**
 * Get the relays where poll responses should be found
 */
export function getPollRelays(event: NostrEvent): string[] {
  return getOrComputeCachedValue(event, PollRelaysSymbol, () =>
    getTagValues(event, "relay"),
  );
}

/**
 * Check if a poll has ended
 * Note: This is intentionally NOT cached as it depends on current time
 */
export function isPollEnded(event: NostrEvent): boolean {
  const endsAt = getPollEndsAt(event);
  if (!endsAt) return false;
  return Date.now() / 1000 > endsAt;
}

/**
 * Parse all poll data from a poll event
 */
export function getPollData(event: NostrEvent): PollData {
  return getOrComputeCachedValue(event, PollDataSymbol, () => ({
    question: getPollQuestion(event),
    options: getPollOptions(event),
    relays: getPollRelays(event),
    pollType: getPollType(event),
    endsAt: getPollEndsAt(event),
  }));
}

/**
 * Get the poll event ID from a poll response event (kind 1018)
 */
export function getPollEventId(event: NostrEvent): string | null {
  return getOrComputeCachedValue(event, PollEventIdSymbol, () => {
    const eTag = event.tags.find((tag) => tag[0] === "e");
    return eTag?.[1] || null;
  });
}

/**
 * Get the relay hint for the poll event from a poll response
 */
export function getPollRelayHint(event: NostrEvent): string | null {
  return getOrComputeCachedValue(event, PollRelayHintSymbol, () => {
    const eTag = event.tags.find((tag) => tag[0] === "e");
    return eTag?.[2] || null;
  });
}

/**
 * Get selected option IDs from a poll response event
 * Returns unique option IDs, preserving order
 */
export function getSelectedOptions(event: NostrEvent): string[] {
  return getOrComputeCachedValue(event, SelectedOptionsSymbol, () => {
    const responses = event.tags.filter(
      (tag) => tag[0] === "response" && tag[1],
    );
    // Return unique option IDs, preserving order
    const seen = new Set<string>();
    const result: string[] = [];
    for (const tag of responses) {
      if (!seen.has(tag[1])) {
        seen.add(tag[1]);
        result.push(tag[1]);
      }
    }
    return result;
  });
}

/**
 * Count votes from an array of poll response events
 * Returns a map of option ID to vote count
 *
 * Per NIP-88:
 * - Only one vote per pubkey is counted
 * - The event with the largest timestamp (within poll limits) wins
 * - For singlechoice, only the first response tag is counted
 * - For multiplechoice, the first response tag for each option ID is counted
 *
 * Note: This operates on collections and cannot be cached per-event
 */
export function countVotes(
  responses: NostrEvent[],
  pollType: PollType,
  pollEndsAt: number | null,
): Map<string, number> {
  // Filter out responses after poll end
  const validResponses =
    pollEndsAt !== null
      ? responses.filter((e) => e.created_at <= pollEndsAt)
      : responses;

  // Keep only the latest response per pubkey
  const latestByPubkey = new Map<string, NostrEvent>();
  for (const response of validResponses) {
    const existing = latestByPubkey.get(response.pubkey);
    if (!existing || response.created_at > existing.created_at) {
      latestByPubkey.set(response.pubkey, response);
    }
  }

  // Count votes
  const counts = new Map<string, number>();
  for (const response of latestByPubkey.values()) {
    const selectedOptions = getSelectedOptions(response);

    if (pollType === "singlechoice") {
      // Only count first option
      const optionId = selectedOptions[0];
      if (optionId) {
        counts.set(optionId, (counts.get(optionId) || 0) + 1);
      }
    } else {
      // Count all unique options
      for (const optionId of selectedOptions) {
        counts.set(optionId, (counts.get(optionId) || 0) + 1);
      }
    }
  }

  return counts;
}

/**
 * Get unique voter count from poll responses
 *
 * Note: This operates on collections and cannot be cached per-event
 */
export function getUniqueVoterCount(
  responses: NostrEvent[],
  pollEndsAt: number | null,
): number {
  const validResponses =
    pollEndsAt !== null
      ? responses.filter((e) => e.created_at <= pollEndsAt)
      : responses;

  const pubkeys = new Set(validResponses.map((e) => e.pubkey));
  return pubkeys.size;
}
