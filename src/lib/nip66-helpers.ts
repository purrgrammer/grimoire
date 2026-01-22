import type { NostrEvent } from "@/types/nostr";
import { getTagValue } from "applesauce-core/helpers";

/**
 * NIP-66 Helper Functions
 * Utility functions for parsing NIP-66 relay discovery and monitoring events
 */

// ============================================================================
// Relay Discovery Event Helpers (Kind 30166)
// ============================================================================

/**
 * Get relay URL from d tag (may be normalized or hex-encoded pubkey)
 * @param event Relay discovery event (kind 30166)
 * @returns Relay URL or undefined
 */
export function getRelayUrl(event: NostrEvent): string | undefined {
  return getTagValue(event, "d");
}

/**
 * Get RTT (round-trip time) metrics in milliseconds
 * @param event Relay discovery event (kind 30166)
 * @returns Object with open, read, write RTT values
 */
export function getRttMetrics(event: NostrEvent): {
  open?: number;
  read?: number;
  write?: number;
} {
  const rttOpen = getTagValue(event, "rtt-open");
  const rttRead = getTagValue(event, "rtt-read");
  const rttWrite = getTagValue(event, "rtt-write");

  return {
    open: rttOpen ? parseInt(rttOpen, 10) : undefined,
    read: rttRead ? parseInt(rttRead, 10) : undefined,
    write: rttWrite ? parseInt(rttWrite, 10) : undefined,
  };
}

/**
 * Get network type (clearnet, tor, i2p, loki)
 * @param event Relay discovery event (kind 30166)
 * @returns Network type or undefined
 */
export function getNetworkType(event: NostrEvent): string | undefined {
  return getTagValue(event, "n");
}

/**
 * Get relay type (PascalCase string like "Read", "Write", "Public")
 * @param event Relay discovery event (kind 30166)
 * @returns Relay type or undefined
 */
export function getRelayType(event: NostrEvent): string | undefined {
  return getTagValue(event, "T");
}

/**
 * Get array of supported NIP numbers
 * @param event Relay discovery event (kind 30166)
 * @returns Array of NIP numbers
 */
export function getSupportedNips(event: NostrEvent): number[] {
  const nips = event.tags
    .filter((t) => t[0] === "N")
    .map((t) => parseInt(t[1], 10))
    .filter((n) => !isNaN(n));

  // Return unique sorted NIPs
  return Array.from(new Set(nips)).sort((a, b) => a - b);
}

/**
 * Get relay requirements (auth, writes, pow, payment)
 * Returns object with boolean values for each requirement
 * NIP-66 uses '!' prefix for false/negative requirements
 * @param event Relay discovery event (kind 30166)
 * @returns Object with requirement flags
 */
export function getRelayRequirements(event: NostrEvent): {
  auth?: boolean;
  writes?: boolean;
  pow?: boolean;
  payment?: boolean;
} {
  const requirements: {
    auth?: boolean;
    writes?: boolean;
    pow?: boolean;
    payment?: boolean;
  } = {};

  const reqTags = event.tags.filter((t) => t[0] === "R");

  for (const tag of reqTags) {
    const value = tag[1];
    if (!value) continue;

    // Check for ! prefix (negative/false)
    const isNegative = value.startsWith("!");
    const requirementKey = isNegative ? value.slice(1) : value;
    const requirementValue = !isNegative;

    if (requirementKey === "auth") {
      requirements.auth = requirementValue;
    } else if (requirementKey === "writes") {
      requirements.writes = requirementValue;
    } else if (requirementKey === "pow") {
      requirements.pow = requirementValue;
    } else if (requirementKey === "payment") {
      requirements.payment = requirementValue;
    }
  }

  return requirements;
}

/**
 * Get array of topics
 * @param event Relay discovery event (kind 30166)
 * @returns Array of topic strings
 */
export function getRelayTopics(event: NostrEvent): string[] {
  return event.tags.filter((t) => t[0] === "t").map((t) => t[1]);
}

/**
 * Get accepted and rejected kinds
 * Returns separate arrays for accepted and rejected kinds
 * NIP-66 uses '!' prefix for rejected kinds
 * @param event Relay discovery event (kind 30166)
 * @returns Object with accepted and rejected kind arrays
 */
export function getRelayKinds(event: NostrEvent): {
  accepted: number[];
  rejected: number[];
} {
  const accepted: number[] = [];
  const rejected: number[] = [];

  const kindTags = event.tags.filter((t) => t[0] === "k");

  for (const tag of kindTags) {
    const value = tag[1];
    if (!value) continue;

    // Check for ! prefix (rejected)
    const isRejected = value.startsWith("!");
    const kindStr = isRejected ? value.slice(1) : value;
    const kindNum = parseInt(kindStr, 10);

    if (!isNaN(kindNum)) {
      if (isRejected) {
        rejected.push(kindNum);
      } else {
        accepted.push(kindNum);
      }
    }
  }

  return {
    accepted: Array.from(new Set(accepted)).sort((a, b) => a - b),
    rejected: Array.from(new Set(rejected)).sort((a, b) => a - b),
  };
}

/**
 * Get geohash location
 * @param event Relay discovery event (kind 30166)
 * @returns Geohash string or undefined
 */
export function getRelayGeohash(event: NostrEvent): string | undefined {
  return getTagValue(event, "g");
}

/**
 * Parse NIP-11 document from content field
 * @param event Relay discovery event (kind 30166)
 * @returns Parsed NIP-11 object or undefined
 */
export function parseNip11Document(event: NostrEvent): object | undefined {
  if (!event.content || event.content.trim() === "") {
    return undefined;
  }

  try {
    return JSON.parse(event.content);
  } catch {
    return undefined;
  }
}

/**
 * Calculate relay health score (0-100) based on RTT and event recency
 * Lower RTT = higher score, more recent events = higher score
 * @param event Relay discovery event (kind 30166)
 * @returns Health score from 0 to 100
 */
export function calculateRelayHealth(event: NostrEvent): number {
  let score = 100;

  // Factor 1: RTT performance (up to -40 points)
  const rtt = getRttMetrics(event);
  const avgRtt = [rtt.open, rtt.read, rtt.write]
    .filter((v): v is number => v !== undefined)
    .reduce((sum, v, _, arr) => sum + v / arr.length, 0);

  if (avgRtt) {
    // Penalize high RTT: 0-100ms = no penalty, 100-1000ms = -20 points, >1000ms = -40 points
    if (avgRtt > 1000) {
      score -= 40;
    } else if (avgRtt > 100) {
      score -= ((avgRtt - 100) / 900) * 20;
    }
  }

  // Factor 2: Event age (up to -60 points)
  const now = Math.floor(Date.now() / 1000);
  const ageInSeconds = now - event.created_at;
  const ageInDays = ageInSeconds / (24 * 60 * 60);

  // Penalize old events: <1 day = no penalty, 1-7 days = -30 points, >7 days = -60 points
  if (ageInDays > 7) {
    score -= 60;
  } else if (ageInDays > 1) {
    score -= ((ageInDays - 1) / 6) * 30;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

// ============================================================================
// Monitor Announcement Event Helpers (Kind 10166)
// ============================================================================

/**
 * Get monitoring frequency in seconds
 * @param event Monitor announcement event (kind 10166)
 * @returns Frequency in seconds or undefined
 */
export function getMonitorFrequency(event: NostrEvent): number | undefined {
  const freq = getTagValue(event, "frequency");
  return freq ? parseInt(freq, 10) : undefined;
}

/**
 * Get timeout configurations per check type
 * Returns map of check type to timeout in milliseconds
 * @param event Monitor announcement event (kind 10166)
 * @returns Map of check type to timeout value
 */
export function getMonitorTimeouts(event: NostrEvent): Record<string, number> {
  const timeouts: Record<string, number> = {};

  const timeoutTags = event.tags.filter((t) => t[0] === "timeout");

  for (const tag of timeoutTags) {
    if (tag.length >= 3) {
      const checkType = tag[1];
      const timeout = parseInt(tag[2], 10);
      if (checkType && !isNaN(timeout)) {
        timeouts[checkType] = timeout;
      }
    }
  }

  return timeouts;
}

/**
 * Get array of check types performed by this monitor
 * @param event Monitor announcement event (kind 10166)
 * @returns Array of check type strings (open, read, write, auth, nip11, dns, geo)
 */
export function getMonitorChecks(event: NostrEvent): string[] {
  const checks = event.tags.filter((t) => t[0] === "c").map((t) => t[1]);
  return Array.from(new Set(checks));
}

/**
 * Get monitor's geohash location
 * @param event Monitor announcement event (kind 10166)
 * @returns Geohash string or undefined
 */
export function getMonitorGeohash(event: NostrEvent): string | undefined {
  return getTagValue(event, "g");
}

/**
 * Format frequency for human-readable display
 * @param seconds Frequency in seconds
 * @returns Formatted string (e.g., "5 minutes", "1 hour")
 */
export function formatFrequency(seconds: number): string {
  if (seconds < 60) {
    return seconds === 1 ? "1 second" : `${seconds} seconds`;
  }

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return minutes === 1 ? "1 minute" : `${minutes} minutes`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return hours === 1 ? "1 hour" : `${hours} hours`;
  }

  const days = Math.floor(hours / 24);
  return days === 1 ? "1 day" : `${days} days`;
}

/**
 * Format timeout value for display
 * @param milliseconds Timeout in milliseconds
 * @returns Formatted string (e.g., "500ms", "2s")
 */
export function formatTimeout(milliseconds: number): string {
  if (milliseconds < 1000) {
    return `${milliseconds}ms`;
  }

  const seconds = milliseconds / 1000;
  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  return `${minutes}m`;
}

/**
 * Get human-readable check type name
 * @param checkType Check type code (e.g., "open", "read", "write")
 * @returns Human-readable name
 */
export function getCheckTypeName(checkType: string): string {
  const names: Record<string, string> = {
    open: "Connection",
    read: "Read",
    write: "Write",
    auth: "Authentication",
    nip11: "NIP-11 Info",
    dns: "DNS",
    geo: "Geolocation",
  };

  return names[checkType] || checkType;
}
