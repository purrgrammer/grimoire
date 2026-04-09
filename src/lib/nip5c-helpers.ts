import type { NostrEvent } from "@/types/nostr";
import { getTagValue, getOrComputeCachedValue } from "applesauce-core/helpers";
import { nip19 } from "nostr-tools";
import { hexToBytes } from "@noble/hashes/utils";
import { isValidHexPubkey, isValidHexEventId } from "@/lib/nostr-validation";
import { isValidRelayURL } from "@/lib/relay-url";

/**
 * NIP-5C Helper Functions
 * Utility functions for parsing NIP-5C Scroll events (kind 1227)
 *
 * All helper functions use applesauce's getOrComputeCachedValue to cache
 * computed values on the event object itself. This means you don't need
 * useMemo when calling these functions.
 */

export type ScrollParamType =
  | "public_key"
  | "event"
  | "string"
  | "number"
  | "timestamp"
  | "relay";

export interface ScrollParam {
  name: string;
  description: string;
  type: ScrollParamType;
  required: boolean;
  /** For event params, comma-separated list of supported kinds */
  supportedKinds?: string;
}

const VALID_PARAM_TYPES = new Set<string>([
  "public_key",
  "event",
  "string",
  "number",
  "timestamp",
  "relay",
]);

// Cache symbols
const ScrollParamsSymbol = Symbol("scrollParams");
const ScrollContentSizeSymbol = Symbol("scrollContentSize");

export function getScrollName(event: NostrEvent): string | undefined {
  return getTagValue(event, "name");
}

export function getScrollDescription(event: NostrEvent): string | undefined {
  return getTagValue(event, "description");
}

export function getScrollIcon(event: NostrEvent): string | undefined {
  return getTagValue(event, "icon");
}

/** Parses ["param", name, description, type, required, ...extra] tags */
export function getScrollParams(event: NostrEvent): ScrollParam[] {
  return getOrComputeCachedValue(event, ScrollParamsSymbol, () =>
    event.tags
      .filter((t) => t[0] === "param" && t[1])
      .map((t) => ({
        name: t[1],
        description: t[2] || "",
        type: (VALID_PARAM_TYPES.has(t[3])
          ? t[3]
          : "string") as ScrollParamType,
        required: t[4] === "required",
        supportedKinds: t[3] === "event" && t[5] ? t[5] : undefined,
      })),
  );
}

/** Estimates decoded WASM binary size from base64 content length */
export function getScrollContentSize(event: NostrEvent): number {
  return getOrComputeCachedValue(event, ScrollContentSizeSymbol, () => {
    if (!event.content) return 0;
    // base64 encodes 3 bytes per 4 chars, minus padding
    const padding = (event.content.match(/=+$/) || [""])[0].length;
    return Math.floor((event.content.length * 3) / 4) - padding;
  });
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export type ParamValue = Uint8Array | string | number | NostrEvent;

/** For "event" type, returns the event ID string — caller must fetch the actual event */
export function resolveParamValue(
  type: ScrollParamType,
  rawValue: string,
): ParamValue | null {
  const trimmed = rawValue.trim();
  if (!trimmed) return null;

  switch (type) {
    case "public_key": {
      if (trimmed.startsWith("npub")) {
        try {
          const decoded = nip19.decode(trimmed);
          if (decoded.type === "npub") return hexToBytes(decoded.data);
        } catch {
          return null;
        }
      }
      return isValidHexPubkey(trimmed) ? hexToBytes(trimmed) : null;
    }
    case "event": {
      try {
        const decoded = nip19.decode(trimmed);
        if (decoded.type === "nevent") return decoded.data.id;
        if (decoded.type === "note") return decoded.data;
      } catch {
        // Not a bech32 string — fall through to hex check
      }
      return isValidHexEventId(trimmed) ? trimmed : null;
    }
    case "string":
      return trimmed;
    case "number":
    case "timestamp": {
      const n = parseInt(trimmed, 10);
      return isNaN(n) ? null : n;
    }
    case "relay":
      return isValidRelayURL(trimmed) ? trimmed : null;
  }
}
