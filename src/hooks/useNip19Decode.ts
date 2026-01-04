import { useMemo } from "react";
import { nip19 } from "nostr-tools";
import type {
  EventPointer,
  AddressPointer,
  ProfilePointer,
} from "nostr-tools/nip19";

/**
 * Supported NIP-19 entity types for decoding
 */
export type Nip19EntityType = "npub" | "note" | "nevent" | "naddr" | "nprofile";

/**
 * Decoded entity result with discriminated union for type safety
 */
export type DecodedEntity =
  | { type: "npub"; data: string }
  | { type: "note"; data: string }
  | { type: "nevent"; data: EventPointer }
  | { type: "naddr"; data: AddressPointer }
  | { type: "nprofile"; data: ProfilePointer };

/**
 * Hook result containing decoded data or error
 */
export interface UseNip19DecodeResult {
  /** Decoded entity (null on error) */
  decoded: DecodedEntity | null;
  /** Error message (null if no error) */
  error: string | null;
}

/**
 * Synchronously decode NIP-19 encoded entities (npub, note, nevent, naddr, nprofile)
 * Results are memoized - same identifier always yields same result
 *
 * @param identifier - The NIP-19 encoded string (e.g., "npub1...")
 * @param expectedType - Optional expected type for validation
 * @returns Decoded entity or error
 *
 * @example
 * ```tsx
 * const { decoded, error } = useNip19Decode(identifier, "npub");
 * if (error) return <Error message={error} />;
 * if (decoded?.type === "npub") {
 *   return <Profile pubkey={decoded.data} />;
 * }
 * ```
 */
export function useNip19Decode(
  identifier: string | undefined,
  expectedType?: Nip19EntityType
): UseNip19DecodeResult {
  return useMemo(() => {
    if (!identifier) {
      return {
        decoded: null,
        error: "No identifier provided",
      };
    }

    try {
      const result = nip19.decode(identifier);

      // Validate expected type if provided
      if (expectedType && result.type !== expectedType) {
        return {
          decoded: null,
          error: `Invalid identifier type: expected ${expectedType}, got ${result.type}`,
        };
      }

      // Map decoded result to typed entity
      let entity: DecodedEntity;

      switch (result.type) {
        case "npub":
          entity = { type: "npub", data: result.data };
          break;
        case "note":
          entity = { type: "note", data: result.data };
          break;
        case "nevent":
          entity = { type: "nevent", data: result.data };
          break;
        case "naddr":
          entity = { type: "naddr", data: result.data };
          break;
        case "nprofile":
          entity = { type: "nprofile", data: result.data };
          break;
        default:
          return {
            decoded: null,
            error: `Unsupported entity type: ${result.type}`,
          };
      }

      return {
        decoded: entity,
        error: null,
      };
    } catch (e) {
      const errorMessage =
        e instanceof Error ? e.message : "Failed to decode identifier";
      return {
        decoded: null,
        error: errorMessage,
      };
    }
  }, [identifier, expectedType]);
}
