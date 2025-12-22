import { useGrimoire } from "@/core/state";
import { Mosaic, MosaicWindow, MosaicBranch } from "react-mosaic-component";
import { WindowToolbar } from "./WindowToolbar";
import { WindowTile } from "./WindowTitle";
import { GrimoireWelcome } from "./GrimoireWelcome";
import { useAppShell } from "./layouts/AppShellContext";
import { parseAndExecuteCommand } from "@/lib/command-parser";

export function WorkspaceView() {
  const { state, updateLayout, removeWindow, addWindow } = useGrimoire();
  const { openCommandLauncher } = useAppShell();

  const handleRemoveWindow = (id: string) => {
    removeWindow(id);
  };

  const handleExecuteCommand = async (commandString: string) => {
    const result = await parseAndExecuteCommand(
      commandString,
      state.activeAccount?.pubkey,
    );

    if (result.error || !result.props || !result.command) {
      console.error("Failed to execute command:", result.error);
      return;
    }

    addWindow(
      result.command.appId,
      result.props,
      commandString,
      result.globalFlags?.windowProps?.title,
    );
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
        onEditCommand={openCommandLauncher}
      />
    );
  };

  const activeWorkspace = state.workspaces[state.activeWorkspaceId];

  if (!activeWorkspace) return null;

  return (
    <>
      {activeWorkspace.layout === null ? (
        <GrimoireWelcome
          onLaunchCommand={openCommandLauncher}
          onExecuteCommand={handleExecuteCommand}
        />
      ) : (
        <Mosaic
          renderTile={renderTile}
          value={activeWorkspace.layout}
          onChange={updateLayout}
          onRelease={(node) => {
            if (typeof node === "string") {
              handleRemoveWindow(node);
            }
          }}
          className="mosaic-blueprint-theme"
        />
      )}
    </>
  );
}
