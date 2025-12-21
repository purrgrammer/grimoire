import { useGrimoire } from "@/core/state";
import { Mosaic, MosaicWindow, MosaicBranch } from "react-mosaic-component";
import { WindowToolbar } from "./WindowToolbar";
import { WindowTile } from "./WindowTitle";
import { GrimoireWelcome } from "./GrimoireWelcome";
import { useAppShell } from "./layouts/AppShellContext";

export function WorkspaceView() {
  const { state, updateLayout, removeWindow } = useGrimoire();
  const { openCommandLauncher } = useAppShell();

  const handleRemoveWindow = (id: string) => {
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
        onEditCommand={openCommandLauncher}
      />
    );
  };

  const activeWorkspace = state.workspaces[state.activeWorkspaceId];

  if (!activeWorkspace) return null;

  return (
    <>
      {activeWorkspace.layout === null ? (
        <GrimoireWelcome onLaunchCommand={openCommandLauncher} />
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
