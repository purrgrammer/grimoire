import { MosaicWindow, MosaicBranch } from "react-mosaic-component";
import { WindowInstance } from "@/types/app";
import { WindowToolbar } from "./WindowToolbar";
import { WindowRenderer } from "./WindowRenderer";
import { useDynamicWindowTitle } from "./DynamicWindowTitle";
import { ErrorBoundary } from "./ErrorBoundary";

interface WindowTileProps {
  id: string;
  window: WindowInstance;
  path: MosaicBranch[];
  onClose: (id: string) => void;
  onEditCommand: () => void; // Callback to open CommandLauncher
}

export function WindowTile({
  id,
  window,
  path,
  onClose,
  onEditCommand,
}: WindowTileProps) {
  const { title, icon, tooltip } = useDynamicWindowTitle(window);
  const Icon = icon;

  // Custom toolbar renderer to include icon
  const renderToolbar = () => {
    return (
      <div className="mosaic-window-toolbar draggable flex items-center justify-between w-full">
        <div className="mosaic-window-title flex items-center gap-2 flex-1">
          {Icon && (
            <span title={tooltip} className="flex-shrink-0">
              <Icon className="size-4 text-muted-foreground" />
            </span>
          )}
          <span className="truncate" title={tooltip}>
            {title}
          </span>
        </div>
        <WindowToolbar
          window={window}
          onClose={() => onClose(id)}
          onEditCommand={onEditCommand}
        />
      </div>
    );
  };

  return (
    <MosaicWindow path={path} title={title} renderToolbar={renderToolbar}>
      <ErrorBoundary level="window">
        <WindowRenderer window={window} onClose={() => onClose(id)} />
      </ErrorBoundary>
    </MosaicWindow>
  );
}
