/**
 * Event kind definitions for Nostr
 * Used by the bot to provide information about event kinds
 */

export interface EventKindInfo {
  kind: number;
  name: string;
  description: string;
  nip: string;
}

export const EVENT_KINDS: Record<number, EventKindInfo> = {
  // Core protocol kinds
  0: {
    kind: 0,
    name: "Profile",
    description:
      "User Metadata (kind 0) - Contains user profile information like name, about, picture, nip05, etc. This is a replaceable event.",
    nip: "01",
  },
  1: {
    kind: 1,
    name: "Note",
    description:
      "Short Text Note (kind 1) - The most common event type, used for posting text content similar to tweets. Supports mentions, hashtags, and references to other events.",
    nip: "01",
  },
  2: {
    kind: 2,
    name: "Relay Recommendation",
    description:
      "Recommend Relay (kind 2) - Deprecated. Was used to recommend relays.",
    nip: "01",
  },
  3: {
    kind: 3,
    name: "Contact List",
    description:
      "Follows/Contact List (kind 3) - Contains the list of pubkeys a user follows. Also may include relay preferences.",
    nip: "02",
  },
  4: {
    kind: 4,
    name: "Encrypted DM",
    description:
      "Encrypted Direct Messages (kind 4) - Legacy encrypted DMs. Deprecated in favor of NIP-17 (kind 14).",
    nip: "04",
  },
  5: {
    kind: 5,
    name: "Deletion",
    description:
      "Event Deletion Request (kind 5) - Request to delete previously published events.",
    nip: "09",
  },
  6: {
    kind: 6,
    name: "Repost",
    description:
      "Repost (kind 6) - Repost/boost another event (specifically kind 1 notes).",
    nip: "18",
  },
  7: {
    kind: 7,
    name: "Reaction",
    description:
      "Reaction (kind 7) - React to events with emoji or '+'/'-'. Contains e-tag pointing to the target event.",
    nip: "25",
  },
  8: {
    kind: 8,
    name: "Badge Award",
    description: "Badge Award (kind 8) - Award a badge to users.",
    nip: "58",
  },
  9: {
    kind: 9,
    name: "Chat Message",
    description:
      "Chat Message (kind 9) - Used in NIP-29 relay-based groups and NIP-C7 chats. Contains h-tag for group context.",
    nip: "29",
  },
  10: {
    kind: 10,
    name: "Group Reply",
    description: "Group Chat Threaded Reply (kind 10)",
    nip: "29",
  },
  11: {
    kind: 11,
    name: "Thread",
    description: "Thread (kind 11) - Thread root event.",
    nip: "7D",
  },
  14: {
    kind: 14,
    name: "Direct Message",
    description:
      "Direct Message (kind 14) - Private direct messages using NIP-17 encryption.",
    nip: "17",
  },
  16: {
    kind: 16,
    name: "Generic Repost",
    description:
      "Generic Repost (kind 16) - Repost any event type, not just kind 1.",
    nip: "18",
  },
  40: {
    kind: 40,
    name: "Channel Create",
    description: "Channel Creation (kind 40) - Create a public chat channel.",
    nip: "28",
  },
  41: {
    kind: 41,
    name: "Channel Metadata",
    description: "Channel Metadata (kind 41) - Update channel metadata.",
    nip: "28",
  },
  42: {
    kind: 42,
    name: "Channel Message",
    description: "Channel Message (kind 42) - Send a message to a channel.",
    nip: "28",
  },
  1063: {
    kind: 1063,
    name: "File Metadata",
    description:
      "File Metadata (kind 1063) - Metadata about files stored on servers.",
    nip: "94",
  },
  1111: {
    kind: 1111,
    name: "Comment",
    description: "Comment (kind 1111) - Comment on any addressable content.",
    nip: "22",
  },
  1311: {
    kind: 1311,
    name: "Live Chat",
    description:
      "Live Chat Message (kind 1311) - Chat messages in live activities/streams.",
    nip: "53",
  },
  1617: {
    kind: 1617,
    name: "Patch",
    description: "Git Patches (kind 1617) - Git patch for code collaboration.",
    nip: "34",
  },
  1984: {
    kind: 1984,
    name: "Report",
    description:
      "Reporting (kind 1984) - Report content or users for moderation.",
    nip: "56",
  },
  1985: {
    kind: 1985,
    name: "Label",
    description: "Label (kind 1985) - Add labels/tags to content.",
    nip: "32",
  },
  5000: {
    kind: 5000,
    name: "Job Request",
    description:
      "DVM Job Request (kind 5000-5999) - Data Vending Machine job requests.",
    nip: "90",
  },
  6000: {
    kind: 6000,
    name: "Job Result",
    description:
      "DVM Job Result (kind 6000-6999) - Data Vending Machine job results.",
    nip: "90",
  },
  7000: {
    kind: 7000,
    name: "Job Feedback",
    description: "Job Feedback (kind 7000) - Feedback for DVM jobs.",
    nip: "90",
  },
  9734: {
    kind: 9734,
    name: "Zap Request",
    description: "Zap Request (kind 9734) - Request to create a lightning zap.",
    nip: "57",
  },
  9735: {
    kind: 9735,
    name: "Zap",
    description:
      "Zap (kind 9735) - Lightning zap receipt created by LNURL providers.",
    nip: "57",
  },
  9802: {
    kind: 9802,
    name: "Highlight",
    description:
      "Highlights (kind 9802) - Highlight text from articles or content.",
    nip: "84",
  },
  10000: {
    kind: 10000,
    name: "Mute List",
    description: "Mute List (kind 10000) - List of muted users/content.",
    nip: "51",
  },
  10002: {
    kind: 10002,
    name: "Relay List",
    description:
      "Relay List Metadata (kind 10002) - User's relay list for inbox/outbox model.",
    nip: "65",
  },
  10003: {
    kind: 10003,
    name: "Bookmark List",
    description: "Bookmark List (kind 10003) - User's bookmarked content.",
    nip: "51",
  },
  30000: {
    kind: 30000,
    name: "Follow Set",
    description: "Follow Sets (kind 30000) - Named sets of followed users.",
    nip: "51",
  },
  30001: {
    kind: 30001,
    name: "Generic List",
    description: "Generic Lists (kind 30001) - Deprecated generic list.",
    nip: "51",
  },
  30008: {
    kind: 30008,
    name: "Profile Badge",
    description: "Profile Badges (kind 30008) - Badges displayed on profiles.",
    nip: "58",
  },
  30009: {
    kind: 30009,
    name: "Badge",
    description: "Badge Definition (kind 30009) - Define a badge.",
    nip: "58",
  },
  30023: {
    kind: 30023,
    name: "Article",
    description:
      "Long-form Content (kind 30023) - Blog posts and articles with markdown support.",
    nip: "23",
  },
  30078: {
    kind: 30078,
    name: "App Data",
    description:
      "Application-specific Data (kind 30078) - App-specific user data.",
    nip: "78",
  },
  30311: {
    kind: 30311,
    name: "Live Event",
    description: "Live Event (kind 30311) - Live streaming events.",
    nip: "53",
  },
  30617: {
    kind: 30617,
    name: "Repository",
    description:
      "Repository Announcement (kind 30617) - Git repository metadata.",
    nip: "34",
  },
  39000: {
    kind: 39000,
    name: "Group Metadata",
    description: "Group Metadata (kind 39000) - NIP-29 group information.",
    nip: "29",
  },
  39001: {
    kind: 39001,
    name: "Group Admins",
    description:
      "Group Admins List (kind 39001) - Admin list for NIP-29 groups.",
    nip: "29",
  },
  39002: {
    kind: 39002,
    name: "Group Members",
    description:
      "Group Members List (kind 39002) - Member list for NIP-29 groups.",
    nip: "29",
  },
};

/**
 * Get kind info by number
 */
export function getKindInfo(kind: number): EventKindInfo | undefined {
  return EVENT_KINDS[kind];
}

/**
 * Search kinds by name or description
 */
export function searchKinds(query: string): EventKindInfo[] {
  const lowerQuery = query.toLowerCase();
  return Object.values(EVENT_KINDS).filter(
    (k) =>
      k.name.toLowerCase().includes(lowerQuery) ||
      k.description.toLowerCase().includes(lowerQuery),
  );
}

/**
 * Get all kinds for a specific NIP
 */
export function getKindsForNip(nipId: string): EventKindInfo[] {
  return Object.values(EVENT_KINDS).filter((k) => k.nip === nipId);
}

/**
 * Get formatted list of common kinds for the LLM
 */
export function getCommonKindsReference(): string {
  const commonKinds = [
    0, 1, 3, 4, 5, 6, 7, 9, 14, 16, 1111, 9734, 9735, 10002, 30023, 30311,
  ];
  return commonKinds
    .map((k) => {
      const info = EVENT_KINDS[k];
      return info
        ? `- Kind ${k}: ${info.name} - ${info.description.split(".")[0]}`
        : null;
    })
    .filter(Boolean)
    .join("\n");
}
