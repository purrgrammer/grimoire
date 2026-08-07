import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Copy,
  CopyCheck,
  Loader2,
  RotateCw,
  ShieldAlert,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { UserName } from "@/components/nostr/UserName";
import { useTheme } from "@/lib/themes";
import { useCopy } from "@/hooks/useCopy";
import { getMissingRequiredNaps } from "@/lib/napplet-parser";
import type { AddressPointer, EventPointer } from "@/lib/open-parser";
import type { NostrEvent } from "@/types/nostr";
import {
  fetchManifestEvent,
  getNappletBridge,
  getNappletEnvironment,
  injectCspMeta,
  injectNappletNamespacePrelude,
  originRegistry,
  publishNappletTheme,
  toNapTheme,
  resolveNappletFromEvent,
  NappletLookupError,
  NappletResolutionError,
  type ResolvedNappletView,
} from "@/services/napplet-host";

export interface NappletViewerProps {
  /**
   * The manifest pointer, and the only thing persisted. Resolved bytes and the
   * aggregate hash must never be stored — window props are written to
   * localStorage and published inside kind-30777 spellbooks, and identity has
   * to be recomputed from freshly verified bytes on every mount.
   */
  pointer: EventPointer | AddressPointer;
  windowId: string;
}

type Stage = "fetching-manifest" | "resolving" | "ready" | "error";

interface NappletError {
  code: string;
  message: string;
  /** Integrity failures are a security signal, not a transient fault. */
  integrity: boolean;
  missing?: string[];
}

const INTEGRITY_CODES = new Set([
  "invalid-signature",
  "aggregate-mismatch",
  "blob-hash-mismatch",
  "pointer-mismatch",
]);

function toNappletError(error: unknown): NappletError {
  if (error instanceof NappletResolutionError) {
    return {
      code: error.code,
      message: error.message,
      integrity: INTEGRITY_CODES.has(error.code),
    };
  }
  if (error instanceof NappletLookupError) {
    return {
      code: error.code,
      message: error.message,
      integrity: INTEGRITY_CODES.has(error.code),
    };
  }
  return {
    code: "unknown",
    message: error instanceof Error ? error.message : String(error),
    integrity: false,
  };
}

function pointerKey(pointer: EventPointer | AddressPointer): string {
  return "id" in pointer
    ? pointer.id
    : `${pointer.kind}:${pointer.pubkey}:${pointer.identifier}`;
}

/**
 * Remounts the loader whenever the pointer or the reload nonce changes, so the
 * reset back to "fetching-manifest" is a fresh mount rather than a setState in
 * an effect body.
 */
export function NappletViewer({ pointer, windowId }: NappletViewerProps) {
  const [reloadNonce, setReloadNonce] = useState(0);
  const reload = useCallback(() => setReloadNonce((n) => n + 1), []);
  const key = useMemo(() => pointerKey(pointer), [pointer]);

  return (
    <NappletFrame
      key={`${key}:${reloadNonce}`}
      pointer={pointer}
      windowId={windowId}
      onReload={reload}
    />
  );
}

function NappletFrame({
  pointer,
  windowId,
  onReload,
}: NappletViewerProps & { onReload: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState<Stage>("fetching-manifest");
  const [error, setError] = useState<NappletError | null>(null);
  const [resolved, setResolved] = useState<ResolvedNappletView | null>(null);
  const { theme } = useTheme();
  const { copied, copy } = useCopy();

  useEffect(() => {
    const cancelled = { current: false };
    let frame: HTMLIFrameElement | null = null;
    let onLoad: (() => void) | null = null;

    (async () => {
      let manifest: NostrEvent;
      let view: ResolvedNappletView;
      try {
        // Create the bridge before any frame exists so the message listener is
        // installed by the time a napplet posts shell.ready.
        getNappletBridge();
        manifest = await fetchManifestEvent(pointer);
        if (cancelled.current) return;
        setStage("resolving");
        view = await resolveNappletFromEvent(manifest);
      } catch (caught) {
        if (cancelled.current) return;
        const failure = toNappletError(caught);
        if (failure.integrity) {
          console.warn("[napplet] integrity check failed", caught);
          toast.error("Napplet failed verification", {
            description: failure.message,
          });
        }
        setError(failure);
        setStage("error");
        return;
      }

      if (cancelled.current) return;

      const environment = getNappletEnvironment(view.identity);
      const missing = getMissingRequiredNaps(
        view.requires,
        environment.capabilities.domains,
      );
      if (missing.length > 0) {
        setResolved(view);
        setError({
          code: "unsupported-requires",
          message:
            "This napplet requires capabilities grimoire does not expose.",
          integrity: false,
          missing,
        });
        setStage("error");
        return;
      }

      const container = containerRef.current;
      if (!container) return;

      setResolved(view);
      setStage("ready");

      // Steps below are synchronous and uninterrupted: the Window must be in
      // originRegistry before srcdoc runs any napplet code, or the napplet's
      // first message arrives from an unregistered source and is dropped. This
      // is also why the iframe cannot be JSX with a srcDoc prop.
      frame = document.createElement("iframe");
      frame.sandbox.add("allow-scripts");
      frame.setAttribute("allow", "");
      // Match the host surface: a napplet with no background of its own should not
      // punch a white hole through a dark theme.
      frame.className = "w-full h-full border-0 bg-background";
      frame.title = view.title ?? view.identity.dTag ?? "Napplet";
      container.appendChild(frame);

      const register = () => {
        if (!frame?.contentWindow) return;
        originRegistry.register(frame.contentWindow, windowId, view.identity);
        originRegistry.setEnvironment(frame.contentWindow, environment);
      };
      register();

      // srcdoc can swap contentWindow, which would orphan the registration.
      onLoad = () => {
        if (
          frame?.contentWindow &&
          originRegistry.getWindowId(frame.contentWindow) !== windowId
        ) {
          register();
        }
      };
      frame.addEventListener("load", onLoad);

      frame.srcdoc = injectNappletNamespacePrelude(
        injectCspMeta(view.indexHtml, []),
        environment.capabilities,
      );
    })();

    return () => {
      cancelled.current = true;
      originRegistry.unregister(windowId);
      if (frame) {
        if (onLoad) frame.removeEventListener("load", onLoad);
        frame.src = "about:blank";
        frame.remove();
      }
    };
    // Runs once per mount; the parent remounts on pointer or reload change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Follow grimoire's theme. Only reaches napplets that were granted `theme`.
  useEffect(() => {
    if (stage !== "ready") return;
    publishNappletTheme(toNapTheme(theme));
  }, [theme, stage]);

  return (
    <div className="flex h-full w-full flex-col">
      {/* Same single-line shape as the req and profile headers. */}
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-2 font-mono text-xs">
        {resolved ? (
          <div className="flex min-w-0 items-center gap-1 truncate">
            <UserName
              pubkey={resolved.manifestEvent.pubkey}
              className="text-inherit"
            />
            <span className="text-muted-foreground"> - </span>
            <span className="truncate">
              {resolved.title || resolved.identity.dTag || "Napplet"}
            </span>
          </div>
        ) : (
          <span className="text-muted-foreground">…</span>
        )}

        <div className="flex flex-shrink-0 items-center gap-3">
          {resolved && (
            <button
              onClick={() => copy(resolved.identity.aggregateHash)}
              className="flex items-center gap-1 truncate text-muted-foreground transition-colors hover:text-foreground"
              title={`Verified content address ${resolved.identity.aggregateHash}`}
              aria-label="Copy the verified content address"
            >
              {copied ? (
                <CopyCheck className="size-3 flex-shrink-0" />
              ) : (
                <Copy className="size-3 flex-shrink-0" />
              )}
              <code className="truncate">
                {resolved.identity.aggregateHash.slice(0, 12)}…
                {resolved.identity.aggregateHash.slice(-6)}
              </code>
            </button>
          )}
          <button
            className="flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
            onClick={onReload}
            title="Re-resolve and verify"
            aria-label="Re-resolve and verify"
          >
            <RotateCw className="size-3" />
          </button>
        </div>
      </header>

      {stage !== "ready" && (
        <div className="flex flex-1 items-center justify-center p-6">
          {stage === "error" && error ? (
            <NappletErrorPanel error={error} onRetry={onReload} />
          ) : (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              <span>
                {stage === "fetching-manifest"
                  ? "Fetching manifest…"
                  : "Verifying files…"}
              </span>
            </div>
          )}
        </div>
      )}

      <div
        ref={containerRef}
        className={stage === "ready" ? "relative flex-1" : "hidden"}
      />
    </div>
  );
}

function NappletErrorPanel({
  error,
  onRetry,
}: {
  error: NappletError;
  onRetry: () => void;
}) {
  // Body text stays on the card surface rather than on a saturated fill, so
  // contrast holds in every theme. The tone only colors the border and icon,
  // and it comes from the theme's semantic tokens, not a fixed Tailwind scale.
  const accent = error.integrity ? "border-l-destructive" : "border-l-warning";
  const iconTone = error.integrity ? "text-destructive" : "text-warning";

  return (
    <div
      className={`max-w-md rounded-md border border-l-4 bg-card p-4 text-card-foreground ${accent}`}
    >
      <div className="flex items-start gap-3">
        {error.integrity ? (
          <ShieldAlert className={`mt-0.5 size-5 shrink-0 ${iconTone}`} />
        ) : (
          <AlertCircle className={`mt-0.5 size-5 shrink-0 ${iconTone}`} />
        )}
        <div className="flex-1 space-y-2">
          <h3 className="text-sm font-semibold text-foreground">
            {error.integrity
              ? "Verification failed — nothing was rendered"
              : "Could not open this napplet"}
          </h3>
          <p className="text-xs text-muted-foreground">{error.message}</p>
          {error.missing && error.missing.length > 0 && (
            <div className="flex flex-wrap items-center gap-1">
              {error.missing.map((nap) => (
                <Label key={nap}>{nap}</Label>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2 pt-1">
            <Label>{error.code}</Label>
            {!error.integrity && (
              <Button variant="outline" size="sm" onClick={onRetry}>
                Retry
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default NappletViewer;
