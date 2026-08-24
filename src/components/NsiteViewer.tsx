import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle } from "lucide-react";

import { fetchManifestEvent } from "@/services/napplet-host";
import {
  resolveNsiteFromEvent,
  NsiteResolutionError,
  type ResolvedNsite,
} from "@/services/nsite-host";
import { nsiteBootUrl, serveNsiteToFrame } from "@/services/nsite-serve";
import { recordNsiteRun } from "@/services/nsite-library";
import type { AddressPointer, EventPointer } from "@/lib/open-parser";

type Stage = "fetching-manifest" | "verifying" | "handing-over" | "error";

export interface NsiteViewerProps {
  /**
   * The manifest pointer, and the only thing persisted. Verified bytes and the
   * aggregate are recomputed on every mount — a window's props are written to
   * localStorage and published inside spellbooks, so a content address taken
   * from one would be a claim rather than a fact.
   */
  pointer: EventPointer | AddressPointer;
  windowId: string;
}

/**
 * Remounts the loader whenever the pointer changes.
 *
 * A remount is how the reset happens: resetting four pieces of state at the top
 * of the effect instead would be a synchronous cascade, and would leave the old
 * site on screen while the new one verified.
 */
export function NsiteViewer({ pointer, windowId }: NsiteViewerProps) {
  const key = useMemo(
    () =>
      "id" in pointer
        ? pointer.id
        : `${pointer.kind}:${pointer.pubkey}:${pointer.identifier}`,
    [pointer],
  );

  return <NsiteFrame key={key} pointer={pointer} windowId={windowId} />;
}

/*
 * No chrome of its own. The site gets the whole pane below the window title,
 * where the author and its name already live.
 */
function NsiteFrame({ pointer }: NsiteViewerProps) {
  const [stage, setStage] = useState<Stage>("fetching-manifest");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [resolved, setResolved] = useState<ResolvedNsite | null>(null);

  const frameRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        // Shared with napplets: the same pointer→event checks, including the
        // substitution defence in `assertManifestEvent`.
        const event = await fetchManifestEvent(pointer);
        if (cancelled) return;

        setStage("verifying");
        const site = await resolveNsiteFromEvent(event, (p) => {
          if (!cancelled) setProgress(p);
        });
        if (cancelled) return;

        if (!nsiteBootUrl(site.aggregateHash)) {
          throw new Error(
            "No origin is configured to run nsites on, so this one was not run.",
          );
        }

        // Mounts the frame at the site's own origin. The handover happens in
        // the effect below, once that frame exists to be talked to.
        void recordNsiteRun(site);
        setResolved(site);
        setStage("handing-over");
      } catch (caught) {
        if (cancelled) return;
        setError(
          caught instanceof NsiteResolutionError
            ? caught.message
            : caught instanceof Error
              ? caught.message
              : String(caught),
        );
        setStage("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pointer]);

  /*
   * The handover, once the frame is in the document.
   *
   * Runs before the frame can have loaded — a commit happens in this task, the
   * frame's own load and script do not — so the listener is attached before the
   * boot page can announce itself. The boot page repeats that announcement
   * anyway, because "before" is a claim about ordering and this costs nothing.
   */
  useEffect(() => {
    if (!resolved || !frameRef.current) return;
    let cancelled = false;

    serveNsiteToFrame(frameRef.current, resolved).catch((caught: unknown) => {
      if (cancelled) return;
      setError(caught instanceof Error ? caught.message : String(caught));
      setStage("error");
    });

    return () => {
      cancelled = true;
    };
  }, [resolved]);

  if (stage === "error") {
    return (
      <div className="p-4">
        <div className="flex items-start gap-3 rounded border border-destructive/40 bg-destructive/5 p-3">
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
          <div className="min-w-0">
            <p className="text-sm font-medium">Could not run this nsite</p>
            <p className="mt-1 break-words text-xs text-muted-foreground">
              {error}
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (!resolved) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-xs text-muted-foreground">
          {stage === "fetching-manifest"
            ? "Fetching the manifest…"
            : progress
              ? `Verifying files… ${progress.done}/${progress.total}`
              : "Verifying files…"}
        </p>
      </div>
    );
  }

  return (
    /*
     * Its own origin, and no `sandbox`. The isolation here is the origin
     * itself: `<aggregate>.localhost` in development, a wildcard subdomain in
     * production. Grimoire's localStorage — which holds a secret key for an
     * nsec login — its database and its service worker are all on a different
     * origin and unreachable, which is exactly what a path on grimoire's own
     * origin could not offer however carefully it was sandboxed.
     */
    <iframe
      ref={frameRef}
      src={nsiteBootUrl(resolved.aggregateHash) ?? "about:blank"}
      // Nowhere else to say it, so it lives on the frame: a site running with
      // dead assets, or an aggregate that did not add up, should be
      // discoverable rather than silently different.
      title={[
        resolved.title || "nsite",
        resolved.missing.length
          ? `${resolved.missing.length} file(s) no server would serve`
          : "",
        resolved.aggregate === "absent"
          ? "no NIP-5A aggregate declared"
          : resolved.aggregate === "mismatch"
            ? "NIP-5A aggregate disagrees with the listed paths"
            : "",
      ]
        .filter(Boolean)
        .join(" — ")}
      className="h-full w-full flex-1 border-0 bg-white"
    />
  );
}

export default NsiteViewer;
