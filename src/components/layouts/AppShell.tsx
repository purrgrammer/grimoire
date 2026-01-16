import { useState, useEffect, ReactNode } from "react";
import { Terminal } from "lucide-react";
import { useAccountSync } from "@/hooks/useAccountSync";
import { useReplaceableEventCacheSync } from "@/hooks/useReplaceableEventCacheSync";
import { useRelayState } from "@/hooks/useRelayState";
import { useEventStore } from "applesauce-react/hooks";
import relayStateManager from "@/services/relay-state-manager";
import replaceableEventCache from "@/services/replaceable-event-cache";
import { TabBar } from "../TabBar";
import CommandLauncher from "../CommandLauncher";
import { GlobalAuthPrompt } from "../GlobalAuthPrompt";
import { SpellbookDropdown } from "../SpellbookDropdown";
import UserMenu from "../nostr/user-menu";
import { AppShellContext } from "./AppShellContext";

interface AppShellProps {
  children: ReactNode;
  hideBottomBar?: boolean;
}

export function AppShell({ children, hideBottomBar = false }: AppShellProps) {
  const [commandLauncherOpen, setCommandLauncherOpen] = useState(false);
  const eventStore = useEventStore();

  // Hydrate EventStore from Dexie cache on startup (solves orphaned cache problem)
  useEffect(() => {
    replaceableEventCache.hydrateEventStore(eventStore).catch((err) => {
      console.error("Failed to hydrate EventStore from cache:", err);
    });
  }, [eventStore]);

  // Auto-cache generic replaceable events (contacts, relay lists, blossom servers, emoji lists, etc.)
  useReplaceableEventCacheSync();

  // Sync active account and fetch configured kinds
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

  const openCommandLauncher = () => setCommandLauncherOpen(true);

  return (
    <AppShellContext.Provider value={{ openCommandLauncher }}>
      <CommandLauncher
        open={commandLauncherOpen}
        onOpenChange={setCommandLauncherOpen}
      />
      <GlobalAuthPrompt />
      <main className="h-screen w-screen flex flex-col bg-background text-foreground">
        <header className="flex flex-row items-center justify-between px-1 border-b border-border">
          <button
            onClick={() => setCommandLauncherOpen(true)}
            className="p-1.5 text-muted-foreground hover:text-accent transition-colors cursor-crosshair flex items-center gap-2"
            title="Launch command (Cmd+K)"
            aria-label="Launch command palette"
          >
            <Terminal className="size-4" />
          </button>

          <div className="flex items-center gap-2">
            <SpellbookDropdown />
          </div>

          <UserMenu />
        </header>
        <section className="flex-1 relative overflow-hidden">
          {children}
        </section>
        {!hideBottomBar && <TabBar />}
      </main>
    </AppShellContext.Provider>
  );
}
