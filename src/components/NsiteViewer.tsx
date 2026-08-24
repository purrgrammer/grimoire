import { useEffect, useMemo, useState } from "react";
import { AlertCircle } from "lucide-react";

import { fetchManifestEvent } from "@/services/napplet-host";
import {
  resolveNsiteFromEvent,
  NsiteResolutionError,
  type ResolvedNsite,
} from "@/services/nsite-host";
import { serveNsite } from "@/services/nsite-serve";
import { recordNsiteRun } from "@/services/nsite-library";
import type { AddressPointer, EventPointer } from "@/lib/open-parser";

type Stage = "fetching-manifest" | "verifying" | "ready" | "error";

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
 * where the author and its name already live — a bar with a copy button and a
 * gateway link on top of a full web page read as a second title, and the thing
 * it framed was already framed.
 */
function NsiteFrame({ pointer }: NsiteViewerProps) {
  const [stage, setStage] = useState<Stage>("fetching-manifest");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [resolved, setResolved] = useState<ResolvedNsite | null>(null);
  const [src, setSrc] = useState<string | null>(null);

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

        const url = await serveNsite(site);
        if (cancelled) return;

        void recordNsiteRun(site);
        setResolved(site);
        setSrc(url);
        setStage("ready");
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

  return (
    <div className="flex h-full flex-col">
      {stage === "error" ? (
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
      ) : stage === "ready" && src ? (
        /*
         * Not `srcdoc`. The site is served from grimoire's own origin under its
         * content address, which is the only way its runtime `fetch()` calls and
         * absolute asset paths resolve — see `nsite-host.ts`. `allow-same-origin`
         * is therefore load-bearing rather than a relaxation: without it the
         * frame gets an opaque origin and cannot read back what the worker
         * serves it.
         */
        <iframe
          src={src}
          // No chrome to say it in, so it lives on the frame itself: a site
          // running with dead assets or an aggregate that did not add up
          // should still be discoverable, not silently different.
          title={[
            resolved?.title || "nsite",
            resolved?.missing.length
              ? `${resolved.missing.length} file(s) no server would serve`
              : "",
            resolved?.aggregate === "absent"
              ? "no NIP-5A aggregate declared"
              : resolved?.aggregate === "mismatch"
                ? "NIP-5A aggregate disagrees with the listed paths"
                : "",
          ]
            .filter(Boolean)
            .join(" — ")}
          className="h-full w-full flex-1 border-0 bg-white"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        />
      ) : (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-xs text-muted-foreground">
            {stage === "fetching-manifest"
              ? "Fetching the manifest…"
              : progress
                ? `Verifying files… ${progress.done}/${progress.total}`
                : "Verifying files…"}
          </p>
        </div>
      )}
    </div>
  );
}

export default NsiteViewer;
