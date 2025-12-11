import { useState, useCallback, useRef, useEffect } from "react";

/**
 * Hook for copying text to clipboard with temporary "copied" state
 * @param timeout - Duration in ms to show "copied" state (default: 3000)
 * @returns Object with copy function and copied state
 */
export function useCopy(timeout = 3000) {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);

  // Clear timeout on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const copy = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);

        // Clear existing timeout
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
        }

        // Set new timeout to reset copied state
        timeoutRef.current = setTimeout(() => {
          setCopied(false);
        }, timeout);
      } catch (error) {
        console.error("Failed to copy to clipboard:", error);
        setCopied(false);
      }
    },
    [timeout],
  );

  return { copy, copied };
}
