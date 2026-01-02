import { useState, useEffect, useCallback } from "react";
import { getObject } from "@fiatjaf/git-natural-api";

interface UseGitBlobOptions {
  /** Git server URL */
  serverUrl: string | null;
  /** Blob hash to fetch */
  hash: string | null;
  /** Whether to fetch immediately */
  enabled?: boolean;
}

interface UseGitBlobResult {
  /** The blob content as Uint8Array */
  content: Uint8Array | null;
  /** Content decoded as text (if decodable) */
  text: string | null;
  /** Loading state */
  loading: boolean;
  /** Error if fetch failed */
  error: Error | null;
  /** Whether the content appears to be binary */
  isBinary: boolean;
  /** Refetch the blob */
  refetch: () => void;
}

/**
 * Check if content appears to be binary (contains null bytes or non-text characters)
 */
function detectBinary(data: Uint8Array): boolean {
  // Check first 8KB for binary indicators
  const checkLength = Math.min(data.length, 8192);
  for (let i = 0; i < checkLength; i++) {
    const byte = data[i];
    // Null byte is a strong indicator of binary
    if (byte === 0) return true;
    // Non-printable characters (except common whitespace) suggest binary
    if (byte < 9 || (byte > 13 && byte < 32)) return true;
  }
  return false;
}

/**
 * Hook to fetch a git blob (file content) by its hash
 *
 * @example
 * const { content, text, loading } = useGitBlob({
 *   serverUrl: 'https://github.com/user/repo.git',
 *   hash: 'abc123...'
 * })
 */
export function useGitBlob({
  serverUrl,
  hash,
  enabled = true,
}: UseGitBlobOptions): UseGitBlobResult {
  const [content, setContent] = useState<Uint8Array | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [isBinary, setIsBinary] = useState(false);

  const fetchBlob = useCallback(async () => {
    if (!serverUrl || !hash) {
      return;
    }

    setLoading(true);
    setError(null);
    setContent(null);
    setText(null);
    setIsBinary(false);

    try {
      const object = await getObject(serverUrl, hash);

      if (!object || !object.data) {
        throw new Error("Empty or invalid blob");
      }

      const data = object.data;
      setContent(data);

      // Check if binary
      const binary = detectBinary(data);
      setIsBinary(binary);

      // Try to decode as text if not binary
      if (!binary) {
        try {
          const decoder = new TextDecoder("utf-8", { fatal: true });
          setText(decoder.decode(data));
        } catch {
          // Decoding failed, treat as binary
          setIsBinary(true);
        }
      }
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      console.warn(`[useGitBlob] Failed to fetch blob ${hash}:`, err.message);
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [serverUrl, hash]);

  useEffect(() => {
    if (enabled && serverUrl && hash) {
      fetchBlob();
    }
  }, [enabled, serverUrl, hash, fetchBlob]);

  return {
    content,
    text,
    loading,
    error,
    isBinary,
    refetch: fetchBlob,
  };
}
