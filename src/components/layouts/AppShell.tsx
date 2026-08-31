import { useState, useEffect, ReactNode } from "react";
import { Terminal } from "lucide-react";
import { useAccountSync } from "@/hooks/useAccountSync";
import { useDmIngest } from "@/hooks/useDmIngest";
import { useRelayListCacheSync } from "@/hooks/useRelayListCacheSync";
import { useBlockedRelaysSync } from "@/hooks/useBlockedRelaysSync";
import { useBlossomServerCacheSync } from "@/hooks/useBlossomServerCacheSync";
import { useEmojiSearchSync } from "@/hooks/useEmojiSearchSync";
import { useFavoriteListsSync } from "@/hooks/useFavoriteListsSync";
import { useRelayState } from "@/hooks/useRelayState";
import { useModelContextTools } from "@/hooks/useModelContextTools";
import relayStateManager from "@/services/relay-state-manager";
import { TabBar } from "../TabBar";
import { CallAudioHost } from "../call/CallAudioHost";
import CommandLauncher from "../CommandLauncher";
import { GlobalAuthPrompt } from "../GlobalAuthPrompt";
import { GlobalNappletConsent } from "../GlobalNappletConsent";
import { NappletLaunchConsent } from "../NappletLaunchConsent";
import { NappletIntentChooser } from "../NappletIntentChooser";
import { SpellbookDropdown } from "../SpellbookDropdown";
import { FavoriteSpellsDropdown } from "../FavoriteSpellsDropdown";
import { CallPill } from "../call/CallPill";
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

  // One gift-wrap ingester for the whole app, held here rather than by whichever
  // window happens to be open. Every pane that shows a wrapped event — a
  // conversation, an agent transcript — is then a pure reader of the local
  // mirror, which is what they all claim to be.
  useDmIngest();

  // Enforce the kind:10006 blocked relay list. Must be mounted app-wide: the
  // pools read the set synchronously on every read and publish.
  useBlockedRelaysSync();

  // Auto-cache kind:10002 relay lists from EventStore to Dexie
  useRelayListCacheSync();

  // Auto-cache kind:10063 blossom server lists from EventStore to Dexie
  useBlossomServerCacheSync();

  // Cache emoji lists (kind:10030) and emoji sets (kind:30030) for instant availability
  useEmojiSearchSync();

  // Pre-fetch all configured favorite lists (kind:10777, kind:10018, kind:10030)
  useFavoriteListsSync();

  // Initialize global relay state manager
  useEffect(() => {
    relayStateManager.initialize();
  }, []);

  // Sync relay state with Jotai
  useRelayState();

  // Publish grimoire's tools to the browser's own agent (WebMCP). Held at the
  // shell because the tools belong to the document, not to whichever window is
  // open — an agent asking what this page can do gets the same answer with no
  // `ai` window in sight. A no-op where `document.modelContext` is absent.
  useModelContextTools();

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
      <GlobalNappletConsent />
      <NappletLaunchConsent />
      <NappletIntentChooser />
      <main className="h-dvh w-screen flex flex-col bg-background text-foreground">
        <header className="flex flex-row items-center px-1 border-b border-border">
          <div className="flex-1 flex items-center">
            <button
              onClick={() => setCommandLauncherOpen(true)}
              className="p-1.5 text-muted-foreground hover:text-accent transition-colors cursor-crosshair flex items-center gap-2"
              title="Launch command (Cmd+K)"
              aria-label="Launch command palette"
            >
              <Terminal className="size-4" />
            </button>
          </div>

          <SpellbookDropdown />

          <div className="flex-1 flex items-center justify-end gap-1">
            {/* The running call, first in the right-hand cluster. The header is
                the only chrome that is always there — the tab bar, where this
                used to live, is hidden in some layouts, and a live microphone
                with no indicator is a privacy problem rather than a UX one. */}
            <CallPill />
            <FavoriteSpellsDropdown />
            <UserMenu />
          </div>
        </header>
        <section className="flex-1 relative overflow-hidden">
          {children}
        </section>
        {!hideBottomBar && <TabBar />}
        {/* The call's speakers, mounted at the SHELL rather than in the call
            window. A window unmounts on a workspace switch while its call keeps
            running, and an <audio> element that leaves with it takes the sound
            with it — the call is still connected, still publishing, and
            silent. Nothing here renders unless a call is connected. */}
        <CallAudioHost />
      </main>
    </AppShellContext.Provider>
  );
}
