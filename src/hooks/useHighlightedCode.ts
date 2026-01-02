import { useState, useEffect } from "react";
import { highlightCode } from "@/lib/shiki";

interface UseHighlightedCodeResult {
  html: string | null;
  loading: boolean;
  error: Error | null;
}

/**
 * Hook to highlight code asynchronously with lazy language loading
 *
 * @example
 * const { html, loading } = useHighlightedCode(code, "typescript")
 * if (loading) return <pre>{code}</pre>
 * return <div dangerouslySetInnerHTML={{ __html: html }} />
 */
export function useHighlightedCode(
  code: string,
  language: string | null | undefined,
): UseHighlightedCodeResult {
  const [html, setHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    highlightCode(code, language)
      .then((result) => {
        if (!cancelled) {
          setHtml(result);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err : new Error(String(err)));
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [code, language]);

  return { html, loading, error };
}
