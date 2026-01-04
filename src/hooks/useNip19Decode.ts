import { useEffect, useState } from "react";
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
 * Hook result containing decoded data, loading, and error states
 */
export interface UseNip19DecodeResult {
  /** Decoded entity (null while loading or on error) */
  decoded: DecodedEntity | null;
  /** Loading state */
  isLoading: boolean;
  /** Error message (null if no error) */
  error: string | null;
  /** Retry the decode operation */
  retry: () => void;
}

/**
 * Hook to decode NIP-19 encoded entities (npub, note, nevent, naddr, nprofile)
 *
 * @param identifier - The NIP-19 encoded string (e.g., "npub1...")
 * @param expectedType - Optional expected type for validation
 * @returns Decoded entity with loading and error states
 *
 * @example
 * ```tsx
 * const { decoded, isLoading, error } = useNip19Decode(identifier, "npub");
 * if (isLoading) return <Loading />;
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
  const [decoded, setDecoded] = useState<DecodedEntity | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    // Reset state when identifier changes
    setDecoded(null);
    setError(null);
    setIsLoading(true);

    if (!identifier) {
      setError("No identifier provided");
      setIsLoading(false);
      return;
    }

    try {
      const result = nip19.decode(identifier);

      // Validate expected type if provided
      if (expectedType && result.type !== expectedType) {
        setError(
          `Invalid identifier type: expected ${expectedType}, got ${result.type}`
        );
        setIsLoading(false);
        return;
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
          setError(`Unsupported entity type: ${result.type}`);
          setIsLoading(false);
          return;
      }

      setDecoded(entity);
      setIsLoading(false);
    } catch (e) {
      console.error("Failed to decode NIP-19 identifier:", identifier, e);
      const errorMessage =
        e instanceof Error ? e.message : "Failed to decode identifier";
      setError(errorMessage);
      setIsLoading(false);
    }
  }, [identifier, expectedType, retryCount]);

  const retry = () => {
    setRetryCount((prev) => prev + 1);
  };

  return {
    decoded,
    isLoading,
    error,
    retry,
  };
}
