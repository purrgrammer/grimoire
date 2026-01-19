import type { NostrEvent } from "@/types/nostr";
import type {
  ParsedLiveActivity,
  LiveParticipant,
  LiveStatus,
} from "@/types/live-activity";
import { getTagValue } from "applesauce-core/helpers";

/**
 * Helper to get all values for a given tag name
 */
function getTagValues(event: NostrEvent, tagName: string): string[] {
  return event.tags.filter((t) => t[0] === tagName).map((t) => t[1] || "");
}

/**
 * Parse a kind:30311 live activity event
 */
export function parseLiveActivity(event: NostrEvent): ParsedLiveActivity {
  // Parse participants (p tags: [pubkey, relay?, role?, proof?])
  const participants: LiveParticipant[] = event.tags
    .filter((t) => t[0] === "p")
    .map((t) => ({
      pubkey: t[1],
      relay: t[2] || undefined,
      role: t[3] || "Participant",
      proof: t[4] || undefined,
    }));

  // Parse numeric fields
  const parseNum = (val?: string): number | undefined => {
    return val ? parseInt(val, 10) : undefined;
  };

  return {
    event,
    identifier: getTagValue(event, "d") || "",
    title: getTagValue(event, "title"),
    summary: getTagValue(event, "summary"),
    image: getTagValue(event, "image"),
    streaming: getTagValue(event, "streaming"),
    recording: getTagValue(event, "recording"),
    starts: parseNum(getTagValue(event, "starts")),
    ends: parseNum(getTagValue(event, "ends")),
    status: getTagValue(event, "status") as LiveStatus | undefined,
    currentParticipants: parseNum(getTagValue(event, "current_participants")),
    totalParticipants: parseNum(getTagValue(event, "total_participants")),
    participants,
    hashtags: getTagValues(event, "t"),
    relays: getTagValues(event, "relays"),
    goal: getTagValue(event, "goal"),
    lastUpdate: event.created_at || Date.now() / 1000,
  };
}

/**
 * Get live status with optional timeout detection
 * Events without updates for 1hr may be considered ended
 */
export function getLiveStatus(
  event: NostrEvent,
  considerTimeout = true,
): LiveStatus {
  const parsed = parseLiveActivity(event);

  // Explicit status from tags
  if (parsed.status) {
    // If status is 'live' but hasn't been updated in 1hr, consider ended
    if (parsed.status === "live" && considerTimeout) {
      const now = Date.now() / 1000;
      const oneHourAgo = now - 3600;
      if (parsed.lastUpdate < oneHourAgo) {
        return "ended";
      }
    }
    return parsed.status;
  }

  // Infer status from timestamps
  const now = Date.now() / 1000;
  if (parsed.ends && now > parsed.ends) {
    return "ended";
  }
  if (parsed.starts && now > parsed.starts) {
    return "live";
  }
  return "planned";
}

/**
 * Get the host of a live activity
 * Returns the first participant with "Host" role, or event author as fallback
 */
export function getLiveHost(event: NostrEvent): string {
  const parsed = parseLiveActivity(event);
  const host = parsed.participants.find((p) => p.role.toLowerCase() === "host");
  return host?.pubkey || event.pubkey;
}

/**
 * Get streaming URL (if available)
 */
export function getStreamingUrl(event: NostrEvent): string | undefined {
  return parseLiveActivity(event).streaming;
}

/**
 * Get recording URL (if available)
 */
export function getRecordingUrl(event: NostrEvent): string | undefined {
  return parseLiveActivity(event).recording;
}

/**
 * Format start time as relative or absolute
 */
export function formatStartTime(
  starts?: number,
  status?: LiveStatus,
): string | undefined {
  if (!starts) return undefined;

  const now = Date.now() / 1000;
  const diff = starts - now;

  if (status === "planned" && diff > 0) {
    // Future event - show countdown
    const hours = Math.floor(diff / 3600);
    const days = Math.floor(hours / 24);

    if (days > 0) {
      return `in ${days}d`;
    } else if (hours > 0) {
      return `in ${hours}h`;
    } else {
      const minutes = Math.floor(diff / 60);
      return `in ${minutes}m`;
    }
  }

  // Past event - show date
  return new Date(starts * 1000).toLocaleDateString();
}
