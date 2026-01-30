import { useState, useEffect, useRef, useCallback } from "react";
import {
  getInfoRefs,
  getDirectoryTreeAt,
  MissingCapability,
} from "@fiatjaf/git-natural-api";
import { useStableArray } from "@/hooks/useStable";
import type { DirectoryTree } from "@/lib/git-types";

interface UseGitTreeOptions {
  /** Clone URLs to try in order */
  cloneUrls: string[];
  /** Branch, tag, or commit ref (defaults to HEAD) */
  ref?: string;
  /** Whether to fetch immediately */
  enabled?: boolean;
}

interface UseGitTreeResult {
  /** The directory tree if successfully fetched */
  tree: DirectoryTree | null;
  /** Loading state */
  loading: boolean;
  /** Error if fetch failed */
  error: Error | null;
  /** Which server URL succeeded */
  serverUrl: string | null;
  /** Refetch the tree */
  refetch: () => void;
}

/**
 * Hook to fetch a git repository tree from clone URLs
 *
 * Tries each clone URL in sequence until one succeeds.
 * Uses the lightweight `getDirectoryTreeAt` which requires filter capability.
 * Servers without filter support are skipped.
 *
 * @example
 * const { tree, loading, error } = useGitTree({
 *   cloneUrls: ['https://github.com/user/repo.git'],
 *   ref: 'main'
 * })
 */
export function useGitTree({
  cloneUrls,
  ref = "HEAD",
  enabled = true,
}: UseGitTreeOptions): UseGitTreeResult {
  const [tree, setTree] = useState<DirectoryTree | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [serverUrl, setServerUrl] = useState<string | null>(null);

  // Stabilize cloneUrls to prevent unnecessary re-fetches
  const stableCloneUrls = useStableArray(cloneUrls);

  // Track mounted state to prevent state updates after unmount
  const isMountedRef = useRef(true);

  const fetchTree = useCallback(async () => {
    if (stableCloneUrls.length === 0) {
      setError(new Error("No clone URLs provided"));
      return;
    }

    setLoading(true);
    setError(null);
    setTree(null);
    setServerUrl(null);

    const errors: Error[] = [];

    for (const url of stableCloneUrls) {
      // Check if still mounted before each iteration
      if (!isMountedRef.current) return;

      try {
        // Get server info to check capabilities and resolve refs
        const info = await getInfoRefs(url);

        if (!isMountedRef.current) return;

        // Only use servers that support filter capability (lightweight fetch)
        // Skip servers that would require downloading all blobs
        if (!info.capabilities.includes("filter")) {
          console.warn(
            `[useGitTree] Server ${url} doesn't support filter capability, skipping`,
          );
          errors.push(
            new MissingCapability("filter", "Server doesn't support filter"),
          );
          continue;
        }

        // Resolve the ref to a commit hash
        let resolvedRef = ref;
        if (ref === "HEAD" && info.symrefs["HEAD"]) {
          // HEAD points to a branch like "refs/heads/main"
          const headBranch = info.symrefs["HEAD"];
          if (info.refs[headBranch]) {
            resolvedRef = info.refs[headBranch];
          }
        } else if (ref.startsWith("refs/") && info.refs[ref]) {
          resolvedRef = info.refs[ref];
        } else if (!ref.match(/^[0-9a-f]{40}$/i)) {
          // Try common ref patterns
          const possibleRefs = [`refs/heads/${ref}`, `refs/tags/${ref}`];
          for (const possibleRef of possibleRefs) {
            if (info.refs[possibleRef]) {
              resolvedRef = info.refs[possibleRef];
              break;
            }
          }
        }

        // Fetch the tree using lightweight filter (tree only, no blobs)
        const fetchedTree = await getDirectoryTreeAt(url, resolvedRef);

        if (!isMountedRef.current) return;

        setTree(fetchedTree);
        setServerUrl(url);
        setLoading(false);
        return;
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        errors.push(err);

        // Log specific error types for debugging
        if (e instanceof MissingCapability) {
          console.warn(
            `[useGitTree] Server ${url} missing capability: ${e.capability}`,
          );
        } else {
          console.warn(
            `[useGitTree] Failed to fetch from ${url}:`,
            err.message,
          );
        }
        continue;
      }
    }

    if (!isMountedRef.current) return;

    // All URLs failed
    const message =
      errors.length === 1
        ? errors[0].message
        : `All ${stableCloneUrls.length} servers failed`;
    setError(new Error(message));
    setLoading(false);
  }, [stableCloneUrls, ref]);

  useEffect(() => {
    isMountedRef.current = true;

    if (enabled && stableCloneUrls.length > 0) {
      fetchTree();
    }

    return () => {
      isMountedRef.current = false;
    };
  }, [enabled, fetchTree, stableCloneUrls]);

  return {
    tree,
    loading,
    error,
    serverUrl,
    refetch: fetchTree,
  };
}
