import { useState, useEffect, useMemo } from "react";
import { useGrimoire } from "@/core/state";
import { useAccountSync } from "@/hooks/useAccountSync";
import { useRelayListCacheSync } from "@/hooks/useRelayListCacheSync";
import { useRelayState } from "@/hooks/useRelayState";
import relayStateManager from "@/services/relay-state-manager";
import { TabBar } from "./TabBar";
import { Mosaic, MosaicWindow, MosaicBranch } from "react-mosaic-component";
import CommandLauncher from "./CommandLauncher";
import { WindowToolbar } from "./WindowToolbar";
import { WindowTile } from "./WindowTitle";
import { BookHeart, X, Check } from "lucide-react";
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

const PREVIEW_BACKUP_KEY = "grimoire-preview-backup";

export default function Home() {
  const { state, updateLayout, removeWindow, loadSpellbook } = useGrimoire();
  const [commandLauncherOpen, setCommandLauncherOpen] = useState(false);
  const { actor, identifier } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  // Preview state
  const [resolvedPubkey, setResolvedPubkey] = useState<string | null>(null);
  const isPreviewPath = location.pathname.startsWith("/preview/");
  const [hasLoadedSpellbook, setHasLoadedSpellbook] = useState(false);

  // 1. Resolve actor to pubkey
  useEffect(() => {
    if (!actor) {
      setResolvedPubkey(null);
      setHasLoadedSpellbook(false);
      return;
    }

    const resolve = async () => {
      try {
        if (actor.startsWith("npub")) {
          const { data } = nip19.decode(actor);
          setResolvedPubkey(data as string);
        } else if (isNip05(actor)) {
          const pubkey = await resolveNip05(actor);
          setResolvedPubkey(pubkey);
        } else if (actor.length === 64) {
          setResolvedPubkey(actor);
        }
      } catch (e) {
        console.error("Failed to resolve actor:", actor, e);
      }
    };

    resolve();
  }, [actor]);

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

  // 3. Apply preview/layout when event is loaded
  useEffect(() => {
    if (spellbookEvent && !hasLoadedSpellbook) {
      try {
        const parsed = parseSpellbook(spellbookEvent as SpellbookEvent);
        
        if (isPreviewPath) {
          // In preview mode, save current state to sessionStorage for recovery
          if (!sessionStorage.getItem(PREVIEW_BACKUP_KEY)) {
            sessionStorage.setItem(PREVIEW_BACKUP_KEY, JSON.stringify(state));
          }
          
          loadSpellbook(parsed);
          setHasLoadedSpellbook(true);
          toast.info(`Previewing layout: ${parsed.title}`, {
            description: "You are in preview mode. Apply to keep this layout or discard to return.",
          });
        } else {
          // Direct mode: Just load it immediately
          loadSpellbook(parsed);
          setHasLoadedSpellbook(true);
          // Update URL to home after loading to avoid re-loading on refresh if they start modifying
          navigate("/", { replace: true });
          toast.success(`Loaded layout: ${parsed.title}`);
        }
      } catch (e) {
        console.error("Failed to parse spellbook:", e);
        toast.error("Failed to load spellbook");
      }
    }
  }, [spellbookEvent, hasLoadedSpellbook, isPreviewPath]);

  const handleApplyLayout = () => {
    sessionStorage.removeItem(PREVIEW_BACKUP_KEY);
    navigate("/", { replace: true });
    toast.success("Layout applied permanently");
  };

  const handleDiscardPreview = () => {
    const backup = sessionStorage.getItem(PREVIEW_BACKUP_KEY);
    if (backup) {
      try {
        JSON.parse(backup);
        // We need a way to restore the whole state. 
        // For now, the easiest way to "restore" a persisted state from sessionStorage
        // is to clear our local storage and reload, or manually call setters.
        // But loadSpellbook already overwrote it in localStorage via Jotai.
        
        // Let's try to overwrite localStorage directly and reload for a clean restore
        localStorage.setItem("grimoire-state", backup);
        sessionStorage.removeItem(PREVIEW_BACKUP_KEY);
        window.location.href = "/";
        return;
      } catch (e) {
        console.error("Failed to restore backup:", e);
      }
    }
    navigate("/");
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
        {isPreviewPath && (
          <div className="bg-accent text-accent-foreground px-4 py-1.5 flex items-center justify-between text-sm font-medium animate-in slide-in-from-top duration-300">
            <div className="flex items-center gap-2">
              <BookHeart className="size-4" />
              <span>Preview Mode: {spellbookEvent?.tags.find(t => t[0] === 'title')?.[1] || 'Spellbook'}</span>
            </div>
            <div className="flex items-center gap-2">
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
                onClick={handleApplyLayout}
              >
                <Check className="size-3.5 mr-1" />
                Apply Layout
              </Button>
            </div>
          </div>
        )}
        <header className="flex flex-row items-center justify-between px-1 border-b border-border">
          <button
            onClick={() => setCommandLauncherOpen(true)}
            className="p-1 text-muted-foreground hover:text-accent transition-colors cursor-crosshair"
            title="Launch command (Cmd+K)"
            aria-label="Launch command palette"
          >
          </button>
          
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
