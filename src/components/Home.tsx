import { useState, useEffect } from "react";
import { useGrimoire } from "@/core/state";
import { useAccountSync } from "@/hooks/useAccountSync";
import { useRelayState } from "@/hooks/useRelayState";
import relayStateManager from "@/services/relay-state-manager";
import { TabBar } from "./TabBar";
import { Mosaic, MosaicWindow, MosaicBranch } from "react-mosaic-component";
import CommandLauncher from "./CommandLauncher";
import { WindowToolbar } from "./WindowToolbar";
import { WindowTile } from "./WindowTitle";
import { Terminal } from "lucide-react";
import UserMenu from "./nostr/user-menu";
import { GrimoireWelcome } from "./GrimoireWelcome";
import { GlobalAuthPrompt } from "./GlobalAuthPrompt";

export default function Home() {
  const { state, updateLayout, removeWindow } = useGrimoire();
  const [commandLauncherOpen, setCommandLauncherOpen] = useState(false);

  // Sync active account and fetch relay lists
  useAccountSync();

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
        <header className="flex flex-row items-center justify-between px-1 border-b border-border">
          <button
            onClick={() => setCommandLauncherOpen(true)}
            className="p-1 text-muted-foreground hover:text-accent transition-colors cursor-crosshair"
            title="Launch command (Cmd+K)"
            aria-label="Launch command palette"
          >
            <Terminal className="size-4" />
          </button>
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
