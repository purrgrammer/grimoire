/**
 * NIP-86 Relay Management API Client
 *
 * JSON-RPC-like API for relay administration.
 * Uses NIP-98 HTTP Auth for authorization.
 *
 * @see https://github.com/nostr-protocol/nips/blob/master/86.md
 */

import { createAuthHeader, type SignerFn } from "./nip98";

/** NIP-86 Content-Type header */
const CONTENT_TYPE = "application/nostr+json+rpc";

/** Banned/allowed pubkey entry */
export interface PubkeyEntry {
  pubkey: string;
  reason?: string;
}

/** Banned event entry */
export interface EventEntry {
  id: string;
  reason?: string;
}

/** Event needing moderation */
export interface ModerationQueueEntry {
  id: string;
  reason?: string;
}

/** Blocked IP entry */
export interface IpEntry {
  ip: string;
  reason?: string;
}

/** NIP-86 API error */
export class Nip86Error extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Nip86Error";
  }
}

/** NIP-86 authorization error (401) */
export class Nip86AuthError extends Nip86Error {
  constructor(message: string = "Unauthorized") {
    super(message);
    this.name = "Nip86AuthError";
  }
}

/** NIP-86 network/CORS error */
export class Nip86NetworkError extends Nip86Error {
  constructor(
    message: string = "Network error",
    public readonly isCorsLikely: boolean = false,
  ) {
    super(message);
    this.name = "Nip86NetworkError";
  }
}

/**
 * NIP-86 Relay Management API Client
 *
 * Provides methods to manage relay settings, moderation, and access control.
 */
export class Nip86Client {
  private httpUrl: string;

  /**
   * Create a NIP-86 client
   *
   * @param relayUrl - WebSocket relay URL (wss://...)
   * @param sign - Signer function for NIP-98 auth
   */
  constructor(
    public readonly relayUrl: string,
    private sign: SignerFn,
  ) {
    // Convert ws(s):// to http(s)://
    this.httpUrl = relayUrl.replace(/^ws/, "http");
  }

  /**
   * Make a NIP-86 API call
   *
   * @param method - Method name
   * @param params - Method parameters
   * @returns Result from relay
   */
  async call<T>(method: string, params: unknown[] = []): Promise<T> {
    const body = JSON.stringify({ method, params });

    // NIP-86: "The `u` tag is the relay URL" - use WebSocket URL, not HTTP
    const authHeader = await createAuthHeader(
      {
        url: this.relayUrl,
        method: "POST",
        payload: body,
      },
      this.sign,
    );

    let response: Response;
    try {
      response = await fetch(this.httpUrl, {
        method: "POST",
        headers: {
          "Content-Type": CONTENT_TYPE,
          Authorization: authHeader,
        },
        body,
      });
    } catch (error) {
      // Network errors (including CORS) throw TypeError with "Failed to fetch"
      const message =
        error instanceof Error ? error.message : "Network request failed";

      // "Failed to fetch" is the typical CORS or network error message
      const isCorsLikely =
        message.toLowerCase().includes("failed to fetch") ||
        message.toLowerCase().includes("network") ||
        message.toLowerCase().includes("cors");

      throw new Nip86NetworkError(
        isCorsLikely
          ? "Network error - relay may not support CORS or NIP-86"
          : message,
        isCorsLikely,
      );
    }

    if (response.status === 401) {
      throw new Nip86AuthError();
    }

    if (!response.ok) {
      throw new Nip86Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const result = await response.json();

    if (result.error) {
      throw new Nip86Error(result.error);
    }

    return result.result;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Discovery
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get list of supported methods
   */
  async supportedMethods(): Promise<string[]> {
    return this.call<string[]>("supportedmethods");
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Pubkey Management
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Ban a pubkey from the relay
   */
  async banPubkey(pubkey: string, reason?: string): Promise<boolean> {
    const params: unknown[] = [pubkey];
    if (reason) params.push(reason);
    return this.call<boolean>("banpubkey", params);
  }

  /**
   * List all banned pubkeys
   */
  async listBannedPubkeys(): Promise<PubkeyEntry[]> {
    return this.call<PubkeyEntry[]>("listbannedpubkeys");
  }

  /**
   * Allow a pubkey (for private relays or unban)
   */
  async allowPubkey(pubkey: string, reason?: string): Promise<boolean> {
    const params: unknown[] = [pubkey];
    if (reason) params.push(reason);
    return this.call<boolean>("allowpubkey", params);
  }

  /**
   * List all allowed pubkeys
   */
  async listAllowedPubkeys(): Promise<PubkeyEntry[]> {
    return this.call<PubkeyEntry[]>("listallowedpubkeys");
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Event Moderation
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * List events waiting for moderation approval
   */
  async listEventsNeedingModeration(): Promise<ModerationQueueEntry[]> {
    return this.call<ModerationQueueEntry[]>("listeventsneedingmoderation");
  }

  /**
   * Approve an event
   */
  async allowEvent(eventId: string, reason?: string): Promise<boolean> {
    const params: unknown[] = [eventId];
    if (reason) params.push(reason);
    return this.call<boolean>("allowevent", params);
  }

  /**
   * Ban an event
   */
  async banEvent(eventId: string, reason?: string): Promise<boolean> {
    const params: unknown[] = [eventId];
    if (reason) params.push(reason);
    return this.call<boolean>("banevent", params);
  }

  /**
   * List all banned events
   */
  async listBannedEvents(): Promise<EventEntry[]> {
    return this.call<EventEntry[]>("listbannedevents");
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Relay Metadata
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Change relay name
   */
  async changeRelayName(name: string): Promise<boolean> {
    return this.call<boolean>("changerelayname", [name]);
  }

  /**
   * Change relay description
   */
  async changeRelayDescription(description: string): Promise<boolean> {
    return this.call<boolean>("changerelaydescription", [description]);
  }

  /**
   * Change relay icon URL
   */
  async changeRelayIcon(iconUrl: string): Promise<boolean> {
    return this.call<boolean>("changerelayicon", [iconUrl]);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Kind Filtering
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Allow a kind on the relay
   */
  async allowKind(kind: number): Promise<boolean> {
    return this.call<boolean>("allowkind", [kind]);
  }

  /**
   * Disallow a kind on the relay
   */
  async disallowKind(kind: number): Promise<boolean> {
    return this.call<boolean>("disallowkind", [kind]);
  }

  /**
   * List all allowed kinds
   */
  async listAllowedKinds(): Promise<number[]> {
    return this.call<number[]>("listallowedkinds");
  }

  // ─────────────────────────────────────────────────────────────────────────
  // IP Blocking
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Block an IP address
   */
  async blockIp(ip: string, reason?: string): Promise<boolean> {
    const params: unknown[] = [ip];
    if (reason) params.push(reason);
    return this.call<boolean>("blockip", params);
  }

  /**
   * Unblock an IP address
   */
  async unblockIp(ip: string): Promise<boolean> {
    return this.call<boolean>("unblockip", [ip]);
  }

  /**
   * List all blocked IPs
   */
  async listBlockedIps(): Promise<IpEntry[]> {
    return this.call<IpEntry[]>("listblockedips");
  }
}

/**
 * Method categories for UI organization
 */
export const METHOD_CATEGORIES = {
  metadata: ["changerelayname", "changerelaydescription", "changerelayicon"],
  moderation: [
    "banpubkey",
    "listbannedpubkeys",
    "allowpubkey",
    "listallowedpubkeys",
    "listeventsneedingmoderation",
    "allowevent",
    "banevent",
    "listbannedevents",
  ],
  kindFiltering: ["allowkind", "disallowkind", "listallowedkinds"],
  ipBlocking: ["blockip", "unblockip", "listblockedips"],
} as const;

/**
 * Check if a category has any supported methods
 */
export function categoryHasMethods(
  category: keyof typeof METHOD_CATEGORIES,
  supportedMethods: string[],
): boolean {
  return METHOD_CATEGORIES[category].some((m) => supportedMethods.includes(m));
}
