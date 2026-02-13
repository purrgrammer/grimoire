import { useState, useEffect, ReactNode } from "react";
import { Terminal } from "lucide-react";
import { useAccountSync } from "@/hooks/useAccountSync";
import { useRelayListCacheSync } from "@/hooks/useRelayListCacheSync";
import { useBlossomServerCacheSync } from "@/hooks/useBlossomServerCacheSync";
import { useRelayState } from "@/hooks/useRelayState";
import relayStateManager from "@/services/relay-state-manager";
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

  // Sync active account and fetch relay lists
  useAccountSync();

  // Auto-cache kind:10002 relay lists from EventStore to Dexie
  useRelayListCacheSync();

  // Auto-cache kind:10063 blossom server lists from EventStore to Dexie
  useBlossomServerCacheSync();

  // Initialize global relay state manager
  useEffect(() => {
    relayStateManager.initialize();
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
      <main className="h-dvh w-screen flex flex-col bg-background text-foreground">
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
