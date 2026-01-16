/**
 * NIP-98 HTTP Auth
 *
 * Creates signed authorization events for HTTP requests.
 * Used by NIP-86 Relay Management API.
 *
 * @see https://github.com/nostr-protocol/nips/blob/master/98.md
 */

import type { EventTemplate, NostrEvent } from "nostr-tools/core";

/** HTTP Auth event kind (NIP-98) */
export const HTTP_AUTH_KIND = 27235;

/** Options for creating a NIP-98 auth event */
export interface Nip98Options {
  /** The URL being accessed */
  url: string;
  /** HTTP method (GET, POST, PUT, DELETE) */
  method: "GET" | "POST" | "PUT" | "DELETE";
  /** Request body (required for NIP-86) - will be hashed */
  payload?: string;
}

/** Signer function type */
export type SignerFn = (event: EventTemplate) => Promise<NostrEvent>;

/**
 * Compute SHA-256 hash of a string and return as hex
 */
async function sha256Hex(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const buffer = encoder.encode(data);
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Create a NIP-98 HTTP Auth event
 *
 * @param options - URL, method, and optional payload
 * @param sign - Signer function
 * @returns Signed auth event
 */
export async function createNip98Event(
  options: Nip98Options,
  sign: SignerFn,
): Promise<NostrEvent> {
  const tags: string[][] = [
    ["u", options.url],
    ["method", options.method],
  ];

  // Add payload hash if provided (required for NIP-86)
  if (options.payload) {
    const hash = await sha256Hex(options.payload);
    tags.push(["payload", hash]);
  }

  const template: EventTemplate = {
    kind: HTTP_AUTH_KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: "",
  };

  return sign(template);
}

/**
 * Format a NIP-98 event as an Authorization header value
 *
 * @param event - Signed NIP-98 event
 * @returns Authorization header value (Nostr base64(event))
 */
export function formatAuthHeader(event: NostrEvent): string {
  return `Nostr ${btoa(JSON.stringify(event))}`;
}

/**
 * Create Authorization header for an HTTP request
 *
 * @param options - URL, method, and optional payload
 * @param sign - Signer function
 * @returns Authorization header value
 */
export async function createAuthHeader(
  options: Nip98Options,
  sign: SignerFn,
): Promise<string> {
  const event = await createNip98Event(options, sign);
  return formatAuthHeader(event);
}
