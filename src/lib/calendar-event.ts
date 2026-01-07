import type { NostrEvent } from "@/types/nostr";
import { getTagValue, getOrComputeCachedValue } from "applesauce-core/helpers";

/**
 * Participant in a calendar event (NIP-52)
 */
export interface CalendarParticipant {
  pubkey: string;
  relay?: string;
  role?: string;
}

/**
 * Parsed Date-Based Calendar Event (kind 31922)
 */
export interface ParsedDateCalendarEvent {
  identifier: string;
  title: string;
  start: string; // YYYY-MM-DD
  end?: string; // YYYY-MM-DD (exclusive)
  description: string;
  locations: string[];
  geohash?: string;
  participants: CalendarParticipant[];
  hashtags: string[];
  references: string[];
}

/**
 * Parsed Time-Based Calendar Event (kind 31923)
 */
export interface ParsedTimeCalendarEvent {
  identifier: string;
  title: string;
  start: number; // Unix timestamp
  end?: number; // Unix timestamp
  startTzid?: string; // IANA timezone identifier
  endTzid?: string; // IANA timezone identifier
  description: string;
  locations: string[];
  geohash?: string;
  participants: CalendarParticipant[];
  hashtags: string[];
  references: string[];
}

/**
 * Status of a calendar event relative to current time
 */
export type CalendarEventStatus = "upcoming" | "ongoing" | "past";

// Caching symbols for parsed calendar events
const ParsedDateCalendarEventSymbol = Symbol("ParsedDateCalendarEvent");
const ParsedTimeCalendarEventSymbol = Symbol("ParsedTimeCalendarEvent");

/**
 * Get all values for a given tag name
 */
function getTagValues(event: NostrEvent, tagName: string): string[] {
  return event.tags.filter((t) => t[0] === tagName).map((t) => t[1] || "");
}

/**
 * Parse participants from p tags
 * Format: ["p", <pubkey>, <relay>?, <role>?]
 */
function parseParticipants(event: NostrEvent): CalendarParticipant[] {
  return event.tags
    .filter((t) => t[0] === "p")
    .map((t) => ({
      pubkey: t[1],
      relay: t[2] || undefined,
      role: t[3] || undefined,
    }));
}

/**
 * Parse a kind 31922 Date-Based Calendar Event
 * Results are cached on the event object for performance
 */
export function parseDateCalendarEvent(
  event: NostrEvent,
): ParsedDateCalendarEvent {
  return getOrComputeCachedValue(event, ParsedDateCalendarEventSymbol, () => ({
    identifier: getTagValue(event, "d") || "",
    title: getTagValue(event, "title") || "",
    start: getTagValue(event, "start") || "",
    end: getTagValue(event, "end") || undefined,
    description: event.content || "",
    locations: getTagValues(event, "location"),
    geohash: getTagValue(event, "g") || undefined,
    participants: parseParticipants(event),
    hashtags: getTagValues(event, "t"),
    references: getTagValues(event, "r"),
  }));
}

/**
 * Parse a kind 31923 Time-Based Calendar Event
 * Results are cached on the event object for performance
 */
export function parseTimeCalendarEvent(
  event: NostrEvent,
): ParsedTimeCalendarEvent {
  return getOrComputeCachedValue(event, ParsedTimeCalendarEventSymbol, () => {
    const startStr = getTagValue(event, "start");
    const endStr = getTagValue(event, "end");

    return {
      identifier: getTagValue(event, "d") || "",
      title: getTagValue(event, "title") || "",
      start: startStr ? parseInt(startStr, 10) : 0,
      end: endStr ? parseInt(endStr, 10) : undefined,
      startTzid: getTagValue(event, "start_tzid") || undefined,
      endTzid: getTagValue(event, "end_tzid") || undefined,
      description: event.content || "",
      locations: getTagValues(event, "location"),
      geohash: getTagValue(event, "g") || undefined,
      participants: parseParticipants(event),
      hashtags: getTagValues(event, "t"),
      references: getTagValues(event, "r"),
    };
  });
}

/**
 * Get status of a date-based calendar event
 */
export function getDateEventStatus(
  parsed: ParsedDateCalendarEvent,
): CalendarEventStatus {
  if (!parsed.start) return "upcoming";

  const now = new Date();
  const todayStr = now.toISOString().split("T")[0];

  // Parse start date
  const startDate = parsed.start;

  // Parse end date (exclusive) - if not provided, event is single day
  const endDate = parsed.end || parsed.start;

  if (todayStr < startDate) {
    return "upcoming";
  } else if (todayStr >= endDate) {
    // End is exclusive, so if today >= end, event is past
    // But if no end provided, check if today > start
    if (!parsed.end && todayStr > startDate) {
      return "past";
    } else if (parsed.end) {
      return "past";
    }
    return "ongoing";
  } else {
    return "ongoing";
  }
}

/**
 * Get status of a time-based calendar event
 */
export function getTimeEventStatus(
  parsed: ParsedTimeCalendarEvent,
): CalendarEventStatus {
  if (!parsed.start) return "upcoming";

  const now = Date.now() / 1000;

  if (now < parsed.start) {
    return "upcoming";
  } else if (parsed.end && now >= parsed.end) {
    return "past";
  } else if (!parsed.end && now > parsed.start + 3600) {
    // If no end time, consider past after 1 hour
    return "past";
  } else {
    return "ongoing";
  }
}

/**
 * Format a date string (YYYY-MM-DD) for display using locale
 */
export function formatDateForDisplay(
  dateStr: string,
  options?: Intl.DateTimeFormatOptions,
): string {
  if (!dateStr) return "";

  // Parse as local date (not UTC)
  const [year, month, day] = dateStr.split("-").map(Number);
  const date = new Date(year, month - 1, day);

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year:
      date.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
    ...options,
  });
}

/**
 * Format a date range for display
 */
export function formatDateRange(start: string, end?: string): string {
  if (!start) return "";

  const startFormatted = formatDateForDisplay(start);

  if (!end || end === start) {
    return startFormatted;
  }

  // Check if same month/year for compact display
  const [startYear, startMonth] = start.split("-");
  const [endYear, endMonth] = end.split("-");
  const endDay = end.split("-")[2];

  if (startYear === endYear && startMonth === endMonth) {
    // Same month: "Jan 15-17"
    return `${startFormatted}–${parseInt(endDay, 10)}`;
  }

  // Different months: "Jan 15 – Feb 2"
  const endFormatted = formatDateForDisplay(end);
  return `${startFormatted} – ${endFormatted}`;
}

/**
 * Format a Unix timestamp for display using locale
 */
export function formatTimeForDisplay(
  timestamp: number,
  tzid?: string,
  options?: Intl.DateTimeFormatOptions,
): string {
  if (!timestamp) return "";

  const date = new Date(timestamp * 1000);

  const defaultOptions: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    year:
      date.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
    timeZone: tzid || undefined,
  };

  try {
    return date.toLocaleString(undefined, { ...defaultOptions, ...options });
  } catch {
    // Fallback if timezone is invalid
    return date.toLocaleString(undefined, {
      ...defaultOptions,
      ...options,
      timeZone: undefined,
    });
  }
}

/**
 * Format a time range for display
 */
export function formatTimeRange(
  start: number,
  end?: number,
  startTzid?: string,
  endTzid?: string,
): string {
  if (!start) return "";

  const startDate = new Date(start * 1000);
  const endDate = end ? new Date(end * 1000) : null;

  // Check if same day
  const sameDay =
    endDate &&
    startDate.toDateString() === endDate.toDateString() &&
    startTzid === endTzid;

  if (sameDay) {
    // Same day: "Jan 15, 7:00 PM – 9:00 PM"
    const dateStr = formatTimeForDisplay(start, startTzid, {
      hour: undefined,
      minute: undefined,
    });
    const startTime = startDate.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
      timeZone: startTzid || undefined,
    });
    const endTime = endDate.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
      timeZone: endTzid || startTzid || undefined,
    });
    return `${dateStr}, ${startTime} – ${endTime}`;
  }

  const startFormatted = formatTimeForDisplay(start, startTzid);

  if (!end) {
    return startFormatted;
  }

  const endFormatted = formatTimeForDisplay(end, endTzid || startTzid);
  return `${startFormatted} – ${endFormatted}`;
}
