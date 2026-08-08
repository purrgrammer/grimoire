import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Copy,
  CopyCheck,
  Loader2,
  RotateCw,
  ShieldAlert,
  Terminal,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NappletPermissions } from "@/components/NappletPermissions";
import { NappletMessageDrawer } from "@/components/NappletMessageDrawer";
import { useTheme } from "@/lib/themes";
import { useCopy } from "@/hooks/useCopy";
import { getMissingRequiredNaps } from "@/lib/napplet-parser";
import type { AddressPointer, EventPointer } from "@/lib/open-parser";
import type { NostrEvent } from "@/types/nostr";
import {
  registerNappletIdentity,
  unregisterNappletIdentity,
  startNappletConsent,
  subscribeNappletReload,
  requestLaunchConsent,
  grantLaunchCapabilities,
} from "@/services/napplet-consent";
import { recordNappletRun } from "@/services/napplet-library";
import {
  getNappletDecisions,
  isRemoteMediaGranted,
} from "@/services/napplet-acl";
import { getGrantedOrigins } from "@/services/napplet-origins";
import { injectNappletTap } from "@/services/napplet-messages";
import {
  capabilitiesForDomains,
  unenforceableDomains,
  setDeclaredDomains,
  REMOTE_MEDIA_CAPABILITY,
} from "@/services/napplet-capabilities";
import {
  fetchManifestEvent,
  getNappletBridge,
  getNappletEnvironment,
  injectCspMeta,
  injectNappletNamespacePrelude,
  destroyNappletWindow,
  resyncNappletTap,
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

  // Deliberately above the remount key: a reload is the most useful moment to be
  // watching the wire, so the drawer has to survive one. Keeping it open across
  // the reload is also what lets it record the `shell.ready` handshake, which
  // happens before a drawer opened afterwards could have started.
  const [showMessages, setShowMessages] = useState(false);

  // Granting a capability only takes effect on a fresh run — the ACL is
  // consulted synchronously and the napplet has already been refused once.
  useEffect(() => {
    return subscribeNappletReload((reloadedWindowId) => {
      if (reloadedWindowId === windowId) reload();
    });
  }, [windowId, reload]);

  return (
    <NappletFrame
      key={`${key}:${reloadNonce}`}
      pointer={pointer}
      windowId={windowId}
      onReload={reload}
      showMessages={showMessages}
      onToggleMessages={() => setShowMessages((open) => !open)}
    />
  );
}

function NappletFrame({
  pointer,
  windowId,
  onReload,
  showMessages,
  onToggleMessages,
}: NappletViewerProps & {
  onReload: () => void;
  showMessages: boolean;
  onToggleMessages: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState<Stage>("fetching-manifest");
  const [error, setError] = useState<NappletError | null>(null);
  const [resolved, setResolved] = useState<ResolvedNappletView | null>(null);
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const { theme } = useTheme();
  const { copied, copy } = useCopy();

  // Grants are listed in the permissions popover; a refusal is worth surfacing
  // without one, because it is why the napplet is misbehaving.
  const refused = useMemo(() => {
    if (!resolved) return [];
    return getNappletDecisions()
      .filter(
        (d) =>
          !d.allowed &&
          d.dTag === resolved.identity.dTag &&
          d.aggregateHash === resolved.identity.aggregateHash,
      )
      .map((d) => d.capability);
  }, [resolved]);

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
        startNappletConsent();
        manifest = await fetchManifestEvent(pointer);
        if (cancelled.current) return;
        setStage("resolving");
        view = await resolveNappletFromEvent(manifest, (p) => {
          if (!cancelled.current) setProgress(p);
        });
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

      // Record the declaration before resolving the environment: the adapter's
      // resolveEnvironment narrows this napplet's domains to what it declared.
      setDeclaredDomains(
        view.identity.dTag,
        view.identity.aggregateHash,
        view.requires,
      );

      // Ask once, up front, for everything the manifest declared — and grant it
      // before srcdoc, so a well-behaved napplet never has to be re-run.
      // Remote media rides along: no manifest can declare it, and the CSP that
      // enforces it is written at frame creation, so it has to be answered here.
      const declaredCapabilities = [
        ...capabilitiesForDomains(view.requires),
        REMOTE_MEDIA_CAPABILITY,
      ];
      const decision = await requestLaunchConsent({
        dTag: view.identity.dTag,
        aggregateHash: view.identity.aggregateHash,
        title: view.title || view.identity.dTag || "Napplet",
        pubkey: view.manifestEvent.pubkey,
        capabilities: declaredCapabilities,
        unenforceable: unenforceableDomains(view.requires),
      });
      if (cancelled.current) return;
      if (decision.cancelled) {
        setResolved(view);
        setError({
          code: "declined",
          message: "You chose not to run this napplet.",
          integrity: false,
        });
        setStage("error");
        return;
      }
      grantLaunchCapabilities(
        view.identity.dTag,
        view.identity.aggregateHash,
        decision.granted,
      );

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
      // `allow-scripts` alone, always — never `allow-same-origin`, which would
      // hand the napplet grimoire's origin and every credential in it.
      //
      // The permissions policy delegates exactly one feature. `clipboard-write`
      // requires a user gesture, so a napplet cannot write unprompted, and
      // without it every copy button inside a napplet fails: Chrome denies both
      // `navigator.clipboard.writeText` and the `execCommand("copy")` fallback.
      // The residual hazard is clipboard hijacking — a napplet writing something
      // other than what the user thought they copied — which is the same risk
      // any web page carries.
      frame.setAttribute("allow", "clipboard-write");
      // Match the host surface: a napplet with no background of its own should not
      // punch a white hole through a dark theme.
      frame.className = "w-full h-full border-0 bg-background";
      frame.title = view.title ?? view.identity.dTag ?? "Napplet";
      container.appendChild(frame);

      // Only after verification and consent, so the launcher can never list a
      // napplet that failed its checks.
      void recordNappletRun({
        pointer,
        kind: view.manifestEvent.kind,
        pubkey: view.manifestEvent.pubkey,
        identifier: view.identity.dTag,
        title: view.title || view.identity.dTag || "Napplet",
        description: view.description,
        manifest: view.manifestEvent,
      });

      registerNappletIdentity(windowId, {
        dTag: view.identity.dTag,
        aggregateHash: view.identity.aggregateHash,
        title: view.title || view.identity.dTag || "Napplet",
        pubkey: view.manifestEvent.pubkey,
      });

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
        // The document is new, so its message tap booted dormant.
        resyncNappletTap(windowId);
      };
      frame.addEventListener("load", onLoad);

      // connect-src is exactly what the user granted this version — not a
      // wildcard, and empty for the overwhelming majority of napplets.
      // The tap goes last so it observes the finished document, and it is
      // dormant until a drawer switches it on. Note it is inside the CSP that
      // was already injected — an inline script, which `script-src` allows.
      frame.srcdoc = injectNappletTap(
        injectNappletNamespacePrelude(
          injectCspMeta(
            view.indexHtml,
            getGrantedOrigins(view.identity.dTag, view.identity.aggregateHash),
            {
              remoteMedia: isRemoteMediaGranted(
                view.identity.dTag,
                view.identity.aggregateHash,
              ),
            },
          ),
          environment.capabilities,
        ),
      );
    })();

    return () => {
      cancelled.current = true;
      unregisterNappletIdentity(windowId);
      destroyNappletWindow(windowId);
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
      {/* Controls only. The author and the napplet's name live in the window
          title, where every other app puts them — repeating them here was the
          crowding. What stays is what has nowhere else to go. */}
      <header className="flex items-center justify-end gap-3 border-b border-border px-4 py-2 font-mono text-xs">
        {refused.length > 0 && (
          <span
            className="mr-auto shrink-0 text-[10px] text-warning"
            title={`Refused: ${refused.join(", ")}`}
          >
            {refused.length} refused
          </span>
        )}
        {resolved && (
          <NappletPermissions
            dTag={resolved.identity.dTag}
            aggregateHash={resolved.identity.aggregateHash}
            // Forgetting a grant only takes effect on a fresh run — the
            // runtime's live ACL state still holds it.
            onChanged={onReload}
          />
        )}
        <button
          className={`flex items-center gap-1 transition-colors hover:text-foreground ${
            showMessages ? "text-foreground" : "text-muted-foreground"
          }`}
          onClick={onToggleMessages}
          title="Show messages between grimoire and this napplet"
          aria-label="Show messages between grimoire and this napplet"
          aria-pressed={showMessages}
        >
          <Terminal className="size-3" />
        </button>
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
                  : progress
                    ? `Verifying files… ${progress.done}/${progress.total}`
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

      {showMessages && (
        <NappletMessageDrawer windowId={windowId} onClose={onToggleMessages} />
      )}
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
