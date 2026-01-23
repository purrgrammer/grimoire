/**
 * NIP-56: Reporting
 * Helpers for creating and parsing report events (kind 1984)
 *
 * A report signals that some referenced content is objectionable.
 * Reports can target profiles, events, or blobs.
 */

import { getTagValue } from "applesauce-core/helpers";
import type { NostrEvent } from "@/types/nostr";

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
  const pTag = event.tags.find((t) => t[0] === "p");
  return pTag?.[1];
}

/**
 * Get the report type from a report event
 * The report type is the 3rd element of the p, e, or x tag
 */
export function getReportType(event: NostrEvent): ReportType | undefined {
  // Check p tag for report type
  const pTag = event.tags.find((t) => t[0] === "p" && t[2]);
  if (pTag?.[2] && REPORT_TYPES.includes(pTag[2] as ReportType)) {
    return pTag[2] as ReportType;
  }

  // Check e tag for report type
  const eTag = event.tags.find((t) => t[0] === "e" && t[2]);
  if (eTag?.[2] && REPORT_TYPES.includes(eTag[2] as ReportType)) {
    return eTag[2] as ReportType;
  }

  // Check x tag for report type
  const xTag = event.tags.find((t) => t[0] === "x" && t[2]);
  if (xTag?.[2] && REPORT_TYPES.includes(xTag[2] as ReportType)) {
    return xTag[2] as ReportType;
  }

  return undefined;
}

/**
 * Get the reported event ID from a report event
 */
export function getReportedEventId(event: NostrEvent): string | undefined {
  const eTag = event.tags.find((t) => t[0] === "e");
  return eTag?.[1];
}

/**
 * Get the reported blob hash from a report event
 */
export function getReportedBlobHash(event: NostrEvent): string | undefined {
  const xTag = event.tags.find((t) => t[0] === "x");
  return xTag?.[1];
}

/**
 * Get server URLs from a report event (for blob reports)
 */
export function getReportServerUrls(event: NostrEvent): string[] {
  return event.tags.filter((t) => t[0] === "server").map((t) => t[1]);
}

/**
 * Parse a report event into a structured format
 */
export function parseReport(event: NostrEvent): ParsedReport | undefined {
  if (event.kind !== 1984) return undefined;

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
}

/**
 * Check if a report type is valid
 */
export function isValidReportType(type: string): type is ReportType {
  return REPORT_TYPES.includes(type as ReportType);
}

/**
 * Get NIP-32 label tags from a report event (optional enhancement)
 */
export function getReportLabels(
  event: NostrEvent,
): { namespace: string; label: string }[] {
  const namespace = getTagValue(event, "L");
  if (!namespace) return [];

  const labels = event.tags
    .filter((t) => t[0] === "l" && t[2] === namespace)
    .map((t) => ({
      namespace,
      label: t[1],
    }));

  return labels;
}
