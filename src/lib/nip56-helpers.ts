/**
 * NIP-56: Reporting
 * Helpers for creating and parsing report events (kind 1984)
 *
 * A report signals that some referenced content is objectionable.
 * Reports can target profiles, events, or blobs.
 *
 * Uses applesauce caching pattern - results are cached on the event object.
 */

import { getTagValue, getOrComputeCachedValue } from "applesauce-core/helpers";
import type { NostrEvent } from "@/types/nostr";
import { getTagValues } from "@/lib/nostr-utils";

/**
 * Report types as defined in NIP-56
 */
export const REPORT_TYPES = [
  "nudity",
  "malware",
  "profanity",
  "illegal",
  "spam",
  "impersonation",
  "other",
] as const;

export type ReportType = (typeof REPORT_TYPES)[number];

/**
 * Human-readable labels for report types
 */
export const REPORT_TYPE_LABELS: Record<ReportType, string> = {
  nudity: "Nudity",
  malware: "Malware",
  profanity: "Profanity",
  illegal: "Illegal",
  spam: "Spam",
  impersonation: "Impersonation",
  other: "Other",
};

/**
 * Descriptions for report types
 */
export const REPORT_TYPE_DESCRIPTIONS: Record<ReportType, string> = {
  nudity: "Depictions of nudity, porn, etc.",
  malware:
    "Virus, trojan horse, worm, robot, spyware, adware, back door, ransomware, rootkit, kidnapper, etc.",
  profanity: "Profanity, hateful speech, etc.",
  illegal: "Something which may be illegal in some jurisdiction",
  spam: "Spam",
  impersonation: "Someone pretending to be someone else",
  other: "Reports that don't fit in other categories",
};

/**
 * Report target types
 */
export type ReportTargetType = "profile" | "event" | "blob";

// Symbols for caching computed values on events
const ParsedReportSymbol = Symbol("parsedReport");
const ReportLabelsSymbol = Symbol("reportLabels");

/**
 * Parsed report information from a kind 1984 event
 */
export interface ParsedReport {
  /** The pubkey being reported (always present) */
  reportedPubkey: string;
  /** The report type */
  reportType: ReportType;
  /** The event ID being reported (if reporting an event) */
  reportedEventId?: string;
  /** The blob hash being reported (if reporting a blob) */
  reportedBlobHash?: string;
  /** The event ID containing the blob (required with x tag) */
  blobEventId?: string;
  /** Media server URLs that may contain the blob */
  serverUrls?: string[];
  /** Optional additional comment from the reporter */
  comment: string;
  /** Target type for UI purposes */
  targetType: ReportTargetType;
}

/**
 * Get the reported pubkey from a report event
 */
export function getReportedPubkey(event: NostrEvent): string | undefined {
  return getTagValue(event, "p");
}

/**
 * Get the report type from a report event
 * The report type is the 3rd element (index 2) of the p, e, or x tag.
 * Direct tag access is required since getTagValue only returns tag[1].
 */
export function getReportType(event: NostrEvent): ReportType | undefined {
  // Check p, e, x tags for report type in the 3rd element
  for (const tagName of ["p", "e", "x"]) {
    const tag = event.tags.find((t) => t[0] === tagName && t[2]);
    if (tag?.[2] && REPORT_TYPES.includes(tag[2] as ReportType)) {
      return tag[2] as ReportType;
    }
  }
  return undefined;
}

/**
 * Get the reported event ID from a report event
 */
export function getReportedEventId(event: NostrEvent): string | undefined {
  return getTagValue(event, "e");
}

/**
 * Get the reported blob hash from a report event
 */
export function getReportedBlobHash(event: NostrEvent): string | undefined {
  return getTagValue(event, "x");
}

/**
 * Get server URLs from a report event (for blob reports)
 */
export function getReportServerUrls(event: NostrEvent): string[] {
  return getTagValues(event, "server");
}

/**
 * Parse a report event into a structured format
 * Uses applesauce caching - result is cached on the event object
 */
export function getReportInfo(event: NostrEvent): ParsedReport | undefined {
  if (event.kind !== 1984) return undefined;

  return getOrComputeCachedValue(event, ParsedReportSymbol, () => {
    const reportedPubkey = getReportedPubkey(event);
    if (!reportedPubkey) return undefined;

    const reportType = getReportType(event) || "other";
    const reportedEventId = getReportedEventId(event);
    const reportedBlobHash = getReportedBlobHash(event);
    const serverUrls = getReportServerUrls(event);

    // Determine blob event ID (e tag when x tag is present)
    let blobEventId: string | undefined;
    if (reportedBlobHash) {
      blobEventId = reportedEventId;
    }

    // Determine target type
    let targetType: ReportTargetType = "profile";
    if (reportedBlobHash) {
      targetType = "blob";
    } else if (reportedEventId) {
      targetType = "event";
    }

    return {
      reportedPubkey,
      reportType,
      reportedEventId: targetType === "event" ? reportedEventId : undefined,
      reportedBlobHash,
      blobEventId,
      serverUrls: serverUrls.length > 0 ? serverUrls : undefined,
      comment: event.content,
      targetType,
    };
  });
}

/**
 * Check if a report type is valid
 */
export function isValidReportType(type: string): type is ReportType {
  return REPORT_TYPES.includes(type as ReportType);
}

/**
 * Get NIP-32 label tags from a report event (optional enhancement)
 * Uses applesauce caching - result is cached on the event object.
 * Direct tag access for "l" tags is required to filter by namespace in tag[2].
 */
export function getReportLabels(
  event: NostrEvent,
): { namespace: string; label: string }[] {
  return getOrComputeCachedValue(event, ReportLabelsSymbol, () => {
    const namespace = getTagValue(event, "L");
    if (!namespace) return [];

    return event.tags
      .filter((t) => t[0] === "l" && t[2] === namespace)
      .map((t) => ({
        namespace,
        label: t[1],
      }));
  });
}
