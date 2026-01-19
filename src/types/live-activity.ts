import type { NostrEvent } from "./nostr";

export type LiveStatus = "planned" | "live" | "ended";

export type ParticipantRole =
  | "Host"
  | "Speaker"
  | "Moderator"
  | "Participant"
  | string;

export interface LiveParticipant {
  pubkey: string;
  relay?: string;
  role: ParticipantRole;
  proof?: string;
}

export interface ParsedLiveActivity {
  event: NostrEvent;

  // Required
  identifier: string; // 'd' tag

  // Core metadata
  title?: string;
  summary?: string;
  image?: string;

  // Streaming
  streaming?: string; // Primary streaming URL
  recording?: string; // Recording URL (after event ends)

  // Timing
  starts?: number; // Unix timestamp
  ends?: number; // Unix timestamp
  status?: LiveStatus;

  // Participants
  currentParticipants?: number;
  totalParticipants?: number;
  participants: LiveParticipant[];

  // Additional
  hashtags: string[]; // 't' tags
  relays: string[]; // 'relays' tag values
  goal?: string; // Event ID of a kind 9041 zap goal

  // Computed
  lastUpdate: number; // event.created_at
}
