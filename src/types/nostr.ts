// Nostr Event interface following NIP-01 specification
export interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

// Filter interface for querying events
export interface NostrFilter {
  ids?: string[];
  authors?: string[];
  kinds?: number[];
  since?: number;
  until?: number;
  limit?: number;
  search?: string;
  [key: `#${string}`]: string[] | undefined;
}

// Relay connection state
export type RelayConnectionState =
  "connecting" | "connected" | "disconnected" | "error";

// Relay message types
export type RelayMessage =
  | ["EVENT", string, NostrEvent]
  | ["EOSE", string]
  | ["NOTICE", string]
  | ["OK", string, boolean, string];
