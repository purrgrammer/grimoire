import { useState, useEffect, useMemo } from "react";
import { useGrimoire } from "@/core/state";
import { useAccountSync } from "@/hooks/useAccountSync";
import { useRelayListCacheSync } from "@/hooks/useRelayListCacheSync";
import { useRelayState } from "@/hooks/useRelayState";
import { useProfile } from "@/hooks/useProfile";
import relayStateManager from "@/services/relay-state-manager";
import { TabBar } from "./TabBar";
import { Mosaic, MosaicWindow, MosaicBranch } from "react-mosaic-component";
import CommandLauncher from "./CommandLauncher";
import { WindowToolbar } from "./WindowToolbar";
import { WindowTile } from "./WindowTitle";
import { BookHeart, X, Check, Link as LinkIcon, Loader2 } from "lucide-react";
import UserMenu from "./nostr/user-menu";
import { GrimoireWelcome } from "./GrimoireWelcome";
import { GlobalAuthPrompt } from "./GlobalAuthPrompt";
import { SpellbookDropdown } from "./SpellbookDropdown";
import { useParams, useNavigate, useLocation } from "react-router";
import { useNostrEvent } from "@/hooks/useNostrEvent";
import { resolveNip05, isNip05 } from "@/lib/nip05";
import { nip19 } from "nostr-tools";
import { parseSpellbook } from "@/lib/spellbook-manager";
import { SpellbookEvent } from "@/types/spell";
import { toast } from "sonner";
import { Button } from "./ui/button";

export default function Home() {
  const {
    state,
    updateLayout,
    removeWindow,
    switchToTemporary,
    applyTemporaryToPersistent,
    discardTemporary,
    isTemporary,
  } = useGrimoire();
  const [commandLauncherOpen, setCommandLauncherOpen] = useState(false);
  const { actor, identifier } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  // Preview state
  const [resolvedPubkey, setResolvedPubkey] = useState<string | null>(null);
  const [resolutionError, setResolutionError] = useState<string | null>(null);
  const [isResolving, setIsResolving] = useState(false);
  const isPreviewPath = location.pathname.startsWith("/preview/");
  const isDirectPath = actor && identifier && !isPreviewPath;
  const isFromApp = location.state?.fromApp === true;
  const [hasLoadedSpellbook, setHasLoadedSpellbook] = useState(false);

  // Show banner only if temporary AND we navigated from within the app
  const showBanner = isTemporary && isFromApp;

  // 1. Resolve actor to pubkey
  useEffect(() => {
    if (!actor) {
      setResolvedPubkey(null);
      setResolutionError(null);
      setIsResolving(false);
      setHasLoadedSpellbook(false);
      // If we were in temporary mode and navigated back to /, discard
      if (isTemporary) discardTemporary();
      return;
    }

    const resolve = async () => {
      setIsResolving(true);
      setResolutionError(null);

      try {
        if (actor.startsWith("npub")) {
          const { data } = nip19.decode(actor);
          setResolvedPubkey(data as string);
        } else if (isNip05(actor)) {
          // Add timeout for NIP-05 resolution
          const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error("NIP-05 resolution timeout")),
              10000,
            ),
          );
          const pubkey = await Promise.race([
            resolveNip05(actor),
            timeoutPromise,
          ]);
          setResolvedPubkey(pubkey);
        } else if (actor.length === 64) {
          setResolvedPubkey(actor);
        } else {
          setResolutionError(`Invalid actor format: ${actor}`);
        }
      } catch (e) {
        console.error("Failed to resolve actor:", actor, e);
        setResolutionError(
          e instanceof Error ? e.message : "Failed to resolve actor",
        );
        toast.error(`Failed to resolve actor: ${actor}`, {
          description:
            e instanceof Error ? e.message : "Invalid format or network error",
        });
      } finally {
        setIsResolving(false);
      }
    };

    resolve();
  }, [actor, isTemporary, discardTemporary]);

  // 2. Fetch the spellbook event
  const pointer = useMemo(() => {
    if (!resolvedPubkey || !identifier) return undefined;
    return {
      kind: 30777,
      pubkey: resolvedPubkey,
      identifier: identifier,
    };
  }, [resolvedPubkey, identifier]);

  const spellbookEvent = useNostrEvent(pointer);

  // Get author profile for banner
  const authorProfile = useProfile(resolvedPubkey || undefined);

  // 3. Apply preview/layout when event is loaded
  useEffect(() => {
    if (spellbookEvent && !hasLoadedSpellbook) {
      try {
        const parsed = parseSpellbook(spellbookEvent as SpellbookEvent);

        // Use the new temporary state system
        switchToTemporary(parsed);
        setHasLoadedSpellbook(true);

        if (isPreviewPath) {
          toast.info(`Previewing spellbook: ${parsed.title}`, {
            description:
              "You are in a temporary session. Apply to keep this spellbook.",
          });
        }
      } catch (e) {
        console.error("Failed to parse spellbook:", e);
        toast.error("Failed to load spellbook");
      }
    }
  }, [
    spellbookEvent,
    hasLoadedSpellbook,
    isPreviewPath,
    isDirectPath,
    switchToTemporary,
  ]);

  const handleApplySpellbook = () => {
    applyTemporaryToPersistent();
    navigate("/", { replace: true });
    toast.success("Spellbook applied to your dashboard");
  };

  const handleDiscardPreview = () => {
    discardTemporary();
    navigate("/", { replace: true });
  };

  const handleCopyLink = () => {
    if (!actor || !identifier) return;
    const link = `${window.location.origin}/preview/${actor}/${identifier}`;
    navigator.clipboard.writeText(link);
    toast.success("Link copied to clipboard");
  };

  const formatTimestamp = (timestamp: number) => {
    const date = new Date(timestamp * 1000);
    const now = Date.now();
    const diff = now - date.getTime();

    // Less than 24 hours: show relative time
    if (diff < 24 * 60 * 60 * 1000) {
      const hours = Math.floor(diff / (60 * 60 * 1000));
      if (hours === 0) {
        const minutes = Math.floor(diff / (60 * 1000));
        return minutes === 0 ? "just now" : `${minutes}m ago`;
      }
      return `${hours}h ago`;
    }

    // Otherwise show date
    return date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  // Sync active account and fetch relay lists
  useAccountSync();

  // Auto-cache kind:10002 relay lists from EventStore to Dexie
  useRelayListCacheSync();

  // Initialize global relay state manager
  useEffect(() => {
    relayStateManager.initialize().catch((err) => {
      console.error("Failed to initialize relay state manager:", err);
    });
  }, []);

  // Sync relay state with Jotai
  useRelayState();

  // Keyboard shortcut: Cmd/Ctrl+K
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCommandLauncherOpen((open) => !open);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleRemoveWindow = (id: string) => {
    // Remove from windows map
    removeWindow(id);
  };

  const renderTile = (id: string, path: MosaicBranch[]) => {
    const window = state.windows[id];

    if (!window) {
      return (
        <MosaicWindow
          path={path}
          title="Unknown Window"
          toolbarControls={<WindowToolbar />}
        >
          <div className="p-4 text-muted-foreground">
            Window not found: {id}
          </div>
        </MosaicWindow>
      );
    }

    return (
      <WindowTile
        id={id}
        window={window}
        path={path}
        onClose={handleRemoveWindow}
        onEditCommand={() => setCommandLauncherOpen(true)}
      />
    );
  };

  return (
    <>
      <CommandLauncher
        open={commandLauncherOpen}
        onOpenChange={setCommandLauncherOpen}
      />
      <GlobalAuthPrompt />
      <main className="h-screen w-screen flex flex-col bg-background text-foreground">
        {showBanner && (
          <div className="bg-accent text-accent-foreground px-4 py-1.5 flex items-center justify-between text-sm font-medium animate-in slide-in-from-top duration-300 shadow-md z-50">
            <div className="flex items-center gap-3">
              <BookHeart className="size-4 flex-shrink-0" />
              <div className="flex flex-col gap-0.5">
                <span className="font-semibold">
                  {spellbookEvent?.tags.find((t) => t[0] === "title")?.[1] ||
                    "Spellbook"}
                </span>
                {spellbookEvent && (
                  <span className="text-xs text-accent-foreground/70 flex items-center gap-2">
                    {authorProfile?.name || resolvedPubkey?.slice(0, 8)}
                    <span className="text-accent-foreground/50">•</span>
                    {formatTimestamp(spellbookEvent.created_at)}
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 hover:bg-black/10 text-accent-foreground"
                onClick={handleCopyLink}
                title="Copy share link"
              >
                <LinkIcon className="size-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 hover:bg-black/10 text-accent-foreground font-bold"
                onClick={handleDiscardPreview}
              >
                <X className="size-3.5 mr-1" />
                Discard
              </Button>
              <Button
                variant="secondary"
                size="sm"
                className="h-7 bg-white text-accent hover:bg-white/90 font-bold shadow-sm"
                onClick={handleApplySpellbook}
              >
                <Check className="size-3.5 mr-1" />
                Apply Spellbook
              </Button>
            </div>
          </div>
        )}
        {isResolving && (
          <div className="bg-muted px-4 py-2 flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            <span>Resolving {actor}...</span>
          </div>
        )}
        {resolutionError && (
          <div className="bg-destructive/10 text-destructive px-4 py-2 flex items-center justify-center text-sm">
            <span>Failed to resolve actor: {resolutionError}</span>
          </div>
        )}
        <header className="flex flex-row items-center justify-between px-1 border-b border-border">
          <button
            onClick={() => setCommandLauncherOpen(true)}
            className="p-1 text-muted-foreground hover:text-accent transition-colors cursor-crosshair"
            title="Launch command (Cmd+K)"
            aria-label="Launch command palette"
          ></button>

          <div className="flex items-center gap-2">
            <SpellbookDropdown />
          </div>

          <UserMenu />
        </header>
        <section className="flex-1 relative overflow-hidden">
          {state.workspaces[state.activeWorkspaceId] && (
            <>
              {state.workspaces[state.activeWorkspaceId].layout === null ? (
                <GrimoireWelcome
                  onLaunchCommand={() => setCommandLauncherOpen(true)}
                />
              ) : (
                <Mosaic
                  renderTile={renderTile}
                  value={state.workspaces[state.activeWorkspaceId].layout}
                  onChange={updateLayout}
                  onRelease={(node) => {
                    // When Mosaic removes a node from the layout, clean up the window
                    if (typeof node === "string") {
                      handleRemoveWindow(node);
                    }
                  }}
                  className="mosaic-blueprint-theme"
                />
              )}
            </>
          )}
        </section>
        <TabBar />
      </main>
    </>
  );
}
