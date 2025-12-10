import { useState, useEffect, Activity } from "react";
import { useGrimoire } from "@/core/state";
import { useAccountSync } from "@/hooks/useAccountSync";
import Feed from "./nostr/Feed";
import { WinViewer } from "./WinViewer";
import { WindowToolbar } from "./WindowToolbar";
import { TabBar } from "./TabBar";
import { Mosaic, MosaicWindow, MosaicBranch } from "react-mosaic-component";
import { NipRenderer } from "./NipRenderer";
import ManPage from "./ManPage";
import CommandLauncher from "./CommandLauncher";
import ReqViewer from "./ReqViewer";
import { EventDetailViewer } from "./EventDetailViewer";
import { ProfileViewer } from "./ProfileViewer";
import EncodeViewer from "./EncodeViewer";
import DecodeViewer from "./DecodeViewer";
import KindRenderer from "./KindRenderer";
import { Terminal } from "lucide-react";
import UserMenu from "./nostr/user-menu";
import { GrimoireWelcome } from "./GrimoireWelcome";

export default function Home() {
  const { state, updateLayout, removeWindow } = useGrimoire();
  const [commandLauncherOpen, setCommandLauncherOpen] = useState(false);

  // Sync active account and fetch relay lists
  useAccountSync();

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

    // Render based on appId
    let content;
    switch (window.appId) {
      case "nip":
        content = <NipRenderer nipId={window.props.number} />;
        break;
      case "feed":
        content = <Feed className="h-full w-full overflow-auto" />;
        break;
      case "win":
        content = <WinViewer />;
        break;
      case "kind":
        content = <KindRenderer kind={parseInt(window.props.number)} />;
        break;
      case "man":
        content = <ManPage cmd={window.props.cmd} />;
        break;
      case "req":
        content = (
          <ReqViewer
            filter={window.props.filter}
            relays={window.props.relays}
            closeOnEose={window.props.closeOnEose}
            nip05Authors={window.props.nip05Authors}
            nip05PTags={window.props.nip05PTags}
          />
        );
        break;
      case "open":
        content = <EventDetailViewer pointer={window.props.pointer} />;
        break;
      case "profile":
        content = <ProfileViewer pubkey={window.props.pubkey} />;
        break;
      case "encode":
        content = <EncodeViewer args={window.props.args} />;
        break;
      case "decode":
        content = <DecodeViewer args={window.props.args} />;
        break;
      default:
        content = (
          <div className="p-4 text-muted-foreground">
            Unknown app: {window.appId}
          </div>
        );
    }

    return (
      <MosaicWindow
        path={path}
        title={window.title}
        toolbarControls={
          <WindowToolbar onClose={() => handleRemoveWindow(id)} />
        }
      >
        <div className="h-full w-full overflow-auto">{content}</div>
      </MosaicWindow>
    );
  };

  return (
    <>
      <CommandLauncher
        open={commandLauncherOpen}
        onOpenChange={setCommandLauncherOpen}
      />
      <main className="h-screen w-screen flex flex-col bg-background text-foreground">
        <header className="flex flex-row items-center justify-between px-1 border-b border-border">
          <button
            onClick={() => setCommandLauncherOpen(true)}
            className="p-1 text-muted-foreground hover:text-accent transition-colors cursor-pointer"
            title="Launch command (Cmd+K)"
          >
            <Terminal className="size-4" />
          </button>
          <UserMenu />
        </header>
        <section className="flex-1 relative overflow-hidden">
          {Object.values(state.workspaces).map((workspace) => (
            <Activity
              key={workspace.id}
              mode={
                workspace.id === state.activeWorkspaceId ? "visible" : "hidden"
              }
            >
              {workspace.layout === null ? (
                <GrimoireWelcome
                  onLaunchCommand={() => setCommandLauncherOpen(true)}
                />
              ) : (
                <Mosaic
                  renderTile={renderTile}
                  value={workspace.layout}
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
            </Activity>
          ))}
        </section>
        <TabBar />
      </main>
    </>
  );
}
