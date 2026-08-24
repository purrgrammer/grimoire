import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Copy,
  CopyCheck,
  ExternalLink,
  RotateCw,
} from "lucide-react";

import { fetchManifestEvent } from "@/services/napplet-host";
import {
  resolveNsiteFromEvent,
  NsiteResolutionError,
  type ResolvedNsite,
} from "@/services/nsite-host";
import { serveNsite } from "@/services/nsite-serve";
import { recordNsiteRun } from "@/services/nsite-library";
import { getNsiteGatewayUrl } from "@/lib/nip5a-helpers";
import { useCopy } from "@/hooks/useCopy";
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
 * Remounts the loader whenever the pointer or the reload nonce changes.
 *
 * A remount is how the reset happens: resetting five pieces of state at the top
 * of the effect instead would be a synchronous cascade, and would leave the old
 * site's chrome on screen while the new one verified.
 */
export function NsiteViewer({ pointer, windowId }: NsiteViewerProps) {
  const [nonce, setNonce] = useState(0);
  const key = useMemo(
    () =>
      "id" in pointer
        ? pointer.id
        : `${pointer.kind}:${pointer.pubkey}:${pointer.identifier}`,
    [pointer],
  );

  return (
    <NsiteFrame
      key={`${key}:${nonce}`}
      pointer={pointer}
      windowId={windowId}
      onReload={() => setNonce((n) => n + 1)}
    />
  );
}

function NsiteFrame({
  pointer,
  onReload,
}: NsiteViewerProps & { onReload: () => void }) {
  const [stage, setStage] = useState<Stage>("fetching-manifest");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [resolved, setResolved] = useState<ResolvedNsite | null>(null);
  const [src, setSrc] = useState<string | null>(null);

  const { copied, copy } = useCopy();

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
      {/* Controls only. The author and the site's name live in the window
          title, where every other app puts them — same as a napplet. */}
      <header className="flex items-center justify-end gap-3 border-b border-border px-4 py-2 font-mono text-xs">
        {resolved && resolved.missing.length > 0 && (
          // A site can be worth running with a dead asset in it, but not
          // silently: the pane would just be missing a picture with no reason
          // given anywhere.
          <span
            className="mr-auto shrink-0 text-[10px] text-warning"
            title={`No server had: ${resolved.missing.slice(0, 12).join(", ")}${resolved.missing.length > 12 ? "…" : ""}`}
          >
            {resolved.missing.length} missing
          </span>
        )}
        {resolved && resolved.aggregate !== "verified" && (
          // Said plainly rather than hidden: the signature and every file hash
          // checked out, and only the publisher's own `x` did not.
          <span
            className={`shrink-0 text-[10px] text-warning ${resolved.missing.length > 0 ? "" : "mr-auto"}`}
            title={
              resolved.aggregate === "absent"
                ? "This manifest declares no NIP-5A aggregate. Its signature and every file hash were still checked."
                : "This manifest's NIP-5A aggregate disagrees with the paths it lists — usually a publisher bug. Its signature and every file hash were still checked."
            }
          >
            {resolved.aggregate === "absent"
              ? "no aggregate"
              : "aggregate differs"}
          </span>
        )}
        {resolved && (
          <>
            <button
              className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
              title="Copy the computed content address"
              aria-label="Copy the computed content address"
              onClick={() => copy(resolved.aggregateHash)}
            >
              {copied ? (
                <CopyCheck className="size-3" />
              ) : (
                <Copy className="size-3" />
              )}
            </button>
            <a
              href={getNsiteGatewayUrl(resolved.manifestEvent)}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
              title="Open at the public gateway instead"
              aria-label="Open at the public gateway instead"
            >
              <ExternalLink className="size-3" />
            </a>
          </>
        )}
        <button
          className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
          title="Re-fetch and verify"
          aria-label="Re-fetch and verify"
          onClick={onReload}
        >
          <RotateCw className="size-3" />
        </button>
      </header>

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
          title={resolved?.title || "nsite"}
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
